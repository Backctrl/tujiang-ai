import { createHash, randomUUID } from 'node:crypto';
import type { Evidence, Fact, Project } from './contracts.js';
import { refreshConflicts } from './domain.js';
import { AppError } from './errors.js';
import { availableConfirmedFacts, currentFactConflict, evaluateFactEligibility, evidenceIsAvailable,
  factIntegrityIsValid, factSourceIsCurrent, factSupersessionIsEffective, projectActiveFactIntegrityIsValid,
  recordMaterialExtraction } from './material-source-gates.js';
import type { MaterialWithdrawal } from './production-material-usage.js';
import {
  FACT_NORMALIZATION_VERSION,
  FACT_RISK_REVIEW_VERSION,
  FACT_SOURCES_CONTRACT_VERSION,
  allStoredRisks,
  canonicalValuesEqual,
  factApplicabilityScopesEqual,
  createFactLifecycleBinding,
  createStructuredFactCandidateBinding,
  createStructuredFactConfirmation,
  decimalValueSpanIssue,
  factLifecycleBindingIsValid,
  factsConflict,
  normalizeFactKey,
  normalizeFactText,
  normalizeRequestedValue,
  normalizedDisplayValue,
  parseSourceValue,
  rejectedFactRequiringReconsideration,
  structuredRiskReviewIsComplete,
  structuredRiskSeverity,
  structuredSourceMatchesEvidence,
  type StructuredFact,
  type StructuredFactCandidateInput,
  type StructuredFactConfirmInput,
  type StructuredFactSource,
  type StructuredFactSourceReconfirmInput,
  type StoredRiskReview,
} from './production-fact-sources.js';
import { audit } from './store.js';

