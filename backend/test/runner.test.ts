import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runEvaluation, type RunnerOptions } from '../evaluation/runner.js';
import { runCli } from '../evaluation/runner-cli.js';
import { AuthorizationLedger } from '../evaluation/authorization-ledger.js';
import { ArtifactCipher } from '../evaluation/authorization-artifacts.js';
import { sha256 } from '../evaluation/authorization-contract.js';
import { PURPOSE_LIMITS, type Purpose } from '../evaluation/authorization-contract.js';
import { artifactKey, authorizedCapabilities as capabilities, authorizedConfig as config, goodResponse as good, humanFixture as human,
  syntheticFixture as fixture, consume, corePayload, prepared, preparedCore, withLedger } from './authorization-helpers.js';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../evaluation/fixtures/${name}.json`, import.meta.url), 'utf8'));
const key = 'TEST_ONLY_SECRET';
type Mock = { f: Parameters<Parameters<typeof withLedger>[0]>[0]; batch: Awaited<ReturnType<typeof prepared>>;
  calls: { url: string; init: RequestInit | undefined }[]; options: RunnerOptions };
async function withMock(action: (mock: Mock) => Promise<void>, settings: {
  config?: typeof config; fixtures?: unknown[]; response?: unknown; capabilities?: unknown; review?: boolean } = {}) {
  return withLedger(async f => {
    const batch = await prepared(f.manager, { config: settings.config ?? config, fixtures: settings.fixtures ?? [human], review: settings.review });
    const calls: Mock['calls'] = [];
    const options: RunnerOptions = { live: true, authorization: { ledger: f.runner, batchId: batch.batchId, sources: batch.sources },
      environmentEnabled: () => true, getApiKey: () => key, request: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json(init?.method === 'POST' ? settings.response ?? good() : settings.capabilities ?? capabilities);
      } };
    await action({ f, batch, calls, options });
  });
}

test('dry-run is byte-compatible, zero-network and never touches credentials, environment or ledger', async () => {
  let accesses = 0;
  const report = await runEvaluation(read('synthetic-run').config, [fixture], { capabilities: read('synthetic-endpoints'),
    request: async () => { accesses++; throw new Error(); }, getApiKey: () => { accesses++; throw new Error(); },
    environmentEnabled: () => { accesses++; throw new Error(); } });
  assert.equal(accesses, 0); assert.equal(report.status, 'dry_run'); assert.equal(report.requestsAttempted, 0);
  assert.equal(report.items[0]?.estimatedCostUsd, 0.014); assert.equal(report.businessAcceptance, false);
  assert.equal(report.items[0]?.requestSha256, 'b5bd0d81942372f2e30133e3cc3bccdafbe5293c381f034e8a8c86629ddcf716');
});

test('old live entry, arbitrary duck ledger and management ledger all fail before key or network access', async () => {
  let accesses = 0;
  const trap = () => { accesses++; throw new Error('must not execute'); };
  const options = { live: true, environmentEnabled: () => true, getApiKey: trap, request: trap };
  assert.equal((await runEvaluation(config, [human], options)).code, 'AUTHORIZATION_REQUIRED');
  const forged = { reviewedBatch: trap, status: trap, beginDispatch: trap, reviewInput: trap };
  assert.equal((await runEvaluation(config, [human], { ...options,
    authorization: { ledger: forged as any, batchId: randomUUID(), sources: [] } })).code, 'AUTHORIZATION_INVALID_INSTANCE');
  assert.equal(accesses, 0);
  await withLedger(async f => {
    assert.equal((await runEvaluation(config, [human], { ...options,
      authorization: { ledger: f.manager, batchId: randomUUID(), sources: [] } })).code, 'AUTHORIZATION_INVALID_INSTANCE');
    assert.equal(accesses, 0);
  });
});

test('config, environment, provenance, missing key and unsupported purpose all fail locally', async () => {
  await withMock(async m => {
    for (const [c, input, enabled, secret, expected] of [
      [{ ...config, acceptEstimatedBudget: false }, human, true, key, 'LIVE_NOT_ENABLED'],
      [config, human, false, key, 'LIVE_NOT_ENABLED'],
      [config, fixture, true, key, 'LIVE_REQUIRES_HUMAN_CURATED_FIXTURES'],
      [config, human, true, '', 'KEY_NOT_CONFIGURED'],
      [config, { ...human, skill: 'plan-section' }, true, key, 'PURPOSE_ADAPTER_NOT_READY'],
    ] as const) {
      const report = await runEvaluation(c, [input], { ...m.options, environmentEnabled: () => enabled, getApiKey: () => secret });
      assert.equal(report.code, expected); assert.equal(m.calls.length, 0);
      assert.equal((await m.f.runner.status()).batches[0]!.status, 'approved');
    }
  });
});

test('human-curated or approved fixture fields cannot create independent input review', async () => {
  await withMock(async m => {
    let keys = 0;
    const options = { ...m.options, getApiKey: () => { keys++; return key; } };
    assert.equal((await runEvaluation(config, [human], options)).code, 'INPUT_REVIEW_REQUIRED');
    for (const extra of [{ approved: true }, { reviewer: 'human' }, { humanCurated: true }]) {
      assert.equal((await runEvaluation(config, [{ ...human, ...extra }], options)).code, 'INVALID_RUN_INPUT');
    }
    assert.equal(keys, 0); assert.equal(m.calls.length, 0);
    assert.equal((await m.f.db.query('SELECT * FROM evaluation_input_reviews')).rows.length, 0);
  }, { review: false });
});

test('every unsupported stage including image is explicitly closed before reading a model credential', () => withLedger(async f => {
  let accesses = 0; const trap = () => { accesses++; throw new Error('forbidden'); };
  for (const purpose of Object.keys(PURPOSE_LIMITS) as Purpose[]) {
    if (purpose === 'fact_extraction') continue;
    const batch = await preparedCore(f.manager, corePayload(purpose));
    const report = await runEvaluation(batch.payload.config, [human], { live: true,
      authorization: { ledger: f.runner, batchId: batch.batchId, sources: batch.payload.sources },
      environmentEnabled: () => true, getApiKey: trap, request: trap });
    assert.equal(report.code, 'PURPOSE_ADAPTER_NOT_READY');
    assert.equal((await f.runner.status()).batches.find(row => row.id === batch.batchId)!.status, 'stopped');
  }
  assert.equal(accesses, 0); assert.equal((await f.runner.status()).attempts.length, 0);
}));

test('input, expected, source bytes, adapter and reviewed capability changes fail closed', async () => {
  for (const mutation of [{ ...human, productName: 'Changed product' }, { ...human, expectedFacts: [] }]) await withMock(async m => {
    let keys = 0;
    const options = { ...m.options, getApiKey: () => { keys++; return key; } };
    assert.equal((await runEvaluation(config, [mutation], options)).code, 'BATCH_INPUT_CHANGED');
    const peer = AuthorizationLedger.forRunner(m.f.db, new ArtifactCipher(artifactKey));
    assert.equal((await peer.status()).batches[0]!.status, 'stopped');
    const repeat = await runEvaluation(config, [human], { ...options, authorization: { ...options.authorization!, ledger: peer } });
    assert.equal(repeat.code, 'BATCH_NOT_RUNNABLE'); assert.equal(repeat.metadataRequests, 0); assert.equal(repeat.requestsAttempted, 0);
    assert.equal(keys, 0); assert.equal(m.calls.length, 0);
  });
  await withMock(async m => {
    assert.equal((await runEvaluation(config, [human], { ...m.options, authorization: { ...m.options.authorization!,
      sources: [{ ...m.batch.sources[0]!, bytesBase64: Buffer.from('changed original bytes').toString('base64') }] } })).code, 'BATCH_INPUT_CHANGED');
    assert.equal(m.calls.length, 0); assert.equal((await m.f.runner.status()).batches[0]!.status, 'stopped');
  });
  const changed = structuredClone(capabilities); changed.data.endpoints[0].pricing.prompt = '0.0000011';
  await withMock(async m => {
    assert.equal((await runEvaluation(config, [human], m.options)).code, 'CAPABILITIES_CHANGED_REVIEW_REQUIRED');
    assert.equal(m.calls.length, 1); assert.equal((await m.f.runner.status()).attempts.length, 0);
    const peer = AuthorizationLedger.forRunner(m.f.db, new ArtifactCipher(artifactKey));
    const repeat = await runEvaluation(config, [human], { ...m.options, authorization: { ...m.options.authorization!, ledger: peer } });
    assert.equal(repeat.code, 'BATCH_NOT_RUNNABLE'); assert.equal(repeat.metadataRequests, 0); assert.equal(repeat.requestsAttempted, 0);
    assert.equal(m.calls.length, 1); assert.equal((await peer.status()).batches[0]!.status, 'stopped');
  }, { capabilities: changed });
});

test('an approved batch containing an old runtime secret remains stopped after credential rotation and cannot POST that secret', async () => {
  const input = { ...human, evidence: human.evidence.map((evidence: Record<string, unknown>, index: number) =>
    index === 0 ? { ...evidence, text: `${evidence.text} ${key}` } : evidence) };
  for (const knownBeforeRead of [false, true]) await withMock(async m => {
    let firstRunner = m.f.runner;
    if (knownBeforeRead) {
      const prior = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = key;
      try { firstRunner = AuthorizationLedger.forRunner(m.f.db, new ArtifactCipher(artifactKey)); }
      finally { if (prior === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prior; }
    }
    assert.ok(m.batch.payload.items[0]!.requestBody.includes(key));
    const failed = await runEvaluation(config, [input], { ...m.options, authorization: { ...m.options.authorization!, ledger: firstRunner } });
    assert.equal(failed.code, 'SENSITIVE_INPUT_DETECTED'); assert.equal(failed.metadataRequests, 0); assert.equal(failed.requestsAttempted, 0);
    const peer = AuthorizationLedger.forRunner(m.f.db, new ArtifactCipher(artifactKey));
    assert.equal((await peer.status()).batches[0]!.status, 'stopped');
    const repeat = await runEvaluation(config, [input], { ...m.options, getApiKey: () => 'synthetic-replacement-key',
      authorization: { ...m.options.authorization!, ledger: peer } });
    assert.equal(repeat.code, 'BATCH_NOT_RUNNABLE'); assert.equal(repeat.metadataRequests, 0); assert.equal(repeat.requestsAttempted, 0);
    assert.equal(m.calls.length, 0);
    const stops = await m.f.db.query("SELECT body FROM evaluation_events WHERE type='batch.review_invalidated'");
    assert.equal(stops.rows.length, 1); assert.ok(!JSON.stringify(stops.rows).includes(key));
  }, { fixtures: [input] });
});

test('all metadata transport failures persistently stop the reviewed batch and the next run performs zero requests', async () => {
  const cases: [string, () => Promise<Response>][] = [
    ['HTTP_ERROR', async () => new Response('synthetic unauthorized', { status: 401 })],
    ['RATE_LIMITED', async () => new Response('synthetic rate limit', { status: 429 })],
    ['NETWORK_ERROR', async () => { throw new Error('synthetic network failure'); }],
    ['REQUEST_TIMEOUT', () => new Promise<Response>(() => {})],
    ['RESPONSE_TOO_LARGE', async () => new Response('x'.repeat(2_000_001))],
    ['INVALID_RESPONSE', async () => new Response(null)],
    ['INVALID_RESPONSE_JSON', async () => new Response('{')],
  ];
  for (const [code, respond] of cases) await withMock(async m => {
    let calls = 0; const options = { ...m.options, request: async () => { calls++; return respond(); } };
    const report = await runEvaluation(m.batch.config, [human], options);
    assert.equal(report.code, code); assert.equal(report.requestsAttempted, 0); assert.equal(report.metadataRequests, 1);
    const peer = AuthorizationLedger.forRunner(m.f.db, new ArtifactCipher(artifactKey));
    assert.equal((await peer.status()).batches[0]!.status, 'stopped');
    const repeat = await runEvaluation(m.batch.config, [human], { ...options, authorization: { ...options.authorization!, ledger: peer } });
    assert.equal(repeat.code, 'BATCH_NOT_RUNNABLE'); assert.equal(repeat.metadataRequests, 0); assert.equal(repeat.requestsAttempted, 0);
    assert.equal(calls, 1);
  }, { config: { ...config, timeoutMs: code === 'REQUEST_TIMEOUT' ? 30 : 1000 } });
});

test('known quota, global estimate and local budget exhaustion block before credentials and metadata without stopping a batch', async () => {
  for (const mode of ['purpose', 'estimate', 'local'] as const) await withMock(async m => {
    if (mode === 'local') await consume(m.f.runner, m.batch, 'item-1', good(config.modelId, 0.09));
    else {
      const other = await preparedCore(m.f.manager, corePayload(mode === 'purpose' ? 'fact_extraction' : 'formal_story',
        mode === 'purpose' ? 1000 : 250000, 3));
      for (const item of other.payload.items) await m.f.runner.reserve(other.batchId, item.id, other.plan);
    }
    let keys = 0;
    const report = await runEvaluation(m.batch.config, m.batch.fixtures, { ...m.options, getApiKey: () => { keys++; return key; } });
    assert.equal(report.code, mode === 'purpose' ? 'AUTHORIZATION_QUOTA_EXCEEDED' : mode === 'estimate' ? 'AUTHORIZATION_ESTIMATE_EXCEEDED' : 'REMAINING_BUDGET_INSUFFICIENT');
    assert.equal(report.metadataRequests, 0); assert.equal(report.requestsAttempted, 0); assert.equal(keys, 0); assert.equal(m.calls.length, 0);
    assert.equal(report.authorization?.batches.find(batch => batch.id === m.batch.batchId)?.status, 'approved');
  }, mode === 'local' ? { config: { ...config, maxRequests: 2 }, fixtures: [human, human] } : {});
});

test('a competing reservation after availability may consume the quota before final reserve but never dispatch a model', () => withMock(async m => {
  let calls = 0;
  const report = await runEvaluation(config, [human], { ...m.options, request: async (_url, init) => {
    calls++; assert.notEqual(init?.method, 'POST');
    const other = await preparedCore(m.f.manager, corePayload('fact_extraction', 1000, 3));
    for (const item of other.payload.items) await m.f.runner.reserve(other.batchId, item.id, other.plan);
    return Response.json(capabilities);
  } });
  assert.equal(report.code, 'AUTHORIZATION_QUOTA_EXCEEDED'); assert.equal(report.metadataRequests, 1); assert.equal(report.requestsAttempted, 0);
  assert.equal(calls, 1); assert.equal(report.authorization?.batches.find(batch => batch.id === m.batch.batchId)?.status, 'approved');
}));

test('successful live adapter uses exact reviewed request, strict route and existing evaluator', async () => {
  await withMock(async m => {
    const report = await runEvaluation(config, [human], m.options);
    assert.equal(report.status, 'needs_human_review'); assert.equal(report.items[0]?.evaluation?.automaticChecksPassed, true);
    assert.equal(report.businessAcceptance, false); assert.equal(report.requestsAttempted, 1); assert.equal(report.metadataRequests, 1);
    assert.equal(report.observedCostUsd, 0.001);
    assert.match(m.calls[0]!.url, /\/models\/google\/gemini-2.5-flash\/endpoints$/);
    assert.equal(m.calls[1]!.init!.body, m.batch.payload.items[0]!.requestBody);
    const body = JSON.parse(m.calls[1]!.init!.body as string);
    assert.deepEqual(body.provider, { only: [config.provider], order: [config.provider], allow_fallbacks: false, require_parameters: true });
    assert.equal(body.stream, false); assert.equal(body.max_tokens, 2000); assert.equal(body.response_format.type, 'json_schema');
    assert.ok(!body.messages[1].content.includes('expectedFacts')); assert.equal(m.calls[1]!.init!.redirect, 'error');
    assert.ok(!JSON.stringify(report).includes(key)); assert.ok(!JSON.stringify(report).includes(fixture.evidence[0].text));
    const repeat = await runEvaluation(config, [human], { ...m.options, getApiKey: () => { throw new Error('no key needed'); } });
    assert.equal(repeat.status, 'needs_human_review'); assert.equal(repeat.requestsAttempted, 0); assert.equal(repeat.metadataRequests, 0);
    assert.equal(repeat.items[0]!.observed!.latencyMs, report.items[0]!.observed!.latencyMs);
    assert.equal(repeat.authorization?.modalities.text.consumedRequests, 1); assert.equal(m.calls.length, 2);
  });
});

test('capabilities, identity, capacity and prices reject before model POST', async () => {
  const mutations: ((c: any) => void)[] = [
    c => { c.data.id = 'other/model'; }, c => { c.data.endpoints = []; },
    c => { c.data.endpoints.push({ ...c.data.endpoints[0], tag: config.provider + '/variant' }); },
    c => { c.data.endpoints[0].supported_parameters = ['response_format', 'max_tokens']; },
    c => { delete c.data.endpoints[0].pricing.prompt; }, c => { delete c.data.endpoints[0].pricing.completion; },
    c => { c.data.endpoints[0].pricing.prompt = ''; }, c => { c.data.endpoints[0].pricing.prompt = '-1'; },
    c => { c.data.endpoints[0].pricing.prompt = '1e999'; }, c => { c.data.endpoints[0].pricing.unknown_fee = '1'; },
    c => { c.data.endpoints[0].max_completion_tokens = null; }, c => { c.data.endpoints[0].context_length = 100; },
    c => { c.data.endpoints[0].status = -1; }, c => { c.data.architecture.output_modalities = ['image']; },
    c => { c.data.endpoints[0].model_id = 'other/model'; },
    c => { c.data.endpoints[0].pricing.input_cache_write = '0.01'; },
    c => { c.data.endpoints[0].pricing.prompt = '1e308'; },
    c => { c.data.endpoints[0].pricing.prompt = '1e30'; },
  ];
  for (const mutate of mutations) {
    const caps = structuredClone(capabilities); mutate(caps);
    await withMock(async m => { const report = await runEvaluation(config, [human], m.options);
      assert.equal(report.status, 'blocked'); assert.equal(m.calls.length, 1); assert.equal(report.requestsAttempted, 0);
      assert.equal((await m.f.db.query("SELECT * FROM evaluation_artifacts WHERE kind='preflight-response'")).rows.length, 1);
      assert.equal((await m.f.runner.status()).batches[0]!.status, 'stopped');
      const repeat = await runEvaluation(config, [human], m.options);
      assert.equal(repeat.code, 'BATCH_NOT_RUNNABLE'); assert.equal(repeat.metadataRequests, 0); assert.equal(repeat.requestsAttempted, 0);
      assert.equal(m.calls.length, 1);
    }, { capabilities: caps });
  }
});

test('truncation, refusal, malformed output, routing, usage and rules retain raw failure evidence and stop after one POST', async () => {
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
    const response = good(); mutate(response);
    const batchConfig = { ...config, maxRequests: 2 };
    await withMock(async m => { const report = await runEvaluation(batchConfig, [human, human], m.options);
      assert.equal(report.code, code); assert.equal(m.calls.length, 2); assert.equal(report.requestsAttempted, 1);
      assert.ok(!JSON.stringify(report).includes(key)); assert.ok(report.items[0]?.responseArtifactId);
      assert.equal(report.authorization?.batches[0]?.status, 'stopped');
      const again = await runEvaluation(batchConfig, [human, human], m.options);
      assert.equal(again.requestsAttempted, 0); assert.equal(m.calls.length, 2);
      if (code === 'USAGE_UNKNOWN') assert.equal(report.observedCostUsd, null);
    }, { config: batchConfig, fixtures: [human, human], response });
  }
});

test('local input and request gates execute before key access; observed spend blocks the next request', async () => {
  await withMock(async m => {
    for (const [c, fixtures, expected] of [
      [config, [human, human], 'REQUEST_BUDGET_EXCEEDED'],
      [{ ...config, maxInputTokens: 1 }, [human], 'INPUT_ESTIMATE_EXCEEDS_LIMIT'],
      [{ ...config, modelId: 'openrouter/auto' }, [human], 'INVALID_RUN_INPUT'],
      [config, [{ ...human, evidence: [human.evidence[0], human.evidence[0]] }], 'INVALID_RUN_INPUT'],
    ] as const) {
      const report = await runEvaluation(c, [...fixtures], { ...m.options, getApiKey: () => { throw new Error('no key'); } });
      assert.equal(report.code, expected); assert.equal(report.requestsAttempted, 0);
    }
  });
  const batchConfig = { ...config, maxRequests: 2 };
  await withMock(async m => {
    const report = await runEvaluation(batchConfig, [human, human], m.options);
    assert.equal(report.code, 'REMAINING_BUDGET_INSUFFICIENT'); assert.equal(m.calls.length, 2);
  }, { config: batchConfig, fixtures: [human, human], response: good(config.modelId, 0.09) });
});

test('HTTP and transport failures preserve scrubbed bounded captures and are never retried', async () => {
  for (const status of [401, 429, 500]) {
    await withMock(async m => {
      let calls = 0;
      const report = await runEvaluation(config, [human], { ...m.options, request: async () => {
        calls++; return calls === 1 ? Response.json(capabilities) : new Response(key, { status });
      } });
      assert.equal(calls, 2); assert.equal(report.code, status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR');
      assert.equal(report.observedCostUsd, null); assert.ok(!JSON.stringify(report).includes(key));
      const saved = await m.f.manager.readArtifactForReview(report.items[0]!.responseArtifactId!);
      assert.equal(saved.bytes.toString(), '[REDACTED]'); assert.equal(saved.metadata.state, 'complete');
    });
  }
  await withMock(async m => {
    const report = await runEvaluation(config, [human], { ...m.options, request: async () => { throw new Error(key); } });
    assert.equal(report.code, 'NETWORK_ERROR'); assert.ok(!JSON.stringify(report).includes(key));
    assert.equal((await m.f.runner.status()).modalities.text.consumedRequests, 0);
  });
});

test('deadline includes stalled body; partial, oversized and invalid JSON evidence distinguish unknown usage', async () => {
  for (const behavior of ['fetch', 'body', 'prefix', 'large', 'json']) {
    const batchConfig = { ...config, timeoutMs: 30 };
    await withMock(async m => {
      let calls = 0;
      const report = await runEvaluation(batchConfig, [human], { ...m.options, request: async () => {
        calls++; if (calls === 1) return Response.json(capabilities);
        if (behavior === 'fetch') return new Promise<Response>(() => {});
        if (behavior === 'body') return new Response(new ReadableStream({ start() {} }));
        if (behavior === 'prefix') return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('partial-data')); } }));
        return new Response(behavior === 'large' ? 'x'.repeat(2_000_001) : '{');
      } });
      assert.equal(report.code, ['fetch', 'body', 'prefix'].includes(behavior) ? 'REQUEST_TIMEOUT' : behavior === 'large' ? 'RESPONSE_TOO_LARGE' : 'INVALID_RESPONSE_JSON');
      assert.equal(calls, 2); assert.equal(report.observedCostUsd, null);
      const saved = await m.f.manager.readArtifactForReview(report.items[0]!.responseArtifactId!);
      assert.equal(saved.metadata.state, behavior === 'fetch' ? 'unavailable' : behavior === 'json' ? 'complete' : 'partial');
      assert.equal(saved.bytes.length, behavior === 'large' ? 2_000_000 : behavior === 'prefix' ? 12 : behavior === 'json' ? 1 : 0);
      if (behavior === 'prefix') assert.equal(saved.originalSha256, sha256(Buffer.from('partial-data')));
    }, { config: batchConfig });
  }
});

test('missing storage key or unknown in-flight attempt blocks before metadata and cannot auto recover', async () => {
  await withMock(async m => {
    const missingKey = AuthorizationLedger.forRunner(m.f.db, undefined);
    const report = await runEvaluation(config, [human], { ...m.options, authorization: { ...m.options.authorization!, ledger: missingKey } });
    assert.equal(report.code, 'ARTIFACT_KEY_NOT_CONFIGURED'); assert.equal(m.calls.length, 0);
    assert.equal((await m.f.runner.status()).batches[0]!.status, 'approved');
    const reserved = await m.f.runner.reserve(m.batch.batchId, 'item-1', m.batch.plan);
    await m.f.runner.beginDispatch(reserved.id, randomUUID());
    const afterCrash = await runEvaluation(config, [human], m.options);
    assert.equal(afterCrash.code, 'AUTHORIZATION_EFFECTIVE_HOLD'); assert.equal(m.calls.length, 0);
    assert.equal(afterCrash.authorization?.modalities.text.consumedRequests, 1);
    assert.equal(afterCrash.authorization?.batches[0]?.status, 'approved');
  });
});

test('CLI remains offline by default and cannot chain review into live', async () => {
  const path = fileURLToPath(new URL('../evaluation/fixtures/synthetic-run.json', import.meta.url));
  assert.equal((await runCli([path])).exitCode, 0);
  assert.equal((await runCli([])).exitCode, 2); assert.equal((await runCli([path, '--unsafe'])).exitCode, 2);
  const legacyLive = await runCli([path, '--live']); assert.equal((legacyLive.report as any).code, 'AUTHORIZATION_REQUIRED');
  assert.equal((await runCli([path, '--live', '--review-input', randomUUID()])).exitCode, 2);
});

test('two requested items consume exactly two permits and retain observed zero', async () => {
  const batchConfig = { ...config, maxRequests: 2 };
  await withMock(async m => {
    const report = await runEvaluation(batchConfig, [human, human], m.options);
    assert.equal(report.status, 'needs_human_review'); assert.equal(report.requestsAttempted, 2);
    assert.equal(m.calls.length, 3); assert.equal(report.observedCostUsd, 0); assert.equal(report.items.length, 2);
    assert.equal(report.authorization?.modalities.text.consumedRequests, 2);
  }, { config: batchConfig, fixtures: [human, human], response: good(config.modelId, 0) });
});
