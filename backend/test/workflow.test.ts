import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, command, extraction, plan } from './helpers.js';
import { Worker } from '../src/worker.js';
import type { Project } from '../src/contracts.js';
import { OpenRouter } from '../src/openrouter.js';

let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
after(async () => { await f?.close(); });
async function extracted(text = 'Capacity: 10 kg. Alternate label: 20 kg.') {
  let p = await f.create();
  p = await f.write(p, 'evidence', { documentName: 'spec.txt', locator: 'page 1', usage: 'product_evidence', text });
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async (_skill, p) => extraction(p) }).tick();
  return f.store.get(p.id);
}
async function planned() {
  let p = await extracted();
  p = await f.write(p, 'identity/confirm', { productName: '测试支架' });
  p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: '已核对规格书原文' });
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  await new Worker(f.store, { generate: async (_skill, p) => plan(p) }).tick();
  return f.store.get(p.id);
}

test('stage A: evidence -> single human confirmation -> diagnostic draft -> preflight, never approval/export', async () => {
  let p = await planned();
  assert.equal(p.sections.length, 1);
  assert.equal(p.facts[0]!.locked, true);
  assert.equal(p.facts[0]!.confirmedBy, 'test-human');
  assert.equal(p.evidence[0]!.text.slice(p.facts[0]!.start, p.facts[0]!.end), p.facts[0]!.quote);
  assert.equal(p.storyboard!.approvalStatus, 'draft');
  assert.equal(p.sections[0]!.kind, 'diagnostic_draft');
  assert.equal(p.sections[0]!.approvalStatus, 'draft');
  assert.equal(p.version, 3, 'only create/identity/fact confirmation create business versions');
  p = await f.write(p, 'qa/preflight');
  assert.equal(p.qa!.issueSeverity, 'none');
  assert.equal(p.qa!.exportAllowed, false);
  assert.ok(p.qa!.notChecked.includes('rendered_file'));
  const response = await f.post(`/api/projects/${p.id}/export`, command(p));
  assert.equal(response.statusCode, 404);
  const snapshot = await f.app.inject({ url: `/api/projects/${p.id}/revisions/1`, headers: f.headers });
  assert.equal(snapshot.json<Project>().facts.length, 0);
});

test('idempotent replay returns original snapshot; key reuse and stale versions reject without new revision', async () => {
  const p = await f.create();
  const body = command(p, { productName: '支架' });
  const url = `/api/projects/${p.id}/identity/confirm`;
  const a = await f.post(url, body);
  const b = await f.post(url, body);
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.json(), b.json());
  assert.equal((await f.post(url, { ...body, productName: 'other' })).json().error.code, 'IDEMPOTENCY_CONFLICT');
  const stale = await f.post(url, { ...body, idempotencyKey: randomUUID() });
  assert.equal(stale.json().error.code, 'VERSION_CONFLICT');
  assert.equal(stale.json().error.details.currentProjectVersion, 2);
  assert.equal((await f.store.get(p.id)).revision, 2);
});

test('concurrent commands with same revision have one winner', async () => {
  const p = await f.create();
  const results = await Promise.all([f.post(`/api/projects/${p.id}/qa/preflight`, command(p)), f.post(`/api/projects/${p.id}/qa/preflight`, command(p))]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal((await f.store.get(p.id)).version, 1);
});

test('human identity gate and auth cannot be bypassed using body actorType', async () => {
  let p = await extracted();
  p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: '核实' });
  assert.equal((await f.post(`/api/projects/${p.id}/runs`, command(p, { skill: 'plan-section' }))).json().error.code, 'CONFIRMED_PRODUCT_IDENTITY_REQUIRED');
  const unauthorized = await f.app.inject({ method: 'POST', url: `/api/projects/${p.id}/identity/confirm`, payload: { ...command(p), productName: 'forged', actorType: 'human' } });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal((await f.post(`/api/projects/${p.id}/identity/confirm`, { ...command(p), productName: 'forged', actorType: 'human' })).statusCode, 400);
});

