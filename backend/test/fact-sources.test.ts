import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fixture, command } from './helpers.js';
import type { Evidence, Fact, Project, Section, Storyboard } from '../src/contracts.js';
import { availableConfirmedFacts, evaluateFactEligibility, factGovernanceHasBlockingIssue, factIntegrityIsValid,
  factIntegrityReason, projectActiveFactIntegrityIsValid, skillInput,
  type FactIntegrityReason } from '../src/material-source-gates.js';
import { checkSkillInputs, preflight } from '../src/domain.js';
import { createFactLifecycleBinding, createLegacyFactBinding, createStructuredFactCandidateBinding,
  createStructuredFactConfirmation, factLifecycleBindingIsValid, FACT_RISK_KINDS,
  type FactRisk, type NormalizedFactValue } from '../src/production-fact-sources.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import { Worker } from '../src/worker.js';
import { audit } from '../src/store.js';

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
function recreateStructuredProofForPersistedFixture(fact: Fact) {
  assert.ok(fact.structured && fact.status === 'confirmed' && fact.locked && fact.confirmedBy && fact.confirmedAt
    && fact.structured.riskReview);
  const confirmedBy = fact.confirmedBy; const confirmedAt = fact.confirmedAt;
  const riskReview = structuredClone(fact.structured.riskReview);
  const sourceState = fact.structured.sources.map(source => ({
    review: source.review === undefined ? undefined : structuredClone(source.review),
    reconfirmations: source.reconfirmations === undefined ? undefined : structuredClone(source.reconfirmations),
  }));
  fact.status = 'candidate'; fact.locked = false;
  delete fact.confirmedBy; delete fact.confirmedAt;
  delete fact.structured.riskReview; delete fact.structured.confirmation;
  for (const source of fact.structured.sources) { delete source.review; delete source.reconfirmations; }
  fact.structured.candidateBinding = createStructuredFactCandidateBinding(fact);
  fact.status = 'confirmed'; fact.locked = true; fact.confirmedBy = confirmedBy; fact.confirmedAt = confirmedAt;
  fact.structured.sources.forEach((source, index) => {
    const saved = sourceState[index]!;
    if (saved.review !== undefined) source.review = saved.review;
    if (saved.reconfirmations !== undefined) source.reconfirmations = saved.reconfirmations;
  });
  fact.structured.riskReview = riskReview;
  fact.structured.confirmation = createStructuredFactConfirmation(fact);
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
  assert.equal(factIntegrityIsValid(p, p.facts[0]!), true); assert.equal(factIntegrityIsValid(p, p.facts[2]!), true);
  assert.equal(p.facts[0]!.replacementTransitions!.length, 1); assert.deepEqual(p.facts[0]!.replacementTransitions, p.facts[2]!.replacementTransitions);
  assert.equal(p.sections[0]!.freshness, 'stale'); assert.equal(p.sections[1]!.freshness, 'current');
  assert.equal(p.storyboard!.freshness, 'stale'); assert.equal(p.storyboardCandidates![0]!.freshness, 'current');
  assert.deepEqual(availableConfirmedFacts(p).map(item => item.id).sort(), [unrelated.id, replacement.id].sort());
});

test('replacement is limited to the same applicability scope and fails atomically', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Model A power: high'); p = await addEvidence(p, 'Model A power: low');
  const oldSource = source(p.evidence[0]!, 'Model A power: high', 'high');
  p = await saveCandidate(p, candidate([oldSource], { kind: 'text', value: 'high' }, { attribute: 'power',
    applicability: { models: { kind: 'all' }, conditions: [] } })); p = await confirm(p, p.facts[0]!);
  const nextSource = source(p.evidence[1]!, 'Model A power: low', 'low');
  p = await saveCandidate(p, candidate([nextSource], { kind: 'text', value: 'low' }, { attribute: 'power',
    applicability: modelApplicability(nextSource, 'Model A', p.evidence[1]!), correctsFactId: p.facts[0]!.id }));
  const detail = await details(p, p.facts[1]!);
  assert.equal((detail.commands as { replaceFactId: string | null }).replaceFactId, null);
  const before = structuredClone(p); const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
  const response = await f.post(`/api/projects/${p.id}/facts/${p.facts[1]!.id}/structured/confirm`, command(p, {
    ...completeRiskReview(p.facts[1]!), replaceFactId: p.facts[0]!.id }));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_FACT_REPLACEMENT');
  assert.deepEqual(await f.store.get(p.id), before);
  assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count), receiptCount);
});

test('replacement transitions are reciprocal, project-unique and require a locked confirmed predecessor', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Capacity old: 10 kg'); p = await addEvidence(p, 'Capacity new: 12 kg');
  const oldSource = source(p.evidence[0]!, 'Capacity old: 10 kg', '10 kg');
  p = await saveCandidate(p, candidate([oldSource], { kind: 'decimal', value: '10', unit: 'kg' })); p = await confirm(p, p.facts[0]!);
  const nextSource = source(p.evidence[1]!, 'Capacity new: 12 kg', '12 kg');
  p = await saveCandidate(p, candidate([nextSource], { kind: 'decimal', value: '12', unit: 'kg' }, { correctsFactId: p.facts[0]!.id }));
  p = await confirm(p, p.facts[1]!, { replaceFactId: p.facts[0]!.id });
  const transition = p.facts[0]!.replacementTransitions![0]!;
  assert.deepEqual(p.facts[1]!.replacementTransitions, [transition]);
  assert.equal(p.facts.flatMap(fact => fact.replacementTransitions ?? []).filter(item => item.id === transition.id).length, 2);
  assert.equal(factIntegrityIsValid(p, p.facts[0]!), true); assert.equal(factIntegrityIsValid(p, p.facts[1]!), true);

  const oneSided = structuredClone(p); oneSided.facts[1]!.replacementTransitions = [];
  oneSided.facts[1]!.lifecycleBinding = createFactLifecycleBinding(oneSided.facts[1]!, 'test-human',
    'Persisted one-sided transition fixture', oneSided.facts[1]!.status);
  assert.equal(factIntegrityReason(oneSided, oneSided.facts[0]!), 'INVALID_FACT_SUPERSESSION');
  assert.equal(factIntegrityReason(oneSided, oneSided.facts[1]!), 'INVALID_FACT_SUPERSESSION');
  assert.equal(factGovernanceHasBlockingIssue(oneSided), true); assert.deepEqual(availableConfirmedFacts(oneSided), []);

  const unlockedPredecessor = structuredClone(p); const predecessor = unlockedPredecessor.facts[0]!;
  predecessor.status = 'retracted'; predecessor.locked = false;
  predecessor.lifecycleBinding = createFactLifecycleBinding(predecessor, 'test-human',
    'Persisted invalid predecessor transition fixture', 'confirmed');
  audit(unlockedPredecessor, 'fact.retract', 'test-human', { factId: predecessor.id });
  audit(unlockedPredecessor, `fact.${predecessor.id}.retract`, 'test-human', { factId: predecessor.id });
  assert.equal(factIntegrityReason(unlockedPredecessor, predecessor), 'INVALID_FACT_SUPERSESSION');
  assert.equal(factIntegrityReason(unlockedPredecessor, unlockedPredecessor.facts[1]!), 'INVALID_FACT_SUPERSESSION');

  const malformedForeign = structuredClone(p);
  (malformedForeign.facts[1]!.replacementTransitions as unknown[])!.push(null);
  assert.doesNotThrow(() => factIntegrityReason(malformedForeign, malformedForeign.facts[0]!));
  assert.equal(factIntegrityReason(malformedForeign, malformedForeign.facts[0]!), 'INVALID_FACT_SUPERSESSION');
  assert.equal(factGovernanceHasBlockingIssue(malformedForeign), true);
});

