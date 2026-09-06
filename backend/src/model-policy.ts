import { createHash } from 'node:crypto';
import { z } from 'zod';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
const positiveInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const runnerConfigSchema = z.object({
  modelId: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/).max(200),
  provider: z.string().regex(/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/).max(200),
  maxRequests: positiveInt.max(100), maxOutputTokens: positiveInt.max(100_000),
  maxInputTokens: positiveInt.max(1_000_000), maxCostUsd: z.number().positive().finite(),
  timeoutMs: positiveInt.max(120_000), acceptEstimatedBudget: z.boolean().default(false),
}).strict().refine(c => c.modelId !== 'openrouter/auto', 'EXPLICIT_MODEL_REQUIRED');
export type RunnerConfig = z.infer<typeof runnerConfigSchema>;

export class RunnerError extends Error { constructor(readonly code: string) { super(code); } }
function fail(code: string): never { throw new RunnerError(code); }
const price = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
  .transform(Number).refine(n => Number.isFinite(n) && n >= 0);
const endpointSchema = z.object({
  tag: z.string(), provider_name: z.string(), model_id: z.string(), status: z.literal(0),
  context_length: positiveInt, max_prompt_tokens: positiveInt.nullable(), max_completion_tokens: positiveInt,
  supports_implicit_caching: z.boolean().optional(),
  supported_parameters: z.array(z.string()), pricing: z.object({
    prompt: price, completion: price, request: price.optional(), discount: z.number().min(0).max(1).optional(),
    input_cache_read: price.optional(), input_cache_write: price.optional(), internal_reasoning: price.optional(),
    overrides: z.array(z.unknown()).max(0).optional(),
  }).catchall(price),
});

// Consume documented /models/{author}/{slug}/endpoints envelopes, not model-list minimum prices.
export function preflight(raw: unknown, config: RunnerConfig) {
  const envelope = z.object({ data: z.object({ id: z.string(),
    architecture: z.object({ input_modalities: z.array(z.string()), output_modalities: z.array(z.string()) }),
    endpoints: z.array(z.unknown()),
  }) }).safeParse(raw);
  if (!envelope.success || envelope.data.data.id !== config.modelId) return fail('INVALID_CAPABILITIES');
  const data = envelope.data.data;
  if (!data.architecture.input_modalities.includes('text') || !data.architecture.output_modalities.includes('text')) return fail('TEXT_NOT_SUPPORTED');
  // A base slug also matches endpoint variants. Reject ambiguity instead of pricing just one variant.
  const candidates = data.endpoints.filter(e => {
    const tag = z.object({ tag: z.string() }).safeParse(e);
    return tag.success && (tag.data.tag === config.provider || tag.data.tag.startsWith(`${config.provider}/`));
  });
  if (candidates.length !== 1) return fail('PROVIDER_MISSING_OR_AMBIGUOUS');
  const parsed = endpointSchema.safeParse(candidates[0]);
  if (!parsed.success) return fail('INVALID_ENDPOINT_OR_PRICE');
  const endpoint = parsed.data;
  if (endpoint.tag !== config.provider || endpoint.model_id !== config.modelId) return fail('ENDPOINT_ID_MISMATCH');
  if (!['response_format', 'structured_outputs', 'max_tokens'].every(p => endpoint.supported_parameters.includes(p))) return fail('REQUIRED_PARAMETERS_UNSUPPORTED');
  if (config.maxInputTokens > (endpoint.max_prompt_tokens ?? endpoint.context_length) || config.maxOutputTokens > endpoint.max_completion_tokens ||
      config.maxInputTokens + config.maxOutputTokens > endpoint.context_length) return fail('TOKEN_LIMIT_UNSUPPORTED');
  const { prompt, completion, request } = endpoint.pricing;
  if (prompt === undefined || completion === undefined) return fail('PRICE_MISSING');
  // Optional unadvertised request tariff is not an unknown token price. Keep this assumption explicit.
  // These callers build plain text requests without tools, plugins, media or cache_control.
  const unused = ['image', 'image_output', 'audio', 'audio_output', 'input_audio_cache', 'web_search'];
  const known = ['prompt', 'completion', 'request', 'discount', 'internal_reasoning', 'input_cache_read', 'input_cache_write', 'overrides', ...unused];
  if (Object.entries(endpoint.pricing).some(([k, v]) => !known.includes(k) && v !== 0)) return fail('UNSUPPORTED_PRICE_CATEGORY');
  if ((endpoint.pricing.input_cache_write ?? 0) > 0 && endpoint.supports_implicit_caching !== false) return fail('IMPLICIT_CACHE_PRICE_UNSUPPORTED');
  // Do not assume reasoning is free or always counted inside completion: conservatively reserve both.
  const estimatedCostUsd = config.maxInputTokens * prompt + config.maxOutputTokens * (completion + (endpoint.pricing.internal_reasoning ?? 0)) + (request ?? 0);
  if (!Number.isFinite(estimatedCostUsd)) return fail('INVALID_COST_ESTIMATE');
  return { endpoint, estimatedCostUsd, capabilitiesSha256: hash(raw), pricingPolicy: 'plain-text-no-tools-no-explicit-cache; optional-unadvertised-request-tariff; ignore-discounts; reserve-reasoning' };
}

// One deadline includes connection, headers and bounded response-body reading. No redirect or retry.
export async function requestJson(request: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  if (timeoutMs <= 0) return fail('REQUEST_TIMEOUT');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new RunnerError('REQUEST_TIMEOUT')); }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await request(url, { ...init, redirect: 'error', signal: controller.signal });
      if (!response.ok) { controller.abort(); return fail(response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR'); }
      if (!response.body) return fail('INVALID_RESPONSE');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 2_000_000) { controller.abort(); void reader.cancel().catch(() => {}); return fail('RESPONSE_TOO_LARGE'); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
      catch { return fail('INVALID_RESPONSE_JSON'); }
    })()]);
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return fail('REQUEST_TIMEOUT');
    return fail('NETWORK_ERROR');
  } finally { clearTimeout(timer); controller.abort(); }
}