test('references and undeclared fields cannot enter evidence', async () => {
  const p = await f.create();
  assert.equal((await f.post(`/api/projects/${p.id}/evidence`, command(p, { documentName: 'competitor', locator: 'page1', usage: 'reference', text: '10 kg' }))).statusCode, 400);
});

test('invalid model schema/reference fails only its run and preserves existing artifacts; retry stays on same run', async () => {
  let p = await planned();
  const oldSections = structuredClone(p.sections);
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  const runId = p.runs.at(-1)!.id;
  await new Worker(f.store, { generate: async () => ({ ...plan(p), approved: true }) }).tick();
  p = await f.store.get(p.id);
  assert.equal(p.runs.at(-1)!.errorCode, 'INVALID_MODEL_OUTPUT');
  assert.deepEqual(p.sections, oldSections);
  p = await f.write(p, `runs/${runId}/retry`);
  await new Worker(f.store, { generate: async () => ({ chapters: [{ role: 'feature', purpose: 'x', factIds: [randomUUID()] }], section: { purpose: 'x', factIds: [randomUUID()], missingInputs: [] } }) }).tick();
  p = await f.store.get(p.id);
  assert.equal(p.runs.at(-1)!.errorCode, 'UNCONFIRMED_FACT_REFERENCE');
  assert.equal(p.runs.at(-1)!.id, runId);
  assert.equal(p.runs.at(-1)!.attempt, 2);
  assert.deepEqual(p.sections, oldSections);
});

test('forged evidence quote causes atomic rejection of entire extraction', async () => {
  let p = await f.create();
  p = await f.write(p, 'evidence', { documentName: 'spec', locator: 'p1', usage: 'product_evidence', text: '10 kg' });
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async () => ({ facts: [...extraction(p).facts, { ...extraction(p).facts[0], quote: 'fabricated' }] }) }).tick();
  p = await f.store.get(p.id);
  assert.equal(p.facts.length, 0);
  assert.equal(p.runs[0]!.errorCode, 'INVALID_EVIDENCE_REFERENCE');
});

test('new conflicts do not overwrite locked values; require explicit human rejection', async () => {
  let p = await planned();
  const oldFact = structuredClone(p.facts[0]!);
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async () => extraction(p, '20 kg') }).tick();
  p = await f.store.get(p.id);
  assert.equal(p.facts[0]!.value, oldFact.value);
  assert.equal(p.facts[0]!.locked, true);
  assert.equal(p.facts[0]!.issueSeverity, 'blocker');
  assert.equal((await f.post(`/api/projects/${p.id}/facts/${p.facts[1]!.id}/confirm`, command(p, { reason: 'cannot resolve automatically' }))).statusCode, 409);
  p = await f.write(p, 'qa/preflight');
  assert.equal(p.qa!.issueSeverity, 'blocker');
  p = await f.write(p, `facts/${p.facts[1]!.id}/reject`, { reason: '备用标签不适用于此型号' });
  assert.equal(p.facts[0]!.issueSeverity, 'none');
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async () => extraction(p, '20 kg') }).tick();
  p = await f.store.get(p.id);
  assert.equal(p.facts.length, 2);
  assert.equal(p.facts[1]!.status, 'rejected');
});

test('input changed during model execution rejects stale output', async () => {
  let p = await extracted();
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async (_skill, snapshot) => {
    await f.write(snapshot, 'identity/confirm', { productName: 'new context' });
    return extraction(snapshot, '20 kg');
  } }).tick();
  p = await f.store.get(p.id);
  assert.equal(p.runs.at(-1)!.errorCode, 'STALE_INPUT');
  assert.equal(p.runs.at(-1)!.freshness, 'stale');
  assert.equal(p.facts.length, 1);
});

