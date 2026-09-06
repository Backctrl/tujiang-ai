import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, command } from './helpers.js';
import { context, rule } from './fixtures/production-context.js';
import { scopedContext, scopedRule } from './fixtures/scoped-rules.js';
import type { ScopedConstraint } from '../src/production-rules.js';
import { buildApp } from '../src/app.js';
import type { Project } from '../src/contracts.js';
import type { ContextDraft, ProductionCatalog } from '../src/production-context.js';
import { startupExecutionCapability, type StartupCheck, type StartupExecutionConfig } from '../src/production-startup.js';
import type { StartupCommandResponse } from '../src/startup-routes.js';
import { startupHash } from '../src/startup-scope.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import { Worker } from '../src/worker.js';
import { buildStructuredRequest } from '../src/openrouter.js';

const catalog: ProductionCatalog = { rulePacks: [rule], scopedRulePacks: [scopedRule] };
const synthetic = { mode: 'synthetic', workerEnabled: true } as const;
type Fixture = Awaited<ReturnType<typeof fixture>>;
const path = (p: Project, action = '') => `/api/projects/${p.id}/production/startup${action ? `/${action}` : ''}`;
async function checked(f: Fixture, p: Project, submitted: ContextDraft = scopedContext): Promise<StartupCheck> {
  const response = await f.post(path(p, 'check'), { context: submitted });
  assert.equal(response.statusCode, 200, response.body); return response.json<StartupCheck>();
}
async function start(f: Fixture, p: Project, submitted: ContextDraft = scopedContext) {
  const check = await checked(f, p, submitted);
  const body = command(p, { context: submitted, inputFingerprint: check.inputFingerprint });
  const response = await f.post(path(p, 'start'), body);
  assert.equal(response.statusCode, 200, response.body);
  return { body, ...response.json<StartupCommandResponse>() };
}
async function status(f: Fixture, p: Project) {
  const response = await f.app.inject({ method: 'GET', url: path(p), headers: f.headers });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ projectId: string; projectVersion: number; revision: number; startup: StartupCommandResponse['startup'] | null }>();
}
async function resume(f: Fixture, p: Project) {
  const response = await f.post(path(p, 'continue-extraction'), command(p));
  assert.equal(response.statusCode, 200, response.body); return response.json<StartupCommandResponse>();
}
async function independentEvidence(f: Fixture, p: Project, text = 'Synthetic capacity: 10 kg') {
  return f.write(p, 'evidence', { documentName: 'synthetic-product.txt', locator: 'line 1', usage: 'product_evidence', text });
}
async function upload(f: Fixture, p: Project, fileName = 'synthetic.txt', text = 'Synthetic capacity: 10 kg') {
  if (!p.production) p = await f.write(p, 'production/initialize');
  return f.write(p, 'production/materials', { fileName, mimeType: fileName.endsWith('.json') ? 'application/json' : 'text/plain',
    contentBase64: Buffer.from(text, 'utf8').toString('base64'), source: { kind: 'local_upload' } });
}
async function parseAll(f: Fixture, p: Project) {
  const worker = new IngestionWorker(f.store, f.objects);
  while (await worker.tick()) { /* Each accepted synthetic original finishes independently. */ }
  return f.store.get(p.id);
}
async function use(f: Fixture, p: Project, materialId = p.production!.materials![0]!.id, usage = 'product_evidence') {
  const material = p.production!.materials!.find(item => item.id === materialId)!;
  return f.write(p, `production/materials/${material.id}/usage`, {
    reason: 'Synthetic employee checks this source purpose', decisions: material.blocks.map(block => ({ blockId: block.id, usage })),
  });
}
const output = (evidenceId: string) => ({ facts: [{ attribute: 'capacity', role: 'core', value: '10 kg', evidenceId, quote: '10 kg' }] });
async function counts(f: Fixture) {
  return { receipts: (await f.db.query('SELECT key FROM command_receipts')).rows.length,
    revisions: (await f.db.query('SELECT revision FROM project_revisions')).rows.length,
    rules: (await f.db.query('SELECT id FROM production_rule_packs')).rows.length };
}

