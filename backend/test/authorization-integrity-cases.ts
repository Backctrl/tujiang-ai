import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '../src/database.js';
import { ArtifactCipher, type SealedArtifact } from '../evaluation/authorization-artifacts.js';
import { exportArtifact } from '../evaluation/authorization-cli.js';
import { AUTHORIZATION_ID, canonical, objectSha256, sha256 } from '../evaluation/authorization-contract.js';
import { AuthorizationLedger } from '../evaluation/authorization-ledger.js';
import { runEvaluation } from '../evaluation/runner.js';
import { artifactKey, capture, corePayload, decision, goodResponse, managementLedger, prepared, preparedCore, reviewedCommand } from './authorization-helpers.js';

interface Context {
  db: Database; runner: AuthorizationLedger; manager: AuthorizationLedger;
  verifyRestart?: (batchId: string) => Promise<void>;
}
const analysis = { automaticChecksPassed: true, evaluation: { syntheticIntegrity: true } };
const integrity = /ARTIFACT_INTEGRITY_FAILED/;
const foreignKey = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === '23503';
async function captured(f: Context, batch: Awaited<ReturnType<typeof preparedCore>>, itemId: string, extra = {}) {
  const attempt = await f.runner.reserve(batch.batchId, itemId, batch.plan); const owner = randomUUID();
  await f.runner.beginDispatch(attempt.id, owner); const response = capture({ ...goodResponse(), ...extra });
  const artifactId = await f.runner.recordCapture(attempt.id, owner, response);
  return { attemptId: attempt.id, owner, response, artifactId, command: { commandId: randomUUID() } };
}
async function artifactRow(db: Database, id: string) {
  return (await db.query<{ sealed: SealedArtifact; metadata: Record<string, unknown>; source_sha256: string }>(
    'SELECT sealed,metadata,source_sha256 FROM evaluation_artifacts WHERE id=$1', [id])).rows[0]!;
}
async function persistedStop(f: Context, batch: Awaited<ReturnType<typeof prepared>>, expected: string, restore: () => Promise<void>) {
  let keys = 0; let network = 0;
  const invoke = (ledger: AuthorizationLedger) => runEvaluation(batch.config, batch.fixtures, {
    live: true, environmentEnabled: () => true, getApiKey: () => { keys++; return 'synthetic-integrity-key'; },
    request: async () => { network++; throw new Error('synthetic network forbidden'); },
    authorization: { ledger, batchId: batch.batchId, sources: batch.sources },
  });
  const failed = await invoke(f.runner);
  assert.equal(failed.code, expected); assert.equal(failed.metadataRequests, 0); assert.equal(failed.requestsAttempted, 0);
  const state = (await f.db.query<{ status: string }>('SELECT status FROM evaluation_batches WHERE id=$1', [batch.batchId])).rows[0]!;
  assert.equal(state.status, 'stopped');
  const events = await f.db.query<{ body: { code: string } }>(
    "SELECT body FROM evaluation_events WHERE type='batch.review_invalidated' AND body->>'batchId'=$1", [batch.batchId]);
  assert.equal(events.rows.length, 1); assert.equal(events.rows[0]!.body.code, expected);
  await restore();
  const retry = await invoke(AuthorizationLedger.forRunner(f.db, new ArtifactCipher(artifactKey)));
  assert.equal(retry.code, 'BATCH_NOT_RUNNABLE'); assert.equal(keys, 0); assert.equal(network, 0);
  await f.verifyRestart?.(batch.batchId);
  assert.equal((await f.db.query("SELECT 1 FROM evaluation_events WHERE type='batch.review_invalidated' AND body->>'batchId'=$1", [batch.batchId])).rows.length, 1);
}

