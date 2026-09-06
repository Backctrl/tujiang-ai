import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, command } from './helpers.js';
import type { Project, AgentRun } from '../src/contracts.js';
import type { MaterialUse, MaterialReviewCenter } from '../src/production-material-usage.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import { Worker } from '../src/worker.js';
import { buildStructuredRequest } from '../src/openrouter.js';
import { availableConfirmedFacts, availableEvidence, evidenceIsAvailable, materialAssetIsAvailable, materialReferenceIsAvailable } from '../src/material-source-gates.js';
import { applyOutput } from '../src/domain.js';
import { AppError } from '../src/errors.js';

let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
after(async () => { await f?.close(); });
const material = (p: Project, index = 0) => p.production!.materials![index]!;
const upload = (content: string | Buffer, fileName = 'spec.txt', mimeType = 'text/plain') => ({
  fileName, mimeType, contentBase64: Buffer.from(content).toString('base64'), source: { kind: 'local_upload' }, usageHint: 'unknown',
});
async function parsed(content = 'Capacity: 10 kg\nMaterial: steel') {
  let p = await f.write(await f.create(), 'production/initialize');
  p = await f.write(p, 'production/materials', upload(content));
  await new IngestionWorker(f.store, f.objects).tick();
  return f.store.get(p.id);
}
async function usage(p: Project, uses: [number, MaterialUse][], index = 0) {
  const m = material(p, index);
  return f.write(p, `production/materials/${m.id}/usage`, { reason: 'checked source purpose',
    decisions: uses.map(([block, use]) => ({ blockId: m.blocks[block]!.id, usage: use })) });
}
const evidenceFor = (p: Project, block = 0, index = 0) => p.evidence.find(e => e.id === material(p, index).usageReview!.current[material(p, index).blocks[block]!.id]!.projectionId)!;
const candidate = (evidenceId: string, value = '10 kg', attribute = 'capacity') => ({
  attribute, role: 'core', value, quote: value, evidenceId, reason: 'checked exact source quote',
});
const planFor = (factIds: string[]) => ({ chapters: [{ role: 'feature', purpose: 'source-backed diagnostic', factIds }],
  section: { purpose: 'source-backed diagnostic', factIds, missingInputs: [] } });
async function runPlan(p: Project, ids: string[]) {
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  await new Worker(f.store, { generate: async () => planFor(ids) }).tick();
  return f.store.get(p.id);
}
async function confirmed() {
  let p = await usage(await parsed(), [[0, 'product_evidence'], [1, 'product_evidence']]);
  p = await f.write(p, 'identity/confirm', { productName: 'Synthetic fixture product' });
  p = await f.write(p, 'facts/candidates', candidate(evidenceFor(p).id));
  p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'checked capacity source' });
  p = await f.write(p, 'facts/candidates', candidate(evidenceFor(p, 1).id, 'steel', 'material'));
  return f.write(p, `facts/${p.facts[1]!.id}/confirm`, { reason: 'checked material source' });
}
async function center(p: Project) {
  const result = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
  assert.equal(result.statusCode, 200); return result.json<MaterialReviewCenter>();
}

