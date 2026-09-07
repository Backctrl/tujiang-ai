import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTHORIZATION_POLICY, POLICY_SHA256, PURPOSE_LIMITS, objectSha256, sha256, usdToMicros, type Purpose } from '../evaluation/authorization-contract.js';
import { ArtifactCipher } from '../evaluation/authorization-artifacts.js';
import { AuthorizationLedger } from '../evaluation/authorization-ledger.js';
import { exportArtifact } from '../evaluation/authorization-cli.js';
import { artifactKey, authorizedConfig, capture, consume, corePayload, decision, goodResponse, humanFixture,
  prepared, preparedCore, reviewedCommand, withLedger } from './authorization-helpers.js';

test('authorization initialization is create-once, policy-exact and never refills consumed quotas', () => withLedger(async f => {
  const batch = await preparedCore(f.manager); await consume(f.runner, batch);
  const before = await f.manager.status(); assert.deepEqual(await f.manager.initialize(), before);
  for (const [policy, sha] of [ [{ ...AUTHORIZATION_POLICY, maxInFlight: 2 }, POLICY_SHA256],
    [AUTHORIZATION_POLICY, '0'.repeat(64)], [{ ...AUTHORIZATION_POLICY, text: { ...AUTHORIZATION_POLICY.text, maxRequests: 13 } }, POLICY_SHA256] ] as const) {
    await assert.rejects(f.manager.initialize(policy, sha), /AUTHORIZATION_POLICY_CONFLICT/);
  }
  assert.deepEqual(await f.manager.status(), before);
}));

test('runner identity cannot mint reviews or invoke management operations; decision receipts are mandatory', () => withLedger(async f => {
  const batch = await prepared(f.manager, { review: false }); const before = await f.manager.status();
  assert.throws(() => new (AuthorizationLedger as any)(f.db, new ArtifactCipher(artifactKey), 'caller', 'faked-credential'), /AUTHORIZATION_INVALID_INSTANCE/);
  assert.throws(() => { (f.runner as any).reviewerCredentialSha256 = 'forged'; }, TypeError);
  await assert.rejects(f.runner.reviewInput(batch.batchId, batch.manifestSha256, decision(), { commandId: randomUUID() }), /MANAGEMENT_PERMISSION_REQUIRED/);
  await assert.rejects(f.runner.initialize(), /MANAGEMENT_PERMISSION_REQUIRED/);
  await assert.rejects(f.runner.reconcile(randomUUID(), {}, await reviewedCommand(f.runner)), /MANAGEMENT_PERMISSION_REQUIRED/);
  await assert.rejects(f.runner.releaseHold(await reviewedCommand(f.runner)), /MANAGEMENT_PERMISSION_REQUIRED/);
  await assert.rejects(f.manager.reviewInput(batch.batchId, batch.manifestSha256, { decision: 'approved', reason: 'manual' }, { commandId: randomUUID() }));
  assert.deepEqual(await f.manager.status(), before);
  await assert.rejects(f.runner.reserve(batch.batchId, 'item-1', batch.plan), /INPUT_REVIEW_REQUIRED/);
  await f.manager.reviewInput(batch.batchId, batch.manifestSha256, decision(false), { commandId: randomUUID() });
  await assert.rejects(f.runner.reserve(batch.batchId, 'item-1', batch.plan), /INPUT_REVIEW_REQUIRED/);
}));

test('review invalidation requires the issuing runner snapshot and a fixed reason; repeated stops do not write again', () => withLedger(async f => {
  const batch = await preparedCore(f.manager); const snapshot = await f.runner.reviewedBatch(batch.batchId);
  const peer = AuthorizationLedger.forRunner(f.db, new ArtifactCipher(artifactKey)); const before = await peer.status();
  await assert.rejects(f.manager.stopReviewedBatch(snapshot, 'BATCH_INPUT_CHANGED'), /AUTHORIZATION_INVALID_INSTANCE/);
  await assert.rejects(peer.stopReviewedBatch(snapshot, 'BATCH_INPUT_CHANGED'), /BATCH_REVIEW_SNAPSHOT_REQUIRED/);
  await assert.rejects(f.runner.stopReviewedBatch(structuredClone(snapshot), 'BATCH_INPUT_CHANGED'), /BATCH_REVIEW_SNAPSHOT_REQUIRED/);
  await assert.rejects(f.runner.stopReviewedBatch(snapshot, 'caller-error-with-sensitive-body'));
  await assert.rejects(f.runner.preflightAvailability(structuredClone(snapshot)), /BATCH_REVIEW_SNAPSHOT_REQUIRED/);
  assert.deepEqual(await peer.status(), before);
  const stopped = await f.runner.stopReviewedBatch(snapshot, 'BATCH_INPUT_CHANGED'); assert.equal(stopped.changed, true);
  const after = await peer.status(); assert.equal(after.batches[0]!.status, 'stopped');
  assert.equal((await f.runner.stopReviewedBatch(snapshot, 'BATCH_INPUT_CHANGED')).changed, false);
  assert.deepEqual(await peer.status(), after);
  await assert.rejects(peer.reviewedBatch(batch.batchId), /BATCH_NOT_RUNNABLE/);
}));

