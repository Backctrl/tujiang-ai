import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Database, Connection } from '../src/database.js';
import { ArtifactCipher } from '../evaluation/authorization-artifacts.js';
import { AUTHORIZATION_POLICY, canonical, objectSha256, type BatchPayload, type Purpose } from '../evaluation/authorization-contract.js';
import { migrateAuthorizationLedger } from '../evaluation/authorization-database.js';
import { capabilityPlan, prepareExtractionBatch } from '../evaluation/authorization-input.js';
import { AuthorizationLedger, type ReservationPlan, type ReviewedCommand } from '../evaluation/authorization-ledger.js';

export const artifactKey = Buffer.alloc(32, 17).toString('base64');
export const reviewerKey = Buffer.alloc(32, 23).toString('base64');
const read = (name: string) => JSON.parse(readFileSync(new URL(`../evaluation/fixtures/${name}.json`, import.meta.url), 'utf8'));
export const syntheticFixture = read('synthetic-extraction');
// Synthetic protocol tests only: this label never constitutes a real input-review decision.
export const humanFixture = { ...syntheticFixture, provenance: 'human-curated' };
export const syntheticOutput = read('synthetic-extraction-output');
export const authorizedConfig = { ...read('synthetic-run').config, modelId: AUTHORIZATION_POLICY.text.modelId,
  provider: AUTHORIZATION_POLICY.text.provider, acceptEstimatedBudget: true };
export const authorizedCapabilities = (() => {
  const caps = read('synthetic-endpoints'); caps.data.id = authorizedConfig.modelId;
  caps.data.endpoints[0].model_id = authorizedConfig.modelId; caps.data.endpoints[0].tag = authorizedConfig.provider;
  return caps;
})();
export function managementLedger(db: Database, cipher = new ArtifactCipher(artifactKey)) {
  const keys = ['TUJIANG_EVALUATION_REVIEWER_ID', 'TUJIANG_EVALUATION_REVIEWER_CREDENTIAL'] as const;
  const prior = keys.map(key => process.env[key]);
  process.env.TUJIANG_EVALUATION_REVIEWER_ID = 'synthetic-review-operator';
  process.env.TUJIANG_EVALUATION_REVIEWER_CREDENTIAL = reviewerKey;
  try { return AuthorizationLedger.forManagement(db, cipher); }
  finally { keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; }); }
}
export async function embeddedLedger() {
  const engine = new PGlite();
  const wrap = (client: Pick<PGlite, 'query'>): Connection => ({ async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
    return { rows: (await client.query<T>(sql, params)).rows }; } });
  const db: Database = { ...wrap(engine), transaction: action => engine.transaction(tx => action(wrap(tx))), close: () => engine.close() };
  await migrateAuthorizationLedger(db);
  const manager = managementLedger(db); const runner = AuthorizationLedger.forRunner(db, new ArtifactCipher(artifactKey));
  await manager.initialize(); return { db, manager, runner, close: () => db.close() };
}
export async function withLedger<T>(action: (context: Awaited<ReturnType<typeof embeddedLedger>>) => Promise<T>): Promise<T> {
  const context = await embeddedLedger(); try { return await action(context); } finally { await context.close(); }
}
export const decision = (approved = true) => ({ decision: approved ? 'approved' as const : 'rejected' as const,
  reason: 'Synthetic independent input review fixture', decisionReference: 'synthetic://external-human-decision/fixture',
  decisionReceiptSha256: objectSha256({ syntheticOnly: true, approved }) });
export async function approve(manager: AuthorizationLedger, batchId: string, manifestSha256: string) {
  return manager.reviewInput(batchId, manifestSha256, decision(), { commandId: randomUUID() });
}
export async function prepared(manager: AuthorizationLedger, options: { config?: typeof authorizedConfig; fixtures?: unknown[]; review?: boolean } = {}) {
  const config = options.config ?? authorizedConfig; const fixtures = options.fixtures ?? [humanFixture];
  const sources = [{ id: 'source-1', name: 'synthetic-input.json', bytesBase64: Buffer.from(canonical({ config, fixtures })).toString('base64') }];
  const payload = prepareExtractionBatch(config, fixtures, authorizedCapabilities, sources); const batchId = randomUUID();
  const batch = await manager.createBatch(batchId, payload);
  if (options.review !== false) await approve(manager, batchId, batch.manifestSha256);
  return { ...batch, config, fixtures, payload, sources, plan: capabilityPlan(authorizedCapabilities, config) };
}
export function corePayload(purpose: Purpose = 'fact_extraction', estimatedMicros = 1000, items = 1): BatchPayload {
  const modality = purpose === 'representative_image' ? 'image' : 'text'; const limit = AUTHORIZATION_POLICY[modality];
  return { purpose, adapter: { id: 'synthetic-protocol-only', version: '1' },
    config: { modelId: limit.modelId, provider: limit.provider, maxRequests: items, maxInputTokens: limit.maxInputTokens,
      maxOutputTokens: limit.maxOutputTokens, maxCostUsd: limit.maxEstimatedMicros / 1_000_000, timeoutMs: 1000, acceptEstimatedBudget: true },
    sources: [{ id: 'source-1', name: 'synthetic.txt', bytesBase64: Buffer.from('synthetic input').toString('base64') }],
    items: Array.from({ length: items }, (_, i) => ({ id: `item-${i + 1}`, input: { synthetic: true }, expected: { synthetic: true },
      requestBody: canonical({ synthetic: true, index: i, purpose }) })), upstreamReviewIds: [],
    reviewedCapabilitySha256: objectSha256({ syntheticOnly: true }), reviewedEstimatedMicros: estimatedMicros, reviewedProviderName: 'Synthetic' };
}
export const corePlan = (payload: BatchPayload): ReservationPlan => ({ capabilities: { syntheticOnly: true },
  capabilityFingerprint: payload.reviewedCapabilitySha256, estimatedMicros: payload.reviewedEstimatedMicros, providerName: payload.reviewedProviderName });
export async function preparedCore(manager: AuthorizationLedger, payload = corePayload()) {
  const batch = await manager.createBatch(randomUUID(), payload); await approve(manager, batch.batchId, batch.manifestSha256);
  return { ...batch, payload, plan: corePlan(payload) };
}
export const goodResponse = (model = authorizedConfig.modelId, cost = 0.001) => ({ id: 'synthetic-gen-request', model, provider: 'Synthetic',
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(syntheticOutput) } }],
  usage: { prompt_tokens: 100, completion_tokens: 100, cost } });
export const capture = (response: unknown) => ({ state: 'complete' as const, httpStatus: 200, bytes: Buffer.from(JSON.stringify(response)), latencyMs: 1, errorCode: null });
export async function consume(runner: AuthorizationLedger, batch: Awaited<ReturnType<typeof preparedCore>>, itemId = 'item-1', response = goodResponse(batch.payload.config.modelId), pass = true) {
  const reserved = await runner.reserve(batch.batchId, itemId, batch.plan); const owner = randomUUID();
  await runner.beginDispatch(reserved.id, owner); await runner.recordCapture(reserved.id, owner, capture(response));
  return runner.finish(reserved.id, owner, { automaticChecksPassed: pass, evaluation: { syntheticOnly: true } }, { commandId: randomUUID() });
}
export async function reviewedCommand(ledger: AuthorizationLedger, reason = 'Synthetic manual recovery decision'): Promise<ReviewedCommand> {
  return { commandId: randomUUID(), expectedRevision: (await ledger.status()).revision, reason };
}
