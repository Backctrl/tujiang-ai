import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeSchema, type Project } from './contracts.js';
import { activateContext, bindRulePackVersion, saveContextDraft, type ProductionCatalog } from './production-context.js';
import { initializeProduction } from './production.js';
import { startupCheckSchema, startupScopeRefreshSchema, startupStartSchema, type StartupCheck,
  type StartupExecutionCapability, type StartupStatus } from './production-startup.js';
import { assertStartupCheck, continuationIsNoop, enqueueStartup, previewStartupContext, refreshStartupScope,
  registerStartup, startupCheck, startupStatus } from './startup.js';
import { startupHash } from './startup-scope.js';
import { Store } from './store.js';

export interface StartupCommandResponse { project: Project; startup: StartupStatus }
const projectParams = z.object({ id: z.string().uuid() });
export function registerStartupRoutes(app: FastifyInstance, store: Store, actor: string,
  catalog: ProductionCatalog, execution: StartupExecutionCapability) {
  const response = (project: Project): StartupCommandResponse => ({ project, startup: startupStatus(project, execution)! });
  app.post('/api/projects/:id/production/startup/check', async request => {
    const { id } = projectParams.parse(request.params);
    const { context } = startupCheckSchema.parse(request.body);
    return startupCheck(await store.get(id), context, catalog, execution, store.db);
  });
  app.get('/api/projects/:id/production/startup', async request => {
    const { id } = projectParams.parse(request.params);
    const project = await store.get(id);
    return { projectId: project.id, projectVersion: project.version, revision: project.revision, startup: startupStatus(project, execution) };
  });
  app.post('/api/projects/:id/production/startup/start', async request => {
    const { id } = projectParams.parse(request.params);
    const body = startupStartSchema.parse(request.body);
    let check: StartupCheck;
    return store.command(id, body, 'startup.started', actor, async (p, tx) => {
      const project = p!;
      initializeProduction(project);
      const preview = previewStartupContext(project, body.context, catalog);
      const state = project.production!.context;
      const active = state?.versions.find(item => item.version === state.activeVersion);
      saveContextDraft(project.production!, body.context);
      const reusable = active && startupHash(active.context) === startupHash(preview.context) && active.rulePackSha256 === preview.rulePackSha256;
      const snapshot = reusable ? active : activateContext(project.production!, catalog, actor);
      if (reusable) delete project.production!.context!.draft;
      await bindRulePackVersion(tx, snapshot);
      registerStartup(project, snapshot, check.inputFingerprint, actor);
      enqueueStartup(project, execution, actor);
      return project;
    }, { preserveStageAInput: true, response, noChange: async (p, tx) => {
      check = await startupCheck(p, body.context, catalog, execution, tx);
      assertStartupCheck(check, body.inputFingerprint);
      return !!p.production?.startup;
    } });
  });
  app.post('/api/projects/:id/production/startup/continue-extraction', async request => {
    const { id } = projectParams.parse(request.params);
    const body = writeSchema.strict().parse(request.body);
    return store.command(id, body, 'startup.extraction.continued', actor, p => {
      enqueueStartup(p!, execution, actor); return p!;
    }, { preserveStageAInput: true, response, noChange: p => continuationIsNoop(p, execution) });
  });
  app.post('/api/projects/:id/production/startup/scope-refresh', async request => {
    const { id } = projectParams.parse(request.params);
    const body = startupScopeRefreshSchema.parse(request.body);
    return store.command(id, body, 'startup.scope.refresh', actor, p => {
      refreshStartupScope(p!, body.inputFingerprint, body.reason, actor); return p!;
    }, { preserveStageAInput: true, response,
      noChange: p => !refreshStartupScope(p, body.inputFingerprint, body.reason, actor, true) });
  });
}