test('a valid A to B to C replacement chain exposes only C and retracting C never revives predecessors', async () => {
  let p = await f.create();
  for (const text of ['Capacity A: 10 kg', 'Capacity B: 12 kg', 'Capacity C: 14 kg']) p = await addEvidence(p, text);
  const aSource = source(p.evidence[0]!, 'Capacity A: 10 kg', '10 kg');
  p = await saveCandidate(p, candidate([aSource], { kind: 'decimal', value: '10', unit: 'kg' }));
  p = await confirm(p, p.facts[0]!); const aId = p.facts[0]!.id;
  const bSource = source(p.evidence[1]!, 'Capacity B: 12 kg', '12 kg');
  p = await saveCandidate(p, candidate([bSource], { kind: 'decimal', value: '12', unit: 'kg' }, { correctsFactId: aId }));
  p = await confirm(p, p.facts[1]!, { replaceFactId: aId }); const bId = p.facts[1]!.id;
  const cSource = source(p.evidence[2]!, 'Capacity C: 14 kg', '14 kg');
  p = await saveCandidate(p, candidate([cSource], { kind: 'decimal', value: '14', unit: 'kg' }, { correctsFactId: bId }));
  p = await confirm(p, p.facts[2]!, { replaceFactId: bId }); const cId = p.facts[2]!.id;

  assert.ok(p.facts.every(fact => factIntegrityIsValid(p, fact)));
  assert.deepEqual(availableConfirmedFacts(p).map(fact => fact.id), [cId]);
  assert.equal(((await details(p, p.facts[0]!)).commands as { retract: boolean }).retract, false);
  assert.equal(((await details(p, p.facts[1]!)).commands as { retract: boolean }).retract, false);
  assert.equal(((await details(p, p.facts[2]!)).commands as { retract: boolean }).retract, true);
  p = await f.write(p, `facts/${cId}/retract`, { reason: 'Withdraw the final successor after chain verification' });
  assert.ok(p.facts.every(fact => factIntegrityIsValid(p, fact)));
  assert.deepEqual(availableConfirmedFacts(p), []);
  assert.equal(factGovernanceHasBlockingIssue(p), false);
  assert.equal(projectActiveFactIntegrityIsValid(p), true);
  assert.equal(p.facts.find(fact => fact.id === aId)!.status, 'confirmed');
  assert.equal(p.facts.find(fact => fact.id === bId)!.status, 'confirmed');
  assert.equal(p.facts.find(fact => fact.id === cId)!.status, 'retracted');
});

test('explicit reject and retract quarantine lifecycle-unbound active records without blessing confirmation', async () => {
  let candidateProject = await f.create(); candidateProject = await addEvidence(candidateProject, 'Material: steel');
  candidateProject = await saveCandidate(candidateProject, candidate([source(candidateProject.evidence[0]!, 'Material: steel', 'steel')],
    { kind: 'text', value: 'steel' }, { attribute: 'material' }));
  candidateProject = await f.store.command(candidateProject.id, command(candidateProject), 'test.lifecycle.remove.candidate', 'test-human', current => {
    delete current!.facts[0]!.lifecycleBinding; return current!;
  });
  let response = await f.post(`/api/projects/${candidateProject.id}/facts/${candidateProject.facts[0]!.id}/structured/confirm`,
    command(candidateProject, completeRiskReview(candidateProject.facts[0]!)));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_FACT_BINDING');
  candidateProject = await f.write(candidateProject, `facts/${candidateProject.facts[0]!.id}/reject`,
    { reason: 'Explicitly quarantine an unbound historical candidate' });
  assert.equal(candidateProject.facts[0]!.status, 'rejected'); assert.equal(factIntegrityIsValid(candidateProject, candidateProject.facts[0]!), true);
  assert.equal(projectActiveFactIntegrityIsValid(candidateProject), true);

  let confirmedProject = await f.create(); confirmedProject = await addEvidence(confirmedProject, 'Material: aluminum');
  confirmedProject = await f.write(confirmedProject, 'facts/candidates', { attribute: 'material', role: 'core', value: 'aluminum',
    evidenceId: confirmedProject.evidence[0]!.id, quote: 'aluminum', reason: 'Legacy migration fixture' });
  confirmedProject = await f.write(confirmedProject, `facts/${confirmedProject.facts[0]!.id}/confirm`, { reason: 'Confirm legacy migration fixture' });
  confirmedProject = await f.store.command(confirmedProject.id, command(confirmedProject), 'test.lifecycle.remove.confirmed', 'test-human', current => {
    delete current!.facts[0]!.lifecycleBinding; return current!;
  });
  confirmedProject = await f.write(confirmedProject, `facts/${confirmedProject.facts[0]!.id}/retract`,
    { reason: 'Explicitly quarantine an unbound historical confirmation' });
  assert.equal(confirmedProject.facts[0]!.status, 'retracted'); assert.equal(confirmedProject.facts[0]!.locked, false);
  assert.equal(factIntegrityIsValid(confirmedProject, confirmedProject.facts[0]!), true);
  assert.equal(projectActiveFactIntegrityIsValid(confirmedProject), true);
});

test('retracted claims require explicit linked reconsideration', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Material: steel', 'first.txt'); p = await addEvidence(p, 'Material: steel', 'second.txt');
  const first = source(p.evidence[0]!, 'Material: steel', 'steel');
  p = await saveCandidate(p, candidate([first], { kind: 'text', value: 'steel' }, { attribute: 'material' }));
  p = await confirm(p, p.facts[0]!); const retractedId = p.facts[0]!.id;
  p = await f.write(p, `facts/${retractedId}/retract`, { reason: 'Withdraw the previously confirmed value' });
  p = await f.write(p, 'runs', { skill: 'extract-facts' });
  await new Worker(f.store, { generate: async () => ({ facts: [{ attribute: 'material', role: 'core', value: 'steel',
    evidenceId: p.evidence[1]!.id, quote: 'steel' }] }) }).tick();
  p = await f.store.get(p.id); assert.equal(p.facts.length, 1); assert.equal(p.facts[0]!.status, 'retracted');
  const second = source(p.evidence[1]!, 'Material: steel', 'steel');
  let response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
    candidate([second], { kind: 'text', value: 'steel' }, { attribute: 'material' })));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'REJECTED_FACT_RECONSIDERATION_REQUIRED');
  response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
    candidate([second], { kind: 'text', value: 'steel' }, { attribute: 'material', correctsFactId: retractedId })));
  assert.equal(response.statusCode, 200, response.body);
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
  const originalCandidateBinding = structuredClone(locked.structured!.candidateBinding);
  const originalConfirmation = structuredClone(locked.structured!.confirmation);
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
  assert.deepEqual(p.facts[0]!.structured!.candidateBinding, originalCandidateBinding);
  assert.deepEqual(p.facts[0]!.structured!.confirmation, originalConfirmation);
  assert.equal(p.facts[0]!.structured!.sources[0]!.contentSha256, locked.structured!.sources[0]!.contentSha256);
  assert.equal(p.facts[0]!.structured!.sources[1]!.contentSha256, locked.structured!.sources[1]!.contentSha256);
  assert.equal(p.sections[0]!.freshness, 'stale', 'source recovery never auto-refreshes downstream work');
  const chainMutators: { name: string; mutate: (fact: Fact) => void }[] = [
    { name: 'discontinuous previous evidence', mutate: fact => {
      fact.structured!.sources[0]!.reconfirmations![0]!.previousEvidenceId = randomUUID();
    } },
    { name: 'repeated evidence identity', mutate: fact => {
      const source = fact.structured!.sources[0]!;
      const originalEvidenceId = fact.structured!.candidateBinding!.originalSources[0]!.evidenceId;
      source.reconfirmations![0]!.evidenceId = originalEvidenceId;
      source.evidenceId = originalEvidenceId; fact.evidenceId = originalEvidenceId;
    } },
    { name: 'current evidence does not match final cursor', mutate: fact => {
      const originalEvidenceId = fact.structured!.candidateBinding!.originalSources[0]!.evidenceId;
      fact.structured!.sources[0]!.evidenceId = originalEvidenceId; fact.evidenceId = originalEvidenceId;
    } },
    { name: 'reconfirmation decision does not match replacement evidence', mutate: fact => {
      fact.structured!.sources[0]!.reconfirmations![0]!.decisionId = randomUUID();
    } },
    { name: 'reconfirmation usage version does not match replacement evidence', mutate: fact => {
      fact.structured!.sources[0]!.reconfirmations![0]!.usageVersion++;
    } },
  ];
  for (const item of chainMutators) {
    const changed = structuredClone(p); const fact = changed.facts[0]!; item.mutate(fact);
    fact.lifecycleBinding = createFactLifecycleBinding(fact, 'test-human',
      `Re-sign lifecycle after ${item.name}`, fact.status);
    assert.equal(factIntegrityReason(changed, fact), 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING', item.name);
    assert.equal(projectActiveFactIntegrityIsValid(changed), false, item.name);
  }
  const historyTampered = structuredClone(p);
  historyTampered.facts[0]!.structured!.sources[0]!.reconfirmations!.pop();
  assert.equal(factIntegrityReason(historyTampered, historyTampered.facts[0]!), 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING');
  const historicalEvidenceTampered = structuredClone(p);
  const originalEvidenceId = historicalEvidenceTampered.facts[0]!.structured!.candidateBinding!.originalSources[0]!.evidenceId;
  const historicalEvidence = historicalEvidenceTampered.evidence.find(item => item.id === originalEvidenceId)!;
  historicalEvidence.text += '\nTampered after the source was reconfirmed';
  historicalEvidence.sha256 = createHash('sha256').update(historicalEvidence.text, 'utf8').digest('hex');
  historicalEvidence.objectKey = `${historicalEvidence.sha256}.txt`;
  assert.equal(factIntegrityReason(historicalEvidenceTampered, historicalEvidenceTampered.facts[0]!),
    'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING');
  assert.equal(projectActiveFactIntegrityIsValid(historicalEvidenceTampered), false);
  assert.deepEqual(availableConfirmedFacts(historicalEvidenceTampered), []);
  center = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
  assert.equal(center.json().tasks.filter((task: { type: string }) => task.type === 'fact_source_reconfirmation').length, 0);
});

