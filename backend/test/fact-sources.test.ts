import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, command } from './helpers.js';
import type { Evidence, Fact, Project, Section, Storyboard } from '../src/contracts.js';
import { availableConfirmedFacts, evaluateFactEligibility, factGovernanceHasBlockingIssue, skillInput,
  type FactIntegrityReason } from '../src/material-source-gates.js';
import { checkSkillInputs, preflight } from '../src/domain.js';
import { createLegacyFactBinding, createStructuredFactCandidateBinding, createStructuredFactConfirmation, FACT_RISK_KINDS,
  type FactRisk, type NormalizedFactValue } from '../src/production-fact-sources.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import { Worker } from '../src/worker.js';

let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
after(async () => { await f?.close(); });

async function addEvidence(p: Project, text: string, name = `${randomUUID()}.txt`) {
  return f.write(p, 'evidence', { documentName: name, locator: 'synthetic fixture', usage: 'product_evidence', text });
}
function source(evidence: Evidence, quote: string, rawValue: string, options: { quoteOccurrence?: number; valueOccurrence?: number } = {}) {
  let start = -1; let cursor = 0;
  for (let index = 0; index <= (options.quoteOccurrence ?? 0); index++) {
    start = evidence.text.indexOf(quote, cursor); cursor = start + quote.length;
  }
  assert.ok(start >= 0, `missing fixture quote: ${quote}`);
  let valueStart = -1; cursor = start;
  for (let index = 0; index <= (options.valueOccurrence ?? 0); index++) {
    valueStart = evidence.text.indexOf(rawValue, cursor); cursor = valueStart + rawValue.length;
  }
  assert.ok(valueStart >= start && valueStart + rawValue.length <= start + quote.length, `missing fixture value: ${rawValue}`);
  return { id: randomUUID(), evidenceId: evidence.id, quote, start, end: start + quote.length,
    valueSpan: { start: valueStart, end: valueStart + rawValue.length } };
}
function candidate(sources: ReturnType<typeof source>[], normalizedValue: NormalizedFactValue, options: {
  attribute?: string; applicability?: unknown; risks?: FactRisk[]; correctsFactId?: string;
} = {}) {
  return { attribute: options.attribute ?? 'capacity', role: 'core', normalizedValue, sources,
    applicability: options.applicability ?? { models: { kind: 'unspecified' }, conditions: [] },
    ...(options.risks === undefined ? {} : { risks: options.risks }),
    ...(options.correctsFactId ? { correctsFactId: options.correctsFactId } : {}),
    reason: 'Synthetic human candidate review' };
}
function completeRiskReview(fact: Fact) {
  assert.ok(fact.structured);
  const risks = [...fact.structured.proposedRisks, ...fact.structured.derivedRisks];
  return {
    reason: 'Reviewed every fixed risk category against the quoted sources',
    acknowledgedRiskIds: risks.map(risk => risk.id),
    riskReview: { categories: FACT_RISK_KINDS.map(kind => {
      const ids = risks.filter(risk => risk.kind === kind).map(risk => risk.id);
      return { kind, assessment: ids.length ? 'present' : 'not_found',
        reason: ids.length ? `Reviewed ${kind} risks in the source` : `No ${kind} issue found in this bounded claim`,
        reviewedRiskIds: ids };
    }) },
  };
}
async function saveCandidate(p: Project, body: ReturnType<typeof candidate>) {
  const response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p, body));
  assert.equal(response.statusCode, 200, response.body);
  return response.json<Project>();
}
async function confirm(p: Project, fact: Fact, extra: Record<string, unknown> = {}) {
  const response = await f.post(`/api/projects/${p.id}/facts/${fact.id}/structured/confirm`, command(p, { ...completeRiskReview(fact), ...extra }));
  assert.equal(response.statusCode, 200, response.body);
  return response.json<Project>();
}
async function details(p: Project, fact: Fact) {
  const response = await f.app.inject({ url: `/api/projects/${p.id}/facts/${fact.id}/details`, headers: f.headers });
  assert.equal(response.statusCode, 200, response.body); return response.json<Record<string, unknown>>();
}

