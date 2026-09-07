import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { writeSchema, type Evidence, type Fact, type Project } from './contracts.js';
import { AppError } from './errors.js';
import { isStorageText } from './production-materials.js';

export const FACT_SOURCES_CONTRACT_VERSION = 'fact-sources.2' as const;
export const FACT_NORMALIZATION_VERSION = 'fact-normalization.1' as const;
export const FACT_RISK_REVIEW_VERSION = 'fact-risk-review.1' as const;
export const FACT_CANDIDATE_BINDING_VERSION = 'fact-candidate-binding.2' as const;
export const FACT_CONFIRMATION_VERSION = 'fact-confirmation.1' as const;
export const LEGACY_FACT_CANDIDATE_BINDING_VERSION = 'legacy-fact-candidate-binding.1' as const;
export const LEGACY_FACT_BINDING_VERSION = 'legacy-fact-binding.1' as const;
export const FACT_LIFECYCLE_BINDING_VERSION = 'fact-lifecycle-binding.2' as const;

const storageText = (min: number, max: number) => z.string().min(min).max(max).refine(isStorageText, 'Valid Unicode required');
const reasonText = storageText(1, 1000).refine(value => value.trim().length > 0, 'Reason required');
const confirmationActor = storageText(1, 1000).refine(value => value.trim().length > 0, 'Confirmation actor required');
const confirmationTimestamp = z.string().datetime();
const decimalText = z.string().min(1).max(30).regex(/^-?\d{1,18}(?:\.\d{1,9})?$/);
export const factUnitSchema = z.enum([
  'mg', 'g', 'kg', 'oz', 'lb',
  'mm', 'cm', 'm', 'in', 'ft',
  'mL', 'L', 'ms', 's', 'min', 'h',
  'V', 'mA', 'A', 'W', 'kW', '%', 'count',
]);
export type FactUnit = z.infer<typeof factUnitSchema>;

export const normalizedFactValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: storageText(1, 1000) }).strict(),
  z.object({ kind: z.literal('decimal'), value: decimalText, unit: factUnitSchema }).strict(),
]);
export type NormalizedFactValue = z.infer<typeof normalizedFactValueSchema>;

export const structuredSourceInputSchema = z.object({
  id: z.string().uuid(),
  evidenceId: z.string().uuid(),
  quote: storageText(1, 10_000),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  valueSpan: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict(),
}).strict().superRefine((source, ctx) => {
  if (source.end <= source.start) ctx.addIssue({ code: 'custom', path: ['end'], message: 'Source range must be non-empty' });
  if (source.valueSpan.start < source.start || source.valueSpan.end > source.end || source.valueSpan.end <= source.valueSpan.start)
    ctx.addIssue({ code: 'custom', path: ['valueSpan'], message: 'Value range must be inside the quote' });
});
export type StructuredSourceInput = z.infer<typeof structuredSourceInputSchema>;

const modelScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unspecified') }).strict(),
  z.object({ kind: z.literal('all') }).strict(),
  z.object({
    kind: z.literal('specified'),
    models: z.array(z.object({
      id: storageText(1, 150), sourceId: z.string().uuid(),
      start: z.number().int().nonnegative(), end: z.number().int().positive(),
    }).strict()).min(1).max(100),
  }).strict(),
]);
export const applicabilitySchema = z.object({
  models: modelScopeSchema,
  conditions: z.array(z.object({
    description: storageText(1, 500).refine(value => value.trim().length > 0, 'Description required'),
    sourceIds: z.array(z.string().uuid()).min(1).max(10),
  }).strict()).max(50),
}).strict();
export type FactApplicability = z.infer<typeof applicabilitySchema>;

export const FACT_RISK_KINDS = ['numeric_claim', 'certification', 'efficacy', 'safety', 'scope', 'other'] as const;
export const factRiskKindSchema = z.enum(FACT_RISK_KINDS);
export type FactRiskKind = z.infer<typeof factRiskKindSchema>;
export const factRiskSchema = z.object({
  id: z.string().uuid(), kind: factRiskKindSchema, severity: z.enum(['warning', 'blocker']),
  description: storageText(1, 1000).refine(value => value.trim().length > 0, 'Description required'),
  sourceIds: z.array(z.string().uuid()).min(1).max(10),
}).strict();
export type FactRisk = z.infer<typeof factRiskSchema>;
export interface StoredFactRisk extends FactRisk { origin: 'proposed' | 'derived' }

const riskAssessmentSchema = z.object({
  kind: factRiskKindSchema,
  assessment: z.enum(['present', 'not_found', 'not_applicable']),
  reason: reasonText,
  reviewedRiskIds: z.array(z.string().uuid()).max(200),
}).strict();
export const structuredRiskReviewInputSchema = z.object({
  categories: z.array(riskAssessmentSchema).length(FACT_RISK_KINDS.length),
}).strict().superRefine((review, ctx) => {
  const kinds = review.categories.map(item => item.kind);
  for (const kind of FACT_RISK_KINDS) if (kinds.filter(item => item === kind).length !== 1)
    ctx.addIssue({ code: 'custom', path: ['categories'], message: `Exactly one ${kind} review is required` });
});
export type StructuredRiskAssessment = z.infer<typeof riskAssessmentSchema>;

export const structuredFactCandidateSchema = writeSchema.extend({
  attribute: storageText(1, 100).refine(value => value.trim().length > 0, 'Attribute required'),
  role: z.enum(['core', 'supporting']),
  normalizedValue: normalizedFactValueSchema,
  sources: z.array(structuredSourceInputSchema).min(1).max(10),
  applicability: applicabilitySchema,
  risks: z.array(factRiskSchema).max(100).default([]),
  reason: reasonText,
  correctsFactId: z.string().uuid().optional(),
}).strict().superRefine((body, ctx) => {
  const sourceIds = body.sources.map(item => item.id);
  if (new Set(sourceIds).size !== sourceIds.length)
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Source IDs must be unique' });
  const sourceRanges = body.sources.map(item => `${item.evidenceId}:${item.start}:${item.end}`);
  if (new Set(sourceRanges).size !== sourceRanges.length)
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Evidence ranges must be unique' });
  const riskIds = body.risks.map(item => item.id);
  if (new Set(riskIds).size !== riskIds.length)
    ctx.addIssue({ code: 'custom', path: ['risks'], message: 'Risk IDs must be unique' });
});
export type StructuredFactCandidateInput = z.infer<typeof structuredFactCandidateSchema>;

export const structuredFactCompatibilitySchema = z.object({
  id: z.string().uuid(),
  attribute: storageText(1, 100).refine(value => value === normalizeFactText(value), 'Normalized attribute required'),
  role: z.enum(['core', 'supporting']),
  value: storageText(1, 1000),
  evidenceId: z.string().uuid(),
  quote: storageText(1, 10_000),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  sourceRunId: z.literal('human'),
  status: z.enum(['candidate', 'confirmed', 'rejected', 'retracted']),
  locked: z.boolean(),
  issueSeverity: z.enum(['none', 'warning', 'blocker']),
  confirmedBy: confirmationActor.optional(),
  confirmedAt: confirmationTimestamp.optional(),
  correctsFactId: z.string().uuid().optional(),
  createdBy: storageText(1, 1000),
  reason: reasonText,
  structured: z.unknown(),
  lifecycleBinding: z.unknown().optional(),
  replacementTransitions: z.unknown().optional(),
  supersededByFactId: z.string().uuid().optional(),
  supersededBy: confirmationActor.optional(),
  supersededAt: confirmationTimestamp.optional(),
  supersededReason: reasonText.optional(),
}).strict().superRefine((fact, ctx) => {
  if (fact.end !== fact.start + fact.quote.length)
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'Compatibility range must match the quote' });
});

