import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { writeSchema, type Evidence, type Fact } from './contracts.js';
import { AppError } from './errors.js';
import { isStorageText } from './production-materials.js';

export const FACT_SOURCES_CONTRACT_VERSION = 'fact-sources.2' as const;
export const FACT_NORMALIZATION_VERSION = 'fact-normalization.1' as const;
export const FACT_RISK_REVIEW_VERSION = 'fact-risk-review.1' as const;
export const FACT_CANDIDATE_BINDING_VERSION = 'fact-candidate-binding.1' as const;
export const FACT_CONFIRMATION_VERSION = 'fact-confirmation.1' as const;
export const LEGACY_FACT_BINDING_VERSION = 'legacy-fact-binding.1' as const;
export const FACT_LIFECYCLE_BINDING_VERSION = 'fact-lifecycle-binding.1' as const;

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
  correctsFactId: z.string().uuid().optional(),
  createdBy: storageText(1, 1000),
  reason: reasonText,
}).passthrough().superRefine((fact, ctx) => {
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
export type CanonicalFactValue =
  | { kind: 'text'; value: string }
  | { kind: 'decimal'; dimension: string; numerator: string; denominator: string };
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
const numericRatioSeparator = '[/⁄∕]';
const numericJoinOperator = '[/⁄∕·⋅*×]';
const numericRangeOrQualifier = '[+\\-−–—~〜±<>≤≥≦≧≈≃^×*]';
const currencyOrDegree = '[$€£¥₽₹₩°℃℉]';
export function decimalValueSpanIssue(text: string, start: number, end: number,
  rawUnit: FactUnit | null): DecimalValueSpanIssue | undefined {
  // Normalize only bounded context. Persisted spans remain exact UTF-16 offsets into the original Evidence.
  const before = text.slice(Math.max(0, start - 64), start).normalize('NFKC');
  const after = text.slice(end, Math.min(text.length, end + 64)).normalize('NFKC');
  const splitBefore = new RegExp(`(?:[%‰‱.\\p{N}]|\\p{Script=Latin}|${numericRangeOrQualifier}|${currencyOrDegree})$`, 'u').test(before)
    || new RegExp(`\\p{N}(?:${numericGroupingSeparator}|${numericGroupingSpace})$`, 'u').test(before)
    || new RegExp(`\\p{N}[eE]${numericSign}?$`, 'u').test(before)
    || new RegExp(`\\p{N}\\s*${numericRatioSeparator}\\s*$`, 'u').test(before)
    || new RegExp(`(?:\\p{N}|\\p{L})\\s*(?:${numericJoinOperator}|${numericRangeOrQualifier})\\s*$`, 'u').test(before)
    || new RegExp(`(?:${unitAliasPattern})\\s*$`, 'u').test(before)
    || /(?:约|近|大约|约为|至少|至多|最多|最少|不超过|不低于|不大于|不小于|大于|小于)\s*$/u.test(before)
    || new RegExp(`(?:${numericRangeOrQualifier}|${currencyOrDegree})\\s*$`, 'u').test(before);
  const splitAfter = /^\p{N}/u.test(after) || /^\.\p{N}/u.test(after)
    || new RegExp(`^(?:${numericGroupingSeparator}${numericGroupingSpace}*|${numericGroupingSpace}+)\\p{N}`, 'u').test(after)
    || new RegExp(`^[eE]${numericSign}?\\p{N}`, 'u').test(after)
    || new RegExp(`^\\s*${numericRatioSeparator}\\s*\\p{N}`, 'u').test(after)
    || new RegExp(`^\\s*${numericRangeOrQualifier}`, 'u').test(after)
    || (rawUnit !== null && new RegExp(`^\\s*${numericJoinOperator}\\s*(?:${unitAliasPattern}|\\p{L}|\\p{N})`, 'u').test(after));
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
const lifecycleStatusSchema = z.enum(['candidate', 'confirmed', 'rejected', 'retracted']);
function lifecycleSnapshot(fact: Fact) {
  return {
    factId: fact.id,
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
  previousStatus: Fact['status'] | null, at = new Date().toISOString()): FactLifecycleBinding {
  if (!confirmationActor.safeParse(actor).success || !reasonText.safeParse(reason).success
    || !confirmationTimestamp.safeParse(at).success || !lifecycleTransitionAllowed(previousStatus, fact.status)
    || (previousStatus === 'candidate' && fact.status === 'confirmed'
      && (actor !== fact.confirmedBy || at !== fact.confirmedAt)))
    throw new AppError('INVALID_FACT_LIFECYCLE', 409);
  const metadata = { transitionId: randomUUID(), previousStatus, status: fact.status, actor, at, reason };
  return { contractVersion: FACT_LIFECYCLE_BINDING_VERSION, factId: fact.id, ...metadata,
    snapshotSha256: lifecycleBindingDigest(fact, metadata) };
}
export function factLifecycleBindingIsValid(fact: Fact): boolean {
  const binding = fact.lifecycleBinding;
  return !!binding && binding.contractVersion === FACT_LIFECYCLE_BINDING_VERSION && binding.factId === fact.id
    && z.string().uuid().safeParse(binding.transitionId).success && lifecycleStatusSchema.nullable().safeParse(binding.previousStatus).success
    && lifecycleStatusSchema.safeParse(binding.status).success && binding.status === fact.status
    && confirmationActor.safeParse(binding.actor).success && confirmationTimestamp.safeParse(binding.at).success
    && reasonText.safeParse(binding.reason).success && lifecycleTransitionAllowed(binding.previousStatus, binding.status)
    && (binding.previousStatus !== 'candidate' || binding.status !== 'confirmed'
      || (binding.actor === fact.confirmedBy && binding.at === fact.confirmedAt))
    && binding.snapshotSha256 === lifecycleBindingDigest(fact, binding);
}
export function createStructuredFactCandidateBinding(fact: Fact): StructuredFactCandidateBinding {
  if (!fact.structured || !fact.createdBy) throw new AppError('INVALID_FACT_CANDIDATE', 409);
  return { contractVersion: FACT_CANDIDATE_BINDING_VERSION, factId: fact.id, createdBy: fact.createdBy,
    snapshotSha256: sha256(candidateSemanticSnapshot(fact)) };
}
export function structuredFactCandidateBindingIsValid(fact: Fact): boolean {
  const binding = fact.structured?.candidateBinding;
  return !!binding && binding.contractVersion === FACT_CANDIDATE_BINDING_VERSION && binding.factId === fact.id
    && binding.createdBy === fact.createdBy && binding.snapshotSha256 === sha256(candidateSemanticSnapshot(fact));
}
export function createStructuredFactConfirmation(fact: Fact): StructuredFactConfirmation {
  if (!fact.structured || !fact.confirmedBy || !fact.confirmedAt) throw new AppError('INVALID_FACT_CONFIRMATION', 409);
  return { contractVersion: FACT_CONFIRMATION_VERSION, factId: fact.id, confirmedBy: fact.confirmedBy,
    confirmedAt: fact.confirmedAt, snapshotSha256: sha256(confirmedSemanticSnapshot(fact)) };
}
export function structuredFactConfirmationIsValid(fact: Fact): boolean {
  const binding = fact.structured?.confirmation;
  return !!binding && binding.contractVersion === FACT_CONFIRMATION_VERSION && binding.factId === fact.id
    && binding.confirmedBy === fact.confirmedBy && binding.confirmedAt === fact.confirmedAt
    && binding.snapshotSha256 === sha256(confirmedSemanticSnapshot(fact));
}
function legacySnapshot(fact: Fact) {
  return { id: fact.id, attribute: fact.attribute, role: fact.role, value: fact.value,
    quote: fact.quote, start: fact.start, end: fact.end, sourceRunId: fact.sourceRunId,
    correctsFactId: fact.correctsFactId ?? null };
}
export function createLegacyFactBinding(fact: Fact, evidence: Evidence): LegacyFactBinding {
  if (!confirmationActor.safeParse(fact.confirmedBy).success || !confirmationTimestamp.safeParse(fact.confirmedAt).success)
    throw new AppError('INVALID_FACT_CONFIRMATION', 409);
  const evidenceSha256 = createHash('sha256').update(evidence.text, 'utf8').digest('hex');
  return { contractVersion: LEGACY_FACT_BINDING_VERSION, factId: fact.id, confirmedBy: fact.confirmedBy!,
    confirmedAt: fact.confirmedAt!, evidenceSha256, snapshotSha256: sha256(legacySnapshot(fact)) };
}
export function legacyFactBindingIsValid(fact: Fact, evidence: Evidence): boolean {
  const binding = fact.legacyBinding;
  const evidenceSha256 = createHash('sha256').update(evidence.text, 'utf8').digest('hex');
  return confirmationActor.safeParse(fact.confirmedBy).success && confirmationTimestamp.safeParse(fact.confirmedAt).success
    && !!binding && confirmationActor.safeParse(binding.confirmedBy).success
    && confirmationTimestamp.safeParse(binding.confirmedAt).success
    && binding.contractVersion === LEGACY_FACT_BINDING_VERSION && binding.factId === fact.id
    && binding.confirmedBy === fact.confirmedBy && binding.confirmedAt === fact.confirmedAt
    && binding.evidenceSha256 === evidenceSha256 && binding.snapshotSha256 === sha256(legacySnapshot(fact));
}