test('structured risk governance derives numeric risk and requires all six server-recorded review categories', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg');
  const sourceInput = source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg');
  const before = structuredClone(p);
  p = await saveCandidate(p, candidate([sourceInput], { kind: 'decimal', value: '10.0', unit: 'kg' }));
  const fact = p.facts[0]!;
  assert.equal(p.version, before.version, 'candidate saves only a revision');
  assert.equal(fact.value, '10 kg');
  assert.equal(fact.structured!.proposedRisks.length, 0, 'omitted client risks stay an empty proposal list');
  assert.equal(fact.structured!.derivedRisks.length, 1);
  assert.equal(fact.structured!.derivedRisks[0]!.kind, 'numeric_claim');
  assert.equal(fact.structured!.derivedRisks[0]!.origin, 'derived');
  assert.equal(fact.structured!.riskPolicy.automaticSemanticRiskDetection, 'not_performed');
  assert.deepEqual(fact.structured!.riskPolicy.manualReviewResponsibilities, ['certification', 'efficacy', 'safety', 'scope', 'other']);
  const legacyConfirm = await f.post(`/api/projects/${p.id}/facts/${fact.id}/confirm`, command(p, { reason: 'try legacy shortcut' }));
  assert.equal(legacyConfirm.statusCode, 409); assert.equal(legacyConfirm.json().error.code, 'STRUCTURED_FACT_CONFIRM_REQUIRED');
  const missingReview = await f.post(`/api/projects/${p.id}/facts/${fact.id}/structured/confirm`, command(p, {
    reason: 'acknowledgement alone is insufficient', acknowledgedRiskIds: fact.structured!.derivedRisks.map(risk => risk.id),
  }));
  assert.equal(missingReview.statusCode, 400);
  const forgedActor = await f.post(`/api/projects/${p.id}/facts/${fact.id}/structured/confirm`, command(p, {
    ...completeRiskReview(fact), reviewer: 'forged-reviewer', reviewedAt: '2000-01-01T00:00:00.000Z',
  }));
  assert.equal(forgedActor.statusCode, 400);
  const missingOther = completeRiskReview(fact); missingOther.riskReview.categories.pop();
  assert.equal((await f.post(`/api/projects/${p.id}/facts/${fact.id}/structured/confirm`, command(p, missingOther))).statusCode, 400);
  const version = p.version;
  p = await confirm(p, fact);
  assert.equal(p.version, version + 1);
  assert.equal(p.facts[0]!.confirmedBy, 'test-human');
  assert.equal(p.facts[0]!.createdBy, 'test-human', 'one authenticated employee may create and review in the single-operator MVP');
  assert.equal(p.facts[0]!.structured!.riskReview!.reviewer, 'test-human');
  assert.notEqual(p.facts[0]!.structured!.riskReview!.reviewedAt, '2000-01-01T00:00:00.000Z');
  assert.deepEqual(availableConfirmedFacts(p).map(item => item.id), [fact.id]);

  p = await addEvidence(p, 'Material: aluminum');
  const collisionSource = source(p.evidence[1]!, 'Material: aluminum', 'aluminum');
  const copiedRisk: FactRisk = { id: fact.structured!.derivedRisks[0]!.id, kind: 'other', severity: 'warning',
    description: 'A copied identifier must not bind to another fact', sourceIds: [collisionSource.id] };
  const collision = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
    candidate([collisionSource], { kind: 'text', value: 'aluminum' }, { attribute: 'material', risks: [copiedRisk] })));
  assert.equal(collision.statusCode, 409); assert.equal(collision.json().error.code, 'DUPLICATE_FACT_RISK_ID');

  let other = await f.create(); other = await addEvidence(other, 'Material: steel');
  const otherSource = source(other.evidence[0]!, 'Material: steel', 'steel');
  const otherRisk: FactRisk = { id: randomUUID(), kind: 'other', severity: 'warning', description: 'Requires a category-specific manual check', sourceIds: [otherSource.id] };
  other = await saveCandidate(other, candidate([otherSource], { kind: 'text', value: 'steel' }, { attribute: 'material', risks: [otherRisk] }));
  const otherFact = other.facts[0]!; const incomplete = completeRiskReview(otherFact);
  incomplete.riskReview.categories.find(item => item.kind === 'other')!.reviewedRiskIds = [];
  const omittedOther = await f.post(`/api/projects/${other.id}/facts/${otherFact.id}/structured/confirm`, command(other, incomplete));
  assert.equal(omittedOther.statusCode, 409); assert.equal(omittedOther.json().error.code, 'INCOMPLETE_FACT_RISK_REVIEW');
  other = await confirm(other, otherFact);
  assert.equal(other.facts[0]!.structured!.riskReview!.categories.find(item => item.kind === 'other')!.assessment, 'present');
});

test('exact rational normalization accepts equivalent units and rejects conflicts, cropped units, forged ranges and cross-project sources atomically', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Weight: 1 lb', 'imperial.txt'); p = await addEvidence(p, 'Weight: 453.59237 g', 'metric.txt');
  const imperial = source(p.evidence[0]!, 'Weight: 1 lb', '1 lb');
  const metric = source(p.evidence[1]!, 'Weight: 453.59237 g', '453.59237 g');
  p = await saveCandidate(p, candidate([imperial, metric], { kind: 'decimal', value: '453.592370000', unit: 'g' }, { attribute: 'weight' }));
  assert.equal(p.facts[0]!.value, '453.59237 g');
  assert.deepEqual(p.facts[0]!.structured!.sources.map(item => item.rawUnit), ['lb', 'g']);
  assert.deepEqual(p.facts[0]!.structured!.sources.map(item => item.contentSha256), p.evidence.map(item => item.sha256));
  const stable = structuredClone(p);
  const mismatch = candidate([source(p.evidence[0]!, 'Weight: 1 lb', '1 lb')], { kind: 'decimal', value: '1', unit: 'kg' }, { attribute: 'weight' });
  let response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p, mismatch));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'NORMALIZED_VALUE_MISMATCH');
  assert.deepEqual(await f.store.get(p.id), stable);
  let cropProject = await f.create(); cropProject = await addEvidence(cropProject, 'Count-like claim: 10 kg');
  const cropped = source(cropProject.evidence[0]!, 'Count-like claim: 10 kg', '10');
  response = await f.post(`/api/projects/${cropProject.id}/facts/structured/candidates`, command(cropProject,
    candidate([cropped], { kind: 'decimal', value: '10', unit: 'count' })));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'VALUE_SPAN_OMITS_UNIT');
  const croppedQuote = source(cropProject.evidence[0]!, 'Count-like claim: 10', '10');
  response = await f.post(`/api/projects/${cropProject.id}/facts/structured/candidates`, command(cropProject,
    candidate([croppedQuote], { kind: 'decimal', value: '10', unit: 'count' })));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'VALUE_SPAN_OMITS_UNIT');
  const forged = { ...metric, start: metric.start + 1, end: metric.end + 1 };
  response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
    candidate([forged], { kind: 'decimal', value: '453.59237', unit: 'g' }, { attribute: 'weight' })));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_SOURCE_QUOTE');
  let foreign = await f.create(); foreign = await addEvidence(foreign, 'Weight: 453.59237 g');
  response = await f.post(`/api/projects/${foreign.id}/facts/structured/candidates`, command(foreign,
    candidate([{ ...metric, id: randomUUID() }], { kind: 'decimal', value: '453.59237', unit: 'g' }, { attribute: 'weight' })));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_STRUCTURED_FACT_SOURCE');
  await f.db.query(`UPDATE projects SET state=jsonb_set(state, '{evidence,0,sha256}', to_jsonb($2::text)) WHERE id=$1`, [foreign.id, '0'.repeat(64)]);
  foreign = await f.store.get(foreign.id);
  const local = source(foreign.evidence[0]!, 'Weight: 453.59237 g', '453.59237 g');
  response = await f.post(`/api/projects/${foreign.id}/facts/structured/candidates`, command(foreign,
    candidate([local], { kind: 'decimal', value: '453.59237', unit: 'g' }, { attribute: 'weight' })));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_STRUCTURED_FACT_SOURCE');
});