function contentSha256(evidence: Evidence): string {
  return createHash('sha256').update(evidence.text, 'utf8').digest('hex');
}
function sourceEvidence(p: Project, evidenceId: string): Evidence {
  const evidence = p.evidence.find(item => item.id === evidenceId);
  if (!evidence || !evidenceIsAvailable(p, evidence)) throw new AppError('INVALID_STRUCTURED_FACT_SOURCE', 409);
  const sha256 = contentSha256(evidence);
  if (evidence.sha256 !== sha256 || evidence.objectKey !== `${sha256}.txt`) throw new AppError('INVALID_STRUCTURED_FACT_SOURCE', 409);
  return evidence;
}
function validateSource(p: Project, input: StructuredFactCandidateInput['sources'][number], target: ReturnType<typeof normalizeRequestedValue>): StructuredFactSource {
  const evidence = sourceEvidence(p, input.evidenceId);
  if (input.end > evidence.text.length || evidence.text.slice(input.start, input.end) !== input.quote)
    throw new AppError('INVALID_SOURCE_QUOTE', 409, { sourceId: input.id });
  if (input.valueSpan.start < input.start || input.valueSpan.end > input.end || input.valueSpan.end <= input.valueSpan.start)
    throw new AppError('INVALID_VALUE_SPAN', 409, { sourceId: input.id });
  const rawValue = evidence.text.slice(input.valueSpan.start, input.valueSpan.end);
  const parsed = parseSourceValue(rawValue, target.normalized);
  const valueSpanIssue = target.normalized.kind === 'decimal'
    ? decimalValueSpanIssue(evidence.text, input.valueSpan.start, input.valueSpan.end, parsed.rawUnit) : undefined;
  if (valueSpanIssue)
    throw new AppError(valueSpanIssue === 'unit_omission' ? 'VALUE_SPAN_OMITS_UNIT' : 'INCOMPLETE_VALUE_SPAN',
      409, { sourceId: input.id });
  if (!canonicalValuesEqual(parsed.canonical, target.canonical))
    throw new AppError('NORMALIZED_VALUE_MISMATCH', 409, { sourceId: input.id });
  const source: StructuredFactSource = { ...structuredClone(input), contentSha256: evidence.sha256, rawValue, rawUnit: parsed.rawUnit };
  if (!structuredSourceMatchesEvidence(source, evidence)) throw new AppError('INVALID_STRUCTURED_FACT_SOURCE', 409);
  return source;
}
function validateApplicability(p: Project, structured: Pick<StructuredFact, 'sources' | 'applicability'>) {
  const sources = new Map(structured.sources.map(source => [source.id, source]));
  const evidence = new Map(structured.sources.map(source => [source.id, p.evidence.find(item => item.id === source.evidenceId)!]));
  if (structured.applicability.models.kind === 'specified') {
    const modelIds = new Set<string>();
    for (const model of structured.applicability.models.models) {
      const source = sources.get(model.sourceId); const document = evidence.get(model.sourceId);
      if (!source || !document || model.end <= model.start || model.start < source.start || model.end > source.end)
        throw new AppError('INVALID_MODEL_SCOPE_ANCHOR', 409, { sourceId: model.sourceId });
      const anchored = document.text.slice(model.start, model.end);
      if (normalizeFactKey(anchored) !== normalizeFactKey(model.id))
        throw new AppError('INVALID_MODEL_SCOPE_ANCHOR', 409, { sourceId: model.sourceId });
      const normalized = normalizeFactKey(model.id);
      if (modelIds.has(normalized)) throw new AppError('DUPLICATE_MODEL_SCOPE', 409);
      modelIds.add(normalized);
    }
  }
  for (const condition of structured.applicability.conditions) {
    if (new Set(condition.sourceIds).size !== condition.sourceIds.length || condition.sourceIds.some(id => !sources.has(id)))
      throw new AppError('INVALID_APPLICABILITY_SOURCE', 409);
  }
}
function validateProposedRisks(structured: Pick<StructuredFact, 'sources' | 'proposedRisks'>) {
  const sources = new Set(structured.sources.map(source => source.id));
  for (const risk of structured.proposedRisks) {
    if (new Set(risk.sourceIds).size !== risk.sourceIds.length || risk.sourceIds.some(id => !sources.has(id)))
      throw new AppError('INVALID_RISK_SOURCE', 409, { riskId: risk.id });
  }
}
function candidateConflicts(p: Project, fact: Fact, excludedId?: string): Fact | undefined {
  return currentFactConflict(p, fact, excludedId);
}
function replacementTargetIsValid(p: Project, candidate: Fact, target: Fact | undefined): target is Fact {
  return !!target && candidate.correctsFactId === target.id && target.status === 'confirmed' && target.locked
    && factIntegrityIsValid(p, target) && !factSupersessionIsEffective(p, target)
    && normalizeFactKey(target.attribute) === normalizeFactKey(candidate.attribute) && target.role === candidate.role
    && factApplicabilityScopesEqual(target, candidate);
}
function markFactDependentsStale(p: Project, factId: string) {
  for (const section of p.sections) if (section.factIds.includes(factId)) section.freshness = 'stale';
  if (p.storyboard?.chapters.some(chapter => chapter.factIds.includes(factId))) p.storyboard.freshness = 'stale';
  for (const storyboard of p.storyboardCandidates ?? [])
    if (storyboard.chapters.some(chapter => chapter.factIds.includes(factId))) storyboard.freshness = 'stale';
}

