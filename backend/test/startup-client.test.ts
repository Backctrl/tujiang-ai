import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { scopedContext, scopedRule } from './fixtures/scoped-rules.js';
import { contextForm, projectContextBase } from '../../src/pages/ArcaneWarriorPage/project-context.js';
import { ApiError, StageAApi, prepareProjectWrite, type Project } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';
import { executeSetupOperation, prepareSetupOperation, validateSetupOperation, type SetupAction, type SetupCapture, type SetupFlow, type SetupOperation, type SetupRecoveryStorage } from '../../src/pages/ArcaneWarriorPage/setup-recovery.js';
import { isStartupCheck, isStartupRead, startupReadMatches } from '../../src/pages/ArcaneWarriorPage/startup-contract.js';
import type { MaterialLocalEntry } from '../../src/pages/ArcaneWarriorPage/material-storage.js';

class MemorySetupStorage implements SetupRecoveryStorage {
  selection: string | undefined;
  readSelection() { return Promise.resolve(this.selection); }
  selectScope(scopeId: string) { this.selection = scopeId; return Promise.resolve(); }
  pending: SetupOperation | undefined;
  flows = new Map<string, SetupFlow>();
  entries = new Map<string, MaterialLocalEntry>();
  failSave = false;
  failComplete = false;
  readPending() { return Promise.resolve(this.pending ? validateSetupOperation(structuredClone(this.pending)) : undefined); }
  readFlow(scopeId: string) { return Promise.resolve(structuredClone(this.flows.get(scopeId))); }
  async save(operation: SetupOperation) {
    if (this.failSave) throw new Error('Injected local quota failure');
    if (this.pending && this.pending.prepared.body !== operation.prepared.body) throw new Error('Pending slot occupied');
    this.pending = structuredClone(operation);
  }
  async complete(operation: SetupOperation, project: Project) {
    if (this.failComplete) throw new Error('Injected receipt settlement failure');
    assert.equal(this.pending?.prepared.body, operation.prepared.body);
    this.flows.set(operation.scopeId, { id: `setup:${operation.scopeId}`, scopeId: operation.scopeId, capture: operation.capture, project: structuredClone(project) });
    for (const [id, entry] of this.entries) if (entry.projectId === operation.scopeId) this.entries.set(id, { ...entry, projectId: project.id });
    this.pending = undefined;
  }
  async release(operation: SetupOperation) { assert.equal(this.pending?.prepared.body, operation.prepared.body); this.pending = undefined; }
}
const catalog = { rulePacks: [], scopedRulePacks: [scopedRule] };
const synthetic = { mode: 'synthetic', workerEnabled: true } as const;
const capture = (project: Project | null = null): SetupCapture => ({ reviewed: { value: contextForm(scopedContext, 'scoped-rules.1'), base: projectContextBase(project), active: true }, models: {} });
type Trace = { path: string; method: string; body?: string };