test('text normalization is limited to NFKC and whitespace', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Material: Ａ   B');
  const material = source(p.evidence[0]!, 'Material: Ａ   B', 'Ａ   B');
  p = await saveCandidate(p, candidate([material], { kind: 'text', value: '  A B  ' }, { attribute: 'material' }));
  assert.equal(p.facts[0]!.value, 'A B');
  assert.equal(p.facts[0]!.structured!.canonicalValue.kind, 'text');
  const changedMeaning = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
    candidate([{ ...material, id: randomUUID() }], { kind: 'text', value: 'translated meaning' }, { attribute: 'material' })));
  assert.equal(changedMeaning.statusCode, 409); assert.equal(changedMeaning.json().error.code, 'NORMALIZED_VALUE_MISMATCH');
});

function modelApplicability(sourceInput: ReturnType<typeof source>, modelId: string, evidence: Evidence, condition?: string) {
  const start = evidence.text.indexOf(modelId);
  return { models: { kind: 'specified', models: [{ id: modelId, sourceId: sourceInput.id, start, end: start + modelId.length }] },
    conditions: condition ? [{ description: condition, sourceIds: [sourceInput.id] }] : [] };
}
test('only anchored, explicitly disjoint model sets avoid conflicts; unspecified, all and free-text conditions remain overlapping', async () => {
  let p = await f.create();
  p = await addEvidence(p, 'Model A power: high', 'a.txt'); p = await addEvidence(p, 'Model B power: low', 'b.txt');
  p = await addEvidence(p, 'Power: medium', 'unknown.txt'); p = await addEvidence(p, 'Model A power: low', 'a-low.txt');
  p = await addEvidence(p, 'Power: universal', 'all.txt');
  const a = source(p.evidence[0]!, 'Model A power: high', 'high');
  p = await saveCandidate(p, candidate([a], { kind: 'text', value: 'high' }, { attribute: 'power', applicability: modelApplicability(a, 'Model A', p.evidence[0]!) }));
  p = await confirm(p, p.facts[0]!);
  const b = source(p.evidence[1]!, 'Model B power: low', 'low');
  p = await saveCandidate(p, candidate([b], { kind: 'text', value: 'low' }, { attribute: 'power', applicability: modelApplicability(b, 'Model B', p.evidence[1]!) }));
  assert.notEqual(p.facts[0]!.issueSeverity, 'blocker'); assert.notEqual(p.facts[1]!.issueSeverity, 'blocker');
  p = await confirm(p, p.facts[1]!);
  const unknown = source(p.evidence[2]!, 'Power: medium', 'medium');
  p = await saveCandidate(p, candidate([unknown], { kind: 'text', value: 'medium' }, { attribute: 'power',
    applicability: { models: { kind: 'unspecified' }, conditions: [{ description: 'office only', sourceIds: [unknown.id] }] } }));
  assert.equal(p.facts[2]!.issueSeverity, 'blocker');
  let response = await f.post(`/api/projects/${p.id}/facts/${p.facts[2]!.id}/structured/confirm`, command(p, completeRiskReview(p.facts[2]!)));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'UNRESOLVED_FACT_CONFLICT');
  p = await f.write(p, `facts/${p.facts[2]!.id}/reject`, { reason: 'Unknown scope cannot be merged' });
  const allModels = source(p.evidence[4]!, 'Power: universal', 'universal');
  p = await saveCandidate(p, candidate([allModels], { kind: 'text', value: 'universal' }, { attribute: 'power',
    applicability: { models: { kind: 'all' }, conditions: [] } }));
  assert.equal(p.facts[3]!.issueSeverity, 'blocker');
  const allDetails = await details(p, p.facts[3]!);
  assert.equal((allDetails.commands as { confirm: boolean }).confirm, false);
  p = await f.write(p, `facts/${p.facts[3]!.id}/reject`, { reason: 'All models overlaps every explicit model' });
  const sameModel = source(p.evidence[3]!, 'Model A power: low', 'low');
  p = await saveCandidate(p, candidate([sameModel], { kind: 'text', value: 'low' }, { attribute: 'power',
    applicability: modelApplicability(sameModel, 'Model A', p.evidence[3]!, 'indoor only') }));
  assert.equal(p.facts[4]!.issueSeverity, 'blocker', 'free text does not prove Model A conditions are exclusive');
  response = await f.post(`/api/projects/${p.id}/facts/${p.facts[4]!.id}/structured/confirm`, command(p, completeRiskReview(p.facts[4]!)));
  assert.equal(response.statusCode, 409);
  const badAnchor = { ...modelApplicability(sameModel, 'Model A', p.evidence[3]!), models: { kind: 'specified', models: [
    { id: 'Model B', sourceId: sameModel.id, start: p.evidence[3]!.text.indexOf('Model A'), end: p.evidence[3]!.text.indexOf('Model A') + 7 },
  ] } };
  response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
    candidate([{ ...sameModel, id: randomUUID() }], { kind: 'text', value: 'low' }, { attribute: 'power', applicability: badAnchor })));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_MODEL_SCOPE_ANCHOR');
});

