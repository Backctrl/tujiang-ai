import { z } from 'zod';
import { digestSchema, fail, sha256, usdToMicros, type Observation } from './authorization-contract.js';

export interface CapturedMetadata {
  state: 'complete' | 'partial' | 'unavailable'; httpStatus: number | null; latencyMs: number;
  errorCode: string | null; bodySha256: string | null;
}
export const capturedMetadataSchema = z.object({ state: z.enum(['complete', 'partial', 'unavailable']),
  httpStatus: z.number().int().min(100).max(599).nullable(), latencyMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  errorCode: z.enum(['REQUEST_TIMEOUT', 'RESPONSE_TOO_LARGE', 'NETWORK_ERROR', 'HTTP_ERROR', 'RATE_LIMITED', 'INVALID_RESPONSE']).nullable(),
  bodySha256: digestSchema.nullable() }).strict();
export function validateCapturedMetadata(input: unknown, byteLength: number): CapturedMetadata {
  const value = capturedMetadataSchema.parse(input);
  if (value.state === 'unavailable' ? value.httpStatus !== null || value.bodySha256 !== null || byteLength !== 0
    : value.httpStatus === null || value.bodySha256 === null) fail('INVALID_CAPTURE');
  return value;
}
export function inspectCapturedResponse(bytes: Uint8Array, metadata: CapturedMetadata,
  expected: { modelId: string; providerName: string; maxInputTokens: number; maxOutputTokens: number }) {
  validateCapturedMetadata(metadata, bytes.byteLength);
  const observation: Observation = { inputTokens: null, outputTokens: null, costUsd: null,
    requestIdSha256: null, finishReason: 'unknown' };
  let protocolCode = metadata.errorCode;
  let parsedOutput: unknown;
  let costMicros: number | null = null;
  const output = () => ({ observation, protocolCode, parsedOutput, costMicros, usageUnknown: costMicros === null ||
    observation.inputTokens === null || observation.outputTokens === null });
  if (metadata.state !== 'complete' || metadata.httpStatus === null || metadata.httpStatus < 200 || metadata.httpStatus >= 300) {
    protocolCode ??= 'INVALID_RESPONSE'; return output();
  }
  let raw: unknown;
  try { raw = JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch { protocolCode ??= 'INVALID_RESPONSE_JSON'; return output(); }
  const envelope = z.object({ id: z.string().optional(), model: z.string(), provider: z.string(),
    usage: z.object({ prompt_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      completion_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      cost: z.number().finite().nonnegative().optional() }).optional(), error: z.unknown().optional(),
    choices: z.array(z.object({ finish_reason: z.string(),
      message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }) })).length(1),
  }).safeParse(raw);
  if (!envelope.success) { protocolCode ??= 'INVALID_RESPONSE'; return output(); }
  const data = envelope.data;
  observation.requestIdSha256 = data.id ? sha256(data.id) : null;
  if (data.model !== expected.modelId || data.provider !== expected.providerName) {
    protocolCode = 'RESPONSE_ROUTE_MISMATCH'; return output();
  }
  const choice = data.choices[0]!;
  const allowed = ['stop', 'length', 'content_filter', 'tool_calls', 'error'] as const;
  observation.finishReason = allowed.includes(choice.finish_reason as typeof allowed[number])
    ? choice.finish_reason as typeof allowed[number] : 'unknown';
  observation.inputTokens = data.usage?.prompt_tokens ?? null;
  observation.outputTokens = data.usage?.completion_tokens ?? null;
  observation.costUsd = data.usage?.cost ?? null;
  if (observation.costUsd !== null) {
    try { costMicros = usdToMicros(observation.costUsd); }
    catch { observation.costUsd = null; protocolCode ??= 'INVALID_COST'; }
  }
  if (data.error !== undefined) protocolCode ??= 'INVALID_RESPONSE';
  if (choice.finish_reason === 'length') protocolCode ??= 'OUTPUT_TRUNCATED';
  else if (choice.message.refusal || choice.finish_reason === 'content_filter') protocolCode ??= 'MODEL_REFUSAL';
  else if (choice.finish_reason !== 'stop') protocolCode ??= 'UNEXPECTED_FINISH_REASON';
  if (observation.costUsd === null || observation.inputTokens === null || observation.outputTokens === null) protocolCode ??= 'USAGE_UNKNOWN';
  if ((observation.inputTokens ?? 0) > expected.maxInputTokens || (observation.outputTokens ?? 0) > expected.maxOutputTokens) protocolCode ??= 'OBSERVED_TOKEN_LIMIT_EXCEEDED';
  try { parsedOutput = JSON.parse(choice.message.content ?? ''); }
  catch { protocolCode ??= 'INVALID_OUTPUT_JSON'; }
  return output();
}
