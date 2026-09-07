import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactCipher, type ArtifactBinding } from '../evaluation/authorization-artifacts.js';
import { exportArtifact } from '../evaluation/authorization-cli.js';
import { AUTHORIZATION_ID, objectSha256, sha256 } from '../evaluation/authorization-contract.js';
import { AuthorizationLedger } from '../evaluation/authorization-ledger.js';
import { artifactKey, capture, corePayload, goodResponse, preparedCore, withLedger } from './authorization-helpers.js';

async function withSecretEnvironment<T>(action: (secrets: string[]) => Promise<T>) {
  const password = `synthetic-db-password-/?@-${randomUUID()}`;
  const username = `credential-user-${randomUUID()}`;
  const url = `postgresql://${username}:${encodeURIComponent(password)}@127.0.0.1:1/no-network`;
  const values = {
    OPENROUTER_API_KEY: `synthetic-runtime-key-${randomUUID()}`,
    TUJIANG_EVALUATION_ARTIFACT_KEY: artifactKey,
    TUJIANG_EVALUATION_REVIEWER_CREDENTIAL: Buffer.alloc(32, 25).toString('base64'),
    TUJIANG_EVALUATION_REVIEWER_ID: 'synthetic-secret-review-operator',
    TUJIANG_EVALUATION_DATABASE_URL: url,
    AWS_SECRET_ACCESS_KEY: `aws-synthetic-credential+/${randomUUID()}`,
    PRIVATE_KEY: `-----BEGIN SYNTHETIC PRIVATE KEY-----\n${Buffer.from(randomUUID()).toString('base64')}\n-----END SYNTHETIC PRIVATE KEY-----`,
    SECRET_KEY: Buffer.from(`synthetic-other-credential-${randomUUID()}`).toString('base64'),
    OTHER_DATABASE_URL: `postgresql://postgres:${encodeURIComponent(`other-database-secret+/${randomUUID()}`)}@127.0.0.1:1/no-network`,
  };
  const prior = Object.keys(values).map(name => process.env[name]);
  Object.assign(process.env, values);
  try {
    const otherPassword = new URL(values.OTHER_DATABASE_URL).password;
    const known = [values.OPENROUTER_API_KEY, artifactKey, values.TUJIANG_EVALUATION_REVIEWER_CREDENTIAL,
      url, new URL(url).password, password, values.AWS_SECRET_ACCESS_KEY, values.PRIVATE_KEY, values.SECRET_KEY,
      values.OTHER_DATABASE_URL, otherPassword, decodeURIComponent(otherPassword)];
    return await action([...new Set(known.flatMap(value => [value, Buffer.from(value).toString('base64'),
      Buffer.from(value).toString('hex'), encodeURIComponent(value)]))]);
  }
  finally {
    Object.keys(values).forEach((name, index) => {
      if (prior[index] === undefined) delete process.env[name]; else process.env[name] = prior[index];
    });
  }
}

test('artifact cipher always protects its own textual and raw encryption key without changing unrelated binary bytes', () => {
  const cipher = new ArtifactCipher(artifactKey); const rawKey = Buffer.from(artifactKey, 'base64');
  const binding: ArtifactBinding = { authorizationId: AUTHORIZATION_ID, artifactId: randomUUID(), batchId: null, attemptId: null,
    kind: 'synthetic', sourceSha256: objectSha256({}), metadataSha256: objectSha256({}) };
  for (const secret of [Buffer.from(artifactKey), Buffer.from(rawKey.toString('hex')), rawKey]) {
    const bytes = Buffer.concat([Buffer.from('before:'), secret, Buffer.from(':after')]);
    const sealed = cipher.seal(bytes, binding); assert.equal(sealed.redacted, true);
    assert.equal(cipher.open(sealed, binding).toString(), 'before:[REDACTED]:after');
    assert.equal(sealed.originalSha256, sha256(bytes));
  }
  const binary = Buffer.from([0xff, 0x00, 0xfe, 0x80, 0x01]); const sealed = cipher.seal(binary, binding);
  assert.equal(sealed.redacted, false); assert.deepEqual(cipher.open(sealed, binding), binary);
});