function seedSection(id: string, factIds: string[]): Section {
  return { id, kind: 'diagnostic_draft', sourceRunId: 'human', factIds, purpose: id, missingInputs: [],
    issueSeverity: 'none', runStatus: 'succeeded', freshness: 'current', approvalStatus: 'draft' };
}
function seedStoryboard(id: string, factIds: string[]): Storyboard {
  return { id, sourceRunId: 'human', chapters: [{ role: 'feature', purpose: id, factIds }], freshness: 'current', approvalStatus: 'draft' };
}
test('correction creates a new locked fact, explicit replacement preserves old lock history and stales only old dependencies', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Capacity old: 10 kg'); p = await addEvidence(p, 'Capacity corrected: 12 kg'); p = await addEvidence(p, 'Material: steel');
  const oldSource = source(p.evidence[0]!, 'Capacity old: 10 kg', '10 kg');
  p = await saveCandidate(p, candidate([oldSource], { kind: 'decimal', value: '10', unit: 'kg' })); p = await confirm(p, p.facts[0]!);
  const materialSource = source(p.evidence[2]!, 'Material: steel', 'steel');
  p = await saveCandidate(p, candidate([materialSource], { kind: 'text', value: 'steel' }, { attribute: 'material' })); p = await confirm(p, p.facts[1]!);
  const old = structuredClone(p.facts[0]!); const unrelated = p.facts[1]!;
  p = await f.store.command(p.id, command(p), 'test.downstream.seed', 'test-human', current => {
    current!.sections.push(seedSection('00000000-0000-4000-8000-000000000001', [old.id]), seedSection('00000000-0000-4000-8000-000000000002', [unrelated.id]));
    current!.storyboard = seedStoryboard('00000000-0000-4000-8000-000000000003', [old.id]);
    current!.storyboardCandidates = [seedStoryboard('00000000-0000-4000-8000-000000000004', [unrelated.id])]; return current!;
  });
  const correctedSource = source(p.evidence[1]!, 'Capacity corrected: 12 kg', '12 kg');
  p = await saveCandidate(p, candidate([correctedSource], { kind: 'decimal', value: '12', unit: 'kg' }, { correctsFactId: old.id }));
  const replacement = p.facts[2]!; const beforeFailedConfirm = structuredClone(p);
  let response = await f.post(`/api/projects/${p.id}/facts/${replacement.id}/structured/confirm`, command(p, completeRiskReview(replacement)));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'UNRESOLVED_FACT_CONFLICT');
  assert.deepEqual(await f.store.get(p.id), beforeFailedConfirm);
  const body = command(p, { ...completeRiskReview(replacement), replaceFactId: old.id });
  response = await f.post(`/api/projects/${p.id}/facts/${replacement.id}/structured/confirm`, body);
  assert.equal(response.statusCode, 200, response.body); const receipt = response.json<Project>(); p = receipt;
  assert.deepEqual(await f.post(`/api/projects/${p.id}/facts/${replacement.id}/structured/confirm`, body).then(result => result.json()), receipt);
  assert.equal(p.facts[0]!.value, old.value); assert.equal(p.facts[0]!.status, 'confirmed'); assert.equal(p.facts[0]!.locked, true);
  assert.equal(p.facts[0]!.confirmedBy, old.confirmedBy); assert.equal(p.facts[0]!.confirmedAt, old.confirmedAt);
  assert.equal(p.facts[0]!.supersededByFactId, replacement.id); assert.equal(p.facts[2]!.value, '12 kg'); assert.equal(p.facts[2]!.locked, true);
  assert.equal(p.sections[0]!.freshness, 'stale'); assert.equal(p.sections[1]!.freshness, 'current');
  assert.equal(p.storyboard!.freshness, 'stale'); assert.equal(p.storyboardCandidates![0]!.freshness, 'current');
  assert.deepEqual(availableConfirmedFacts(p).map(item => item.id).sort(), [unrelated.id, replacement.id].sort());
});

test('a rejected claim cannot revive through a new evidence ID or model extraction without an explicit linked reconsideration', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Material: steel', 'first.txt'); p = await addEvidence(p, 'Material: steel', 'second.txt');
  const first = source(p.evidence[0]!, 'Material: steel', 'steel');
  p = await saveCandidate(p, candidate([first], { kind: 'text', value: 'steel' }, { attribute: 'material' }));
  const rejectedId = p.facts[0]!.id; p = await f.write(p, `facts/${rejectedId}/reject`, { reason: 'This claim was rejected after source review' });
  const second = source(p.evidence[1]!, 'Material: steel', 'steel');
  let response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
    candidate([second], { kind: 'text', value: 'steel' }, { attribute: 'material' })));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'REJECTED_FACT_RECONSIDERATION_REQUIRED');
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async () => ({ facts: [{ attribute: 'material', role: 'core', value: 'steel',
    evidenceId: p.evidence[1]!.id, quote: 'steel' }] }) }).tick();
  p = await f.store.get(p.id); assert.equal(p.facts.length, 1); assert.equal(p.facts[0]!.status, 'rejected');
  response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
    candidate([second], { kind: 'text', value: 'steel' }, { attribute: 'material', correctsFactId: rejectedId })));
  assert.equal(response.statusCode, 200, response.body); p = response.json<Project>();
  assert.equal(p.facts.length, 2); assert.equal(p.facts[1]!.correctsFactId, rejectedId);
});