test('startup API authenticates in headers, validates exact status envelopes and retains concrete per-rule blockers', async () => {
  const f = await fixture(catalog);
  const base = await f.app.listen({ port: 0, host: '127.0.0.1' });
  const trace: Trace[] = [];
  try {
    const client = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
      trace.push({ path: String(path), method: options?.method ?? 'GET', body: options?.body as string | undefined });
      assert.equal(new Headers(options?.headers).get('Authorization'), f.headers.authorization);
      assert.equal(options?.redirect, 'error');
      return fetch(`${base}${path}`, options);
    });
    const project = await client.create('Synthetic check project'), before = structuredClone(project);
    const check = await client.startupCheck(project.id, {});
    assert.ok(isStartupCheck(check)); assert.equal(check.canStart, false);
    assert.ok(check.blockers.some(item => item.location.page === 'setup' && item.location.anchor === 'product-info'));
    assert.deepEqual(await client.get(project.id), before, 'read-only POST does not create production, identity or audit');
    const status = await client.startup(project.id);
    assert.ok(isStartupRead(status)); assert.equal(status.startup, null); assert.ok(startupReadMatches(status, before));
    assert.equal(startupReadMatches(status, { ...before, revision: before.revision + 1 }), false);
    assert.equal(startupReadMatches(status, { ...before, id: crypto.randomUUID() }), false);
    const concrete = { ...check, blockers: [{ code: 'RULE_PACK_INCOMPLETE', message: 'synthetic-image-rule: missing official dimensions; reopen Setup primary-target rulePackRef', location: { page: 'setup', anchor: 'primary-target', fields: ['rulePackRef'] } }] };
    assert.ok(isStartupCheck(concrete)); assert.equal(concrete.blockers[0]!.message.includes('synthetic-image-rule'), true);
    assert.equal(isStartupCheck({ ...check, statistics: { ...check.statistics, awaitingParse: -1 } }), false);
    assert.equal(isStartupCheck({ ...check, inputFingerprint: 'unknown' }), false);
    assert.equal(isStartupCheck({ ...check, modelExecution: { ...check.modelExecution, dispatchPreflight: 'passed' } }), false);
    await assert.rejects(new StageAApi('no-secret', async () => Response.json({ ...status, projectId: 'wrong' })).startup(project.id), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_STARTUP_RESPONSE');
    await assert.rejects(new StageAApi('no-secret', async () => new Response('', { status: 401 })).startupCheck(project.id, {}), (error: unknown) => error instanceof ApiError && error.status === 401);
    assert.equal(trace.filter(call => call.method === 'POST' && call.path.endsWith('/check')).length, 1);
  } finally { await f.close(); }
});

test('durable new-project creation binds the selected File only after its receipt; initialization and no-source check do not upload or start', async () => {
  const f = await fixture(catalog, synthetic), storage = new MemorySetupStorage(), scope = `local-${crypto.randomUUID()}`;
  const base = await f.app.listen({ port: 0, host: '127.0.0.1' });
  const trace: Trace[] = [];
  try {
    const file = new File(['Synthetic source: 10 kg'], 'synthetic.txt', { type: 'text/plain' });
    const entry: MaterialLocalEntry = { id: crypto.randomUUID(), projectId: scope, file, fileName: file.name, mimeType: file.type, sizeBytes: file.size, source: { kind: 'local_upload' }, addedAt: new Date().toISOString(), status: 'waiting' };
    storage.entries.set(entry.id, entry);
    const submitted = capture(), operation = prepareSetupOperation(scope, submitted, null, 'create');
    const client = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
      trace.push({ path: String(path), method: options?.method ?? 'GET', body: options?.body as string | undefined });
      if (path === '/api/projects') { assert.equal(storage.pending?.prepared.body, operation.prepared.body); assert.deepEqual(storage.pending?.capture, submitted); assert.equal(storage.entries.get(entry.id)?.projectId, scope); }
      return fetch(`${base}${path}`, options);
    });
    const created = await executeSetupOperation(operation, client, storage); assert.equal(created.kind, 'saved'); if (created.kind !== 'saved') return;
    assert.equal(created.project.production, undefined); assert.equal(created.project.identity, undefined);
    assert.equal(storage.entries.get(entry.id)?.projectId, created.project.id);
    assert.equal(await storage.entries.get(entry.id)!.file.text(), 'Synthetic source: 10 kg');
    const initialized = await executeSetupOperation(prepareSetupOperation(scope, submitted, created.project, 'initialize'), client, storage);
    assert.equal(initialized.kind, 'saved'); if (initialized.kind !== 'saved') return;
    const checked = await client.startupCheck(initialized.project.id, scopedContext);
    assert.equal(checked.canStart, false); assert.equal(checked.statistics.receivedMaterials, 0);
    const project = await client.get(initialized.project.id);
    assert.equal(project.production?.context?.activeVersion, undefined);
    assert.equal(project.production?.startup, undefined); assert.equal(project.identity, undefined); assert.equal(project.runs.length, 0);
    assert.equal(storage.entries.size, 1, 'the final action must not consume the local upload queue');
    assert.equal(trace.filter(call => call.method === 'POST' && call.path === '/api/projects').length, 1);
    assert.equal(trace.filter(call => call.method === 'POST' && call.path.endsWith('/production/initialize')).length, 1);
    assert.equal(trace.some(call => call.path.endsWith('/materials') || call.path.endsWith('/start')), false);
    assert.equal((await storage.readFlow(scope))?.project.id, project.id);
    assert.equal(JSON.stringify(storage.pending ?? [...storage.flows.values()]).includes(f.headers.authorization.slice(7)), false);
  } finally { await f.close(); }
});

