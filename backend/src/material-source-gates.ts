import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Evidence, Fact, Project, Skill } from './contracts.js';
import { AppError } from './errors.js';
import type { MaterialAsset, MaterialProvenance, MaterialReferenceBlock, MaterialUse } from './production-material-usage.js';
import type { MaterialLocator } from './production-materials.js';
import {
  FACT_NORMALIZATION_VERSION,
  FACT_SOURCES_CONTRACT_VERSION,
  allStoredRisks,
  applicabilitySchema,
  canonicalFactValueSchema,
  canonicalValuesEqual,
  decimalValueSpanIsComplete,
  factApplicabilityScopesEqual,
  factLifecycleAuditIsValid,
  factLifecycleBindingIsValid,
  factReplacementTransitionSchema,
  factRiskSchema,
  factsConflict,
  legacyFactBindingIsValid,
  legacyFactCandidateBindingIsValid,
  legacyFactCompatibilitySchema,
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
  storedSourceReviewSchema,
} from './production-fact-sources.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const persistedFactTraversalSchema = z.object({
  id: z.string(), status: z.enum(['candidate', 'confirmed', 'rejected', 'retracted']),
}).passthrough();
const persistedMaterialProvenanceSchema = z.object({
  materialId: z.string(), blockId: z.string(), sourceSha256: z.string(), parserVersion: z.string(),
  fileName: z.string(), source: z.unknown(), locator: z.unknown(), usageDecisionId: z.string(), usageVersion: z.number().int(),
}).strict();
const persistedWithdrawalSchema = z.object({
  decisionId: z.string(), usageVersion: z.number().int(), actor: z.string(), at: z.string(), reason: z.string(),
}).strict();
const persistedEvidenceSchema = z.object({
  id: z.string(), documentName: z.string(), locator: z.string(), usage: z.literal('product_evidence'),
  text: z.string(), sha256: z.string(), objectKey: z.string(), createdBy: z.string(),
  origin: z.enum(['manual_entry', 'material']).optional(), createdAt: z.string().optional(),
  availability: z.enum(['available', 'withdrawn']).optional(), materialSource: persistedMaterialProvenanceSchema.optional(),
  withdrawn: persistedWithdrawalSchema.optional(),
}).strict();

function persistedFactIsTraversable(value: unknown): value is Fact {
  return persistedFactTraversalSchema.safeParse(value).success;
}
export function projectFactCollectionIsTraversable(p: Project): boolean {
  if (!p || typeof p !== 'object' || !Array.isArray(Reflect.get(p, 'facts'))
    || !(Reflect.get(p, 'facts') as unknown[]).every(persistedFactIsTraversable)) return false;
  const ids = (Reflect.get(p, 'facts') as Fact[]).map(fact => fact.id);
  return new Set(ids).size === ids.length;
}
export function projectEvidenceCollectionIsValid(p: Project): boolean {
  if (!p || typeof p !== 'object' || !Array.isArray(Reflect.get(p, 'evidence'))) return false;
  const evidence = Reflect.get(p, 'evidence') as unknown[];
  if (!evidence.every(item => persistedEvidenceSchema.safeParse(item).success)) return false;
  const ids = (evidence as Evidence[]).map(item => item.id);
  return new Set(ids).size === ids.length;
}
export function assertProjectFactCollectionTraversable(p: Project): void {
  if (!projectFactCollectionIsTraversable(p)) throw new AppError('INVALID_PROJECT_FACT_COLLECTION', 409);
}
export function assertProjectEvidenceCollectionValid(p: Project): void {
  if (!projectEvidenceCollectionIsValid(p)) throw new AppError('INVALID_EVIDENCE_CONTRACT', 409);
}
export function assertProjectFactPersistenceReadable(p: Project): void {
  assertProjectFactCollectionTraversable(p); assertProjectEvidenceCollectionValid(p);
}
export function materialLocatorText(locator: MaterialLocator): string {
  if (locator.type === 'text') return `lines ${locator.startLine}-${locator.endLine}`;
  if (locator.type === 'csv') return `row ${locator.row}; lines ${locator.startLine}-${locator.endLine}`;
  if (locator.type === 'json') return `JSON ${locator.pointer || '/'}; offsets ${locator.startOffset}-${locator.endOffset}`;
  return `image frame ${locator.frame}`;
}
export function currentMaterialSource(p: Project, source: MaterialProvenance, usage: MaterialUse, projectionId: string) {
  if (!persistedMaterialProvenanceSchema.safeParse(source).success) return;
  try {
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
  } catch { return; }
}
export function evidenceIsAvailable(p: Project, evidence: Evidence): boolean {
  if (!projectEvidenceCollectionIsValid(p) || !persistedEvidenceSchema.safeParse(evidence).success) return false;
  try {
    if (evidence.usage !== 'product_evidence' || evidence.availability === 'withdrawn') return false;
    if (!evidence.materialSource) return evidence.origin !== 'material'; // Historical independent human entries remain valid.
    if (evidence.origin !== 'material' || evidence.availability !== 'available') return false;
    const source = currentMaterialSource(p, evidence.materialSource, 'product_evidence', evidence.id);
    if (!source || source.block.image || !source.block.text || evidence.text !== source.block.text) return false;
    const sha256 = createHash('sha256').update(evidence.text, 'utf8').digest('hex');
    return evidence.sha256 === sha256 && evidence.objectKey === `${sha256}.txt`;
  } catch { return false; }
}
export type FactIntegrityReason = 'INVALID_FACT_CONTRACT' | 'INVALID_PROJECT_FACT_COLLECTION' | 'INVALID_EVIDENCE_CONTRACT'
  | 'INVALID_STRUCTURED_FACT_CONTRACT' | 'INVALID_STRUCTURED_FACT_VALUE'
  | 'INVALID_STRUCTURED_FACT_SOURCE' | 'INVALID_STRUCTURED_FACT_APPLICABILITY' | 'INVALID_STRUCTURED_FACT_RISK'
  | 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING' | 'INCOMPLETE_STRUCTURED_FACT_RISK_REVIEW'
  | 'INVALID_STRUCTURED_FACT_CONFIRMATION_BINDING'
  | 'INVALID_LEGACY_FACT_CONTRACT' | 'INVALID_LEGACY_FACT_CANDIDATE_BINDING'
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

