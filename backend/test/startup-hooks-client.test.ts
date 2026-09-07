import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { act, createElement, type ComponentType, type ReactElement } from 'react';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { fixture } from './helpers.js';
import { scopedContext, scopedRule } from './fixtures/scoped-rules.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import { useProjectSession, type ProjectSession } from '../../src/pages/ArcaneWarriorPage/useProjectSession.js';
import { useProjectContext } from '../../src/pages/ArcaneWarriorPage/useProjectContext.js';
import { useMaterialIntake, type MaterialIntakeController } from '../../src/pages/ArcaneWarriorPage/useMaterialIntake.js';
import { useProjectStartup, useStartupStatus } from '../../src/pages/ArcaneWarriorPage/useProjectStartup.js';
import { contextForm } from '../../src/pages/ArcaneWarriorPage/project-context.js';
import { materialIntakeStorage } from '../../src/pages/ArcaneWarriorPage/material-storage.js';
import { setupRecoveryStorage } from '../../src/pages/ArcaneWarriorPage/setup-recovery.js';
import type { StartupFinding } from '../../src/pages/ArcaneWarriorPage/startup-contract.js';
import { StageAApi } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';

type RenderNode = { type: string | ComponentType; children: (string | RenderNode)[]; props: Record<string, unknown>; findAllByType(type: string): RenderNode[] };
type Renderer = { root: RenderNode; unmount(): void; update(element: ReactElement): void };
const renderer = createRequire(import.meta.url)('react-test-renderer') as { create(element: ReactElement): Renderer };
type Mounted = { session: ProjectSession; context: ReturnType<typeof useProjectContext>; intake: MaterialIntakeController;
  startup: ReturnType<typeof useProjectStartup>; status: ReturnType<typeof useStartupStatus> };
type Trace = { path: string; method: string; body?: string };
type Intercept = (path: string, options: RequestInit | undefined, send: () => Promise<Response>) => Promise<Response>;
const catalog = { rulePacks: [], scopedRulePacks: [scopedRule] };
const synthetic = { mode: 'synthetic', workerEnabled: true } as const;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function clearDatabase() {
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('tujiang_material_intake_v1'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
}

async function harness(panel?: ComponentType<{ session: ProjectSession; onStage: () => void }>) {
  const f = await fixture(catalog, synthetic), base = await f.app.listen({ port: 0, host: '127.0.0.1' });
  const globals = new Map(['localStorage', 'indexedDB', 'IDBKeyRange', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const local = new Map<string, string>(), trace: Trace[] = [], navigations: { projectId: string | undefined; scope: string }[] = [], findings: StartupFinding[] = [];
  const nativeFetch = globalThis.fetch;
  let intercept: Intercept | undefined, instance: Renderer | undefined, latest: Mounted | undefined;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value), removeItem: (key: string) => local.delete(key) } });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDB });
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: (path: string | URL | Request, options?: RequestInit) => {
    const url = String(path);
    if (url.includes('/events')) return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('Test event connection closed', 'AbortError'));
      if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener('abort', abort, { once: true });
    });
    trace.push({ path: url, method: options?.method ?? 'GET', body: options?.body as string | undefined });
    const send = () => nativeFetch(`${base}${url}`, options);
    return intercept ? intercept(url, options, send) : send();
  } });
  await clearDatabase();
  function SetupProbe({ session, intake }: { session: ProjectSession; intake: MaterialIntakeController }) {
    const context = useProjectContext(session);
    const startup = useProjectStartup(session, context, () => navigations.push({ projectId: session.getLatestProject()?.id, scope: session.getCurrentScope() }), finding => findings.push(finding));
    const status = useStartupStatus(session);
    latest = { session, context, startup, intake, status };
    return panel ? createElement(panel, { session, onStage: () => undefined }) : null;
  }
  function Probe() {
    const session = useProjectSession(), intake = useMaterialIntake(session);
    return createElement(SetupProbe, { session, intake, key: `${session.draftScope}:${session.recoveryLoading ? 'loading' : 'ready'}` });
  }
  const get = () => { assert.ok(latest); return latest; };
  const settle = async (predicate: () => boolean, label: string, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (!predicate() && Date.now() < deadline) await act(async () => { await delay(10); });
    assert.ok(predicate(), `${label}; session error=${latest?.session.error}; recovery=${latest?.session.recoveryError}; startup=${latest?.startup.error}`);
  };
  const mount = async () => { await act(async () => { instance = renderer.create(createElement(Probe)); }); await settle(() => !get().session.recoveryLoading && !get().intake.loading, 'initial effects finish'); };
  const unmount = async () => { if (instance) await act(async () => { instance!.unmount(); instance = undefined; }); };
  const connect = async () => { await act(async () => { get().session.setToken(f.headers.authorization.slice(7)); }); await settle(() => !!get().session.catalog || !!get().session.catalogError, 'catalog fetched'); };
  const fill = async () => {
    const form = contextForm(scopedContext, 'scoped-rules.1');
    await act(async () => {
      for (const field of ['productName', 'category', 'stage', 'introduction', 'internalCode', 'commercialIntent', 'widthPx', 'format'] as const) get().context.setField(field, form[field]);
      get().context.setRule(scopedRule.id, scopedRule.version);
    });
    assert.deepEqual(get().context.getCurrentInput()?.context, scopedContext, 'multiple input changes in one React batch retain all fields');
  };
  return { f, get, local, trace, findings, navigations, mount, unmount, connect, fill, settle, root: () => instance!.root, setIntercept: (value?: Intercept) => { intercept = value; },
    async close() { await unmount(); await clearDatabase(); for (const [key, previous] of globals) { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); }; await f.close(); } };
}

