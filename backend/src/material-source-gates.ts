import { createHash } from 'node:crypto';
import type { Evidence, Fact, Project, Skill } from './contracts.js';
import type { MaterialAsset, MaterialProvenance, MaterialReferenceBlock, MaterialUse } from './production-material-usage.js';
import type { MaterialLocator } from './production-materials.js';
import {
  FACT_NORMALIZATION_VERSION,
  FACT_SOURCES_CONTRACT_VERSION,
  allStoredRisks,
  applicabilitySchema,
  canonicalValuesEqual,
  decimalValueSpanIsComplete,
  factApplicabilityScopesEqual,
  factLifecycleBindingIsValid,
  factReplacementTransitionSchema,
  factRiskSchema,
  factsConflict,
  legacyFactBindingIsValid,
  normalizeRequestedValue,
  normalizedDisplayValue,
  normalizedFactValueSchema,
  parseSourceValue,
  structuredFactCandidateBindingIsValid,
  structuredFactCompatibilitySchema,
  structuredFactConfirmationIsValid,
  structuredRiskReviewIsComplete,
  structuredRiskSeverity,
  structuredSourceInputSchema,
  structuredSourceMatchesEvidence,
} from './production-fact-sources.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function materialLocatorText(locator: MaterialLocator): string {
  if (locator.type === 'text') return `lines ${locator.startLine}-${locator.endLine}`;
  if (locator.type === 'csv') return `row ${locator.row}; lines ${locator.startLine}-${locator.endLine}`;
  if (locator.type === 'json') return `JSON ${locator.pointer || '/'}; offsets ${locator.startOffset}-${locator.endOffset}`;
  return `image frame ${locator.frame}`;
}
export function currentMaterialSource(p: Project, source: MaterialProvenance, usage: MaterialUse, projectionId: string) {
  const material = p.production?.materials?.find(item => item.id === source.materialId);
  const block = material?.blocks.find(item => item.id === source.blockId);
  const current = material?.usageReview?.current[source.blockId];
  const decision = material?.usageReview?.history.find(item => item.id === source.usageDecisionId && item.version === source.usageVersion);
  if (!material || !block || !current || !decision || material.parse.runStatus !== 'succeeded' || material.parse.queueStatus !== 'done'
    || material.sha256 !== source.sourceSha256 || material.parse.sourceSha256 !== material.sha256
    || block.materialId !== material.id || block.sourceSha256 !== material.sha256 || block.status !== 'candidate'
    || material.parse.parserVersion !== source.parserVersion || block.parserVersion !== source.parserVersion
    || source.fileName !== material.fileName || canonical(source.source) !== canonical(material.source)
    || canonical(source.locator) !== canonical(block.locator)
    || current.usage !== usage || current.projectionId !== projectionId || current.decisionId !== source.usageDecisionId
    || current.version !== source.usageVersion || decision.materialId !== material.id || decision.sourceSha256 !== material.sha256
    || decision.parserVersion !== source.parserVersion || decision.fileName !== material.fileName || canonical(decision.source) !== canonical(material.source)
    || !decision.changes.some(change => change.blockId === block.id && change.usage === usage && change.projectionId === projectionId
      && canonical(change.locator) === canonical(block.locator))) return;
  return { material, block, current };
}
export function evidenceIsAvailable(p: Project, evidence: Evidence): boolean {
  if (evidence.usage !== 'product_evidence' || evidence.availability === 'withdrawn') return false;
  if (!evidence.materialSource) return evidence.origin !== 'material'; // Historical independent human entries remain valid.
  if (evidence.origin !== 'material' || evidence.availability !== 'available') return false;
  const source = currentMaterialSource(p, evidence.materialSource, 'product_evidence', evidence.id);
  if (!source || source.block.image || !source.block.text || evidence.text !== source.block.text) return false;
  const sha256 = createHash('sha256').update(evidence.text, 'utf8').digest('hex');
  return evidence.sha256 === sha256 && evidence.objectKey === `${sha256}.txt`;
}
export type FactIntegrityReason = 'INVALID_STRUCTURED_FACT_CONTRACT' | 'INVALID_STRUCTURED_FACT_VALUE'
  | 'INVALID_STRUCTURED_FACT_SOURCE' | 'INVALID_STRUCTURED_FACT_APPLICABILITY' | 'INVALID_STRUCTURED_FACT_RISK'
  | 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING' | 'INCOMPLETE_STRUCTURED_FACT_RISK_REVIEW'
  | 'INVALID_STRUCTURED_FACT_CONFIRMATION_BINDING'
  | 'INVALID_LEGACY_FACT_SOURCE' | 'LEGACY_FACT_BINDING_REQUIRED'
  | 'INVALID_FACT_LIFECYCLE_BINDING' | 'INVALID_FACT_SUPERSESSION';
