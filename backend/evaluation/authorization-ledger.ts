import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Connection, Database } from '../src/database.js';
import { RunnerError } from '../src/model-policy.js';
import { ArtifactCipher, type ArtifactBinding, type SealedArtifact } from './authorization-artifacts.js';
import { AUTHORIZATION_ID, AUTHORIZATION_POLICY, POLICY_SHA256, PURPOSE_LIMITS, canonical, commandIdSchema, describeBatch,
  fail, inputDecisionSchema, microsToUsd, objectSha256, operatorSchema, reasonSchema, reconciliationProofSchema, sha256, usdToMicros,
  type BatchManifest, type BatchPayload, type Modality, type Observation, type Purpose } from './authorization-contract.js';
import { inspectCapturedResponse, validateCapturedMetadata, type CapturedMetadata } from './authorization-observation.js';
import type { ResponseCapture } from './authorization-transport.js';

type Row<T> = T & Record<string, unknown>;
type AuthorizationRow = Row<{ id: string; policy: unknown; policy_sha256: string; key_id: string;
  status: 'ready' | 'held' | 'closed'; revision: number; hold_reason: string | null }>;
type BatchRow = Row<{ id: string; manifest: BatchManifest; manifest_sha256: string; payload_artifact_id: string;
  status: 'awaiting_input_review' | 'approved' | 'rejected' | 'stopped' | 'completed' }>;
type AttemptRow = Row<{ id: string; batch_id: string; item_id: string; purpose: Purpose; modality: Modality;
  request_sha256: string; plan_sha256: string; capabilities_sha256: string; expected_provider_name: string;
  estimated_micros: string | number; state: 'reserved' | 'dispatch_started' | 'finished' | 'cancelled'; owner_sha256: string | null;
  observation: Observation | null; cost_micros: string | number | null; outcome: string | null; error_code: string | null;
  unknown_usage: boolean; started_at: unknown | null; finished_at: unknown | null; reconciled_at: unknown | null;
  capture_artifact_id: string | null; capture_latency_ms: number | null; parsed_artifact_id: string | null }>;
type ArtifactRow = Row<{ id: string; batch_id: string | null; attempt_id: string | null; kind: string;
  sealed: SealedArtifact; source_sha256: string; metadata: Record<string, unknown> }>;
export interface AttemptView {
  id: string; batchId: string; itemId: string; purpose: Purpose; modality: Modality;
  state: AttemptRow['state']; outcome: string | null; code: string | null; estimatedCostUsd: number;
  observation: Observation | null; unknownUsage: boolean; reconciled: boolean; latencyMs: number | null;
  responseArtifactId: string | null; parsedArtifactId: string | null;
}
export interface BudgetView {
  limitRequests: number; consumedRequests: number; reservedRequests: number; remainingRequests: number;
  estimatedCommittedUsd: number; estimatedReservedUsd: number; knownObservedUsd: number;
  observedTotalUsd: number | null; unknownUsageAttempts: number; maxEstimatedUsd: number;
}
export interface AuthorizationStatus {
  contractVersion: 'authorization-ledger.1'; authorizationId: string; policySha256: string; revision: number;
  status: 'ready' | 'held' | 'closed'; declaredStatus: AuthorizationRow['status']; effectiveHold: boolean; holdReason: string | null;
  budgetEnforcement: 'local-estimate-not-billing-cap'; modalities: Record<Modality, BudgetView>;
  purposes: Record<Purpose, { limit: number; consumed: number; reserved: number; remaining: number }>;
  batches: { id: string; purpose: Purpose; manifestSha256: string; status: BatchRow['status'] }[]; attempts: AttemptView[];
}
export interface ReservationPlan {
  // Built by the live adapter's verified preflight, never accepted from run.json or management CLI.
  capabilities: unknown; capabilityFingerprint: string; estimatedMicros: number; providerName: string;
}
export interface LocalAnalysis { automaticChecksPassed: boolean; evaluation: unknown }
export interface LedgerCommand { commandId: string }
export interface ReviewedCommand extends LedgerCommand { expectedRevision: number; reason: string }
const amount = (value: string | number | null) => value === null ? 0 : Number(value);
const unresolved = (a: AttemptRow) => a.state === 'dispatch_started' || a.unknown_usage && a.reconciled_at === null;
const activeHold = (attempts: AttemptRow[]) => attempts.some(unresolved);
const runnerInstances = new WeakSet<object>();
const constructionAuthority = Symbol('evaluation-ledger-construction');
export function assertRunnerLedger(value: unknown): void {
  if (!value || typeof value !== 'object' || !runnerInstances.has(value)) fail('AUTHORIZATION_INVALID_INSTANCE');
}
const view = (a: AttemptRow): AttemptView => ({ id: a.id, batchId: a.batch_id, itemId: a.item_id, purpose: a.purpose,
  modality: a.modality, state: a.state, outcome: a.outcome, code: a.error_code, estimatedCostUsd: microsToUsd(amount(a.estimated_micros)),
  observation: a.observation, unknownUsage: unresolved(a), reconciled: a.reconciled_at !== null, latencyMs: a.capture_latency_ms,
  responseArtifactId: a.capture_artifact_id, parsedArtifactId: a.parsed_artifact_id });