test('startup check over real HTTP accepts partial unsaved context and reports real source statistics without writes or external calls', async () => {
  const f = await fixture(catalog); const base = await f.app.listen({ port: 0, host: '127.0.0.1' });
  try {
    let p = await upload(f, await f.create());
    const before = structuredClone(p); const beforeCounts = await counts(f);
    const request = (body: unknown, authenticated = true) => fetch(`${base}${path(p, 'check')}`, { method: 'POST',
      headers: { ...(authenticated ? f.headers : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await request({ context: {} }, false)).status, 401);
    const response = await request({ context: { productBrief: { productName: 'Unsaved input' } } });
    assert.equal(response.status, 200); const check = await response.json() as StartupCheck;
    assert.equal(check.projectId, p.id); assert.equal(check.projectVersion, p.version); assert.equal(check.revision, p.revision);
    assert.equal(check.nextState, 'blocked'); assert.equal(check.canStart, false); assert.equal(check.canQueueExtraction, false);
    assert.equal(check.statistics.requiredFieldsPresent, 1); assert.equal(check.statistics.requiredFieldsTotal, 4);
    assert.equal(check.statistics.receivedMaterials, 1); assert.equal(check.statistics.awaitingParse, 1);
    assert.equal(check.statistics.availableProductEvidence, 0); assert.equal(check.statistics.availableImageAssets, 0);
    assert.equal(check.modelExecution.status, 'unavailable'); assert.equal(check.modelExecution.dispatchPreflight, 'not_performed');
    assert.ok(check.blockers.some(item => item.location.anchor === 'product-info'));
    assert.ok(check.extractionPrerequisites.some(item => item.code === 'MATERIAL_PARSE_PENDING' && item.location.materialIds?.[0] === p.production!.materials![0]!.id));
    assert.equal('percentage' in check, false); assert.equal('progress' in check, false);
    assert.equal((await request({ context: {}, allowModel: true })).status, 400);
    assert.equal((await request({ context: { allowModel: true } })).status, 400);
    assert.deepEqual(await f.store.get(p.id), before); assert.deepEqual(await counts(f), beforeCounts);
    p = await parseAll(f, p); const parsed = await checked(f, p);
    assert.equal(parsed.statistics.awaitingParse, 0); assert.equal(parsed.statistics.awaitingUsageReview, 1);
    assert.equal(parsed.statistics.availableProductEvidence, 0); assert.equal(parsed.canStart, true);
    assert.equal(parsed.nextState, 'awaiting_usage_review'); assert.equal(parsed.canQueueExtraction, false);
    assert.equal((await status(f, p)).startup, null);
    const contracts = (await f.app.inject({ method: 'GET', url: '/api/contracts', headers: f.headers })).json();
    for (const key of ['startupCheck', 'startupStart', 'startupContinueExtraction', 'startupScopeRefresh'])
      assert.equal(contracts.requests[key].additionalProperties, false);
  } finally { await f.close(); }
});

test('startup checks reuse strict context rules, distinguish optional brief fields, and block identity or material gaps atomically', async () => {
  const f = await fixture(catalog, synthetic);
  try {
    let p = await f.create();
    const brief = { productName: scopedContext.productBrief.productName, category: scopedContext.productBrief.category,
      stage: scopedContext.productBrief.stage, introduction: scopedContext.productBrief.introduction };
    const submitted = { ...scopedContext, productBrief: brief };
    let check = await checked(f, p, submitted);
    assert.equal(check.blockers.some(item => item.location.anchor === 'product-info'), false);
    assert.deepEqual(check.blockers.map(item => item.code), ['STARTUP_MATERIAL_REQUIRED']);
    const before = structuredClone(p); const beforeCounts = await counts(f);
    const rejected = await f.post(path(p, 'start'), command(p, { context: submitted, inputFingerprint: check.inputFingerprint }));
    assert.equal(rejected.json().error.code, 'STARTUP_BLOCKED');
    assert.deepEqual(await f.store.get(p.id), before); assert.deepEqual(await counts(f), beforeCounts);
    p = await independentEvidence(f, p);
    for (const [value, code] of [
      [{ ...submitted, rulePackRef: { id: 'not-published', version: 'unknown' } }, 'RULE_PACK_UNAVAILABLE'],
      [{ ...submitted, primaryTarget: { ...submitted.primaryTarget, country: 'GB' } }, 'RULE_PACK_TARGET_MISMATCH'],
      [{ ...submitted, canvasProfile: { ...submitted.canvasProfile, widthPx: 600 } }, 'CANVAS_OUTSIDE_LOCAL_PRODUCTION_POLICY'],
      [{ ...submitted, canvasProfile: { widthPx: 1200, format: 'webp' } }, 'LOCAL_PRODUCTION_SELECTION_REQUIRED'],
    ] as const) assert.ok((await checked(f, p, value)).blockers.some(item => item.code === code));
    p = await f.write(p, 'identity/confirm', { productName: 'Different confirmed product' });
    check = await checked(f, p, submitted);
    assert.ok(check.blockers.some(item => item.code === 'PRODUCT_IDENTITY_MISMATCH'));
    const identity = structuredClone(p.identity);
    assert.equal((await f.post(path(p, 'start'), command(p, { context: submitted, inputFingerprint: check.inputFingerprint }))).statusCode, 409);
    assert.deepEqual((await f.store.get(p.id)).identity, identity);
    p = await f.write(p, 'identity/correct', { productName: brief.productName, reason: 'Explicit employee correction before startup' });
    const started = await start(f, p, submitted);
    assert.equal(started.project.identityRevision, 2); assert.deepEqual(started.project.identity, p.identity);
    assert.equal(started.project.production!.context!.versions.length, 1);
    assert.equal(started.project.production!.context!.versions[0]!.context.productBrief.internalCode, undefined);
    assert.equal(started.project.production!.context!.versions[0]!.context.productBrief.commercialIntent, undefined);
    assert.equal(started.startup.state, 'queued');
  } finally { await f.close(); }
});

test('startup fingerprint binds selected RulePack content and immutable registration; stale checks cannot activate another rule', async () => {
  const f = await fixture(catalog, synthetic);
  const changedRule = { ...scopedRule, publication: { ...scopedRule.publication, actor: 'another-synthetic-reviewer' } };
  const changed = buildApp(f.store, f.objects, { actor: 'test-human', token: f.headers.authorization.slice(7), startupExecution: synthetic,
    productionCatalog: { rulePacks: [rule], scopedRulePacks: [changedRule] } });
  try {
    const p = await independentEvidence(f, await f.create()); const check = await checked(f, p);
    const changedCheckResponse = await changed.inject({ method: 'POST', url: path(p, 'check'), headers: f.headers, payload: { context: scopedContext } });
    assert.equal(changedCheckResponse.statusCode, 200); const changedCheck = changedCheckResponse.json<StartupCheck>();
    assert.notEqual(changedCheck.inputFingerprint, check.inputFingerprint);
    const beforeCounts = await counts(f);
    const blocked = await changed.inject({ method: 'POST', url: path(p, 'start'), headers: f.headers,
      payload: command(p, { context: scopedContext, inputFingerprint: check.inputFingerprint }) });
    assert.equal(blocked.json().error.code, 'STARTUP_CHECK_CHANGED');
    assert.deepEqual(await f.store.get(p.id), p); assert.deepEqual(await counts(f), beforeCounts);
    await start(f, p);
    const other = await independentEvidence(f, await f.create());
    const mismatch = (await changed.inject({ method: 'POST', url: path(other, 'check'), headers: f.headers, payload: { context: scopedContext } })).json<StartupCheck>();
    assert.ok(mismatch.blockers.some(item => item.code === 'RULE_PACK_VERSION_CHANGED'));
    assert.equal(mismatch.canStart, false);
  } finally { await changed.close(); await f.close(); }
});

test('startup distributes each unknown activation rule with its reason, recovery and exact Setup location without writing', async () => {
  const unknowns: ScopedConstraint[] = ['widthPx', 'heightPx'].map((measure, index) => ({
    ruleId: `synthetic-unverified-${measure}`, name: `Synthetic pending ${measure}`, description: 'Synthetic unknown activation requirement',
    scope: { kind: 'image_slot', contentType: scopedRule.target.contentType, moduleType: 'SyntheticModule', slotId: 'image' },
    measure: measure as 'widthPx' | 'heightPx', severity: 'blocker', status: 'unknown',
    reason: `合成规则 ${index + 1} 尚缺官方位置依据。`, recovery: `请管理员核验合成规则 ${index + 1} 的来源并发布新版本。`,
  }));
  const pendingRule = { ...scopedRule, constraints: unknowns, activationRequirements: unknowns.map(rule => rule.ruleId) };
  const f = await fixture({ rulePacks: [], scopedRulePacks: [pendingRule] }, synthetic);
  try {
    const p = await independentEvidence(f, await f.create()); const beforeCounts = await counts(f);
    const check = await checked(f, p);
    assert.equal(check.canStart, false); assert.equal(check.nextState, 'blocked'); assert.equal(check.canQueueExtraction, false);
    assert.equal(check.blockers.length, 2);
    for (const rule of unknowns) {
      assert.equal(rule.status, 'unknown');
      if (rule.status !== 'unknown') throw new Error('Unknown fixture required');
      const finding = check.blockers.find(item => item.message.includes(rule.ruleId))!;
      assert.equal(finding.code, 'RULE_PACK_INCOMPLETE'); assert.ok(finding.message.includes(rule.reason)); assert.ok(finding.message.includes(rule.recovery));
      assert.deepEqual(finding.location, { page: 'setup', anchor: 'primary-target', fields: ['rulePackRef'] });
    }
    const blocked = await f.post(path(p, 'start'), command(p, { context: scopedContext, inputFingerprint: check.inputFingerprint }));
    assert.equal(blocked.json().error.code, 'STARTUP_BLOCKED'); assert.deepEqual(blocked.json().error.details.blockers, check.blockers);
    assert.deepEqual(await f.store.get(p.id), p); assert.deepEqual(await counts(f), beforeCounts);
    const foreign = { ...pendingRule, constraints: unknowns.map(rule => ({ ...rule, scope: { ...rule.scope, category: 'other-synthetic-category' } })) };
    const peer = buildApp(f.store, f.objects, { actor: 'test-human', token: f.headers.authorization.slice(7),
      productionCatalog: { rulePacks: [], scopedRulePacks: [foreign] }, startupExecution: synthetic });
    try {
      const missing = (await peer.inject({ method: 'POST', url: path(p, 'check'), headers: f.headers, payload: { context: scopedContext } })).json<StartupCheck>();
      assert.equal(missing.blockers.length, 1); assert.equal(missing.blockers[0]!.code, 'RULE_PACK_INCOMPLETE');
      assert.ok(missing.blockers[0]!.message.includes('当前内容类型和品类')); assert.ok(missing.blockers[0]!.message.includes('管理员补齐'));
      assert.deepEqual(missing.blockers[0]!.location, { page: 'setup', anchor: 'primary-target', fields: ['rulePackRef'] });
    } finally { await peer.close(); }
    assert.deepEqual(await f.store.get(p.id), p); assert.deepEqual(await counts(f), beforeCounts);
  } finally { await f.close(); }
});

test('startup queues once, creates no approved facts or Story, and exact command receipts survive later state changes', async () => {
  const f = await fixture(catalog, synthetic);
  try {
    const original = await independentEvidence(f, await f.create()); const check = await checked(f, original);
    const body = command(original, { context: scopedContext, inputFingerprint: check.inputFingerprint });
    const bodies = [body, { ...body, idempotencyKey: randomUUID() }];
    const parallel = await Promise.all(bodies.map(request => f.post(path(original, 'start'), request)));
    assert.deepEqual(parallel.map(item => item.statusCode).sort(), [200, 409]);
    const accepted = parallel.find(item => item.statusCode === 200)!.json<StartupCommandResponse>();
    let p = accepted.project;
    assert.equal(p.production!.context!.versions.length, 1); assert.equal(p.runs.length, 1); assert.equal(p.facts.length, 0);
    assert.equal(p.storyboard, undefined); assert.equal(p.storyboardCandidates, undefined); assert.deepEqual(p.production!.objects, []);
    assert.equal(p.identity!.productName, scopedContext.productBrief.productName); assert.equal(p.identity!.confirmedBy, 'test-human');
    assert.equal(accepted.startup.runId, p.runs[0]!.id); assert.equal(accepted.startup.state, 'queued');
    const acceptedBody = bodies[parallel.findIndex(response => response.statusCode === 200)]!;
    assert.deepEqual((await f.post(path(original, 'start'), acceptedBody)).json(), accepted);
    const before = structuredClone(p);
    const again = await start(f, p);
    assert.deepEqual(again.project, before); assert.equal(again.startup.runId, accepted.startup.runId);
    let calls = 0;
    await new Worker(f.store, { generate: async (skill, snapshot, _observe, run) => {
      calls++; const input = JSON.parse(buildStructuredRequest(skill, snapshot, 'synthetic-startup', 1000, run).messages[1]!.content);
      assert.deepEqual(input.evidence.map((item: { id: string }) => item.id), [original.evidence[0]!.id]);
      assert.equal(input.productBrief.productName, scopedContext.productBrief.productName);
      assert.equal(input.identity.productName, scopedContext.productBrief.productName);
      return output(input.evidence[0].id);
    } }).tick();
    p = await f.store.get(p.id); assert.equal(calls, 1); assert.equal(p.runs[0]!.runStatus, 'succeeded');
    assert.equal(p.facts[0]!.status, 'candidate'); assert.equal(p.facts[0]!.locked, false); assert.equal(p.facts[0]!.confirmedBy, undefined);
    assert.equal((await status(f, p)).startup!.state, 'succeeded');
    const resumed = await resume(f, p); assert.deepEqual(resumed.project, p); assert.equal(resumed.startup.state, 'succeeded');
    assert.deepEqual((await f.post(path(original, 'start'), acceptedBody)).json(), accepted);
    assert.deepEqual(await f.store.get(p.id), p); assert.equal(p.runs.length, 1);
  } finally { await f.close(); }
});

test('pending usage enters Facts, cannot enter model input, and requires explicit continue after employee review', async () => {
  const f = await fixture(catalog, synthetic);
  try {
    let p = await parseAll(f, await upload(f, await f.create()));
    const started = await start(f, p); p = started.project;
    assert.equal(started.startup.state, 'awaiting_usage_review'); assert.equal(started.startup.runId, null);
    assert.deepEqual(p.evidence, []); assert.deepEqual(p.runs, []);
    assert.equal(p.production!.materials![0]!.usage.status, 'pending');
    const beforeCounts = await counts(f);
    const waiting = await resume(f, p);
    assert.deepEqual(waiting.project, p); assert.equal(waiting.startup.state, 'awaiting_usage_review');
    const afterCounts = await counts(f); assert.equal(afterCounts.revisions, beforeCounts.revisions); assert.equal(afterCounts.receipts, beforeCounts.receipts + 1);
    p = await use(f, p); assert.equal(p.runs.length, 0, 'usage review itself never queues a model');
    const ready = await status(f, p); assert.equal(ready.startup!.state, 'ready_to_extract'); assert.equal(ready.startup!.runId, null);
    const queued = await resume(f, p); p = queued.project;
    assert.equal(queued.startup.state, 'queued'); assert.equal(p.runs.length, 1);
    assert.deepEqual(queued.startup.evidenceIds, [p.evidence[0]!.id]);
    const repeat = await resume(f, p); assert.deepEqual(repeat.project, p);
    assert.equal(p.production!.startup!.history.filter(entry => entry.type === 'extraction_queued').length, 1);
  } finally { await f.close(); }
});

test('unavailable execution is conservative, no-op continue is read-only, and replay never changes its original capability response', async () => {
  const f = await fixture(catalog);
  const restored = buildApp(f.store, f.objects, { actor: 'test-human', token: f.headers.authorization.slice(7), productionCatalog: catalog, startupExecution: synthetic });
  try {
    let p = await independentEvidence(f, await f.create()); const started = await start(f, p); p = started.project;
    assert.equal(started.startup.state, 'awaiting_model_configuration'); assert.equal(started.startup.runId, null);
    const body = command(p); const waiting = await f.post(path(p, 'continue-extraction'), body);
    assert.deepEqual(waiting.json<StartupCommandResponse>().project, p);
    assert.equal(waiting.json<StartupCommandResponse>().startup.modelExecution.status, 'unavailable');
    const replay = await restored.inject({ method: 'POST', url: path(p, 'continue-extraction'), headers: f.headers, payload: body });
    assert.deepEqual(replay.json(), waiting.json(), 'exact command response is replayed even on a service with different capability');
    assert.deepEqual(await f.store.get(p.id), p);
    const ready = (await restored.inject({ method: 'GET', url: path(p), headers: f.headers })).json();
    assert.equal(ready.startup.state, 'ready_to_extract'); assert.equal(ready.startup.runId, null);
    const queued = await restored.inject({ method: 'POST', url: path(p, 'continue-extraction'), headers: f.headers, payload: command(p) });
    assert.equal(queued.statusCode, 200); p = queued.json<StartupCommandResponse>().project;
    assert.equal(p.runs.length, 1);
    const startReplay = await restored.inject({ method: 'POST', url: path(p, 'start'), headers: f.headers, payload: started.body });
    assert.deepEqual(startReplay.json(), { project: started.project, startup: started.startup });
  } finally { await restored.close(); await f.close(); }
});

test('an unrelated active run blocks startup or continuation without adopting it or claiming that another extraction was queued', async () => {
  const f = await fixture(catalog, synthetic);
  try {
    let p = await independentEvidence(f, await f.create()); p = await f.write(p, 'runs', { skill: 'extract-facts' });
    const blocked = await checked(f, p); assert.equal(blocked.canStart, false);
    assert.ok(blocked.blockers.some(item => item.code === 'RUN_ALREADY_ACTIVE'));
    const rejected = await f.post(path(p, 'start'), command(p, { context: scopedContext, inputFingerprint: blocked.inputFingerprint }));
    assert.equal(rejected.statusCode, 409); assert.deepEqual(await f.store.get(p.id), p);
    // A separate project demonstrates a run that appears after its startup intent was saved.
    let other = await parseAll(f, await upload(f, await f.create())); other = (await start(f, other)).project;
    other = await use(f, other); other = await f.write(other, 'runs', { skill: 'extract-facts' });
    const waiting = (await status(f, other)).startup!;
    assert.equal(waiting.state, 'awaiting_existing_run'); assert.equal(waiting.runId, null);
    assert.ok(waiting.prerequisites.some(item => item.code === 'RUN_ALREADY_ACTIVE'));
    assert.equal((await f.post(path(other, 'continue-extraction'), command(other))).json().error.code, 'RUN_ALREADY_ACTIVE');
    assert.deepEqual(await f.store.get(other.id), other);
  } finally { await f.close(); }
});

test('a startup scope excludes later originals and independent evidence, including model outputs referencing those excluded sources', async () => {
  const f = await fixture(catalog, synthetic);
  try {
    let p = await upload(f, await f.create()); const originalId = p.production!.materials![0]!.id;
    p = (await start(f, p)).project;
    p = await independentEvidence(f, p, 'Synthetic excluded source: 10 kg'); const excludedEvidenceId = p.evidence[0]!.id;
    p = await upload(f, p, 'later.txt', 'Later synthetic material: 10 kg'); const laterId = p.production!.materials![1]!.id;
    p = await parseAll(f, p); p = await use(f, p, originalId); p = await use(f, p, laterId);
    const waiting = (await status(f, p)).startup!;
    assert.deepEqual(waiting.excludedMaterialIds, [laterId]); assert.deepEqual(waiting.excludedManualEvidenceIds, [excludedEvidenceId]);
    const queued = await resume(f, p); p = queued.project;
    const selected = p.evidence.find(e => e.materialSource?.materialId === originalId)!;
    assert.deepEqual(queued.startup.evidenceIds, [selected.id]);
    await new Worker(f.store, { generate: async (skill, project, _observe, run) => {
      const input = JSON.parse(buildStructuredRequest(skill, project, 'synthetic-scope', 1000, run).messages[1]!.content);
      assert.deepEqual(input.evidence.map((item: { id: string }) => item.id), [selected.id]);
      assert.equal(JSON.stringify(input).includes('excluded source'), false); assert.equal(JSON.stringify(input).includes('Later synthetic'), false);
      return output(excludedEvidenceId);
    } }).tick();
    p = await f.store.get(p.id);
    assert.equal(p.runs[0]!.errorCode, 'INVALID_EVIDENCE_REFERENCE'); assert.deepEqual(p.facts, []);
    const continued = await resume(f, p); assert.equal(continued.startup.state, 'failed'); assert.equal(continued.startup.retryRunId, p.runs[0]!.id);
    assert.deepEqual(continued.project, p); assert.equal(p.runs.length, 1);
  } finally { await f.close(); }
});

test('all failed originals recover by reviewed append-only scope refresh, with old hashes/history retained and no implicit enqueue', async () => {
  const f = await fixture(catalog, synthetic);
  try {
    let p = await parseAll(f, await upload(f, await f.create(), 'broken.json', '{not valid json'));
    const failed = structuredClone(p.production!.materials![0]!);
    assert.equal(failed.parse.runStatus, 'failed');
    const started = await start(f, p); p = started.project;
    assert.equal(started.startup.state, 'awaiting_product_evidence'); assert.equal(started.startup.runId, null);
    p = await upload(f, p, 'corrected.txt', 'Corrected synthetic capacity: 10 kg');
    const correctedId = p.production!.materials![1]!.id;
    const proposal = (await status(f, p)).startup!.scopeRefresh;
    assert.equal(proposal.canRefresh, true); assert.deepEqual(proposal.addedMaterialIds, [correctedId]);
    assert.deepEqual(proposal.retainedMaterialIds, [failed.id]);
    assert.deepEqual((await resume(f, p)).project, p, 'unreviewed additions do not silently become startup input');
    const before = structuredClone(p); const beforeCounts = await counts(f);
    const wrong = await f.post(path(p, 'scope-refresh'), command(p, { inputFingerprint: '0'.repeat(64), reason: 'Reviewed additions' }));
    assert.equal(wrong.json().error.code, 'STARTUP_SCOPE_CHECK_CHANGED');
    assert.deepEqual(await f.store.get(p.id), before); assert.deepEqual(await counts(f), beforeCounts);
    const body = command(p, { inputFingerprint: proposal.inputFingerprint, reason: 'Employee reviewed replacement original after parse failure' });
    const refreshed = await f.post(path(p, 'scope-refresh'), body); assert.equal(refreshed.statusCode, 200, refreshed.body);
    const accepted = refreshed.json<StartupCommandResponse>(); p = accepted.project;
    assert.equal(p.runs.length, 0); assert.equal(p.production!.startup!.scope.version, 2);
    assert.deepEqual(p.production!.materials!.find(item => item.id === failed.id), failed);
    const history = p.production!.startup!.history.at(-1)!;
    assert.equal(history.type, 'scope_refreshed'); assert.equal(history.actor, 'test-human');
    assert.deepEqual(history.addedMaterialIds, [correctedId]); assert.equal(history.scopeSha256, startupHash(p.production!.startup!.scope));
    assert.notEqual(history.previousScopeSha256, history.scopeSha256);
    const noAdditions = (await status(f, p)).startup!.scopeRefresh;
    const noop = await f.post(path(p, 'scope-refresh'), command(p, { inputFingerprint: noAdditions.inputFingerprint, reason: 'Checked again' }));
    assert.deepEqual(noop.json<StartupCommandResponse>().project, p);
    p = await parseAll(f, p); p = await use(f, p, correctedId);
    p = (await resume(f, p)).project; assert.equal(p.runs.length, 1);
    const selected = p.evidence.find(item => item.materialSource?.materialId === correctedId)!;
    assert.deepEqual(p.runs[0]!.startupInput!.evidence.map(ref => ref.id), [selected.id]);
    assert.deepEqual((await f.post(path(p, 'scope-refresh'), body)).json(), accepted);
    const locked = await f.post(path(p, 'scope-refresh'), command(p, { inputFingerprint: (await status(f, p)).startup!.scopeRefresh.inputFingerprint, reason: 'Cannot change queued scope' }));
    assert.equal(locked.json().error.code, 'STARTUP_SCOPE_LOCKED');
  } finally { await f.close(); }
});

test('partial parse failures do not block eligible evidence and an identical active P is reused without rewriting its snapshot', async () => {
  const f = await fixture(catalog, synthetic);
  try {
    let p = await upload(f, await f.create(), 'bad.json', '{invalid');
    p = await upload(f, p, 'good.txt'); p = await parseAll(f, p);
    const good = p.production!.materials!.find(material => material.fileName === 'good.txt')!;
    p = await use(f, p, good.id);
    p = await f.write(p, 'production/context/draft', { context }); p = await f.write(p, 'production/context/activate');
    const old = structuredClone(p.production!.context!.versions[0]!);
    p = await f.write(p, 'production/context/draft', { context: { productBrief: { productName: 'Unsubmitted draft' } } });
    const check = await checked(f, p, context);
    assert.equal(check.statistics.parseFailed, 1); assert.equal(check.canQueueExtraction, true); assert.equal(check.canStart, true);
    assert.ok(check.suggestions.some(item => item.code === 'MATERIAL_PARSE_FAILED'));
    const started = await start(f, p, context); p = started.project;
    assert.equal(p.production!.context!.versions.length, 1); assert.deepEqual(p.production!.context!.versions[0], old);
    assert.equal(p.production!.context!.draft, undefined); assert.equal(started.startup.state, 'queued');
    assert.equal(p.runs[0]!.startupInput!.evidence.length, 1);
    assert.equal(p.production!.materials!.find(material => material.fileName === 'bad.json')!.parse.runStatus, 'failed');
  } finally { await f.close(); }
});

test('startup source, identity and P changes are rechecked before dispatch and before accepting in-flight output', async () => {
  for (const change of ['source', 'identity', 'context', 'inflight_context'] as const) {
    const f = await fixture(catalog, synthetic);
    try {
      let p = await use(f, await parseAll(f, await upload(f, await f.create())));
      p = (await start(f, p)).project; let calls = 0;
      const mutate = async (snapshot: Project) => {
        if (change === 'source') return use(f, snapshot, snapshot.production!.materials![0]!.id, 'reference');
        if (change === 'identity') return f.write(snapshot, 'identity/correct', { productName: 'Explicitly corrected identity', reason: 'Employee changed product after startup' });
        let edited = await f.write(snapshot, 'production/context/draft', { context: { ...scopedContext,
          productBrief: { ...scopedContext.productBrief, introduction: 'Explicitly changed context after startup' } } });
        edited = await f.write(edited, 'production/context/activate'); return edited;
      };
      if (change !== 'inflight_context') p = await mutate(p);
      await new Worker(f.store, { generate: async (_skill, snapshot, _observe, run) => {
        calls++; if (change === 'inflight_context') await mutate(snapshot);
        return output(run!.startupInput!.evidence[0]!.id);
      } }).tick();
      p = await f.store.get(p.id);
      assert.equal(calls, change === 'inflight_context' ? 1 : 0, change);
      assert.equal(p.runs[0]!.runStatus, 'failed'); assert.deepEqual(p.facts, []);
      assert.equal(p.runs[0]!.errorCode, change === 'source' ? 'STARTUP_EVIDENCE_CHANGED' : change === 'identity' ? 'STARTUP_IDENTITY_CHANGED' : 'STARTUP_CONTEXT_CHANGED');
      const retry = await f.post(`/api/projects/${p.id}/runs/${p.runs[0]!.id}/retry`, command(p));
      assert.equal(retry.statusCode, 409); assert.deepEqual(await f.store.get(p.id), p);
    } finally { await f.close(); }
  }
});

test('a failed startup requires explicit retry of its original run and still respects trusted execution availability', async () => {
  const f = await fixture(catalog, synthetic);
  const disabled = buildApp(f.store, f.objects, { actor: 'test-human', token: f.headers.authorization.slice(7), productionCatalog: catalog });
  try {
    let p = (await start(f, await independentEvidence(f, await f.create()))).project;
    const id = p.runs[0]!.id;
    await new Worker(f.store, { generate: async () => { throw new Error('Synthetic temporary failure'); } }).tick();
    p = await f.store.get(p.id); const continued = await resume(f, p);
    assert.equal(continued.startup.state, 'failed'); assert.equal(continued.startup.retryRunId, id); assert.deepEqual(continued.project, p);
    const rejected = await disabled.inject({ method: 'POST', url: `/api/projects/${p.id}/runs/${id}/retry`, headers: f.headers, payload: command(p) });
    assert.equal(rejected.statusCode, 503); assert.deepEqual(await f.store.get(p.id), p);
    p = await f.write(p, `runs/${id}/retry`); assert.equal(p.runs.length, 1); assert.equal(p.runs[0]!.id, id);
    await new Worker(f.store, { generate: async (_skill, _project, _observe, run) => output(run!.startupInput!.evidence[0]!.id) }).tick();
    p = await f.store.get(p.id); assert.equal(p.runs.length, 1); assert.equal(p.runs[0]!.attempt, 2);
    assert.equal(p.runs[0]!.runStatus, 'succeeded'); assert.equal(p.facts[0]!.status, 'candidate');
    assert.equal((await status(f, p)).startup!.state, 'succeeded');
  } finally { await disabled.close(); await f.close(); }
});

test('startup capability validates local configuration without external requests and never exposes credentials as readiness', () => {
  const modelConfig = { apiKey: 'synthetic-secret-not-real', model: 'synthetic/model', provider: 'synthetic-provider', timeoutMs: 60_000,
    maxInputTokens: 16000, maxOutputTokens: 1000, maxCostUsd: 0.1, acceptEstimatedBudget: true };
  const good: StartupExecutionConfig = { mode: 'openrouter', workerEnabled: true, modelConfig };
  assert.equal(startupExecutionCapability().status, 'unavailable');
  assert.equal(startupExecutionCapability({ ...good, workerEnabled: false }).code, 'MODEL_WORKER_UNAVAILABLE');
  assert.equal(startupExecutionCapability({ ...good, modelConfig: { ...modelConfig, apiKey: undefined } }).code, 'MODEL_NOT_CONFIGURED');
  assert.equal(startupExecutionCapability({ ...good, modelConfig: { ...modelConfig, provider: undefined } }).code, 'MODEL_POLICY_NOT_CONFIGURED');
  assert.equal(startupExecutionCapability({ ...good, modelConfig: { ...modelConfig, acceptEstimatedBudget: false } }).code, 'MODEL_POLICY_NOT_CONFIGURED');
  const configured = startupExecutionCapability(good);
  assert.equal(configured.status, 'configured'); assert.equal(configured.dispatchPreflight, 'not_performed');
  assert.equal(JSON.stringify(configured).includes(modelConfig.apiKey), false);
  assert.equal(startupExecutionCapability(synthetic).status, 'synthetic');
});