test('reservation review failures commit a stop before throwing and existing reservations are counted once by availability', () => withLedger(async f => {
  const batch = await preparedCore(f.manager, corePayload('fact_extraction', 1000, 3));
  const snapshot = await f.runner.reviewedBatch(batch.batchId);
  for (const item of batch.payload.items) await f.runner.reserve(batch.batchId, item.id, batch.plan);
  assert.equal((await f.runner.preflightAvailability(snapshot)).available, true);
  await assert.rejects(f.runner.reserve(batch.batchId, 'item-1', { ...batch.plan, estimatedMicros: 1001 }), /CAPABILITIES_CHANGED_REVIEW_REQUIRED/);
  const peer = AuthorizationLedger.forRunner(f.db, new ArtifactCipher(artifactKey));
  const after = await peer.status(); assert.equal(after.batches[0]!.status, 'stopped');
  assert.equal(after.modalities.text.reservedRequests, 3); assert.equal(after.modalities.text.consumedRequests, 0);
  await assert.rejects(peer.reserve(batch.batchId, 'item-1', batch.plan), /BATCH_NOT_RUNNABLE/);
  assert.equal((await f.db.query("SELECT sequence FROM evaluation_events WHERE type='batch.review_invalidated'")).rows.length, 1);
}));

test('cross-purpose text and image counts accumulate against one authorization without transfers', () => withLedger(async f => {
  for (const [purpose, quota] of Object.entries(PURPOSE_LIMITS) as [Purpose, number][]) {
    for (let index = 0; index < quota; index++) await consume(f.runner, await preparedCore(f.manager, corePayload(purpose)));
    const excess = await preparedCore(f.manager, corePayload(purpose));
    await assert.rejects(f.runner.reserve(excess.batchId, 'item-1', excess.plan), /AUTHORIZATION_QUOTA_EXCEEDED/);
  }
  const status = await f.runner.status(); assert.equal(status.modalities.text.consumedRequests, 12);
  assert.equal(status.modalities.image.consumedRequests, 2); assert.equal(status.modalities.text.remainingRequests, 0);
  assert.equal(status.modalities.image.remainingRequests, 0);
}));

test('integer microdollars reserve upwards and batch-local observed spend cannot reset on next request', () => withLedger(async f => {
  assert.equal(usdToMicros(0.1 + 0.2), 300001); assert.equal(usdToMicros(0.0000001), 1);
  const batch = await prepared(f.manager, { config: { ...authorizedConfig, maxRequests: 2 }, fixtures: [humanFixture, humanFixture] });
  await consume(f.runner, batch, 'item-1', goodResponse(authorizedConfig.modelId, 0.09));
  await assert.rejects(f.runner.reserve(batch.batchId, 'item-2', batch.plan), /REMAINING_BUDGET_INSUFFICIENT/);
  assert.equal((await f.runner.status()).modalities.text.consumedRequests, 1);
}));

test('global estimate reservations span batches and only undispatched explicit cancellation releases them', () => withLedger(async f => {
  const batch = await preparedCore(f.manager, corePayload('fact_extraction', 250000, 3));
  const attempts = [];
  for (const item of batch.payload.items) attempts.push(await f.runner.reserve(batch.batchId, item.id, batch.plan));
  const other = await preparedCore(f.manager, corePayload('formal_story', 1));
  await assert.rejects(f.runner.reserve(other.batchId, 'item-1', other.plan), /AUTHORIZATION_ESTIMATE_EXCEEDED/);
  await f.manager.cancelReservation(attempts[0]!.id, await reviewedCommand(f.manager));
  assert.equal((await f.runner.reserve(other.batchId, 'item-1', other.plan)).state, 'reserved');
}));