test('real HTTP: strict contracts, per-block mixed review, precise source locators and pending extraction tasks', async () => {
  const server = await fixture();
  const base = await server.app.listen({ port: 0, host: '127.0.0.1' });
  const request = async (path: string, payload?: unknown, authenticated = true) => fetch(`${base}${path}`, {
    method: payload ? 'POST' : 'GET', headers: { ...(authenticated ? server.headers : {}), 'content-type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const write = async (p: Project, route: string, input: Record<string, unknown> = {}) => {
    const response = await request(`/api/projects/${p.id}/${route}`, command(p, input));
    assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<Project>;
  };
  try {
    const contracts = await (await request('/api/contracts')).json();
    for (const name of ['materialUsage', 'factSourceReconfirm']) assert.equal(contracts.requests[name].additionalProperties, false);
    let p = await (await request('/api/projects', { ...command({ version: 0, revision: 0 } as Project), name: 'HTTP usage fixture' })).json() as Project;
    assert.equal((await request(`/api/projects/${p.id}/production/material-reviews`)).status, 409);
    p = await write(p, 'production/initialize');
    const source = { kind: 'feishu_export', url: 'https://example.feishu.cn/docx/synthetic-usage', title: 'Synthetic source', revision: '61', locator: 'table 1' };
    const text = 'property,value\r\ncapacity,"10 kg\nverified"\r\nmaterial,steel';
    p = await write(p, 'production/materials', { ...upload(text, 'original.csv', 'text/csv'), source, usageHint: 'mixed' });
    await new IngestionWorker(server.store, server.objects).tick(); p = await server.store.get(p.id);
    const m = material(p); const original = structuredClone(m);
    const path = `/api/projects/${p.id}/production/materials/${m.id}/usage`;
    assert.equal((await request(`/api/projects/${p.id}/production/material-reviews`, undefined, false)).status, 401);
    const body = command(p, { reason: 'row-level purpose', decisions: [
      { blockId: m.blocks[0]!.id, usage: 'reference' }, { blockId: m.blocks[1]!.id, usage: 'product_evidence' },
    ] });
    assert.equal((await request(path, body, false)).status, 401);
    const reviewed = await request(path, body); assert.equal(reviewed.status, 200);
    p = await reviewed.json() as Project;
    const receipt = structuredClone(p);
    assert.equal(material(p).usage.status, 'partially_reviewed');
    assert.deepEqual(material(p).blocks, original.blocks);
    assert.deepEqual(material(p).origins, original.origins);
    assert.equal(p.evidence[0]!.text, 'capacity,"10 kg\nverified"');
    assert.equal(p.evidence[0]!.origin, 'material');
    assert.equal(p.evidence[0]!.sha256, createHash('sha256').update(p.evidence[0]!.text).digest('hex'));
    assert.notEqual(p.evidence[0]!.sha256, m.sha256);
    assert.deepEqual(p.evidence[0]!.materialSource!.locator, m.blocks[1]!.locator);
    assert.deepEqual(p.evidence[0]!.materialSource!.source, source);
    assert.equal(evidenceIsAvailable(p, p.evidence[0]!), true);
    assert.equal(materialReferenceIsAvailable(p, p.production!.references![0]!), true);
    assert.deepEqual(JSON.parse(buildStructuredRequest('extract-facts', p, 'stub', 100).messages[1]!.content).evidence.map((e: { id: string }) => e.id), [p.evidence[0]!.id]);
    const tasks = await (await request(`/api/projects/${p.id}/production/material-reviews`)).json() as MaterialReviewCenter;
    assert.equal(tasks.revision, p.revision);
    assert.deepEqual(tasks.tasks.filter(t => t.type === 'material_usage').map(t => t.blockIds), [[m.blocks[2]!.id]]);
    assert.equal(tasks.tasks.filter(t => t.type === 'fact_extraction').length, 1);
    assert.deepEqual(p.facts, []);
    const originalResponse = await request(`/api/projects/${p.id}/production/materials/${m.id}/original`);
    assert.equal(Buffer.from(await originalResponse.arrayBuffer()).toString(), text);
    const evidenceVersion = p.evidence[0]!.materialSource!.usageVersion;
    p = await write(p, `production/materials/${m.id}/usage`, { reason: 'last row is reference', decisions: [{ blockId: m.blocks[2]!.id, usage: 'reference' }] });
    assert.equal(material(p).usage.status, 'reviewed');
    assert.equal(evidenceIsAvailable(p, p.evidence[0]!), true, 'editing another block cannot invalidate its earlier usage version');
    assert.equal(p.evidence[0]!.materialSource!.usageVersion, evidenceVersion);
    assert.deepEqual(await (await request(path, body)).json(), receipt);
    p = await write(p, 'production/materials', upload('{"product":{"name":"支架","capacity":"10 kg"}}', 'source.json', 'application/json'));
    await new IngestionWorker(server.store, server.objects).tick(); p = await server.store.get(p.id);
    const jsonMaterial = material(p, 1); const jsonBlock = jsonMaterial.blocks.find(b => b.locator.type === 'json' && b.locator.pointer === '/product/capacity')!;
    p = await write(p, `production/materials/${jsonMaterial.id}/usage`, { reason: 'exact JSON source', decisions: [{ blockId: jsonBlock.id, usage: 'product_evidence' }] });
    assert.deepEqual(p.evidence.at(-1)!.materialSource!.locator, jsonBlock.locator);
    assert.equal(p.evidence.at(-1)!.text, jsonBlock.text);
    assert.equal(evidenceIsAvailable(p, p.evidence.at(-1)!), true);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 3000);
    try {
      const stream = await fetch(`${base}/api/projects/${p.id}/events?after=${receipt.audit.length}`, { headers: server.headers, signal: controller.signal });
      const reader = stream.body!.getReader(); let events = '';
      while (!events.includes('material.usage.decided')) {
        const next = await reader.read(); assert.equal(next.done, false);
        events += new TextDecoder().decode(next.value);
      }
      assert.match(events, /event: project.changed/);
      assert.match(events, /usageVersion/);
      await reader.cancel();
    } finally { clearTimeout(deadline); controller.abort(); }
  } finally { await server.close(); }
});

test('usage replay and effective no-op preserve revisions, projections and audit; concurrent choices have one winner', async () => {
  let p = await parsed(); const m = material(p); const url = `/api/projects/${p.id}/production/materials/${m.id}/usage`;
  const body = command(p, { reason: 'first review', decisions: [{ blockId: m.blocks[0]!.id, usage: 'product_evidence' }] });
  const responses = await Promise.all([f.post(url, body), f.post(url, body)]);
  assert.equal(responses[0]!.statusCode, 200); assert.deepEqual(responses[0]!.json(), responses[1]!.json());
  p = responses[0]!.json<Project>();
  assert.deepEqual((await f.post(url, command(p, { ...body, ...command(p), reason: 'same effective purpose' }))).json(), p);
  assert.equal((await f.post(url, { ...body, reason: 'changed same key' })).json().error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.post(url, { ...body, idempotencyKey: randomUUID() })).json().error.code, 'REVISION_CONFLICT');
  const results = await Promise.all(['product_evidence', 'reference'].map(use => f.post(url, command(p, {
    reason: 'competing review', decisions: [{ blockId: m.blocks[1]!.id, usage: use }],
  }))));
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  const latest = await f.store.get(p.id);
  assert.equal(material(latest).usageReview!.history.length, 2);
  assert.equal(latest.revision, p.revision + 1);
  assert.deepEqual((await f.post(url, body)).json(), p, 'old receipt remains immutable after later purpose decisions');
});