test('startup command rejects well-formed but cross-startup or stale status envelopes before accepting a receipt', async () => {
  const f = await fixture(catalog, synthetic), base = await f.app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const client = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${base}${path}`, options));
    let project = await f.create();
    project = await f.write(project, 'evidence', { documentName: 'Synthetic source', locator: 'line 1', usage: 'product_evidence', text: '10 kg' });
    const check = await client.startupCheck(project.id, scopedContext);
    const prepared = prepareProjectWrite(project, 'production/startup/start', { context: scopedContext, inputFingerprint: check.inputFingerprint });
    const receipt = await client.startupCommand(prepared);
    assert.ok(receipt.project.production?.startup);
    for (const startup of [
      { ...receipt.startup, id: crypto.randomUUID() },
      { ...receipt.startup, contextVersion: receipt.startup.contextVersion + 1 },
      { ...receipt.startup, inputFingerprint: '0'.repeat(64) },
      { ...receipt.startup, manualEvidenceIds: [crypto.randomUUID()] },
      { ...receipt.startup, runId: crypto.randomUUID() },
      { ...receipt.startup, state: 'succeeded' },
    ]) {
      assert.ok(isStartupRead({ projectId: project.id, projectVersion: receipt.project.version, revision: receipt.project.revision, startup }), 'corruption retains a valid shape');
      await assert.rejects(new StageAApi('synthetic', async () => Response.json({ ...receipt, startup })).startupCommand(prepared),
        (error: unknown) => error instanceof ApiError && error.code === 'INVALID_STARTUP_RESPONSE');
    }
    await assert.rejects(new StageAApi('synthetic', async () => Response.json({ ...receipt, project: { ...receipt.project, production: { ...receipt.project.production, startup: undefined } } })).startupCommand(prepared),
      (error: unknown) => error instanceof ApiError && error.code === 'INVALID_STARTUP_RESPONSE');
  } finally { await f.close(); }
});

for (const action of ['create', 'initialize', 'start'] as const) {
  test(`${action} failure matrix preserves each frozen body and key, stops later steps and replays only explicitly`, async t => {
    for (const fault of ['401', 'lost-response', 'invalid-response', 'settlement', 'before-http-storage'] as const) await t.test(fault, async () => {
      const f = await fixture(catalog, synthetic), storage = new MemorySetupStorage();
      const base = await f.app.listen({ port: 0, host: '127.0.0.1' });
      try {
        let before: Project | null = action === 'create' ? null : await f.create();
        if (action === 'start') before = await f.write(before!, 'evidence', { documentName: 'synthetic independent', locator: 'line 1', usage: 'product_evidence', text: 'Synthetic: 10 kg' });
        const normal = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${base}${path}`, options));
        const fields = action === 'start' ? { context: scopedContext, inputFingerprint: (await normal.startupCheck(before!.id, scopedContext)).inputFingerprint } : {};
        const operation = prepareSetupOperation(`local-${crypto.randomUUID()}`, capture(before), before, action, fields);
        let calls = 0;
        const bodies: string[] = [];
        const faulty = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
          calls++; bodies.push(String(options?.body));
          if (fault === '401') return new Response('', { status: 401 });
          const response = await fetch(`${base}${path}`, options);
          if (fault === 'lost-response') throw new Error('Response dropped after server commit');
          if (fault === 'invalid-response') return Response.json({ unrelated: 'data' });
          return response;
        });
        storage.failSave = fault === 'before-http-storage'; storage.failComplete = fault === 'settlement';
        const first = await executeSetupOperation(operation, faulty, storage);
        assert.equal(first.kind, fault === 'before-http-storage' ? 'storage' : 'paused');
        assert.equal(calls, fault === 'before-http-storage' ? 0 : 1, 'no initialization, upload, GET, start or rebase is chained after failure');
        const restored = fault === 'before-http-storage' ? operation : (await storage.readPending())!;
        assert.equal(restored.prepared.body, operation.prepared.body);
        assert.equal(JSON.stringify(restored).includes(f.headers.authorization.slice(7)), false);
        const callsBeforeRead = calls; await storage.readPending(); assert.equal(calls, callsBeforeRead, 'reading recovery data never replays');
        storage.failSave = false; storage.failComplete = false;
        const replay = await executeSetupOperation(restored, new StageAApi(f.headers.authorization.slice(7), (path, options) => {
          bodies.push(String(options?.body)); return fetch(`${base}${path}`, options);
        }), storage);
        assert.equal(replay.kind, 'saved'); if (replay.kind !== 'saved') return;
        assert.ok(bodies.every(body => body === operation.prepared.body)); assert.equal(await storage.readPending(), undefined);
        if (action === 'create') assert.equal((await normal.list()).length, 1);
        if (action === 'initialize') { assert.equal(replay.project.production?.context?.versions.length ?? 0, 0); assert.equal(replay.project.runs.length, 0); }
        if (action === 'start') { assert.equal(replay.project.production?.context?.versions.length, 1); assert.equal(replay.project.runs.length, 1); assert.equal(replay.project.facts.length, 0); assert.equal(replay.project.storyboard, undefined); }
      } finally { await f.close(); }
    });
  });
}