test('material withdrawal preserves invalid lifecycle state for structured and legacy facts', async () => {
  for (const kind of ['structured', 'legacy'] as const) {
    let p = await f.write(await f.create(), 'production/initialize');
    p = await addMaterial(p, 'Capacity: 10 kg', `${kind}.txt`); p = await decideMaterial(p, 0, 'product_evidence');
    const evidence = currentMaterialEvidence(p, 0);
    if (kind === 'structured') {
      p = await saveCandidate(p, candidate([source(evidence, evidence.text, '10 kg')],
        { kind: 'decimal', value: '10', unit: 'kg' }));
      p = await confirm(p, p.facts[0]!);
    } else {
      p = await f.write(p, 'facts/candidates', { attribute: 'capacity', role: 'core', value: '10 kg',
        evidenceId: evidence.id, quote: '10 kg', reason: 'Legacy withdrawal migration fixture' });
      p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'Confirm legacy withdrawal fixture' });
    }
    p = await f.store.command(p.id, command(p), `test.withdrawal.invalid-lifecycle.${kind}`, 'test-human', current => {
      delete current!.facts[0]!.lifecycleBinding; return current!;
    });
    p = await decideMaterial(p, 0, 'reference');
    assert.equal(p.facts[0]!.lifecycleBinding, undefined, kind);
    assert.equal(factIntegrityReason(p, p.facts[0]!), 'INVALID_FACT_LIFECYCLE_BINDING', kind);
    assert.equal(kind === 'structured'
      ? p.facts[0]!.structured!.sources[0]!.review!.status : p.facts[0]!.sourceReview!.status,
    'reconfirmation_required', kind);
    p = await decideMaterial(p, 0, 'product_evidence');
    const response = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
    const task = response.json().tasks.find((item: { type: string; factId?: string }) =>
      item.type === 'fact_source_reconfirmation' && item.factId === p.facts[0]!.id);
    assert.equal(task.status, 'blocked', kind); assert.equal(task.blockedReason, 'INVALID_FACT_BINDING', kind);
    if (kind === 'legacy') {
      const before = structuredClone(p);
      const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
      const recovery = await f.post(`/api/projects/${p.id}/facts/${p.facts[0]!.id}/source/reconfirm`, command(p, {
        evidenceId: currentMaterialEvidence(p, 0).id, reason: 'Invalid lifecycle must remain quarantined',
      }));
      assert.equal(recovery.statusCode, 409); assert.equal(recovery.json().error.code, 'INVALID_FACT_BINDING');
      assert.deepEqual(await f.store.get(p.id), before);
      assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count), receiptCount);
    }
  }
});

test('another invalid active fact blocks structured source recovery in tasks, details and the command atomically', async () => {
  let p = await f.write(await f.create(), 'production/initialize');
  p = await addMaterial(p, 'Capacity: 10 kg', 'recovery.txt'); p = await addMaterial(p, 'Material: steel', 'blocker.txt');
  p = await decideMaterial(p, 0, 'product_evidence'); p = await decideMaterial(p, 1, 'product_evidence');
  const targetSource = source(currentMaterialEvidence(p, 0), 'Capacity: 10 kg', '10 kg');
  p = await saveCandidate(p, candidate([targetSource], { kind: 'decimal', value: '10', unit: 'kg' }));
  p = await confirm(p, p.facts[0]!); const targetId = p.facts[0]!.id;
  const blockerSource = source(currentMaterialEvidence(p, 1), 'Material: steel', 'steel');
  p = await saveCandidate(p, candidate([blockerSource], { kind: 'text', value: 'steel' }, { attribute: 'material' }));
  p = await confirm(p, p.facts[1]!);
  p = await decideMaterial(p, 0, 'reference'); p = await decideMaterial(p, 0, 'product_evidence');
  const replacement = currentMaterialEvidence(p, 0);
  p = await f.store.command(p.id, command(p), 'test.source-recovery.invalid-other', 'test-human', current => {
    const blocker = current!.facts[1]!; blocker.supersededByFactId = targetId;
    blocker.lifecycleBinding = createFactLifecycleBinding(blocker, 'test-human',
      'Persist invalid supersession beside a source recovery', blocker.status);
    return current!;
  });
  let response = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
  const task = response.json().tasks.find((item: { type: string; factId?: string }) =>
    item.type === 'fact_source_reconfirmation' && item.factId === targetId);
  assert.equal(task.status, 'blocked'); assert.equal(task.blockedReason, 'INVALID_FACT_BINDING');
  const detail = await details(p, p.facts[0]!);
  assert.deepEqual((detail.commands as { reconfirmSourceIds: string[] }).reconfirmSourceIds, []);
  const before = structuredClone(p);
  const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
  response = await f.post(`/api/projects/${p.id}/facts/${targetId}/sources/${targetSource.id}/reconfirm`, command(p, {
    evidenceId: replacement.id, reason: 'Must not recover around another invalid active fact',
  }));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_FACT_BINDING');
  assert.deepEqual(await f.store.get(p.id), before);
  assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count), receiptCount);
});