test('image assets require completed decoding; original bindings and independent reference projections survive correction', async () => {
  let p = await f.write(await f.create(), 'production/initialize');
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#abcdef' } }).toFormat(format).toBuffer();
    p = await f.write(p, 'production/materials', upload(bytes, `sample.${format}`, `image/${format}`));
    await new IngestionWorker(f.store, f.objects).tick(); p = await f.store.get(p.id);
    const index = p.production!.materials!.length - 1; const m = material(p, index);
    assert.equal((await f.post(`/api/projects/${p.id}/production/materials/${m.id}/usage`, command(p, { reason: 'no OCR',
      decisions: [{ blockId: m.blocks[0]!.id, usage: 'product_evidence' }] }))).json().error.code, 'TEXT_EVIDENCE_REQUIRED');
    const inputRevision = p.inputRevision;
    p = await usage(p, [[0, 'asset']], index);
    const asset = p.production!.assets!.at(-1)!;
    assert.equal(asset.objectKey, m.objectKey); assert.equal(asset.sha256, m.sha256);
    assert.equal(materialAssetIsAvailable(p, asset), true);
    p = await usage(p, [[0, 'reference']], index);
    assert.equal(materialAssetIsAvailable(p, p.production!.assets!.at(-1)!), false);
    const ref = p.production!.references!.at(-1)!;
    assert.equal(ref.objectKey, m.objectKey); assert.equal(materialReferenceIsAvailable(p, ref), true);
    p = await usage(p, [[0, 'asset']], index);
    assert.notEqual(p.production!.assets!.at(-1)!.id, asset.id);
    assert.equal(p.inputRevision, inputRevision); assert.deepEqual(p.evidence, []);
  }
});

