import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { CONTRACT_VERSION, createSchema, evidenceSchema, extractionSchema, identitySchema, planSchema, reasonSchema, runSchema, writeSchema, candidateSchema, identityCorrectionSchema, storyboardEditSchema, sectionEditSchema } from './contracts.js';
import { createProject, enqueue, preflight, retryRun, reviewFact, addCandidate, correctIdentity, editStoryboard, editSection, selectSection, applyPlanCandidate } from './domain.js';
import { AppError } from './errors.js';
import { LocalObjects } from './objects.js';
import { Store, audit } from './store.js';
import { initializeProduction, requireProduction, PRODUCTION_CONTRACT_VERSION } from './production.js';
import { activateContext, bindRulePackVersion, contextDraftSchema, productionCatalogSchema, saveContextDraft, type ProductionCatalog } from './production-context.js';
import { materialUploadSchema, uploadLimitDetails } from './production-materials.js';
import { MATERIAL_UPLOAD_PATH, registerMaterialRoutes } from './material-routes.js';
import { registerProductionRuleRoutes } from './production-rule-routes.js';
import { ruleCheckSchema, scopedRulePackSchema } from './production-rules.js';
import { registerMaterialUsageRoutes } from './material-usage-routes.js';
import { materialUsageSchema, factSourceReconfirmSchema } from './production-material-usage.js';
import { registerStartupRoutes } from './startup-routes.js';
import { STARTUP_CONTRACT_VERSION, startupCheckSchema, startupExecutionCapability, startupScopeRefreshSchema, startupStartSchema, type StartupExecutionConfig } from './production-startup.js';
import { registerFactSourceRoutes } from './fact-source-routes.js';
import { FACT_SOURCES_CONTRACT_VERSION, structuredFactCandidateSchema, structuredFactConfirmSchema, structuredFactSourceReconfirmSchema } from './production-fact-sources.js';
import { assertProjectEvidenceCollectionValid } from './material-source-gates.js';