test('unchanged structured and legacy source reconfirmations still enforce global active integrity before writing receipts', async () => {
  for (const kind of ['structured', 'legacy'] as const) {
    let p = await f.write(await f.create(), 'production/initialize');
    p = await addMaterial(p, 'Capacity: 10 kg', `${kind}-target.txt`);
    p = await addMaterial(p, 'Material: steel', `${kind}-blocker.txt`);
    p = await decideMaterial(p, 0, 'product_evidence'); p = await decideMaterial(p, 1, 'product_evidence');
    const targetEvidence = currentMaterialEvidence(p, 0);
    let sourceId: string | undefined;
    if (kind === 'structured') {
      const targetSource = source(targetEvidence, targetEvidence.text, '10 kg'); sourceId = targetSource.id;
      p = await saveCandidate(p, candidate([targetSource], { kind: 'decimal', value: '10', unit: 'kg' }));
      p = await confirm(p, p.facts[0]!);
    } else {
      p = await f.write(p, 'facts/candidates', { attribute: 'capacity', role: 'core', value: '10 kg',
        evidenceId: targetEvidence.id, quote: '10 kg', reason: 'Legacy unchanged recovery target' });
      p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'Confirm legacy unchanged recovery target' });
    }
    const blockerEvidence = currentMaterialEvidence(p, 1);
    p = await f.write(p, 'facts/candidates', { attribute: 'material', role: 'core', value: 'steel',
      evidenceId: blockerEvidence.id, quote: 'steel', reason: 'Unrelated integrity blocker fixture' });
    p = await f.write(p, `facts/${p.facts[1]!.id}/confirm`, { reason: 'Confirm unrelated integrity blocker fixture' });
    const targetId = p.facts[0]!.id;
    p = await decideMaterial(p, 0, 'reference'); p = await decideMaterial(p, 0, 'product_evidence');
    const replacement = currentMaterialEvidence(p, 0);
    const route = kind === 'structured'
      ? `facts/${targetId}/sources/${sourceId!}/reconfirm` : `facts/${targetId}/source/reconfirm`;
    p = await f.write(p, route, { evidenceId: replacement.id, reason: 'Complete the first source recovery' });
    p = await f.store.command(p.id, command(p), `test.reconfirm.no-change.invalid-other.${kind}`, 'test-human', current => {
      delete current!.facts[1]!.lifecycleBinding; return current!;
    });
    const before = structuredClone(p);
    const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
    const response = await f.post(`/api/projects/${p.id}/${route}`, command(p, {
      evidenceId: replacement.id, reason: 'A repeat click must still enforce global integrity',
    }));
    assert.equal(response.statusCode, 409, kind); assert.equal(response.json().error.code, 'INVALID_FACT_BINDING', kind);
    assert.deepEqual(await f.store.get(p.id), before, `${kind} repeat must not change the project`);
    assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count),
      receiptCount, `${kind} repeat must not create a receipt`);
  }
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
  maxActor.facts[0]!.lifecycleBinding = createFactLifecycleBinding(maxActor.facts[0]!, maxActor.facts[0]!.confirmedBy!,
    'Validate the maximum persisted actor length', maxActor.facts[0]!.status);
  assert.deepEqual(availableConfirmedFacts(maxActor).map(item => item.id), [maxActor.facts[0]!.id]);
  maxActor.facts[0]!.confirmedBy += 'a';
  assert.throws(() => createLegacyFactBinding(maxActor.facts[0]!, maxActor.evidence[0]!));

  p = await addEvidence(p, 'Capacity corrected: 12 kg');
  const corrected = source(p.evidence[1]!, 'Capacity corrected: 12 kg', '12 kg');
  p = await saveCandidate(p, candidate([corrected], { kind: 'decimal', value: '12', unit: 'kg' },
    { correctsFactId: p.facts[0]!.id }));
  p = await confirm(p, p.facts[1]!, { replaceFactId: p.facts[0]!.id });
  const legacyPredecessor = await details(p, p.facts[0]!);
  assert.equal((legacyPredecessor.commands as { retract: boolean }).retract, false);
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

test('malformed persisted structured payload elements fail details and confirmation closed without TypeError', async () => {
  const mutators: { name: string; mutate: (fact: Fact) => void }[] = [
    { name: 'structured array', mutate: fact => { Reflect.set(fact, 'structured', []); } },
    { name: 'sources primitive', mutate: fact => { Reflect.set(fact.structured!, 'sources', 42); } },
    { name: 'sources null element', mutate: fact => { Reflect.set(fact.structured!, 'sources', [null]); } },
    { name: 'sources primitive element', mutate: fact => { Reflect.set(fact.structured!, 'sources', [42]); } },
    { name: 'sources array element', mutate: fact => { Reflect.set(fact.structured!, 'sources', [[]]); } },
    { name: 'proposed risk null element', mutate: fact => { Reflect.set(fact.structured!, 'proposedRisks', [null]); } },
    { name: 'derived risk primitive element', mutate: fact => { Reflect.set(fact.structured!, 'derivedRisks', [42]); } },
    { name: 'risk policy array', mutate: fact => { Reflect.set(fact.structured!, 'riskPolicy', []); } },
    { name: 'candidate binding array', mutate: fact => { Reflect.set(fact.structured!, 'candidateBinding', []); } },
    { name: 'risk review primitive', mutate: fact => { Reflect.set(fact.structured!, 'riskReview', 42); } },
    { name: 'confirmation array', mutate: fact => { Reflect.set(fact.structured!, 'confirmation', []); } },
    { name: 'applicability null', mutate: fact => { Reflect.set(fact.structured!, 'applicability', null); } },
    { name: 'structured unknown property', mutate: fact => { Reflect.set(fact.structured!, 'untrustedExtension', true); } },
    { name: 'fact unknown property', mutate: fact => { Reflect.set(fact, 'untrustedExtension', true); } },
    { name: 'legacy field present as null', mutate: fact => { Reflect.set(fact, 'legacyBinding', null); } },
    { name: 'lifecycle unknown property', mutate: fact => { Reflect.set(fact.lifecycleBinding!, 'untrustedExtension', true); } },
    { name: 'source review invalid timestamp', mutate: fact => {
      const source = fact.structured!.sources[0]!;
      Reflect.set(source, 'review', { status: 'reconfirmation_required', evidenceId: source.evidenceId,
        decisionId: randomUUID(), usageVersion: 1, actor: 'test-human', at: 'not-a-timestamp', reason: 'Persisted corruption' });
      fact.lifecycleBinding = createFactLifecycleBinding(fact, 'test-human', 'Persist malformed source review', fact.status);
    } },
    { name: 'source review invalid actor type', mutate: fact => {
      const source = fact.structured!.sources[0]!;
      Reflect.set(source, 'review', { status: 'reconfirmation_required', evidenceId: source.evidenceId,
        decisionId: randomUUID(), usageVersion: 1, actor: 42, at: new Date().toISOString(), reason: 'Persisted corruption' });
      fact.lifecycleBinding = createFactLifecycleBinding(fact, 'test-human', 'Persist malformed source review', fact.status);
    } },
    { name: 'source review unknown property', mutate: fact => {
      const source = fact.structured!.sources[0]!;
      Reflect.set(source, 'review', { status: 'reconfirmation_required', evidenceId: source.evidenceId,
        decisionId: randomUUID(), usageVersion: 1, actor: 'test-human', at: new Date().toISOString(), reason: 'Persisted corruption',
        untrustedExtension: true });
      fact.lifecycleBinding = createFactLifecycleBinding(fact, 'test-human', 'Persist malformed source review', fact.status);
    } },
  ];
  for (const item of mutators) {
    let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg');
    p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg')],
      { kind: 'decimal', value: '10', unit: 'kg' }));
    const review = completeRiskReview(p.facts[0]!);
    p = await f.store.command(p.id, command(p), `test.structured-malformed.${item.name}`, 'test-human', current => {
      item.mutate(current!.facts[0]!); return current!;
    });
    const before = structuredClone(p);
    const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
    const detailResponse = await f.app.inject({ url: `/api/projects/${p.id}/facts/${p.facts[0]!.id}/details`, headers: f.headers });
    assert.equal(detailResponse.statusCode, 200, `${item.name}: ${detailResponse.body}`);
    assert.equal(detailResponse.json().integrityValid, false, item.name);
    const response = await f.post(`/api/projects/${p.id}/facts/${p.facts[0]!.id}/structured/confirm`, command(p, review));
    assert.equal(response.statusCode, 409, `${item.name}: ${response.body}`);
    assert.equal(response.json().error.code, 'INVALID_FACT_BINDING', item.name);
    assert.deepEqual(await f.store.get(p.id), before, item.name);
    assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count),
      receiptCount, `${item.name} must not create a receipt`);
  }
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
    { text: '净含量500克', raw: '500克', value: '500', unit: 'g' as const },
    { text: '重量：１．５ ㎏', raw: '１．５ ㎏', value: '1.5', unit: 'kg' as const },
    { text: '重量：10（kg）', raw: '10（kg）', value: '10', unit: 'kg' as const },
    { text: '重量：10㎏', raw: '10㎏', value: '10', unit: 'kg' as const },
    { text: 'Value: 10.', raw: '10', value: '10', unit: 'count' as const, expectedRawUnit: null },
    { text: 'Value: 10 / note', raw: '10', value: '10', unit: 'count' as const, expectedRawUnit: null },
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
    { text: 'Weight: １．５ kg', raw: '５ kg', value: '5', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: １﹒５ kg', raw: '５ kg', value: '5', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Ratio: １／２', raw: '１', value: '1', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: 10（kg）', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Weight: 10㎏', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Weight: 10 [kg]', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Weight: 10【kg】', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Weight: (10) kg', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Weight: 10）kg', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Rate: 10 m/s', raw: '10 m', value: '10', unit: 'm' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Rate: 10 mg·L⁻¹', raw: '10 mg', value: '10', unit: 'mg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Energy: 10 kW·h', raw: '10 kW', value: '10', unit: 'kW' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: ⁻5 kg', raw: '5 kg', value: '5', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: kg 10', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Range: 10-20', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Range: 10–20', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Range: 10~20', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Tolerance: 10±0.5', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Minimum: ≥10', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Approx: ~10', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Open: 10+', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Area: 10×20', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Power: 10²', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Area: 10 m²', raw: '10 m', value: '10', unit: 'm' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Density: 10 kg/m²', raw: '10 kg', value: '10', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Price: $10', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Temperature: 10℃', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Value: 10bananas', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Value: 10 bananas', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Value: 10 unknownUnit', raw: '10', value: '10', unit: 'count' as const, code: 'VALUE_SPAN_OMITS_UNIT' },
    { text: 'Count: 10/kg', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Count: 10⁄kg', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Count: 10∕kg', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Count: 10·kg', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Count: 10⋅kg', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: `Count: 5\u030110`, raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: `Count: 10\u0301kg`, raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: `Count: 10 \u0301kg`, raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Rate: 10/box', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Rate: 10 /box', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Rate: 10 kg·mol', raw: '10 kg', value: '10', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Rate: 10 kg∙mol', raw: '10 kg', value: '10', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Ratio: 10:20', raw: '10', value: '10', unit: 'count' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Density: 10 kg per m²', raw: '10 kg', value: '10', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Density: 10 kg每平方米', raw: '10 kg', value: '10', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Density: 10 kg；per m²', raw: '10 kg', value: '10', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Density: 10 kg​/m²', raw: '10 kg', value: '10', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
    { text: 'Weight: 10 kg​5', raw: '10 kg', value: '10', unit: 'kg' as const, code: 'INCOMPLETE_VALUE_SPAN' },
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
  const invisibleSeparators = [
    ['soft hyphen', '\u00ad'], ['combining grapheme joiner', '\u034f'], ['arabic letter mark', '\u061c'],
    ['mongolian free variation selector', '\u180b'], ['zero width space', '\u200b'], ['zero width non-joiner', '\u200c'],
    ['zero width joiner', '\u200d'], ['left-to-right mark', '\u200e'], ['right-to-left mark', '\u200f'],
    ['left-to-right embedding', '\u202a'], ['right-to-left embedding', '\u202b'], ['pop directional formatting', '\u202c'],
    ['left-to-right override', '\u202d'], ['right-to-left override', '\u202e'], ['word joiner', '\u2060'],
    ['left-to-right isolate', '\u2066'], ['right-to-left isolate', '\u2067'], ['first strong isolate', '\u2068'],
    ['pop directional isolate', '\u2069'], ['text variation selector', '\ufe0e'], ['emoji variation selector', '\ufe0f'],
    ['byte order mark', '\ufeff'], ['supplementary variation selector', '\u{e0100}'],
  ] as const;
  for (const [name, separator] of invisibleSeparators) {
    for (const [position, text] of [
      ['before digit', `Count: 5${separator}10`],
      ['after digit', `Count: 10${separator}5`],
      ['before unit', `Count: 10${separator}kg`],
      ['before operator', `Count: 10${separator}/kg`],
    ] as const) {
      let p = await f.create(); p = await addEvidence(p, text); const before = structuredClone(p);
      const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
      const response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p,
        candidate([source(p.evidence[0]!, text, '10')], { kind: 'decimal', value: '10', unit: 'count' })));
      assert.equal(response.statusCode, 409, `${name} ${position}`);
      assert.equal(response.json().error.code, 'INCOMPLETE_VALUE_SPAN', `${name} ${position}`);
      assert.deepEqual(await f.store.get(p.id), before, `${name} ${position}`);
      assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count),
        receiptCount, `${name} ${position} must not create a receipt`);
    }
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
    { name: 'canonical zero denominator', reason: 'INVALID_STRUCTURED_FACT_VALUE', mutate: fact => {
      fact.structured!.canonicalValue = { kind: 'decimal', dimension: 'mass', numerator: '0', denominator: '0' };
    } },
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

