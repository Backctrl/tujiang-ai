import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { postgres, type Database } from '../src/database.js';
import { ArtifactCipher, type SealedArtifact } from '../evaluation/authorization-artifacts.js';
import { migrateAuthorizationLedger } from '../evaluation/authorization-database.js';
import { AuthorizationLedger } from '../evaluation/authorization-ledger.js';
import { AUTHORIZATION_POLICY, POLICY_SHA256 } from '../evaluation/authorization-contract.js';
import { runEvaluation } from '../evaluation/runner.js';
import { integrityCases } from './authorization-integrity-cases.js';
import { artifactKey, authorizedCapabilities, authorizedConfig, consume, corePayload, humanFixture,
  managementLedger, prepared, preparedCore, reviewedCommand } from './authorization-helpers.js';

const configured = process.env.TEST_DATABASE_URL;
if (!configured) throw new Error('TEST_DATABASE_URL is required: evaluation PostgreSQL checks cannot be skipped.');
let base: URL; try { base = new URL(configured); } catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }
if (!['postgres:', 'postgresql:'].includes(base.protocol)) throw new Error('TEST_DATABASE_URL must use PostgreSQL.');
interface ChildMessage { event: string; code?: string | null; stage?: string; attemptId?: string; owner?: string; report?: any; state?: any; result?: any }
function processProbe(url: string, input: { mode: string; batchId?: string; itemId?: string }) {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./authorization-process.ts', import.meta.url))], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
    env: { ...process.env, TEST_DATABASE_URL: url }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const messages: ChildMessage[] = []; let settled = false;
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  const result = new Promise<ChildMessage>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('EVALUATION_PROCESS_TIMEOUT')); }, 15000);
    child.on('message', message => {
      const value = message as ChildMessage; messages.push(value);
      if (!settled && ['checkpoint', 'result'].includes(value.event)) { settled = true; clearTimeout(timer); resolve(value); }
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('EVALUATION_PROCESS_START_FAILED')); });
    child.once('close', () => { clearTimeout(timer); if (!settled) reject(new Error('EVALUATION_PROCESS_EXITED')); });
  });
  child.send(input);
  return { messages, result, async stop() { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; } };
}
async function isolated(action: (context: { db: Database; peer: Database; runner: AuthorizationLedger; manager: AuthorizationLedger;
  start: (input: { mode: string; batchId?: string; itemId?: string }) => ReturnType<typeof processProbe> }) => Promise<void>) {
  const schema = `tujiang_eval_${randomUUID().replaceAll('-', '')}`; assert.match(schema, /^tujiang_eval_[a-f0-9]{32}$/);
  const admin = postgres(base.toString()); const connections: Database[] = []; const children: ReturnType<typeof processProbe>[] = [];
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const url = new URL(base); url.searchParams.set('options', `-c search_path=${schema}`);
    const db = postgres(url.toString()); const peer = postgres(url.toString()); connections.push(db, peer);
    const identity = await db.query<{ schema: string; version: string }>('SELECT current_schema() AS schema,version() AS version');
    assert.equal(identity.rows[0]?.schema, schema); assert.match(identity.rows[0]!.version, /^PostgreSQL /);
    await migrateAuthorizationLedger(db);
    const manager = managementLedger(db); await manager.initialize();
    const runner = AuthorizationLedger.forRunner(peer, new ArtifactCipher(artifactKey));
    await action({ db, peer, runner, manager, start: input => { const child = processProbe(url.toString(), input); children.push(child); return child; } });
  } finally {
    await Promise.all(children.map(child => child.stop()));
    await Promise.all(connections.map(db => db.close()));
    try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.close(); }
  }
}

for (const scenario of integrityCases) test(`PostgreSQL evaluation: ${scenario.name}`, () => isolated(async f => {
  await scenario.run({ ...f, verifyRestart: async batchId => {
    const child = f.start({ mode: 'runner', batchId }); const result = await child.result;
    assert.equal(result.code ?? result.report?.code, 'BATCH_NOT_RUNNABLE');
    assert.equal(child.messages.filter(message => ['synthetic-metadata', 'synthetic-post'].includes(message.event)).length, 0);
  } });
}));

test('PostgreSQL evaluation: concurrent initialization never overwrites policy or resets consumed state', () => isolated(async f => {
  const batch = await preparedCore(f.manager); await consume(f.runner, batch); const before = await f.manager.status();
  const children = Array.from({ length: 3 }, () => f.start({ mode: 'initialize' }));
  const results = await Promise.all(children.map(child => child.result));
  assert.ok(results.every(result => result.code === null)); assert.deepEqual(await f.manager.status(), before);
  const policy = { ...AUTHORIZATION_POLICY, automaticRetry: true };
  await assert.rejects(managementLedger(f.peer).initialize(policy, POLICY_SHA256), /AUTHORIZATION_POLICY_CONFLICT/);
  assert.deepEqual(await f.manager.status(), before);
}));