export function addStructuredFactCandidate(p: Project, input: StructuredFactCandidateInput, actor: string): Fact {
  const correction = input.correctsFactId ? p.facts.find(fact => fact.id === input.correctsFactId) : undefined;
  if (input.correctsFactId && !correction) throw new AppError('FACT_NOT_FOUND', 404);
  const target = normalizeRequestedValue(input.normalizedValue);
  const sources = input.sources.map(source => validateSource(p, source, target));
  const existingRiskIds = new Set(p.facts.flatMap(fact => fact.structured ? allStoredRisks(fact.structured).map(risk => risk.id) : []));
  if (input.risks.some(risk => existingRiskIds.has(risk.id))) throw new AppError('DUPLICATE_FACT_RISK_ID', 409);
  const proposedRisks = input.risks.map(risk => ({ ...structuredClone(risk), origin: 'proposed' as const }));
  let derivedRiskId = randomUUID();
  while (existingRiskIds.has(derivedRiskId) || proposedRisks.some(risk => risk.id === derivedRiskId)) derivedRiskId = randomUUID();
  const derivedRisks = target.normalized.kind === 'decimal' ? [{
    id: derivedRiskId, kind: 'numeric_claim' as const, severity: 'warning' as const, origin: 'derived' as const,
    description: 'Decimal claims require an explicit human review of the quoted value, unit, applicability, and allowed conversion.',
    sourceIds: sources.map(source => source.id),
  }] : [];
  const structured: StructuredFact = {
    contractVersion: FACT_SOURCES_CONTRACT_VERSION,
    normalizationVersion: FACT_NORMALIZATION_VERSION,
    normalizedValue: target.normalized,
    canonicalValue: target.canonical,
    sources,
    applicability: structuredClone(input.applicability),
    proposedRisks,
    derivedRisks,
    riskPolicy: {
      automaticSemanticRiskDetection: 'not_performed',
      manualReviewResponsibilities: ['certification', 'efficacy', 'safety', 'scope', 'other'],
    },
  };
  validateApplicability(p, structured);
  validateProposedRisks(structured);
  const first = sources[0]!;
  const fact: Fact = {
    id: randomUUID(), attribute: normalizeFactText(input.attribute), role: input.role,
    value: normalizedDisplayValue(target.normalized), evidenceId: first.evidenceId, quote: first.quote,
    start: first.start, end: first.end, sourceRunId: 'human', createdBy: actor, reason: input.reason,
    correctsFactId: input.correctsFactId, status: 'candidate', locked: false,
    issueSeverity: structuredRiskSeverity(structured), structured,
  };
  structured.candidateBinding = createStructuredFactCandidateBinding(fact);
  fact.lifecycleBinding = createFactLifecycleBinding(fact, actor, input.reason, null);
  const rejected = rejectedFactRequiringReconsideration(p.facts, fact);
  if (rejected && input.correctsFactId !== rejected.id)
    throw new AppError('REJECTED_FACT_RECONSIDERATION_REQUIRED', 409, { factId: rejected.id });
  p.facts.push(fact);
  refreshConflicts(p);
  recordMaterialExtraction(p, sources.map(source => source.evidenceId), actor);
  audit(p, 'fact.structured_candidate_saved', actor, {
    factId: fact.id, sourceIds: sources.map(source => source.id), evidenceIds: sources.map(source => source.evidenceId),
    correctsFactId: input.correctsFactId ?? null, reason: input.reason,
  });
  return fact;
}

