import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpenRouter } from '../src/openrouter.js';
import { createProject } from '../src/domain.js';
import { AppError } from '../src/errors.js';
import type { ModelObservation } from '../src/contracts.js';
import { preflight, runnerConfigSchema } from '../src/model-policy.js';

const capabilities = JSON.parse(readFileSync(new URL('../evaluation/fixtures/synthetic-endpoints.json', import.meta.url), 'utf8'));
const config = { apiKey: 'test-only-key', model: 'synthetic/protocol-only', provider: 'synthetic', timeoutMs: 1000,
  maxInputTokens: 16000, maxOutputTokens: 4000, maxCostUsd: 0.1, acceptEstimatedBudget: true };
const good = () => ({ id: 'response-123', model: config.model, provider: 'Synthetic', usage: { prompt_tokens: 1000, completion_tokens: 100, cost: 0.0012 },
  choices: [{ finish_reason: 'stop', message: { content: '{"facts":[]}' } }] });
const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code && !e.message.includes('test-only-key');
function gateway(response: () => Response | Promise<Response>, override = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const model = new OpenRouter({ ...config, ...override }, async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith('/endpoints') ? Response.json(capabilities) : response();
  });
  return { model, calls };
}

test('formal gateway preflights exact endpoint then sends strict schema with no fallback/retry', async () => {
  const m = gateway(() => Response.json(good())); let observed: ModelObservation | undefined;
  assert.deepEqual(await m.model.generate('extract-facts', createProject('test'), o => { observed = o; }), { facts: [] });
  assert.equal(m.calls.length, 2);
  const body = JSON.parse(String(m.calls[1]!.init!.body));
  assert.deepEqual(body.provider, { only: ['synthetic'], order: ['synthetic'], allow_fallbacks: false, require_parameters: true });
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
  assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[1].role, 'user');
  assert.ok(m.calls.every(c => c.init!.redirect === 'error'));
  assert.equal(observed!.actualModel, config.model); assert.equal(observed!.actualProvider, 'Synthetic');
  assert.equal(observed!.costUsd, 0.0012); assert.equal(observed!.inputTokens, 1000);
  assert.equal(observed!.requestIdSha256!.length, 64); assert.equal(observed!.finishReason, 'stop');
});