test('initialization and startup conflicts retain the original request and never inherit the upload parser-rebase exception', async () => {
  const f = await fixture(catalog, synthetic); const base = await f.app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const normal = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${base}${path}`, options));
    for (const action of ['initialize', 'start'] as SetupAction[]) {
      let before = await f.create();
      if (action === 'start') before = await f.write(before, 'evidence', { documentName: 'synthetic', locator: 'line 1', usage: 'product_evidence', text: '10 kg' });
      const fields = action === 'start' ? { context: scopedContext, inputFingerprint: (await normal.startupCheck(before.id, scopedContext)).inputFingerprint } : {};
      const operation = prepareSetupOperation(before.id, capture(before), before, action, fields), storage = new MemorySetupStorage(), trace: Trace[] = [];
      await f.write(before, 'evidence', { documentName: 'later independent', locator: 'line 2', usage: 'product_evidence', text: 'Synthetic later product evidence' });
      const result = await executeSetupOperation(operation, new StageAApi(f.headers.authorization.slice(7), (path, options) => {
        trace.push({ path: String(path), method: options?.method ?? 'GET' }); return fetch(`${base}${path}`, options);
      }), storage);
      assert.equal(result.kind, 'paused'); if (result.kind === 'paused') assert.equal(result.conflict, true);
      assert.equal(trace.length, 1); assert.equal(trace[0]!.method, 'POST');
      assert.equal((await storage.readPending())?.prepared.body, operation.prepared.body);
      assert.equal((await normal.get(before.id)).production?.startup, undefined);
    }
  } finally { await f.close(); }
});

test('durable startup recovery only admits the finite contract routes and rejects credential or capability fields', () => {
  const create = prepareSetupOperation('local-test', capture(), null, 'create');
  assert.throws(() => validateSetupOperation({ ...create, prepared: { ...create.prepared, suffix: 'identity/confirm' } }));
  assert.throws(() => validateSetupOperation({ ...create, prepared: { ...create.prepared, body: JSON.stringify({ ...JSON.parse(create.prepared.body), token: 'secret' }) } }));
  assert.throws(() => validateSetupOperation({ ...create, prepared: { ...create.prepared, body: JSON.stringify({ ...JSON.parse(create.prepared.body), modelReady: true }) } }));
  assert.throws(() => validateSetupOperation({ ...create, action: 'activate' }));
});