async function addMaterial(p: Project, text: string, name: string) {
  p = await f.write(p, 'production/materials', { fileName: name, mimeType: 'text/plain', contentBase64: Buffer.from(text).toString('base64'),
    source: { kind: 'local_upload' }, usageHint: 'product_evidence' });
  await new IngestionWorker(f.store, f.objects).tick(); return f.store.get(p.id);
}
async function decideMaterial(p: Project, index: number, usage: 'product_evidence' | 'reference') {
  const material = p.production!.materials![index]!;
  return f.write(p, `production/materials/${material.id}/usage`, { reason: `Set synthetic source to ${usage}`,
    decisions: [{ blockId: material.blocks[0]!.id, usage }] });
}
function currentMaterialEvidence(p: Project, index: number) {
  const material = p.production!.materials![index]!; const current = material.usageReview!.current[material.blocks[0]!.id]!;
  return p.evidence.find(item => item.id === current.projectionId)!;
}
test('multi-source withdrawal creates per-source tasks and each unchanged original must be reconfirmed before reuse', async () => {
  let p = await f.write(await f.create(), 'production/initialize');
  p = await addMaterial(p, 'Capacity: 10 kg', 'primary.txt'); p = await addMaterial(p, 'Verified capacity: 10000 g', 'secondary.txt');
  p = await decideMaterial(p, 0, 'product_evidence'); p = await decideMaterial(p, 1, 'product_evidence');
  const first = source(currentMaterialEvidence(p, 0), 'Capacity: 10 kg', '10 kg');
  const second = source(currentMaterialEvidence(p, 1), 'Verified capacity: 10000 g', '10000 g');
  p = await saveCandidate(p, candidate([first, second], { kind: 'decimal', value: '10', unit: 'kg' })); p = await confirm(p, p.facts[0]!);
  const locked = structuredClone(p.facts[0]!);
  p = await f.store.command(p.id, command(p), 'test.source.downstream', 'test-human', current => {
    current!.sections.push(seedSection('00000000-0000-4000-8000-000000000011', [locked.id])); return current!;
  });
  p = await decideMaterial(p, 0, 'reference'); p = await decideMaterial(p, 1, 'reference');
  assert.equal(p.facts[0]!.status, 'confirmed'); assert.equal(p.facts[0]!.locked, true);
  assert.equal(p.facts[0]!.structured!.sources.filter(item => item.review?.status === 'reconfirmation_required').length, 2);
  assert.equal(availableConfirmedFacts(p).length, 0); assert.equal(p.sections[0]!.freshness, 'stale');
  let center = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
  assert.equal(center.statusCode, 200);
  assert.deepEqual(center.json().tasks.filter((task: { type: string }) => task.type === 'fact_source_reconfirmation')
    .map((task: { sourceId: string }) => task.sourceId).sort(), [first.id, second.id].sort());
  p = await decideMaterial(p, 0, 'product_evidence'); const replacement1 = currentMaterialEvidence(p, 0);
  p = await decideMaterial(p, 1, 'product_evidence'); const replacement2 = currentMaterialEvidence(p, 1);
  let response = await f.post(`/api/projects/${p.id}/facts/${locked.id}/sources/${first.id}/reconfirm`, command(p, {
    evidenceId: replacement2.id, reason: 'Cross-original replacement must fail' }));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_RECONFIRMATION_SOURCE');
  const firstVersion = p.version;
  p = await f.write(p, `facts/${locked.id}/sources/${first.id}/reconfirm`, { evidenceId: replacement1.id, reason: 'Same original and block verified' });
  assert.equal(p.version, firstVersion + 1); assert.equal(availableConfirmedFacts(p).length, 0, 'the other invalid source still blocks reuse');
  assert.equal(p.facts[0]!.structured!.sources[1]!.review!.status, 'reconfirmation_required');
  p = await f.write(p, `facts/${locked.id}/sources/${second.id}/reconfirm`, { evidenceId: replacement2.id, reason: 'Second unchanged original verified' });
  assert.equal(availableConfirmedFacts(p).length, 1);
  assert.equal(p.facts[0]!.value, locked.value); assert.equal(p.facts[0]!.confirmedBy, locked.confirmedBy); assert.equal(p.facts[0]!.confirmedAt, locked.confirmedAt);
  assert.equal(p.facts[0]!.structured!.sources[0]!.contentSha256, locked.structured!.sources[0]!.contentSha256);
  assert.equal(p.facts[0]!.structured!.sources[1]!.contentSha256, locked.structured!.sources[1]!.contentSha256);
  assert.equal(p.sections[0]!.freshness, 'stale', 'source recovery never auto-refreshes downstream work');
  center = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
  assert.equal(center.json().tasks.filter((task: { type: string }) => task.type === 'fact_source_reconfirmation').length, 0);
});

test('legacy fact details remain read-only and legacy confirmation semantics stay compatible', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg');
  p = await f.write(p, 'facts/candidates', { attribute: 'capacity', role: 'core', value: '10 kg', evidenceId: p.evidence[0]!.id,
    quote: '10 kg', reason: 'Legacy compatibility fixture' });
  p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'Legacy human confirmation' });
  const snapshot = structuredClone(p); const view = await details(p, p.facts[0]!);
  assert.equal(view.structured, false); assert.deepEqual((view.normalization as { status: string }).status, 'not_performed');
  assert.deepEqual(await f.store.get(p.id), snapshot);
  assert.equal(p.facts[0]!.structured, undefined); assert.deepEqual(availableConfirmedFacts(p).map(item => item.id), [p.facts[0]!.id]);
  const maxActor = structuredClone(p); maxActor.facts[0]!.confirmedBy = 'a'.repeat(1000);
  maxActor.facts[0]!.legacyBinding = createLegacyFactBinding(maxActor.facts[0]!, maxActor.evidence[0]!);
  assert.deepEqual(availableConfirmedFacts(maxActor).map(item => item.id), [maxActor.facts[0]!.id]);
  maxActor.facts[0]!.confirmedBy += 'a';
  assert.throws(() => createLegacyFactBinding(maxActor.facts[0]!, maxActor.evidence[0]!));
});

test('historical structured facts with missing review or a stale contract version are never treated as currently usable', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg');
  const sourceInput = source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg');
  p = await saveCandidate(p, candidate([sourceInput], { kind: 'decimal', value: '10', unit: 'kg' }));
  p = await confirm(p, p.facts[0]!); assert.equal(availableConfirmedFacts(p).length, 1);
  const missingReview = structuredClone(p); delete missingReview.facts[0]!.structured!.riskReview;
  assert.equal(availableConfirmedFacts(missingReview).length, 0);
  const staleContract = structuredClone(p);
  (staleContract.facts[0]!.structured as { contractVersion: string }).contractVersion = 'fact-sources.0';
  assert.equal(availableConfirmedFacts(staleContract).length, 0);
});