test('structured source identity cannot be replaced by same-text evidence and legitimized by a same-status lifecycle binding', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg', 'original.txt');
  p = await addEvidence(p, 'Capacity: 10 kg', 'unrelated-duplicate.txt');
  p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg')],
    { kind: 'decimal', value: '10', unit: 'kg' })); p = await confirm(p, p.facts[0]!);
  const originalCandidateBinding = structuredClone(p.facts[0]!.structured!.candidateBinding);
  const originalConfirmation = structuredClone(p.facts[0]!.structured!.confirmation);
  p = await f.store.command(p.id, command(p), 'test.fact.same-text-evidence-rebind', 'test-human', current => {
    const fact = current!.facts[0]!; const duplicateEvidenceId = current!.evidence[1]!.id;
    fact.evidenceId = duplicateEvidenceId; fact.structured!.sources[0]!.evidenceId = duplicateEvidenceId;
    fact.lifecycleBinding = createFactLifecycleBinding(fact, 'test-human',
      'Attempt to bless an unrelated evidence identity', fact.status);
    return current!;
  });
  assert.deepEqual(p.facts[0]!.structured!.candidateBinding, originalCandidateBinding);
  assert.deepEqual(p.facts[0]!.structured!.confirmation, originalConfirmation);
  assert.equal(factIntegrityReason(p, p.facts[0]!), 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING');
  assert.equal(projectActiveFactIntegrityIsValid(p), false);
  assert.deepEqual(availableConfirmedFacts(p), []);
});

test('forged structured and legacy reconfirmation chains cannot cross material lineage', async () => {
  for (const kind of ['structured', 'legacy'] as const) {
    let p = await f.write(await f.create(), 'production/initialize');
    p = await addMaterial(p, 'Capacity: 10 kg', `${kind}-original.txt`);
    p = await addMaterial(p, 'Capacity: 10 kg\nUnrelated lot: B', `${kind}-unrelated.txt`);
    p = await decideMaterial(p, 0, 'product_evidence'); p = await decideMaterial(p, 1, 'product_evidence');
    const original = currentMaterialEvidence(p, 0); const unrelated = currentMaterialEvidence(p, 1);
    if (kind === 'structured') {
      p = await saveCandidate(p, candidate([source(original, original.text, '10 kg')],
        { kind: 'decimal', value: '10', unit: 'kg' })); p = await confirm(p, p.facts[0]!);
    } else {
      p = await f.write(p, 'facts/candidates', { attribute: 'capacity', role: 'core', value: '10 kg',
        evidenceId: original.id, quote: '10 kg', reason: 'Legacy cross-lineage fixture' });
      p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'Confirm legacy cross-lineage fixture' });
    }
    p = await f.store.command(p.id, command(p), `test.fact.cross-material-chain.${kind}`, 'test-human', current => {
      const fact = current!.facts[0]!; const replacement = current!.evidence.find(item => item.id === unrelated.id)!;
      const provenance = replacement.materialSource!;
      const reconfirmation = { previousEvidenceId: original.id, evidenceId: replacement.id,
        decisionId: provenance.usageDecisionId, usageVersion: provenance.usageVersion,
        actor: 'test-human', at: new Date().toISOString(), reason: 'Forged cross-material chain' };
      fact.evidenceId = replacement.id;
      if (fact.structured) {
        fact.structured.sources[0]!.evidenceId = replacement.id;
        fact.structured.sources[0]!.reconfirmations = [reconfirmation];
      } else {
        fact.sourceReconfirmations = [reconfirmation];
      }
      fact.lifecycleBinding = createFactLifecycleBinding(fact, 'test-human',
        'Attempt to bless a cross-material evidence chain', fact.status);
      return current!;
    });
    assert.equal(factIntegrityReason(p, p.facts[0]!), kind === 'structured'
      ? 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING' : 'INVALID_LEGACY_FACT_CANDIDATE_BINDING', kind);
    assert.equal(projectActiveFactIntegrityIsValid(p), false, kind);
    assert.deepEqual(availableConfirmedFacts(p), [], kind);
  }
});

