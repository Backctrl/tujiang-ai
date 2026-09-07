import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, symlink, unlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, toNamespacedPath } from 'node:path';
import { executeManagement, exportArtifact, runManagementCli } from '../evaluation/authorization-cli.js';
import { POLICY_SHA256, sha256 } from '../evaluation/authorization-contract.js';
import { readRunInputs } from '../evaluation/authorization-input.js';
import { runEvaluation } from '../evaluation/runner.js';
import { authorizedCapabilities, authorizedConfig, decision, humanFixture, preparedCore, withLedger } from './authorization-helpers.js';

test('management CLI policy is read-only and malformed initialization never opens a database', async () => {
  const policy = await runManagementCli(['policy']); assert.equal(policy.exitCode, 0);
  assert.equal((policy.report as any).policySha256, POLICY_SHA256);
  const wrong = await runManagementCli(['initialize', '0'.repeat(64)]);
  assert.equal(wrong.exitCode, 2); assert.equal((wrong.report as any).code, 'AUTHORIZATION_POLICY_CONFLICT');
});

test('management CLI prepares exact raw files and only explicit independent decision can enable the batch', () => withLedger(async f => {
  const directory = await mkdtemp(join(tmpdir(), 'tujiang-evaluation-cli-'));
  try {
    const runPath = join(directory, 'run.json'); const fixturePath = join(directory, 'fixture.json');
    const decisionPath = join(directory, 'decision.json');
    await writeFile(fixturePath, JSON.stringify(humanFixture));
    await writeFile(join(directory, 'capabilities.json'), JSON.stringify(authorizedCapabilities));
    await writeFile(runPath, JSON.stringify({ config: authorizedConfig, fixtures: ['fixture.json'], capabilitiesFile: 'capabilities.json' }));
    const batchId = randomUUID();
    const batch = await executeManagement(['prepare', runPath, batchId], f.manager) as { manifestSha256: string; status: string };
    assert.equal(batch.status, 'awaiting_input_review'); assert.equal((await f.runner.status()).attempts.length, 0);
    const materials = await f.manager.listArtifacts(batchId);
    for (const kind of ['source', 'input', 'expected', 'request', 'batch-input']) assert.ok(materials.some(material => material.kind === kind));
    let accesses = 0; const trap = () => { accesses++; throw new Error('network forbidden'); };
    const inputs = await readRunInputs(runPath);
    const options = { live: true, authorization: { ledger: f.runner, batchId, sources: inputs.sources },
      environmentEnabled: () => true, getApiKey: trap, request: trap };
    assert.equal((await runEvaluation(inputs.config, inputs.fixtures, options)).code, 'INPUT_REVIEW_REQUIRED');
    const command = { ...decision(), batchId, manifestSha256: batch.manifestSha256, commandId: randomUUID() };
    await writeFile(decisionPath, JSON.stringify({ ...command, actor: 'caller-self-approval' }));
    await assert.rejects(executeManagement(['review-input', decisionPath], f.manager));
    await writeFile(decisionPath, JSON.stringify(command));
    await assert.rejects(executeManagement(['review-input', decisionPath], f.runner), /MANAGEMENT_PERMISSION_REQUIRED/);
    assert.equal((await f.db.query('SELECT * FROM evaluation_input_reviews')).rows.length, 0);
    const receipt = await executeManagement(['review-input', decisionPath], f.manager);
    assert.deepEqual(await executeManagement(['review-input', decisionPath], f.manager), receipt);
    const reviews = await f.db.query<{ reviewer: string; decision_receipt_sha256: string }>('SELECT reviewer,decision_receipt_sha256 FROM evaluation_input_reviews');
    assert.equal(reviews.rows.length, 1); assert.equal(reviews.rows[0]!.reviewer, 'synthetic-review-operator');
    assert.equal(reviews.rows[0]!.decision_receipt_sha256, command.decisionReceiptSha256);
    // Parsed JSON stays the same; changing original file bytes still invalidates the approved manifest.
    await writeFile(fixturePath, JSON.stringify(humanFixture, null, 2)); const edited = await readRunInputs(runPath);
    const changed = await runEvaluation(edited.config, edited.fixtures, { ...options, authorization: { ...options.authorization, sources: edited.sources } });
    assert.equal(changed.code, 'BATCH_INPUT_CHANGED'); assert.equal(accesses, 0);
  } finally { await rm(directory, { recursive: true }); }
}));

test('artifact export accepts native Windows path normalization and writes the verified bytes', () => withLedger(async f => {
  const batch = await preparedCore(f.manager); const artifactId = await f.manager.inputArtifactId(batch.batchId);
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'tujiang-evaluation-native-path-'));
  try {
    const nativePath = toNamespacedPath(directory);
    const exported = await exportArtifact(f.manager, artifactId, nativePath);
    const bytes = await readFile(join(directory, exported.files[0]!));
    assert.equal(sha256(bytes), exported.contentSha256); assert.equal(bytes.length, exported.byteLength);
    const metadata = JSON.parse(await readFile(join(directory, exported.files[1]!), 'utf8'));
    assert.equal(metadata.contentSha256, exported.contentSha256);
  } finally { await rm(directory, { recursive: true }); }
}));

test('artifact export rejects existing and missing paths through a real parent junction before creating files', () => withLedger(async f => {
  const batch = await preparedCore(f.manager); const artifactId = await f.manager.inputArtifactId(batch.batchId);
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'tujiang-evaluation-directory-link-'));
  const target = join(directory, 'physical'); const link = join(directory, 'linked'); let linked = false;
  try {
    await mkdir(target); await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir'); linked = true;
    for (const destination of [link, join(link, 'uncreated', 'review')]) {
      await assert.rejects(exportArtifact(f.manager, artifactId, destination), /REVIEW_DIRECTORY_REDIRECTED/);
      assert.deepEqual(await readdir(target), []);
    }
  } finally {
    // Remove the owned link itself before recursively cleaning its owned temporary parent.
    if (linked) await unlink(link);
    await rm(directory, { recursive: true });
  }
}));