test('numeric value spans use complete token boundaries and preserve Unicode or parenthesized units atomically', async () => {
  const accepted = [
    { text: 'Minimum: -1.50 kg', raw: '-1.50 kg', value: '-1.5', unit: 'kg' as const },
    { text: 'Minimum: −1.50 kg', raw: '−1.50 kg', value: '-1.5', unit: 'kg' as const },
    { text: 'Count: +1, next field', raw: '+1', value: '1', unit: 'count' as const, expectedRawUnit: null },
    { text: '容量：500 毫升', raw: '500 毫升', value: '500', unit: 'mL' as const },
    { text: '重量：10（千克）', raw: '10（千克）', value: '10', unit: 'kg' as const },
    { text: '数量：10', raw: '10', value: '10', unit: 'count' as const, expectedRawUnit: null },
    { text: 'Weight: (10 kg)', raw: '10 kg', value: '10', unit: 'kg' as const },
  ];
  for (const item of accepted) {
    let p = await f.create(); p = await addEvidence(p, item.text);
    p = await saveCandidate(p, candidate([source(p.evidence[0]!, item.text, item.raw)],
      { kind: 'decimal', value: item.value, unit: item.unit }));
    assert.equal(p.facts[0]!.structured!.sources[0]!.rawValue, item.raw);
    assert.equal(p.facts[0]!.structured!.sources[0]!.rawUnit,
      'expectedRawUnit' in item ? item.expectedRawUnit : item.unit);
  }
  const rejected = [
    { text: 'Weight: 110 kg', raw: '10 kg', value: '10', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: -5 kg', raw: '5 kg', value: '5', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: 1.5 kg', raw: '5 kg', value: '5', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Count: +1', raw: '1', value: '1', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: −5 kg', raw: '5 kg', value: '5', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: 1٫5 kg', raw: '5 kg', value: '5', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Net: 1,000 kg', raw: '1', value: '1', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Net: 1,000 kg', raw: '000 kg', value: '0', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Net: 1，000 kg', raw: '1', value: '1', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Net: 1٬000 kg', raw: '1', value: '1', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Net: 1 000 kg', raw: '1', value: '1', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Net: 1 kg', raw: '1', value: '1', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Net: 1 kg', raw: '1', value: '1', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Net: 1\nkg', raw: '1', value: '1', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Scale: 1e3', raw: '1', value: '1', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Scale: 1e3', raw: '3', value: '3', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Ratio: 1/2', raw: '1', value: '1', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Ratio: 1/2', raw: '2', value: '2', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Duration: 10 min', raw: '10 m', value: '10', unit: 'm' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Model A5', raw: '5', value: '5', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: kg10', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Ratio: %10', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: 10 千克', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Weight: 10 (kg)', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
  ];
  for (const item of rejected) {
    let p = await f.create(); p = await addEvidence(p, item.text); const before = structuredClone(p);
    const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
    const response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
      candidate([source(p.evidence[0]!, item.text, item.raw)], { kind: 'decimal', value: item.value, unit: item.unit })));
    assert.equal(response.statusCode, 409, item.text); assert.equal(response.json().error.code, item.code, item.text);
    assert.deepEqual(await f.store.get(p.id), before, item.text);
    assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count),
      receiptCount, `${item.text} must not create a receipt`);
  }
});

test('risk assessment present must reference at least one current risk and failure is atomic', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Material: steel');
  p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Material: steel', 'steel')],
    { kind: 'text', value: 'steel' }, { attribute: 'material' }));
  const review = completeRiskReview(p.facts[0]!);
  review.riskReview.categories.find(item => item.kind === 'safety')!.assessment = 'present';
  const before = structuredClone(p);
  const response = await f.post(`/api/projects/${p.id}/facts/${p.facts[0]!.id}/structured/confirm`, command(p, review));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INCOMPLETE_FACT_RISK_REVIEW');
  assert.deepEqual(await f.store.get(p.id), before);
});

test('material review center blocks structured candidates with a current blocker risk', async () => {
  let p = await f.write(await f.create(), 'production/initialize');
  p = await addEvidence(p, 'Safety claim: guarded use only');
  const sourceInput = source(p.evidence[0]!, 'Safety claim: guarded use only', 'guarded use only');
  const blocker: FactRisk = { id: randomUUID(), kind: 'safety', severity: 'blocker',
    description: 'The safety limitation must be resolved before confirmation', sourceIds: [sourceInput.id] };
  p = await saveCandidate(p, candidate([sourceInput], { kind: 'text', value: 'guarded use only' },
    { attribute: 'safety', risks: [blocker] }));
  const response = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
  assert.equal(response.statusCode, 200);
  const task = response.json().tasks.find((item: { type: string; factId?: string }) =>
    item.type === 'fact_review' && item.factId === p.facts[0]!.id);
  assert.equal(task.status, 'blocked'); assert.equal(task.blockedReason, 'BLOCKING_FACT_RISK');
  const detail = await details(p, p.facts[0]!);
  assert.equal((detail.commands as { confirm: boolean }).confirm, false);
  const confirmResponse = await f.post(`/api/projects/${p.id}/facts/${p.facts[0]!.id}/structured/confirm`,
    command(p, completeRiskReview(p.facts[0]!)));
  assert.equal(confirmResponse.statusCode, 409);
  assert.equal(confirmResponse.json().error.code, 'BLOCKING_FACT_RISK');
});

test('persisted structured candidates cannot legitimize compatibility-field tampering during confirmation', async () => {
  const mutators: { name: string; reason: FactIntegrityReason; mutate: (fact: Fact) => void }[] = [
    { name: 'attribute', reason: 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING',
      mutate: fact => { fact.attribute = 'weight'; } },
    { name: 'role', reason: 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING',
      mutate: fact => { fact.role = 'supporting'; } },
    { name: 'creator', reason: 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING',
      mutate: fact => { fact.createdBy = 'forged-creator'; } },
    { name: 'source run', reason: 'INVALID_STRUCTURED_FACT_CONTRACT',
      mutate: fact => { fact.sourceRunId = 'forged-run'; } },
  ];
  for (const item of mutators) {
    let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg');
    p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg')],
      { kind: 'decimal', value: '10', unit: 'kg' }));
    p = await f.store.command(p.id, command(p), `test.fact.candidate-tamper.${item.name}`, 'test-human', current => {
      item.mutate(current!.facts[0]!); return current!;
    });
    const before = structuredClone(p);
    const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
    const response = await f.post(`/api/projects/${p.id}/facts/${p.facts[0]!.id}/structured/confirm`,
      command(p, completeRiskReview(p.facts[0]!)));
    assert.equal(response.statusCode, 409, item.name);
    assert.equal(response.json().error.code, 'INVALID_FACT_BINDING', item.name);
    assert.ok(evaluateFactEligibility(p, p.facts[0]!).reasons.includes(item.reason), item.name);
    assert.deepEqual(await f.store.get(p.id), before, item.name);
    assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count),
      receiptCount, `${item.name} must not create a receipt`);
  }
});