test('explicit retraction propagates stale only to dependent sections and preserves history', async () => {
  let p = await planned();
  // Construct a second valid, unrelated dependency through the same domain APIs.
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async () => ({ facts: [{ ...extraction(p).facts[0], attribute: 'secondary', value: '20 kg', quote: '20 kg' }] }) }).tick();
  p = await f.store.get(p.id);
  p = await f.write(p, `facts/${p.facts[1]!.id}/confirm`, { reason: '核对第二参数' });
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  await new Worker(f.store, { generate: async () => plan({ ...p, facts: [p.facts[1]!] }) }).tick();
  p = await f.store.get(p.id);
  p = await f.write(p, `storyboard/candidates/${p.storyboardCandidates!.at(-1)!.id}/apply`, { reason: '选择新候选' });
  const second = structuredClone(p.sections[1]);
  p = await f.write(p, `facts/${p.facts[0]!.id}/retract`, { reason: '人工撤回错误参数' });
  assert.equal(p.sections[0]!.freshness, 'stale');
  assert.deepEqual(p.sections[1], second);
  assert.equal(p.storyboard!.freshness, 'current');
});

test('expired worker lease becomes retryable failure; late result cannot commit', async () => {
  let p = await extracted();
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  const job = await f.store.claim();
  assert.ok(job);
  const { project, run } = job;
  await f.db.query(`UPDATE projects SET state=jsonb_set(state, ARRAY['runs', $2, 'leaseUntil'], to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1`, [project.id, String(project.runs.length - 1)]);
  await f.store.claim();
  p = await f.store.get(p.id);
  assert.equal(p.runs.at(-1)!.errorCode, 'WORKER_INTERRUPTED');
  await f.store.finish(p.id, run.id, run.attempt, () => { throw new Error('late result must not be applied'); });
  p = await f.write(p, `runs/${run.id}/retry`);
  await new Worker(f.store, { generate: async () => extraction(p) }).tick();
  assert.equal((await f.store.get(p.id)).runs.at(-1)!.runStatus, 'succeeded');
});

test('missing OpenRouter configuration fails explicitly; no mock-success fallback', async () => {
  let p = await extracted();
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, new OpenRouter({ timeoutMs: 100 })).tick();
  p = await f.store.get(p.id);
  assert.equal(p.runs.at(-1)!.errorCode, 'MODEL_NOT_CONFIGURED');
  assert.equal(p.facts.length, 1);
});

test('valid replacement draft recovers preflight while old stale draft remains in history', async () => {
  let p = await planned();
  p = await f.write(p, `facts/${p.facts[0]!.id}/retract`, { reason: '原参数已撤回' });
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async () => extraction(p, '20 kg') }).tick();
  p = await f.store.get(p.id);
  p = await f.write(p, `facts/${p.facts[1]!.id}/confirm`, { reason: '核对替代参数' });
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  await new Worker(f.store, { generate: async () => plan(p) }).tick();
  p = await f.store.get(p.id);
  p = await f.write(p, 'qa/preflight');
  assert.equal(p.sections[0]!.freshness, 'stale');
  assert.equal(p.sections[1]!.freshness, 'current');
  assert.equal(p.qa!.issueSeverity, 'blocker');
  p = await f.write(p, `storyboard/candidates/${p.storyboardCandidates!.at(-1)!.id}/apply`, { reason: '人工选择替代草稿' });
  p = await f.write(p, 'qa/preflight');
  assert.equal(p.qa!.sectionId, p.sections[1]!.id);
  assert.equal(p.qa!.issueSeverity, 'none');
});

test('chapter count is dynamic rather than limited to the six-chapter golden sample', async () => {
  let p = await planned();
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  await new Worker(f.store, { generate: async () => ({ ...plan(p), chapters: Array.from({ length: 7 }, () => plan(p).chapters[0]) }) }).tick();
  p = await f.store.get(p.id);
  assert.equal(p.runs.at(-1)!.runStatus, 'succeeded');
  assert.equal(p.storyboard!.chapters.length, 1);
  assert.equal(p.storyboardCandidates!.at(-1)!.chapters.length, 7);
  p = await f.write(p, `storyboard/candidates/${p.storyboardCandidates!.at(-1)!.id}/apply`, { reason: '人工选择七章方案' });
  assert.equal(p.storyboard!.chapters.length, 7);
  assert.equal(p.storyboard!.approvalStatus, 'draft');
});

