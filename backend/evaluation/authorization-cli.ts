import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { RunnerError } from '../src/model-policy.js';
import { AUTHORIZATION_POLICY, POLICY_SHA256, commandIdSchema, digestSchema, fail, inputDecisionSchema, reasonSchema,
  reconciliationProofSchema, sha256 } from './authorization-contract.js';
import { migrateAuthorizationLedger } from './authorization-database.js';
import { openEvaluationLedger } from './authorization-environment.js';
import { analyzeItem, assertExtractionAdapter, prepareExtractionBatch, readRunInputs } from './authorization-input.js';
import type { AuthorizationLedger } from './authorization-ledger.js';
import { inspectCapturedResponse } from './authorization-observation.js';

const uuid = z.string().uuid();
const reviewed = z.object({ commandId: commandIdSchema, expectedRevision: z.number().int().positive(), reason: reasonSchema });
const decisionCommand = inputDecisionSchema.extend({ batchId: uuid, manifestSha256: digestSchema, commandId: commandIdSchema }).strict();
const recoverCommand = reviewed.extend({ attemptId: uuid, captureSha256: digestSchema }).strict();
const reconcileCommand = reviewed.extend({ attemptId: uuid, proof: reconciliationProofSchema }).strict();
const cancelCommand = reviewed.extend({ attemptId: uuid }).strict();
const readJson = async (path: string) => {
  const bytes = await readFile(resolve(path)); if (bytes.length > 2_000_000) fail('INVALID_MANAGEMENT_INPUT');
  return JSON.parse(bytes.toString('utf8')) as unknown;
};
const reviewDirectory = fileURLToPath(new URL('../.data/evaluation-review/', import.meta.url));

export async function exportArtifact(ledger: AuthorizationLedger, artifactId: string, directory = reviewDirectory) {
  uuid.parse(artifactId);
  const artifact = await ledger.readArtifactForReview(artifactId);
  const absolute = resolve(directory); await mkdir(absolute, { recursive: true, mode: 0o700 });
  // Reject a junction/symlink redirect; export only to the explicitly controlled local directory.
  const actual = await realpath(absolute);
  if (actual.toLowerCase() !== absolute.toLowerCase()) fail('REVIEW_DIRECTORY_REDIRECTED');
  const { bytes, ...metadata } = artifact;
  await writeFile(join(absolute, `${artifactId}.bin`), bytes, { flag: 'wx', mode: 0o600 });
  await writeFile(join(absolute, `${artifactId}.metadata.json`), JSON.stringify(metadata, null, 2), { flag: 'wx', mode: 0o600 });
  return { artifactId, contentSha256: sha256(bytes), byteLength: bytes.length, redacted: artifact.redacted,
    files: [`${artifactId}.bin`, `${artifactId}.metadata.json`] };
}

// Deliberately separate module and command grammar from runner-cli; no management command performs HTTP.
export async function executeManagement(args: string[], ledger: AuthorizationLedger): Promise<unknown> {
  const [command, value, second] = args;
  if (command === 'status' && args.length === 1) return ledger.status();
  if (command === 'list-artifacts' && args.length <= 2) return ledger.listArtifacts(value);
  if (command === 'initialize' && args.length === 2 && value === POLICY_SHA256) return ledger.initialize(AUTHORIZATION_POLICY, value);
  if (command === 'prepare' && args.length === 3) {
    const inputs = await readRunInputs(value!); uuid.parse(second);
    return ledger.createBatch(second!, prepareExtractionBatch(inputs.config, inputs.fixtures, inputs.capabilities, inputs.sources));
  }
  if (args.length !== 2) fail('INVALID_MANAGEMENT_INPUT');
  if (command === 'export-input') return exportArtifact(ledger, await ledger.inputArtifactId(uuid.parse(value)));
  if (command === 'export-artifact') return exportArtifact(ledger, uuid.parse(value));
  const body = await readJson(value!);
  if (command === 'review-input') {
    const { batchId, manifestSha256, commandId, ...decision } = decisionCommand.parse(body);
    return ledger.reviewInput(batchId, manifestSha256, decision, { commandId });
  }
  if (command === 'cancel-reservation') {
    const { attemptId, ...commandInput } = cancelCommand.parse(body); return ledger.cancelReservation(attemptId, commandInput);
  }
  if (command === 'reconcile') {
    const { attemptId, proof, ...commandInput } = reconcileCommand.parse(body); return ledger.reconcile(attemptId, proof, commandInput);
  }
  if (command === 'release-hold') return ledger.releaseHold(reviewed.strict().parse(body));
  if (command === 'recover-capture') {
    const { attemptId, captureSha256, ...commandInput } = recoverCommand.parse(body);
    const saved = await ledger.inspectAttempt(attemptId); if (!saved.capture) fail('RESPONSE_UNAVAILABLE');
    const inspected = inspectCapturedResponse(saved.capture.bytes, saved.capture.metadata,
      { modelId: saved.payload.config.modelId, providerName: saved.payload.reviewedProviderName,
        maxInputTokens: saved.payload.config.maxInputTokens, maxOutputTokens: saved.payload.config.maxOutputTokens });
    if (!inspected.protocolCode) assertExtractionAdapter(saved.payload);
    const item = saved.payload.items.find(item => item.id === saved.attempt.itemId); if (!item) fail('BATCH_ITEM_NOT_FOUND');
    return ledger.recoverCapture(attemptId, captureSha256,
      inspected.protocolCode ? undefined : analyzeItem(item, inspected.parsedOutput), commandInput);
  }
  return fail('INVALID_MANAGEMENT_INPUT');
}
export async function runManagementCli(args: string[]) {
  let connection: ReturnType<typeof openEvaluationLedger> | undefined;
  try {
    if (args[0] === 'policy' && args.length === 1) return { exitCode: 0, report: { policy: AUTHORIZATION_POLICY, policySha256: POLICY_SHA256 } };
    if (args[0] === 'initialize' && (args.length !== 2 || args[1] !== POLICY_SHA256)) fail('AUTHORIZATION_POLICY_CONFLICT');
    connection = openEvaluationLedger(args[0] === 'status' ? 'status' : 'management');
    // Explicit initialization is the only command allowed to create tables; never run on live/status.
    if (args[0] === 'initialize') await migrateAuthorizationLedger(connection.db);
    return { exitCode: 0, report: await executeManagement(args, connection.ledger) };
  } catch (error) {
    return { exitCode: 2, report: { status: 'blocked', code: error instanceof RunnerError ? error.code : 'INVALID_MANAGEMENT_INPUT', businessAcceptance: false } };
  } finally { await connection?.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runManagementCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`); process.exitCode = result.exitCode;
}