test('any unresolved dispatch holds every entry even with stale timestamp and a ready authorization row', () => withLedger(async f => {
  const batch = await preparedCore(f.manager, corePayload('fact_extraction', 1, 2));
  const first = await f.runner.reserve(batch.batchId, 'item-1', batch.plan);
  const second = await f.runner.reserve(batch.batchId, 'item-2', batch.plan);
  const priorRelease = await reviewedCommand(f.manager); await f.manager.releaseHold(priorRelease);
  const owner = randomUUID(); assert.equal((await f.runner.beginDispatch(first.id, owner)).claimed, true);
  assert.equal((await f.runner.beginDispatch(first.id, owner)).claimed, false);
  await f.db.query("UPDATE evaluation_attempts SET unknown_usage=false,started_at=now()-interval '90 days' WHERE id=$1", [first.id]);
  assert.equal((await f.runner.status()).declaredStatus, 'ready'); assert.equal((await f.runner.status()).effectiveHold, true);
  assert.equal((await f.runner.status()).modalities.text.observedTotalUsd, null);
  assert.equal((await f.runner.status()).modalities.text.unknownUsageAttempts, 1);
  await assert.rejects(f.runner.reserve(batch.batchId, 'item-2', batch.plan), /AUTHORIZATION_EFFECTIVE_HOLD/);
  await assert.rejects(f.runner.beginDispatch(second.id, randomUUID()), /AUTHORIZATION_EFFECTIVE_HOLD/);
  await assert.rejects(f.manager.releaseHold(priorRelease), /AUTHORIZATION_EFFECTIVE_HOLD/);
  await assert.rejects(f.manager.cancelReservation(first.id, await reviewedCommand(f.manager)), /CANNOT_CANCEL_DISPATCHED/);
}));

test('known-cost rule failure persistently stops a batch including previously reserved items', () => withLedger(async f => {
  const batch = await preparedCore(f.manager, corePayload('fact_extraction', 1000, 2));
  const first = await f.runner.reserve(batch.batchId, 'item-1', batch.plan);
  const second = await f.runner.reserve(batch.batchId, 'item-2', batch.plan); const owner = randomUUID();
  await f.runner.beginDispatch(first.id, owner); await f.runner.recordCapture(first.id, owner, capture(goodResponse()));
  await f.runner.finish(first.id, owner, { automaticChecksPassed: false, evaluation: {} }, { commandId: randomUUID() });
  const peer = AuthorizationLedger.forRunner(f.db, new ArtifactCipher(artifactKey));
  assert.equal((await peer.status()).status, 'ready');
  await assert.rejects(peer.beginDispatch(second.id, randomUUID()), /BATCH_NOT_RUNNABLE/);
  await assert.rejects(peer.reserve(batch.batchId, 'item-2', batch.plan), /BATCH_NOT_RUNNABLE/);
}));

test('raw capture is scrubbed, encrypted and cryptographically bound to metadata and source hash', () => withLedger(async f => {
  const secret = 'TEST_CURRENT_KEY_SECRET'; f.runner.protectSecrets([secret]); f.manager.protectSecrets([secret]);
  const batch = await preparedCore(f.manager); const attempt = await f.runner.reserve(batch.batchId, 'item-1', batch.plan);
  const owner = randomUUID(); await f.runner.beginDispatch(attempt.id, owner);
  const raw = capture({ ...goodResponse(), note: secret, headers: { Authorization: `Bearer ${secret}` } });
  const artifactId = await f.runner.recordCapture(attempt.id, owner, raw);
  const rows = await f.db.query('SELECT * FROM evaluation_artifacts WHERE id=$1', [artifactId]);
  assert.ok(!JSON.stringify(rows.rows).includes(secret)); assert.ok(!JSON.stringify(rows.rows).includes('synthetic-gen-request'));
  const stored = await f.manager.readArtifactForReview(artifactId); assert.equal(stored.redacted, true);
  assert.equal(stored.originalSha256, sha256(raw.bytes)); assert.ok(stored.bytes.toString().includes('[REDACTED]'));
  assert.ok(!stored.bytes.toString().includes(secret));
  await f.db.query("UPDATE evaluation_artifacts SET metadata=jsonb_set(metadata,'{httpStatus}','500') WHERE id=$1", [artifactId]);
  await assert.rejects(f.manager.readArtifactForReview(artifactId), /ARTIFACT_INTEGRITY_FAILED/);
}));