test('manual correction creates a linked candidate without mutating locked value or business version', async () => {
  let p = await planned(); const old = structuredClone(p.facts[0]!); const version = p.version;
  const url = `/api/projects/${p.id}/facts/candidates`;
  const body = command(p, { attribute: 'corrected-capacity-label', role: 'core', value: '20 kg', evidenceId: p.evidence[0]!.id,
    quote: '20 kg', correctsFactId: old.id, reason: '重新核对原始规格' });
  const a = await f.post(url, body); const b = await f.post(url, body);
  assert.equal(a.statusCode, 200); assert.deepEqual(a.json(), b.json()); p = a.json<Project>();
  assert.equal(p.version, version); assert.equal(p.facts[0]!.value, old.value); assert.equal(p.facts[0]!.locked, true);
  assert.equal(p.facts[0]!.quote, old.quote); assert.equal(p.facts[1]!.correctsFactId, old.id);
  assert.equal(p.facts[1]!.status, 'candidate'); assert.equal(p.facts[1]!.createdBy, 'test-human');
  assert.equal(p.facts[0]!.issueSeverity, 'blocker', 'linked correction conflicts even if attribute label changes');
  assert.equal((await f.post(`/api/projects/${p.id}/facts/${p.facts[1]!.id}/confirm`, command(p, { reason: '不能绕过冲突' }))).statusCode, 409);
  p = await f.write(p, `facts/${old.id}/retract`, { reason: '逐条撤回旧值' });
  p = await f.write(p, `facts/${p.facts[1]!.id}/confirm`, { reason: '逐条确认新值' });
  assert.equal(p.version, version + 2); assert.equal(p.facts[0]!.value, '10 kg'); assert.equal(p.facts[1]!.locked, true);
  const historical = await f.app.inject({ url: `/api/projects/${p.id}/revisions/${body.expectedRevision}`, headers: f.headers });
  assert.equal(historical.json<Project>().facts[0]!.status, 'confirmed'); assert.equal(historical.json<Project>().facts.length, 1);
});