function storedRiskReview(fact: Fact, input: StructuredFactConfirmInput, actor: string): StoredRiskReview {
  const review: StoredRiskReview = {
    contractVersion: FACT_RISK_REVIEW_VERSION,
    categories: structuredClone(input.riskReview.categories),
    acknowledgedRiskIds: [...input.acknowledgedRiskIds],
    reviewer: actor,
    reviewedAt: new Date().toISOString(),
  };
  const candidate = { ...fact.structured!, riskReview: review };
  if (!structuredRiskReviewIsComplete(candidate)) throw new AppError('INCOMPLETE_FACT_RISK_REVIEW', 409);
  return review;
}
export function confirmStructuredFact(p: Project, factId: string, input: StructuredFactConfirmInput, actor: string): Fact {
  const fact = p.facts.find(item => item.id === factId);
  if (!fact) throw new AppError('FACT_NOT_FOUND', 404);
  if (!fact.structured) throw new AppError('STRUCTURED_FACT_REQUIRED', 409);
  if (fact.status !== 'candidate') throw new AppError('FACT_NOT_CANDIDATE', 409);
  if (!projectActiveFactIntegrityIsValid(p)) throw new AppError('INVALID_FACT_BINDING', 409);
  if (!factSourceIsCurrent(p, fact)) throw new AppError('INVALID_EVIDENCE', 409);
  if (structuredRiskSeverity(fact.structured) === 'blocker') throw new AppError('BLOCKING_FACT_RISK', 409);
  const review = storedRiskReview(fact, input, actor);
  let replaced: Fact | undefined;
  if (input.replaceFactId) {
    if (fact.correctsFactId !== input.replaceFactId) throw new AppError('INVALID_FACT_REPLACEMENT', 409);
    replaced = p.facts.find(item => item.id === input.replaceFactId);
    if (!replaced) throw new AppError('FACT_NOT_FOUND', 404);
    if (replaced.status !== 'confirmed' || !replaced.locked || !factIntegrityIsValid(p, replaced)
      || factSupersessionIsEffective(p, replaced))
      throw new AppError('FACT_NOT_REPLACEABLE', 409);
    if (!replacementTargetIsValid(p, fact, replaced))
      throw new AppError('INVALID_FACT_REPLACEMENT', 409);
  }
  if (candidateConflicts(p, fact, replaced?.id)) throw new AppError('UNRESOLVED_FACT_CONFLICT', 409);
  fact.structured.riskReview = review;
  fact.status = 'confirmed'; fact.locked = true; fact.confirmedBy = actor; fact.confirmedAt = review.reviewedAt;
  fact.structured.confirmation = createStructuredFactConfirmation(fact);
  if (replaced) {
    const transition = { id: randomUUID(), predecessorFactId: replaced.id, successorFactId: fact.id,
      actor, at: review.reviewedAt, reason: input.reason };
    replaced.supersededByFactId = fact.id; replaced.supersededBy = actor;
    replaced.supersededAt = review.reviewedAt; replaced.supersededReason = input.reason;
    (replaced.replacementTransitions ??= []).push(structuredClone(transition));
    (fact.replacementTransitions ??= []).push(structuredClone(transition));
    replaced.lifecycleBinding = createFactLifecycleBinding(replaced, actor, input.reason, replaced.status, review.reviewedAt);
    markFactDependentsStale(p, replaced.id);
  }
  fact.lifecycleBinding = createFactLifecycleBinding(fact, actor, input.reason, 'candidate', review.reviewedAt);
  p.version++;
  refreshConflicts(p);
  audit(p, replaced ? 'fact.structured_replaced' : 'fact.structured_confirmed', actor, {
    factId: fact.id, replaceFactId: replaced?.id ?? null, reason: input.reason,
    riskReviewVersion: review.contractVersion, riskReviewer: review.reviewer,
  });
  return fact;
}