test('finish is atomic after durable capture and replay cannot reconsume a request', () => withLedger(async f => {
  let inject = true;
  const failingDb = { ...f.db, transaction: <T>(action: Parameters<typeof f.db.transaction<T>>[0]) => f.db.transaction(tx => action({
    query: async (sql, params) => { if (inject && sql.startsWith('INSERT INTO evaluation_command_receipts')) { inject = false; throw new Error('injected'); }
      return tx.query(sql, params); } })) };
  const runner = AuthorizationLedger.forRunner(failingDb, new ArtifactCipher(artifactKey));
  const batch = await preparedCore(f.manager); const attempt = await runner.reserve(batch.batchId, 'item-1', batch.plan); const owner = randomUUID();
  await runner.beginDispatch(attempt.id, owner); await runner.recordCapture(attempt.id, owner, capture(goodResponse()));
  const command = { commandId: randomUUID() }; const analysis = { automaticChecksPassed: true, evaluation: { synthetic: true } };
  await assert.rejects(runner.finish(attempt.id, owner, analysis, command), /LEDGER_PERSISTENCE_ERROR/);
  const interrupted = await f.manager.inspectAttempt(attempt.id); assert.equal(interrupted.attempt.state, 'dispatch_started');
  assert.equal(interrupted.attempt.parsedArtifactId, null); assert.ok(interrupted.capture);
  const complete = await runner.finish(attempt.id, owner, analysis, command);
  assert.deepEqual(await runner.finish(attempt.id, owner, analysis, command), complete);
  assert.equal((await runner.beginDispatch(attempt.id, owner)).claimed, false);
  assert.equal((await runner.status()).modalities.text.consumedRequests, 1);
  assert.equal((await runner.status()).modalities.text.knownObservedUsd, 0.001);
  await assert.rejects(runner.finish(attempt.id, owner, { ...analysis, automaticChecksPassed: false }, command), /IDEMPOTENCY_CONFLICT/);
}));

test('unknown usage requires concrete receipt reconciliation and separate release; zero does not refund dispatch', () => withLedger(async f => {
  const batch = await preparedCore(f.manager); const attempt = await f.runner.reserve(batch.batchId, 'item-1', batch.plan); const owner = randomUUID();
  await f.runner.beginDispatch(attempt.id, owner);
  await f.runner.recordCapture(attempt.id, owner, { state: 'unavailable', bytes: Buffer.alloc(0), httpStatus: null, latencyMs: 1, errorCode: 'REQUEST_TIMEOUT' });
  await f.runner.finish(attempt.id, owner, undefined, { commandId: randomUUID() });
  const before = await f.runner.status(); assert.equal(before.modalities.text.observedTotalUsd, null);
  await assert.rejects(f.manager.reconcile(attempt.id, { providerRecord: {} }, await reviewedCommand(f.manager)));
  const receipt = { id: 'manual-provider-record', model: batch.payload.config.modelId, provider: 'Synthetic', prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  const proof = { requestSha256: batch.manifest.items[0]!.requestSha256, decisionReference: 'synthetic://manual/provider-proof',
    providerReceipt: receipt, providerReceiptSha256: objectSha256(receipt) };
  await assert.rejects(f.manager.reconcile(attempt.id, { ...proof, requestSha256: '0'.repeat(64) }, await reviewedCommand(f.manager)), /RECONCILIATION_PROOF_MISMATCH/);
  await f.manager.reconcile(attempt.id, proof, await reviewedCommand(f.manager));
  const reconciled = await f.runner.status(); assert.equal(reconciled.status, 'held'); assert.equal(reconciled.modalities.text.observedTotalUsd, 0);
  assert.equal(reconciled.modalities.text.consumedRequests, 1); assert.equal(reconciled.modalities.text.estimatedCommittedUsd, 0.001);
  await f.manager.releaseHold(await reviewedCommand(f.manager)); assert.equal((await f.runner.status()).status, 'ready');
}));

test('captured response can be explicitly recovered without dispatch and exports require management identity', () => withLedger(async f => {
  const batch = await preparedCore(f.manager); const attempt = await f.runner.reserve(batch.batchId, 'item-1', batch.plan); const owner = randomUUID();
  await f.runner.beginDispatch(attempt.id, owner); const id = await f.runner.recordCapture(attempt.id, owner, capture(goodResponse()));
  const saved = await f.manager.inspectAttempt(attempt.id);
  await f.manager.recoverCapture(attempt.id, saved.capture!.sourceSha256, { automaticChecksPassed: true, evaluation: {} }, await reviewedCommand(f.manager));
  assert.equal((await f.runner.status()).modalities.text.consumedRequests, 1);
  assert.equal((await f.runner.beginDispatch(attempt.id, randomUUID())).claimed, false);
  await assert.rejects(f.runner.readArtifactForReview(id), /MANAGEMENT_PERMISSION_REQUIRED/);
  const directory = await mkdtemp(join(tmpdir(), 'tujiang-evaluation-export-'));
  try { const exported = await exportArtifact(f.manager, id, directory);
    assert.equal(sha256(await readFile(join(directory, exported.files[0]!))), exported.contentSha256);
    await assert.rejects(exportArtifact(f.manager, id, directory), /EEXIST/);
  } finally { await rm(directory, { recursive: true }); }
}));
