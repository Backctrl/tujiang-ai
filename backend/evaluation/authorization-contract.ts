import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RunnerError, runnerConfigSchema, type RunnerConfig } from '../src/model-policy.js';

export const AUTHORIZATION_ID = 'm0-model-trial-2026-09-07';
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const purposeSchema = z.enum(['fact_extraction', 'formal_story', 'copy', 'layout', 'english_adaptation', 'representative_image']);
export type Purpose = z.infer<typeof purposeSchema>;
export type Modality = 'text' | 'image';
export const PURPOSE_LIMITS: Readonly<Record<Purpose, number>> = Object.freeze({
  fact_extraction: 3, formal_story: 3, copy: 2, layout: 2, english_adaptation: 2, representative_image: 2,
});
export const AUTHORIZATION_POLICY = Object.freeze({
  contractVersion: 'model-authorization.1', authorizationId: AUTHORIZATION_ID,
  authorizationSource: 'docs/mvp/model-evaluation-proposal.md@2026-09-07',
  text: Object.freeze({ modelId: 'google/gemini-2.5-flash', provider: 'google-vertex/eu', maxRequests: 12,
    maxInputTokens: 64_000, maxOutputTokens: 6_000, timeoutMs: 90_000, maxEstimatedMicros: 750_000 }),
  image: Object.freeze({ modelId: 'google/gemini-2.5-flash-image', provider: 'google-vertex/global', maxRequests: 2,
    maxInputTokens: 16_000, maxOutputTokens: 2_048, timeoutMs: 90_000, maxEstimatedMicros: 250_000, imagesPerRequest: 1 }),
  purposeLimits: PURPOSE_LIMITS, maxInFlight: 1, automaticRetry: false, fallback: false,
  budgetEnforcement: 'local-estimate-not-billing-cap', refundDispatchedEstimates: false,
});

export function fail(code: string): never { throw new RunnerError(code); }
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return fail('INVALID_CANONICAL_INPUT');
}
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const objectSha256 = (value: unknown) => sha256(canonical(value));
export const POLICY_SHA256 = objectSha256(AUTHORIZATION_POLICY);
export const modalityFor = (purpose: Purpose): Modality => purpose === 'representative_image' ? 'image' : 'text';

// Decimal arithmetic on the number's wire representation; round up rather than accumulating floats.
export function usdToMicros(value: number): number {
  if (!Number.isFinite(value) || value < 0) return fail('INVALID_COST');
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) return fail('INVALID_COST');
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? 0) - fraction.length + 6;
  if (Math.abs(exponent) > 400) return fail('INVALID_COST');
  let units = BigInt(match[1]! + fraction);
  if (exponent >= 0) units *= 10n ** BigInt(exponent);
  else { const denominator = 10n ** BigInt(-exponent); units = (units + denominator - 1n) / denominator; }
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) return fail('INVALID_COST');
  return Number(units);
}
export const microsToUsd = (value: number) => value / 1_000_000;

export function validateAuthorizedConfig(configInput: unknown, purpose: Purpose): RunnerConfig {
  const config = runnerConfigSchema.parse(configInput);
  const limit = AUTHORIZATION_POLICY[modalityFor(purpose)];
  if (config.modelId !== limit.modelId || config.provider !== limit.provider) fail('AUTHORIZATION_ROUTE_MISMATCH');
  if (config.maxRequests > PURPOSE_LIMITS[purpose] || config.maxInputTokens > limit.maxInputTokens ||
      config.maxOutputTokens > limit.maxOutputTokens || config.timeoutMs > limit.timeoutMs ||
      usdToMicros(config.maxCostUsd) > limit.maxEstimatedMicros) fail('AUTHORIZATION_LIMIT_EXCEEDED');
  if (!config.acceptEstimatedBudget) fail('LIVE_NOT_ENABLED');
  return config;
}

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
export const sourceSnapshotSchema = z.object({ id: identifier, name: z.string().min(1).max(300),
  bytesBase64: z.string().max(3_000_000) }).strict();
export const batchItemSchema = z.object({ id: identifier, input: z.unknown(), expected: z.unknown(),
  requestBody: z.string().min(1).max(1_000_000) }).strict();