test('lifecycle binding digest covers every transition field and confirmation attribution', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Material: steel');
  p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Material: steel', 'steel')],
    { kind: 'text', value: 'steel' }, { attribute: 'material' }));
  p = await confirm(p, p.facts[0]!);
  const mutators: { name: string; mutate: (binding: NonNullable<Fact['lifecycleBinding']>) => void }[] = [
    { name: 'transitionId', mutate: binding => { binding.transitionId = randomUUID(); } },
    { name: 'previousStatus', mutate: binding => { binding.previousStatus = 'confirmed'; } },
    { name: 'status', mutate: binding => { binding.status = 'retracted'; } },
    { name: 'actor', mutate: binding => { binding.actor = 'different-human'; } },
    { name: 'at', mutate: binding => { binding.at = new Date(Date.parse(binding.at) + 1000).toISOString(); } },
    { name: 'reason', mutate: binding => { binding.reason = 'Different persisted transition reason'; } },
    { name: 'unknown property', mutate: binding => { Reflect.set(binding, 'untrustedExtension', true); } },
  ];
  for (const item of mutators) {
    const changed = structuredClone(p); item.mutate(changed.facts[0]!.lifecycleBinding!);
    assert.equal(factIntegrityReason(changed, changed.facts[0]!), 'INVALID_FACT_LIFECYCLE_BINDING', item.name);
  }
  const semanticMutators: { name: string; mutate: (fact: Fact) => void }[] = [
    { name: 'fact attribute', mutate: fact => { fact.attribute = 'forged-attribute'; } },
    { name: 'fact role', mutate: fact => { fact.role = 'supporting'; } },
    { name: 'fact value', mutate: fact => { fact.value = 'forged-value'; } },
    { name: 'fact evidenceId', mutate: fact => { fact.evidenceId = randomUUID(); } },
    { name: 'fact quote', mutate: fact => { fact.quote = 'forged quote'; } },
    { name: 'fact start', mutate: fact => { fact.start++; } },
    { name: 'fact end', mutate: fact => { fact.end++; } },
    { name: 'fact sourceRunId', mutate: fact => { fact.sourceRunId = randomUUID(); } },
    { name: 'fact createdBy', mutate: fact => { fact.createdBy = 'forged-creator'; } },
    { name: 'fact reason', mutate: fact => { fact.reason = 'Forged candidate reason'; } },
    { name: 'fact correction', mutate: fact => { fact.correctsFactId = randomUUID(); } },
  ];
  for (const item of semanticMutators) {
    const changed = structuredClone(p); item.mutate(changed.facts[0]!);
    assert.equal(factLifecycleBindingIsValid(changed.facts[0]!), false, item.name);
  }
  assert.throws(() => createFactLifecycleBinding(p.facts[0]!, 'different-human',
    'Mismatched confirmation actor', 'candidate', p.facts[0]!.confirmedAt));
  assert.throws(() => createFactLifecycleBinding(p.facts[0]!, p.facts[0]!.confirmedBy!,
    'Mismatched confirmation time', 'candidate', new Date(Date.parse(p.facts[0]!.confirmedAt!) + 1000).toISOString()));
});

test('retracted lifecycle tampering fails every structured and legacy consumer closed without rewriting history', async () => {
  for (const kind of ['structured', 'legacy'] as const) {
    let p = await f.create(); p = await f.write(p, 'identity/confirm', { productName: `${kind} lifecycle fixture` });
    p = await addEvidence(p, 'Material: steel');
    if (kind === 'structured') {
      p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Material: steel', 'steel')],
        { kind: 'text', value: 'steel' }, { attribute: 'material' })); p = await confirm(p, p.facts[0]!);
    } else {
      p = await f.write(p, 'facts/candidates', { attribute: 'material', role: 'core', value: 'steel',
        evidenceId: p.evidence[0]!.id, quote: 'steel', reason: 'Legacy lifecycle fixture' });
      p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'Confirm legacy lifecycle fixture' });
    }
    const factId = p.facts[0]!.id;
    p = await f.store.command(p.id, command(p), `test.lifecycle.downstream.${kind}`, 'test-human', current => {
      current!.storyboard = seedStoryboard(randomUUID(), [factId]);
      current!.sections.push(seedSection(randomUUID(), [factId])); current!.currentSectionId = current!.sections[0]!.id; return current!;
    });
    p = await f.write(p, `facts/${factId}/retract`, { reason: 'Legitimate explicit retraction' });
    assert.equal(factIntegrityIsValid(p, p.facts[0]!), true, kind);
    p = await f.store.command(p.id, command(p), `test.lifecycle.restore.${kind}`, 'test-human', current => {
      current!.facts[0]!.status = 'confirmed'; current!.facts[0]!.locked = true; return current!;
    });
    const persisted = structuredClone(p);
    assert.equal(factIntegrityReason(p, p.facts[0]!), 'INVALID_FACT_LIFECYCLE_BINDING', kind);
    assert.deepEqual(availableConfirmedFacts(p), [], kind);
    assert.deepEqual(skillInput(p, 'plan-section').confirmedFacts, [], kind);
    assert.throws(() => checkSkillInputs(p, 'plan-section'), kind);
    const detail = await details(p, p.facts[0]!);
    assert.equal(detail.integrityValid, false, kind); assert.equal((detail.commands as { confirm: boolean }).confirm, false, kind);
    const checked = structuredClone(p); preflight(checked);
    assert.equal(checked.qa!.issueSeverity, 'blocker', kind);
    assert.ok(checked.qa!.issues.includes('UNRESOLVED_FACT_CONFLICT'), kind);
    assert.ok(checked.qa!.issues.includes(`INVALID_FACT_EVIDENCE:${factId}`), kind);
    assert.deepEqual(await f.store.get(p.id), persisted, `${kind} reads must not rewrite history`);
  }
});

test('invalid candidate lifecycle and arbitrary supersession stay visible and block both confirmation paths atomically', async () => {
  let rejected = await f.write(await f.create(), 'production/initialize'); rejected = await addEvidence(rejected, 'Material: steel');
  rejected = await saveCandidate(rejected, candidate([source(rejected.evidence[0]!, 'Material: steel', 'steel')],
    { kind: 'text', value: 'steel' }, { attribute: 'material' }));
  rejected = await f.write(rejected, `facts/${rejected.facts[0]!.id}/reject`, { reason: 'Reject before persisted tampering' });
  rejected = await f.store.command(rejected.id, command(rejected), 'test.lifecycle.revive.rejected', 'test-human', current => {
    current!.facts[0]!.status = 'candidate'; return current!;
  });
  let centerResponse = await f.app.inject({ url: `/api/projects/${rejected.id}/production/material-reviews`, headers: f.headers });
  let reviewTask = centerResponse.json().tasks.find((item: { type: string; factId?: string }) =>
    item.type === 'fact_review' && item.factId === rejected.facts[0]!.id);
  assert.equal(reviewTask.status, 'blocked'); assert.equal(reviewTask.blockedReason, 'INVALID_FACT_BINDING');

  let p = await f.write(await f.create(), 'production/initialize');
  p = await addEvidence(p, 'Capacity: 10 kg'); p = await addEvidence(p, 'Capacity: 12 kg');
  p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg')],
    { kind: 'decimal', value: '10', unit: 'kg' }));
  p = await saveCandidate(p, candidate([source(p.evidence[1]!, 'Capacity: 12 kg', '12 kg')],
    { kind: 'decimal', value: '12', unit: 'kg' }));
  p = await f.store.command(p.id, command(p), 'test.fact.arbitrary-supersession', 'test-human', current => {
    const blocker = current!.facts[0]!; blocker.supersededByFactId = current!.facts[1]!.id;
    blocker.lifecycleBinding = createFactLifecycleBinding(blocker, 'test-human', 'Persisted arbitrary pointer fixture', blocker.status);
    return current!;
  });
  assert.equal(factIntegrityReason(p, p.facts[0]!), 'INVALID_FACT_SUPERSESSION');
  assert.equal(factGovernanceHasBlockingIssue(p), true);
  centerResponse = await f.app.inject({ url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers });
  const tasks = centerResponse.json().tasks.filter((item: { type: string }) => item.type === 'fact_review');
  assert.equal(tasks.length, 2); assert.ok(tasks.every((item: { status: string; blockedReason: string }) =>
    item.status === 'blocked' && item.blockedReason === 'INVALID_FACT_BINDING'));
  const detail = await details(p, p.facts[1]!); assert.equal((detail.commands as { confirm: boolean }).confirm, false);
  let before = structuredClone(p); let receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
  let response = await f.post(`/api/projects/${p.id}/facts/${p.facts[1]!.id}/structured/confirm`,
    command(p, completeRiskReview(p.facts[1]!)));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_FACT_BINDING');
  assert.deepEqual(await f.store.get(p.id), before);
  assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count), receiptCount);

  let legacy = await f.create(); legacy = await addEvidence(legacy, 'Material: steel'); legacy = await addEvidence(legacy, 'Color: blue');
  legacy = await f.write(legacy, 'facts/candidates', { attribute: 'material', role: 'core', value: 'steel',
    evidenceId: legacy.evidence[0]!.id, quote: 'steel', reason: 'Invalid active legacy fixture' });
  legacy = await f.write(legacy, 'facts/candidates', { attribute: 'color', role: 'core', value: 'blue',
    evidenceId: legacy.evidence[1]!.id, quote: 'blue', reason: 'Legacy confirmation target' });
  legacy = await f.store.command(legacy.id, command(legacy), 'test.lifecycle.remove.other', 'test-human', current => {
    delete current!.facts[0]!.lifecycleBinding; return current!;
  });
  before = structuredClone(legacy); receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
  response = await f.post(`/api/projects/${legacy.id}/facts/${legacy.facts[1]!.id}/confirm`,
    command(legacy, { reason: 'Must not confirm around another invalid active fact' }));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_FACT_BINDING');
  assert.deepEqual(await f.store.get(legacy.id), before);
  assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count), receiptCount);
});