test('formal gateway sanitizes provider failure and records unknown charged amount without retry', async () => {
  for (const [response, code] of [
    [() => new Response('sensitive test-only-key provider body', { status: 429 }), 'MODEL_RATE_LIMITED'],
    [() => Response.json({ ...good(), choices: [{ message: { content: 'not-json' } }] }), 'INVALID_MODEL_OUTPUT'],
    [() => Response.json({ ...good(), choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), 'MODEL_OUTPUT_TRUNCATED'],
    [() => Response.json({ ...good(), usage: undefined }), 'USAGE_UNKNOWN'],
    [() => Response.json({ ...good(), provider: 'wrong-route' }), 'RESPONSE_ROUTE_MISMATCH'],
    [() => Response.json({ ...good(), usage: { prompt_tokens: 1, completion_tokens: 1, cost: 1 } }), 'OBSERVED_COST_EXCEEDED'],
  ] as const) {
    const m = gateway(response); let observed: ModelObservation | undefined;
    await assert.rejects(m.model.generate('extract-facts', createProject('test'), o => { observed = o; }), isCode(code));
    assert.equal(m.calls.length, 2); assert.equal(observed!.errorCode, code);
    assert.equal(observed!.dispatched, true); assert.ok(!JSON.stringify(observed).includes('test-only-key'));
    if (code === 'MODEL_RATE_LIMITED' || code === 'USAGE_UNKNOWN') assert.equal(observed!.costUsd, null);
  }
});

test('zero observed cost stays known zero and malformed output retains observed usage', async () => {
  const m = gateway(() => Response.json({ ...good(), usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
    choices: [{ finish_reason: 'stop', message: { content: 'malformed' } }] }));
  let observed: ModelObservation | undefined;
  await assert.rejects(m.model.generate('extract-facts', createProject('test'), o => { observed = o; }), isCode('INVALID_MODEL_OUTPUT'));
  assert.equal(observed!.costUsd, 0);
});

test('one deadline includes metadata latency, generation and stalled body, always under lease', async () => {
  let calls = 0; const start = performance.now();
  const model = new OpenRouter({ ...config, timeoutMs: 100 }, async () => {
    calls++;
    if (calls === 1) { await new Promise(r => setTimeout(r, 65)); return Response.json(capabilities); }
    return new Response(new ReadableStream({ start() {} }));
  });
  await assert.rejects(model.generate('extract-facts', createProject('test')), isCode('MODEL_TIMEOUT'));
  assert.equal(calls, 2); assert.ok(performance.now() - start < 160);
  const m = gateway(() => Response.json(good()), { timeoutMs: 120000 });
  await assert.rejects(m.model.generate('extract-facts', createProject('test')), isCode('MODEL_POLICY_NOT_CONFIGURED'));
  assert.equal(m.calls.length, 0);
});

test('formal gateway bounds body and fails local configuration, input and budget before generation', async () => {
  const m = gateway(() => new Response('x'.repeat(2_000_001)));
  await assert.rejects(m.model.generate('extract-facts', createProject('test')), isCode('RESPONSE_TOO_LARGE'));
  for (const [override, code, count] of [
    [{ provider: undefined }, 'MODEL_POLICY_NOT_CONFIGURED', 0],
    [{ maxInputTokens: 1 }, 'INPUT_ESTIMATE_EXCEEDS_LIMIT', 0],
    [{ maxCostUsd: 0.000001 }, 'ESTIMATED_COST_EXCEEDS_BUDGET', 1],
  ] as const) {
    const g = gateway(() => Response.json(good()), override);
    await assert.rejects(g.model.generate('extract-facts', createProject('test')), isCode(code));
    assert.equal(g.calls.length, count);
  }
});

test('network timeout has a stable sanitized error and separate skill model configuration is retained', async () => {
  const model = new OpenRouter(config, async () => { throw new DOMException('private details', 'TimeoutError'); });
  await assert.rejects(model.generate('extract-facts', createProject('test')), isCode('MODEL_TIMEOUT'));
  const selected = new OpenRouter({ model: 'default/model', factModel: 'facts/model', timeoutMs: 100 });
  assert.equal(selected.modelFor('extract-facts'), 'facts/model'); assert.equal(selected.modelFor('plan-section'), 'default/model');
});

test('real public Gemini EU snapshot supports plain text policy, preserving ambiguous-route and unknown-price gates', () => {
  const raw = JSON.parse(readFileSync(new URL('../evaluation/fixtures/public-gemini-endpoints-20260905.json', import.meta.url), 'utf8'));
  const policy = runnerConfigSchema.parse({ modelId: 'google/gemini-2.5-flash', provider: 'google-vertex/eu', maxRequests: 6,
    maxInputTokens: 64000, maxOutputTokens: 6000, maxCostUsd: 0.5, timeoutMs: 90000, acceptEstimatedBudget: true });
  const checked = preflight(raw, policy);
  assert.ok(Math.abs(checked.estimatedCostUsd - 0.0492) < 0.0000001);
  assert.equal(checked.endpoint.max_prompt_tokens, null);
  assert.throws(() => preflight(raw, { ...policy, provider: 'google-vertex' }), /PROVIDER_MISSING_OR_AMBIGUOUS/);
  const changed = structuredClone(raw); changed.data.endpoints[0].pricing.overrides = [{ prompt: '1' }];
  assert.throws(() => preflight(changed, policy), /INVALID_ENDPOINT_OR_PRICE/);
  const unknown = structuredClone(raw); delete unknown.data.endpoints[0].pricing.completion;
  assert.throws(() => preflight(unknown, policy), /INVALID_ENDPOINT_OR_PRICE/);
});