test('PostgreSQL evaluation: independent live-runner processes dispatch the same reviewed item only once', () => isolated(async f => {
  const batch = await prepared(f.manager);
  const children = Array.from({ length: 3 }, () => f.start({ mode: 'runner', batchId: batch.batchId }));
  const results = await Promise.all(children.map(child => child.result));
  assert.ok(results.some(result => result.report?.status === 'needs_human_review'));
  assert.equal(children.flatMap(child => child.messages).filter(message => message.event === 'synthetic-post').length, 1);
  const state = await f.manager.status(); assert.equal(state.modalities.text.consumedRequests, 1);
  assert.equal(state.modalities.text.knownObservedUsd, 0.001); assert.equal(state.attempts.length, 1);
}));

test('PostgreSQL evaluation: competing processes cannot exceed purpose count or global estimate', () => isolated(async f => {
  const existing = await preparedCore(f.manager, corePayload('fact_extraction', 250000, 2));
  await f.runner.reserve(existing.batchId, 'item-1', existing.plan); await f.runner.reserve(existing.batchId, 'item-2', existing.plan);
  const first = await preparedCore(f.manager, corePayload('formal_story', 200000));
  const second = await preparedCore(f.manager, corePayload('copy', 200000));
  const children = [first, second].map(batch => f.start({ mode: 'reserve', batchId: batch.batchId }));
  const results = await Promise.all(children.map(child => child.result));
  assert.equal(results.filter(result => result.event === 'checkpoint').length, 1);
  assert.equal(results.filter(result => result.code === 'AUTHORIZATION_ESTIMATE_EXCEEDED').length, 1);
  assert.equal((await f.manager.status()).modalities.text.estimatedReservedUsd, 0.7);
  // These processes never performed a model request; cancellation remains a separate reviewed command.
  assert.equal(children.flatMap(child => child.messages).filter(message => message.event === 'synthetic-post').length, 0);
}));

test('PostgreSQL evaluation: purpose quota races count across different batch IDs and processes', () => isolated(async f => {
  const initial = await preparedCore(f.manager, corePayload('fact_extraction', 1, 2));
  await f.runner.reserve(initial.batchId, 'item-1', initial.plan); await f.runner.reserve(initial.batchId, 'item-2', initial.plan);
  const batches = await Promise.all([preparedCore(f.manager), preparedCore(f.manager)]);
  const results = await Promise.all(batches.map(batch => f.start({ mode: 'reserve', batchId: batch.batchId }).result));
  assert.equal(results.filter(result => result.event === 'checkpoint').length, 1);
  assert.equal(results.filter(result => result.code === 'AUTHORIZATION_QUOTA_EXCEEDED').length, 1);
  assert.equal((await f.runner.status()).purposes.fact_extraction.reserved, 3);
}));