export const batchPayloadSchema = z.object({
  purpose: purposeSchema, adapter: z.object({ id: identifier, version: identifier }).strict(), config: runnerConfigSchema,
  sources: z.array(sourceSnapshotSchema).min(1).max(30), items: z.array(batchItemSchema).min(1).max(14),
  upstreamReviewIds: z.array(z.string().uuid()).max(30).default([]),
  // Binds the reviewed, relevant capability/price fields, not volatile endpoint statistics.
  reviewedCapabilitySha256: digestSchema, reviewedEstimatedMicros: z.number().int().nonnegative().max(750_000),
  reviewedProviderName: z.string().min(1).max(200),
}).strict();
export type BatchPayload = z.infer<typeof batchPayloadSchema>;
export interface BatchManifest {
  contractVersion: 'evaluation-batch.1'; authorizationId: string; batchId: string; purpose: Purpose; modality: Modality;
  adapter: BatchPayload['adapter']; configSha256: string; payloadSha256: string; reviewedCapabilitySha256: string;
  reviewedEstimatedMicros: number; reviewedProviderName: string;
  sources: { id: string; sha256: string; byteLength: number }[];
  items: { id: string; inputSha256: string; expectedSha256: string; requestSha256: string }[];
  upstreamReviewIds: string[];
}
export function describeBatch(batchId: string, input: unknown): { payload: BatchPayload; manifest: BatchManifest; manifestSha256: string } {
  z.string().uuid().parse(batchId);
  const payload = batchPayloadSchema.parse(input);
  validateAuthorizedConfig(payload.config, payload.purpose);
  if (payload.items.length > payload.config.maxRequests || payload.items.length > PURPOSE_LIMITS[payload.purpose]) fail('REQUEST_BUDGET_EXCEEDED');
  if (payload.reviewedEstimatedMicros * payload.items.length > usdToMicros(payload.config.maxCostUsd)) fail('ESTIMATED_COST_EXCEEDS_BUDGET');
  if (new Set(payload.items.map(item => item.id)).size !== payload.items.length ||
      new Set(payload.sources.map(source => source.id)).size !== payload.sources.length) fail('DUPLICATE_BATCH_ITEM');
  const sources = payload.sources.map(source => {
    const bytes = Buffer.from(source.bytesBase64, 'base64');
    if (bytes.toString('base64') !== source.bytesBase64 || bytes.length > 2_000_000) fail('INVALID_SOURCE_SNAPSHOT');
    return { id: source.id, sha256: sha256(bytes), byteLength: bytes.length };
  });
  if (Buffer.byteLength(canonical(payload)) > 8_000_000) fail('BATCH_TOO_LARGE');
  const manifest: BatchManifest = { contractVersion: 'evaluation-batch.1', authorizationId: AUTHORIZATION_ID, batchId,
    purpose: payload.purpose, modality: modalityFor(payload.purpose), adapter: payload.adapter,
    configSha256: objectSha256(payload.config), payloadSha256: objectSha256(payload), reviewedCapabilitySha256: payload.reviewedCapabilitySha256,
    reviewedEstimatedMicros: payload.reviewedEstimatedMicros, reviewedProviderName: payload.reviewedProviderName,
    sources, items: payload.items.map(item => ({ id: item.id, inputSha256: objectSha256(item.input),
      expectedSha256: objectSha256(item.expected), requestSha256: sha256(item.requestBody) })),
    upstreamReviewIds: payload.upstreamReviewIds };
  return { payload, manifest, manifestSha256: objectSha256(manifest) };
}

export const observationSchema = z.object({ inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  costUsd: z.number().finite().nonnegative().nullable(), requestIdSha256: digestSchema.nullable(),
  finishReason: z.enum(['stop', 'length', 'content_filter', 'tool_calls', 'error', 'unknown']),
}).strict();
export type Observation = z.infer<typeof observationSchema>;
export const reasonSchema = z.string().trim().min(1).max(1000);
export const operatorSchema = z.string().trim().min(1).max(200);
export const commandIdSchema = z.string().min(8).max(128);
export const inputDecisionSchema = z.object({ decision: z.enum(['approved', 'rejected']), reason: reasonSchema,
  decisionReference: z.string().trim().min(8).max(1000), decisionReceiptSha256: digestSchema }).strict();
export type InputDecision = z.infer<typeof inputDecisionSchema>;
// A manual operator supplies a concrete provider receipt; the ledger derives amounts instead of accepting a separate total.
export const reconciliationProofSchema = z.object({ requestSha256: digestSchema, decisionReference: z.string().trim().min(8).max(1000),
  providerReceipt: z.object({ id: z.string().trim().min(1).max(300), model: z.string().min(1).max(200), provider: z.string().min(1).max(200),
    prompt_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    completion_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), cost: z.number().finite().nonnegative(),
  }).strict(), providerReceiptSha256: digestSchema }).strict();