test('manual candidate strict schema, precise quotes, concurrent revision and no business version on reject', async () => {
  let p = await extracted();
  const base = { attribute: 'capacity', role: 'core', value: '20 kg', evidenceId: p.evidence[0]!.id, quote: '20 kg', reason: '补充' };
  const url = `/api/projects/${p.id}/facts/candidates`;
  assert.equal((await f.post(url, command(p, { ...base, quote: 'invented' }))).json().error.code, 'INVALID_EVIDENCE_REFERENCE');
  assert.equal((await f.post(url, command(p, { ...base, actor: 'forged' }))).statusCode, 400);
  assert.equal((await f.post(url, command(p, { ...base, locked: true }))).statusCode, 400);
  const results = await Promise.all([f.post(url, command(p, base)), f.post(url, command(p, base))]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  p = await f.store.get(p.id); const version = p.version;
  p = await f.write(p, `facts/${p.facts[1]!.id}/reject`, { reason: '暂不使用' });
  assert.equal(p.version, version);
});

test('manual order and Section edits are preserved across model completion until explicit candidate apply', async () => {
  let p = await planned(); const version = p.version; const originalId = p.currentSectionId!;
  p = await f.write(p, 'storyboard/draft', { chapters: Array.from({ length: 3 }, (_, i) => ({ ...plan(p).chapters[0], purpose: `员工章节${i}` })), reason: '调整章节数量和次序' });
  p = await f.write(p, `sections/${originalId}/draft`, { ...plan(p).section, purpose: '员工选择的表达目的', missingInputs: ['等待补充尺寸'], reason: '记录人工缺口' });
  const manual = structuredClone(p.storyboard); const manualSection = structuredClone(p.sections.at(-1)!); const manualId = p.currentSectionId;
  assert.equal(p.version, version); assert.equal(p.sections[0]!.purpose, '参数证据草稿');
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  await new Worker(f.store, { generate: async (_skill, p) => plan(p) }).tick(); p = await f.store.get(p.id);
  assert.deepEqual(p.storyboard, manual); assert.equal(p.currentSectionId, manualId);
  assert.deepEqual(p.sections.find(s => s.id === manualId), manualSection);
  p = await f.write(p, 'qa/preflight'); assert.equal(p.qa!.sectionId, manualId); assert.equal(p.qa!.issueSeverity, 'blocker');
  const candidateId = p.storyboardCandidates!.at(-1)!.id!;
  const request = command(p, { reason: '逐项复核后选用新草稿' });
  const applied = await f.post(`/api/projects/${p.id}/storyboard/candidates/${candidateId}/apply`, request);
  assert.equal(applied.statusCode, 200); p = applied.json<Project>();
  assert.notEqual(p.currentSectionId, manualId); assert.equal(p.storyboard!.id, candidateId);
  p = await f.write(p, 'qa/preflight'); assert.equal(p.qa!.issueSeverity, 'none');
  assert.equal((await f.post(`/api/projects/${p.id}/storyboard/candidates/${candidateId}/apply`, { ...request, idempotencyKey: randomUUID() })).json().error.code, 'REVISION_CONFLICT');
});

test('identity correction preserves history and invalidates dependent drafts; stale candidates cannot be applied', async () => {
  let p = await planned(); const oldRevision = p.revision; const oldCandidate = p.storyboardCandidates![0]!.id!; const section = p.currentSectionId!;
  p = await f.write(p, 'identity/correct', { productName: '测试支架（标准型号）', reason: '修正当前商品名称' });
  assert.equal(p.identityRevision, 2); assert.equal(p.storyboard!.freshness, 'stale'); assert.equal(p.sections[0]!.freshness, 'stale');
  assert.equal((await f.post(`/api/projects/${p.id}/storyboard/candidates/${oldCandidate}/apply`, command(p, { reason: '旧稿不能复活' }))).json().error.code, 'STALE_STORYBOARD');
  assert.equal((await f.post(`/api/projects/${p.id}/sections/${section}/select`, command(p, { reason: '旧稿不能复活' }))).json().error.code, 'STALE_SECTION');
  const old = await f.app.inject({ url: `/api/projects/${p.id}/revisions/${oldRevision}`, headers: f.headers });
  assert.equal(old.json<Project>().identity!.productName, '测试支架');
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  await new Worker(f.store, { generate: async (_skill, p) => plan(p) }).tick(); p = await f.store.get(p.id);
  p = await f.write(p, `storyboard/candidates/${p.storyboardCandidates!.at(-1)!.id}/apply`, { reason: '复核修正后的身份依赖' });
  p = await f.write(p, 'qa/preflight'); assert.equal(p.qa!.issueSeverity, 'none');
});

test('Section selection is explicit, rejects revoked dependencies and preflights selected historical draft', async () => {
  let p = await planned(); const originalId = p.currentSectionId!;
  p = await f.write(p, `sections/${originalId}/draft`, { ...plan(p).section, missingInputs: ['补充证据'], reason: '增加缺口' });
  const editedId = p.currentSectionId!;
  p = await f.write(p, `sections/${originalId}/select`, { reason: '选择先前可检查草稿' });
  assert.equal(p.currentSectionId, originalId);
  p = await f.write(p, 'qa/preflight'); assert.equal(p.qa!.issueSeverity, 'none');
  p = await f.write(p, `sections/${editedId}/select`, { reason: '选择当前人工草稿' });
  p = await f.write(p, 'qa/preflight'); assert.equal(p.qa!.issueSeverity, 'blocker');
  p = await f.write(p, `facts/${p.facts[0]!.id}/retract`, { reason: '撤回依赖' });
  assert.equal((await f.post(`/api/projects/${p.id}/sections/${originalId}/select`, command(p, { reason: '不能复活撤回依赖' }))).json().error.code, 'CONFIRMED_CORE_FACT_REQUIRED');
});

test('model usage survives stale Domain commit and attempts retain independent observations', async () => {
  let p = await extracted(); p = await f.write(p, 'runs', { skill: 'extract-facts' });
  const observed = { attempt: 0, requestedModel: 'test/model', requestedProvider: 'test', actualModel: 'test/model', actualProvider: 'Test',
    requestIdSha256: 'a'.repeat(64), requestSha256: 'b'.repeat(64), capabilitiesSha256: 'c'.repeat(64), dispatched: true,
    latencyMs: 12, inputTokens: 10, outputTokens: 20, costUsd: 0.1, estimatedCostUsd: 0.2, finishReason: 'stop' };
  await new Worker(f.store, { generate: async (_skill, snapshot, observe) => {
    observe?.(observed); await f.write(snapshot, 'identity/confirm', { productName: '修改输入' }); return extraction(snapshot, '20 kg');
  } }).tick(); p = await f.store.get(p.id);
  const runId = p.runs.at(-1)!.id;
  assert.equal(p.runs.at(-1)!.errorCode, 'STALE_INPUT'); assert.equal(p.runs.at(-1)!.observations![0]!.costUsd, 0.1);
  assert.ok(p.runs.at(-1)!.output); assert.equal(p.facts.length, 1);
  p = await f.write(p, `runs/${runId}/retry`);
  await new Worker(f.store, { generate: async (_skill, snapshot, observe) => { observe?.({ ...observed, costUsd: 0.2 }); return extraction(snapshot); } }).tick();
  p = await f.store.get(p.id); assert.deepEqual(p.runs.at(-1)!.observations!.map(o => [o.attempt, o.costUsd]), [[1, 0.1], [2, 0.2]]);
});

test('late generation usage is retained without resurrecting an interrupted run', async () => {
  let p = await extracted(); p = await f.write(p, 'runs', { skill: 'extract-facts' });
  const job = (await f.store.claim())!;
  await f.db.query(`UPDATE projects SET state=jsonb_set(state, ARRAY['runs', $2, 'leaseUntil'], to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1`, [p.id, String(job.project.runs.length - 1)]);
  await f.store.claim();
  const observed = { attempt: 0, requestedModel: 'test/model', requestedProvider: 'test', actualModel: 'test/model', actualProvider: 'Test',
    requestIdSha256: null, requestSha256: null, capabilitiesSha256: null, dispatched: true, latencyMs: 12,
    inputTokens: 10, outputTokens: 20, costUsd: 0.1, estimatedCostUsd: 0.2, finishReason: 'stop' };
  await f.store.finish(p.id, job.run.id, job.run.attempt, () => { throw new Error('must not apply late output'); }, observed);
  p = await f.store.get(p.id);
  assert.equal(p.runs.at(-1)!.errorCode, 'WORKER_INTERRUPTED'); assert.equal(p.runs.at(-1)!.observations![0]!.costUsd, 0.1);
  assert.equal(p.facts.length, 1);
});

test('API contracts publish strict manual schemas and draft writes do not approve', async () => {
  const contracts = await f.app.inject({ url: '/api/contracts', headers: f.headers });
  for (const name of ['factCandidate', 'identityCorrection', 'storyboardEdit', 'sectionEdit', 'candidateApply', 'sectionSelect']) {
    assert.equal(contracts.json().requests[name].additionalProperties, false);
    assert.ok(contracts.json().requests[name].required.includes('reason'));
  }
  let p = await planned();
  const bad = await f.post(`/api/projects/${p.id}/storyboard/draft`, command(p, { chapters: plan(p).chapters, reason: '人工保存', approved: true }));
  assert.equal(bad.statusCode, 400);
  const unknown = await f.post(`/api/projects/${p.id}/sections/${p.currentSectionId}/draft`, command(p, { ...plan(p).section, factIds: [randomUUID()], reason: '非法依赖' }));
  assert.equal(unknown.json().error.code, 'UNCONFIRMED_FACT_REFERENCE');
});

test('late attempt metadata during retry does not stale new input, while revision-only upstream edits still do', async () => {
  for (const changeInput of [false, true]) {
    let p = await extracted(); p = await f.write(p, 'runs', { skill: 'extract-facts' });
    const old = (await f.store.claim())!;
    await f.db.query(`UPDATE projects SET state=jsonb_set(state, ARRAY['runs', $2, 'leaseUntil'], to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1`, [p.id, String(old.project.runs.length - 1)]);
    await f.store.claim(); p = await f.store.get(p.id);
    p = await f.write(p, `runs/${old.run.id}/retry`);
    const observed = { attempt: 0, requestedModel: 'test/model', requestedProvider: 'test', actualModel: 'test/model', actualProvider: 'Test',
      requestIdSha256: null, requestSha256: null, capabilitiesSha256: null, dispatched: true, latencyMs: 12,
      inputTokens: 10, outputTokens: 20, costUsd: 0.1, estimatedCostUsd: 0.2, finishReason: 'stop' };
    let claimedInputRevision: number | undefined;
    await new Worker(f.store, { generate: async (_skill, snapshot, observe) => {
      claimedInputRevision = snapshot.inputRevision;
      await f.store.finish(p.id, old.run.id, old.run.attempt, () => { throw new Error('old business output must never apply'); }, observed);
      const afterObservation = await f.store.get(p.id);
      assert.ok(afterObservation.revision > snapshot.revision);
      assert.equal(afterObservation.inputRevision, snapshot.inputRevision);
      if (changeInput) {
        const changed = await f.write(afterObservation, 'evidence', { documentName: 'supplement', locator: 'p2', usage: 'product_evidence', text: 'new source' });
        assert.equal(changed.version, snapshot.version, 'regression must exercise a revision-only upstream change');
        assert.notEqual(changed.inputRevision, snapshot.inputRevision);
      }
      observe?.(observed); return extraction(snapshot, '20 kg');
    } }).tick();
    p = await f.store.get(p.id); const run = p.runs.at(-1)!;
    assert.equal(run.contextInputRevision, claimedInputRevision);
    assert.deepEqual(run.observations!.map(o => o.attempt), [1, 2]);
    assert.equal(run.runStatus, changeInput ? 'failed' : 'succeeded');
    assert.equal(run.errorCode, changeInput ? 'STALE_INPUT' : undefined);
    assert.equal(p.facts.length, changeInput ? 1 : 2);
  }
});

test('manual storyboard before first model Section leaves explicit empty selection until apply', async () => {
  let p = await extracted();
  p = await f.write(p, 'identity/confirm', { productName: '测试支架' });
  p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: '人工核对测试事实' });
  p = await f.write(p, 'storyboard/draft', { chapters: [{ ...plan(p).chapters[0], purpose: '人工优先顺序' }], reason: '先保存人工顺序' });
  const manualId = p.storyboard!.id;
  for (let i = 0; i < 2; i++) {
    p = await f.write(p, 'runs', { skill: 'plan-section' });
    await new Worker(f.store, { generate: async (_skill, snapshot) => plan(snapshot) }).tick();
    p = await f.store.get(p.id);
    assert.equal(p.currentSectionId, null);
    p = await f.write(p, 'qa/preflight');
    assert.equal(p.storyboard!.id, manualId);
    assert.equal(p.qa!.sectionId, undefined);
    assert.equal(p.qa!.issueSeverity, 'blocker');
    assert.ok(p.qa!.issues.includes('SECTION_SELECTION_REQUIRED'));
  }
  p = await f.write(p, `storyboard/candidates/${p.storyboardCandidates!.at(-1)!.id}/apply`, { reason: '明确采用模型候选顺序和Section' });
  p = await f.write(p, 'qa/preflight');
  assert.equal(p.qa!.issueSeverity, 'none'); assert.ok(p.currentSectionId);
});

