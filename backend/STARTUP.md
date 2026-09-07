# Project startup contract — M2 2A3

Status: frozen with root review, including explicit pre-queue source-scope recovery. Base: `27243e6213b6d653506c2d9b381528412b8910b0`.
Product authority: revision 61 sections 5, 6 and 18.1. This contract completes startup of an existing server project draft. Uploads already need its stable `projectId`; the final Setup action does not create another project.

## Scope and invariants

- Save the explicitly submitted ProductBrief, validate the supported target/RulePack/Canvas, freeze or reuse the initial P context, register one startup intent, and enqueue at most one initial `extract-facts` run.
- `internalCode` and `commercialIntent` are optional, nonempty when supplied. Required: productName, category, stage and introduction. Existing stored snapshots and RulePack hashes are never rewritten.
- ProductBrief is understanding context, not evidence. ProductName becomes the employee-submitted identity only if no identity exists. A different existing identity is a startup blocker requiring the existing explicit identity-correction action.
- Pending material use is not product evidence. Startup may enter Facts while parsing or usage review is pending. No automatic usage confirmation, product Fact confirmation, Story creation, formal approval or publication.
- All model calls remain in Worker/OpenRouter with their existing configuration, capability and budget checks. HTTP startup only queues. This leaf runs no real model calls.

## Endpoints

All endpoints use existing authentication and server actor. Unknown request fields, including client-supplied capability flags, are rejected.

### `POST /api/projects/:id/production/startup/check`

Read-only. Body: `{ "context": ContextDraft }`; partial input is accepted for field-level feedback. It does not save a draft, activate P, write a receipt, enqueue work or contact a model.

```ts
interface StartupCheck {
  contractVersion: 'startup.1';
  projectId: string;
  projectVersion: number;
  revision: number;
  inputFingerprint: string; // SHA-256 of canonical submitted context, selected RulePack content hash and accepted source scope
  canStart: boolean; // no setup blockers; does not promise model execution
  canQueueExtraction: boolean;
  nextState: StartupState | 'blocked';
  blockers: StartupFinding[];
  suggestions: StartupFinding[];
  extractionPrerequisites: StartupFinding[];
  statistics: {
    requiredFieldsPresent: number;
    requiredFieldsTotal: number;
    receivedMaterials: number;
    availableProductEvidence: number;
    availableImageAssets: number;
    awaitingParse: number;
    awaitingUsageReview: number; // parsed blocks needing a use decision
    parseFailed: number;
  };
  materialIds: string[]; // all accepted originals in this explicit check
  manualEvidenceIds: string[]; // currently eligible independent human evidence
  modelExecution: {
    status: 'unavailable' | 'configured' | 'synthetic';
    code: string;
    message: string;
    dispatchPreflight: 'not_performed';
  };
  existingStartup: StartupStatus | null;
}
interface StartupFinding {
  code: string;
  message: string;
  location: {
    page: 'setup' | 'facts';
    anchor: 'product-info' | 'materials' | 'primary-target' | 'canvas-profile' | 'creation-confirmation' | 'pending-center';
    fields?: string[];
    materialIds?: string[];
  };
}
```

Setup blockers: incomplete/invalid required context; unavailable or invalid RulePack/target/Canvas; previously registered same-version RulePack content differs; different confirmed identity; no accepted original and no valid independent product evidence; unrelated active run; an already-created startup whose submitted context/source scope differs.

Unknown activation rules are returned as separate `RULE_PACK_INCOMPLETE` findings. Each existing `message` preserves that rule's ID, exact reason and recovery action, with `location` pointing to `setup` / `primary-target` / `rulePackRef`. A missing applicable activation rule similarly names the content/category gap and the administrator recovery action. Clients should display these concrete messages directly rather than replacing them with one generic completion warning.

Suggestions: optional fields absent; no approved image asset; individual parse failures; pending use decisions; scope members outside the current extraction batch. Every failure/pending item links to Facts or the related Setup anchor. Counts describe sources, never confirmed facts.

Extraction prerequisites (separate from Setup blockers): no currently valid product evidence, pending parse/use review, or unavailable model execution. All-failed originals still allow entering Facts for recovery. A single failed file never blocks another eligible file. There is no percentage score.

### `POST /api/projects/:id/production/startup/start`

```ts
type StartupStartRequest = WriteEnvelope & {
  context: ContextDraft;
  inputFingerprint: string; // from the check of this exact input and accepted source scope
};
type StartupCommandResponse = { project: Project; startup: StartupStatus };
```

The existing write envelope has `expectedProjectVersion`, `expectedRevision`, `idempotencyKey`. Version checks and actor-scoped receipt replay retain existing semantics. The server repeats the check under the project row lock, including current RulePack registration, then compares the fingerprint. Any setup blocker/fingerprint mismatch rolls back all context, identity, startup, run, audit, revision and receipt changes.

In one transaction: initialize the production envelope if needed; save/activate the submitted complete context or reuse an identical active snapshot (same complete context and RulePack hash); bind the immutable RulePack version; establish missing identity from the employee-submitted name; register the startup scope and history; enqueue through the existing domain gate only when evidence and server execution configuration allow it.

The source scope contains every accepted material ID + source SHA + parser version and every eligible independent evidence ID + SHA from the reviewed check. It does not silently grow. Accepted files awaiting parsing or use review are frozen as originals, not promoted into evidence. Existing unrelated active runs block startup. An equivalent repeat with a new key returns the existing startup and does not create P, run or audit events; a different input cannot replace it.

