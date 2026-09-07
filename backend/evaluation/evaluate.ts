import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CONTRACT_VERSION, draftState, extractionSchema, planSchema, skillSchema, type Fact } from '../src/contracts.js';
import { applyOutput, checkSkillInputs, createProject, failureCode, refreshConflicts } from '../src/domain.js';
import { createFactLifecycleBinding, createLegacyFactBinding, createLegacyFactCandidateBinding } from '../src/production-fact-sources.js';
import { audit } from '../src/store.js';

const expectedFact = z.object({ attribute: z.string().min(1), value: z.string().min(1) }).strict();
export const fixtureSchema = z.object({
  id: z.string().min(1), provenance: z.enum(['synthetic', 'human-curated']),
  skill: skillSchema,
  productName: z.string().min(1).optional(),
  evidence: z.array(z.object({ id: z.string().uuid(), text: z.string().min(1), locator: z.string().min(1) }).strict()).min(1),
  facts: z.array(z.object({ id: z.string().uuid(), attribute: z.string().min(1), value: z.string().min(1),
    role: z.enum(['core', 'supporting']), evidenceId: z.string().uuid(), quote: z.string().min(1),
    status: z.enum(['candidate', 'confirmed', 'rejected', 'retracted']) }).strict()).default([]),
  expectedFacts: z.array(expectedFact),
  expectedConflictAttributes: z.array(z.string().min(1)).default([]),
}).strict();
export type Fixture = z.infer<typeof fixtureSchema>;

// Legacy complete-record schema for manual imports; runner.1 also represents partial/unknown usage.
export const recordedRunSchema = z.object({
  modelId: z.string().regex(/^[^\s/]+\/[^\s]+$/), provider: z.string().min(1),
  fixtureId: z.string().min(1), inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  budget: z.object({ maxRequests: z.number().int().positive(), maxOutputTokens: z.number().int().positive(), maxCostUsd: z.number().positive() }).strict(),
  observed: z.object({ requestId: z.string().min(1), latencyMs: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(), finishReason: z.string().min(1) }).strict(),
}).strict();

export function projectFromFixture(fixture: Fixture) {
  const project = createProject(fixture.id);
  project.evidence = fixture.evidence.map(e => ({ ...e, documentName: fixture.id, usage: 'product_evidence',
    sha256: createHash('sha256').update(e.text).digest('hex'), objectKey: 'offline', createdBy: 'fixture' }));
  if (fixture.productName) project.identity = { productName: fixture.productName, confirmedBy: 'fixture', confirmedAt: '2000-01-01T00:00:00Z' };
  project.facts = fixture.facts.map(f => {
    const evidence = project.evidence.find(e => e.id === f.evidenceId);
    const start = evidence?.text.indexOf(f.quote) ?? -1;
    if (start < 0) throw new Error('INVALID_FIXTURE_EVIDENCE');
    const targetStatus = f.status;
    const fact: Fact = { ...f, start, end: start + f.quote.length, status: 'candidate', locked: false,
      sourceRunId: 'fixture', issueSeverity: 'none' };
    delete fact.confirmedBy; delete fact.confirmedAt;
    fact.legacyCandidateBinding = createLegacyFactCandidateBinding(fact);
    fact.lifecycleBinding = createFactLifecycleBinding(fact, 'fixture', 'Loaded bounded offline fixture', null,
      '2000-01-01T00:00:00Z');
    audit(project, 'fact.candidate_saved', 'fixture', { factId: fact.id, reason: 'Loaded bounded offline fixture' });
    audit(project, 'fact.candidate', 'fixture');
    if (targetStatus === 'confirmed' || targetStatus === 'retracted') {
      fact.status = 'confirmed'; fact.locked = true;
      fact.confirmedBy = 'fixture'; fact.confirmedAt = '2000-01-01T00:00:00Z';
      fact.legacyBinding = createLegacyFactBinding(fact, evidence!);
      fact.lifecycleBinding = createFactLifecycleBinding(fact, 'fixture', 'Loaded bounded offline confirmation',
        'candidate', fact.confirmedAt);
      audit(project, 'fact.confirm', 'fixture', { factId: fact.id, reason: 'Loaded bounded offline confirmation' });
      audit(project, `fact.${fact.id}.confirm`, 'fixture');
    }
    if (targetStatus === 'rejected') {
      fact.status = 'rejected';
      fact.lifecycleBinding = createFactLifecycleBinding(fact, 'fixture', 'Loaded bounded offline rejection',
        'candidate', '2000-01-01T00:00:00Z');
      audit(project, 'fact.reject', 'fixture', { factId: fact.id, reason: 'Loaded bounded offline rejection' });
      audit(project, `fact.${fact.id}.reject`, 'fixture');
    } else if (targetStatus === 'retracted') {
      fact.status = 'retracted'; fact.locked = false;
      fact.lifecycleBinding = createFactLifecycleBinding(fact, 'fixture', 'Loaded bounded offline retraction',
        'confirmed', '2000-01-01T00:00:00Z');
      audit(project, 'fact.retract', 'fixture', { factId: fact.id, reason: 'Loaded bounded offline retraction' });
      audit(project, `fact.${fact.id}.retract`, 'fixture');
    }
    return fact;
  });
  if (new Set(fixture.evidence.map(e => e.id)).size !== fixture.evidence.length || new Set(fixture.facts.map(f => f.id)).size !== fixture.facts.length) throw new Error('DUPLICATE_FIXTURE_ID');
  refreshConflicts(project);
  return project;
}