test('a forged inactive status cannot hide an active lifecycle record from the project integrity guard', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg'); p = await addEvidence(p, 'Capacity: 12 kg');
  p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg')],
    { kind: 'decimal', value: '10', unit: 'kg' })); p = await confirm(p, p.facts[0]!);
  p = await saveCandidate(p, candidate([source(p.evidence[1]!, 'Capacity: 12 kg', '12 kg')],
    { kind: 'decimal', value: '12', unit: 'kg' }));
  const targetId = p.facts[1]!.id;
  p = await f.store.command(p.id, command(p), 'test.lifecycle.hide-active-as-rejected', 'test-human', current => {
    current!.facts[0]!.status = 'rejected';
    return current!;
  });
  assert.equal(p.facts[0]!.lifecycleBinding!.status, 'confirmed');
  assert.equal(projectActiveFactIntegrityIsValid(p), false);
  assert.equal(factGovernanceHasBlockingIssue(p), true);
  assert.ok(evaluateFactEligibility(p, p.facts[1]!).reasons.includes('PROJECT_FACT_INTEGRITY_FAILURE'));
  const before = structuredClone(p);
  const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
  const response = await f.post(`/api/projects/${p.id}/facts/${targetId}/structured/confirm`,
    command(p, completeRiskReview(p.facts[1]!)));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_FACT_BINDING');
  assert.deepEqual(await f.store.get(p.id), before);
  assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count), receiptCount);
});

test('a confirmed fact cannot erase its confirmation history and re-sign as a rejected candidate', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg'); p = await addEvidence(p, 'Capacity: 12 kg');
  p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg')],
    { kind: 'decimal', value: '10', unit: 'kg' })); p = await confirm(p, p.facts[0]!);
  p = await saveCandidate(p, candidate([source(p.evidence[1]!, 'Capacity: 12 kg', '12 kg')],
    { kind: 'decimal', value: '12', unit: 'kg' }));
  const targetId = p.facts[1]!.id;
  const forged = structuredClone(p); const hidden = forged.facts[0]!;
  hidden.status = 'rejected'; hidden.locked = false;
  delete hidden.confirmedBy; delete hidden.confirmedAt;
  delete hidden.structured!.riskReview; delete hidden.structured!.confirmation;
  assert.throws(() => createFactLifecycleBinding(hidden, 'test-human',
    'A confirmed lifecycle cannot claim candidate ancestry', 'candidate'));

  // Even a two-step attempt to discard the current envelope and create a fresh candidate branch must remain visible
  // through the persisted project audit. Hashes are never treated as permission to erase an accepted transition.
  hidden.status = 'candidate'; delete hidden.lifecycleBinding;
  hidden.lifecycleBinding = createFactLifecycleBinding(hidden, 'test-human', 'Attempt to restart lifecycle history', null);
  hidden.status = 'rejected';
  hidden.lifecycleBinding = createFactLifecycleBinding(hidden, 'test-human', 'Attempt to hide prior confirmation', 'candidate');
  assert.equal(factLifecycleBindingIsValid(hidden), true);
  assert.equal(factIntegrityReason(forged, hidden), 'INVALID_FACT_LIFECYCLE_BINDING');
  assert.equal(projectActiveFactIntegrityIsValid(forged), false);
  assert.deepEqual(availableConfirmedFacts(forged), []);
  p = await f.store.command(p.id, command(p), 'test.lifecycle.erase-confirmation-history', 'test-human', current => {
    current!.facts[0] = structuredClone(hidden); return current!;
  });
  assert.equal(factIntegrityReason(p, p.facts[0]!), 'INVALID_FACT_LIFECYCLE_BINDING');
  const before = structuredClone(p);
  const response = await f.post(`/api/projects/${p.id}/facts/${targetId}/structured/confirm`,
    command(p, completeRiskReview(p.facts[1]!)));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_FACT_BINDING');
  assert.deepEqual(await f.store.get(p.id), before);
});

test('deleting a lifecycle domain event or its whole command revision cannot erase confirmation history', async () => {
  for (const removeWholeCommand of [false, true]) {
    let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg'); p = await addEvidence(p, 'Capacity: 12 kg');
    p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg')],
      { kind: 'decimal', value: '10', unit: 'kg' })); p = await confirm(p, p.facts[0]!);
    const hiddenId = p.facts[0]!.id;
    p = await saveCandidate(p, candidate([source(p.evidence[1]!, 'Capacity: 12 kg', '12 kg')],
      { kind: 'decimal', value: '12', unit: 'kg' }));
    const targetId = p.facts[1]!.id;
    p = await f.store.command(p.id, command(p), `test.lifecycle.delete-audit-${removeWholeCommand}`, 'test-human', current => {
      const hidden = current!.facts[0]!;
      hidden.status = 'candidate'; hidden.locked = false;
      delete hidden.confirmedBy; delete hidden.confirmedAt;
      delete hidden.structured!.riskReview; delete hidden.structured!.confirmation; delete hidden.lifecycleBinding;
      hidden.lifecycleBinding = createFactLifecycleBinding(hidden, 'test-human', 'Restart after deleting confirmation audit', null);
      hidden.status = 'rejected';
      hidden.lifecycleBinding = createFactLifecycleBinding(hidden, 'test-human', 'Hide deleted confirmation audit', 'candidate');
      current!.audit = current!.audit.filter(entry => entry.type !== 'fact.structured_confirmed'
        && (!removeWholeCommand || entry.type !== `fact.${hiddenId}.structured.confirm`));
      return current!;
    });
    assert.equal(factIntegrityReason(p, p.facts[0]!), 'INVALID_FACT_LIFECYCLE_BINDING',
      removeWholeCommand ? 'deleted command revision' : 'deleted domain event');
    assert.equal(projectActiveFactIntegrityIsValid(p), false);
    const before = structuredClone(p);
    const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
    const response = await f.post(`/api/projects/${p.id}/facts/${targetId}/structured/confirm`,
      command(p, completeRiskReview(p.facts[1]!)));
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().error.code, 'INVALID_FACT_BINDING');
    assert.deepEqual(await f.store.get(p.id), before);
    assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count), receiptCount);
  }
});