test('purpose withdrawal preserves locked facts and receipts, marks only dependent drafts stale, and recovery requires explicit reconfirmation', async () => {
  let p = await confirmed();
  const originalFact = structuredClone(p.facts[0]!); const originalEvidence = structuredClone(evidenceFor(p));
  p = await f.write(p, 'facts/candidates', candidate(originalEvidence.id, '10 kg', 'unreviewed capacity note'));
  const candidateId = p.facts[2]!.id;
  p = await runPlan(p, [p.facts[0]!.id]);
  p = await runPlan(p, [p.facts[1]!.id]);
  p = await f.write(p, 'qa/preflight');
  assert.equal(p.qa!.issueSeverity, 'none');
  const old = structuredClone(p); const businessVersion = p.version;
  p = await usage(p, [[0, 'reference']]);
  assert.equal(p.version, businessVersion);
  assert.equal(p.facts[0]!.status, 'confirmed'); assert.equal(p.facts[0]!.locked, true);
  for (const key of ['value', 'attribute', 'role', 'confirmedAt', 'confirmedBy'] as const) assert.equal(p.facts[0]![key], originalFact[key]);
  assert.equal(p.facts[0]!.sourceReview!.status, 'reconfirmation_required');
  assert.equal(p.facts[2]!.sourceReview!.status, 'invalidated');
  assert.equal(p.sections[0]!.freshness, 'stale'); assert.deepEqual(p.sections[1], old.sections[1]);
  assert.equal(p.storyboard!.freshness, 'stale');
  assert.equal(p.storyboardCandidates![1]!.freshness, 'current');
  const impact = material(p).usageReview!.history.at(-1)!.impact;
  assert.deepEqual(impact.affectedSectionIds, [p.sections[0]!.id]);
  assert.deepEqual(impact.affectedCandidateIds, [candidateId]);
  assert.deepEqual(impact.reconfirmationRequiredFactIds, [originalFact.id]);
  assert.equal(p.qa, undefined);
  assert.equal((await center(p)).tasks.find(t => t.type === 'fact_source_reconfirmation')?.status, 'blocked');
  assert.ok(!(await center(p)).tasks.some(t => t.type === 'fact_review' && t.factId === candidateId));
  const snapshot = await f.app.inject({ url: `/api/projects/${p.id}/revisions/${old.revision}`, headers: f.headers });
  assert.deepEqual(snapshot.json(), old);
  p = await usage(p, [[0, 'product_evidence']]);
  const replacement = evidenceFor(p);
  assert.notEqual(replacement.id, originalEvidence.id);
  assert.equal(p.evidence.find(e => e.id === originalEvidence.id)!.availability, 'withdrawn');
  assert.equal(material(p).usageReview!.current[material(p).blocks[0]!.id]!.extraction!.status, 'extraction_needed');
  assert.equal(availableConfirmedFacts(p).some(fact => fact.id === originalFact.id), false);
  const task = (await center(p)).tasks.find(t => t.type === 'fact_source_reconfirmation');
  assert.equal(task?.status, 'ready');
  if (task?.type === 'fact_source_reconfirmation') assert.equal(task.replacementEvidenceId, replacement.id);
  assert.equal((await f.post(`/api/projects/${p.id}/facts/${candidateId}/confirm`, command(p, { reason: 'old candidate cannot revive' }))).json().error.code, 'INVALID_EVIDENCE');
  const route = `facts/${originalFact.id}/source/reconfirm`;
  assert.equal((await f.post(`/api/projects/${p.id}/${route}`, command(p, { reason: 'wrong block', evidenceId: evidenceFor(p, 1).id }))).json().error.code, 'INVALID_RECONFIRMATION_SOURCE');
  p = await f.write(p, route, { reason: 'checked same original block again', evidenceId: replacement.id });
  assert.equal(p.version, businessVersion + 1); assert.equal(p.facts[0]!.sourceReview, undefined);
  assert.equal(p.facts[0]!.evidenceId, replacement.id); assert.equal(p.facts[0]!.confirmedAt, originalFact.confirmedAt);
  assert.equal(p.facts[0]!.sourceReconfirmations!.length, 1); assert.equal(p.facts[0]!.sourceReconfirmations![0]!.previousEvidenceId, originalEvidence.id);
  assert.equal(p.sections[0]!.freshness, 'stale'); assert.equal(p.storyboard!.freshness, 'stale');
  assert.deepEqual(await f.write(p, route, { reason: 'duplicate human click', evidenceId: replacement.id }), p);
  p = await f.write(p, 'qa/preflight');
  assert.equal(p.qa!.issueSeverity, 'blocker'); assert.equal(p.qa!.exportAllowed, false);
});