export function evaluate(input: unknown, raw: unknown) {
  const fixture = fixtureSchema.parse(input);
  const failures: string[] = [];
  const project = projectFromFixture(fixture);
  const parsed = (fixture.skill === 'extract-facts' ? extractionSchema : planSchema).safeParse(raw);
  if (!parsed.success) failures.push('INVALID_MODEL_OUTPUT');
  else {
    try {
      checkSkillInputs(project, fixture.skill);
      applyOutput(project, { ...draftState(), id: randomUUID(), skill: fixture.skill, requestedBy: 'offline-evaluator',
        attempt: 1, queueStatus: 'claimed', contextVersion: project.version, contextRevision: project.revision }, parsed.data);
    } catch (error) { failures.push(failureCode(error)); }
  }
  if (fixture.skill === 'extract-facts') {
    const extraction = extractionSchema.safeParse(raw);
    if (extraction.success) {
      const same = (a: { attribute: string; value: string }, b: { attribute: string; value: string }) => a.attribute === b.attribute && a.value === b.value;
      fixture.expectedFacts.forEach((f, i) => { if (!extraction.data.facts.some(actual => same(actual, f))) failures.push(`EXPECTED_FACT_MISSING:${i}`); });
      extraction.data.facts.forEach((f, i) => { if (!fixture.expectedFacts.some(expected => same(expected, f))) failures.push(`UNEXPECTED_CLAIM:${i}`); });
      fixture.expectedConflictAttributes.forEach((attribute, i) => {
        if (project.facts.filter(f => f.attribute === attribute && f.issueSeverity === 'blocker').length < 2) failures.push(`CONFLICT_NOT_PRESERVED:${i}`);
      });
    }
  }
  return { reportVersion: '1', contractVersion: CONTRACT_VERSION, fixtureId: fixture.id, provenance: fixture.provenance,
    skill: fixture.skill, inputSha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
    outputSha256: createHash('sha256').update(JSON.stringify(raw) ?? 'undefined').digest('hex'),
    automaticChecksPassed: failures.length === 0, failures, businessAcceptance: false,
    verdict: failures.length ? 'failed' : 'needs_human_review',
    humanReviewRequired: ['quote_entails_claim', 'units_and_model_scope', 'source_instruction_injection',
      ...(fixture.skill === 'plan-section' ? ['purpose_contains_no_ad_copy_or_approval', 'chapter_order_and_missing_inputs'] : ['gold_labels_complete_and_correct'])] };
}