export type FactEligibilityReason = FactIntegrityReason | 'FACT_NOT_CONFIRMED' | 'FACT_NOT_LOCKED' | 'FACT_SUPERSEDED'
  | 'FACT_SOURCE_UNAVAILABLE' | 'BLOCKING_FACT_RISK' | 'UNRESOLVED_FACT_CONFLICT'
  | 'PROJECT_FACT_INTEGRITY_FAILURE' | 'PROJECT_FACT_GOVERNANCE_BLOCKER' | 'LEGACY_FACT_NOT_STRUCTURED';
export interface FactEligibility {
  eligible: boolean;
  reasons: FactEligibilityReason[];
  formalFreezeEligible: boolean;
  formalFreezeReasons: FactEligibilityReason[];
}

function structuredFactIntegrityReason(p: Project, fact: Fact): FactIntegrityReason | undefined {
  const structured = fact.structured;
  if (!structured || structured.contractVersion !== FACT_SOURCES_CONTRACT_VERSION
    || structured.normalizationVersion !== FACT_NORMALIZATION_VERSION) return 'INVALID_STRUCTURED_FACT_CONTRACT';
  if (!structuredFactCompatibilitySchema.safeParse(fact).success || fact.legacyBinding || fact.sourceReview
    || fact.sourceReconfirmations || (fact.correctsFactId && (fact.correctsFactId === fact.id
      || !p.facts.some(item => item.id === fact.correctsFactId)))) return 'INVALID_STRUCTURED_FACT_CONTRACT';
  if (!normalizedFactValueSchema.safeParse(structured.normalizedValue).success) return 'INVALID_STRUCTURED_FACT_VALUE';
  if (!Array.isArray(structured.sources) || structured.sources.length < 1 || structured.sources.length > 10)
    return 'INVALID_STRUCTURED_FACT_SOURCE';
  if (!applicabilitySchema.safeParse(structured.applicability).success) return 'INVALID_STRUCTURED_FACT_APPLICABILITY';
  if (!Array.isArray(structured.proposedRisks) || !Array.isArray(structured.derivedRisks)
    || structured.riskPolicy?.automaticSemanticRiskDetection !== 'not_performed'
    || JSON.stringify(structured.riskPolicy?.manualReviewResponsibilities) !== JSON.stringify(['certification', 'efficacy', 'safety', 'scope', 'other']))
    return 'INVALID_STRUCTURED_FACT_RISK';
  let target: ReturnType<typeof normalizeRequestedValue>;
  try { target = normalizeRequestedValue(structured.normalizedValue); } catch { return 'INVALID_STRUCTURED_FACT_VALUE'; }
  const normalizedMatches = target.normalized.kind === structured.normalizedValue.kind
    && target.normalized.value === structured.normalizedValue.value
    && (target.normalized.kind === 'text' || (structured.normalizedValue.kind === 'decimal'
      && target.normalized.unit === structured.normalizedValue.unit));
  if (!normalizedMatches
    || !canonicalValuesEqual(target.canonical, structured.canonicalValue)
    || fact.value !== normalizedDisplayValue(structured.normalizedValue)) return 'INVALID_STRUCTURED_FACT_VALUE';
  const sourceIds = structured.sources.map(source => source.id);
  const sourceRanges = structured.sources.map(source => `${source.evidenceId}:${source.start}:${source.end}`);
  if (new Set(sourceIds).size !== sourceIds.length || new Set(sourceRanges).size !== sourceRanges.length)
    return 'INVALID_STRUCTURED_FACT_SOURCE';
  const first = structured.sources[0]!;
  if (fact.evidenceId !== first.evidenceId || fact.quote !== first.quote || fact.start !== first.start || fact.end !== first.end)
    return 'INVALID_STRUCTURED_FACT_SOURCE';
  for (const source of structured.sources) {
    const evidence = p.evidence.find(item => item.id === source.evidenceId);
    if (!evidence || !structuredSourceInputSchema.safeParse({ id: source.id, evidenceId: source.evidenceId,
      quote: source.quote, start: source.start, end: source.end, valueSpan: source.valueSpan }).success
      || typeof source.contentSha256 !== 'string' || typeof source.rawValue !== 'string'
      || !structuredSourceMatchesEvidence(source, evidence)) return 'INVALID_STRUCTURED_FACT_SOURCE';
    let parsed: ReturnType<typeof parseSourceValue>;
    try { parsed = parseSourceValue(source.rawValue, structured.normalizedValue); } catch { return 'INVALID_STRUCTURED_FACT_VALUE'; }
    if (parsed.rawUnit !== source.rawUnit || !canonicalValuesEqual(parsed.canonical, structured.canonicalValue)
      || (structured.normalizedValue.kind === 'decimal'
        && !decimalValueSpanIsComplete(evidence.text, source.valueSpan.start, source.valueSpan.end, parsed.rawUnit)))
      return 'INVALID_STRUCTURED_FACT_VALUE';
    if (source.review) {
      if (!['invalidated', 'reconfirmation_required'].includes(source.review.status)
        || source.review.evidenceId !== source.evidenceId || !source.review.decisionId || !Number.isInteger(source.review.usageVersion)
        || !source.review.actor || !source.review.at || !source.review.reason) return 'INVALID_STRUCTURED_FACT_SOURCE';
    }
    if (source.reconfirmations && (!Array.isArray(source.reconfirmations) || source.reconfirmations.some(item =>
      !item.previousEvidenceId || !item.evidenceId || !item.decisionId || !Number.isInteger(item.usageVersion)
      || !item.actor || !item.at || !item.reason))) return 'INVALID_STRUCTURED_FACT_SOURCE';
  }
  const sources = new Map(structured.sources.map(source => [source.id, source]));
  if (structured.applicability.models.kind === 'specified') {
    const models = new Set<string>();
    for (const model of structured.applicability.models.models) {
      const source = sources.get(model.sourceId);
      const evidence = source && p.evidence.find(item => item.id === source.evidenceId);
      const normalized = model.id.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
      if (!source || !evidence || model.end <= model.start || model.start < source.start || model.end > source.end
        || evidence.text.slice(model.start, model.end).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() !== normalized
        || models.has(normalized)) return 'INVALID_STRUCTURED_FACT_APPLICABILITY';
      models.add(normalized);
    }
  }
  if (structured.applicability.conditions.some(condition => new Set(condition.sourceIds).size !== condition.sourceIds.length
    || condition.sourceIds.some(id => !sources.has(id)))) return 'INVALID_STRUCTURED_FACT_APPLICABILITY';
  const risks = allStoredRisks(structured);
  const riskIds = risks.map(risk => risk.id);
  if (new Set(riskIds).size !== riskIds.length || risks.some(risk =>
    !factRiskSchema.safeParse({ id: risk.id, kind: risk.kind, severity: risk.severity,
      description: risk.description, sourceIds: risk.sourceIds }).success
    || !['proposed', 'derived'].includes(risk.origin) || new Set(risk.sourceIds).size !== risk.sourceIds.length
    || risk.sourceIds.some(id => !sources.has(id)))) return 'INVALID_STRUCTURED_FACT_RISK';
  if (structured.proposedRisks.some(risk => risk.origin !== 'proposed')
    || structured.derivedRisks.some(risk => risk.origin !== 'derived')) return 'INVALID_STRUCTURED_FACT_RISK';
  if (structured.normalizedValue.kind === 'decimal') {
    if (structured.derivedRisks.length !== 1 || structured.derivedRisks[0]!.kind !== 'numeric_claim'
      || structured.derivedRisks[0]!.severity !== 'warning'
      || JSON.stringify([...structured.derivedRisks[0]!.sourceIds].sort()) !== JSON.stringify([...sourceIds].sort()))
      return 'INVALID_STRUCTURED_FACT_RISK';
  } else if (structured.derivedRisks.length !== 0) return 'INVALID_STRUCTURED_FACT_RISK';
  if (!structuredFactCandidateBindingIsValid(fact)) return 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING';
  if (fact.status === 'confirmed' || fact.status === 'retracted') {
    if ((fact.status === 'confirmed') !== fact.locked || !fact.confirmedBy || !fact.confirmedAt
      || !structuredRiskReviewIsComplete(structured))
      return 'INCOMPLETE_STRUCTURED_FACT_RISK_REVIEW';
    if (structured.riskReview?.reviewer !== fact.confirmedBy || structured.riskReview.reviewedAt !== fact.confirmedAt
      || !structuredFactConfirmationIsValid(fact)) return 'INVALID_STRUCTURED_FACT_CONFIRMATION_BINDING';
  } else if (fact.locked || fact.confirmedBy || fact.confirmedAt
    || structured.riskReview || structured.confirmation) return 'INVALID_STRUCTURED_FACT_CONFIRMATION_BINDING';
  return undefined;
}
function factBaseIntegrityReason(p: Project, fact: Fact): FactIntegrityReason | undefined {
  if (fact.structured) {
    const structuredReason = structuredFactIntegrityReason(p, fact);
    if (structuredReason) return structuredReason;
  } else {
    const evidence = p.evidence.find(item => item.id === fact.evidenceId);
    if (!evidence || fact.start < 0 || fact.end !== fact.start + fact.quote.length
      || evidence.text.slice(fact.start, fact.end) !== fact.quote) return 'INVALID_LEGACY_FACT_SOURCE';
    if (fact.status === 'confirmed' || fact.status === 'retracted') {
      if ((fact.status === 'confirmed') !== fact.locked || !fact.confirmedBy || !fact.confirmedAt
        || !legacyFactBindingIsValid(fact, evidence)) return 'LEGACY_FACT_BINDING_REQUIRED';
    } else if (fact.locked || fact.confirmedBy || fact.confirmedAt || fact.legacyBinding)
      return 'LEGACY_FACT_BINDING_REQUIRED';
  }
  if (!factLifecycleBindingIsValid(fact)) return 'INVALID_FACT_LIFECYCLE_BINDING';
  return undefined;
}
function replacementRelationIsValid(p: Project, fact: Fact): boolean {
  const projectTransitions: { ownerId: string; item: ReturnType<typeof factReplacementTransitionSchema.parse> }[] = [];
  for (const owner of p.facts) {
    if (owner.replacementTransitions === undefined) continue;
    if (!Array.isArray(owner.replacementTransitions)) return false;
    for (const value of owner.replacementTransitions) {
      const parsed = factReplacementTransitionSchema.safeParse(value);
      if (!parsed.success) return false;
      projectTransitions.push({ ownerId: owner.id, item: parsed.data });
    }
  }
  const transitions = projectTransitions.filter(entry => entry.ownerId === fact.id).map(entry => entry.item);
  if (new Set(transitions.map(item => item.id)).size !== transitions.length) return false;
  const projectMentions = projectTransitions.map(entry => entry.item)
    .filter(item => item.predecessorFactId === fact.id || item.successorFactId === fact.id);
  if (projectMentions.some(item => !transitions.some(local => local.id === item.id))) return false;
  const incoming = transitions.filter(item => item.successorFactId === fact.id);
  const outgoing = transitions.filter(item => item.predecessorFactId === fact.id);
  if (incoming.length > 1 || outgoing.length > 1 || transitions.length !== incoming.length + outgoing.length) return false;
  const outgoingTransition = outgoing[0];
  const flatSupersession = fact.supersededByFactId || fact.supersededBy || fact.supersededAt || fact.supersededReason;
  if (!!outgoingTransition !== !!flatSupersession) return false;
  if (outgoingTransition && (fact.supersededByFactId !== outgoingTransition.successorFactId
    || fact.supersededBy !== outgoingTransition.actor || fact.supersededAt !== outgoingTransition.at
    || fact.supersededReason !== outgoingTransition.reason)) return false;
  for (const transition of transitions) {
    if (transition.predecessorFactId === transition.successorFactId) return false;
    const predecessor = p.facts.find(item => item.id === transition.predecessorFactId);
    const successor = p.facts.find(item => item.id === transition.successorFactId);
    const occurrences = projectTransitions.filter(item => item.item.id === transition.id);
    if (!predecessor || !successor || predecessor === successor
      || occurrences.length !== 2 || new Set(occurrences.map(item => item.ownerId)).size !== 2
      || !occurrences.some(item => item.ownerId === predecessor.id) || !occurrences.some(item => item.ownerId === successor.id)
      || occurrences.some(item => canonical(item.item) !== canonical(transition))
      || predecessor.supersededByFactId !== successor.id || predecessor.supersededBy !== transition.actor
      || predecessor.supersededAt !== transition.at || predecessor.supersededReason !== transition.reason
      || successor.correctsFactId !== predecessor.id || normalizeRequestedValueForKey(predecessor.attribute) !== normalizeRequestedValueForKey(successor.attribute)
      || predecessor.role !== successor.role || !factApplicabilityScopesEqual(predecessor, successor)
      || predecessor.status !== 'confirmed' || !predecessor.locked || !['confirmed', 'retracted'].includes(successor.status)
      || successor.confirmedBy !== transition.actor || successor.confirmedAt !== transition.at
      || factBaseIntegrityReason(p, predecessor) || factBaseIntegrityReason(p, successor)) return false;
  }
  const seen = new Set<string>(); let cursor: Fact | undefined = fact;
  while (cursor?.supersededByFactId) {
    if (seen.has(cursor.id)) return false;
    seen.add(cursor.id); cursor = p.facts.find(item => item.id === cursor!.supersededByFactId);
  }
  return true;
}
const normalizeRequestedValueForKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
export function factSupersessionIsEffective(p: Project, fact: Fact): boolean {
  return !factBaseIntegrityReason(p, fact) && replacementRelationIsValid(p, fact) && !!fact.supersededByFactId;
}
export function factIntegrityReason(p: Project, fact: Fact): FactIntegrityReason | undefined {
  const base = factBaseIntegrityReason(p, fact);
  if (base) return base;
  if (!replacementRelationIsValid(p, fact)) return 'INVALID_FACT_SUPERSESSION';
  return undefined;
}
export function factIntegrityIsValid(p: Project, fact: Fact): boolean {
  return !factIntegrityReason(p, fact);
}
export function projectActiveFactIntegrityIsValid(p: Project): boolean {
  return p.facts.filter(fact => ['candidate', 'confirmed'].includes(fact.status))
    .every(fact => factIntegrityIsValid(p, fact));
}
export function factSourceIsCurrent(p: Project, fact: Fact): boolean {
  if (fact.structured) {
    if (!factIntegrityIsValid(p, fact)) return false;
    return fact.structured.sources.every(source => {
      if (source.review) return false;
      const evidence = p.evidence.find(item => item.id === source.evidenceId);
      return !!evidence && evidenceIsAvailable(p, evidence) && structuredSourceMatchesEvidence(source, evidence);
    });
  }
  if (!factIntegrityIsValid(p, fact)) return false;
  if (fact.sourceReview) return false;
  const evidence = p.evidence.find(item => item.id === fact.evidenceId);
  return !!evidence && evidenceIsAvailable(p, evidence) && fact.start >= 0
    && fact.end === fact.start + fact.quote.length && evidence.text.slice(fact.start, fact.end) === fact.quote;
}
export function availableEvidence(p: Project): Evidence[] { return p.evidence.filter(item => evidenceIsAvailable(p, item)); }
export function currentFactConflict(p: Project, fact: Fact, excludedId?: string): Fact | undefined {
  if (factSupersessionIsEffective(p, fact)) return;
  return p.facts.find(other => other.id !== fact.id && other.id !== excludedId && !factSupersessionIsEffective(p, other)
    && factSourceIsCurrent(p, other) && factsConflict(fact, other));
}
export function evaluateFactEligibility(p: Project, fact: Fact): FactEligibility {
  const reasons: FactEligibilityReason[] = [];
  if (fact.status !== 'confirmed') reasons.push('FACT_NOT_CONFIRMED');
  if (!fact.locked) reasons.push('FACT_NOT_LOCKED');
  const integrity = factIntegrityReason(p, fact);
  if (integrity) reasons.push(integrity);
  if (!integrity && factSupersessionIsEffective(p, fact)) reasons.push('FACT_SUPERSEDED');
  const allActive = p.facts.filter(item => ['candidate', 'confirmed'].includes(item.status));
  if (allActive.some(item => item.id !== fact.id && factIntegrityReason(p, item))) reasons.push('PROJECT_FACT_INTEGRITY_FAILURE');
  const current = allActive.filter(item => !factSupersessionIsEffective(p, item) && factSourceIsCurrent(p, item));
  if (current.some(item => item.structured && structuredRiskSeverity(item.structured) === 'blocker')
    || current.some(item => current.some(other => other.id !== item.id && factsConflict(item, other))))
    reasons.push('PROJECT_FACT_GOVERNANCE_BLOCKER');
  if (!integrity && !factSourceIsCurrent(p, fact)) reasons.push('FACT_SOURCE_UNAVAILABLE');
  if (fact.structured && structuredRiskSeverity(fact.structured) === 'blocker') reasons.push('BLOCKING_FACT_RISK');
  if (!integrity && currentFactConflict(p, fact)) reasons.push('UNRESOLVED_FACT_CONFLICT');
  const unique = [...new Set(reasons)];
  const formalFreezeReasons = fact.structured ? [...unique] : [...unique, 'LEGACY_FACT_NOT_STRUCTURED' as const];
  return { eligible: unique.length === 0, reasons: unique,
    formalFreezeEligible: formalFreezeReasons.length === 0, formalFreezeReasons: [...new Set(formalFreezeReasons)] };
}
export function factGovernanceHasBlockingIssue(p: Project): boolean {
  const active = p.facts.filter(fact => ['candidate', 'confirmed'].includes(fact.status));
  if (!projectActiveFactIntegrityIsValid(p)) return true;
  const current = active.filter(fact => !factSupersessionIsEffective(p, fact) && factSourceIsCurrent(p, fact));
  return current.some(fact => fact.structured && structuredRiskSeverity(fact.structured) === 'blocker')
    || current.some(fact => current.some(other => other.id !== fact.id && factsConflict(fact, other)));
}
export function availableConfirmedFacts(p: Project): Fact[] {
  return p.facts.filter(fact => evaluateFactEligibility(p, fact).eligible);
}
export function materialAssetIsAvailable(p: Project, asset: MaterialAsset): boolean {
  const source = currentMaterialSource(p, asset.materialSource, 'asset', asset.id);
  return asset.availability === 'available' && !!source?.block.image
    && source.material.objectKey === asset.objectKey && source.material.sha256 === asset.sha256
    && source.material.sizeBytes === asset.sizeBytes && canonical(source.block.image) === canonical(asset.image);
}
export function materialReferenceIsAvailable(p: Project, reference: MaterialReferenceBlock): boolean {
  const source = currentMaterialSource(p, reference.materialSource, 'reference', reference.id);
  return reference.availability === 'available' && !!source && reference.text === source.block.text
    && canonical(reference.cells) === canonical(source.block.cells) && canonical(reference.image) === canonical(source.block.image)
    && reference.objectKey === (source.block.image ? source.material.objectKey : undefined);
}
/** This is also the exact source selection used by the structured model request builder. */
export function skillInput(p: Project, skill: Skill) {
  return skill === 'extract-facts'
    ? { evidence: availableEvidence(p).map(({ id, text, locator }) => ({ id, text, locator })) }
    : { identity: p.identity, confirmedFacts: availableConfirmedFacts(p) };
}
export function materialModelInputHash(p: Project): string {
  return createHash('sha256').update(canonical([skillInput(p, 'extract-facts'), skillInput(p, 'plan-section')])).digest('hex');
}
export function recordMaterialExtraction(p: Project, evidenceIds: string[], actor: string, sourceRunId?: string) {
  for (const evidenceId of evidenceIds) {
    const evidence = p.evidence.find(item => item.id === evidenceId);
    if (!evidence?.materialSource || !evidenceIsAvailable(p, evidence)) continue;
    const source = currentMaterialSource(p, evidence.materialSource, 'product_evidence', evidenceId)!;
    const extraction = source.current.extraction;
    if (!extraction || (!sourceRunId && extraction.status === 'extracted')) continue;
    extraction.status = sourceRunId ? 'extracted' : 'candidate_created';
    extraction.candidateIds = p.facts.filter(fact => (fact.evidenceId === evidenceId
      || fact.structured?.sources.some(source => source.evidenceId === evidenceId)) && factSourceIsCurrent(p, fact)).map(fact => fact.id);
    extraction.completedAt = new Date().toISOString(); extraction.completedBy = actor;
    if (sourceRunId) extraction.sourceRunId = sourceRunId;
  }
}