test('fresh management rejects every known environment secret and runner scrubs them before artifact storage with zero network', t => withLedger(async f => {
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', () => { networkCalls++; throw new Error('synthetic network forbidden'); });
  await withSecretEnvironment(async secrets => {
    const manager = AuthorizationLedger.forManagement(f.db, new ArtifactCipher(artifactKey));
    const runner = AuthorizationLedger.forRunner(f.db, new ArtifactCipher(artifactKey));
    const before = await manager.status();
    for (const secret of secrets) {
      const payload = corePayload(); payload.sources[0]!.bytesBase64 = Buffer.from(`source:${secret}`).toString('base64');
      await assert.rejects(manager.createBatch(randomUUID(), payload), /SENSITIVE_INPUT_DETECTED/);
    }
    assert.deepEqual(await manager.status(), before);
    assert.equal((await f.db.query('SELECT id FROM evaluation_artifacts')).rows.length, 0);
    const ordinary = corePayload(); ordinary.sources[0]!.bytesBase64 = Buffer.from('PostgreSQL uses postgres as a common role name.').toString('base64');
    assert.equal((await manager.createBatch(randomUUID(), ordinary)).status, 'awaiting_input_review');
    const batch = await preparedCore(manager); const attempt = await runner.reserve(batch.batchId, 'item-1', batch.plan);
    const owner = randomUUID(); await runner.beginDispatch(attempt.id, owner);
    const raw = capture({ ...goodResponse(), echoes: secrets }); const artifactId = await runner.recordCapture(attempt.id, owner, raw);
    const stored = await f.db.query<{ sealed: { redacted: boolean } }>('SELECT sealed FROM evaluation_artifacts WHERE id=$1', [artifactId]);
    assert.equal(stored.rows[0]!.sealed.redacted, true);
    const freshManager = AuthorizationLedger.forManagement(f.db, new ArtifactCipher(artifactKey));
    const directory = await mkdtemp(join(await realpath(tmpdir()), 'tujiang-evaluation-secret-export-'));
    try {
      const exported = await exportArtifact(freshManager, artifactId, directory);
      const bytes = await readFile(join(directory, exported.files[0]!));
      const metadata = JSON.parse(await readFile(join(directory, exported.files[1]!), 'utf8'));
      for (const secret of secrets) assert.equal(bytes.includes(Buffer.from(secret)), false);
      assert.equal(exported.redacted, true); assert.equal(metadata.redacted, true);
      assert.equal(metadata.originalSha256, sha256(raw.bytes)); assert.ok(bytes.toString().includes('[REDACTED]'));
    } finally { await rm(directory, { recursive: true }); }
  });
  assert.equal(networkCalls, 0);
}));

test('fresh management redacts an older captured artifact and marks the changed export truthfully without a network call', t => withLedger(async f => {
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', () => { networkCalls++; throw new Error('synthetic network forbidden'); });
  const batch = await preparedCore(f.manager); const attempt = await f.runner.reserve(batch.batchId, 'item-1', batch.plan);
  const owner = randomUUID(); await f.runner.beginDispatch(attempt.id, owner);
  await withSecretEnvironment(async secrets => {
    // This existing writer predates the newly configured runtime credential.
    const raw = capture({ ...goodResponse(), echo: secrets[0] });
    const artifactId = await f.runner.recordCapture(attempt.id, owner, raw);
    const stored = await f.db.query<{ sealed: { redacted: boolean } }>('SELECT sealed FROM evaluation_artifacts WHERE id=$1', [artifactId]);
    assert.equal(stored.rows[0]!.sealed.redacted, false);
    const freshManager = AuthorizationLedger.forManagement(f.db, new ArtifactCipher(artifactKey));
    const directory = await mkdtemp(join(await realpath(tmpdir()), 'tujiang-evaluation-current-secret-'));
    try {
      const exported = await exportArtifact(freshManager, artifactId, directory);
      const bytes = await readFile(join(directory, exported.files[0]!));
      const metadata = JSON.parse(await readFile(join(directory, exported.files[1]!), 'utf8'));
      assert.equal(bytes.includes(Buffer.from(secrets[0]!)), false); assert.ok(bytes.toString().includes('[REDACTED]'));
      assert.equal(exported.redacted, true); assert.equal(metadata.redacted, true);
      assert.equal(metadata.originalSha256, sha256(raw.bytes)); assert.equal(metadata.contentSha256, sha256(bytes));
      const events = await f.db.query<{ body: { contentSha256: string; redacted: boolean } }>(
        "SELECT body FROM evaluation_events WHERE type='artifact.read_for_review' ORDER BY sequence DESC LIMIT 1");
      assert.equal(events.rows[0]!.body.contentSha256, sha256(bytes)); assert.equal(events.rows[0]!.body.redacted, true);
    } finally { await rm(directory, { recursive: true }); }
  });
  assert.equal(networkCalls, 0);
}));