export function structuredSourceReconfirmIsUnchanged(p: Project, factId: string, sourceId: string, evidenceId: string): boolean {
  const fact = p.facts.find(item => item.id === factId);
  const source = fact?.structured?.sources.find(item => item.id === sourceId);
  return !!fact && fact.status === 'confirmed' && fact.locked && !!source && source.evidenceId === evidenceId && !source.review
    && source.reconfirmations?.at(-1)?.evidenceId === evidenceId && factIntegrityIsValid(p, fact);
}
function validateReplacementEvidence(p: Project, source: StructuredFactSource, evidenceId: string): Evidence {
  const previous = p.evidence.find(item => item.id === source.evidenceId);
  const evidence = p.evidence.find(item => item.id === evidenceId);
  if (!previous?.materialSource || !evidence?.materialSource || evidence.id === previous.id || !evidenceIsAvailable(p, evidence)
    || evidence.materialSource.materialId !== previous.materialSource.materialId
    || evidence.materialSource.blockId !== previous.materialSource.blockId
    || evidence.materialSource.sourceSha256 !== previous.materialSource.sourceSha256
    || source.contentSha256 !== contentSha256(previous) || source.contentSha256 !== contentSha256(evidence)
    || evidence.sha256 !== source.contentSha256 || evidence.objectKey !== `${source.contentSha256}.txt`)
    throw new AppError('INVALID_RECONFIRMATION_SOURCE', 409);
  const next = { ...source, evidenceId };
  delete next.review;
  if (!structuredSourceMatchesEvidence(next, evidence)) throw new AppError('INVALID_RECONFIRMATION_SOURCE', 409);
  return evidence;
}
export function reconfirmStructuredFactSource(p: Project, factId: string, sourceId: string, input: StructuredFactSourceReconfirmInput, actor: string) {
  const fact = p.facts.find(item => item.id === factId);
  if (!fact) throw new AppError('FACT_NOT_FOUND', 404);
  if (!fact.structured || fact.status !== 'confirmed' || !fact.locked) throw new AppError('STRUCTURED_FACT_REQUIRED', 409);
  if (!projectActiveFactIntegrityIsValid(p)) throw new AppError('INVALID_FACT_BINDING', 409);
  const source = fact.structured.sources.find(item => item.id === sourceId);
  if (!source) throw new AppError('FACT_SOURCE_NOT_FOUND', 404);
  if (structuredSourceReconfirmIsUnchanged(p, factId, sourceId, input.evidenceId)) return;
  if (source.review?.status !== 'reconfirmation_required') throw new AppError('SOURCE_RECONFIRMATION_NOT_REQUIRED', 409);
  if (source.review.evidenceId !== source.evidenceId) throw new AppError('INVALID_RECONFIRMATION_SOURCE', 409);
  const previousEvidenceId = source.evidenceId;
  const evidence = validateReplacementEvidence(p, source, input.evidenceId);
  const materialSource = evidence.materialSource!; const at = new Date().toISOString();
  const reconfirmation = { previousEvidenceId, evidenceId: evidence.id, actor, at, reason: input.reason,
    decisionId: materialSource.usageDecisionId, usageVersion: materialSource.usageVersion };
  const candidate = structuredClone(fact);
  const candidateSource = candidate.structured!.sources.find(item => item.id === sourceId)!;
  candidateSource.evidenceId = evidence.id; delete candidateSource.review;
  (candidateSource.reconfirmations ??= []).push(reconfirmation);
  if (candidate.structured!.sources[0]!.id === sourceId) candidate.evidenceId = evidence.id;
  candidate.lifecycleBinding = createFactLifecycleBinding(candidate, actor, input.reason, candidate.status, at);
  if (!factIntegrityIsValid(p, candidate)) throw new AppError('INVALID_RECONFIRMATION_SOURCE', 409);
  if (candidateConflicts(p, candidate)) throw new AppError('UNRESOLVED_FACT_CONFLICT', 409);
  (source.reconfirmations ??= []).push(reconfirmation);
  source.evidenceId = evidence.id; delete source.review;
  if (fact.structured.sources[0]!.id === sourceId) fact.evidenceId = evidence.id;
  fact.lifecycleBinding = createFactLifecycleBinding(fact, actor, input.reason, fact.status, at);
  p.version++;
  refreshConflicts(p);
  audit(p, 'fact.structured_source_reconfirmed', actor, { factId, sourceId, previousEvidenceId, evidenceId: evidence.id,
    decisionId: materialSource.usageDecisionId, usageVersion: materialSource.usageVersion, reason: input.reason });
}

