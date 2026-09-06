import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runEvaluation } from '../evaluation/runner.js';
import { runCli } from '../evaluation/runner-cli.js';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../evaluation/fixtures/${name}.json`, import.meta.url), 'utf8'));
const fixture = read('synthetic-extraction');
const output = read('synthetic-extraction-output');
const capabilities = read('synthetic-endpoints');
const config = { ...read('synthetic-run').config, acceptEstimatedBudget: true };
const human = { ...fixture, provenance: 'human-curated' };
const good = () => ({ id: 'gen-test', model: config.modelId, provider: 'Synthetic',
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
  usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.001 } });
const key = 'TEST_ONLY_SECRET';
function mock(response: unknown = good(), caps: unknown = capabilities) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1 ? caps : response);
  };
  return { calls, options: { live: true, request, environmentEnabled: () => true, getApiKey: () => key } };
}

test('dry-run makes zero requests and never accesses credentials or environment', async () => {
  let accesses = 0;
  const report = await runEvaluation(config, [fixture], { capabilities,
    request: async () => { accesses++; throw new Error(); }, getApiKey: () => { accesses++; throw new Error(); },
    environmentEnabled: () => { accesses++; throw new Error(); } });
  assert.equal(accesses, 0); assert.equal(report.status, 'dry_run');
  assert.equal(report.requestsAttempted, 0); assert.equal(report.businessAcceptance, false);
  assert.equal(report.items[0]?.estimatedCostUsd, 0.014);
  assert.equal(report.budgetEnforcement, 'local-estimate-not-billing-cap');
});

test('live is gated by config, environment, sample provenance and key', async () => {
  for (const [c, f, enabled, secret, expected] of [
    [{ ...config, acceptEstimatedBudget: false }, human, true, key, 'LIVE_NOT_ENABLED'],
    [config, human, false, key, 'LIVE_NOT_ENABLED'],
    [config, fixture, true, key, 'LIVE_REQUIRES_HUMAN_CURATED_FIXTURES'],
    [config, human, true, '', 'KEY_NOT_CONFIGURED'],
  ] as const) {
    const m = mock();
    const report = await runEvaluation(c, [f], { ...m.options, environmentEnabled: () => enabled, getApiKey: () => secret });
    assert.equal(report.code, expected); assert.equal(m.calls.length, 0);
  }
});

test('normal response uses shared prompt and strict routing then existing evaluator', async () => {
  const m = mock(); const report = await runEvaluation(config, [human], m.options);
  assert.equal(report.status, 'needs_human_review'); assert.equal(report.items[0]?.evaluation?.automaticChecksPassed, true);
  assert.equal(report.businessAcceptance, false); assert.equal(report.requestsAttempted, 1); assert.equal(report.metadataRequests, 1);
  assert.equal(report.observedCostUsd, 0.001);
  assert.match(m.calls[0]!.url, /\/models\/synthetic\/protocol-only\/endpoints$/);
  const body = JSON.parse(m.calls[1]!.init!.body as string);
  assert.deepEqual(body.provider, { only: ['synthetic'], order: ['synthetic'], allow_fallbacks: false, require_parameters: true });
  assert.equal(body.stream, false); assert.equal(body.max_tokens, 2000); assert.equal(body.response_format.type, 'json_schema');
  assert.ok(!body.messages[1].content.includes('expectedFacts'));
  assert.equal(m.calls[1]!.init!.redirect, 'error');
  assert.ok(!JSON.stringify(report).includes(key)); assert.ok(!JSON.stringify(report).includes(fixture.evidence[0].text));
});

test('capabilities, identity, capacity and prices fail closed before model dispatch', async () => {
  const mutations: ((c: any) => void)[] = [
    c => { c.data.id = 'other/model'; }, c => { c.data.endpoints = []; },
    c => { c.data.endpoints.push({ ...c.data.endpoints[0], tag: 'synthetic/variant' }); },
    c => { c.data.endpoints[0].supported_parameters = ['response_format', 'max_tokens']; },
    c => { delete c.data.endpoints[0].pricing.prompt; }, c => { delete c.data.endpoints[0].pricing.completion; },
    c => { c.data.endpoints[0].pricing.prompt = ''; }, c => { c.data.endpoints[0].pricing.prompt = '-1'; },
    c => { c.data.endpoints[0].pricing.prompt = '1e999'; }, c => { c.data.endpoints[0].pricing.unknown_fee = '1'; },
    c => { c.data.endpoints[0].max_completion_tokens = null; }, c => { c.data.endpoints[0].context_length = 100; },
    c => { c.data.endpoints[0].status = -1; }, c => { c.data.architecture.output_modalities = ['image']; },
  ];
  for (const mutate of mutations) {
    const caps = structuredClone(capabilities); mutate(caps);
    const m = mock(good(), caps); const report = await runEvaluation(config, [human], m.options);
    assert.equal(report.status, 'blocked'); assert.equal(m.calls.length, 1); assert.equal(report.requestsAttempted, 0);
  }
});

test('local request, input, fixture and cost gates precede dispatch', async () => {
  for (const [c, fixtures, expected] of [
    [config, [human, human], 'REQUEST_BUDGET_EXCEEDED'],
    [{ ...config, maxInputTokens: 1 }, [human], 'INPUT_ESTIMATE_EXCEEDS_LIMIT'],
    [{ ...config, maxCostUsd: 0.001 }, [human], 'ESTIMATED_COST_EXCEEDS_BUDGET'],
    [{ ...config, modelId: 'openrouter/auto' }, [human], 'INVALID_RUN_INPUT'],
    [config, [{ ...human, evidence: [human.evidence[0], human.evidence[0]] }], 'INVALID_RUN_INPUT'],
  ] as const) {
    const m = mock(); const report = await runEvaluation(c, [...fixtures], m.options);
    assert.equal(report.code, expected); assert.equal(report.requestsAttempted, 0);
  }
});

test('truncation, refusal, malformed JSON, route mismatch and rules are distinct', async () => {
  const mutations: [string, (r: any) => void][] = [
    ['OUTPUT_TRUNCATED', r => { r.choices[0].finish_reason = 'length'; }],
    ['MODEL_REFUSAL', r => { r.choices[0].message.refusal = 'no'; }],
    ['INVALID_OUTPUT_JSON', r => { r.choices[0].message.content = '{'; }],
    ['RESPONSE_ROUTE_MISMATCH', r => { r.provider = key; }],
    ['UNEXPECTED_FINISH_REASON', r => { r.choices[0].finish_reason = key; }],
    ['INVALID_RESPONSE', r => { r.error = { message: key }; }],
    ['EVALUATION_RULE_FAILED', r => { r.choices[0].message.content = '{"approved":true}'; }],
    ['USAGE_UNKNOWN', r => { delete r.usage.cost; }],
    ['OBSERVED_TOKEN_LIMIT_EXCEEDED', r => { r.usage.completion_tokens = 2001; }],
    ['OBSERVED_COST_EXCEEDED', r => { r.usage.cost = 1; }],
  ];
  for (const [code, mutate] of mutations) {
    const response = good(); mutate(response); const m = mock(response);
    const report = await runEvaluation({ ...config, maxRequests: 2 }, [human, human], m.options);
    assert.equal(report.code, code); assert.equal(m.calls.length, 2); assert.equal(report.requestsAttempted, 1);
    assert.ok(!JSON.stringify(report).includes(key));
    if (code === 'USAGE_UNKNOWN') assert.equal(report.observedCostUsd, null);
  }
});

test('observed spend gates next request even if the original batch estimate passed', async () => {
  const response = good(); response.usage.cost = 0.09;
  const m = mock(response); const report = await runEvaluation({ ...config, maxRequests: 2 }, [human, human], m.options);
  assert.equal(report.code, 'REMAINING_BUDGET_INSUFFICIENT'); assert.equal(m.calls.length, 2);
});

test('HTTP and transport errors are redacted and never retried', async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const report = await runEvaluation(config, [human], { ...mock().options, request: async () => {
      calls++; return calls === 1 ? Response.json(capabilities) : new Response(key, { status });
    } });
    assert.equal(calls, 2); assert.equal(report.code, status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR');
    assert.equal(report.observedCostUsd, null); assert.ok(!JSON.stringify(report).includes(key));
  }
  const report = await runEvaluation(config, [human], { ...mock().options, request: async () => { throw new Error(key); } });
  assert.equal(report.code, 'NETWORK_ERROR'); assert.ok(!JSON.stringify(report).includes(key));
});

test('deadline covers stalled fetch and stalled body; oversized or malformed bodies are bounded', async () => {
  for (const behavior of ['fetch', 'body', 'large', 'json']) {
    let calls = 0;
    const report = await runEvaluation({ ...config, timeoutMs: 30 }, [human], { ...mock().options,
      request: async () => {
        calls++; if (calls === 1) return Response.json(capabilities);
        if (behavior === 'fetch') return new Promise<Response>(() => {});
        if (behavior === 'body') return new Response(new ReadableStream({ start() {} }));
        return new Response(behavior === 'large' ? 'x'.repeat(2_000_001) : '{');
      } });
    assert.equal(report.code, ['fetch', 'body'].includes(behavior) ? 'REQUEST_TIMEOUT' : behavior === 'large' ? 'RESPONSE_TOO_LARGE' : 'INVALID_RESPONSE_JSON');
    assert.equal(calls, 2); assert.equal(report.observedCostUsd, null);
  }
});

test('CLI defaults offline and rejects unknown flags with safe JSON reports', async () => {
  const path = fileURLToPath(new URL('../evaluation/fixtures/synthetic-run.json', import.meta.url));
  const dry = await runCli([path]);
  assert.equal(dry.exitCode, 0); assert.equal((dry.report as any).mode, 'dry-run');
  assert.equal((await runCli([])).exitCode, 2);
  assert.equal((await runCli([path, '--unsafe'])).exitCode, 2);
});

test('planning sends only eligible facts and evaluates the diagnostic draft', async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const candidateId = '33333333-3333-4333-8333-333333333333';
  const planFixture = { ...human, skill: 'plan-section', productName: 'Synthetic bottle', expectedFacts: [], expectedConflictAttributes: [],
    facts: [{ ...output.facts[0], id, status: 'confirmed' },
      { ...output.facts[0], id: candidateId, attribute: 'other', status: 'candidate' }] };
  const plan = { chapters: [{ role: 'feature', purpose: '说明容量', factIds: [id] }],
    section: { purpose: '验证容量信息', factIds: [id], missingInputs: ['产品图片'] } };
  const response = good(); response.choices[0]!.message.content = JSON.stringify(plan);
  const m = mock(response); const report = await runEvaluation(config, [planFixture], m.options);
  assert.equal(report.status, 'needs_human_review');
  const body = JSON.parse(m.calls[1]!.init!.body as string);
  const input = JSON.parse(body.messages[1].content);
  assert.equal(input.confirmedFacts.length, 1); assert.equal(input.confirmedFacts[0].id, id);
  assert.ok(!JSON.stringify(input).includes(candidateId));
});

test('batch has exactly the requested number of calls and preserves zero versus unknown costs', async () => {
  const response = good(); response.usage.cost = 0;
  const m = mock(response);
  const report = await runEvaluation({ ...config, maxRequests: 2 }, [human, human], m.options);
  assert.equal(report.status, 'needs_human_review'); assert.equal(report.requestsAttempted, 2);
  assert.equal(m.calls.length, 3); assert.equal(report.observedCostUsd, 0); assert.equal(report.items.length, 2);
});