export const structuredFactConfirmSchema = writeSchema.extend({
  reason: reasonText,
  acknowledgedRiskIds: z.array(z.string().uuid()).max(200),
  riskReview: structuredRiskReviewInputSchema,
  replaceFactId: z.string().uuid().optional(),
}).strict();
export type StructuredFactConfirmInput = z.infer<typeof structuredFactConfirmSchema>;

export const structuredFactSourceReconfirmSchema = writeSchema.extend({
  evidenceId: z.string().uuid(), reason: reasonText,
}).strict();
export type StructuredFactSourceReconfirmInput = z.infer<typeof structuredFactSourceReconfirmSchema>;

export interface StoredRiskReview {
  contractVersion: typeof FACT_RISK_REVIEW_VERSION;
  categories: StructuredRiskAssessment[];
  acknowledgedRiskIds: string[];
  reviewer: string;
  reviewedAt: string;
}
export interface StructuredSourceReview {
  status: 'invalidated' | 'reconfirmation_required';
  evidenceId: string; decisionId: string; usageVersion: number; actor: string; at: string; reason: string;
}
export interface StructuredSourceReconfirmation {
  previousEvidenceId: string; evidenceId: string; decisionId: string; usageVersion: number;
  actor: string; at: string; reason: string;
}
export interface StructuredFactSource extends StructuredSourceInput {
  contentSha256: string;
  rawValue: string;
  rawUnit: FactUnit | null;
  review?: StructuredSourceReview;
  reconfirmations?: StructuredSourceReconfirmation[];
}
export const canonicalFactValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: storageText(1, 1000) }).strict(),
  z.object({ kind: z.literal('decimal'), dimension: storageText(1, 100),
    numerator: z.string().regex(/^-?\d+$/), denominator: z.string().regex(/^[1-9]\d*$/) }).strict(),
]);
export type CanonicalFactValue = z.infer<typeof canonicalFactValueSchema>;
export interface StructuredFact {
  contractVersion: typeof FACT_SOURCES_CONTRACT_VERSION;
  normalizationVersion: typeof FACT_NORMALIZATION_VERSION;
  normalizedValue: NormalizedFactValue;
  canonicalValue: CanonicalFactValue;
  sources: StructuredFactSource[];
  applicability: FactApplicability;
  proposedRisks: StoredFactRisk[];
  derivedRisks: StoredFactRisk[];
  riskPolicy: {
    automaticSemanticRiskDetection: 'not_performed';
    manualReviewResponsibilities: readonly ['certification', 'efficacy', 'safety', 'scope', 'other'];
  };
  riskReview?: StoredRiskReview;
  candidateBinding?: StructuredFactCandidateBinding;
  confirmation?: StructuredFactConfirmation;
}

export interface StructuredFactCandidateBinding {
  contractVersion: typeof FACT_CANDIDATE_BINDING_VERSION;
  factId: string;
  createdBy: string;
  originalSources: { sourceId: string; evidenceId: string }[];
  snapshotSha256: string;
}

export interface StructuredFactConfirmation {
  contractVersion: typeof FACT_CONFIRMATION_VERSION;
  factId: string;
  confirmedBy: string;
  confirmedAt: string;
  snapshotSha256: string;
}
export interface LegacyFactBinding {
  contractVersion: typeof LEGACY_FACT_BINDING_VERSION;
  factId: string;
  confirmedBy: string;
  confirmedAt: string;
  evidenceSha256: string;
  snapshotSha256: string;
}
export interface LegacyFactCandidateBinding {
  contractVersion: typeof LEGACY_FACT_CANDIDATE_BINDING_VERSION;
  factId: string;
  createdBy: string | null;
  originalEvidenceId: string;
  originalQuote: string;
  originalStart: number;
  originalEnd: number;
  snapshotSha256: string;
}
export const factReplacementTransitionSchema = z.object({
  id: z.string().uuid(),
  predecessorFactId: z.string().uuid(),
  successorFactId: z.string().uuid(),
  actor: confirmationActor,
  at: confirmationTimestamp,
  reason: reasonText,
}).strict();
export type FactReplacementTransition = z.infer<typeof factReplacementTransitionSchema>;
export interface FactLifecycleBinding {
  contractVersion: typeof FACT_LIFECYCLE_BINDING_VERSION;
  factId: string;
  transitionId: string;
  previousStatus: Fact['status'] | null;
  status: Fact['status'];
  actor: string;
  at: string;
  reason: string;
  snapshotSha256: string;
}