test('manual, Agent output and diagnostic gates reject withdrawn sources while unrelated approved facts remain usable', async () => {
  let p = await confirmed(); p = await runPlan(p, [p.facts[0]!.id]);
  const old = structuredClone(p); const withdrawnEvidence = evidenceFor(p);
  p = await usage(p, [[0, 'reference']]);
  const refs = [p.facts[0]!.id];
  for (const [route, input] of [
    ['facts/candidates', candidate(withdrawnEvidence.id)],
    ['storyboard/draft', { chapters: planFor(refs).chapters, reason: 'invalid source' }],
    [`sections/${p.sections[0]!.id}/draft`, { ...planFor(refs).section, reason: 'invalid source' }],
    [`sections/${p.sections[0]!.id}/select`, { reason: 'invalid source' }],
    [`storyboard/candidates/${p.storyboardCandidates![0]!.id}/apply`, { reason: 'invalid source' }],
  ] as const) assert.equal((await f.post(`/api/projects/${p.id}/${route}`, command(p, input))).statusCode, 409);
  const extractionInput = JSON.parse(buildStructuredRequest('extract-facts', p, 'stub', 100).messages[1]!.content);
  assert.deepEqual(extractionInput.evidence.map((e: { id: string }) => e.id), [evidenceFor(p, 1).id]);
  const planInput = JSON.parse(buildStructuredRequest('plan-section', p, 'stub', 100).messages[1]!.content);
  assert.deepEqual(planInput.confirmedFacts.map((fact: { id: string }) => fact.id), [p.facts[1]!.id]);
  const syntheticRun = (skill: AgentRun['skill']): AgentRun => ({ id: randomUUID(), skill, requestedBy: 'stub', queueStatus: 'claimed',
    attempt: 1, issueSeverity: 'none', approvalStatus: 'draft', freshness: 'current', runStatus: 'running',
    contextVersion: p.version, contextRevision: p.revision, contextInputRevision: p.inputRevision });
  const beforeFacts = structuredClone(p.facts);
  const first = { attribute: 'material', role: 'core', value: 'steel', evidenceId: evidenceFor(p, 1).id, quote: 'steel' };
  assert.throws(() => applyOutput(p, syntheticRun('extract-facts'), { facts: [first, { ...first, evidenceId: withdrawnEvidence.id, quote: '10 kg' }] }),
    error => error instanceof AppError && error.code === 'INVALID_EVIDENCE_REFERENCE');
  assert.deepEqual(p.facts, beforeFacts, 'one invalid reference rolls back all new candidates');
  assert.throws(() => applyOutput(p, syntheticRun('plan-section'), planFor(refs)), error => error instanceof AppError && error.code === 'UNCONFIRMED_FACT_REFERENCE');
  const forged = structuredClone(p); const historical = forged.evidence.find(e => e.id === withdrawnEvidence.id)!;
  historical.availability = 'available';
  assert.equal(evidenceIsAvailable(forged, historical), false, 'availability field alone cannot bypass current usage decision');
  p = await f.write(p, 'qa/preflight');
  assert.ok(p.qa!.issues.includes(`INVALID_FACT_EVIDENCE:${refs[0]}`));
  p = await runPlan(p, [p.facts[1]!.id]);
  assert.equal(p.runs.at(-1)!.runStatus, 'succeeded'); assert.deepEqual(p.facts[0]!.value, old.facts[0]!.value);
});