test('legacy Section selection requires same generation and facts inside the current storyboard', async () => {
  let p = await planned(); const firstId = p.sections[0]!.id;
  p = await f.write(p, 'facts/candidates', { attribute: 'second', role: 'core', value: '20 kg', evidenceId: p.evidence[0]!.id, quote: '20 kg', reason: '增加独立测试事实' });
  p = await f.write(p, `facts/${p.facts[1]!.id}/confirm`, { reason: '核对第二测试事实' });
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  await new Worker(f.store, { generate: async (_skill, snapshot) => plan({ ...snapshot, facts: [snapshot.facts[1]!] }) }).tick();
  p = await f.store.get(p.id);
  p.storyboard = structuredClone(p.storyboardCandidates!.at(-1)!);
  delete p.storyboard.id; delete p.storyboardCandidates; delete p.currentSectionId;
  for (const section of p.sections) delete section.storyboardId;
  await f.db.query('UPDATE projects SET state=$2::jsonb WHERE id=$1', [p.id, JSON.stringify(p)]);
  const invalid = await f.post(`/api/projects/${p.id}/sections/${firstId}/select`, command(p, { reason: '旧稿的事实不在当前顺序' }));
  assert.equal(invalid.statusCode, 409); assert.equal(invalid.json().error.code, 'SECTION_OUTSIDE_STORYBOARD');
  p = await f.write(p, 'qa/preflight');
  assert.equal(p.qa!.sectionId, p.sections[1]!.id, 'legacy read fallback still finds the actual current generation');
  assert.equal(p.qa!.issueSeverity, 'none');
  p = await f.write(p, `sections/${p.sections[1]!.id}/select`, { reason: '选择有同次生成归属的旧稿' });
  assert.equal(p.currentSectionId, p.sections[1]!.id);
  // Missing IDs also cannot prove ownership if facts happen to match another generation.
  p.sections[0]!.factIds = [...p.sections[1]!.factIds];
  await f.db.query('UPDATE projects SET state=$2::jsonb WHERE id=$1', [p.id, JSON.stringify(p)]);
  const wrongGeneration = await f.post(`/api/projects/${p.id}/sections/${firstId}/select`, command(p, { reason: '相同引用但不同生成仍不可认同归属' }));
  assert.equal(wrongGeneration.json().error.code, 'SECTION_OUTSIDE_STORYBOARD');
  // Preflight independently rejects a mismatched current selection, including old stored state.
  p.currentSectionId = firstId;
  await f.db.query('UPDATE projects SET state=$2::jsonb WHERE id=$1', [p.id, JSON.stringify(p)]);
  p = await f.write(p, 'qa/preflight'); assert.equal(p.qa!.issueSeverity, 'blocker');
  assert.ok(p.qa!.issues.some(i => i.startsWith('SECTION_OUTSIDE_STORYBOARD:')));
});