test('a valid inactive lifecycle envelope cannot quarantine malformed fact content implicitly', async () => {
  let p = await f.create(); p = await addEvidence(p, 'Capacity: 10 kg'); p = await addEvidence(p, 'Capacity: 12 kg');
  p = await saveCandidate(p, candidate([source(p.evidence[0]!, 'Capacity: 10 kg', '10 kg')],
    { kind: 'decimal', value: '10', unit: 'kg' }));
  p = await saveCandidate(p, candidate([source(p.evidence[1]!, 'Capacity: 12 kg', '12 kg')],
    { kind: 'decimal', value: '12', unit: 'kg' }));
  const targetId = p.facts[1]!.id;
  p = await f.store.command(p.id, command(p), 'test.lifecycle.hide-malformed-as-rejected', 'test-human', current => {
    const hidden = current!.facts[0]!; hidden.status = 'rejected';
    Reflect.set(hidden.structured!, 'untrustedExtension', true);
    hidden.lifecycleBinding = createFactLifecycleBinding(hidden, 'test-human',
      'Forge a syntactically valid candidate-to-rejected transition', 'candidate');
    return current!;
  });
  assert.equal(factLifecycleBindingIsValid(p.facts[0]!), true,
    'the lifecycle envelope alone is valid so the project guard must also validate inactive fact content');
  assert.equal(factIntegrityIsValid(p, p.facts[0]!), false);
  assert.equal(projectActiveFactIntegrityIsValid(p), false);
  const before = structuredClone(p);
  const response = await f.post(`/api/projects/${p.id}/facts/${targetId}/structured/confirm`,
    command(p, completeRiskReview(p.facts[1]!)));
  assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'INVALID_FACT_BINDING');
  assert.deepEqual(await f.store.get(p.id), before);
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
    recreateStructuredProofForPersistedFixture(current!.facts[1]!);
    current!.facts[1]!.lifecycleBinding = createFactLifecycleBinding(current!.facts[1]!, 'test-human',
      'Persisted applicability migration fixture', current!.facts[1]!.status);
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

test('legacy candidates require a strict persisted shape and immutable candidate proof before confirmation', async () => {
  const mutators: { name: string; mutate: (fact: Fact, duplicateEvidenceId: string) => void }[] = [
    { name: 'id', mutate: fact => { fact.id = randomUUID(); } },
    { name: 'attribute', mutate: fact => { fact.attribute = 'forged attribute'; } },
    { name: 'attribute type', mutate: fact => { Reflect.set(fact, 'attribute', 42); } },
    { name: 'role', mutate: fact => { Reflect.set(fact, 'role', 'administrator'); } },
    { name: 'value', mutate: fact => { fact.value = 'bronze'; } },
    { name: 'same-text evidence identity', mutate: (fact, evidenceId) => { fact.evidenceId = evidenceId; } },
    { name: 'quote', mutate: fact => { fact.quote = 'Material'; } },
    { name: 'start', mutate: fact => { fact.start = 0; } },
    { name: 'end', mutate: fact => { fact.end++; } },
    { name: 'sourceRunId', mutate: fact => { fact.sourceRunId = randomUUID(); } },
    { name: 'createdBy', mutate: fact => { fact.createdBy = 'forged-creator'; } },
    { name: 'reason', mutate: fact => { fact.reason = 'Forged candidate reason'; } },
    { name: 'correctsFactId', mutate: fact => { fact.correctsFactId = randomUUID(); } },
    { name: 'candidate lock', mutate: fact => { fact.locked = true; } },
    { name: 'candidate binding', mutate: fact => { Reflect.deleteProperty(fact, 'legacyCandidateBinding'); } },
    { name: 'unknown property', mutate: fact => { Reflect.set(fact, 'forgedProperty', true); } },
  ];
  for (const item of mutators) {
    let p = await f.create(); p = await addEvidence(p, 'Material: steel', 'original.txt');
    p = await addEvidence(p, 'Material: steel', 'same-text.txt');
    p = await f.write(p, 'facts/candidates', { attribute: 'material', role: 'core', value: 'steel',
      evidenceId: p.evidence[0]!.id, quote: 'steel', reason: 'Bound legacy candidate fixture' });
    p = await f.store.command(p.id, command(p), `test.legacy-candidate-shape.${item.name}`, 'test-human', current => {
      item.mutate(current!.facts[0]!, current!.evidence[1]!.id); return current!;
    });
    const fact = p.facts[0]!;
    assert.equal(factIntegrityIsValid(p, fact), false, item.name);
    const detailResponse = await f.app.inject({ url: `/api/projects/${p.id}/facts/${String(fact.id)}/details`, headers: f.headers });
    assert.equal(detailResponse.statusCode, 200, `${item.name}: ${detailResponse.body}`);
    assert.equal(detailResponse.json().integrityValid, false, item.name);
    const before = structuredClone(p);
    const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
    const response = await f.post(`/api/projects/${p.id}/facts/${String(fact.id)}/confirm`, command(p, {
      reason: 'Persisted candidate must validate before confirmation',
    }));
    assert.equal(response.statusCode, 409, `${item.name}: ${response.body}`);
    assert.equal(response.json().error.code, 'INVALID_FACT_BINDING', item.name);
    assert.deepEqual(await f.store.get(p.id), before, item.name);
    assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count),
      receiptCount, `${item.name} must not create a receipt`);
  }
});

test('malformed persisted legacy fact fields fail every confirmed consumer closed without TypeError', async () => {
  let p = await f.create(); p = await f.write(p, 'identity/confirm', { productName: 'Malformed legacy fixture' });
  p = await addEvidence(p, 'Material: steel');
  p = await f.write(p, 'facts/candidates', { attribute: 'material', role: 'core', value: 'steel',
    evidenceId: p.evidence[0]!.id, quote: 'steel', reason: 'Confirmed malformed legacy fixture' });
  p = await f.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'Confirm before persisted corruption' });
  const factId = p.facts[0]!.id;
  p = await f.store.command(p.id, command(p), 'test.legacy-malformed-runtime-shape', 'test-human', current => {
    current!.storyboard = seedStoryboard(randomUUID(), [factId]);
    current!.sections.push(seedSection(randomUUID(), [factId])); current!.currentSectionId = current!.sections[0]!.id;
    Reflect.set(current!.facts[0]!, 'attribute', 42); return current!;
  });
  const persisted = structuredClone(p);
  assert.equal(factIntegrityIsValid(p, p.facts[0]!), false);
  assert.deepEqual(availableConfirmedFacts(p), []);
  assert.deepEqual(skillInput(p, 'plan-section').confirmedFacts, []);
  assert.throws(() => checkSkillInputs(p, 'plan-section'), error =>
    typeof error === 'object' && error !== null && Reflect.get(error, 'statusCode') === 409);
  const detailResponse = await f.app.inject({ url: `/api/projects/${p.id}/facts/${factId}/details`, headers: f.headers });
  assert.equal(detailResponse.statusCode, 200, detailResponse.body);
  assert.equal(detailResponse.json().integrityValid, false);
  const checked = structuredClone(p); preflight(checked);
  assert.equal(checked.qa!.issueSeverity, 'blocker');
  assert.ok(checked.qa!.issues.includes('UNRESOLVED_FACT_CONFLICT'));
  assert.ok(checked.qa!.issues.includes(`INVALID_FACT_EVIDENCE:${factId}`));
  const receiptCount = Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
  const response = await f.post(`/api/projects/${p.id}/storyboard/draft`, command(p, {
    chapters: [{ role: 'feature', purpose: 'must reject malformed legacy data', factIds: [factId] }],
    reason: 'Malformed legacy data must not reach a write path',
  }));
  assert.equal(response.statusCode, 409, response.body);
  assert.deepEqual(await f.store.get(p.id), persisted);
  assert.equal(Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count), receiptCount);
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
    assert.ok(evaluateFactEligibility(p, p.facts[0]!).reasons.includes('INVALID_LEGACY_FACT_CONTRACT'), item.name);
    assert.deepEqual(skillInput(p, 'plan-section').confirmedFacts, [], item.name);
    assert.throws(() => checkSkillInputs(p, 'plan-section'), item.name);
    const checked = structuredClone(p); preflight(checked);
    assert.equal(checked.qa!.issueSeverity, 'blocker', item.name);
    assert.ok(checked.qa!.issues.includes('UNRESOLVED_FACT_CONFLICT'), item.name);
    assert.ok(checked.qa!.issues.includes(`INVALID_FACT_EVIDENCE:${p.facts[0]!.id}`), item.name);
    assert.deepEqual(await f.store.get(p.id), persisted, `${item.name} reads must not rewrite history`);
  }
});

test('material review center blocks a conflicting source recovery and exposes invalid supersession', async () => {
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
    recreateStructuredProofForPersistedFixture(fact); fact.issueSeverity = 'none';
    fact.lifecycleBinding = createFactLifecycleBinding(fact, 'test-human',
      'Persisted applicability review fixture', fact.status); return current!;
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
  assert.equal(task.status, 'blocked'); assert.equal(task.blockedReason, 'INVALID_FACT_BINDING');
});