export function invalidateStructuredFactSources(p: Project, evidenceIds: string[], withdrawal: MaterialWithdrawal) {
  const affected: { factId: string; sourceId: string; evidenceId: string }[] = [];
  const ids = new Set(evidenceIds);
  for (const fact of p.facts) {
    if (!fact.structured || !['candidate', 'confirmed'].includes(fact.status)) continue;
    const lifecycleWasValid = factLifecycleBindingIsValid(fact);
    for (const source of fact.structured.sources) {
      if (!ids.has(source.evidenceId) || source.review) continue;
      source.review = { ...withdrawal, evidenceId: source.evidenceId,
        status: fact.status === 'confirmed' && fact.locked ? 'reconfirmation_required' : 'invalidated' };
      affected.push({ factId: fact.id, sourceId: source.id, evidenceId: source.evidenceId });
    }
    if (lifecycleWasValid && affected.some(item => item.factId === fact.id))
      fact.lifecycleBinding = createFactLifecycleBinding(fact, withdrawal.actor, withdrawal.reason, fact.status, withdrawal.at);
  }
  return affected;
}
export function replacementEvidenceForStructuredSource(p: Project, source: StructuredFactSource): Evidence | undefined {
  const previous = p.evidence.find(item => item.id === source.evidenceId);
  if (!previous?.materialSource) return;
  return p.evidence.find(item => item.id !== source.evidenceId && evidenceIsAvailable(p, item)
    && item.materialSource?.materialId === previous.materialSource!.materialId
    && item.materialSource.blockId === previous.materialSource!.blockId
    && item.materialSource.sourceSha256 === previous.materialSource!.sourceSha256
    && item.sha256 === source.contentSha256 && contentSha256(item) === source.contentSha256
    && structuredSourceMatchesEvidence({ ...source, evidenceId: item.id }, item));
}
export function structuredSourceReconfirmationBlockReason(p: Project, fact: Fact, source: StructuredFactSource,
  evidence: Evidence): 'INVALID_FACT_BINDING' | 'UNRESOLVED_FACT_CONFLICT' | undefined {
  if (!projectActiveFactIntegrityIsValid(p)) return 'INVALID_FACT_BINDING';
  const candidate = structuredClone(fact);
  const candidateSource = candidate.structured?.sources.find(item => item.id === source.id);
  if (!candidate.structured || !candidateSource) return 'INVALID_FACT_BINDING';
  candidateSource.evidenceId = evidence.id;
  delete candidateSource.review;
  if (candidate.structured.sources[0]!.id === source.id) candidate.evidenceId = evidence.id;
  try {
    const binding = fact.lifecycleBinding!;
    candidate.lifecycleBinding = createFactLifecycleBinding(candidate, binding.actor, binding.reason, candidate.status, binding.at);
  }
  catch { return 'INVALID_FACT_BINDING'; }
  if (!factIntegrityIsValid(p, candidate)) return 'INVALID_FACT_BINDING';
  return candidateConflicts(p, candidate) ? 'UNRESOLVED_FACT_CONFLICT' : undefined;
}
export function structuredSourceImpact(p: Project, evidenceIds: string[]) {
  const ids = new Set(evidenceIds); const result: { factId: string; sourceId: string; evidenceId: string }[] = [];
  for (const fact of p.facts) for (const source of fact.structured?.sources ?? [])
    if (ids.has(source.evidenceId)) result.push({ factId: fact.id, sourceId: source.id, evidenceId: source.evidenceId });
  return result;
}