for (const stage of ['reserve', 'dispatch', 'capture', 'finish'] as const) {
  test(`PostgreSQL evaluation: kill after ${stage} preserves the exact accounting and recovery boundary`, () => isolated(async f => {
    const batch = await preparedCore(f.manager, corePayload('fact_extraction', 1000, 2));
    const second = await f.runner.reserve(batch.batchId, 'item-2', batch.plan);
    const child = f.start({ mode: stage, batchId: batch.batchId }); const checkpoint = await child.result;
    assert.equal(checkpoint.event, 'checkpoint'); await child.stop();
    const attemptId = checkpoint.attemptId!; const state = await f.runner.status();
    const attempt = state.attempts.find(attempt => attempt.id === attemptId)!;
    assert.equal(state.modalities.text.consumedRequests, stage === 'reserve' ? 0 : 1);
    assert.equal(child.messages.filter(message => message.event === 'synthetic-post').length, ['capture', 'finish'].includes(stage) ? 1 : 0);
    if (stage === 'reserve') {
      assert.equal(state.modalities.text.reservedRequests, 2);
      assert.equal((await f.runner.reserve(batch.batchId, 'item-1', batch.plan)).id, attemptId);
      await f.manager.cancelReservation(attemptId, await reviewedCommand(f.manager));
      assert.equal((await f.runner.status()).modalities.text.consumedRequests, 0);
    } else if (stage === 'dispatch' || stage === 'capture') {
      assert.equal(state.status, 'held'); assert.equal(state.declaredStatus, 'ready');
      assert.equal(state.modalities.text.observedTotalUsd, null);
      await f.db.query("UPDATE evaluation_attempts SET started_at=now()-interval '365 days' WHERE id=$1", [attemptId]);
      await assert.rejects(f.runner.reserve(batch.batchId, 'item-2', batch.plan), /AUTHORIZATION_EFFECTIVE_HOLD/);
      await assert.rejects(f.runner.beginDispatch(second.id, randomUUID()), /AUTHORIZATION_EFFECTIVE_HOLD/);
      await assert.rejects(f.manager.releaseHold(await reviewedCommand(f.manager)), /AUTHORIZATION_EFFECTIVE_HOLD/);
      assert.equal((await f.runner.beginDispatch(attemptId, checkpoint.owner!)).claimed, false);
      if (stage === 'capture') {
        const saved = await f.manager.inspectAttempt(attemptId); assert.ok(saved.capture);
        await f.manager.recoverCapture(attemptId, saved.capture!.sourceSha256, { automaticChecksPassed: true, evaluation: { recovered: true } }, await reviewedCommand(f.manager));
        assert.equal((await f.runner.status()).modalities.text.consumedRequests, 1);
        assert.equal((await f.runner.status()).modalities.text.knownObservedUsd, 0.001);
      } else assert.equal((await f.manager.inspectAttempt(attemptId)).capture, null);
    } else {
      assert.equal(attempt.state, 'finished'); assert.equal(state.modalities.text.knownObservedUsd, 0.001);
      const replay = await f.runner.finish(attemptId, checkpoint.owner!, { automaticChecksPassed: true, evaluation: { syntheticProcess: true } }, { commandId: `finish-${attemptId}` });
      assert.deepEqual(replay, checkpoint.result); assert.equal((await f.runner.beginDispatch(attemptId, checkpoint.owner!)).claimed, false);
      assert.equal((await f.runner.status()).modalities.text.consumedRequests, 1);
    }
  }));
}

test('PostgreSQL evaluation: a failed batch blocks a pre-reserved item from another process', () => isolated(async f => {
  const batch = await preparedCore(f.manager, corePayload('fact_extraction', 1000, 2));
  const second = await f.runner.reserve(batch.batchId, 'item-2', batch.plan);
  await consume(f.runner, batch, 'item-1', undefined, false);
  const result = await f.start({ mode: 'dispatch', batchId: batch.batchId, itemId: 'item-2' }).result;
  assert.equal(result.code, 'BATCH_NOT_RUNNABLE');
  await assert.rejects(f.runner.beginDispatch(second.id, randomUUID()), /BATCH_NOT_RUNNABLE/);
  assert.equal((await f.runner.status()).modalities.text.consumedRequests, 1);
}));

for (const failure of ['input', 'capabilities', 'initial-secret', 'late-secret', 'reservation'] as const) {
  test(`PostgreSQL evaluation: ${failure} invalidation commits before a new process reads the stopped batch`, () => isolated(async f => {
    const secret = `SYNTHETIC_OLD_RUNTIME_${randomUUID()}`;
    const input = failure.endsWith('secret') ? { ...humanFixture,
      evidence: humanFixture.evidence.map((evidence: Record<string, unknown>, index: number) =>
        index === 0 ? { ...evidence, text: `${evidence.text} ${secret}` } : evidence) } : humanFixture;
    const batch = await prepared(f.manager, { fixtures: [input] });
    let metadata = 0; let posts = 0;
    if (failure === 'reservation') {
      await assert.rejects(f.runner.reserve(batch.batchId, 'item-1', { ...batch.plan, estimatedMicros: batch.plan.estimatedMicros + 1 }),
        /CAPABILITIES_CHANGED_REVIEW_REQUIRED/);
    } else {
      if (failure === 'initial-secret') f.runner.protectSecrets([secret]);
      const capabilities = structuredClone(authorizedCapabilities);
      if (failure === 'capabilities') capabilities.data.endpoints[0].pricing.prompt = '0.0000011';
      const submitted = failure === 'input' ? { ...input, expectedFacts: [] } : input;
      const report = await runEvaluation(authorizedConfig, [submitted], {
        live: true, authorization: { ledger: f.runner, batchId: batch.batchId, sources: batch.sources },
        environmentEnabled: () => true, getApiKey: () => secret, request: async (_url, init) => {
          if (init?.method === 'POST') posts++; else metadata++;
          return Response.json(capabilities);
        },
      });
      assert.equal(report.code, failure === 'input' ? 'BATCH_INPUT_CHANGED' : failure === 'capabilities' ?
        'CAPABILITIES_CHANGED_REVIEW_REQUIRED' : 'SENSITIVE_INPUT_DETECTED');
      assert.equal(report.requestsAttempted, 0);
      assert.equal(metadata, failure === 'capabilities' ? 1 : 0); assert.equal(posts, 0);
    }
    // Manager and runner use different PostgreSQL pools; this query can see only committed changes.
    const row = await f.db.query<{ status: string }>('SELECT status FROM evaluation_batches WHERE id=$1', [batch.batchId]);
    assert.equal(row.rows[0]!.status, 'stopped');
    const child = f.start({ mode: 'runner', batchId: batch.batchId }); const repeat = await child.result;
    assert.equal(repeat.code, 'BATCH_NOT_RUNNABLE');
    assert.equal(child.messages.filter(message => ['synthetic-post', 'synthetic-metadata'].includes(message.event)).length, 0);
    const events = await f.db.query("SELECT body FROM evaluation_events WHERE type='batch.review_invalidated'");
    assert.equal(events.rows.length, 1); assert.ok(!JSON.stringify(events.rows).includes(secret));
    assert.equal((await f.manager.status()).modalities.text.consumedRequests, 0);
  }));
}

