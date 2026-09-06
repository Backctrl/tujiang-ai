import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CONTRACT_VERSION, draftState, type Fact, type Project, type Skill, type AgentRun, type Plan, type Storyboard, type Section, extractionSchema, planSchema, candidateSchema } from './contracts.js';
import { AppError } from './errors.js';
import { audit } from './store.js';

export function createProject(name: string): Project {
  return { id: randomUUID(), name, version: 1, revision: 1, inputRevision: 1, currentSectionId: null, contractVersion: CONTRACT_VERSION,
    evidence: [], facts: [], runs: [], sections: [], audit: [] };
}
const key = (s: string) => s.normalize('NFKC').trim().toLocaleLowerCase();
function conflicts(p: Project, f: Fact) {
  return p.facts.some(other => other.id !== f.id && ['candidate', 'confirmed'].includes(other.status)
    && ((key(other.attribute) === key(f.attribute) && key(other.value) !== key(f.value))
      || (other.correctsFactId === f.id || f.correctsFactId === other.id)));
}
export function refreshConflicts(p: Project) {
  for (const f of p.facts) f.issueSeverity = ['candidate', 'confirmed'].includes(f.status) && conflicts(p, f) ? 'blocker' : 'none';
  for (const s of p.sections) s.issueSeverity = s.factIds.some(id => p.facts.find(f => f.id === id)?.issueSeverity === 'blocker') ? 'blocker' : 'none';
}
export function reviewFact(p: Project, factId: string, action: 'confirm' | 'reject' | 'retract', actor: string, reason: string) {
  const fact = p.facts.find(f => f.id === factId);
  if (!fact) throw new AppError('FACT_NOT_FOUND', 404);
  if (action === 'confirm') {
    if (fact.status !== 'candidate') throw new AppError('FACT_NOT_CANDIDATE', 409);
    if (conflicts(p, fact)) throw new AppError('UNRESOLVED_FACT_CONFLICT', 409);
    if (!p.evidence.some(e => e.id === fact.evidenceId && e.usage === 'product_evidence' && e.text.slice(fact.start, fact.end) === fact.quote)) throw new AppError('INVALID_EVIDENCE', 409);
    fact.status = 'confirmed'; fact.locked = true;
    fact.confirmedBy = actor; fact.confirmedAt = new Date().toISOString();
  } else if (action === 'reject') {
    if (fact.status !== 'candidate') throw new AppError('FACT_NOT_CANDIDATE', 409);
    fact.status = 'rejected';
  } else {
    if (fact.status !== 'confirmed') throw new AppError('FACT_NOT_CONFIRMED', 409);
    fact.status = 'retracted'; fact.locked = false;
    for (const s of p.sections) if (s.factIds.includes(factId)) s.freshness = 'stale';
    if (p.storyboard?.chapters.some(c => c.factIds.includes(factId))) p.storyboard.freshness = 'stale';
    for (const b of p.storyboardCandidates ?? []) if (b.chapters.some(c => c.factIds.includes(factId))) b.freshness = 'stale';
  }
  if (action !== 'reject') p.version++;
  refreshConflicts(p);
  audit(p, `fact.${action}`, actor, { factId, reason, evidenceId: fact.evidenceId });
}
export function checkSkillInputs(p: Project, skill: Skill) {
  if (skill === 'extract-facts' && !p.evidence.length) throw new AppError('EVIDENCE_REQUIRED', 409);
  if (skill === 'plan-section') {
    if (!p.identity) throw new AppError('CONFIRMED_PRODUCT_IDENTITY_REQUIRED', 409);
    if (!p.facts.some(f => f.status === 'confirmed' && f.role === 'core' && f.issueSeverity === 'none')) throw new AppError('CONFIRMED_CORE_FACT_REQUIRED', 409);
    if (p.facts.some(f => f.issueSeverity === 'blocker')) throw new AppError('UNRESOLVED_FACT_CONFLICT', 409);
  }
}
export function enqueue(p: Project, skill: Skill, actor: string) {
  checkSkillInputs(p, skill);
  if (p.runs.some(r => r.queueStatus !== 'done')) throw new AppError('RUN_ALREADY_ACTIVE', 409);
  p.runs.push({ ...draftState(), id: randomUUID(), skill, requestedBy: actor, queueStatus: 'queued', attempt: 0 });
}
export function retryRun(p: Project, id: string) {
  const run = p.runs.find(r => r.id === id);
  if (!run) throw new AppError('RUN_NOT_FOUND', 404);
  if (run.runStatus !== 'failed' || run.queueStatus !== 'done') throw new AppError('RUN_NOT_RETRYABLE', 409);
  if (p.runs.some(r => r.queueStatus !== 'done')) throw new AppError('RUN_ALREADY_ACTIVE', 409);
  checkSkillInputs(p, run.skill);
  run.queueStatus = 'queued'; run.runStatus = 'idle'; run.freshness = 'current';
  delete run.errorCode; delete run.output;
}
export function applyOutput(p: Project, run: AgentRun, raw: unknown) {
  const inputChanged = run.contextInputRevision === undefined
    ? run.contextRevision !== p.revision
    : run.contextInputRevision !== p.inputRevision;
  if (run.contextVersion !== p.version || inputChanged) throw new AppError('STALE_INPUT', 409);
  if (run.skill === 'extract-facts') {
    const output = extractionSchema.parse(raw);
    const facts = output.facts.map(f => {
      const evidence = p.evidence.find(e => e.id === f.evidenceId);
      const start = evidence?.text.indexOf(f.quote) ?? -1;
      if (!evidence || start < 0) throw new AppError('INVALID_EVIDENCE_REFERENCE');
      return { ...f, id: randomUUID(), start, end: start + f.quote.length, sourceRunId: run.id,
        status: 'candidate' as const, locked: false, issueSeverity: 'none' as const };
    });
    // Re-extraction cannot resurrect rejected values or mutate previously confirmed facts.
    for (const fact of facts) if (!p.facts.some(f => key(f.attribute) === key(fact.attribute) && key(f.value) === key(fact.value))) p.facts.push(fact);
    refreshConflicts(p);
  } else {
    checkSkillInputs(p, run.skill);
    const output = planSchema.parse(raw);
    const refs = [...output.chapters.flatMap(c => c.factIds), ...output.section.factIds];
    if (refs.some(id => !p.facts.some(f => f.id === id && f.status === 'confirmed' && f.issueSeverity === 'none'))) throw new AppError('UNCONFIRMED_FACT_REFERENCE');
    if (output.section.factIds.some(id => !output.chapters.some(c => c.factIds.includes(id)))) throw new AppError('SECTION_OUTSIDE_STORYBOARD');
    const storyboard: Storyboard = { id: randomUUID(), chapters: output.chapters, sourceRunId: run.id,
      identityRevision: p.identityRevision ?? 1, freshness: 'current', approvalStatus: 'draft' };
    (p.storyboardCandidates ??= []).push(storyboard);
    const section = { ...draftState(), id: randomUUID(), kind: 'diagnostic_draft' as const, sourceRunId: run.id,
      ...output.section, storyboardId: storyboard.id, identityRevision: p.identityRevision ?? 1, runStatus: 'succeeded' as const };
    // Undefined is a legacy snapshot; null explicitly means the user has no selected Section.
    if (p.currentSectionId === undefined) p.currentSectionId = p.sections.at(-1)?.id ?? null;
    p.sections.push(section);
    // Only the first draft initializes selection. Subsequent model results remain candidates.
    if (!p.storyboard) { p.storyboard = structuredClone(storyboard); p.currentSectionId = section.id; }
  }
  run.output = raw; run.runStatus = 'succeeded';
}
export function preflight(p: Project) {
  const issues: string[] = [];
  if (!p.identity) issues.push('CONFIRMED_PRODUCT_IDENTITY_REQUIRED');
  const current = selectedSection(p);
  if (!current) issues.push(p.sections.length ? 'SECTION_SELECTION_REQUIRED' : 'SECTION_DRAFT_REQUIRED');
  if (p.facts.some(f => f.issueSeverity === 'blocker')) issues.push('UNRESOLVED_FACT_CONFLICT');
  if (!p.storyboard) issues.push('CURRENT_STORYBOARD_REQUIRED');
  if (p.storyboard?.freshness === 'stale') issues.push('STALE_STORYBOARD');
  for (const s of current ? [current] : []) {
    if (s.freshness === 'stale' || (s.identityRevision ?? 1) !== (p.identityRevision ?? 1)) issues.push(`STALE_SECTION:${s.id}`);
    if (!sectionBelongsToStoryboard(p, s)) issues.push(`SECTION_OUTSIDE_STORYBOARD:${s.id}`);
    if (s.missingInputs.length) issues.push(`MISSING_INPUTS:${s.id}`);
    for (const id of s.factIds) {
      const f = p.facts.find(fact => fact.id === id && fact.status === 'confirmed');
      const e = p.evidence.find(evidence => evidence.id === f?.evidenceId);
      if (!f || !e || e.text.slice(f.start, f.end) !== f.quote) issues.push(`INVALID_FACT_EVIDENCE:${id}`);
    }
  }
  p.qa = { kind: 'preflight', checkedVersion: p.version, checkedRevision: p.revision,
    sectionId: current?.id,
    notChecked: ['market_rules', 'rendered_file', 'asset_quality', 'formal_approval'],
    issueSeverity: issues.length ? 'blocker' : 'none',
    issues, exportAllowed: false, at: new Date().toISOString() };
}
function selectedSection(p: Project) {
  return p.currentSectionId === undefined ? p.sections.at(-1) : p.sections.find(s => s.id === p.currentSectionId);
}
function sectionBelongsToStoryboard(p: Project, section: Section) {
  const storyboard = p.storyboard;
  if (!storyboard || section.factIds.some(id => !storyboard.chapters.some(c => c.factIds.includes(id)))) return false;
  if (storyboard.id !== undefined || section.storyboardId !== undefined) return storyboard.id !== undefined && section.storyboardId === storyboard.id;
  // Pre-extension drafts have no object IDs. Only the same generation proves legacy ownership.
  return section.sourceRunId !== 'human' && section.sourceRunId === storyboard.sourceRunId;
}
export function addCandidate(p: Project, input: z.infer<typeof candidateSchema>, actor: string) {
  if (input.correctsFactId && !p.facts.some(f => f.id === input.correctsFactId)) throw new AppError('FACT_NOT_FOUND', 404);
  const evidence = p.evidence.find(e => e.id === input.evidenceId && e.usage === 'product_evidence');
  const start = evidence?.text.indexOf(input.quote) ?? -1;
  if (!evidence || start < 0) throw new AppError('INVALID_EVIDENCE_REFERENCE', 409);
  p.facts.push({ id: randomUUID(), attribute: input.attribute, role: input.role, value: input.value,
    evidenceId: input.evidenceId, quote: input.quote, start, end: start + input.quote.length,
    sourceRunId: 'human', createdBy: actor, reason: input.reason, correctsFactId: input.correctsFactId,
    status: 'candidate', locked: false, issueSeverity: 'none' });
  refreshConflicts(p);
  audit(p, 'fact.candidate_saved', actor, { factId: p.facts.at(-1)!.id, correctsFactId: input.correctsFactId ?? null, reason: input.reason });
}
export function correctIdentity(p: Project, productName: string, reason: string, actor: string) {
  if (!p.identity) throw new AppError('CONFIRMED_PRODUCT_IDENTITY_REQUIRED', 409);
  const previous = p.identity.productName;
  p.identity = { productName, confirmedBy: actor, confirmedAt: new Date().toISOString() };
  p.identityRevision = (p.identityRevision ?? 1) + 1;
  p.version++;
  if (p.storyboard) p.storyboard.freshness = 'stale';
  for (const b of p.storyboardCandidates ?? []) b.freshness = 'stale';
  for (const s of p.sections) s.freshness = 'stale';
  audit(p, 'identity.corrected', actor, { previous, productName, reason, identityRevision: p.identityRevision });
}
function validateRefs(p: Project, ids: string[]) {
  checkSkillInputs(p, 'plan-section');
  if (ids.some(id => !p.facts.some(f => f.id === id && f.status === 'confirmed' && f.issueSeverity === 'none'))) throw new AppError('UNCONFIRMED_FACT_REFERENCE', 409);
}
export function editStoryboard(p: Project, chapters: Plan['chapters'], reason: string, actor: string) {
  validateRefs(p, chapters.flatMap(c => c.factIds));
  if (p.currentSectionId === undefined) p.currentSectionId = p.sections.at(-1)?.id ?? null;
  const next: Storyboard = { id: randomUUID(), chapters, sourceRunId: 'human', identityRevision: p.identityRevision ?? 1,
    editedBy: actor, reason, freshness: 'current', approvalStatus: 'draft' };
  (p.storyboardCandidates ??= []).push(structuredClone(next));
  p.storyboard = next;
  const current = selectedSection(p);
  if (current) current.freshness = 'stale';
  audit(p, 'storyboard.saved', actor, { storyboardId: next.id, reason });
}
export function editSection(p: Project, sectionId: string, input: Plan['section'], reason: string, actor: string) {
  const previous = p.sections.find(s => s.id === sectionId);
  if (!previous) throw new AppError('SECTION_NOT_FOUND', 404);
  validateRefs(p, input.factIds);
  if (!p.storyboard || p.storyboard.freshness !== 'current') throw new AppError('CURRENT_STORYBOARD_REQUIRED', 409);
  if (input.factIds.some(id => !p.storyboard!.chapters.some(c => c.factIds.includes(id)))) throw new AppError('SECTION_OUTSIDE_STORYBOARD', 409);
  if (p.storyboard.id === undefined) {
    // Assign the same explicit ID to already-proven legacy members before creating a new draft.
    // Preserve every Section's content/freshness; a different generation cannot gain ownership.
    const legacyMembers = p.sections.filter(s => s.storyboardId === undefined && sectionBelongsToStoryboard(p, s));
    p.storyboard.id = randomUUID();
    for (const member of legacyMembers) member.storyboardId = p.storyboard.id;
    audit(p, 'storyboard.legacy_ids_assigned', actor, { storyboardId: p.storyboard.id, sectionIds: legacyMembers.map(s => s.id), reason });
  }
  const section = { ...draftState(), ...input, id: randomUUID(), kind: 'diagnostic_draft' as const,
    sourceRunId: 'human', storyboardId: p.storyboard.id, identityRevision: p.identityRevision ?? 1,
    replacesSectionId: sectionId, editedBy: actor, reason };
  p.sections.push(section); p.currentSectionId = section.id;
  audit(p, 'section.saved', actor, { sectionId: section.id, replacesSectionId: sectionId, reason });
}
export function selectSection(p: Project, sectionId: string, reason: string, actor: string) {
  const section = p.sections.find(s => s.id === sectionId);
  if (!section) throw new AppError('SECTION_NOT_FOUND', 404);
  validateRefs(p, section.factIds);
  if (section.freshness !== 'current' || (section.identityRevision ?? 1) !== (p.identityRevision ?? 1)) throw new AppError('STALE_SECTION', 409);
  if (!p.storyboard || p.storyboard.freshness !== 'current' || !sectionBelongsToStoryboard(p, section)) throw new AppError('SECTION_OUTSIDE_STORYBOARD', 409);
  p.currentSectionId = sectionId;
  audit(p, 'section.selected', actor, { sectionId, reason });
}
export function applyPlanCandidate(p: Project, candidateId: string, reason: string, actor: string) {
  const candidate = p.storyboardCandidates?.find(b => b.id === candidateId);
  if (!candidate) throw new AppError('CANDIDATE_NOT_FOUND', 404);
  validateRefs(p, candidate.chapters.flatMap(c => c.factIds));
  if (candidate.freshness !== 'current' || (candidate.identityRevision ?? 1) !== (p.identityRevision ?? 1)) throw new AppError('STALE_STORYBOARD', 409);
  const section = p.sections.find(s => s.storyboardId === candidateId && s.freshness === 'current');
  if (!section) throw new AppError('SECTION_DRAFT_REQUIRED', 409);
  p.storyboard = structuredClone(candidate);
  selectSection(p, section.id, reason, actor);
  audit(p, 'storyboard.candidate_applied', actor, { candidateId, reason });
}
export function failureCode(error: unknown) {
  return error instanceof AppError ? error.code : error instanceof z.ZodError ? 'INVALID_MODEL_OUTPUT' : 'INTERNAL_RUN_ERROR';
}