test('persisted structured confirmation binding rejects field, evidence identity, scope, risk and review tampering globally', async () => {
  const mutators: { name: string; reason: FactIntegrityReason; mutate: (fact: Fact, duplicateEvidenceId: string) => void }[] = [
    { name: 'display value', reason: 'INVALID_STRUCTURED_FACT_VALUE', mutate: fact => { fact.value = '11 kg'; } },
    { name: 'normalized value', reason: 'INVALID_STRUCTURED_FACT_VALUE', mutate: fact => { fact.structured!.normalizedValue = { kind: 'decimal', value: '11', unit: 'kg' }; } },
    { name: 'canonical value', reason: 'INVALID_STRUCTURED_FACT_VALUE', mutate: fact => { fact.structured!.canonicalValue = { kind: 'decimal', dimension: 'mass', numerator: '11', denominator: '1' }; } },
    { name: 'raw value', reason: 'INVALID_STRUCTURED_FACT_SOURCE', mutate: fact => { fact.structured!.sources[0]!.rawValue = '11 kg'; } },
    { name: 'raw unit', reason: 'INVALID_STRUCTURED_FACT_VALUE', mutate: fact => { fact.structured!.sources[0]!.rawUnit = 'g'; } },
    { name: 'same-text evidence identity', reason: 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING', mutate: (fact, evidenceId) => {
      fact.evidenceId = evidenceId; fact.structured!.sources[0]!.evidenceId = evidenceId;
    } },
    { name: 'risk source anchor', reason: 'INVALID_STRUCTURED_FACT_RISK', mutate: fact => { fact.structured!.derivedRisks[0]!.sourceIds = [randomUUID()]; } },
    { name: 'review actor binding', reason: 'INVALID_STRUCTURED_FACT_CONFIRMATION_BINDING', mutate: fact => { fact.structured!.riskReview!.reviewer = 'forged-reviewer'; } },
    { name: 'confirmation digest', reason: 'INVALID_STRUCTURED_FACT_CONFIRMATION_BINDING', mutate: fact => { fact.structured!.confirmation!.snapshotSha256 = '0'.repeat(64); } },
  ];
  for (const item of mutators) {
    let p = await f.create(); p = await f.write(p, 'identity/confirm', { productName: `Binding fixture ${item.name}` });
    p = await addEvidence(p, 'Capacity: 10 kg', 'first.txt'); p = await addEvidence(p, 'Capacity: 10 kg', 'duplicate.txt');
    p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg')],
      { kind: 'decimal', value: '10', unit: 'kg' })); p = await confirm(p, p.facts[0]!);
    p = await f.store.command(p.id, command(p), `test.fact.tamper.${item.name}`, 'test-human', current => {
      item.mutate(current!.facts[0]!, current!.evidence[1]!.id); return current!;
    });
    assert.deepEqual(availableConfirmedFacts(p), [], item.name);
    const eligibility = evaluateFactEligibility(p, p.facts[0]!);
    assert.ok(eligibility.reasons.includes(item.reason), item.name);
    const detail = await details(p, p.facts[0]!);
    assert.equal(detail.integrityValid, false, item.name);
    assert.deepEqual(detail.eligibility, eligibility, item.name);
    assert.equal((detail.commands as { confirm: boolean }).confirm, false, item.name);
    assert.deepEqual(skillInput(p, 'plan-section').confirmedFacts, [], item.name);
    assert.throws(() => checkSkillInputs(p, 'plan-section'), item.name);
    const checked = structuredClone(p); preflight(checked);
    assert.equal(checked.qa!.issueSeverity, 'blocker', item.name);
    assert.ok(checked.qa!.issues.includes('UNRESOLVED_FACT_CONFLICT'), item.name);
    const beforeEdit = structuredClone(p);
    const response = await f.post(`/api/projects/${p.id}/storyboard/draft`, command(p, {
      chapters: [{ role: 'feature', purpose: 'must reject tainted fact', factIds: [p.facts[0]!.id] }],
      reason: 'A tainted confirmed fact cannot enter an edit' }));
    assert.equal(response.statusCode, 409, item.name); assert.deepEqual(await f.store.get(p.id), beforeEdit, item.name);
  }
});

test('current applicability recomputes conflicts without trusting cached issueSeverity', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Model A power: high'); p = await addEvidence(p, 'Model B power: low');
  const a = source(p.evidence[0]!, 'Model A power: high', 'high');
  p = await saveCandidate(p, candidate([a], { kind: 'text', value: 'high' }, { attribute: 'power',
    applicability: modelApplicability(a, 'Model A', p.evidence[0]!) })); p = await confirm(p, p.facts[0]!);
  const b = source(p.evidence[1]!, 'Model B power: low', 'low');
  p = await saveCandidate(p, candidate([b], { kind: 'text', value: 'low' }, { attribute: 'power',
    applicability: modelApplicability(b, 'Model B', p.evidence[1]!) })); p = await confirm(p, p.facts[1]!);
  p = await f.store.command(p.id, command(p), 'test.fact.scope.migration', 'test-human', current => {
    current!.facts[1]!.structured!.applicability = { models: { kind: 'all' }, conditions: [] };
    current!.facts[1]!.structured!.candidateBinding = createStructuredFactCandidateBinding(current!.facts[1]!);
    current!.facts[1]!.structured!.confirmation = createStructuredFactConfirmation(current!.facts[1]!);
    current!.facts[0]!.issueSeverity = 'none'; current!.facts[1]!.issueSeverity = 'none'; return current!;
  });
  assert.equal(factGovernanceHasBlockingIssue(p), true);
  assert.ok(evaluateFactEligibility(p, p.facts[0]!).reasons.includes('PROJECT_FACT_GOVERNANCE_BLOCKER'));
  assert.deepEqual(availableConfirmedFacts(p), []);
  assert.deepEqual(skillInput(p, 'plan-section').confirmedFacts, []);
});

test('legacy addCandidate shares rejected-history reconsideration and unbound persisted legacy facts fail closed', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Material: steel', 'first.txt'); p = await addEvidence(p, 'Material: steel', 'second.txt');
  p = await f.write(p, 'facts/candidates', { attribute: 'material', role: 'core', value: 'steel', evidenceId: p.evidence[0]!.id,
    quote: 'steel', reason: 'Initial legacy claim' });
  const rejectedId = p.facts[0]!.id; p = await f.write(p, `facts/${rejectedId}/reject`, { reason: 'Rejected after review' });
  const before = structuredClone(p);
  let response = await f.post(`/api/projects/${p.id}/facts/candidates`, command(p, { attribute: 'material', role: 'core', value: 'steel',
    evidenceId: p.evidence[1]!.id, quote: 'steel', reason: 'Must not revive without an explicit link' }));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'REJECTED_FACT_RECONSIDERATION_REQUIRED');
  assert.deepEqual(await f.store.get(p.id), before);
  response = await f.post(`/api/projects/${p.id}/facts/candidates`, command(p, { attribute: 'material', role: 'core', value: 'steel',
    evidenceId: p.evidence[1]!.id, quote: 'steel', reason: 'Explicit reconsideration', correctsFactId: rejectedId }));
  assert.equal(response.statusCode, 200); p = response.json<Project>();
  p = await f.write(p, `facts/${p.facts[1]!.id}/confirm`, { reason: 'Confirm bound legacy compatibility record' });
  assert.equal(availableConfirmedFacts(p).length, 1);
  assert.deepEqual(evaluateFactEligibility(p, p.facts[1]!).formalFreezeReasons, ['LEGACY_FACT_NOT_STRUCTURED']);
  const historical = structuredClone(p); delete historical.facts[1]!.legacyBinding;
  assert.deepEqual(availableConfirmedFacts(historical), []);
  assert.equal(factGovernanceHasBlockingIssue(historical), true);
});