export class AuthorizationLedger {
  readonly #actor: string;
  readonly #reviewerCredentialSha256: string | null;
  get actor() { return this.#actor; }
  private constructor(private readonly db: Database, private readonly cipher: ArtifactCipher | undefined,
    actor: string, reviewerCredentialSha256: string | null, authority: symbol) {
    if (authority !== constructionAuthority) fail('AUTHORIZATION_INVALID_INSTANCE');
    this.#actor = operatorSchema.parse(actor); this.#reviewerCredentialSha256 = reviewerCredentialSha256;
  }
  static forRunner(db: Database, cipher: ArtifactCipher | undefined) {
    const ledger = new AuthorizationLedger(db, cipher, 'live-evaluation-runner', null, constructionAuthority);
    runnerInstances.add(ledger); Object.freeze(ledger); return ledger;
  }
  static forManagement(db: Database, cipher: ArtifactCipher | undefined) {
    const identity = process.env.TUJIANG_EVALUATION_REVIEWER_ID;
    const credential = process.env.TUJIANG_EVALUATION_REVIEWER_CREDENTIAL;
    if (!identity?.trim() || !credential || Buffer.from(credential, 'base64').length !== 32 ||
        Buffer.from(credential, 'base64').toString('base64') !== credential || sha256(Buffer.from(credential, 'base64')) === cipher?.keyId) {
      fail('MANAGEMENT_CREDENTIAL_NOT_CONFIGURED');
    }
    cipher?.protectSecrets([credential]);
    if (identity === credential || cipher?.redact(Buffer.from(identity)).redacted) fail('SENSITIVE_OPERATOR_ID');
    const ledger = new AuthorizationLedger(db, cipher, identity, sha256(credential), constructionAuthority); Object.freeze(ledger); return ledger;
  }
  private requireManagement() { if (!this.#reviewerCredentialSha256) fail('MANAGEMENT_PERMISSION_REQUIRED'); }
  protectSecrets(secrets: string[]) { this.requireCipher().protectSecrets(secrets); }
  private requireCipher() { if (!this.cipher) fail('ARTIFACT_KEY_NOT_CONFIGURED'); return this.cipher; }
  private assertKey(auth: AuthorizationRow) {
    if (this.requireCipher().keyId !== auth.key_id) fail('ARTIFACT_KEY_MISMATCH');
  }
  private async authorization(tx: Connection, lock = true): Promise<AuthorizationRow> {
    const result = await tx.query<AuthorizationRow>(`SELECT * FROM evaluation_authorizations WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [AUTHORIZATION_ID]);
    const auth = result.rows[0];
    if (!auth) fail('AUTHORIZATION_NOT_INITIALIZED');
    if (auth.policy_sha256 !== POLICY_SHA256 || objectSha256(auth.policy) !== POLICY_SHA256) fail('AUTHORIZATION_POLICY_CONFLICT');
    return auth;
  }
  private async locked<T>(action: (tx: Connection, auth: AuthorizationRow) => Promise<T>): Promise<T> {
    try { return await this.db.transaction(async tx => action(tx, await this.authorization(tx))); }
    catch (error) {
      if (error instanceof RunnerError || error instanceof z.ZodError) throw error;
      return fail('LEDGER_PERSISTENCE_ERROR');
    }
  }
  private async attempts(tx: Connection) {
    return (await tx.query<AttemptRow>('SELECT * FROM evaluation_attempts WHERE authorization_id=$1 ORDER BY created_at,id', [AUTHORIZATION_ID])).rows;
  }
  private assertReady(auth: AuthorizationRow, attempts: AttemptRow[]) {
    // Derived under the shared row lock. No lease, clock or status-only bypass.
    if (activeHold(attempts)) fail('AUTHORIZATION_EFFECTIVE_HOLD');
    if (auth.status !== 'ready') fail(auth.status === 'closed' ? 'AUTHORIZATION_CLOSED' : 'AUTHORIZATION_HELD');
  }
  private async batch(tx: Connection, id: string): Promise<BatchRow> {
    z.string().uuid().parse(id);
    const result = await tx.query<BatchRow>('SELECT * FROM evaluation_batches WHERE authorization_id=$1 AND id=$2', [AUTHORIZATION_ID, id]);
    if (!result.rows[0]) fail('BATCH_NOT_FOUND');
    return result.rows[0];
  }
  private async attempt(tx: Connection, id: string): Promise<AttemptRow> {
    z.string().uuid().parse(id);
    const result = await tx.query<AttemptRow>('SELECT * FROM evaluation_attempts WHERE authorization_id=$1 AND id=$2', [AUTHORIZATION_ID, id]);
    if (!result.rows[0]) fail('ATTEMPT_NOT_FOUND');
    return result.rows[0];
  }
  private async event(tx: Connection, type: string, body: unknown) {
    const last = await tx.query<Row<{ sequence: number; event_sha256: string }>>(
      'SELECT sequence,event_sha256 FROM evaluation_events WHERE authorization_id=$1 ORDER BY sequence DESC LIMIT 1', [AUTHORIZATION_ID]);
    const sequence = (last.rows[0]?.sequence ?? 0) + 1;
    const eventHash = objectSha256({ authorizationId: AUTHORIZATION_ID, sequence, type, body, actor: this.actor,
      previousSha256: last.rows[0]?.event_sha256 ?? null });
    await tx.query('INSERT INTO evaluation_events(authorization_id,sequence,type,body,actor,event_sha256) VALUES($1,$2,$3,$4,$5,$6)',
      [AUTHORIZATION_ID, sequence, type, JSON.stringify(body), this.actor, eventHash]);
    await tx.query('UPDATE evaluation_authorizations SET revision=revision+1 WHERE id=$1', [AUTHORIZATION_ID]);
  }
  private async receipt<T>(tx: Connection, command: LedgerCommand, fingerprintInput: unknown, action: () => Promise<T>): Promise<T> {
    commandIdSchema.parse(command.commandId);
    const fingerprint = objectSha256(fingerprintInput);
    const existing = await tx.query<Row<{ fingerprint: string; response: T }>>(
      'SELECT fingerprint,response FROM evaluation_command_receipts WHERE authorization_id=$1 AND command_id=$2', [AUTHORIZATION_ID, command.commandId]);
    if (existing.rows[0]) {
      if (existing.rows[0].fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT');
      return existing.rows[0].response;
    }
    const response = await action();
    await tx.query('INSERT INTO evaluation_command_receipts(authorization_id,command_id,fingerprint,response) VALUES($1,$2,$3,$4)',
      [AUTHORIZATION_ID, command.commandId, fingerprint, JSON.stringify(response)]);
    return response;
  }
  private checkRevision(auth: AuthorizationRow, command: ReviewedCommand) {
    z.number().int().positive().parse(command.expectedRevision); reasonSchema.parse(command.reason);
    if (auth.revision !== command.expectedRevision) fail('LEDGER_REVISION_CONFLICT');
  }
  private async storeArtifact(tx: Connection, auth: AuthorizationRow, binding: Omit<ArtifactBinding, 'authorizationId' | 'sourceSha256' | 'metadataSha256'>,
    bytes: Uint8Array, metadata: Record<string, unknown>, sourceSha256 = sha256(bytes)): Promise<string> {
    this.assertKey(auth);
    const prior = await tx.query<ArtifactRow>(`SELECT * FROM evaluation_artifacts WHERE authorization_id=$1
      AND batch_id IS NOT DISTINCT FROM $2::uuid AND attempt_id IS NOT DISTINCT FROM $3::uuid AND kind=$4 AND source_sha256=$5 AND metadata=$6::jsonb`,
    [AUTHORIZATION_ID, binding.batchId, binding.attemptId, binding.kind, sourceSha256, JSON.stringify(metadata)]);
    if (prior.rows[0]) return prior.rows[0].id;
    const id = randomUUID();
    const sealed = this.requireCipher().seal(bytes, { authorizationId: AUTHORIZATION_ID, ...binding,
      sourceSha256, metadataSha256: objectSha256(metadata) });
    await tx.query(`INSERT INTO evaluation_artifacts(id,authorization_id,batch_id,attempt_id,kind,sealed,source_sha256,metadata,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, AUTHORIZATION_ID, binding.batchId, binding.attemptId, binding.kind,
      JSON.stringify(sealed), sourceSha256, JSON.stringify(metadata), this.actor]);
    return id;
  }
  private async artifact(tx: Connection, auth: AuthorizationRow, id: string) {
    this.assertKey(auth);
    const result = await tx.query<ArtifactRow>('SELECT * FROM evaluation_artifacts WHERE authorization_id=$1 AND id=$2', [AUTHORIZATION_ID, id]);
    const row = result.rows[0]; if (!row) fail('ARTIFACT_NOT_FOUND');
    const bytes = this.requireCipher().open(row.sealed, { authorizationId: AUTHORIZATION_ID,
      batchId: row.batch_id, attemptId: row.attempt_id, kind: row.kind,
      sourceSha256: row.source_sha256, metadataSha256: objectSha256(row.metadata) });
    return { row, bytes };
  }
  private async payload(tx: Connection, auth: AuthorizationRow, batch: BatchRow): Promise<BatchPayload> {
    const artifact = await this.artifact(tx, auth, batch.payload_artifact_id);
    let raw: unknown;
    try { raw = JSON.parse(artifact.bytes.toString('utf8')); } catch { return fail('BATCH_INPUT_CHANGED'); }
    const described = describeBatch(batch.id, raw);
    if (described.payload.sources.some(s => this.requireCipher().redact(Buffer.from(s.bytesBase64, 'base64')).redacted)) fail('SENSITIVE_INPUT_DETECTED');
    if (described.manifestSha256 !== batch.manifest_sha256 || objectSha256(batch.manifest) !== batch.manifest_sha256) fail('BATCH_INPUT_CHANGED');
    return described.payload;
  }
  private async assertInputReview(tx: Connection, batch: BatchRow) {
    const rows = await tx.query<Row<{ id: string; manifest_sha256: string; decision: string; decision_receipt_sha256: string; decision_reference_sha256: string }>>(
      'SELECT * FROM evaluation_input_reviews WHERE batch_id=$1', [batch.id]);
    const review = rows.rows[0];
    if (!review || review.decision !== 'approved' || review.manifest_sha256 !== batch.manifest_sha256 ||
        !review.decision_receipt_sha256 || !review.decision_reference_sha256) fail('INPUT_REVIEW_REQUIRED');
  }
  private assertBatchRunnable(batch: BatchRow) { if (batch.status !== 'approved') fail('BATCH_NOT_RUNNABLE'); }

  async initialize(policy: unknown = AUTHORIZATION_POLICY, policySha256 = POLICY_SHA256) {
    this.requireManagement();
    // Only a management operation calls this. Live and status never create a grant.
    try {
      await this.db.transaction(async tx => {
        await tx.query('SELECT pg_advisory_xact_lock(730108)');
        const prior = await tx.query<AuthorizationRow>('SELECT * FROM evaluation_authorizations WHERE id=$1 FOR UPDATE', [AUTHORIZATION_ID]);
        if (objectSha256(policy) !== policySha256 || policySha256 !== POLICY_SHA256 ||
            canonical(policy) !== canonical(AUTHORIZATION_POLICY)) fail('AUTHORIZATION_POLICY_CONFLICT');
        if (prior.rows[0]) {
          if (prior.rows[0].policy_sha256 !== policySha256 || canonical(prior.rows[0].policy) !== canonical(policy)) fail('AUTHORIZATION_POLICY_CONFLICT');
          this.assertKey(prior.rows[0]); return;
        }
        await tx.query(`INSERT INTO evaluation_authorizations(id,policy,policy_sha256,key_id,status,created_by)
          VALUES($1,$2,$3,$4,'ready',$5)`, [AUTHORIZATION_ID, JSON.stringify(policy), policySha256, this.requireCipher().keyId, this.actor]);
        await this.event(tx, 'authorization.initialized', { policySha256, authorizationSource: AUTHORIZATION_POLICY.authorizationSource });
      });
      return await this.status();
    } catch (error) {
      if (error instanceof RunnerError || error instanceof z.ZodError) throw error;
      return fail('LEDGER_PERSISTENCE_ERROR');
    }
  }

  async createBatch(batchId: string, input: unknown) {
    this.requireManagement();
    const described = describeBatch(batchId, input);
    if (described.payload.sources.some(s => this.requireCipher().redact(Buffer.from(s.bytesBase64, 'base64')).redacted)) fail('SENSITIVE_INPUT_DETECTED');
    return this.locked(async (tx, auth) => {
      const prior = await tx.query<BatchRow>('SELECT * FROM evaluation_batches WHERE id=$1', [batchId]);
      if (prior.rows[0]) {
        if (prior.rows[0].manifest_sha256 !== described.manifestSha256) fail('BATCH_INPUT_CHANGED');
        return { batchId, manifest: prior.rows[0].manifest, manifestSha256: prior.rows[0].manifest_sha256, status: prior.rows[0].status };
      }
      const payloadArtifactId = await this.storeArtifact(tx, auth, { batchId, attemptId: null, kind: 'batch-input' },
        Buffer.from(canonical(described.payload)), {}, described.manifest.payloadSha256);
      // Credentials in an input invalidate its content binding instead of silently altering a reviewed request.
      const saved = await this.artifact(tx, auth, payloadArtifactId);
      if (saved.row.sealed.redacted) fail('SENSITIVE_INPUT_DETECTED');
      for (const source of described.payload.sources) {
        await this.storeArtifact(tx, auth, { batchId, attemptId: null, kind: 'source' }, Buffer.from(source.bytesBase64, 'base64'), { sourceId: source.id });
      }
      for (const item of described.payload.items) {
        for (const [kind, bytes] of [['input', Buffer.from(canonical(item.input))], ['expected', Buffer.from(canonical(item.expected))],
          ['request', Buffer.from(item.requestBody)]] as const) {
          await this.storeArtifact(tx, auth, { batchId, attemptId: null, kind }, bytes, { itemId: item.id });
        }
      }
      await tx.query(`INSERT INTO evaluation_batches(id,authorization_id,manifest,manifest_sha256,payload_artifact_id,status,created_by)
        VALUES($1,$2,$3,$4,$5,'awaiting_input_review',$6)`, [batchId, AUTHORIZATION_ID, JSON.stringify(described.manifest),
        described.manifestSha256, payloadArtifactId, this.actor]);
      await this.event(tx, 'batch.prepared', { batchId, manifestSha256: described.manifestSha256, payloadArtifactId });
      return { batchId, manifest: described.manifest, manifestSha256: described.manifestSha256, status: 'awaiting_input_review' as const };
    });
  }
  async reviewInput(batchId: string, manifestSha256: string, decisionInput: unknown, command: LedgerCommand) {
    this.requireManagement();
    const decision = inputDecisionSchema.parse(decisionInput);
    return this.locked(async (tx, auth) => this.receipt(tx, command, { type: 'input-review', batchId, manifestSha256, decision }, async () => {
      const batch = await this.batch(tx, batchId);
      if (batch.manifest_sha256 !== manifestSha256) fail('BATCH_INPUT_CHANGED');
      const prior = await tx.query('SELECT id FROM evaluation_input_reviews WHERE batch_id=$1', [batchId]);
      if (prior.rows.length) fail('INPUT_REVIEW_ALREADY_RECORDED');
      const id = randomUUID();
      const decisionArtifactId = await this.storeArtifact(tx, auth, { batchId, attemptId: null, kind: 'input-review-decision' },
        Buffer.from(canonical(decision)), {});
      await tx.query(`INSERT INTO evaluation_input_reviews(id,batch_id,manifest_sha256,decision,reviewer,reviewer_credential_sha256,reason_sha256,
        decision_reference_sha256,decision_receipt_sha256,decision_artifact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, batchId, manifestSha256, decision.decision, this.actor, this.#reviewerCredentialSha256, sha256(decision.reason), sha256(decision.decisionReference),
        decision.decisionReceiptSha256, decisionArtifactId]);
      await tx.query('UPDATE evaluation_batches SET status=$2 WHERE id=$1', [batchId, decision.decision]);
      await this.event(tx, 'batch.input_reviewed', { batchId, reviewId: id, manifestSha256, decision: decision.decision,
        decisionArtifactId, decisionReceiptSha256: decision.decisionReceiptSha256 });
      return { reviewId: id, batchId, manifestSha256, decision: decision.decision };
    }));
  }
  async reviewedBatch(batchId: string) {
    return this.locked(async (tx, auth) => {
      const batch = await this.batch(tx, batchId); await this.assertInputReview(tx, batch);
      return { manifest: batch.manifest, manifestSha256: batch.manifest_sha256, status: batch.status, payload: await this.payload(tx, auth, batch) };
    });
  }

  private checkBudget(attempts: AttemptRow[], batch: BatchRow, additionalMicros: number, additionalCount: number, localCapMicros: number) {
    const modality = batch.manifest.modality; const purpose = batch.manifest.purpose;
    const active = attempts.filter(a => a.modality === modality && a.state !== 'cancelled');
    const purposeAttempts = attempts.filter(a => a.purpose === purpose && a.state !== 'cancelled');
    const limit = AUTHORIZATION_POLICY[modality];
    if (active.length + additionalCount > limit.maxRequests || purposeAttempts.length + additionalCount > PURPOSE_LIMITS[purpose]) fail('AUTHORIZATION_QUOTA_EXCEEDED');
    const estimated = active.reduce((sum, a) => sum + amount(a.estimated_micros), 0);
    const observed = active.reduce((sum, a) => sum + amount(a.cost_micros), 0);
    const unsettled = active.filter(a => a.state === 'reserved' || a.state === 'dispatch_started').reduce((sum, a) => sum + amount(a.estimated_micros), 0);
    if (estimated + additionalMicros > limit.maxEstimatedMicros || observed + unsettled + additionalMicros > limit.maxEstimatedMicros) fail('AUTHORIZATION_ESTIMATE_EXCEEDED');
    const local = active.filter(a => a.batch_id === batch.id);
    const localEstimated = local.reduce((sum, a) => sum + amount(a.estimated_micros), 0);
    const localProjected = local.reduce((sum, a) => sum + amount(a.cost_micros) +
      (a.state === 'reserved' || a.state === 'dispatch_started' ? amount(a.estimated_micros) : 0), 0);
    if (localEstimated + additionalMicros > localCapMicros || localProjected + additionalMicros > localCapMicros) fail('REMAINING_BUDGET_INSUFFICIENT');
  }
  async reserve(batchId: string, itemId: string, plan: ReservationPlan): Promise<AttemptView> {
    return this.locked(async (tx, auth) => {
      const attempts = await this.attempts(tx); this.assertReady(auth, attempts);
      const batch = await this.batch(tx, batchId); await this.assertInputReview(tx, batch);
      this.assertBatchRunnable(batch);
      const payload = await this.payload(tx, auth, batch);
      const item = batch.manifest.items.find(i => i.id === itemId); if (!item) fail('BATCH_ITEM_NOT_FOUND');
      if (plan.capabilityFingerprint !== batch.manifest.reviewedCapabilitySha256 || plan.estimatedMicros !== batch.manifest.reviewedEstimatedMicros ||
          plan.providerName !== batch.manifest.reviewedProviderName) fail('CAPABILITIES_CHANGED_REVIEW_REQUIRED');
      const capabilitiesSha256 = objectSha256(plan.capabilities);
      const planSha256 = objectSha256({ manifestSha256: batch.manifest_sha256, itemId,
        capabilityFingerprint: plan.capabilityFingerprint, estimatedMicros: plan.estimatedMicros, providerName: plan.providerName });
      const existing = attempts.find(a => a.batch_id === batchId && a.item_id === itemId);
      if (existing) {
        if (existing.plan_sha256 !== planSha256) fail('RESERVATION_CONFLICT');
        return view(existing);
      }
      this.checkBudget(attempts, batch, plan.estimatedMicros, 1, usdToMicros(payload.config.maxCostUsd));
      const id = randomUUID();
      await this.storeArtifact(tx, auth, { batchId, attemptId: id, kind: 'capabilities' }, Buffer.from(canonical(plan.capabilities)), {}, capabilitiesSha256);
      await tx.query(`INSERT INTO evaluation_attempts(id,authorization_id,batch_id,item_id,purpose,modality,request_sha256,
        plan_sha256,capabilities_sha256,expected_provider_name,estimated_micros,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reserved')`,
      [id, AUTHORIZATION_ID, batchId, itemId, batch.manifest.purpose, batch.manifest.modality, item.requestSha256,
        planSha256, capabilitiesSha256, plan.providerName, plan.estimatedMicros]);
      await this.event(tx, 'attempt.reserved', { attemptId: id, batchId, itemId, planSha256, estimatedMicros: plan.estimatedMicros });
      return view(await this.attempt(tx, id));
    });
  }
  async beginDispatch(attemptId: string, ownerToken: string): Promise<{ claimed: boolean; attempt: AttemptView; code?: string }> {
    z.string().uuid().parse(ownerToken);
    return this.locked(async (tx, auth) => {
      const attempt = await this.attempt(tx, attemptId);
      const attempts = await this.attempts(tx);
      if (attempt.state !== 'reserved') return { claimed: false, attempt: view(attempt),
        ...(activeHold(attempts) ? { code: 'AUTHORIZATION_EFFECTIVE_HOLD' } : {}) };
      this.assertReady(auth, attempts);
      const batch = await this.batch(tx, attempt.batch_id); await this.assertInputReview(tx, batch); this.assertBatchRunnable(batch);
      const payload = await this.payload(tx, auth, batch);
      this.checkBudget(attempts, batch, 0, 0, usdToMicros(payload.config.maxCostUsd));
      await tx.query(`UPDATE evaluation_attempts SET state='dispatch_started',owner_sha256=$2,unknown_usage=true,started_at=now() WHERE id=$1`,
        [attemptId, sha256(ownerToken)]);
      await this.event(tx, 'attempt.dispatch_started', { attemptId, batchId: attempt.batch_id, requestSha256: attempt.request_sha256 });
      return { claimed: true, attempt: view(await this.attempt(tx, attemptId)) };
    });
  }

  async recordPreflightCapture(batchId: string, capture: ResponseCapture) {
    if (capture.bytes.byteLength > 2_000_000) fail('RESPONSE_TOO_LARGE');
    return this.locked(async (tx, auth) => {
      const batch = await this.batch(tx, batchId); await this.assertInputReview(tx, batch); this.assertBatchRunnable(batch);
      const metadata = validateCapturedMetadata({ state: capture.state, httpStatus: capture.httpStatus, latencyMs: capture.latencyMs,
        errorCode: capture.errorCode, bodySha256: capture.state === 'unavailable' ? null : sha256(capture.bytes) }, capture.bytes.byteLength);
      const artifactId = await this.storeArtifact(tx, auth, { batchId, attemptId: null, kind: 'preflight-response' }, capture.bytes,
        metadata as unknown as Record<string, unknown>, objectSha256(metadata));
      await this.event(tx, 'batch.preflight_captured', { batchId, artifactId });
      return artifactId;
    });
  }

  async recordCapture(attemptId: string, ownerToken: string, capture: ResponseCapture): Promise<string> {
    if (capture.bytes.byteLength > 2_000_000) fail('RESPONSE_TOO_LARGE');
    return this.locked(async (tx, auth) => {
      const attempt = await this.attempt(tx, attemptId);
      if (attempt.owner_sha256 !== sha256(ownerToken) || attempt.started_at === null) fail('DISPATCH_OWNER_MISMATCH');
      const metadata: CapturedMetadata = { state: capture.state, httpStatus: capture.httpStatus,
        latencyMs: capture.latencyMs, errorCode: capture.errorCode,
        bodySha256: capture.state === 'unavailable' ? null : sha256(capture.bytes) };
      validateCapturedMetadata(metadata, capture.bytes.byteLength);
      const sourceSha = objectSha256({ ...metadata, latencyMs: 0 });
      if (attempt.capture_artifact_id) {
        const prior = await this.artifact(tx, auth, attempt.capture_artifact_id);
        if (prior.row.source_sha256 !== sourceSha) fail('CAPTURE_CONFLICT');
        return prior.row.id;
      }
      const id = await this.storeArtifact(tx, auth, { batchId: attempt.batch_id, attemptId, kind: 'response' }, capture.bytes,
        metadata as unknown as Record<string, unknown>, sourceSha);
      await tx.query('UPDATE evaluation_attempts SET capture_artifact_id=$2,capture_latency_ms=$3 WHERE id=$1', [attemptId, id, capture.latencyMs]);
      await this.event(tx, 'attempt.response_captured', { attemptId, artifactId: id, captureSha256: sourceSha, state: capture.state });
      return id;
    });
  }
  private async settle(tx: Connection, auth: AuthorizationRow, attempt: AttemptRow, analysis: LocalAnalysis | undefined, recovered: boolean) {
    if (!attempt.capture_artifact_id) fail('RESPONSE_UNAVAILABLE');
    if (attempt.state !== 'dispatch_started') fail('ATTEMPT_ALREADY_FINISHED');
    const batch = await this.batch(tx, attempt.batch_id);
    const payload = await this.payload(tx, auth, batch);
    const captured = await this.artifact(tx, auth, attempt.capture_artifact_id);
    const inspected = inspectCapturedResponse(captured.bytes, captured.row.metadata as unknown as CapturedMetadata,
      { modelId: payload.config.modelId, providerName: attempt.expected_provider_name,
        maxInputTokens: payload.config.maxInputTokens, maxOutputTokens: payload.config.maxOutputTokens });
    let code = inspected.protocolCode;
    if (!code && !analysis) fail('LOCAL_ANALYSIS_REQUIRED');
    if (!code && !analysis?.automaticChecksPassed) code = 'EVALUATION_RULE_FAILED';
    const before = await this.attempts(tx);
    const others = before.filter(a => a.id !== attempt.id && a.state !== 'cancelled');
    const projected = (rows: AttemptRow[]) => rows.reduce((sum, a) => sum + amount(a.cost_micros) +
      (a.state === 'reserved' || a.state === 'dispatch_started' ? amount(a.estimated_micros) : 0), 0) + (inspected.costMicros ?? 0);
    if (projected(others.filter(a => a.modality === attempt.modality)) > AUTHORIZATION_POLICY[attempt.modality].maxEstimatedMicros ||
        projected(others.filter(a => a.batch_id === batch.id)) > usdToMicros(payload.config.maxCostUsd)) code = 'OBSERVED_COST_EXCEEDED';
    const parsedArtifactId = await this.storeArtifact(tx, auth, { batchId: batch.id, attemptId: attempt.id, kind: 'parsed-result' },
      Buffer.from(canonical({ output: inspected.parsedOutput ?? null, evaluation: analysis?.evaluation ?? null,
        observation: inspected.observation, protocolCode: code })), {});
    await tx.query(`UPDATE evaluation_attempts SET state='finished',observation=$2,cost_micros=$3,outcome=$4,error_code=$5,
      unknown_usage=$6,finished_at=now(),parsed_artifact_id=$7 WHERE id=$1`, [attempt.id, JSON.stringify(inspected.observation),
      inspected.costMicros, code ? 'failed' : 'needs_human_review', code, inspected.usageUnknown, parsedArtifactId]);
    const attempts = await this.attempts(tx);
    const held = inspected.usageUnknown || ['RESPONSE_ROUTE_MISMATCH', 'OBSERVED_COST_EXCEEDED', 'OBSERVED_TOKEN_LIMIT_EXCEEDED'].includes(code ?? '');
    if (held) await tx.query(`UPDATE evaluation_authorizations SET status='held',hold_reason=$2 WHERE id=$1`, [AUTHORIZATION_ID, code ?? 'USAGE_UNKNOWN']);
    if (code) await tx.query(`UPDATE evaluation_batches SET status='stopped' WHERE id=$1`, [batch.id]);
    else {
      const finished = attempts.filter(a => a.batch_id === batch.id && a.state === 'finished').length;
      if (finished === batch.manifest.items.length) await tx.query(`UPDATE evaluation_batches SET status='completed' WHERE id=$1`, [batch.id]);
    }
    await this.event(tx, recovered ? 'attempt.capture_recovered' : 'attempt.finished', { attemptId: attempt.id,
      responseArtifactId: attempt.capture_artifact_id, parsedArtifactId, code, usageUnknown: inspected.usageUnknown, costMicros: inspected.costMicros });
    return view(await this.attempt(tx, attempt.id));
  }
  async finish(attemptId: string, ownerToken: string, analysis: LocalAnalysis | undefined, command: LedgerCommand) {
    return this.locked(async (tx, auth) => this.receipt(tx, command, { type: 'finish', attemptId, ownerSha256: sha256(ownerToken), analysis: analysis ?? null }, async () => {
      const attempt = await this.attempt(tx, attemptId);
      if (attempt.owner_sha256 !== sha256(ownerToken)) fail('DISPATCH_OWNER_MISMATCH');
      return this.settle(tx, auth, attempt, analysis, false);
    }));
  }
  async recoverCapture(attemptId: string, captureSha256: string, analysis: LocalAnalysis | undefined, command: ReviewedCommand) {
    this.requireManagement();
    return this.locked(async (tx, auth) => this.receipt(tx, command, { type: 'recover-capture', attemptId, captureSha256,
      analysis: analysis ?? null, expectedRevision: command.expectedRevision, reason: command.reason }, async () => {
      this.checkRevision(auth, command); const attempt = await this.attempt(tx, attemptId);
      if (!attempt.capture_artifact_id) fail('RESPONSE_UNAVAILABLE');
      const artifact = await this.artifact(tx, auth, attempt.capture_artifact_id);
      if (artifact.row.source_sha256 !== captureSha256) fail('CAPTURE_CONFLICT');
      const result = await this.settle(tx, auth, attempt, analysis, true);
      const decisionArtifactId = await this.storeArtifact(tx, auth, { batchId: attempt.batch_id, attemptId, kind: 'recovery-decision' },
        Buffer.from(canonical({ captureSha256, ...command })), {});
      await this.event(tx, 'attempt.recovery_reviewed', { attemptId, captureSha256, decisionArtifactId, reasonSha256: sha256(command.reason) });
      return result;
    }));
  }
  async cancelReservation(attemptId: string, command: ReviewedCommand) {
    this.requireManagement();
    return this.locked(async (tx, auth) => this.receipt(tx, command, { type: 'cancel-reservation', attemptId,
      expectedRevision: command.expectedRevision, reason: command.reason }, async () => {
      this.checkRevision(auth, command); const attempt = await this.attempt(tx, attemptId);
      if (attempt.state !== 'reserved' || attempt.started_at !== null) fail('CANNOT_CANCEL_DISPATCHED');
      const decisionArtifactId = await this.storeArtifact(tx, auth, { batchId: attempt.batch_id, attemptId, kind: 'reservation-cancellation' },
        Buffer.from(canonical(command)), {});
      await tx.query(`UPDATE evaluation_attempts SET state='cancelled' WHERE id=$1`, [attemptId]);
      await tx.query(`UPDATE evaluation_batches SET status='stopped' WHERE id=$1`, [attempt.batch_id]);
      await this.event(tx, 'attempt.reservation_cancelled', { attemptId, decisionArtifactId, reasonSha256: sha256(command.reason) });
      return view(await this.attempt(tx, attemptId));
    }));
  }

  async reconcile(attemptId: string, proofInput: unknown, command: ReviewedCommand) {
    this.requireManagement();
    const proof = reconciliationProofSchema.parse(proofInput);
    if (objectSha256(proof.providerReceipt) !== proof.providerReceiptSha256) fail('RECONCILIATION_PROOF_CHANGED');
    const receipt = proof.providerReceipt;
    const observation: Observation = { inputTokens: receipt.prompt_tokens, outputTokens: receipt.completion_tokens,
      costUsd: receipt.cost, requestIdSha256: sha256(receipt.id), finishReason: 'unknown' };
    const costMicros = usdToMicros(receipt.cost);
    return this.locked(async (tx, auth) => this.receipt(tx, command, { type: 'reconcile', attemptId, proofSha256: objectSha256(proof),
      expectedRevision: command.expectedRevision, reason: command.reason }, async () => {
      this.checkRevision(auth, command); const attempt = await this.attempt(tx, attemptId);
      if (attempt.started_at === null || attempt.reconciled_at !== null || attempt.state === 'finished' && !attempt.unknown_usage) fail('RECONCILIATION_NOT_REQUIRED');
      const batch = await this.batch(tx, attempt.batch_id); const payload = await this.payload(tx, auth, batch);
      if (proof.requestSha256 !== attempt.request_sha256 || receipt.model !== payload.config.modelId ||
          receipt.provider !== attempt.expected_provider_name || attempt.observation?.requestIdSha256 &&
          attempt.observation.requestIdSha256 !== observation.requestIdSha256) fail('RECONCILIATION_PROOF_MISMATCH');
      if (attempt.cost_micros !== null && costMicros < amount(attempt.cost_micros)) fail('RECONCILIATION_COST_DECREASE');
      const proofArtifactId = await this.storeArtifact(tx, auth, { batchId: attempt.batch_id, attemptId, kind: 'reconciliation-proof' },
        Buffer.from(canonical({ proof, reason: command.reason })), { manuallyAttested: true });
      await tx.query(`UPDATE evaluation_attempts SET state='finished',observation=$2,cost_micros=$3,unknown_usage=false,
        outcome='failed',error_code='MANUALLY_RECONCILED',finished_at=COALESCE(finished_at,now()),reconciled_at=now() WHERE id=$1`,
      [attemptId, JSON.stringify(observation), costMicros]);
      await tx.query(`UPDATE evaluation_batches SET status='stopped' WHERE id=$1`, [attempt.batch_id]);
      await tx.query(`UPDATE evaluation_authorizations SET status='held',hold_reason='MANUAL_REVIEW_REQUIRED' WHERE id=$1`, [AUTHORIZATION_ID]);
      await this.event(tx, 'attempt.usage_reconciled', { attemptId, proofArtifactId, originalUnknown: attempt.unknown_usage,
        originalObservation: attempt.observation, observation, reasonSha256: sha256(command.reason) });
      return view(await this.attempt(tx, attemptId));
    }));
  }
  async releaseHold(command: ReviewedCommand) {
    this.requireManagement();
    return this.locked(async (tx, auth) => {
      const attempts = await this.attempts(tx);
      // Check even before replay: a previously released hold cannot hide a later unresolved dispatch.
      if (activeHold(attempts)) fail('AUTHORIZATION_EFFECTIVE_HOLD');
      return this.receipt(tx, command, { type: 'release-hold', expectedRevision: command.expectedRevision, reason: command.reason }, async () => {
        this.checkRevision(auth, command);
        if (auth.status === 'closed') fail('AUTHORIZATION_CLOSED');
        for (const modality of ['text', 'image'] as const) {
          const selected = attempts.filter(a => a.modality === modality && a.state !== 'cancelled');
          const estimated = selected.reduce((sum, a) => sum + amount(a.estimated_micros), 0);
          const projected = selected.reduce((sum, a) => sum + amount(a.cost_micros) + (a.state === 'reserved' ? amount(a.estimated_micros) : 0), 0);
          if (estimated > AUTHORIZATION_POLICY[modality].maxEstimatedMicros || projected > AUTHORIZATION_POLICY[modality].maxEstimatedMicros) fail('AUTHORIZATION_ESTIMATE_EXCEEDED');
        }
        for (const batchId of new Set(attempts.map(a => a.batch_id))) {
          const batch = await this.batch(tx, batchId); const payload = await this.payload(tx, auth, batch);
          this.checkBudget(attempts, batch, 0, 0, usdToMicros(payload.config.maxCostUsd));
        }
        if (auth.status !== 'ready') {
          const decisionArtifactId = await this.storeArtifact(tx, auth, { batchId: null, attemptId: null, kind: 'hold-release-decision' },
            Buffer.from(canonical(command)), {});
          await tx.query(`UPDATE evaluation_authorizations SET status='ready',hold_reason=NULL WHERE id=$1`, [AUTHORIZATION_ID]);
          await this.event(tx, 'authorization.hold_released', { decisionArtifactId, reasonSha256: sha256(command.reason) });
        }
        return { authorizationId: AUTHORIZATION_ID, status: 'ready' as const };
      });
    });
  }

  async inspectAttempt(attemptId: string) {
    this.requireManagement();
    return this.locked(async (tx, auth) => {
      const attempt = await this.attempt(tx, attemptId); const batch = await this.batch(tx, attempt.batch_id);
      const captured = attempt.capture_artifact_id ? await this.artifact(tx, auth, attempt.capture_artifact_id) : null;
      return { attempt: view(attempt), payload: await this.payload(tx, auth, batch), manifest: batch.manifest,
        capture: captured ? { bytes: captured.bytes, metadata: captured.row.metadata as unknown as CapturedMetadata,
          sourceSha256: captured.row.source_sha256 } : null };
    });
  }
  async readArtifactForReview(artifactId: string) {
    this.requireManagement();
    return this.locked(async (tx, auth) => {
      const artifact = await this.artifact(tx, auth, artifactId);
      await this.event(tx, 'artifact.read_for_review', { artifactId, contentSha256: artifact.row.sealed.contentSha256 });
      return { artifactId, kind: artifact.row.kind, bytes: artifact.bytes, metadata: artifact.row.metadata,
        contentSha256: sha256(artifact.bytes), originalSha256: artifact.row.sealed.originalSha256, redacted: artifact.row.sealed.redacted };
    });
  }
  async inputArtifactId(batchId: string) {
    this.requireManagement();
    return this.locked(async tx => (await this.batch(tx, batchId)).payload_artifact_id);
  }
  async listArtifacts(batchId?: string) {
    this.requireManagement(); if (batchId !== undefined) z.string().uuid().parse(batchId);
    return this.locked(async tx => {
      const rows = await tx.query<ArtifactRow>(`SELECT * FROM evaluation_artifacts WHERE authorization_id=$1${batchId ? ' AND batch_id=$2' : ''} ORDER BY created_at,id`,
        batchId ? [AUTHORIZATION_ID, batchId] : [AUTHORIZATION_ID]);
      return rows.rows.map(row => ({ artifactId: row.id, batchId: row.batch_id, attemptId: row.attempt_id, kind: row.kind,
        sourceSha256: row.source_sha256, contentSha256: row.sealed.contentSha256, byteLength: row.sealed.byteLength, redacted: row.sealed.redacted,
        state: row.metadata.state ?? null }));
    });
  }
  async status(): Promise<AuthorizationStatus> {
    return this.locked(async (tx, auth) => {
      const attempts = await this.attempts(tx);
      const batches = (await tx.query<BatchRow>('SELECT * FROM evaluation_batches WHERE authorization_id=$1 ORDER BY created_at,id', [AUTHORIZATION_ID])).rows;
      const modalities = {} as Record<Modality, BudgetView>;
      for (const modality of ['text', 'image'] as const) {
        const rows = attempts.filter(a => a.modality === modality && a.state !== 'cancelled');
        const consumed = rows.filter(a => a.started_at !== null); const reserved = rows.filter(a => a.state === 'reserved');
        const unknown = rows.filter(unresolved).length;
        const known = rows.reduce((sum, a) => sum + amount(a.cost_micros), 0);
        const limit = AUTHORIZATION_POLICY[modality];
        modalities[modality] = { limitRequests: limit.maxRequests, consumedRequests: consumed.length, reservedRequests: reserved.length,
          remainingRequests: Math.max(0, limit.maxRequests - consumed.length - reserved.length),
          estimatedCommittedUsd: microsToUsd(consumed.reduce((sum, a) => sum + amount(a.estimated_micros), 0)),
          estimatedReservedUsd: microsToUsd(reserved.reduce((sum, a) => sum + amount(a.estimated_micros), 0)),
          knownObservedUsd: microsToUsd(known), observedTotalUsd: unknown ? null : microsToUsd(known),
          unknownUsageAttempts: unknown, maxEstimatedUsd: microsToUsd(limit.maxEstimatedMicros) };
      }
      const purposes = {} as AuthorizationStatus['purposes'];
      for (const purpose of Object.keys(PURPOSE_LIMITS) as Purpose[]) {
        const selected = attempts.filter(a => a.purpose === purpose && a.state !== 'cancelled');
        const consumed = selected.filter(a => a.started_at !== null).length; const reserved = selected.filter(a => a.state === 'reserved').length;
        purposes[purpose] = { limit: PURPOSE_LIMITS[purpose], consumed, reserved, remaining: Math.max(0, PURPOSE_LIMITS[purpose] - consumed - reserved) };
      }
      const effectiveHold = activeHold(attempts);
      return { contractVersion: 'authorization-ledger.1', authorizationId: AUTHORIZATION_ID, policySha256: POLICY_SHA256,
        revision: auth.revision, status: auth.status === 'closed' ? 'closed' : effectiveHold ? 'held' : auth.status,
        declaredStatus: auth.status, effectiveHold, holdReason: effectiveHold ? 'ATTEMPT_UNRESOLVED' : auth.hold_reason,
        budgetEnforcement: 'local-estimate-not-billing-cap', modalities, purposes,
        batches: batches.map(b => ({ id: b.id, purpose: b.manifest.purpose, manifestSha256: b.manifest_sha256, status: b.status })), attempts: attempts.map(view) };
    });
  }
}