export const integrityCases: { name: string; run: (f: Context) => Promise<void> }[] = [
  { name: 'equivalent secret encodings reject inputs and scrub captures and exports without folding ordinary text case', run: async f => {
    const secret = `Synthetic-Codec-Secret-Łÿÿ🌱x-Case+/?-${randomUUID()}`;
    const raw = Buffer.from(secret); const base64 = raw.toString('base64'); const hex = raw.toString('hex');
    const percent = encodeURIComponent(secret);
    const jsonUnicode = (value: string, partial = false) => Array.from(value, (character, i) => partial && i % 2 === 0 ? character :
      character.split('').map(unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')).join('');
    const percentBytes = (value: string) => Array.from(Buffer.from(value), byte => `%${byte.toString(16).padStart(2, '0')}`).join('');
    const percentPartial = (value: string) => Array.from(value, (character, i) => i % 2 === 0 ? character : percentBytes(character)).join('');
    const jsonVariants = [jsonUnicode(secret), jsonUnicode(secret, true),
      jsonUnicode(secret).replace(/\\u[a-f0-9]{4}/g, value => `\\u${value.slice(2).toUpperCase()}`)];
    for (const value of jsonVariants) assert.equal(JSON.parse(`"${value}"`), secret);
    for (const value of [percentBytes(secret), percentPartial(secret)]) assert.equal(decodeURIComponent(value), secret);
    assert.match(base64, /=+$/); assert.notEqual(base64.replaceAll('+', '-').replaceAll('/', '_'), base64);
    const variants = [...new Set([secret, hex.toUpperCase(), Array.from(hex, (character, i) => i % 2 ? character.toUpperCase() : character).join(''),
      base64, base64.replace(/=+$/, ''), base64.replaceAll('+', '-').replaceAll('/', '_'), raw.toString('base64url'),
      percent.replace(/%[A-F0-9]{2}/g, value => value.toLowerCase()),
      percent.replace(/%[A-F0-9]{2}/g, value => `%${value[1]!.toLowerCase()}${value[2]}`),
      percentBytes(secret), percentPartial(secret), ...jsonVariants])];
    const partiallyEscapedBytes = Buffer.concat(Array.from(raw, (byte, i) => i % 2 ? Buffer.from([byte]) : Buffer.from(`%${byte.toString(16).padStart(2, '0')}`)));
    const variantBytes = [...variants.map(value => Buffer.from(value)), partiallyEscapedBytes];
    const nearMiss = `${secret.slice(0, -1)}${secret.endsWith('0') ? '1' : '0'}`;
    const ordinary = [secret.toLowerCase(), Buffer.from(secret.toLowerCase()).toString('hex'),
      Buffer.from(secret.toLowerCase()).toString('base64url'), encodeURIComponent(secret.toLowerCase()),
      jsonUnicode(secret.toLowerCase()), jsonUnicode(secret.toLowerCase(), true), percentBytes(secret.toLowerCase()), percentPartial(secret.toLowerCase()),
      nearMiss, jsonUnicode(nearMiss), jsonUnicode(nearMiss, true), percentBytes(nearMiss), percentPartial(nearMiss), 'Ordinary PostgreSQL postgres text'];
    const environmentName = 'TUJIANG_EVALUATION_CODEC_SECRET'; const prior = process.env[environmentName]; process.env[environmentName] = secret;
    const priorFetch = globalThis.fetch; let network = 0;
    globalThis.fetch = async () => { network++; throw new Error('synthetic network forbidden'); };
    try {
      const manager = managementLedger(f.db); const runner = AuthorizationLedger.forRunner(f.db, new ArtifactCipher(artifactKey));
      for (const variant of variantBytes) {
        const payload = corePayload(); payload.sources[0]!.bytesBase64 = Buffer.concat([Buffer.from('source:'), variant]).toString('base64');
        await assert.rejects(manager.createBatch(randomUUID(), payload), /SENSITIVE_INPUT_DETECTED/);
      }
      for (const registered of [hex.toUpperCase(), raw.toString('base64url')]) {
        process.env[environmentName] = registered;
        const encodedManager = managementLedger(f.db);
        const payload = corePayload(); payload.sources[0]!.bytesBase64 = Buffer.from(secret).toString('base64');
        await assert.rejects(encodedManager.createBatch(randomUUID(), payload), /SENSITIVE_INPUT_DETECTED/);
      }
      process.env[environmentName] = secret;
      assert.equal((await f.db.query('SELECT 1 FROM evaluation_artifacts')).rows.length, 0);
      const payload = corePayload(); payload.sources[0]!.bytesBase64 = Buffer.from(ordinary.join('\n')).toString('base64');
      const batch = await preparedCore(manager, payload);
      const attempt = await runner.reserve(batch.batchId, 'item-1', batch.plan); const owner = randomUUID();
      await runner.beginDispatch(attempt.id, owner);
      const unrelatedBytes = Buffer.from([0xff, 0x00, 0xfe, 0x80, 0x01]);
      const ordinaryCapture = capture({ ordinary }).bytes;
      const response = { ...capture(goodResponse()), bytes: Buffer.concat([
        ...variantBytes.flatMap(value => [value, Buffer.from('\n')]), Buffer.from(ordinary.join('\n')),
        Buffer.from('\n'), capture({ echoes: variants, ordinary }).bytes, ordinaryCapture, unrelatedBytes,
      ]) };
      const artifactId = await runner.recordCapture(attempt.id, owner, response);
      const reviewed = await managementLedger(f.db).readArtifactForReview(artifactId);
      for (const variant of variantBytes) assert.equal(reviewed.bytes.includes(variant), false);
      for (const variant of variants) assert.equal(reviewed.bytes.includes(Buffer.from(JSON.stringify(variant).slice(1, -1))), false);
      for (const value of ordinary) assert.equal(reviewed.bytes.includes(Buffer.from(value)), true);
      assert.equal(reviewed.bytes.includes(ordinaryCapture), true);
      assert.equal(reviewed.bytes.subarray(-unrelatedBytes.length).equals(unrelatedBytes), true);
      assert.equal(reviewed.redacted, true); assert.equal(reviewed.originalSha256, sha256(response.bytes));
      const directory = await mkdtemp(join(await realpath(tmpdir()), 'tujiang-codec-export-'));
      try {
        const exported = await exportArtifact(managementLedger(f.db), artifactId, directory);
        const bytes = await readFile(join(directory, exported.files[0]!));
        assert.deepEqual(bytes, reviewed.bytes); assert.equal(exported.redacted, true);
      } finally { await rm(directory, { recursive: true }); }
      assert.equal(network, 0);
    } finally {
      globalThis.fetch = priorFetch;
      if (prior === undefined) delete process.env[environmentName]; else process.env[environmentName] = prior;
    }
  } },
  { name: 'attempt reservations authenticate their exact batch, item, semantics and capability identity before quota reuse or dispatch', run: async f => {
    const a = await preparedCore(f.manager, corePayload('fact_extraction', 1000, 2));
    const b = await preparedCore(f.manager, corePayload('copy', 1000, 2));
    const attempt = await f.runner.reserve(a.batchId, 'item-1', a.plan);
    const other = await f.runner.reserve(b.batchId, 'item-2', b.plan);
    const original = (await f.db.query('SELECT * FROM evaluation_attempts WHERE id=$1', [attempt.id])).rows[0]!;
    const foreign = (await f.db.query('SELECT * FROM evaluation_attempts WHERE id=$1', [other.id])).rows[0]!;
    await assert.rejects(f.db.query('UPDATE evaluation_attempts SET batch_id=$2 WHERE id=$1', [attempt.id, b.batchId]), foreignKey);
    await assert.rejects(f.db.query('UPDATE evaluation_attempts SET capabilities_artifact_id=$2 WHERE id=$1', [attempt.id, foreign.capabilities_artifact_id]), foreignKey);
    const changes = [
      ['item_id', 'item-2'], ['purpose', 'copy'], ['modality', 'image'], ['request_sha256', 'a'.repeat(64)],
      ['plan_sha256', 'b'.repeat(64)], ['capabilities_sha256', 'c'.repeat(64)], ['expected_provider_name', 'Changed Provider'],
      ['estimated_micros', 0], ['capabilities_artifact_id', null],
    ] as const;
    for (const [column, value] of changes) {
      await f.db.query(`UPDATE evaluation_attempts SET ${column}=$2 WHERE id=$1`, [attempt.id, value]);
      await assert.rejects(f.manager.inspectAttempt(attempt.id), integrity);
      await assert.rejects(f.manager.status(), integrity);
      await f.db.query(`UPDATE evaluation_attempts SET ${column}=$2 WHERE id=$1`, [attempt.id, original[column]]);
    }
    const renamed = randomUUID();
    await f.db.transaction(async tx => {
      await tx.query('UPDATE evaluation_artifacts SET id=$2 WHERE id=$1', [original.capabilities_artifact_id, renamed]);
      await tx.query('UPDATE evaluation_attempts SET capabilities_artifact_id=$2 WHERE id=$1', [attempt.id, renamed]);
    });
    await assert.rejects(f.manager.inspectAttempt(attempt.id), integrity);
    await f.db.transaction(async tx => {
      await tx.query('UPDATE evaluation_artifacts SET id=$2 WHERE id=$1', [renamed, original.capabilities_artifact_id]);
      await tx.query('UPDATE evaluation_attempts SET capabilities_artifact_id=$2 WHERE id=$1', [attempt.id, original.capabilities_artifact_id]);
    });
    // Coordinated semantic changes still cannot alter the authenticated reservation metadata.
    const second = a.manifest.items[1]!;
    const secondPlan = objectSha256({ manifestSha256: a.manifestSha256, itemId: second.id,
      capabilityFingerprint: a.payload.reviewedCapabilitySha256, estimatedMicros: a.payload.reviewedEstimatedMicros, providerName: a.payload.reviewedProviderName });
    await f.db.query('UPDATE evaluation_attempts SET item_id=$2,request_sha256=$3,plan_sha256=$4 WHERE id=$1', [attempt.id, second.id, second.requestSha256, secondPlan]);
    await assert.rejects(f.manager.inspectAttempt(attempt.id), integrity);
    await f.db.query('UPDATE evaluation_attempts SET item_id=$2,request_sha256=$3,plan_sha256=$4 WHERE id=$1',
      [attempt.id, original.item_id, original.request_sha256, original.plan_sha256]);
    await f.db.query('ALTER TABLE evaluation_attempts DROP CONSTRAINT evaluation_attempt_capabilities_reference');
    await f.db.query('UPDATE evaluation_attempts SET batch_id=$2 WHERE id=$1', [attempt.id, b.batchId]);
    await assert.rejects(f.runner.beginDispatch(attempt.id, randomUUID()), integrity);
    await assert.rejects(f.runner.reserve(a.batchId, 'item-1', a.plan), /BATCH_NOT_RUNNABLE/);
    const attempts = await f.db.query<{ state: string; started_at: unknown }>('SELECT state,started_at FROM evaluation_attempts');
    assert.equal(attempts.rows.length, 2); assert.ok(attempts.rows.every(row => row.state === 'reserved' && row.started_at === null));
    const batches = await f.db.query<{ status: string }>('SELECT status FROM evaluation_batches');
    assert.ok(batches.rows.every(row => row.status === 'stopped'));
  } },
  { name: 'authenticated envelopes reject redaction, length, key, digest and legacy-format tampering on read, list and export', run: async f => {
    const batch = await preparedCore(f.manager); const secret = `synthetic-captured-secret-${randomUUID()}`;
    f.runner.protectSecrets([secret]); const saved = await captured(f, batch, 'item-1', { echo: secret });
    const original = await artifactRow(f.db, saved.artifactId);
    assert.equal(original.sealed.redacted, true);
    const reviewed = await f.manager.readArtifactForReview(saved.artifactId);
    assert.equal(reviewed.redacted, true); assert.equal(reviewed.originalSha256, sha256(saved.response.bytes));
    assert.equal(reviewed.bytes.includes(Buffer.from(secret)), false);
    const indexed = (await f.manager.listArtifacts(batch.batchId)).find(row => row.artifactId === saved.artifactId)!;
    assert.equal(indexed.redacted, true); assert.equal(indexed.byteLength, reviewed.bytes.length);
    assert.equal(indexed.contentSha256, sha256(reviewed.bytes));
    const directory = await mkdtemp(join(await realpath(tmpdir()), 'tujiang-integrity-export-'));
    try {
      for (const patch of [{ redacted: false }, { byteLength: original.sealed.byteLength + 1 }, { version: 'artifact.1' },
        { keyId: '0'.repeat(64) }, { originalSha256: original.sealed.contentSha256, redacted: false }, { contentSha256: '0'.repeat(64) }]) {
        await f.db.query('UPDATE evaluation_artifacts SET sealed=$2 WHERE id=$1', [saved.artifactId, JSON.stringify({ ...original.sealed, ...patch })]);
        await assert.rejects(f.manager.readArtifactForReview(saved.artifactId), integrity);
        await assert.rejects(f.manager.listArtifacts(batch.batchId), integrity);
        await assert.rejects(f.manager.inspectAttempt(saved.attemptId), integrity);
        await assert.rejects(exportArtifact(f.manager, saved.artifactId, directory), integrity);
        assert.deepEqual(await readdir(directory), []);
      }
    } finally {
      await f.db.query('UPDATE evaluation_artifacts SET sealed=$2 WHERE id=$1', [saved.artifactId, JSON.stringify(original.sealed)]);
      await rm(directory, { recursive: true });
    }
    assert.equal((await f.manager.readArtifactForReview(saved.artifactId)).redacted, true);
  } },
  { name: 'capture references reject valid artifacts from another attempt, batch or kind and restoring them cannot resume settlement', run: async f => {
    const batch = await preparedCore(f.manager, corePayload('fact_extraction', 1000, 2));
    const other = await preparedCore(f.manager, corePayload('copy'));
    const preflight = await f.runner.recordPreflightCapture(batch.batchId, capture({ syntheticMetadata: true }));
    const first = await captured(f, batch, 'item-1');
    await f.runner.finish(first.attemptId, first.owner, analysis, first.command);
    const outside = await captured(f, other, 'item-1');
    await f.runner.finish(outside.attemptId, outside.owner, analysis, outside.command);
    const current = await captured(f, batch, 'item-2');
    const inspected = await f.manager.inspectAttempt(current.attemptId); const recoveryCommand = await reviewedCommand(f.manager);
    await f.db.query("UPDATE evaluation_attempts SET purpose='copy' WHERE id=$1", [current.attemptId]);
    await assert.rejects(f.runner.recordCapture(current.attemptId, current.owner, current.response), integrity);
    await assert.rejects(f.runner.finish(current.attemptId, current.owner, analysis, current.command), integrity);
    await assert.rejects(f.manager.recoverCapture(current.attemptId, inspected.capture!.sourceSha256, analysis, recoveryCommand), integrity);
    await f.db.query("UPDATE evaluation_attempts SET purpose='fact_extraction' WHERE id=$1", [current.attemptId]);
    const request = (await f.manager.listArtifacts(batch.batchId)).find(row => row.kind === 'request')!.artifactId;
    const candidates = [first.artifactId, outside.artifactId, preflight, request];
    for (const id of candidates) await assert.rejects(f.db.query('UPDATE evaluation_attempts SET capture_artifact_id=$2 WHERE id=$1', [current.attemptId, id]), foreignKey);
    await assert.rejects(f.db.query('DELETE FROM evaluation_artifacts WHERE id=$1', [current.artifactId]), foreignKey);
    // The isolated test schema now represents a legacy database without the new reference constraint.
    await f.db.query('ALTER TABLE evaluation_attempts DROP CONSTRAINT evaluation_attempt_capture_reference');
    for (const id of [...candidates, randomUUID()]) {
      await f.db.query('UPDATE evaluation_attempts SET capture_artifact_id=$2 WHERE id=$1', [current.attemptId, id]);
      await assert.rejects(f.runner.recordCapture(current.attemptId, current.owner, current.response), integrity);
      await assert.rejects(f.runner.finish(current.attemptId, current.owner, analysis, current.command), integrity);
      await assert.rejects(f.manager.recoverCapture(current.attemptId, inspected.capture!.sourceSha256, analysis, recoveryCommand), integrity);
      await assert.rejects(f.manager.inspectAttempt(current.attemptId), integrity);
      await assert.rejects(f.manager.status(), integrity);
    }
    await f.db.query('UPDATE evaluation_attempts SET capture_artifact_id=$2 WHERE id=$1', [current.attemptId, current.artifactId]);
    await assert.rejects(f.runner.finish(current.attemptId, current.owner, analysis, current.command), /BATCH_NOT_RUNNABLE/);
    await assert.rejects(f.manager.recoverCapture(current.attemptId, inspected.capture!.sourceSha256, analysis, await reviewedCommand(f.manager)), /BATCH_NOT_RUNNABLE/);
    const state = await f.manager.status(); assert.equal(state.modalities.text.consumedRequests, 3);
    assert.equal(state.batches.find(row => row.id === batch.batchId)!.status, 'stopped');
    assert.equal(state.attempts.find(row => row.id === current.attemptId)!.state, 'dispatch_started');
  } },
  { name: 'parsed reference corruption invalidates completed results before cached finish and recovery replies', run: async f => {
    const batch = await preparedCore(f.manager, corePayload('fact_extraction', 1000, 2));
    const first = await captured(f, batch, 'item-1');
    const firstResult = await f.runner.finish(first.attemptId, first.owner, analysis, first.command);
    const current = await captured(f, batch, 'item-2'); const inspected = await f.manager.inspectAttempt(current.attemptId);
    const recoveryCommand = await reviewedCommand(f.manager);
    const recovered = await f.manager.recoverCapture(current.attemptId, inspected.capture!.sourceSha256, analysis, recoveryCommand);
    await assert.rejects(f.db.query('UPDATE evaluation_attempts SET parsed_artifact_id=$2 WHERE id=$1', [first.attemptId, recovered.parsedArtifactId]), foreignKey);
    await f.db.query('ALTER TABLE evaluation_attempts DROP CONSTRAINT evaluation_attempt_parsed_reference');
    for (const [target, swapped] of [[first, recovered.parsedArtifactId], [current, firstResult.parsedArtifactId]] as const) {
      await f.db.query('UPDATE evaluation_attempts SET parsed_artifact_id=$2 WHERE id=$1', [target.attemptId, swapped]);
      await assert.rejects(f.manager.status(), integrity);
      await assert.rejects(f.manager.inspectAttempt(target.attemptId), integrity);
      await assert.rejects(f.runner.beginDispatch(target.attemptId, target.owner), integrity);
      if (target === first) await assert.rejects(f.runner.finish(first.attemptId, first.owner, analysis, first.command), integrity);
      else await assert.rejects(f.manager.recoverCapture(current.attemptId, inspected.capture!.sourceSha256, analysis, recoveryCommand), integrity);
      const unverified = await AuthorizationLedger.forRunner(f.db, undefined).status();
      assert.equal(unverified.artifactVerification, 'key-unavailable');
      assert.ok(unverified.attempts.every(row => row.responseArtifactId === null && row.parsedArtifactId === null));
      await f.db.query('UPDATE evaluation_attempts SET parsed_artifact_id=$2 WHERE id=$1',
        [target.attemptId, target === first ? firstResult.parsedArtifactId : recovered.parsedArtifactId]);
    }
    assert.deepEqual(await f.runner.finish(first.attemptId, first.owner, analysis, first.command), firstResult);
    assert.deepEqual(await f.manager.recoverCapture(current.attemptId, inspected.capture!.sourceSha256, analysis, recoveryCommand), recovered);
    const state = await f.manager.status(); assert.equal(state.modalities.text.consumedRequests, 2); assert.equal(state.modalities.text.knownObservedUsd, 0.002);
    assert.equal(state.batches[0]!.status, 'stopped');
  } },
  { name: 'batch input references and artifact ID renaming cannot borrow authenticated content or reopen stopped inputs', run: async f => {
    const other = await prepared(f.manager); const foreignInput = await f.manager.inputArtifactId(other.batchId);
    const request = (await f.manager.listArtifacts(other.batchId)).find(row => row.kind === 'request')!.artifactId;
    const first = await prepared(f.manager); const firstId = await f.manager.inputArtifactId(first.batchId);
    for (const id of [foreignInput, request]) await assert.rejects(f.db.query('UPDATE evaluation_batches SET payload_artifact_id=$2 WHERE id=$1', [first.batchId, id]), foreignKey);
    await f.db.query('ALTER TABLE evaluation_batches DROP CONSTRAINT evaluation_batch_payload_reference');
    for (const id of [foreignInput, request, randomUUID()]) {
      const batch = id === foreignInput ? first : await prepared(f.manager); const original = id === foreignInput ? firstId : await f.manager.inputArtifactId(batch.batchId);
      await f.db.query('UPDATE evaluation_batches SET payload_artifact_id=$2 WHERE id=$1', [batch.batchId, id]);
      await assert.rejects(f.manager.inputArtifactId(batch.batchId), integrity);
      await assert.rejects(f.manager.createBatch(batch.batchId, batch.payload), integrity);
      await persistedStop(f, batch, 'ARTIFACT_INTEGRITY_FAILED', async () => {
        await f.db.query('UPDATE evaluation_batches SET payload_artifact_id=$2 WHERE id=$1', [batch.batchId, original]);
      });
    }
    const renamed = await prepared(f.manager); const oldId = await f.manager.inputArtifactId(renamed.batchId); const newId = randomUUID();
    await f.db.transaction(async tx => {
      await tx.query('UPDATE evaluation_artifacts SET id=$2 WHERE id=$1', [oldId, newId]);
      await tx.query('UPDATE evaluation_batches SET payload_artifact_id=$2 WHERE id=$1', [renamed.batchId, newId]);
    });
    await assert.rejects(f.manager.readArtifactForReview(newId), integrity);
    await assert.rejects(f.manager.listArtifacts(renamed.batchId), integrity);
    await persistedStop(f, renamed, 'ARTIFACT_INTEGRITY_FAILED', async () => {
      await f.db.transaction(async tx => {
        await tx.query('UPDATE evaluation_artifacts SET id=$2 WHERE id=$1', [newId, oldId]);
        await tx.query('UPDATE evaluation_batches SET payload_artifact_id=$2 WHERE id=$1', [renamed.batchId, oldId]);
      });
    });
  } },
  { name: 'deleted, swapped or inconsistent approved review records commit one stop before returning and cannot be reapproved', run: async f => {
    const donor = await prepared(f.manager);
    const donorReview = (await f.db.query<{ decision_artifact_id: string }>('SELECT decision_artifact_id FROM evaluation_input_reviews WHERE batch_id=$1', [donor.batchId])).rows[0]!;
    const first = await prepared(f.manager);
    await assert.rejects(f.db.query('UPDATE evaluation_input_reviews SET decision_artifact_id=$2 WHERE batch_id=$1', [first.batchId, donorReview.decision_artifact_id]), foreignKey);
    const firstReview = (await f.db.query<{ decision_artifact_id: string }>('SELECT decision_artifact_id FROM evaluation_input_reviews WHERE batch_id=$1', [first.batchId])).rows[0]!;
    await assert.rejects(f.db.query('DELETE FROM evaluation_artifacts WHERE id=$1', [firstReview.decision_artifact_id]), foreignKey);
    await f.db.query('ALTER TABLE evaluation_input_reviews DROP CONSTRAINT evaluation_input_review_reference');
    const mutations = [
      { column: 'decision_artifact_id', value: donorReview.decision_artifact_id },
      { column: 'decision_artifact_id', value: randomUUID() },
      { column: 'decision', value: 'rejected' },
      { column: 'decision_receipt_sha256', value: 'a'.repeat(64) },
      { column: 'reason_sha256', value: 'b'.repeat(64) },
      { column: 'reviewer', value: 'changed-review-identity' },
    ];
    for (const [index, mutation] of mutations.entries()) {
      const batch = index === 0 ? first : await prepared(f.manager);
      const row = (await f.db.query('SELECT * FROM evaluation_input_reviews WHERE batch_id=$1', [batch.batchId])).rows[0]!;
      await f.db.query(`UPDATE evaluation_input_reviews SET ${mutation.column}=$2 WHERE batch_id=$1`, [batch.batchId, mutation.value]);
      await persistedStop(f, batch, 'ARTIFACT_INTEGRITY_FAILED', async () => {
        await f.db.query(`UPDATE evaluation_input_reviews SET ${mutation.column}=$2 WHERE batch_id=$1`, [batch.batchId, row[mutation.column]]);
      });
    }
    const deleted = await prepared(f.manager); const snapshot = await f.runner.reviewedBatch(deleted.batchId);
    await f.db.query('DELETE FROM evaluation_input_reviews WHERE batch_id=$1', [deleted.batchId]);
    await assert.rejects(f.runner.preflightAvailability(snapshot), integrity);
    assert.equal((await f.db.query<{ status: string }>('SELECT status FROM evaluation_batches WHERE id=$1', [deleted.batchId])).rows[0]!.status, 'stopped');
    assert.equal((await f.runner.stopReviewedBatch(snapshot, 'ARTIFACT_INTEGRITY_FAILED')).changed, false);
    await assert.rejects(f.manager.reviewInput(deleted.batchId, deleted.manifestSha256, decision(), { commandId: randomUUID() }), /INPUT_REVIEW_ALREADY_RECORDED/);
    await f.verifyRestart?.(deleted.batchId);
    const deletedBeforeRead = await prepared(f.manager);
    await f.db.query('DELETE FROM evaluation_input_reviews WHERE batch_id=$1', [deletedBeforeRead.batchId]);
    await persistedStop(f, deletedBeforeRead, 'ARTIFACT_INTEGRITY_FAILED', async () => {});
    for (const approved of [false, true]) {
      const unreviewed = await prepared(f.manager, { review: false });
      if (!approved) await f.manager.reviewInput(unreviewed.batchId, unreviewed.manifestSha256, decision(false), { commandId: randomUUID() });
      await assert.rejects(f.runner.reviewedBatch(unreviewed.batchId), /INPUT_REVIEW_REQUIRED/);
      const state = (await f.db.query<{ status: string }>('SELECT status FROM evaluation_batches WHERE id=$1', [unreviewed.batchId])).rows[0]!;
      assert.equal(state.status, approved ? 'awaiting_input_review' : 'rejected');
    }
  } },
  { name: 'authenticated invalid stored payloads are normalized to a fixed input error and permanently stopped', run: async f => {
    const batch = await prepared(f.manager); const artifactId = await f.manager.inputArtifactId(batch.batchId);
    const original = await artifactRow(f.db, artifactId);
    const sealed = new ArtifactCipher(artifactKey).seal(Buffer.from(canonical({ syntheticallyInvalid: true })), {
      authorizationId: AUTHORIZATION_ID, artifactId, batchId: batch.batchId, attemptId: null, kind: 'batch-input',
      sourceSha256: original.source_sha256, metadataSha256: objectSha256(original.metadata),
    });
    await f.db.query('UPDATE evaluation_artifacts SET sealed=$2 WHERE id=$1', [artifactId, JSON.stringify(sealed)]);
    await persistedStop(f, batch, 'BATCH_INPUT_CHANGED', async () => {
      await f.db.query('UPDATE evaluation_artifacts SET sealed=$2 WHERE id=$1', [artifactId, JSON.stringify(original.sealed)]);
    });
  } },
  { name: 'every source, input, expected and request part must remain authenticated and present before a reviewed batch can run', run: async f => {
    for (const kind of ['source', 'input', 'expected', 'request']) {
      const batch = await prepared(f.manager);
      const original = (await f.db.query('SELECT * FROM evaluation_artifacts WHERE batch_id=$1 AND kind=$2 LIMIT 1', [batch.batchId, kind])).rows[0]!;
      await f.db.query('DELETE FROM evaluation_artifacts WHERE id=$1', [original.id]);
      await assert.rejects(f.manager.inputArtifactId(batch.batchId), integrity);
      await persistedStop(f, batch, 'ARTIFACT_INTEGRITY_FAILED', async () => {
        const columns = ['id', 'authorization_id', 'batch_id', 'attempt_id', 'kind', 'sealed', 'source_sha256', 'metadata', 'created_by', 'created_at'];
        await f.db.query(`INSERT INTO evaluation_artifacts(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')})`,
          columns.map(column => ['sealed', 'metadata'].includes(column) ? JSON.stringify(original[column]) : original[column]));
      });
    }
  } },
  ...(['dispatch_started', 'finished'] as const).flatMap(stage => (['finish', 'recover', 'inspect', 'status'] as const).map(entry => ({
    name: `${entry} detects corrupted input review after ${stage}, commits stop before returning and preserves accounting`,
    run: async (f: Context) => {
      const batch = await preparedCore(f.manager); const saved = await captured(f, batch, 'item-1');
      const inspected = await f.manager.inspectAttempt(saved.attemptId); const recoveryCommand = await reviewedCommand(f.manager);
      let priorResult;
      if (stage === 'finished') priorResult = entry === 'recover'
        ? await f.manager.recoverCapture(saved.attemptId, inspected.capture!.sourceSha256, analysis, recoveryCommand)
        : await f.runner.finish(saved.attemptId, saved.owner, analysis, saved.command);
      const before = await f.manager.status();
      const review = (await f.db.query('SELECT * FROM evaluation_input_reviews WHERE batch_id=$1', [batch.batchId])).rows[0]!;
      let restore: () => Promise<void>;
      if (entry === 'finish') {
        await f.db.query('DELETE FROM evaluation_input_reviews WHERE batch_id=$1', [batch.batchId]);
        restore = async () => {
          const columns = ['id', 'batch_id', 'manifest_sha256', 'decision', 'reviewer', 'reviewer_credential_sha256', 'reason_sha256',
            'decision_reference_sha256', 'decision_receipt_sha256', 'decision_artifact_id', 'created_at'];
          await f.db.query(`INSERT INTO evaluation_input_reviews(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')})`,
            columns.map(column => review[column]));
        };
      } else if (entry === 'inspect') {
        const original = await artifactRow(f.db, review.decision_artifact_id as string);
        const ciphertext = Buffer.from(original.sealed.ciphertext, 'base64'); ciphertext[0] = ciphertext[0]! ^ 1;
        await f.db.query('UPDATE evaluation_artifacts SET sealed=$2 WHERE id=$1',
          [review.decision_artifact_id, JSON.stringify({ ...original.sealed, ciphertext: ciphertext.toString('base64') })]);
        restore = async () => { await f.db.query('UPDATE evaluation_artifacts SET sealed=$2 WHERE id=$1', [review.decision_artifact_id, JSON.stringify(original.sealed)]); };
      } else {
        const column = entry === 'recover' ? 'decision_receipt_sha256' : 'reviewer';
        await f.db.query(`UPDATE evaluation_input_reviews SET ${column}=$2 WHERE batch_id=$1`,
          [batch.batchId, entry === 'recover' ? 'd'.repeat(64) : 'changed-reviewer-after-dispatch']);
        restore = async () => { await f.db.query(`UPDATE evaluation_input_reviews SET ${column}=$2 WHERE batch_id=$1`, [batch.batchId, review[column]]); };
      }
      const unverified = await AuthorizationLedger.forRunner(f.db, undefined).status();
      assert.equal(unverified.artifactVerification, 'key-unavailable');
      assert.equal(unverified.batches[0]!.status, stage === 'finished' ? 'completed' : 'approved');
      const invoke = () => entry === 'finish' ? f.runner.finish(saved.attemptId, saved.owner, analysis, saved.command)
        : entry === 'recover' ? f.manager.recoverCapture(saved.attemptId, inspected.capture!.sourceSha256, analysis, recoveryCommand)
        : entry === 'inspect' ? f.manager.inspectAttempt(saved.attemptId) : f.manager.status();
      await assert.rejects(invoke(), integrity);
      assert.equal((await f.db.query<{ status: string }>('SELECT status FROM evaluation_batches WHERE id=$1', [batch.batchId])).rows[0]!.status, 'stopped');
      assert.equal((await f.db.query("SELECT 1 FROM evaluation_events WHERE type='batch.review_invalidated' AND body->>'batchId'=$1", [batch.batchId])).rows.length, 1);
      await restore();
      const after = await f.manager.status();
      assert.equal(after.batches[0]!.status, 'stopped'); assert.deepEqual(after.modalities, before.modalities);
      assert.equal(after.attempts[0]!.state, stage); assert.equal(after.revision, before.revision + 1);
      if (stage === 'dispatch_started') {
        await assert.rejects(f.runner.finish(saved.attemptId, saved.owner, analysis, saved.command), /BATCH_NOT_RUNNABLE/);
        await assert.rejects(f.manager.recoverCapture(saved.attemptId, inspected.capture!.sourceSha256, analysis, await reviewedCommand(f.manager)), /BATCH_NOT_RUNNABLE/);
      } else if (entry === 'finish' || entry === 'recover') {
        // An authenticated historical receipt remains readable; it cannot change stopped back to completed.
        assert.deepEqual(await invoke(), priorResult);
        assert.equal((await f.manager.status()).batches[0]!.status, 'stopped');
      }
      await assert.rejects(AuthorizationLedger.forRunner(f.db, new ArtifactCipher(artifactKey)).reviewedBatch(batch.batchId), /BATCH_NOT_RUNNABLE/);
      await f.verifyRestart?.(batch.batchId);
      assert.equal((await f.db.query("SELECT 1 FROM evaluation_events WHERE type='attempt.dispatch_started'")).rows.length, 1);
    },
  }))),
];