const sha256Text = z.string().regex(/^[a-f0-9]{64}$/);
const storedFactStatus = z.enum(['candidate', 'confirmed', 'rejected', 'retracted']);
export const storedSourceReviewSchema = z.object({
  status: z.enum(['invalidated', 'reconfirmation_required']), evidenceId: z.string().uuid(),
  decisionId: z.string().uuid(), usageVersion: z.number().int().positive(), actor: confirmationActor,
  at: confirmationTimestamp, reason: reasonText,
}).strict();
export const storedSourceReconfirmationSchema = z.object({
  previousEvidenceId: z.string().uuid(), evidenceId: z.string().uuid(), decisionId: z.string().uuid(),
  usageVersion: z.number().int().positive(), actor: confirmationActor, at: confirmationTimestamp, reason: reasonText,
}).strict();
export const storedStructuredFactSourceSchema = structuredSourceInputSchema.safeExtend({
  contentSha256: sha256Text,
  rawValue: storageText(1, 10_000),
  rawUnit: factUnitSchema.nullable(),
  review: storedSourceReviewSchema.optional(),
  reconfirmations: z.array(storedSourceReconfirmationSchema).max(1000).optional(),
}).strict();
const legacyCandidateBindingSchema = z.object({
  contractVersion: z.literal(LEGACY_FACT_CANDIDATE_BINDING_VERSION), factId: z.string().uuid(),
  createdBy: confirmationActor.nullable(), originalEvidenceId: z.string().uuid(),
  originalQuote: storageText(1, 2000), originalStart: z.number().int().nonnegative(),
  originalEnd: z.number().int().positive(), snapshotSha256: sha256Text,
}).strict().superRefine((binding, ctx) => {
  if (binding.originalEnd !== binding.originalStart + binding.originalQuote.length)
    ctx.addIssue({ code: 'custom', path: ['originalEnd'], message: 'Original legacy range must match the quote' });
});
const legacyBindingSchema = z.object({
  contractVersion: z.literal(LEGACY_FACT_BINDING_VERSION), factId: z.string().uuid(), confirmedBy: confirmationActor,
  confirmedAt: confirmationTimestamp, evidenceSha256: sha256Text, snapshotSha256: sha256Text,
}).strict();
const lifecycleBindingSchema = z.object({
  contractVersion: z.literal(FACT_LIFECYCLE_BINDING_VERSION), factId: z.string().uuid(), transitionId: z.string().uuid(),
  previousStatus: storedFactStatus.nullable(), status: storedFactStatus, actor: confirmationActor,
  at: confirmationTimestamp, reason: reasonText, snapshotSha256: sha256Text,
}).strict();
const structuredCandidateBindingSchema = z.object({
  contractVersion: z.literal(FACT_CANDIDATE_BINDING_VERSION), factId: z.string().uuid(),
  createdBy: confirmationActor,
  originalSources: z.array(z.object({ sourceId: z.string().uuid(), evidenceId: z.string().uuid() }).strict()).min(1).max(10),
  snapshotSha256: sha256Text,
}).strict().superRefine((binding, ctx) => {
  const sourceIds = binding.originalSources.map(source => source.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length)
    ctx.addIssue({ code: 'custom', path: ['originalSources'], message: 'Original source IDs must be unique' });
});
const structuredConfirmationSchema = z.object({
  contractVersion: z.literal(FACT_CONFIRMATION_VERSION), factId: z.string().uuid(), confirmedBy: confirmationActor,
  confirmedAt: confirmationTimestamp, snapshotSha256: sha256Text,
}).strict();
const structuredCandidateBindingV1Schema = z.object({
  contractVersion: z.literal('fact-candidate-binding.1'), factId: z.string().uuid(),
  createdBy: confirmationActor, snapshotSha256: sha256Text,
}).strict();
const storedProposedFactRiskSchema = factRiskSchema.safeExtend({ origin: z.literal('proposed') }).strict();
const storedDerivedFactRiskSchema = factRiskSchema.safeExtend({ origin: z.literal('derived') }).strict();
const storedRiskReviewSchema = structuredRiskReviewInputSchema.safeExtend({
  contractVersion: z.literal(FACT_RISK_REVIEW_VERSION),
  acknowledgedRiskIds: z.array(z.string().uuid()).max(200),
  reviewer: confirmationActor,
  reviewedAt: confirmationTimestamp,
}).strict();
export const storedStructuredFactSchema = z.object({
  contractVersion: z.literal(FACT_SOURCES_CONTRACT_VERSION),
  normalizationVersion: z.literal(FACT_NORMALIZATION_VERSION),
  normalizedValue: normalizedFactValueSchema,
  canonicalValue: canonicalFactValueSchema,
  sources: z.array(storedStructuredFactSourceSchema).min(1).max(10),
  applicability: applicabilitySchema,
  proposedRisks: z.array(storedProposedFactRiskSchema).max(100),
  derivedRisks: z.array(storedDerivedFactRiskSchema).max(100),
  riskPolicy: z.object({
    automaticSemanticRiskDetection: z.literal('not_performed'),
    manualReviewResponsibilities: z.tuple([
      z.literal('certification'), z.literal('efficacy'), z.literal('safety'), z.literal('scope'), z.literal('other'),
    ]),
  }).strict(),
  riskReview: storedRiskReviewSchema.optional(),
  // V1 remains traversable so an obsolete Fact can still be quarantined when its material source is withdrawn.
  // Current integrity and all downstream use continue to require the V2 binding checked above.
  candidateBinding: z.union([structuredCandidateBindingSchema, structuredCandidateBindingV1Schema]),
  confirmation: structuredConfirmationSchema.optional(),
}).strict().superRefine((structured, ctx) => {
  const sourceIds = structured.sources.map(source => source.id);
  if (new Set(sourceIds).size !== sourceIds.length)
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Stored source IDs must be unique' });
  const sourceRanges = structured.sources.map(source => `${source.evidenceId}:${source.start}:${source.end}`);
  if (new Set(sourceRanges).size !== sourceRanges.length)
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Stored evidence ranges must be unique' });
});
export const legacyFactCompatibilitySchema = z.object({
  id: z.string().uuid(),
  attribute: storageText(1, 100).refine(value => value.trim().length > 0, 'Attribute required'),
  role: z.enum(['core', 'supporting']),
  value: storageText(1, 1000).refine(value => value.trim().length > 0, 'Value required'),
  evidenceId: z.string().uuid(), quote: storageText(1, 2000),
  start: z.number().int().nonnegative(), end: z.number().int().positive(), sourceRunId: storageText(1, 1000),
  status: storedFactStatus, locked: z.boolean(), issueSeverity: z.enum(['none', 'warning', 'blocker']),
  confirmedBy: confirmationActor.optional(), confirmedAt: confirmationTimestamp.optional(),
  correctsFactId: z.string().uuid().optional(), createdBy: confirmationActor.optional(), reason: reasonText.optional(),
  sourceReview: storedSourceReviewSchema.optional(),
  sourceReconfirmations: z.array(storedSourceReconfirmationSchema).max(1000).optional(),
  legacyCandidateBinding: legacyCandidateBindingSchema.optional(),
  legacyBinding: legacyBindingSchema.optional(), lifecycleBinding: lifecycleBindingSchema.optional(),
  replacementTransitions: z.array(factReplacementTransitionSchema).max(1000).optional(),
  supersededByFactId: z.string().uuid().optional(), supersededBy: confirmationActor.optional(),
  supersededAt: confirmationTimestamp.optional(), supersededReason: reasonText.optional(),
}).strict().superRefine((fact, ctx) => {
  if (fact.end !== fact.start + fact.quote.length)
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'Legacy range must match the quote' });
  if ((fact.createdBy === undefined) !== (fact.reason === undefined))
    ctx.addIssue({ code: 'custom', path: ['createdBy'], message: 'Legacy candidate attribution must be complete' });
});

interface UnitDefinition { dimension: string; numerator: bigint; denominator: bigint }
const units: Record<FactUnit, UnitDefinition> = {
  mg: { dimension: 'mass', numerator: 1n, denominator: 1n },
  g: { dimension: 'mass', numerator: 1000n, denominator: 1n },
  kg: { dimension: 'mass', numerator: 1_000_000n, denominator: 1n },
  oz: { dimension: 'mass', numerator: 226_796_185n, denominator: 8000n },
  lb: { dimension: 'mass', numerator: 45_359_237n, denominator: 100n },
  mm: { dimension: 'length', numerator: 1n, denominator: 1n },
  cm: { dimension: 'length', numerator: 10n, denominator: 1n },
  m: { dimension: 'length', numerator: 1000n, denominator: 1n },
  in: { dimension: 'length', numerator: 127n, denominator: 5n },
  ft: { dimension: 'length', numerator: 1524n, denominator: 5n },
  mL: { dimension: 'volume', numerator: 1n, denominator: 1n },
  L: { dimension: 'volume', numerator: 1000n, denominator: 1n },
  ms: { dimension: 'time', numerator: 1n, denominator: 1n },
  s: { dimension: 'time', numerator: 1000n, denominator: 1n },
  min: { dimension: 'time', numerator: 60_000n, denominator: 1n },
  h: { dimension: 'time', numerator: 3_600_000n, denominator: 1n },
  V: { dimension: 'voltage', numerator: 1n, denominator: 1n },
  mA: { dimension: 'current', numerator: 1n, denominator: 1n },
  A: { dimension: 'current', numerator: 1000n, denominator: 1n },
  W: { dimension: 'power', numerator: 1n, denominator: 1n },
  kW: { dimension: 'power', numerator: 1000n, denominator: 1n },
  '%': { dimension: 'percent', numerator: 1n, denominator: 1n },
  count: { dimension: 'count', numerator: 1n, denominator: 1n },
};