### `GET /api/projects/:id/production/startup`

Read-only `{ projectId, projectVersion, revision, startup: StartupStatus | null }`. Status derives from the persisted startup, current scoped sources and associated run. It survives reconnect/restart without writing on read.

### `POST /api/projects/:id/production/startup/continue-extraction`

Body: the existing strict WriteEnvelope. Response: StartupCommandResponse. It explicitly resumes the registered initial startup after parsing, human usage review or configuration recovery. It repeats source, immutable context and identity checks under lock. It selects only currently eligible evidence belonging to the frozen original source scope. New materials and newly added independent evidence are excluded and reported.

If no evidence/model configuration is ready, return a recoverable startup status without making a run. If a run is already queued/running/succeeded, return it without another queue entry. A failed run returns `failed` with `retryRunId` and must use the existing explicit `/runs/:runId/retry` action; continue never retries or creates a replacement run. Usage changes themselves never enqueue.

### `POST /api/projects/:id/production/startup/scope-refresh`

Body: `WriteEnvelope & { inputFingerprint: string; reason: string }`. Fingerprint is from `startup.scopeRefresh.inputFingerprint`, not the initial Setup check. GET/check return the exact append-only proposal below. The action explicitly accepts the displayed additions into the existing initial scope; it never queues a model. It is available only while `runId` is null and no startup run has ever been queued. Version, context, identity, existing-source hashes and proposal fingerprint are rechecked under lock. The record keeps all old failed originals and their hashes, appends the reviewed originals/independent evidence, and records before/after scope hashes, additions, actor/time and reason. New files appearing after review produce a conflict rather than silent inclusion. A changed active context or identity must be resolved through existing explicit actions first.

```ts
interface StartupScopeRefresh {
  canRefresh: boolean;
  inputFingerprint: string;
  addedMaterialIds: string[];
  addedManualEvidenceIds: string[];
  retainedMaterialIds: string[];
  retainedManualEvidenceIds: string[];
}
```

This recovers from all initial originals failing and the employee uploading a corrected original with a new MaterialId. It never changes an already queued, failed or succeeded run into a new request. A repeated continue/refresh whose meaning has not changed stores only its idempotency receipt, with no project revision/audit loop.

## State and persistence

```ts
type StartupState = 'awaiting_parse' | 'awaiting_usage_review' | 'awaiting_product_evidence'
  | 'awaiting_model_configuration' | 'awaiting_existing_run' | 'ready_to_extract' | 'queued' | 'running' | 'succeeded' | 'failed'
  | 'input_changed';
interface StartupStatus {
  id: string;
  state: StartupState;
  contextVersion: number;
  inputFingerprint: string;
  submittedAt: string;
  submittedBy: string;
  runId: string | null;
  retryRunId: string | null;
  evidenceIds: string[]; // actual frozen selection if a run was queued
  materialIds: string[];
  manualEvidenceIds: string[];
  prerequisites: StartupFinding[];
  excludedMaterialIds: string[];
  excludedManualEvidenceIds: string[];
  scopeRefresh: StartupScopeRefresh;
  modelExecution: StartupCheck['modelExecution'];
}
```

Before a run: pending parse takes precedence when no scoped evidence exists; then pending usage; then missing product evidence; with valid evidence and execution unavailable, awaiting_model_configuration; otherwise ready_to_extract. A different active project run produces awaiting_existing_run until that run ends. Only an actual queue entry produces queued. Pending items and partial failures remain explicit regardless of which state is primary. A status of configured means trusted local settings permit queueing; endpoint capabilities, actual input/token/cost checks have not run. A synthetic gateway is labeled synthetic, never live-ready.

`production.startup` is an optional additive JSONB record with immutable submitted input/scope, context version/hash, identity revision/name, server actor/time, optional run ID and bounded history of actual startup/queue events. No existing Project or P snapshot/receipt is rewritten. One initial startup per project is supported; subsequent extraction batches belong to later explicit batch work, not an implicit continue after success.

The associated AgentRun gains optional startup extraction metadata: startup ID, context/identity binding, exact evidence IDs and SHA. Legacy runs without it preserve their existing contracts. Queue, retry, Worker dispatch and apply-output gates check the binding and source availability. A startup run's structured request receives only its selected evidence and contextual ProductBrief/identity; returned facts referencing any other evidence are rejected. Scope is never inferred from current global project evidence. Source withdrawal or a changed context/identity rejects dispatch/retry/application until explicitly resolved. Model output only creates candidates.

## Trusted execution capability

`buildApp` accepts server-owned startup execution capability derived by the actual process from Worker presence and validated OpenRouter configuration/policy. Omitted capability defaults unavailable. Main passes the real process configuration; test services explicitly pass synthetic capability. No request can enable capability or bypass OpenRouter's runtime capability/budget preflight. No new cross-stage cost ledger is included.

## Verification

Real HTTP and PostgreSQL: partial check is read-only; atomic failure rollback; same-key replay; concurrent starts produce one P/startup/run; equivalent new-key no-op; persisted restart status; pending use excluded; valid evidence queues; explicit continue; partial failures/retry recovery; frozen scope excludes later sources; output rejects out-of-scope refs; no automatic identity replacement/Fact confirmation/Story creation; default-unavailable configuration; legacy snapshots/receipts/runs remain compatible.

Required gates: backend typecheck, default tests, backend build and real PostgreSQL integration. No paid OpenRouter calls; the AW case still lacks a real SKU/expected factual baseline and is not used as an extraction fixture.