test('PostgreSQL evaluation: pre-existing purpose saturation blocks another process before metadata without stopping its batch', () => isolated(async f => {
  const batch = await prepared(f.manager); const occupied = await preparedCore(f.manager, corePayload('fact_extraction', 1000, 3));
  for (const item of occupied.payload.items) await f.runner.reserve(occupied.batchId, item.id, occupied.plan);
  const child = f.start({ mode: 'runner', batchId: batch.batchId }); const result = await child.result;
  assert.equal(result.report?.code, 'AUTHORIZATION_QUOTA_EXCEEDED');
  assert.equal(result.report?.metadataRequests, 0); assert.equal(result.report?.requestsAttempted, 0);
  assert.equal(child.messages.filter(message => ['synthetic-post', 'synthetic-metadata'].includes(message.event)).length, 0);
  assert.equal((await f.manager.status()).batches.find(row => row.id === batch.batchId)?.status, 'approved');
}));

test('PostgreSQL evaluation: ciphertext corruption stops before returning, and restoring bytes cannot re-enable a new process', () => isolated(async f => {
  const batch = await prepared(f.manager); const artifactId = await f.manager.inputArtifactId(batch.batchId);
  const original = (await f.db.query<{ sealed: SealedArtifact }>('SELECT sealed FROM evaluation_artifacts WHERE id=$1', [artifactId])).rows[0]!.sealed;
  const bytes = Buffer.from(original.ciphertext, 'base64'); bytes[0] = bytes[0]! ^ 0xff;
  await f.db.query('UPDATE evaluation_artifacts SET sealed=$2 WHERE id=$1',
    [artifactId, JSON.stringify({ ...original, ciphertext: bytes.toString('base64') })]);
  let accesses = 0; const forbidden = () => { accesses++; throw new Error('synthetic key/network access forbidden'); };
  const failed = await runEvaluation(authorizedConfig, [humanFixture], { live: true,
    authorization: { ledger: f.runner, batchId: batch.batchId, sources: batch.sources },
    environmentEnabled: () => true, getApiKey: forbidden, request: forbidden });
  assert.equal(failed.code, 'ARTIFACT_INTEGRITY_FAILED'); assert.equal(failed.metadataRequests, 0); assert.equal(failed.requestsAttempted, 0);
  const row = await f.db.query<{ status: string }>('SELECT status FROM evaluation_batches WHERE id=$1', [batch.batchId]);
  assert.equal(row.rows[0]!.status, 'stopped'); assert.equal(accesses, 0);
  await f.db.query('UPDATE evaluation_artifacts SET sealed=$2 WHERE id=$1', [artifactId, JSON.stringify(original)]);
  const restored = await f.manager.readArtifactForReview(artifactId); assert.equal(restored.contentSha256, original.contentSha256);
  const child = f.start({ mode: 'runner', batchId: batch.batchId }); const repeat = await child.result;
  assert.equal(repeat.code, 'BATCH_NOT_RUNNABLE');
  assert.equal(child.messages.filter(message => ['synthetic-post', 'synthetic-metadata'].includes(message.event)).length, 0);
  const events = await f.db.query<{ body: { code: string } }>("SELECT body FROM evaluation_events WHERE type='batch.review_invalidated'");
  assert.equal(events.rows.length, 1); assert.equal(events.rows[0]!.body.code, 'ARTIFACT_INTEGRITY_FAILED');
  assert.equal((await f.manager.status()).modalities.text.consumedRequests, 0);
}));