export function normalizeFactText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}
export function normalizeFactKey(value: string): string {
  return normalizeFactText(value).toLowerCase();
}
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  return a || 1n;
}
function reduced(numerator: bigint, denominator: bigint) {
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
function decimalRational(value: string) {
  const normalized = value.normalize('NFKC');
  if (!/^-?\d{1,18}(?:\.\d{1,9})?$/.test(normalized)) throw new AppError('UNSUPPORTED_DECIMAL', 409);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}` || '0') * (negative ? -1n : 1n);
  return reduced(numerator, denominator);
}
function canonicalDecimal(value: string, unit: FactUnit): CanonicalFactValue & { kind: 'decimal' } {
  const decimal = decimalRational(value);
  const factor = units[unit];
  const result = reduced(decimal.numerator * factor.numerator, decimal.denominator * factor.denominator);
  return { kind: 'decimal', dimension: factor.dimension, numerator: result.numerator.toString(), denominator: result.denominator.toString() };
}
function canonicalDecimalText(value: string): string {
  const normalized = value.normalize('NFKC');
  decimalRational(normalized); // Applies the bounded grammar before canonical text is stored.
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [rawWhole = '0', rawFraction = ''] = unsigned.split('.');
  const whole = rawWhole.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.replace(/0+$/, '');
  const result = `${whole}${fraction ? `.${fraction}` : ''}`;
  return negative && result !== '0' ? `-${result}` : result;
}
export function normalizeRequestedValue(value: NormalizedFactValue): { normalized: NormalizedFactValue; canonical: CanonicalFactValue } {
  if (value.kind === 'text') {
    const normalized = normalizeFactText(value.value);
    if (!normalized) throw new AppError('EMPTY_NORMALIZED_VALUE', 409);
    return { normalized: { kind: 'text', value: normalized }, canonical: { kind: 'text', value: normalized } };
  }
  const normalizedValue = canonicalDecimalText(value.value);
  return { normalized: { kind: 'decimal', value: normalizedValue, unit: value.unit }, canonical: canonicalDecimal(normalizedValue, value.unit) };
}

const unitAliases: Readonly<Record<string, FactUnit>> = {
  mg: 'mg', '毫克': 'mg', g: 'g', '克': 'g', kg: 'kg', '千克': 'kg', '公斤': 'kg',
  oz: 'oz', '盎司': 'oz', lb: 'lb', '磅': 'lb',
  mm: 'mm', '毫米': 'mm', cm: 'cm', '厘米': 'cm', m: 'm', '米': 'm', in: 'in', '英寸': 'in', ft: 'ft', '英尺': 'ft',
  mL: 'mL', ml: 'mL', '毫升': 'mL', L: 'L', l: 'L', '升': 'L',
  ms: 'ms', '毫秒': 'ms', s: 's', '秒': 's', min: 'min', '分钟': 'min', h: 'h', '小时': 'h',
  V: 'V', v: 'V', '伏': 'V', '伏特': 'V', mA: 'mA', ma: 'mA', '毫安': 'mA', A: 'A', a: 'A', '安': 'A', '安培': 'A',
  W: 'W', w: 'W', '瓦': 'W', '瓦特': 'W', kW: 'kW', kw: 'kW', '千瓦': 'kW',
  '%': '%', '％': '%', count: 'count', '个': 'count', '件': 'count',
};
const unitAliasPattern = Object.keys(unitAliases).sort((a, b) => b.length - a.length)
  .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const sourceDecimalPattern = new RegExp(`^([+-]?\\d{1,18}(?:\\.\\d{1,9})?)\\s*(?:(?:\\(\\s*(${unitAliasPattern})\\s*\\))|(${unitAliasPattern}))?$`, 'u');
export function parseSourceValue(rawValue: string, target: NormalizedFactValue): { rawUnit: FactUnit | null; canonical: CanonicalFactValue } {
  if (target.kind === 'text') return { rawUnit: null, canonical: { kind: 'text', value: normalizeFactText(rawValue) } };
  const match = sourceDecimalPattern.exec(rawValue.normalize('NFKC').trim().replace(/^−/u, '-'));
  if (!match) throw new AppError('INVALID_DECIMAL_SOURCE', 409);
  const rawUnit = match[2] ?? match[3];
  const sourceUnit = rawUnit ? unitAliases[rawUnit]! : 'count';
  if (!factUnitSchema.safeParse(sourceUnit).success) throw new AppError('UNSUPPORTED_FACT_UNIT', 409);
  const canonical = canonicalDecimal(match[1]!.replace(/^\+/u, ''), sourceUnit);
  return { rawUnit: rawUnit ? sourceUnit : null, canonical };
}
export function canonicalValuesEqual(a: CanonicalFactValue, b: CanonicalFactValue): boolean {
  return a.kind === b.kind && (a.kind === 'text'
    ? a.value === (b as CanonicalFactValue & { kind: 'text' }).value
    : a.dimension === (b as CanonicalFactValue & { kind: 'decimal' }).dimension
      && a.numerator === (b as CanonicalFactValue & { kind: 'decimal' }).numerator
      && a.denominator === (b as CanonicalFactValue & { kind: 'decimal' }).denominator);
}
export function normalizedDisplayValue(value: NormalizedFactValue): string {
  if (value.kind === 'text') return value.value;
  if (value.unit === 'count') return value.value;
  if (value.unit === '%') return `${value.value}%`;
  return `${value.value} ${value.unit}`;
}

export function structuredSourceMatchesEvidence(source: StructuredFactSource, evidence: Evidence): boolean {
  const sha256 = createHash('sha256').update(evidence.text, 'utf8').digest('hex');
  return evidence.sha256 === sha256 && evidence.objectKey === `${sha256}.txt` && source.contentSha256 === sha256
    && source.start >= 0 && source.end === source.start + source.quote.length
    && source.valueSpan.start >= source.start && source.valueSpan.end <= source.end && source.valueSpan.end > source.valueSpan.start
    && evidence.text.slice(source.start, source.end) === source.quote
    && evidence.text.slice(source.valueSpan.start, source.valueSpan.end) === source.rawValue;
}
export type DecimalValueSpanIssue = 'numeric_boundary' | 'unit_omission';
const numericGroupingSeparator = "[,︐﹐٬٫'’]";
const numericGroupingSpace = '[ \\t\\u00a0\\u2007\\u2009\\u202f]';
const numericSign = '[+\\-−]';
const numericRatioSeparator = '[/⁄∕:：]';
const numericJoinOperator = '[/⁄∕·⋅∙*×]';
const numericRangeOrQualifier = '[+\\-−–—~〜±<>≤≥≦≧≈≃^×*]';
const currencyOrDegree = '[$€£¥₽₹₩°℃℉]';
const defaultIgnorable = '[\\p{Default_Ignorable_Code_Point}\\p{Cf}]';
const unitToken = `(?:${unitAliasPattern})(?!\\p{Script=Latin})`;
export function decimalValueSpanIssue(text: string, start: number, end: number,
  rawUnit: FactUnit | null): DecimalValueSpanIssue | undefined {
  // Normalize only bounded context. Persisted spans remain exact UTF-16 offsets into the original Evidence.
  const rawBefore = text.slice(Math.max(0, start - 64), start);
  const rawAfter = text.slice(end, Math.min(text.length, end + 64));
  // Format/default-ignorable code points and variation selectors cannot split one numeric token invisibly.
  if (new RegExp(`${defaultIgnorable}\\s*$`, 'u').test(rawBefore)
    || new RegExp(`^\\s*${defaultIgnorable}`, 'u').test(rawAfter)) return 'numeric_boundary';
  // A Unicode mark belongs to the adjacent grapheme. A persisted numeric span cannot cut through that grapheme.
  if (/\p{M}\s*$/u.test(rawBefore) || /^\s*\p{M}/u.test(rawAfter)) return 'numeric_boundary';
  const before = rawBefore.normalize('NFKC');
  const after = rawAfter.normalize('NFKC');
  const splitBefore = new RegExp(`(?:[%‰‱.\\p{N}]|\\p{Script=Latin}|${numericRangeOrQualifier}|${currencyOrDegree})$`, 'u').test(before)
    || new RegExp(`\\p{N}(?:${numericGroupingSeparator}|${numericGroupingSpace})$`, 'u').test(before)
    || new RegExp(`\\p{N}[eE]${numericSign}?$`, 'u').test(before)
    || new RegExp(`\\p{N}\\s*${numericRatioSeparator}\\s*$`, 'u').test(before)
    || new RegExp(`(?:\\p{N}|\\p{L})\\s*(?:${numericJoinOperator}|${numericRangeOrQualifier})\\s*$`, 'u').test(before)
    || new RegExp(`(?:${unitAliasPattern})\\s*$`, 'u').test(before)
    || /(?:约|近|大约|约为|至少|至多|最多|最少|不超过|不低于|不大于|不小于|大于|小于)\s*$/u.test(before)
    || new RegExp(`(?:${numericRangeOrQualifier}|${currencyOrDegree})\\s*$`, 'u').test(before);
  const unknownCompositeUnit = rawUnit === null
    // Keep a spaced editorial delimiter such as "10 / note" valid, but reject compact unit syntax such as "10 /box".
    ? new RegExp(`^\\s*(?:${numericJoinOperator})\\p{L}`, 'u').test(after)
    : new RegExp(`^\\s*(?:${numericJoinOperator})\\s*\\p{L}`, 'u').test(after);
  const splitAfter = /^\p{N}/u.test(after) || /^\.\p{N}/u.test(after)
    || new RegExp(`^(?:${numericGroupingSeparator}${numericGroupingSpace}*|${numericGroupingSpace}+)\\p{N}`, 'u').test(after)
    || new RegExp(`^[eE]${numericSign}?\\p{N}`, 'u').test(after)
    || new RegExp(`^\\s*${numericRatioSeparator}\\s*\\p{N}`, 'u').test(after)
    || new RegExp(`^\\s*${numericRangeOrQualifier}`, 'u').test(after)
    || new RegExp(`^\\s*${numericJoinOperator}\\s*(?:${unitToken}|\\p{N})`, 'u').test(after)
    || unknownCompositeUnit
    || (rawUnit !== null && new RegExp(`^\\s*(?:[;；,:，]\\s*)?(?:per\\s+\\p{L}|每\\s*\\p{L})`, 'iu').test(after));
  if (splitBefore || splitAfter) return 'numeric_boundary';
  if (rawUnit === null && (new RegExp(`^\\s*(?:(?:[\\)\\]】]\\s*)?(?:[\\(\\[【]\\s*)?(?:${unitAliasPattern}|[%‰‱])|${currencyOrDegree}\\s*\\p{L}?)`, 'u').test(after)
    || /^\p{L}/u.test(after) || /^\s+\p{L}/u.test(after)))
    return 'unit_omission';
  if (/^[%‰‱\p{L}]/u.test(after) || /^\s*[\(\[【]\s*\p{L}/u.test(after)) return 'numeric_boundary';
  return undefined;
}
export function decimalValueSpanIsComplete(text: string, start: number, end: number, rawUnit: FactUnit | null): boolean {
  return !decimalValueSpanIssue(text, start, end, rawUnit);
}
export function allStoredRisks(structured: StructuredFact): StoredFactRisk[] {
  return [...(Array.isArray(structured.proposedRisks) ? structured.proposedRisks : []),
    ...(Array.isArray(structured.derivedRisks) ? structured.derivedRisks : [])];
}
function storedRiskIsValid(risk: StoredFactRisk, origin: StoredFactRisk['origin']): boolean {
  return risk?.origin === origin && factRiskSchema.safeParse({ id: risk.id, kind: risk.kind, severity: risk.severity,
    description: risk.description, sourceIds: risk.sourceIds }).success;
}
export function structuredRiskReviewIsComplete(structured: StructuredFact): boolean {
  const review = structured.riskReview;
  if (structured.contractVersion !== FACT_SOURCES_CONTRACT_VERSION || structured.normalizationVersion !== FACT_NORMALIZATION_VERSION
    || !structured.riskPolicy || structured.riskPolicy.automaticSemanticRiskDetection !== 'not_performed'
    || JSON.stringify(structured.riskPolicy.manualReviewResponsibilities) !== JSON.stringify(['certification', 'efficacy', 'safety', 'scope', 'other'])
    || !Array.isArray(structured.proposedRisks) || !Array.isArray(structured.derivedRisks)
    || structured.proposedRisks.some(risk => !storedRiskIsValid(risk, 'proposed'))
    || structured.derivedRisks.some(risk => !storedRiskIsValid(risk, 'derived'))
    || !review || review.contractVersion !== FACT_RISK_REVIEW_VERSION || typeof review.reviewer !== 'string' || !review.reviewer
    || typeof review.reviewedAt !== 'string' || !review.reviewedAt || !Array.isArray(review.categories)
    || !Array.isArray(review.acknowledgedRiskIds) || !structuredRiskReviewInputSchema.safeParse({ categories: review.categories }).success)
    return false;
  const risks = allStoredRisks(structured);
  const allIds = [...new Set(risks.map(item => item.id))].sort();
  const acknowledged = [...new Set(review.acknowledgedRiskIds)].sort();
  if (allIds.length !== risks.length || acknowledged.length !== review.acknowledgedRiskIds.length
    || JSON.stringify(allIds) !== JSON.stringify(acknowledged)) return false;
  for (const kind of FACT_RISK_KINDS) {
    const categories = review.categories.filter(item => item.kind === kind);
    if (categories.length !== 1) return false;
    const category = categories[0]!;
    const expected = risks.filter(item => item.kind === kind).map(item => item.id).sort();
    const reviewed = [...new Set(category.reviewedRiskIds)].sort();
    if (!category.reason.trim() || reviewed.length !== category.reviewedRiskIds.length
      || JSON.stringify(expected) !== JSON.stringify(reviewed)) return false;
    if (expected.length && category.assessment !== 'present') return false;
    if (!expected.length && category.assessment === 'present') return false;
  }
  if (structured.normalizedValue.kind === 'decimal') {
    const numeric = review.categories.find(item => item.kind === 'numeric_claim');
    if (!numeric || numeric.assessment !== 'present' || !structured.derivedRisks.some(item => item.kind === 'numeric_claim')) return false;
  }
  return true;
}
export function structuredRiskSeverity(structured: StructuredFact): 'none' | 'warning' | 'blocker' {
  const risks = allStoredRisks(structured);
  if (risks.some(item => item.severity === 'blocker')) return 'blocker';
  return risks.length ? 'warning' : 'none';
}
export function modelScopesAreDisjoint(a: Fact, b: Fact): boolean {
  const left = a.structured?.applicability.models; const right = b.structured?.applicability.models;
  if (left?.kind !== 'specified' || right?.kind !== 'specified') return false;
  const rightIds = new Set(right.models.map(item => normalizeFactKey(item.id)));
  return left.models.every(item => !rightIds.has(normalizeFactKey(item.id)));
}
function normalizedApplicabilityScope(fact: Fact) {
  const applicability = fact.structured?.applicability
    ?? { models: { kind: 'unspecified' as const }, conditions: [] };
  const models = applicability.models.kind === 'specified'
    ? { kind: 'specified' as const, ids: applicability.models.models.map(item => normalizeFactKey(item.id)).sort() }
    : { kind: applicability.models.kind };
  const conditions = applicability.conditions.map(item => normalizeFactKey(item.description)).sort();
  return { models, conditions };
}
export function factApplicabilityScopesEqual(a: Fact, b: Fact): boolean {
  return canonical(normalizedApplicabilityScope(a)) === canonical(normalizedApplicabilityScope(b));
}
export function factValuesEqual(a: Fact, b: Fact): boolean {
  if (normalizeFactText(a.value) === normalizeFactText(b.value)) return true;
  return !!a.structured && !!b.structured && canonicalValuesEqual(a.structured.canonicalValue, b.structured.canonicalValue);
}
export function factsConflict(a: Fact, b: Fact): boolean {
  if (!['candidate', 'confirmed'].includes(a.status) || !['candidate', 'confirmed'].includes(b.status)
    || modelScopesAreDisjoint(a, b)) return false;
  const sameAttributeDifferentValue = normalizeFactKey(a.attribute) === normalizeFactKey(b.attribute) && !factValuesEqual(a, b);
  const correctionOverlap = a.correctsFactId === b.id || b.correctsFactId === a.id;
  return sameAttributeDifferentValue || correctionOverlap;
}
export function rejectedFactRequiringReconsideration(facts: Fact[], candidate: Fact): Fact | undefined {
  return facts.find(other => ['rejected', 'retracted'].includes(other.status)
    && normalizeFactKey(other.attribute) === normalizeFactKey(candidate.attribute)
    && factValuesEqual(other, candidate) && !modelScopesAreDisjoint(other, candidate));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function candidateSemanticSnapshot(fact: Fact) {
  const structured = fact.structured!;
  return {
    fact: { id: fact.id, attribute: fact.attribute, role: fact.role, value: fact.value,
      quote: fact.quote, start: fact.start, end: fact.end, sourceRunId: fact.sourceRunId,
      correctsFactId: fact.correctsFactId ?? null, createdBy: fact.createdBy ?? null, reason: fact.reason ?? null },
    structured: { ...structured,
      sources: structured.sources.map(({ evidenceId: _evidenceId, review: _review, reconfirmations: _reconfirmations,
        ...source }) => source),
      riskReview: undefined, candidateBinding: undefined, confirmation: undefined },
  };
}
function candidateBindingSnapshot(fact: Fact, originalSources: StructuredFactCandidateBinding['originalSources']) {
  return { ...candidateSemanticSnapshot(fact), originalSources };
}
function confirmedSemanticSnapshot(fact: Fact) {
  const structured = fact.structured!;
  return { ...candidateSemanticSnapshot(fact),
    structured: { ...structured,
      sources: structured.sources.map(({ evidenceId: _evidenceId, review: _review, reconfirmations: _reconfirmations,
        ...source }) => source),
      candidateBinding: undefined, confirmation: undefined } };
}
function sha256(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
function lifecycleSnapshot(fact: Fact) {
  return {
    factId: fact.id,
    attribute: fact.attribute,
    role: fact.role,
    value: fact.value,
    evidenceId: fact.evidenceId,
    quote: fact.quote,
    start: fact.start,
    end: fact.end,
    sourceRunId: fact.sourceRunId,
    createdBy: fact.createdBy ?? null,
    reason: fact.reason ?? null,
    status: fact.status,
    locked: fact.locked,
    confirmedBy: fact.confirmedBy ?? null,
    confirmedAt: fact.confirmedAt ?? null,
    correctsFactId: fact.correctsFactId ?? null,
    supersededByFactId: fact.supersededByFactId ?? null,
    supersededBy: fact.supersededBy ?? null,
    supersededAt: fact.supersededAt ?? null,
    supersededReason: fact.supersededReason ?? null,
    replacementTransitions: fact.replacementTransitions ?? [],
    sourceReview: fact.sourceReview ?? null,
    sourceReconfirmations: fact.sourceReconfirmations ?? [],
    legacyCandidateBinding: fact.legacyCandidateBinding ?? null,
    legacyBinding: fact.legacyBinding ?? null,
    structuredCandidateBinding: fact.structured?.candidateBinding ?? null,
    structuredConfirmation: fact.structured?.confirmation ?? null,
    structuredSources: fact.structured?.sources.map(source => ({ id: source.id, evidenceId: source.evidenceId,
      review: source.review ?? null, reconfirmations: source.reconfirmations ?? [] })) ?? [],
  };
}
function lifecycleTransitionAllowed(previous: Fact['status'] | null, status: Fact['status']): boolean {
  return previous === null ? status === 'candidate'
    : previous === status || (previous === 'candidate' && ['confirmed', 'rejected'].includes(status))
      || (previous === 'confirmed' && status === 'retracted');
}
function lifecycleBindingDigest(fact: Fact, binding: Pick<FactLifecycleBinding,
  'transitionId' | 'previousStatus' | 'status' | 'actor' | 'at' | 'reason'>): string {
  const metadata = { transitionId: binding.transitionId, previousStatus: binding.previousStatus,
    status: binding.status, actor: binding.actor, at: binding.at, reason: binding.reason };
  return sha256({ lifecycle: lifecycleSnapshot(fact), binding: metadata });
}
export function createFactLifecycleBinding(fact: Fact, actor: string, reason: string,
  previousStatus: Fact['status'] | null, at = new Date().toISOString(), allowInvalidPriorForQuarantine = false): FactLifecycleBinding {
  const prior = lifecycleBindingSchema.safeParse(fact.lifecycleBinding);
  const transitionStartsFromPersistedState = previousStatus === null
    ? fact.lifecycleBinding === undefined
    : prior.success && prior.data.factId === fact.id && prior.data.status === previousStatus
      || allowInvalidPriorForQuarantine
        && (previousStatus === 'candidate' && fact.status === 'rejected'
          || previousStatus === 'confirmed' && fact.status === 'retracted');
  if (!transitionStartsFromPersistedState
    || !confirmationActor.safeParse(actor).success || !reasonText.safeParse(reason).success
    || !confirmationTimestamp.safeParse(at).success || !lifecycleTransitionAllowed(previousStatus, fact.status)
    || (previousStatus === 'candidate' && fact.status === 'confirmed'
      && (actor !== fact.confirmedBy || at !== fact.confirmedAt)))
    throw new AppError('INVALID_FACT_LIFECYCLE', 409);
  const metadata = { transitionId: randomUUID(), previousStatus, status: fact.status, actor, at, reason };
  return { contractVersion: FACT_LIFECYCLE_BINDING_VERSION, factId: fact.id, ...metadata,
    snapshotSha256: lifecycleBindingDigest(fact, metadata) };
}
export function factLifecycleBindingIsValid(fact: Fact): boolean {
  const parsed = lifecycleBindingSchema.safeParse(fact.lifecycleBinding);
  if (!parsed.success) return false;
  const binding = parsed.data;
  try {
    const lifecycleMetadata = {
      transitionId: binding.transitionId,
      previousStatus: binding.previousStatus ?? null,
      status: binding.status,
      actor: binding.actor,
      at: binding.at,
      reason: binding.reason,
    };
    return binding.factId === fact.id && binding.status === fact.status
      && lifecycleTransitionAllowed(binding.previousStatus, binding.status)
      && (binding.previousStatus !== 'candidate' || binding.status !== 'confirmed'
        || (binding.actor === fact.confirmedBy && binding.at === fact.confirmedAt))
      && binding.snapshotSha256 === lifecycleBindingDigest(fact, lifecycleMetadata);
  } catch { return false; }
}
export function factLifecycleAuditIsValid(project: Pick<Project, 'audit' | 'revision'>, fact: Fact): boolean {
  if (!Number.isInteger(project.revision) || project.revision < 1 || !Array.isArray(project.audit)) return false;
  if (!project.audit.every(entry => entry && typeof entry === 'object' && typeof entry.id === 'string'
    && Number.isInteger(entry.projectVersion) && entry.projectVersion >= 1
    && Number.isInteger(entry.revision) && entry.revision >= 1 && entry.revision <= project.revision
    && typeof entry.type === 'string' && entry.type.length > 0
    && typeof entry.actor === 'string' && entry.actor.length > 0
    && typeof entry.at === 'string' && entry.at.length > 0
    && entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data))) return false;
  if (new Set(project.audit.map(entry => entry.id)).size !== project.audit.length) return false;

  // Every persisted revision writes at least one audit entry. The current revision may be temporarily absent while a
  // Store command is still executing, before its operation audit is appended.
  const revisions = [...new Set(project.audit.map(entry => entry.revision))].sort((a, b) => a - b);
  const completeThrough = revisions.at(-1) === project.revision ? project.revision : project.revision - 1;
  if (revisions.length !== completeThrough || revisions.some((revision, index) => revision !== index + 1)) return false;

  const terminal = (innerTypes: readonly string[], outerType: string) => {
    const inner = project.audit.filter(entry => innerTypes.includes(entry.type) && entry.data.factId === fact.id);
    const outer = project.audit.filter(entry => entry.type === outerType);
    if (inner.length > 1 || outer.length > 1) return { valid: false, occurred: false };
    if (!inner.length && !outer.length) return { valid: true, occurred: false };
    if (inner.length === 1 && outer.length === 1) return {
      valid: inner[0]!.revision === outer[0]!.revision && inner[0]!.actor === outer[0]!.actor,
      occurred: true,
    };
    const pendingInner = inner[0];
    return { valid: !!pendingInner && !outer.length && pendingInner === project.audit.at(-1)
      && pendingInner.revision === project.revision, occurred: true };
  };
  const legacyConfirmation = terminal(['fact.confirm'], `fact.${fact.id}.confirm`);
  const structuredConfirmation = terminal(['fact.structured_confirmed', 'fact.structured_replaced'],
    `fact.${fact.id}.structured.confirm`);
  const rejection = terminal(['fact.reject'], `fact.${fact.id}.reject`);
  const retraction = terminal(['fact.retract'], `fact.${fact.id}.retract`);
  if (![legacyConfirmation, structuredConfirmation, rejection, retraction].every(item => item.valid)
    || (legacyConfirmation.occurred && structuredConfirmation.occurred)) return false;
  const wasConfirmed = legacyConfirmation.occurred || structuredConfirmation.occurred;
  if (fact.status === 'candidate') return !wasConfirmed && !rejection.occurred && !retraction.occurred;
  if (fact.status === 'confirmed') return wasConfirmed && !rejection.occurred && !retraction.occurred;
  if (fact.status === 'rejected') return !wasConfirmed && rejection.occurred && !retraction.occurred;
  return wasConfirmed && !rejection.occurred && retraction.occurred;
}
export function createStructuredFactCandidateBinding(fact: Fact): StructuredFactCandidateBinding {
  if (!fact.structured || !fact.createdBy || fact.status !== 'candidate' || fact.locked
    || fact.confirmedBy !== undefined || fact.confirmedAt !== undefined
    || fact.structured.riskReview !== undefined || fact.structured.confirmation !== undefined
    || fact.structured.sources.some(source => source.review !== undefined || source.reconfirmations !== undefined))
    throw new AppError('INVALID_FACT_CANDIDATE', 409);
  const originalSources = fact.structured.sources.map(source => ({ sourceId: source.id, evidenceId: source.evidenceId }));
  return { contractVersion: FACT_CANDIDATE_BINDING_VERSION, factId: fact.id, createdBy: fact.createdBy, originalSources,
    snapshotSha256: sha256(candidateBindingSnapshot(fact, originalSources)) };
}
function evidenceReconfirmationChainIsValid(currentEvidenceId: string, originalEvidenceId: string,
  history: unknown, evidences: readonly Evidence[], evidenceMatches?: (evidence: Evidence) => boolean): boolean {
  if (!Array.isArray(history)) return false;
  let cursor = originalEvidenceId; const seen = new Set([cursor]);
  let previousEvidence = evidences.find(evidence => evidence.id === cursor);
  if (!previousEvidence || (evidenceMatches && !evidenceMatches(previousEvidence))) return false;
  for (const item of history) {
    const parsed = storedSourceReconfirmationSchema.safeParse(item);
    if (!parsed.success || parsed.data.previousEvidenceId !== cursor || seen.has(parsed.data.evidenceId)) return false;
    const nextEvidence = evidences.find(evidence => evidence.id === parsed.data.evidenceId);
    const previousSource = previousEvidence.materialSource; const nextSource = nextEvidence?.materialSource;
    if (!nextEvidence || !previousSource || !nextSource
      || previousSource.materialId !== nextSource.materialId || previousSource.blockId !== nextSource.blockId
      || previousSource.sourceSha256 !== nextSource.sourceSha256
      || parsed.data.decisionId !== nextSource.usageDecisionId || parsed.data.usageVersion !== nextSource.usageVersion
      || (evidenceMatches && !evidenceMatches(nextEvidence)))
      return false;
    cursor = parsed.data.evidenceId; seen.add(cursor);
    previousEvidence = nextEvidence;
  }
  return cursor === currentEvidenceId;
}
function structuredSourceEvidenceChainIsValid(source: StructuredFactSource, originalEvidenceId: string,
  evidences: readonly Evidence[]): boolean {
  return evidenceReconfirmationChainIsValid(source.evidenceId, originalEvidenceId,
    source.reconfirmations ?? [], evidences, evidence => {
      try { return structuredSourceMatchesEvidence({ ...source, evidenceId: evidence.id }, evidence); }
      catch { return false; }
    });
}
export function structuredFactCandidateBindingIsValid(fact: Fact, evidences: readonly Evidence[]): boolean {
  if (!fact.structured) return false;
  const parsed = structuredCandidateBindingSchema.safeParse(fact.structured.candidateBinding);
  if (!parsed.success) return false;
  const binding = parsed.data;
  if (binding.factId !== fact.id || binding.createdBy !== fact.createdBy
    || binding.originalSources.length !== fact.structured.sources.length
    || binding.snapshotSha256 !== sha256(candidateBindingSnapshot(fact, binding.originalSources))) return false;
  return fact.structured.sources.every((source, index) => {
    const original = binding.originalSources[index];
    return !!original && original.sourceId === source.id
      && structuredSourceEvidenceChainIsValid(source, original.evidenceId, evidences);
  });
}
export function createStructuredFactConfirmation(fact: Fact): StructuredFactConfirmation {
  if (!fact.structured || !fact.confirmedBy || !fact.confirmedAt) throw new AppError('INVALID_FACT_CONFIRMATION', 409);
  return { contractVersion: FACT_CONFIRMATION_VERSION, factId: fact.id, confirmedBy: fact.confirmedBy,
    confirmedAt: fact.confirmedAt, snapshotSha256: sha256(confirmedSemanticSnapshot(fact)) };
}
export function structuredFactConfirmationIsValid(fact: Fact, evidences: readonly Evidence[]): boolean {
  if (!fact.structured || !structuredFactCandidateBindingIsValid(fact, evidences)) return false;
  const parsed = structuredConfirmationSchema.safeParse(fact.structured.confirmation);
  if (!parsed.success) return false;
  const binding = parsed.data;
  return binding.factId === fact.id && binding.confirmedBy === fact.confirmedBy && binding.confirmedAt === fact.confirmedAt
    && binding.snapshotSha256 === sha256(confirmedSemanticSnapshot(fact));
}
const legacyCandidateSnapshotSchema = z.object({
  id: z.string().uuid(), attribute: storageText(1, 100), role: z.enum(['core', 'supporting']),
  value: storageText(1, 1000), evidenceId: z.string().uuid(), quote: storageText(1, 2000),
  start: z.number().int().nonnegative(), end: z.number().int().positive(), sourceRunId: storageText(1, 1000),
  createdBy: confirmationActor.nullable(), reason: reasonText.nullable(), correctsFactId: z.string().uuid().nullable(),
  initialStatus: z.literal('candidate'), initialLocked: z.literal(false),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.end !== snapshot.start + snapshot.quote.length)
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'Legacy candidate range must match the quote' });
  if ((snapshot.createdBy === null) !== (snapshot.reason === null))
    ctx.addIssue({ code: 'custom', path: ['createdBy'], message: 'Legacy candidate attribution must be complete' });
});
function legacyCandidateSnapshot(fact: Fact, original: {
  evidenceId: string; quote: string; start: number; end: number;
}) {
  return { id: fact.id, attribute: fact.attribute, role: fact.role, value: fact.value, evidenceId: original.evidenceId,
    quote: original.quote, start: original.start, end: original.end, sourceRunId: fact.sourceRunId,
    createdBy: fact.createdBy ?? null, reason: fact.reason ?? null, correctsFactId: fact.correctsFactId ?? null,
    initialStatus: 'candidate' as const, initialLocked: false as const };
}
export function createLegacyFactCandidateBinding(fact: Fact): LegacyFactCandidateBinding {
  const original = { evidenceId: fact.evidenceId, quote: fact.quote, start: fact.start, end: fact.end };
  const snapshot = legacyCandidateSnapshot(fact, original);
  if (fact.structured || fact.status !== 'candidate' || fact.locked || !legacyCandidateSnapshotSchema.safeParse(snapshot).success)
    throw new AppError('INVALID_LEGACY_FACT_CANDIDATE', 409);
  return { contractVersion: LEGACY_FACT_CANDIDATE_BINDING_VERSION, factId: fact.id,
    createdBy: fact.createdBy ?? null, originalEvidenceId: original.evidenceId, originalQuote: original.quote,
    originalStart: original.start, originalEnd: original.end, snapshotSha256: sha256(snapshot) };
}
export function legacyFactCandidateBindingIsValid(fact: Fact, evidences: readonly Evidence[]): boolean {
  const parsed = legacyCandidateBindingSchema.safeParse(fact.legacyCandidateBinding);
  if (!parsed.success) return false;
  const binding = parsed.data;
  const original = { evidenceId: binding.originalEvidenceId, quote: binding.originalQuote,
    start: binding.originalStart, end: binding.originalEnd };
  const snapshot = legacyCandidateSnapshot(fact, original);
  const wasReconfirmed = fact.evidenceId !== binding.originalEvidenceId;
  return binding.factId === fact.id && binding.createdBy === (fact.createdBy ?? null)
    && fact.quote === binding.originalQuote
    && (wasReconfirmed || (fact.start === binding.originalStart && fact.end === binding.originalEnd))
    && legacyCandidateSnapshotSchema.safeParse(snapshot).success
    && binding.snapshotSha256 === sha256(snapshot)
    && evidenceReconfirmationChainIsValid(fact.evidenceId, binding.originalEvidenceId,
      fact.sourceReconfirmations ?? [], evidences);
}
function legacySnapshot(fact: Fact, original: { quote: string; start: number; end: number }) {
  return { id: fact.id, attribute: fact.attribute, role: fact.role, value: fact.value,
    quote: original.quote, start: original.start, end: original.end, sourceRunId: fact.sourceRunId,
    correctsFactId: fact.correctsFactId ?? null };
}
export function createLegacyFactBinding(fact: Fact, evidence: Evidence): LegacyFactBinding {
  const candidateBinding = legacyCandidateBindingSchema.safeParse(fact.legacyCandidateBinding);
  if (!confirmationActor.safeParse(fact.confirmedBy).success || !confirmationTimestamp.safeParse(fact.confirmedAt).success)
    throw new AppError('INVALID_FACT_CONFIRMATION', 409);
  if (!candidateBinding.success || evidence.id !== candidateBinding.data.originalEvidenceId
    || !legacyFactCandidateBindingIsValid(fact, [evidence])) throw new AppError('INVALID_LEGACY_FACT_CANDIDATE', 409);
  const original = { quote: candidateBinding.data.originalQuote, start: candidateBinding.data.originalStart,
    end: candidateBinding.data.originalEnd };
  const evidenceSha256 = createHash('sha256').update(evidence.text, 'utf8').digest('hex');
  return { contractVersion: LEGACY_FACT_BINDING_VERSION, factId: fact.id, confirmedBy: fact.confirmedBy!,
    confirmedAt: fact.confirmedAt!, evidenceSha256, snapshotSha256: sha256(legacySnapshot(fact, original)) };
}
export function legacyFactBindingIsValid(fact: Fact, evidence: Evidence): boolean {
  const binding = fact.legacyBinding;
  const candidateBinding = legacyCandidateBindingSchema.safeParse(fact.legacyCandidateBinding);
  if (!candidateBinding.success || evidence.id !== candidateBinding.data.originalEvidenceId) return false;
  const original = { quote: candidateBinding.data.originalQuote, start: candidateBinding.data.originalStart,
    end: candidateBinding.data.originalEnd };
  const evidenceSha256 = createHash('sha256').update(evidence.text, 'utf8').digest('hex');
  return confirmationActor.safeParse(fact.confirmedBy).success && confirmationTimestamp.safeParse(fact.confirmedAt).success
    && !!binding && confirmationActor.safeParse(binding.confirmedBy).success
    && confirmationTimestamp.safeParse(binding.confirmedAt).success
    && binding.contractVersion === LEGACY_FACT_BINDING_VERSION && binding.factId === fact.id
    && binding.confirmedBy === fact.confirmedBy && binding.confirmedAt === fact.confirmedAt
    && binding.evidenceSha256 === evidenceSha256 && binding.snapshotSha256 === sha256(legacySnapshot(fact, original));
}