const projectParams = z.object({ id: z.string().uuid() });
const factParams = projectParams.extend({ factId: z.string().uuid(), action: z.enum(['confirm', 'reject', 'retract']) });
export function buildApp(store: Store, objects: LocalObjects, options: { token: string; actor: string; productionCatalog?: ProductionCatalog; startupExecution?: StartupExecutionConfig }) {
  const productionCatalog = productionCatalogSchema.parse(options.productionCatalog ?? { rulePacks: [] });
  const startupExecution = startupExecutionCapability(options.startupExecution);
  const contextWriteSchema = writeSchema.extend({ context: contextDraftSchema }).strict();
  const app = Fastify({ bodyLimit: 512_000, logger: false, forceCloseConnections: true });
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const streams = new Set<() => void>();
  app.addHook('onRequest', async (request) => {
    if (request.url === '/health') return;
    const header = request.headers.authorization ?? '';
    if (!timingSafeEqual(digest(header), digest(`Bearer ${options.token}`))) throw new AppError('UNAUTHORIZED', 401);
  });
  app.setErrorHandler((error, request, reply) => {
    const typed = error as Error & { statusCode?: number };
    const status = error instanceof AppError ? error.statusCode : error instanceof z.ZodError ? 400 : typed.statusCode && typed.statusCode < 500 ? typed.statusCode : 500;
    const oversizedMaterial = status === 413 && request.routeOptions.url === MATERIAL_UPLOAD_PATH;
    const code = oversizedMaterial ? 'FILE_TOO_LARGE' : error instanceof AppError ? error.code : error instanceof z.ZodError ? 'INVALID_REQUEST' : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST';
    reply.code(status).send({ error: { code, requestId: request.id,
      ...(oversizedMaterial ? { details: uploadLimitDetails() } : error instanceof AppError && error.details ? { details: error.details } : {}),
      ...(error instanceof z.ZodError ? { fields: error.issues.map(i => i.path.join('.')) } : {}) } });
  });
  app.get('/health', async () => ({ status: 'ok', stage: 'A' }));
  app.get('/ready', async () => { await store.db.query('SELECT 1'); return { status: 'ready' }; });
  app.get('/api/contracts', async () => ({ version: CONTRACT_VERSION,
    productionVersion: PRODUCTION_CONTRACT_VERSION,
    startupVersion: STARTUP_CONTRACT_VERSION,
    factSourcesVersion: FACT_SOURCES_CONTRACT_VERSION,
    requests: Object.fromEntries(Object.entries({ startupCheck: startupCheckSchema, startupStart: startupStartSchema, startupContinueExtraction: writeSchema.strict(), startupScopeRefresh: startupScopeRefreshSchema,
      productionRuleCheck: ruleCheckSchema, materialUsage: materialUsageSchema, factSourceReconfirm: factSourceReconfirmSchema, materialUpload: materialUploadSchema, materialParseRetry: writeSchema.strict(), productionContextDraft: contextWriteSchema, productionContextActivate: writeSchema.strict(), productionInitialize: writeSchema.strict(), create: createSchema, identity: identitySchema, evidence: evidenceSchema,
      factReview: reasonSchema, factCandidate: candidateSchema, identityCorrection: identityCorrectionSchema,
      structuredFactCandidate: structuredFactCandidateSchema, structuredFactConfirm: structuredFactConfirmSchema,
      structuredFactSourceReconfirm: structuredFactSourceReconfirmSchema,
      storyboardEdit: storyboardEditSchema, sectionEdit: sectionEditSchema, candidateApply: reasonSchema, sectionSelect: reasonSchema,
      run: runSchema, write: writeSchema.strict() }).map(([name, schema]) => [name, z.toJSONSchema(schema)])),
    skillOutputs: { 'extract-facts': z.toJSONSchema(extractionSchema), 'plan-section': z.toJSONSchema(planSchema) },
    rulePackModels: { 'scoped-rules.1': z.toJSONSchema(scopedRulePackSchema) },
  }));
  app.post('/api/projects', async (request, reply) => {
    const body = createSchema.parse(request.body);
    const p = await store.command(undefined, body, 'project.created', options.actor, () => createProject(body.name));
    return reply.code(201).send(p);
  });
  app.get('/api/projects', async () => ({ projects: await store.list() }));
  registerMaterialRoutes(app, store, objects, options.actor);
  registerProductionRuleRoutes(app, store);
  registerMaterialUsageRoutes(app, store, objects, options.actor);
  registerFactSourceRoutes(app, store, options.actor);
  registerStartupRoutes(app, store, options.actor, productionCatalog, startupExecution);
  app.get('/api/production/catalog', async () => ({ contractVersion: PRODUCTION_CONTRACT_VERSION, ...productionCatalog }));
  app.post('/api/projects/:id/production/context/draft', async request => {
    const { id } = projectParams.parse(request.params);
    const body = contextWriteSchema.parse(request.body);
    return store.command(id, body, 'production.context.draft', options.actor, p => {
      saveContextDraft(requireProduction(p!), body.context); return p!;
    }, { preserveStageAInput: true });
  });
  app.post('/api/projects/:id/production/context/activate', async request => {
    const { id } = projectParams.parse(request.params);
    const body = writeSchema.strict().parse(request.body);
    return store.command(id, body, 'production.context.activated', options.actor, async (p, tx) => {
      const activated = activateContext(requireProduction(p!), productionCatalog, options.actor);
      await bindRulePackVersion(tx, activated);
      return p!;
    }, { preserveStageAInput: true });
  });
  app.post('/api/projects/:id/production/initialize', async request => {
    const { id } = projectParams.parse(request.params);
    const body = writeSchema.strict().parse(request.body);
    return store.command(id, body, 'production.initialized', options.actor, p => { initializeProduction(p!); return p!; },
      { preserveStageAInput: true, noChange: p => p.production?.contractVersion === PRODUCTION_CONTRACT_VERSION });
  });
  app.get('/api/projects/:id', async request => store.get(projectParams.parse(request.params).id));
  app.get('/api/projects/:id/revisions/:revision', async request => {
    const { id, revision } = projectParams.extend({ revision: z.coerce.number().int().positive() }).parse(request.params);
    const { rows } = await store.db.query('SELECT state FROM project_revisions WHERE project_id=$1 AND revision=$2', [id, revision]);
    if (!rows[0]) throw new AppError('REVISION_NOT_FOUND', 404);
    return rows[0].state;
  });
  app.post('/api/projects/:id/identity/confirm', async request => {
    const { id } = projectParams.parse(request.params);
    const body = identitySchema.parse(request.body);
    return store.command(id, body, 'identity.confirmed', options.actor, p => {
      if (p!.identity) throw new AppError('IDENTITY_ALREADY_CONFIRMED', 409);
      p!.version++;
      p!.identityRevision = 1;
      p!.identity = { productName: body.productName, confirmedBy: options.actor, confirmedAt: new Date().toISOString() };
      audit(p!, 'identity.employee_answer', options.actor, { productName: body.productName });
      return p!;
    });
  });
  app.post('/api/projects/:id/identity/correct', async request => {
    const { id } = projectParams.parse(request.params); const body = identityCorrectionSchema.parse(request.body);
    return store.command(id, body, 'identity.correct', options.actor, p => { correctIdentity(p!, body.productName, body.reason, options.actor); return p!; });
  });
  app.post('/api/projects/:id/facts/candidates', async request => {
    const { id } = projectParams.parse(request.params); const body = candidateSchema.parse(request.body);
    return store.command(id, body, 'fact.candidate', options.actor, p => { addCandidate(p!, body, options.actor); return p!; });
  });
  app.post('/api/projects/:id/storyboard/draft', async request => {
    const { id } = projectParams.parse(request.params); const body = storyboardEditSchema.parse(request.body);
    return store.command(id, body, 'storyboard.edit', options.actor, p => { editStoryboard(p!, body.chapters, body.reason, options.actor); return p!; });
  });
  app.post('/api/projects/:id/storyboard/candidates/:candidateId/apply', async request => {
    const { id, candidateId } = projectParams.extend({ candidateId: z.string().uuid() }).parse(request.params);
    const body = reasonSchema.parse(request.body);
    return store.command(id, body, `storyboard.${candidateId}.apply`, options.actor, p => { applyPlanCandidate(p!, candidateId, body.reason, options.actor); return p!; });
  });
  app.post('/api/projects/:id/sections/:sectionId/draft', async request => {
    const { id, sectionId } = projectParams.extend({ sectionId: z.string().uuid() }).parse(request.params);
    const body = sectionEditSchema.parse(request.body);
    return store.command(id, body, `section.${sectionId}.edit`, options.actor, p => {
      editSection(p!, sectionId, { purpose: body.purpose, factIds: body.factIds, missingInputs: body.missingInputs }, body.reason, options.actor); return p!;
    });
  });
  app.post('/api/projects/:id/sections/:sectionId/select', async request => {
    const { id, sectionId } = projectParams.extend({ sectionId: z.string().uuid() }).parse(request.params);
    const body = reasonSchema.parse(request.body);
    return store.command(id, body, `section.${sectionId}.select`, options.actor, p => { selectSection(p!, sectionId, body.reason, options.actor); return p!; });
  });
  app.post('/api/projects/:id/evidence', async request => {
    const { id } = projectParams.parse(request.params);
    const body = evidenceSchema.parse(request.body);
    return store.command(id, body, 'evidence.added', options.actor, async p => {
      assertProjectEvidenceCollectionValid(p!);
      if (p!.evidence.filter(e => !e.materialSource).length >= 10) throw new AppError('EVIDENCE_LIMIT', 409);
      const artifact = await objects.put(body.text);
      p!.evidence.push({ id: randomUUID(), documentName: body.documentName, locator: body.locator, text: body.text,
        usage: body.usage, ...artifact, createdBy: options.actor, createdAt: new Date().toISOString(), origin: 'manual_entry' });
      return p!;
    });
  });
  app.post('/api/projects/:id/facts/:factId/:action', async request => {
    const { id, factId, action } = factParams.parse(request.params);
    const body = reasonSchema.parse(request.body);
    return store.command(id, body, `fact.${factId}.${action}`, options.actor, p => {
      reviewFact(p!, factId, action, options.actor, body.reason); return p!;
    });
  });
  app.post('/api/projects/:id/runs', async (request, reply) => {
    const { id } = projectParams.parse(request.params);
    const body = runSchema.parse(request.body);
    const p = await store.command(id, body, 'run.requested', options.actor, p => { enqueue(p!, body.skill, options.actor); return p!; });
    return reply.code(202).send(p);
  });
  app.post('/api/projects/:id/runs/:runId/retry', async (request, reply) => {
    const { id, runId } = projectParams.extend({ runId: z.string().uuid() }).parse(request.params);
    const body = writeSchema.strict().parse(request.body);
    const p = await store.command(id, body, `run.${runId}.retry`, options.actor, p => {
      if (p!.runs.find(run => run.id === runId)?.startupInput && startupExecution.status === 'unavailable')
        throw new AppError(startupExecution.code, 503, { recovery: startupExecution.message });
      retryRun(p!, runId); return p!;
    });
    return reply.code(202).send(p);
  });
  app.post('/api/projects/:id/qa/preflight', async request => {
    const { id } = projectParams.parse(request.params);
    const body = writeSchema.strict().parse(request.body);
    return store.command(id, body, 'qa.preflight', options.actor, p => { preflight(p!); return p!; });
  });
  app.get('/api/projects/:id/events', async (request, reply) => {
    const { id } = projectParams.parse(request.params);
    await store.get(id);
    const { after } = z.object({ after: z.coerce.number().int().nonnegative().default(0) }).parse(request.query);
    let cursor = z.coerce.number().int().nonnegative().parse(request.headers['last-event-id'] ?? after);
    let closed = false;
    let busy = false;
    let timer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      streams.delete(stop);
      reply.raw.end();
    };
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    reply.raw.write(': connected\n\n');
    streams.add(stop);
    reply.raw.on('close', stop);
    const push = async () => {
      if (busy || closed) return;
      busy = true;
      try {
        const p = await store.get(id);
        for (; cursor < p.audit.length && !closed; cursor++) {
          if (reply.raw.writableLength > 64_000) { stop(); break; }
          reply.raw.write(`id: ${cursor + 1}\nevent: project.changed\ndata: ${JSON.stringify(p.audit[cursor])}\n\n`);
        }
        if (!closed) reply.raw.write(': heartbeat\n\n');
      } catch { stop(); }
      finally { busy = false; }
    };
    await push();
    if (!closed) timer = setInterval(() => void push(), 1000);
    return reply;
  });
  app.addHook('preClose', async () => { for (const stop of streams) stop(); });
  return app;
}