test('legacy confirmation attribution cannot be deleted from both fact and binding without failing every consumer closed', async () => {
  const mutators: { name: string; mutate: (fact: Fact) => void }[] = [
    { name: 'actor', mutate: fact => { delete fact.confirmedBy; delete (fact.legacyBinding as Partial<NonNullable<Fact['legacyBinding']>>).confirmedBy; } },
    { name: 'timestamp', mutate: fact => { delete fact.confirmedAt; delete (fact.legacyBinding as Partial<NonNullable<Fact['legacyBinding']>>).confirmedAt; } },
    { name: 'all attribution', mutate: fact => {
      delete fact.confirmedBy; delete fact.confirmedAt;
      delete (fact.legacyBinding as Partial<NonNullable<Fact['legacyBinding']>>).confirmedBy;
      delete (fact.legacyBinding as Partial<NonNullable<Fact['legacyBinding']>>).confirmedAt;
    } },
  ];
  for (const item of mutators) {
    let p = await f.create(); p = await f.write(p, 'identity/confirm', { productName: `Legacy attribution ${item.name}` });
    p = await addEvidence(p, 'Material: steel');
    p = await f.write(p, 'facts/candidates', { attribute: 'material', role: 'core', value: 'steel', evidenceId: p.evidence[0]!.id,
      quote: 'steel', reason: 'Legacy attribution fixture' });
    p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'Confirm legacy attribution fixture' });
    p = await f.store.command(p.id, command(p), `test.fact.legacy-attribution.${item.name}`, 'test-human', current => {
      const fact = current!.facts[0]!;
      current!.storyboard = seedStoryboard(randomUUID(), [fact.id]);
      current!.sections.push(seedSection(randomUUID(), [fact.id]));
      current!.currentSectionId = current!.sections.at(-1)!.id;
      item.mutate(fact); return current!;
    });
    const persisted = structuredClone(p);
    assert.deepEqual(availableConfirmedFacts(p), [], item.name);
    assert.ok(evaluateFactEligibility(p, p.facts[0]!).reasons.includes('LEGACY_FACT_BINDING_REQUIRED'), item.name);
    assert.deepEqual(skillInput(p, 'plan-section').confirmedFacts, [], item.name);
    assert.throws(() => checkSkillInputs(p, 'plan-section'), item.name);
    const checked = structuredClone(p); preflight(checked);
    assert.equal(checked.qa!.issueSeverity, 'blocker', item.name);
    assert.ok(checked.qa!.issues.includes('UNRESOLVED_FACT_CONFLICT'), item.name);
    assert.ok(checked.qa!.issues.includes(`INVALID_FACT_EVIDENCE:${p.facts[0]!.id}`), item.name);
    assert.deepEqual(await f.store.get(p.id), persisted, `${item.name} reads must not rewrite history`);
  }
});

test('material review center blocks a conflicting source recovery and omits superseded history', async () => {
  let p = await f.write(await f.create(), 'production/initialize');
  p = await addMaterial(p, 'Model A Model B power: high', 'high.txt');
  p = await addMaterial(p, 'Model A Model B power: low', 'low.txt');
  p = await decideMaterial(p, 0, 'product_evidence'); p = await decideMaterial(p, 1, 'product_evidence');
  const highEvidence = currentMaterialEvidence(p, 0); const high = source(highEvidence, highEvidence.text, 'high');
  p = await saveCandidate(p, candidate([high], { kind: 'text', value: 'high' }, { attribute: 'power',
    applicability: modelApplicability(high, 'Model A', highEvidence) })); p = await confirm(p, p.facts[0]!);
  const lowEvidence = currentMaterialEvidence(p, 1); const low = source(lowEvidence, lowEvidence.text, 'low');
  p = await saveCandidate(p, candidate([low], { kind: 'text', value: 'low' }, { attribute: 'power',
    applicability: modelApplicability(low, 'Model B', lowEvidence) })); p = await confirm(p, p.facts[1]!);
  p = await decideMaterial(p, 1, 'reference'); p = await decideMaterial(p, 1, 'product_evidence');
  p = await f.store.command(p.id, command(p), 'test.fact.scope.review-center', 'test-human', current => {
    const fact = current!.facts[1]!; const sourceId = fact.structured!.sources[0]!.id;
    fact.structured!.applicability = { models: { kind: 'specified', models: [{ id: 'Model A', sourceId, start: 0, end: 7 }] }, conditions: [] };
    fact.structured!.candidateBinding = createStructuredFactCandidateBinding(fact);
    fact.structured!.confirmation = createStructuredFactConfirmation(fact); fact.issueSeverity = 'none'; return current!;
  });
  let response = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
  assert.equal(response.statusCode, 200);
  let task = response.json().tasks.find((item: { type: string; factId?: string }) => item.type === 'fact_source_reconfirmation' && item.factId === p.facts[1]!.id);
  assert.equal(task.status, 'blocked'); assert.equal(task.blockedReason, 'UNRESOLVED_FACT_CONFLICT');
  p = await f.store.command(p.id, command(p), 'test.fact.supersede.review-center', 'test-human', current => {
    current!.facts[1]!.supersededByFactId = current!.facts[0]!.id; return current!;
  });
  response = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
  task = response.json().tasks.find((item: { factId?: string }) => item.factId === p.facts[1]!.id);
  assert.equal(task, undefined);
});