test('unreviewed blocks, forged lineage, invalid batches and unfinished parsing cannot create evidence', async () => {
  let p = await parsed(); const m = material(p); const url = `/api/projects/${p.id}/production/materials/${m.id}/usage`;
  assert.equal((await f.post(`/api/projects/${p.id}/runs`, command(p, { skill: 'extract-facts' }))).json().error.code, 'EVIDENCE_REQUIRED');
  assert.equal((await f.post(`/api/projects/${p.id}/facts/candidates`, command(p, candidate(m.id)))).json().error.code, 'INVALID_EVIDENCE_REFERENCE');
  const valid = { reason: 'review', decisions: [{ blockId: m.blocks[0]!.id, usage: 'product_evidence' }] };
  for (const extra of [{ text: 'forged' }, { objectKey: m.objectKey }, { actor: 'forged' }, { sourceSha256: m.sha256 }, { reason: '\u0000' }, { reason: '\ud800' },
    { decisions: [...valid.decisions, ...valid.decisions] }, { decisions: [{ ...valid.decisions[0], text: 'forged' }] }])
    assert.equal((await f.post(url, command(p, { ...valid, ...extra }))).statusCode, 400);
  const before = structuredClone(p);
  assert.equal((await f.post(url, command(p, { reason: 'invalid second choice', decisions: [...valid.decisions,
    { blockId: m.blocks[1]!.id, usage: 'asset' }] }))).json().error.code, 'DECODED_IMAGE_REQUIRED');
  assert.deepEqual(await f.store.get(p.id), before);
  const other = await parsed('Other source 20 kg');
  assert.equal((await f.post(url, command(p, { reason: 'foreign block', decisions: [{ blockId: material(other).blocks[0]!.id, usage: 'reference' }] }))).json().error.code, 'MATERIAL_BLOCK_NOT_FOUND');
  p = await f.write(p, 'production/materials', upload('{invalid', 'failed.json', 'application/json'));
  const failedId = material(p, 1).id;
  const invalidRoute = `/api/projects/${p.id}/production/materials/${failedId}/usage`;
  assert.equal((await f.post(invalidRoute, command(p, valid))).json().error.code, 'MATERIAL_PARSE_REQUIRED');
  await new IngestionWorker(f.store, f.objects).tick(); p = await f.store.get(p.id);
  assert.equal((await f.post(invalidRoute, command(p, valid))).json().error.code, 'MATERIAL_PARSE_REQUIRED');
  await writeFile(join(f.objectDirectory, m.objectKey), Buffer.from('damaged bytes'));
  assert.equal((await f.post(url, command(p, valid))).json().error.code, 'SOURCE_FILE_INTEGRITY_FAILED');
  assert.deepEqual(await f.store.get(p.id), p);
  await writeFile(join(f.objectDirectory, m.objectKey), Buffer.from('Capacity: 10 kg\nMaterial: steel'));
});