export function factSourceDetails(p: Project, factId: string) {
  const fact = p.facts.find(item => item.id === factId);
  if (!fact) throw new AppError('FACT_NOT_FOUND', 404);
  const integrityValid = factIntegrityIsValid(p, fact);
  const projectIntegrityValid = projectActiveFactIntegrityIsValid(p);
  const eligibility = evaluateFactEligibility(p, fact);
  const conflictFactIds = integrityValid ? p.facts.filter(other => other.id !== fact.id && !factSupersessionIsEffective(p, other)
    && factSourceIsCurrent(p, other) && factsConflict(fact, other)).map(item => item.id) : [];
  if (!fact.structured) {
    const evidence = p.evidence.find(item => item.id === fact.evidenceId);
    return { contractVersion: p.contractVersion, projectId: p.id, projectVersion: p.version, revision: p.revision,
      fact, structured: false, integrityValid, eligibility,
      currentUsable: availableConfirmedFacts(p).some(item => item.id === fact.id),
      sources: [{ id: `legacy:${fact.id}`, evidenceId: fact.evidenceId, quote: fact.quote, start: fact.start, end: fact.end,
        contentSha256: evidence?.sha256 ?? null, available: factSourceIsCurrent(p, fact), review: fact.sourceReview ?? null }],
      normalization: { status: 'not_performed', legacyValue: fact.value },
      risks: { status: 'not_assessed', automaticSemanticRiskDetection: 'not_performed' },
      applicability: { models: { kind: 'unspecified' }, conditions: [] }, conflictFactIds,
      commands: { confirm: fact.status === 'candidate' && integrityValid && projectIntegrityValid && factSourceIsCurrent(p, fact)
          && conflictFactIds.length === 0,
        reject: fact.status === 'candidate', retract: fact.status === 'confirmed' && !factSupersessionIsEffective(p, fact) } };
  }
  if (!integrityValid) return {
    contractVersion: FACT_SOURCES_CONTRACT_VERSION, projectId: p.id, projectVersion: p.version, revision: p.revision,
    fact, structured: true, integrityValid, eligibility, currentUsable: false, sources: [],
    normalization: { status: 'invalid' }, applicability: null, risks: { status: 'invalid' }, conflictFactIds,
    commands: { confirm: false, replaceFactId: null, reject: fact.status === 'candidate',
      retract: fact.status === 'confirmed' && !factSupersessionIsEffective(p, fact), reconfirmSourceIds: [] },
  };
  const sources = fact.structured.sources.map(source => ({ ...source,
    available: !source.review && !!p.evidence.find(item => item.id === source.evidenceId && evidenceIsAvailable(p, item)
      && structuredSourceMatchesEvidence(source, item)),
    replacementEvidenceId: source.review?.status === 'reconfirmation_required'
      ? replacementEvidenceForStructuredSource(p, source)?.id ?? null : null,
  }));
  const hasBlockingRisk = structuredRiskSeverity(fact.structured) === 'blocker';
  const sourcesAvailable = sources.every(source => source.available);
  const directConflictFactIds = conflictFactIds.filter(id => id !== fact.correctsFactId);
  const replacementTarget = fact.correctsFactId ? p.facts.find(item => item.id === fact.correctsFactId) : undefined;
  return { contractVersion: FACT_SOURCES_CONTRACT_VERSION, projectId: p.id, projectVersion: p.version, revision: p.revision,
    fact, structured: true, integrityValid, eligibility,
    currentUsable: availableConfirmedFacts(p).some(item => item.id === fact.id), sources,
    normalization: { version: fact.structured.normalizationVersion, value: fact.structured.normalizedValue,
      canonicalValue: fact.structured.canonicalValue },
    applicability: fact.structured.applicability,
    risks: { proposed: fact.structured.proposedRisks, derived: fact.structured.derivedRisks,
      review: fact.structured.riskReview ?? null, policy: fact.structured.riskPolicy },
    conflictFactIds,
    commands: { confirm: fact.status === 'candidate' && projectIntegrityValid && sourcesAvailable && !hasBlockingRisk && conflictFactIds.length === 0,
      replaceFactId: fact.status === 'candidate' && projectIntegrityValid && sourcesAvailable && !hasBlockingRisk && directConflictFactIds.length === 0
        && replacementTargetIsValid(p, fact, replacementTarget) && conflictFactIds.includes(replacementTarget.id) ? replacementTarget.id : null,
      reject: fact.status === 'candidate', retract: fact.status === 'confirmed' && !factSupersessionIsEffective(p, fact),
      reconfirmSourceIds: projectIntegrityValid
        ? sources.filter(source => source.review?.status === 'reconfirmation_required').map(source => source.id) : [] } };
}