const structuredPayloadEnvelopeSchema = z.object({
  contractVersion: z.unknown(), normalizationVersion: z.unknown(), normalizedValue: z.unknown(), canonicalValue: z.unknown(),
  sources: z.unknown(), applicability: z.unknown(), proposedRisks: z.unknown(), derivedRisks: z.unknown(), riskPolicy: z.unknown(),
  riskReview: z.unknown().optional(), candidateBinding: z.unknown().optional(), confirmation: z.unknown().optional(),
}).strict();
const storedReviewEnvelopeSchema = z.object({
  status: z.unknown(), evidenceId: z.unknown(), decisionId: z.unknown(), usageVersion: z.unknown(),
  actor: z.unknown(), at: z.unknown(), reason: z.unknown(),
}).strict();
const storedReconfirmationEnvelopeSchema = z.object({
  previousEvidenceId: z.unknown(), evidenceId: z.unknown(), decisionId: z.unknown(), usageVersion: z.unknown(),
  actor: z.unknown(), at: z.unknown(), reason: z.unknown(),
}).strict();
const structuredSourceEnvelopeSchema = z.object({
  id: z.unknown(), evidenceId: z.unknown(), quote: z.unknown(), start: z.unknown(), end: z.unknown(), valueSpan: z.unknown(),
  contentSha256: z.unknown(), rawValue: z.unknown(), rawUnit: z.unknown(),
  review: storedReviewEnvelopeSchema.optional(), reconfirmations: z.array(storedReconfirmationEnvelopeSchema).optional(),
}).strict();
const storedRiskEnvelopeSchema = z.object({
  id: z.unknown(), kind: z.unknown(), severity: z.unknown(), description: z.unknown(), sourceIds: z.array(z.unknown()), origin: z.unknown(),
}).strict();
const riskPolicyEnvelopeSchema = z.object({
  automaticSemanticRiskDetection: z.unknown(), manualReviewResponsibilities: z.array(z.unknown()),
}).strict();
const candidateBindingEnvelopeSchema = z.object({
  contractVersion: z.unknown(), factId: z.unknown(), createdBy: z.unknown(),
  originalSources: z.array(z.object({ sourceId: z.unknown(), evidenceId: z.unknown() }).strict()),
  snapshotSha256: z.unknown(),
}).strict();
const confirmationEnvelopeSchema = z.object({
  contractVersion: z.unknown(), factId: z.unknown(), confirmedBy: z.unknown(), confirmedAt: z.unknown(), snapshotSha256: z.unknown(),
}).strict();
const riskAssessmentEnvelopeSchema = z.object({
  kind: z.unknown(), assessment: z.unknown(), reason: z.unknown(), reviewedRiskIds: z.array(z.unknown()),
}).strict();
const riskReviewEnvelopeSchema = z.object({
  contractVersion: z.unknown(), categories: z.array(riskAssessmentEnvelopeSchema), acknowledgedRiskIds: z.array(z.unknown()),
  reviewer: z.unknown(), reviewedAt: z.unknown(),
}).strict();