test('independent human entries remain usable after source withdrawal and cannot self-assert material approval', async () => {
  let p = await usage(await parsed('Same independent answer: 10 kg'), [[0, 'product_evidence']]);
  const old = evidenceFor(p); p = await usage(p, [[0, 'reference']]);
  const input = { documentName: 'employee answer', locator: 'answer 1', text: old.text, usage: 'product_evidence' };
  for (const extra of [{ origin: 'material' }, { materialSource: old.materialSource }, { materialId: material(p).id },
    { blockId: material(p).blocks[0]!.id }, { sha256: old.sha256 }, { parserVersion: 'ingest.1' }, { objectKey: old.objectKey }])
    assert.equal((await f.post(`/api/projects/${p.id}/evidence`, command(p, { ...input, ...extra }))).statusCode, 400);
  p = await f.write(p, 'evidence', input);
  const independent = p.evidence.at(-1)!;
  assert.equal(independent.origin, 'manual_entry'); assert.equal(independent.createdBy, 'test-human'); assert.ok(independent.createdAt);
  assert.equal(independent.materialSource, undefined); assert.notEqual(independent.id, old.id);
  assert.deepEqual(availableEvidence(p).map(e => e.id), [independent.id]);
  p = await f.write(p, 'facts/candidates', candidate(independent.id));
  assert.equal(p.facts.at(-1)!.locked, false);
  p = await f.write(p, `facts/${p.facts.at(-1)!.id}/confirm`, { reason: 'separate employee source checked' });
  assert.equal(p.facts.at(-1)!.status, 'confirmed');
  assert.equal(p.evidence[0]!.availability, 'withdrawn');
  const legacy = structuredClone(p); delete legacy.evidence.at(-1)!.origin;
  assert.equal(evidenceIsAvailable(legacy, legacy.evidence.at(-1)!), true);
});

test('queued jobs recheck source before dispatch and retries cannot revive a withdrawn-only input', async () => {
  let p = await usage(await parsed('Capacity: 10 kg'), [[0, 'product_evidence']]);
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  p = await usage(p, [[0, 'reference']]);
  let calls = 0;
  await new Worker(f.store, { generate: async () => { calls++; return { facts: [] }; } }).tick();
  p = await f.store.get(p.id);
  assert.equal(calls, 0); assert.equal(p.runs[0]!.errorCode, 'EVIDENCE_REQUIRED');
  assert.equal((await f.post(`/api/projects/${p.id}/runs/${p.runs[0]!.id}/retry`, command(p))).json().error.code, 'EVIDENCE_REQUIRED');
  assert.deepEqual(p.facts, []);
  p = await usage(p, [[0, 'product_evidence']]);
  p = await f.write(p, 'facts/candidates', candidate(evidenceFor(p).id));
  p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'confirmed new source' });
  p = await f.write(p, 'identity/confirm', { productName: 'queued planning fixture' });
  p = await f.write(p, 'runs', { skill: 'plan-section' });
  p = await usage(p, [[0, 'reference']]);
  await new Worker(f.store, { generate: async () => { calls++; return planFor([p.facts[0]!.id]); } }).tick();
  p = await f.store.get(p.id);
  assert.equal(calls, 0); assert.equal(p.runs.at(-1)!.errorCode, 'CONFIRMED_CORE_FACT_REQUIRED');
  assert.equal((await f.post(`/api/projects/${p.id}/runs/${p.runs.at(-1)!.id}/retry`, command(p))).json().error.code, 'CONFIRMED_CORE_FACT_REQUIRED');
});

