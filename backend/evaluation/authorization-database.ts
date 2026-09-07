import type { Database } from '../src/database.js';

// Separate migration; neither initializes production tables nor changes Project state.
export async function migrateAuthorizationLedger(db: Database) {
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(730107)');
    await tx.query(`CREATE TABLE IF NOT EXISTS evaluation_authorizations (
      id text PRIMARY KEY, policy jsonb NOT NULL, policy_sha256 text NOT NULL,
      key_id text NOT NULL, status text NOT NULL CHECK(status IN ('ready','held','closed')),
      revision integer NOT NULL DEFAULT 1, hold_reason text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await tx.query(`CREATE TABLE IF NOT EXISTS evaluation_batches (
      id uuid PRIMARY KEY, authorization_id text NOT NULL REFERENCES evaluation_authorizations(id),
      manifest jsonb NOT NULL, manifest_sha256 text NOT NULL, payload_artifact_id uuid NOT NULL,
      status text NOT NULL CHECK(status IN ('awaiting_input_review','approved','rejected','stopped','completed')),
      created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await tx.query(`CREATE TABLE IF NOT EXISTS evaluation_input_reviews (
      id uuid PRIMARY KEY, batch_id uuid NOT NULL UNIQUE REFERENCES evaluation_batches(id),
      manifest_sha256 text NOT NULL, decision text NOT NULL CHECK(decision IN ('approved','rejected')),
      reviewer text NOT NULL, reviewer_credential_sha256 text NOT NULL, reason_sha256 text NOT NULL, decision_reference_sha256 text NOT NULL,
      decision_receipt_sha256 text NOT NULL CHECK(decision_receipt_sha256 ~ '^[a-f0-9]{64}$'),
      decision_artifact_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await tx.query(`CREATE TABLE IF NOT EXISTS evaluation_attempts (
      id uuid PRIMARY KEY, authorization_id text NOT NULL REFERENCES evaluation_authorizations(id),
      batch_id uuid NOT NULL REFERENCES evaluation_batches(id), item_id text NOT NULL,
      purpose text NOT NULL, modality text NOT NULL CHECK(modality IN ('text','image')),
      request_sha256 text NOT NULL, plan_sha256 text NOT NULL, capabilities_sha256 text NOT NULL,
      expected_provider_name text NOT NULL, estimated_micros bigint NOT NULL CHECK(estimated_micros >= 0),
      state text NOT NULL CHECK(state IN ('reserved','dispatch_started','finished','cancelled')),
      owner_sha256 text, observation jsonb, cost_micros bigint, outcome text, error_code text,
      unknown_usage boolean NOT NULL DEFAULT false, started_at timestamptz, finished_at timestamptz,
      reconciled_at timestamptz, capture_artifact_id uuid, capture_latency_ms integer, parsed_artifact_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(authorization_id,batch_id,item_id)
    )`);
    await tx.query(`CREATE UNIQUE INDEX IF NOT EXISTS evaluation_single_dispatch ON evaluation_attempts(authorization_id)
      WHERE state='dispatch_started'`);
    await tx.query(`CREATE TABLE IF NOT EXISTS evaluation_artifacts (
      id uuid PRIMARY KEY, authorization_id text NOT NULL REFERENCES evaluation_authorizations(id),
      batch_id uuid, attempt_id uuid, kind text NOT NULL, sealed jsonb NOT NULL,
      source_sha256 text NOT NULL, metadata jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(authorization_id,batch_id,attempt_id,kind,source_sha256)
    )`);
    await tx.query(`CREATE TABLE IF NOT EXISTS evaluation_events (
      authorization_id text NOT NULL REFERENCES evaluation_authorizations(id), sequence integer NOT NULL,
      type text NOT NULL, body jsonb NOT NULL, actor text NOT NULL, event_sha256 text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(authorization_id,sequence)
    )`);
    await tx.query(`CREATE TABLE IF NOT EXISTS evaluation_command_receipts (
      authorization_id text NOT NULL REFERENCES evaluation_authorizations(id), command_id text NOT NULL,
      fingerprint text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(authorization_id,command_id)
    )`);
    // References carry ownership and kind as well as an ID; valid ciphertext from another request is not interchangeable.
    await tx.query(`CREATE UNIQUE INDEX IF NOT EXISTS evaluation_artifact_batch_identity ON evaluation_artifacts(authorization_id,batch_id,kind,id)`);
    await tx.query(`CREATE UNIQUE INDEX IF NOT EXISTS evaluation_artifact_attempt_identity ON evaluation_artifacts(authorization_id,batch_id,attempt_id,kind,id)`);
    await tx.query(`CREATE UNIQUE INDEX IF NOT EXISTS evaluation_artifact_review_identity ON evaluation_artifacts(batch_id,kind,id)`);
    await tx.query(`ALTER TABLE evaluation_batches ADD COLUMN IF NOT EXISTS payload_artifact_kind text GENERATED ALWAYS AS ('batch-input'::text) STORED`);
    await tx.query(`ALTER TABLE evaluation_attempts ADD COLUMN IF NOT EXISTS capture_artifact_kind text GENERATED ALWAYS AS ('response'::text) STORED`);
    await tx.query(`ALTER TABLE evaluation_attempts ADD COLUMN IF NOT EXISTS parsed_artifact_kind text GENERATED ALWAYS AS ('parsed-result'::text) STORED`);
    await tx.query(`ALTER TABLE evaluation_attempts ADD COLUMN IF NOT EXISTS capabilities_artifact_id uuid`);
    await tx.query(`ALTER TABLE evaluation_attempts ADD COLUMN IF NOT EXISTS capabilities_artifact_kind text GENERATED ALWAYS AS ('capabilities'::text) STORED`);
    await tx.query(`ALTER TABLE evaluation_input_reviews ADD COLUMN IF NOT EXISTS decision_artifact_kind text GENERATED ALWAYS AS ('input-review-decision'::text) STORED`);
    const constraints = [
      ['evaluation_artifacts', 'evaluation_artifact_scope_check', `CHECK (
        (kind NOT IN ('batch-input','input-review-decision') OR (batch_id IS NOT NULL AND attempt_id IS NULL)) AND
        (kind NOT IN ('response','parsed-result','capabilities') OR (batch_id IS NOT NULL AND attempt_id IS NOT NULL)))`],
      ['evaluation_batches', 'evaluation_batch_payload_reference', `FOREIGN KEY(authorization_id,id,payload_artifact_kind,payload_artifact_id)
        REFERENCES evaluation_artifacts(authorization_id,batch_id,kind,id) DEFERRABLE INITIALLY DEFERRED`],
      ['evaluation_attempts', 'evaluation_attempt_capture_reference', `FOREIGN KEY(authorization_id,batch_id,id,capture_artifact_kind,capture_artifact_id)
        REFERENCES evaluation_artifacts(authorization_id,batch_id,attempt_id,kind,id) DEFERRABLE INITIALLY DEFERRED`],
      ['evaluation_attempts', 'evaluation_attempt_parsed_reference', `FOREIGN KEY(authorization_id,batch_id,id,parsed_artifact_kind,parsed_artifact_id)
        REFERENCES evaluation_artifacts(authorization_id,batch_id,attempt_id,kind,id) DEFERRABLE INITIALLY DEFERRED`],
      ['evaluation_attempts', 'evaluation_attempt_capabilities_reference', `FOREIGN KEY(authorization_id,batch_id,id,capabilities_artifact_kind,capabilities_artifact_id)
        REFERENCES evaluation_artifacts(authorization_id,batch_id,attempt_id,kind,id) DEFERRABLE INITIALLY DEFERRED`],
      ['evaluation_input_reviews', 'evaluation_input_review_reference', `FOREIGN KEY(batch_id,decision_artifact_kind,decision_artifact_id)
        REFERENCES evaluation_artifacts(batch_id,kind,id) DEFERRABLE INITIALLY DEFERRED`],
    ] as const;
    for (const [table, name, definition] of constraints) {
      const existing = await tx.query('SELECT 1 FROM pg_constraint WHERE conname=$1 AND conrelid=$2::regclass', [name, table]);
      if (!existing.rows.length) await tx.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
    }
  });
}