function structuredFactIntegrityReason(p: Project, fact: Fact): FactIntegrityReason | undefined {
  if (!structuredFactCompatibilitySchema.safeParse(fact).success) return 'INVALID_STRUCTURED_FACT_CONTRACT';
  const envelope = structuredPayloadEnvelopeSchema.safeParse(fact.structured);
  if (!envelope.success) return 'INVALID_STRUCTURED_FACT_CONTRACT';
  const structured = fact.structured!;
  if (structured.contractVersion !== FACT_SOURCES_CONTRACT_VERSION
    || structured.normalizationVersion !== FACT_NORMALIZATION_VERSION) return 'INVALID_STRUCTURED_FACT_CONTRACT';
  if (fact.correctsFactId && (fact.correctsFactId === fact.id
    || !p.facts.some(item => item.id === fact.correctsFactId))) return 'INVALID_STRUCTURED_FACT_CONTRACT';
  if (!normalizedFactValueSchema.safeParse(structured.normalizedValue).success
    || !canonicalFactValueSchema.safeParse(structured.canonicalValue).success) return 'INVALID_STRUCTURED_FACT_VALUE';
  if (!Array.isArray(structured.sources) || structured.sources.length < 1 || structured.sources.length > 10)
    return 'INVALID_STRUCTURED_FACT_SOURCE';
  if (!z.array(structuredSourceEnvelopeSchema).safeParse(structured.sources).success) return 'INVALID_STRUCTURED_FACT_SOURCE';
  if (!applicabilitySchema.safeParse(structured.applicability).success) return 'INVALID_STRUCTURED_FACT_APPLICABILITY';
  if (!Array.isArray(structured.proposedRisks) || !Array.isArray(structured.derivedRisks)
    || !z.array(storedRiskEnvelopeSchema).safeParse(structured.proposedRisks).success
    || !z.array(storedRiskEnvelopeSchema).safeParse(structured.derivedRisks).success
    || !riskPolicyEnvelopeSchema.safeParse(structured.riskPolicy).success
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
      if (!storedSourceReviewSchema.safeParse(source.review).success
        || source.review.evidenceId !== source.evidenceId) return 'INVALID_STRUCTURED_FACT_SOURCE';
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
  if (!candidateBindingEnvelopeSchema.safeParse(structured.candidateBinding).success)
    return 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING';
  if (!structuredFactCandidateBindingIsValid(fact, p.evidence)) return 'INVALID_STRUCTURED_FACT_CANDIDATE_BINDING';
  if (fact.status === 'confirmed' || fact.status === 'retracted') {
    if (!riskReviewEnvelopeSchema.safeParse(structured.riskReview).success)
      return 'INCOMPLETE_STRUCTURED_FACT_RISK_REVIEW';
    if ((fact.status === 'confirmed') !== fact.locked || !fact.confirmedBy || !fact.confirmedAt
      || !structuredRiskReviewIsComplete(structured))
      return 'INCOMPLETE_STRUCTURED_FACT_RISK_REVIEW';
    if (!confirmationEnvelopeSchema.safeParse(structured.confirmation).success)
      return 'INVALID_STRUCTURED_FACT_CONFIRMATION_BINDING';
    if (structured.riskReview?.reviewer !== fact.confirmedBy || structured.riskReview.reviewedAt !== fact.confirmedAt
      || !structuredFactConfirmationIsValid(fact, p.evidence)) return 'INVALID_STRUCTURED_FACT_CONFIRMATION_BINDING';
  } else if (fact.locked || fact.confirmedBy || fact.confirmedAt
    || structured.riskReview !== undefined || structured.confirmation !== undefined)
    return 'INVALID_STRUCTURED_FACT_CONFIRMATION_BINDING';
  return undefined;
}
function factBaseIntegrityReason(p: Project, fact: Fact): FactIntegrityReason | undefined {
  if (fact.structured) {
    const structuredReason = structuredFactIntegrityReason(p, fact);
    if (structuredReason) return structuredReason;
  } else {
    if (!legacyFactCompatibilitySchema.safeParse(fact).success
      || (fact.correctsFactId && (fact.correctsFactId === fact.id || !p.facts.some(item => item.id === fact.correctsFactId))))
      return 'INVALID_LEGACY_FACT_CONTRACT';
    if (!legacyFactCandidateBindingIsValid(fact, p.evidence)) return 'INVALID_LEGACY_FACT_CANDIDATE_BINDING';
    const evidence = p.evidence.find(item => item.id === fact.evidenceId);
    if (!evidence || fact.start < 0 || fact.end !== fact.start + fact.quote.length
      || evidence.text.slice(fact.start, fact.end) !== fact.quote) return 'INVALID_LEGACY_FACT_SOURCE';
    if (fact.status === 'confirmed' || fact.status === 'retracted') {
      const originalEvidence = p.evidence.find(item => item.id === fact.legacyCandidateBinding?.originalEvidenceId);
      if ((fact.status === 'confirmed') !== fact.locked || !fact.confirmedBy || !fact.confirmedAt
        || !originalEvidence || !legacyFactBindingIsValid(fact, originalEvidence)) return 'LEGACY_FACT_BINDING_REQUIRED';
    } else if (fact.locked || fact.confirmedBy || fact.confirmedAt || fact.legacyBinding)
      return 'LEGACY_FACT_BINDING_REQUIRED';
  }
  if (!factLifecycleBindingIsValid(fact) || !factLifecycleAuditIsValid(p, fact))
    return 'INVALID_FACT_LIFECYCLE_BINDING';
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
  if (!projectFactCollectionIsTraversable(p) || !projectEvidenceCollectionIsValid(p) || !persistedFactIsTraversable(fact)) return false;
  try {
    return !factBaseIntegrityReason(p, fact) && replacementRelationIsValid(p, fact) && !!fact.supersededByFactId;
  } catch { return false; }
}
export function factIntegrityReason(p: Project, fact: Fact): FactIntegrityReason | undefined {
  if (!persistedFactIsTraversable(fact)) return 'INVALID_FACT_CONTRACT';
  if (!projectFactCollectionIsTraversable(p)) return 'INVALID_PROJECT_FACT_COLLECTION';
  if (!projectEvidenceCollectionIsValid(p)) return 'INVALID_EVIDENCE_CONTRACT';
  try {
    const base = factBaseIntegrityReason(p, fact);
    if (base) return base;
    if (!replacementRelationIsValid(p, fact)) return 'INVALID_FACT_SUPERSESSION';
    return undefined;
  } catch { return 'INVALID_FACT_CONTRACT'; }
}
export function factIntegrityIsValid(p: Project, fact: Fact): boolean {
  return !factIntegrityReason(p, fact);
}
export function projectActiveFactIntegrityIsValid(p: Project): boolean {
  if (!projectFactCollectionIsTraversable(p) || !projectEvidenceCollectionIsValid(p)) return false;
  return p.facts.every(fact => factIntegrityIsValid(p, fact));
}
export function factSourceIsCurrent(p: Project, fact: Fact): boolean {
  if (!projectFactCollectionIsTraversable(p) || !projectEvidenceCollectionIsValid(p) || !persistedFactIsTraversable(fact)) return false;
  try {
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
  } catch { return false; }
}
export function availableEvidence(p: Project): Evidence[] {
  return projectEvidenceCollectionIsValid(p) ? p.evidence.filter(item => evidenceIsAvailable(p, item)) : [];
}
export function currentFactConflict(p: Project, fact: Fact, excludedId?: string): Fact | undefined {
  if (!projectFactCollectionIsTraversable(p) || !projectEvidenceCollectionIsValid(p) || !persistedFactIsTraversable(fact)) return;
  try {
    if (factSupersessionIsEffective(p, fact)) return;
    return p.facts.find(other => other.id !== fact.id && other.id !== excludedId && !factSupersessionIsEffective(p, other)
      && factSourceIsCurrent(p, other) && factsConflict(fact, other));
  } catch { return; }
}
export function evaluateFactEligibility(p: Project, fact: Fact): FactEligibility {
  if (!persistedFactIsTraversable(fact)) {
    const reasons: FactEligibilityReason[] = ['INVALID_FACT_CONTRACT', 'PROJECT_FACT_INTEGRITY_FAILURE'];
    return { eligible: false, reasons, formalFreezeEligible: false, formalFreezeReasons: reasons };
  }
  const reasons: FactEligibilityReason[] = [];
  if (fact.status !== 'confirmed') reasons.push('FACT_NOT_CONFIRMED');
  if (!fact.locked) reasons.push('FACT_NOT_LOCKED');
  const integrity = factIntegrityReason(p, fact);
  if (integrity) reasons.push(integrity);
  if (!integrity && factSupersessionIsEffective(p, fact)) reasons.push('FACT_SUPERSEDED');
  const projectIntegrityValid = projectActiveFactIntegrityIsValid(p);
  if (!projectIntegrityValid) reasons.push('PROJECT_FACT_INTEGRITY_FAILURE');
  const allActive = projectIntegrityValid ? p.facts.filter(item => ['candidate', 'confirmed'].includes(item.status)) : [];
  const current = allActive.filter(item => !factSupersessionIsEffective(p, item) && factSourceIsCurrent(p, item));
  if (current.some(item => item.structured && structuredRiskSeverity(item.structured) === 'blocker')
    || current.some(item => current.some(other => other.id !== item.id && factsConflict(item, other))))
    reasons.push('PROJECT_FACT_GOVERNANCE_BLOCKER');
  if (!integrity && !factSourceIsCurrent(p, fact)) reasons.push('FACT_SOURCE_UNAVAILABLE');
  if (!integrity && fact.structured && structuredRiskSeverity(fact.structured) === 'blocker') reasons.push('BLOCKING_FACT_RISK');
  if (!integrity && currentFactConflict(p, fact)) reasons.push('UNRESOLVED_FACT_CONFLICT');
  const unique = [...new Set(reasons)];
  const formalFreezeReasons = fact.structured ? [...unique] : [...unique, 'LEGACY_FACT_NOT_STRUCTURED' as const];
  return { eligible: unique.length === 0, reasons: unique,
    formalFreezeEligible: formalFreezeReasons.length === 0, formalFreezeReasons: [...new Set(formalFreezeReasons)] };
}
export function factGovernanceHasBlockingIssue(p: Project): boolean {
  if (!projectActiveFactIntegrityIsValid(p)) return true;
  const active = p.facts.filter(fact => ['candidate', 'confirmed'].includes(fact.status));
  const current = active.filter(fact => !factSupersessionIsEffective(p, fact) && factSourceIsCurrent(p, fact));
  return current.some(fact => fact.structured && structuredRiskSeverity(fact.structured) === 'blocker')
    || current.some(fact => current.some(other => other.id !== fact.id && factsConflict(fact, other)));
}
export function availableConfirmedFacts(p: Project): Fact[] {
  if (!projectActiveFactIntegrityIsValid(p)) return [];
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
  if (!projectFactCollectionIsTraversable(p) || !projectEvidenceCollectionIsValid(p)) return;
  for (const evidenceId of evidenceIds) {
    const evidence = p.evidence.find(item => item.id === evidenceId);
    if (!evidence?.materialSource || !evidenceIsAvailable(p, evidence)) continue;
    const source = currentMaterialSource(p, evidence.materialSource, 'product_evidence', evidenceId)!;
    const extraction = source.current.extraction;
    if (!extraction || (!sourceRunId && extraction.status === 'extracted')) continue;
    extraction.status = sourceRunId ? 'extracted' : 'candidate_created';
    extraction.candidateIds = projectActiveFactIntegrityIsValid(p) ? p.facts.filter(fact => factSourceIsCurrent(p, fact)
      && (fact.evidenceId === evidenceId || fact.structured?.sources.some(source => source.evidenceId === evidenceId))).map(fact => fact.id) : [];
    extraction.completedAt = new Date().toISOString(); extraction.completedBy = actor;
    if (sourceRunId) extraction.sourceRunId = sourceRunId;
  }
}