test('editing a legacy Section preserves selectable same-generation history without adopting other generations', async () => {
  let p = await planned();
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  await new Worker(f.store, { generate: async (_skill, snapshot) => plan(snapshot) }).tick();
  p = await f.store.get(p.id);
  p.storyboard = structuredClone(p.storyboardCandidates!.at(-1)!);
  delete p.storyboard.id; delete p.storyboardCandidates; delete p.currentSectionId;
  for (const section of p.sections) delete section.storyboardId;
  const foreignId = p.sections[0]!.id; const original = structuredClone(p.sections[1]!);
  await f.db.query('UPDATE projects SET state=$2::jsonb WHERE id=$1', [p.id, JSON.stringify(p)]);
  p = await f.write(p, `sections/${original.id}/draft`, { ...plan(p).section, purpose: '人工编辑目的', reason: '修订同一顺序下的草稿' });
  const manualId = p.currentSectionId!;
  assert.ok(p.storyboard!.id);
  const old = p.sections.find(s => s.id === original.id)!;
  assert.deepEqual(old, { ...original, storyboardId: p.storyboard!.id }, 'only known ownership metadata is assigned');
  assert.equal(p.sections.find(s => s.id === foreignId)!.storyboardId, undefined);
  p = await f.write(p, `sections/${original.id}/select`, { reason: '重新选择合法历史原稿' });
  p = await f.write(p, 'qa/preflight'); assert.equal(p.qa!.issueSeverity, 'none');
  assert.equal(p.currentSectionId, original.id);
  const invalid = await f.post(`/api/projects/${p.id}/sections/${foreignId}/select`, command(p, { reason: '相同事实但不同生成不能获得归属' }));
  assert.equal(invalid.statusCode, 409); assert.equal(invalid.json().error.code, 'SECTION_OUTSIDE_STORYBOARD');
  p = await f.write(p, `sections/${manualId}/select`, { reason: '切回人工草稿' });
  p = await f.write(p, 'qa/preflight'); assert.equal(p.qa!.issueSeverity, 'none');
});