test('mounted new-project hooks accept local form and File before an ID; first explicit upload prepares one project and never activates or starts', async () => {
  const h = await harness();
  try {
    await h.mount();
    assert.equal(h.get().session.project, null); assert.equal(h.get().context.canEdit, true); assert.equal(h.get().intake.canSelect, true);
    await act(async () => { h.get().context.setField('productName', 'Local typed name'); });
    const file = new File(['Synthetic original: 10 kg'], 'synthetic-first.txt', { type: 'text/plain' });
    await act(async () => { await h.get().intake.addFiles([file], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'local File retained');
    const scope = h.get().session.draftScope;
    assert.equal(h.trace.filter(item => item.method === 'POST').length, 0);
    assert.equal(h.get().intake.entries[0]!.projectId, scope);
    await h.connect(); await h.fill();
    await act(async () => { await Promise.all([h.get().intake.start(), h.get().intake.start()]); });
    await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'one original uploaded');
    const p = h.get().session.project!;
    assert.equal(h.get().session.draftScope, scope); assert.equal(h.get().context.form.productName, scopedContext.productBrief.productName);
    assert.equal(h.get().context.local.needsReview, false, 'only the confirmed empty initialization advances the local draft base');
    assert.equal(p.identity, undefined); assert.equal(p.production?.context, undefined); assert.equal(p.production?.startup, undefined); assert.equal(p.runs.length, 0);
    assert.equal(h.trace.filter(item => item.method === 'POST' && item.path === '/api/projects').length, 1);
    assert.equal(h.trace.filter(item => item.method === 'POST' && item.path.endsWith('/production/initialize')).length, 1);
    assert.equal(h.trace.filter(item => item.method === 'POST' && item.path.endsWith('/production/materials')).length, 1);
    assert.equal(h.trace.some(item => item.path.endsWith('/start')), false); assert.deepEqual(h.navigations, []);
  } finally { await h.close(); }
});

test('mounted final CTA does not upload queued Files; missing accepted sources block without P/startup/run and survive reopening', async () => {
  const h = await harness();
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().intake.addFiles([new File(['10 kg'], 'waiting.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'waiting local source');
    await act(async () => { await h.get().startup.start(); });
    await h.settle(() => !!h.get().startup.check, 'server check shown');
    const p = h.get().session.project!, scope = h.get().session.draftScope;
    assert.equal(h.get().startup.check?.canStart, false); assert.equal(h.get().intake.entries.length, 1);
    assert.equal(p.production?.startup, undefined); assert.equal(p.production?.context, undefined); assert.equal(p.runs.length, 0);
    assert.equal(h.trace.some(item => item.path.endsWith('/production/materials') || item.path.endsWith('/start')), false);
    assert.equal(h.navigations.length, 0); assert.ok(h.findings.length);
    const writes = h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length;
    await h.unmount(); await h.mount();
    assert.equal(h.get().session.project?.id, p.id); assert.equal(h.get().session.draftScope, scope);
    assert.equal(h.get().context.form.productName, scopedContext.productBrief.productName); assert.equal(h.get().context.local.needsReview, false);
    assert.equal(h.get().session.token, '');
    assert.equal(h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length, writes, 'restoring a ready flow does not resume any business write');
    await h.connect(); await act(async () => { await h.get().startup.start(); });
    assert.equal(h.trace.filter(item => item.method === 'POST' && item.path === '/api/projects').length, 1, 'the same confirmed ID is reused');
  } finally { await h.close(); }
});

test('mounted startup receives awaiting usage state and only a correlated successful receipt navigates; parsing and reads never enqueue', async () => {
  const h = await harness();
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().intake.addFiles([new File(['Synthetic: 10 kg'], 'source.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'local queue');
    await act(async () => { await h.get().intake.start(); });
    await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'source uploaded');
    let p = h.get().session.project!;
    await act(async () => { await new IngestionWorker(h.f.store, h.f.objects).tick(); });
    await act(async () => { await h.get().session.refresh(); });
    await act(async () => { await h.get().startup.start(); });
    await h.settle(() => h.navigations.length === 1, 'actual start receipt navigates');
    p = h.get().session.project!;
    assert.equal(h.navigations[0]!.projectId, p.id); assert.equal(p.production?.context?.versions.length, 1); assert.equal(p.runs.length, 0);
    await h.settle(() => h.get().status.status?.state === 'awaiting_usage_review', 'persisted waiting status shown');
    const material = p.production!.materials![0]!;
    await act(async () => { p = await h.f.write(p, `production/materials/${material.id}/usage`, { reason: 'Synthetic employee approves scope', decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })) }); });
    await act(async () => { await h.get().session.refresh(); });
    await h.settle(() => h.get().status.status?.state === 'ready_to_extract', 'manual usage review makes extraction available');
    assert.equal((await h.f.store.get(p.id)).runs.length, 0, 'usage and status GET never start a model run');
    await act(async () => { await h.get().session.setupCommand('continue-extraction', {}, h.get().session.getLatestProject()!); });
    await h.settle(() => h.get().status.status?.state === 'queued', 'explicit continue queues original scope');
    assert.equal(h.get().session.project?.runs.length, 1);
    await act(async () => { h.get().status.reload(); });
    await h.settle(() => h.get().status.current, 'reload status');
    assert.equal(h.get().session.project?.runs.length, 1);
    assert.equal(h.trace.some(item => item.path.includes('openrouter') || item.path.endsWith('/identity/confirm') || item.path.endsWith('/production/context/activate')), false);
  } finally { await h.close(); }
});

test('mounted existing uninitialized project uses its ID for first upload and preserves independent local drafts across project switches', async () => {
  const h = await harness();
  try {
    const existing = await h.f.create();
    await h.mount(); await h.connect();
    await act(async () => { await h.get().session.selectProject(existing.id); });
    await h.settle(() => h.get().intake.canSelect, 'existing project queue ready');
    await h.fill();
    await act(async () => { await h.get().intake.addFiles([new File(['10 kg'], 'existing.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'existing local file');
    await act(async () => { await h.get().intake.start(); });
    await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'existing project upload');
    assert.equal(h.get().session.project?.id, existing.id);
    assert.equal(h.trace.filter(item => item.method === 'POST' && item.path === '/api/projects').length, 0);
    assert.equal(h.get().session.project?.identity, undefined); assert.equal(h.get().session.project?.production?.startup, undefined);
    await act(async () => { await h.get().session.newLocalProject(); });
    await h.settle(() => h.get().context.canEdit, 'new local project ready');
    await act(async () => { h.get().context.setField('productName', 'Another local project'); });
    assert.notEqual(h.get().session.draftScope, existing.id);
    await act(async () => { await h.get().session.selectProject(existing.id); });
    assert.equal(h.get().context.form.productName, scopedContext.productBrief.productName);
  } finally { await h.close(); }
});

for (const stage of ['create', 'initialize', 'upload', 'start'] as const) test(`mounted ${stage} recovery preserves actual IndexedDB requests and stops after each fault`, async t => {
  for (const fault of ['401', 'lost-response', 'invalid-response', 'settlement'] as const) await t.test(fault, async () => {
    const h = await harness();
    const complete = setupRecoveryStorage.complete, settleMaterial = materialIntakeStorage.settle;
    try {
      await h.mount(); await h.connect(); await h.fill();
      await act(async () => { await h.get().intake.addFiles([new File(['Synthetic source: 10 kg'], 'recovery.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
      await h.settle(() => h.get().intake.entries.length === 1, 'recoverable local File');
      if (stage === 'start') {
        await act(async () => { await h.get().intake.start(); });
        await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'accepted startup source');
      }
      const matches = (path: string, method?: string) => method === 'POST' && (stage === 'create' ? path === '/api/projects' : path.endsWith(stage === 'initialize' ? '/production/initialize' : stage === 'upload' ? '/production/materials' : '/production/startup/start'));
      h.setIntercept(async (path, options, send) => {
        if (!matches(path, options?.method)) return send();
        if (fault === '401') return new Response('', { status: 401 });
        const response = await send();
        if (fault === 'lost-response') throw new Error('Response dropped after committed receipt');
        if (fault === 'invalid-response') return Response.json({ notAProject: true });
        return response;
      });
      setupRecoveryStorage.complete = async function (...args) {
        if (fault === 'settlement' && stage !== 'upload' && args[0].action === stage) throw new Error('Injected IndexedDB settlement failure');
        return complete.apply(setupRecoveryStorage, args);
      };
      materialIntakeStorage.settle = async function (...args) {
        if (fault === 'settlement' && stage === 'upload') throw new Error('Injected IndexedDB upload settlement failure');
        return settleMaterial.apply(materialIntakeStorage, args);
      };
      await act(async () => { if (stage === 'upload') await h.get().intake.start(); else await h.get().startup.start(); });
      await h.settle(() => !!h.get().session.pending && !h.get().session.busy, 'fault leaves a pending operation');
      const pending = h.get().session.pending!;
      assert.notEqual(pending.kind, 'standard'); if (pending.kind === 'standard') return;
      const body = pending.operation.prepared.body, scope = h.get().session.draftScope;
      let persisted: Awaited<ReturnType<typeof materialIntakeStorage.readPending>> | Awaited<ReturnType<typeof setupRecoveryStorage.readPending>>;
      await act(async () => { persisted = stage === 'upload' ? await materialIntakeStorage.readPending() : await setupRecoveryStorage.readPending(); });
      assert.equal(persisted?.prepared.body, body);
      assert.equal(JSON.stringify(persisted).includes(h.f.headers.authorization.slice(7)), false);
      if (stage === 'create') assert.equal(h.get().session.project, null, 'unknown ID remains unknown before receipt replay');
      const writes = h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length;
      await h.unmount(); await h.mount();
      assert.equal(h.get().session.token, ''); assert.equal(h.get().session.draftScope, scope);
      assert.equal(h.get().context.form.productName, scopedContext.productBrief.productName);
      assert.equal(h.get().session.recoveryNeedsCheck, true); assert.equal(h.get().session.canRetry, false);
      assert.equal(h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length, writes);
      setupRecoveryStorage.complete = complete; materialIntakeStorage.settle = settleMaterial; h.setIntercept();
      await h.connect();
      const readStart = h.trace.length;
      await act(async () => { await h.get().session.refresh(); });
      if (stage === 'create') {
        const reads = h.trace.slice(readStart);
        assert.ok(reads.some(item => item.path === '/api/projects' && item.method === 'GET'));
        assert.equal(reads.some(item => /^\/api\/projects\/.+/.test(item.path) && item.method === 'GET'), false, 'no guessed GET ID or name-based claim');
        assert.equal(h.get().session.project, null);
      }
      assert.equal(h.get().session.canRetry, true);
      await act(async () => { await h.get().session.retry(); });
      await h.settle(() => !h.get().session.pending && !h.get().session.busy, 'explicit replay completes');
      const repeated = h.trace.filter(item => matches(item.path, item.method));
      assert.equal(repeated.length, 2); assert.ok(repeated.every(item => item.body === body));
      assert.ok(h.get().session.project?.id);
      if (stage === 'create') {
        assert.equal(h.get().session.project?.production, undefined);
        assert.equal(h.trace.some(item => item.path.endsWith('/production/initialize')), false, 'replaying create alone does not continue initialization');
      }
      if (stage === 'initialize') { assert.equal(h.get().context.local.needsReview, false); assert.equal(h.get().session.project?.production?.startup, undefined); }
      if (stage === 'upload') assert.equal(h.get().session.project?.production?.materials?.length, 1);
      if (stage === 'start') {
        await h.settle(() => h.navigations.length === 1, 'explicit start replay delivers one navigation');
        assert.equal(h.get().session.startupReceipt, null, 'receipt is consumed at session level');
        await act(async () => { h.get().session.reloadMaterialRecovery(); });
        await h.settle(() => !h.get().session.recoveryLoading, 'same-scope setup remount');
        assert.equal(h.navigations.length, 1, 'an already consumed receipt cannot navigate after remount');
      } else assert.equal(h.navigations.length, 0);
      assert.equal(h.get().session.project?.facts.length, 0);
    } finally { setupRecoveryStorage.complete = complete; materialIntakeStorage.settle = settleMaterial; await h.close(); }
  });
});

for (const stage of ['create', 'initialize', 'start'] as const) test(`mounted ${stage} 409 persists its rejected request across reopening and requires read, review and a new explicit submission`, async () => {
  const h = await harness();
  try {
    await h.mount(); await h.connect(); await h.fill();
    if (stage === 'start') {
      await act(async () => { await h.get().intake.addFiles([new File(['10 kg'], 'conflict-source.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
      await h.settle(() => h.get().intake.entries.length === 1, 'local original');
      await act(async () => { await h.get().intake.start(); });
      await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'accepted original');
    }
    const matches = (item: Trace) => item.method === 'POST' && (stage === 'create' ? item.path === '/api/projects' : item.path.endsWith(stage === 'initialize' ? '/production/initialize' : '/production/startup/start'));
    let injected = false;
    h.setIntercept(async (path, options, send) => {
      if (!matches({ path, method: options?.method ?? 'GET' }) || injected) return send();
      injected = true;
      if (stage === 'create') return Response.json({ error: { code: 'IDEMPOTENCY_CONFLICT' } }, { status: 409 });
      const before = h.get().session.getLatestProject()!;
      await h.f.write(before, 'evidence', { documentName: 'Concurrent employee source', locator: 'line 1', usage: 'product_evidence', text: 'Synthetic business change: 11 kg' });
      return send();
    });
    await act(async () => { await h.get().startup.start(); });
    await h.settle(() => h.get().session.setupRejected && !h.get().session.busy, '409 is explicitly rejected');
    const pending = h.get().session.pending;
    assert.equal(pending?.kind, 'setup'); if (pending?.kind !== 'setup') return;
    const body = pending.operation.prepared.body, original = JSON.parse(body) as { expectedRevision: number; idempotencyKey: string };
    assert.equal(pending.operation.rejected, true);
    assert.equal(h.trace.filter(matches).length, 1, 'setup never applies the upload parser rebase exception');
    let stored: Awaited<ReturnType<typeof setupRecoveryStorage.readPending>>;
    await act(async () => { stored = await setupRecoveryStorage.readPending(); });
    assert.equal(stored?.prepared.body, body); assert.equal(stored?.rejected, true);
    assert.equal(h.navigations.length, 0);
    h.setIntercept();
    const writes = h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length;
    await h.unmount(); await h.mount(); await h.connect();
    assert.equal(h.get().session.setupRejected, true); assert.equal(h.get().session.canRetry, false);
    await act(async () => { await h.get().session.retry(); await h.get().session.releaseSetupRequest(); });
    assert.ok(h.get().session.pending, 'unread request cannot be released');
    await act(async () => { await h.get().session.refresh(); await h.get().session.retry(); });
    assert.equal(h.get().session.recoveryNeedsCheck, false); assert.equal(h.get().session.canRetry, false);
    assert.equal(h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length, writes, 'reopen, read and retry cannot send a rejected operation');
    assert.equal(h.get().context.form.productName, scopedContext.productBrief.productName);
    await act(async () => { await h.get().session.releaseSetupRequest(); });
    assert.equal(h.get().session.pending, null); assert.equal(h.get().session.setupRejected, false);
    const latestRevision = h.get().session.project?.revision ?? 0;
    await act(async () => { if (stage === 'start') await h.get().startup.start(); else await h.get().session.ensureSetupProject(); });
    const attempts = h.trace.filter(matches);
    assert.equal(attempts.length, 2);
    const next = JSON.parse(attempts[1]!.body!) as typeof original;
    assert.notEqual(next.idempotencyKey, original.idempotencyKey);
    assert.equal(next.expectedRevision, latestRevision, 'new explicit operation uses the reviewed current snapshot');
    assert.ok(h.get().session.project?.production);
    if (stage === 'start') await h.settle(() => h.navigations.length === 1, 'only the new successful start receipt navigates');
    else assert.equal(h.navigations.length, 0);
  } finally { await h.close(); }
});

test('mounted upload business 409 pauses its local File, survives reopening without upload, and retries only from the reviewed snapshot', async () => {
  const h = await harness();
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().intake.addFiles([new File(['10 kg'], 'upload-conflict.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'original queued');
    let injected = false;
    h.setIntercept(async (path, options, send) => {
      if (!injected && options?.method === 'POST' && path.endsWith('/production/materials')) {
        injected = true;
        await h.f.write(h.get().session.getLatestProject()!, 'evidence', { documentName: 'Concurrent business change', locator: 'line 1', usage: 'product_evidence', text: '11 kg' });
      }
      return send();
    });
    await act(async () => { await h.get().intake.start(); });
    await h.settle(() => !!h.get().session.conflictBefore && !h.get().intake.running, 'upload paused on business conflict');
    const uploads = () => h.trace.filter(item => item.method === 'POST' && item.path.endsWith('/production/materials'));
    assert.equal(uploads().length, 1, 'business differences do not qualify for a parser-only rebase');
    const original = JSON.parse(uploads()[0]!.body!) as { idempotencyKey: string; expectedRevision: number };
    h.setIntercept(); await h.unmount(); await h.mount(); await h.connect();
    await h.settle(() => h.get().intake.entries.length === 1, 'conflicted original retained');
    assert.equal(uploads().length, 1); assert.equal(h.get().intake.entries[0]!.status, 'conflict');
    await act(async () => { await h.get().session.refresh(); h.get().session.resolveConflict(); });
    assert.equal(uploads().length, 1);
    const revision = h.get().session.project!.revision;
    await act(async () => { await h.get().intake.retryLocal(h.get().intake.entries[0]!); });
    await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'explicit retry uploads preserved original');
    assert.equal(uploads().length, 2);
    const next = JSON.parse(uploads()[1]!.body!) as typeof original;
    assert.notEqual(next.idempotencyKey, original.idempotencyKey); assert.equal(next.expectedRevision, revision);
    assert.equal(h.get().session.project?.production?.startup, undefined); assert.equal(h.navigations.length, 0);
  } finally { await h.close(); }
});

test('startup receipt arriving before the matching project render is delivered after alignment exactly once', async () => {
  const h = await harness(); let controlled: Renderer | undefined;
  try {
    await h.mount();
    let before = await h.f.create();
    before = await h.f.write(before, 'production/initialize');
    before = await h.f.write(before, 'production/context/draft', { context: scopedContext });
    before = await h.f.write(before, 'evidence', { documentName: 'synthetic', locator: 'line 1', usage: 'product_evidence', text: '10 kg' });
    const client = new StageAApi(h.f.headers.authorization.slice(7));
    const checked = await client.startupCheck(before.id, scopedContext);
    const key = crypto.randomUUID();
    const response = await h.f.post(`/api/projects/${before.id}/production/startup/start`, { context: scopedContext, inputFingerprint: checked.inputFingerprint, expectedProjectVersion: before.version, expectedRevision: before.revision, idempotencyKey: key });
    assert.equal(response.statusCode, 200);
    const saved = response.json<{ project: typeof before; startup: NonNullable<ProjectSession['startupReceipt']>['startup'] }>();
    const receipt: NonNullable<ProjectSession['startupReceipt']> = { ...saved, scopeId: before.id, token: '', key, context: scopedContext, form: contextForm(scopedContext, 'scoped-rules.1') };
    let visible = before, consumed = false, navigations = 0;
    function ReceiptProbe() {
      const s: ProjectSession = { ...h.get().session, project: visible, getLatestProject: () => visible, draftScope: before.id, getCurrentScope: () => before.id,
        token: '', getCurrentToken: () => '', canWrite: false, canEditSetup: false, catalog: [], scopedCatalog: [scopedRule], startupReceipt: consumed ? null : receipt,
        registerSetupDraft: () => undefined, consumeStartupReceipt: candidate => { assert.equal(candidate, key); if (consumed) return false; consumed = true; return true; } };
      const context = useProjectContext(s); useProjectStartup(s, context, () => { navigations++; }, () => undefined); return null;
    }
    await act(async () => { controlled = renderer.create(createElement(ReceiptProbe)); });
    assert.equal(navigations, 0); assert.equal(consumed, false, 'uncorrelated receipt is not consumed or marked delivered');
    await act(async () => { visible = saved.project; controlled!.update(createElement(ReceiptProbe)); });
    assert.equal(navigations, 1); assert.equal(consumed, true);
    await act(async () => { controlled!.update(createElement(ReceiptProbe)); });
    assert.equal(navigations, 1);
  } finally { if (controlled) await act(async () => controlled!.unmount()); await h.close(); }
});

test('a held startup check cannot submit after a same-batch input change, and old handlers cannot start another local namespace', async () => {
  const h = await harness(); let release: (() => void) | undefined;
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().session.ensureSetupProject(); });
    await h.settle(() => !!h.get().startup.check, 'initial check');
    let held = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.setIntercept(async (path, options, send) => {
      const result = await send();
      if (!held && path.endsWith('/check') && options?.method === 'POST') { held = true; await gate; }
      return result;
    });
    const edit = h.get().context.setField;
    let request: Promise<void> | undefined;
    await act(async () => { request = h.get().startup.start(); await delay(0); });
    await h.settle(() => held, 'manual check held after server response');
    await act(async () => { edit('introduction', 'Newer input in the same React batch'); release!(); await request; });
    assert.equal(h.get().context.form.introduction, 'Newer input in the same React batch');
    assert.equal(h.trace.some(item => item.path.endsWith('/start')), false); assert.equal(h.navigations.length, 0);
    h.setIntercept();
    const oldStart = h.get().startup.start, oldScope = h.get().session.draftScope;
    await act(async () => { await h.get().session.newLocalProject(); });
    await h.settle(() => h.get().context.canEdit, 'second local project');
    await act(async () => { h.get().context.setField('productName', 'Second namespace'); await oldStart(); });
    assert.notEqual(h.get().session.draftScope, oldScope); assert.equal(h.get().session.project, null);
    assert.equal(h.get().context.form.productName, 'Second namespace');
    assert.equal(h.trace.filter(item => item.method === 'POST' && item.path === '/api/projects').length, 1);
  } finally { release?.(); await h.close(); }
});

test('a create response arriving after unmount confirms only its old receipt and never continues initialization', async () => {
  const h = await harness(); let release: (() => void) | undefined;
  try {
    await h.mount(); await h.connect(); await h.fill();
    const scope = h.get().session.draftScope;
    let held = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.setIntercept(async (path, options, send) => {
      const result = await send();
      if (path === '/api/projects' && options?.method === 'POST') { held = true; await gate; }
      return result;
    });
    let request: Promise<void> | undefined;
    await act(async () => { request = h.get().startup.start(); await delay(0); });
    await h.settle(() => held, 'create committed but reply delayed');
    await h.unmount();
    await act(async () => { release!(); await request; });
    assert.equal(h.trace.some(item => item.path.endsWith('/production/initialize')), false);
    assert.equal(h.navigations.length, 0);
    h.setIntercept(); await h.mount();
    assert.equal(h.get().session.draftScope, scope); assert.ok(h.get().session.project?.id);
    assert.equal(h.get().session.project?.production, undefined);
    assert.equal(h.get().context.form.productName, scopedContext.productBrief.productName);
    assert.equal(h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length, 1);
  } finally { release?.(); await h.close(); }
});

test('IndexedDB failure before the first HTTP request retains the frozen operation and local File, while unavailable localStorage restores through IndexedDB', async () => {
  const h = await harness(), save = setupRecoveryStorage.save;
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().intake.addFiles([new File(['10 kg'], 'durable.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'File persisted');
    setupRecoveryStorage.save = async () => { throw new Error('Injected quota failure'); };
    await act(async () => { await h.get().startup.start(); });
    assert.equal(h.trace.filter(item => item.method === 'POST').length, 0);
    const pending = h.get().session.pending;
    assert.equal(pending?.kind, 'setup'); if (pending?.kind !== 'setup') return;
    const body = pending.operation.prepared.body;
    setupRecoveryStorage.save = save;
    await act(async () => { await h.get().session.retry(); });
    assert.equal(h.trace.find(item => item.method === 'POST')?.body, body);
    const id = h.get().session.project!.id, scope = h.get().session.draftScope;
    await h.unmount();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => { throw new Error('Local storage unavailable'); }, setItem: () => { throw new Error('Local storage unavailable'); } } });
    await h.mount();
    assert.equal(h.get().session.project?.id, id); assert.equal(h.get().session.draftScope, scope);
    assert.equal(h.get().context.form.productName, scopedContext.productBrief.productName);
    assert.equal(h.get().intake.entries.length, 1);
    assert.equal(h.trace.filter(item => item.method === 'POST').length, 1);
  } finally { setupRecoveryStorage.save = save; await h.close(); }
});

test('a File read from an unmounted session cannot upload or change the next local project', async () => {
  const h = await harness(); let release: (() => void) | undefined;
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().session.ensureSetupProject(); });
    await h.settle(() => h.get().intake.canSelect, 'original project ready');
    await act(async () => { await h.get().intake.addFiles([new File(['10 kg'], 'delayed-read.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'File durable before reading');
    const entry = h.get().intake.entries[0]!, read = entry.file.arrayBuffer.bind(entry.file), oldId = h.get().session.project!.id;
    let held = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Object.defineProperty(entry.file, 'arrayBuffer', { configurable: true, value: async () => { held = true; await gate; return read(); } });
    let pendingRead: ReturnType<ProjectSession['uploadMaterial']> | undefined;
    await act(async () => { pendingRead = h.get().session.uploadMaterial(entry); await delay(0); });
    await h.settle(() => held, 'File bytes held before operation preparation');
    await h.unmount(); await h.mount();
    await act(async () => { await h.get().session.newLocalProject(); h.get().context.setField('productName', 'New local input'); });
    await act(async () => { h.get().context.setField('productName', 'New local input'); release!(); await pendingRead; });
    assert.equal(h.trace.some(item => item.path.endsWith('/production/materials')), false);
    assert.equal(h.get().session.project, null); assert.equal(h.get().context.form.productName, 'New local input');
    let originals: Awaited<ReturnType<typeof materialIntakeStorage.list>> = [];
    await act(async () => { originals = await materialIntakeStorage.list(oldId); });
    assert.equal(originals.length, 1); assert.equal(originals[0]!.status, 'waiting'); assert.equal(h.navigations.length, 0);
  } finally { release?.(); await h.close(); }
});

test('a held startup GET is discarded after a namespace switch and a held check cannot start after a token change', async () => {
  const h = await harness(); let release: (() => void) | undefined;
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().session.ensureSetupProject(); });
    await h.settle(() => h.get().status.current && !!h.get().startup.check, 'original reads settled');
    let held = false;
    let gate = new Promise<void>(resolve => { release = resolve; });
    h.setIntercept(async (path, options, send) => { const result = await send(); if (path.endsWith('/production/startup') && !options?.body) { held = true; await gate; } return result; });
    await act(async () => { h.get().status.reload(); });
    await h.settle(() => held, 'old status held');
    await act(async () => { await h.get().session.newLocalProject(); });
    await act(async () => { h.get().context.setField('productName', 'Next namespace'); release!(); });
    await h.settle(() => !h.get().status.loading, 'old status ignored');
    assert.equal(h.get().session.project, null); assert.equal(h.get().status.status, null);
    assert.equal(h.get().context.form.productName, 'Next namespace');
    h.setIntercept(); await h.fill();
    await act(async () => { await h.get().session.ensureSetupProject(); });
    await h.settle(() => !!h.get().startup.check, 'new project check');
    held = false; gate = new Promise<void>(resolve => { release = resolve; });
    h.setIntercept(async (path, options, send) => { const result = await send(); if (path.endsWith('/check') && options?.method === 'POST') { held = true; await gate; } return result; });
    let request: Promise<void> | undefined;
    await act(async () => { request = h.get().startup.start(); await delay(0); });
    await h.settle(() => held, 'manual check held');
    await act(async () => { h.get().session.setToken(''); release!(); await request; });
    assert.equal(h.trace.some(item => item.path.endsWith('/start')), false); assert.equal(h.navigations.length, 0);
    assert.equal(h.get().context.form.productName, scopedContext.productBrief.productName);
  } finally { release?.(); await h.close(); }
});

test('mounted Facts panel lists append-only additions, retains the reason across changed proposals and requires explicit scope confirmation without queueing', async () => {
  const assets = registerHooks({ load(url, context, next) { return /\.(png|jpe?g|webp|svg)(?:\?|$)/.test(url) ? { format: 'module', source: `export default ${JSON.stringify(url)}`, shortCircuit: true } : next(url, context); } });
  const { StartupFactsPanel } = await tsImport('../../src/pages/ArcaneWarriorPage/StartupFactsPanel.tsx', { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../tsconfig.app.json', import.meta.url)) }).finally(() => assets.deregister());
  const h = await harness(StartupFactsPanel);
  const content = (node: string | RenderNode): string => typeof node === 'string' ? node : node.children.map(content).join('');
  const button = (text: string) => { const found = h.root().findAllByType('button').find(node => content(node) === text); assert.ok(found, `Button exists: ${text}`); return found; };
  const click = async (text: string) => { const node = button(text); assert.notEqual(node.props.disabled, true, `Button enabled: ${text}`); await act(async () => { (node.props.onClick as () => void)(); }); };
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().intake.addFiles([new File(['{broken'], 'broken.json', { type: 'application/json' })], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'broken original selected');
    await act(async () => { await h.get().intake.start(); });
    await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'broken original accepted');
    await act(async () => { await new IngestionWorker(h.f.store, h.f.objects).tick(); });
    await act(async () => { await h.get().session.refresh(); await h.get().startup.start(); });
    await h.settle(() => h.get().status.status?.state === 'awaiting_product_evidence', 'startup waiting after parse failure');
    const failed = structuredClone(h.get().session.project!.production!.materials![0]!);
    await h.settle(() => h.get().intake.canSelect, 'select explicit supplemental original');
    await act(async () => { await h.get().intake.addFiles([new File(['Corrected: 10 kg'], 'corrected.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'supplemental original selected');
    await act(async () => { await h.get().intake.start(); });
    await h.settle(() => h.get().intake.materials.length === 2 && !h.get().intake.running && h.get().status.status?.scopeRefresh.canRefresh === true, 'scope proposal visible');
    await h.settle(() => h.root().findAllByType('textarea').length === 1, 'scope reason field displayed');
    assert.match(content(h.root()), /corrected.txt/); assert.match(content(h.root()), /broken.json/);
    assert.equal(button('确认加入列出的补充资料').props.disabled, true);
    await act(async () => { (h.root().findAllByType('textarea')[0]!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Reviewed corrected original and added source' } }); });
    const oldConfirm = button('确认加入列出的补充资料').props.onClick as () => void;
    let project = h.get().session.project!;
    await act(async () => { project = await h.f.write(project, 'evidence', { documentName: 'Later reviewed manual source', locator: 'line 1', usage: 'product_evidence', text: '10 kg' }); });
    await act(async () => { await h.get().session.refresh(); });
    await h.settle(() => content(h.root()).includes('补充范围已变化'), 'reason requires review against changed fingerprint');
    await act(async () => { oldConfirm(); });
    assert.equal(h.trace.some(item => item.path.endsWith('/scope-refresh')), false, 'stale callback cannot confirm a changed proposal');
    assert.equal(h.root().findAllByType('textarea')[0]!.props.value, 'Reviewed corrected original and added source');
    await click('已核对最新资料范围，保留原因');
    await click('确认加入列出的补充资料');
    await h.settle(() => h.get().session.project?.production?.startup?.scope.version === 2 && !h.get().session.busy, 'explicit append-only scope receipt');
    const saved = h.get().session.project!, scope = saved.production!.startup!.scope;
    assert.equal(saved.runs.length, 0); assert.deepEqual(saved.production!.materials!.find(item => item.id === failed.id), failed);
    assert.deepEqual(scope.materials.map(item => item.id).sort(), saved.production!.materials!.map(item => item.id).sort());
    assert.deepEqual(scope.manualEvidence.map(item => item.id), [project.evidence.at(-1)!.id]);
    assert.equal(saved.production!.startup!.history.at(-1)!.reason, 'Reviewed corrected original and added source');
    assert.equal(h.trace.filter(item => item.path.endsWith('/scope-refresh')).length, 1);
    assert.equal(h.trace.some(item => item.path.endsWith('/continue-extraction')), false);
  } finally { await h.close(); }
});