test('in-flight source changes reject output but independent asset/reference changes preserve exact model input revision', async () => {
  let p = await usage(await parsed('Capacity: 10 kg'), [[0, 'product_evidence']]);
  const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  p = await f.write(p, 'production/materials', upload(image, 'independent.png', 'image/png'));
  await new IngestionWorker(f.store, f.objects).tick(); p = await f.store.get(p.id);
  for (const changeSource of [false, true]) {
    p = await f.write(p, 'runs', { skill: 'extract-facts' });
    const before = p.inputRevision;
    let release!: () => void; let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const tick = new Worker(f.store, { generate: async (_skill, current) => {
      started(); await gate;
      return { facts: [{ attribute: 'capacity', role: 'core', value: '10 kg', evidenceId: availableEvidence(current)[0]!.id, quote: '10 kg' }] };
    } }).tick();
    try {
      await Promise.race([entered, tick.then(() => { throw new Error('stub not dispatched'); })]);
      p = await f.store.get(p.id);
      if (changeSource) p = await usage(p, [[0, 'reference']]);
      else { p = await usage(p, [[0, 'asset']], 1); p = await usage(p, [[0, 'reference']], 1); }
      assert.equal(p.inputRevision === before, !changeSource);
    } finally { release(); await tick; }
    p = await f.store.get(p.id);
    assert.equal(p.runs.at(-1)!.runStatus, changeSource ? 'failed' : 'succeeded');
    assert.equal(p.runs.at(-1)!.errorCode, changeSource ? 'STALE_INPUT' : undefined);
  }
});

test('restoring evidence creates new extraction candidates without reviving old approval and records only actual validated extraction', async () => {
  let p = await usage(await parsed('Capacity: 10 kg'), [[0, 'product_evidence']]);
  const original = evidenceFor(p);
  p = await f.write(p, 'facts/candidates', candidate(original.id));
  assert.equal(material(p).usageReview!.current[material(p).blocks[0]!.id]!.extraction!.status, 'candidate_created');
  const oldFactId = p.facts[0]!.id;
  p = await usage(p, [[0, 'reference']]); p = await usage(p, [[0, 'product_evidence']]);
  const newEvidence = evidenceFor(p);
  const current = material(p).usageReview!.current[material(p).blocks[0]!.id]!;
  assert.equal(current.extraction!.status, 'extraction_needed'); assert.equal(current.extraction!.sourceRunId, undefined);
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async () => ({ facts: [{ attribute: 'capacity', role: 'core', value: '10 kg', quote: '10 kg', evidenceId: newEvidence.id }] }) }).tick();
  p = await f.store.get(p.id);
  assert.equal(p.facts.length, 2); assert.equal(p.facts[0]!.id, oldFactId); assert.equal(p.facts[0]!.sourceReview!.status, 'invalidated');
  assert.equal(p.facts[1]!.evidenceId, newEvidence.id); assert.equal(p.facts[1]!.status, 'candidate'); assert.equal(p.facts[1]!.locked, false);
  const extraction = material(p).usageReview!.current[material(p).blocks[0]!.id]!.extraction!;
  assert.equal(extraction.status, 'extracted'); assert.equal(extraction.sourceRunId, p.runs.at(-1)!.id); assert.deepEqual(extraction.candidateIds, [p.facts[1]!.id]);
  p = await usage(p, [[0, 'reference']]); p = await usage(p, [[0, 'product_evidence']]);
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async () => ({ facts: [] }) }).tick();
  p = await f.store.get(p.id);
  assert.equal(material(p).usageReview!.current[material(p).blocks[0]!.id]!.extraction!.status, 'extracted');
  assert.ok(!(await center(p)).tasks.some(t => t.type === 'fact_extraction'));
});

test('material projections do not consume the independent employee-evidence capacity', async () => {
  let p = await parsed(Array.from({ length: 12 }, (_, i) => `Original parameter ${i}: checked`).join('\n'));
  p = await usage(p, material(p).blocks.map((_block, index) => [index, 'product_evidence']));
  assert.equal(p.evidence.length, 12);
  const input = { documentName: 'independent employee answer', locator: 'answer', text: 'Separately supplied product information', usage: 'product_evidence' };
  for (let i = 0; i < 10; i++) p = await f.write(p, 'evidence', input);
  assert.equal(p.evidence.length, 22);
  assert.equal(p.evidence.filter(e => e.origin === 'manual_entry').length, 10);
  assert.equal((await f.post(`/api/projects/${p.id}/evidence`, command(p, input))).json().error.code, 'EVIDENCE_LIMIT');
});
