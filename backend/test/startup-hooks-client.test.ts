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
import type { StartupCheck, StartupFinding, StartupRead, StartupStatus } from '../../src/pages/ArcaneWarriorPage/startup-contract.js';
import { StageAApi, type Project } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';
import { draftKey } from '../../src/pages/ArcaneWarriorPage/project-drafts.js';

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

const content = (node: string | RenderNode): string => typeof node === 'string' ? node : node.children.map(content).join('');
async function harness(panel?: ComponentType<{ session: ProjectSession; context: Mounted['context']; onStage: () => void }>) {
  const f = await fixture(catalog, synthetic), base = await f.app.listen({ port: 0, host: '127.0.0.1' });
  const globals = new Map(['localStorage', 'indexedDB', 'IDBKeyRange', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const local = new Map<string, string>(), trace: Trace[] = [], navigations: { projectId: string | undefined; scope: string }[] = [], findings: StartupFinding[] = [];
  const nativeFetch = globalThis.fetch;
  let intercept: Intercept | undefined, eventIntercept: Intercept | undefined, instance: Renderer | undefined, latest: Mounted | undefined;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value), removeItem: (key: string) => local.delete(key) } });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDB });
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: (path: string | URL | Request, options?: RequestInit) => {
    const url = String(path);
    if (url.includes('/events') && eventIntercept) return eventIntercept(url, options, () => nativeFetch(`${base}${url}`, options));
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
    return panel ? createElement(panel, { session, context, onStage: () => undefined }) : null;
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
  return { f, get, local, trace, findings, navigations, mount, unmount, connect, fill, settle, root: () => instance!.root, setIntercept: (value?: Intercept) => { intercept = value; }, setEventIntercept: (value?: Intercept) => { eventIntercept = value; },
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

async function completedStartup(h: Awaited<ReturnType<typeof harness>>) {
  await h.mount(); await h.connect(); await h.fill();
  await act(async () => { await h.get().intake.addFiles([new File(['Synthetic: 10 kg'], 'restored-startup.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
  await h.settle(() => h.get().intake.entries.length === 1, 'local original queued');
  await act(async () => { await h.get().intake.start(); });
  await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'original accepted');
  await act(async () => { await new IngestionWorker(h.f.store, h.f.objects).tick(); });
  await act(async () => { await h.get().session.refresh(); });
  await act(async () => { await h.get().startup.start(); });
  await h.settle(() => h.navigations.length === 1, 'startup receipt consumed');
  return h.get().session.project!;
}

test('restored startup renders editable credentials and waits for an exact project GET before any business write', async () => {
  const assets = registerHooks({ load(url, context, next) { return /\.(png|jpe?g|webp|svg)(?:\?|$)/.test(url) ? { format: 'module', source: `export default ${JSON.stringify(url)}`, shortCircuit: true } : next(url, context); } });
  const { ProjectEntryFields } = await tsImport('../../src/pages/ArcaneWarriorPage/ProjectEntryFields.tsx', { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../tsconfig.app.json', import.meta.url)) }).finally(() => assets.deregister());
  const h = await harness(ProjectEntryFields);
  try {
    const saved = await completedStartup(h), token = h.f.headers.authorization.slice(7);
    const businessWrites = () => h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length;
    const writes = businessWrites();
    await h.unmount(); await h.mount();
    assert.equal(h.get().session.project?.id, saved.id); assert.equal(h.get().session.project?.production?.startup?.id, saved.production!.startup!.id);
    assert.equal(h.get().session.project?.production?.context?.activeVersion, 1); assert.equal(h.get().intake.materials.length, 1);
    assert.equal(h.get().session.token, ''); assert.equal(h.get().session.canWrite, false); assert.equal(h.get().session.canPrepareSetup, false);
    const credential = () => h.root().findAllByType('input').find(node => node.props.type === 'password')!;
    assert.equal(credential().props.disabled, false, 'a restored project must not lock its empty credential field');
    for (let length = 1; length <= token.length; length++) {
      assert.equal(credential().props.disabled, false, 'typing the first character must not prevent completing the credential');
      await act(async () => { (credential().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: token.slice(0, length) } }); });
      assert.equal(h.get().session.canWrite, false); assert.equal(h.get().session.canPrepareSetup, false);
    }
    await h.settle(() => h.get().session.catalog !== null, 'full credential reads the catalog');
    await act(async () => { await h.get().session.listProjects(); });
    assert.ok(h.get().session.projects.some(project => project.id === saved.id));
    assert.equal(h.get().session.canWrite, false); assert.equal(h.get().session.canPrepareSetup, false, 'catalog and list cannot verify the restored project');
    await act(async () => {
      await h.get().session.write('evidence', { documentName: 'Blocked source', locator: 'line 1', usage: 'product_evidence', text: '11 kg' }, 'blocked');
      await h.get().session.setupCommand('continue-extraction', {}, h.get().session.project!);
      await h.get().session.ensureSetupProject(); await h.get().session.create('Blocked replacement');
    });
    assert.equal(businessWrites(), writes, 'both button gates and handlers block business writes before exact GET');
    const readCurrent = h.root().findAllByType('button').find(node => content(node) === '读取当前项目')!;
    assert.equal(readCurrent.props.disabled, false);
    await act(async () => { (readCurrent.props.onClick as () => void)(); });
    await h.settle(() => h.get().session.canWrite, 'the actual current-project button finishes the exact GET');
    assert.equal(h.get().session.canPrepareSetup, true);
    assert.equal(h.get().session.project?.id, saved.id); assert.equal(businessWrites(), writes);
    await act(async () => { await h.get().session.write('evidence', { documentName: 'Verified source', locator: 'line 1', usage: 'product_evidence', text: '11 kg' }, 'saved'); });
    assert.equal(businessWrites(), writes + 1);
    await act(async () => { h.get().session.setToken('replaced-credential'); });
    assert.equal(h.get().session.canWrite, false); assert.equal(h.get().session.canPrepareSetup, false);
    await act(async () => { h.get().session.setToken(token); });
    await h.settle(() => h.get().session.catalog !== null, 'replacement credential catalog');
    await act(async () => { await h.get().session.listProjects(); });
    assert.equal(h.get().session.canWrite, false, 'restoring the same token value still requires a new project read');
    await act(async () => { await h.get().session.selectProject(saved.id); });
    assert.equal(h.get().session.canWrite, true); assert.equal(h.get().session.canPrepareSetup, true, 'exact-ID open verifies this project');
    assert.ok(!JSON.stringify([...h.local]).includes(token));
    let flow: Awaited<ReturnType<typeof setupRecoveryStorage.readFlow>>;
    await act(async () => { flow = await setupRecoveryStorage.readFlow(h.get().session.draftScope); });
    assert.ok(!JSON.stringify(flow).includes(token), 'credential verification is never persisted in the recovery flow');
  } finally { await h.close(); }
});

test('failed, mismatched and late exact project GETs revoke verification without replacing the restored project', async () => {
  const h = await harness(); let release: (() => void) | undefined;
  try {
    const saved = await completedStartup(h), token = h.f.headers.authorization.slice(7);
    let other!: Project; await act(async () => { other = await h.f.create(); });
    for (const fault of ['401', '503', 'invalid', 'other-project', 'transport'] as const) {
      h.setIntercept(); await act(async () => { h.get().session.setToken(''); }); await h.connect();
      await act(async () => { await h.get().session.refresh(); }); assert.equal(h.get().session.canWrite, true);
      h.setIntercept(async (path, options, send) => {
        if (path !== `/api/projects/${saved.id}` || (options?.method ?? 'GET') !== 'GET') return send();
        if (fault === '401' || fault === '503') return new Response('{}', { status: Number(fault) });
        if (fault === 'invalid') return Response.json({ incomplete: true });
        if (fault === 'other-project') return Response.json(other);
        await send(); throw new Error('Exact GET response lost');
      });
      await act(async () => { await h.get().session.refresh(); });
      assert.equal(h.get().session.canWrite, false, fault); assert.equal(h.get().session.canPrepareSetup, false, fault);
      assert.equal(h.get().session.project?.id, saved.id, fault);
    }
    h.setIntercept(); await act(async () => { h.get().session.setToken(''); }); await h.connect();
    await act(async () => { await h.get().session.refresh(); });
    let held = false; const gate = new Promise<void>(resolve => { release = resolve; });
    h.setIntercept(async (path, options, send) => { const response = await send(); if (path === `/api/projects/${saved.id}` && (options?.method ?? 'GET') === 'GET') { held = true; await gate; } return response; });
    let pending: Promise<unknown> | undefined;
    await act(async () => { pending = h.get().session.refresh(); }); await h.settle(() => held, 'exact GET is held');
    await act(async () => { h.get().session.setToken('changed-while-reading'); h.get().session.setToken(token); });
    await act(async () => { release!(); await pending; });
    assert.equal(h.get().session.canWrite, false); assert.equal(h.get().session.canPrepareSetup, false, 'a late GET cannot verify a later credential session even after the same token is re-entered');
    assert.equal(h.get().session.project?.id, saved.id);
  } finally { release?.(); await h.close(); }
});

test('an SSE connection alone cannot verify a restored project until its exact project GET finishes', async () => {
  const h = await harness(); let release: (() => void) | undefined;
  try {
    const saved = await completedStartup(h);
    await h.unmount(); await h.mount();
    const writes = h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length;
    let held = false; const gate = new Promise<void>(resolve => { release = resolve; });
    h.setEventIntercept((_path, _options, send) => send());
    h.setIntercept(async (path, options, send) => { const response = await send(); if (path === `/api/projects/${saved.id}` && (options?.method ?? 'GET') === 'GET') { held = true; await gate; } return response; });
    await h.connect(); await h.settle(() => held && h.get().session.eventsStatus === '任务状态自动更新', 'real SSE connected and its project GET is held');
    assert.equal(h.get().session.canWrite, false); assert.equal(h.get().session.canPrepareSetup, false);
    await act(async () => { release!(); }); await h.settle(() => h.get().session.canWrite, 'exact GET from event refresh verifies the current project');
    assert.equal(h.get().session.canPrepareSetup, true); assert.equal(h.get().session.project?.id, saved.id);
    assert.equal(h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length, writes);
  } finally { release?.(); await h.close(); }
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
    assert.equal(h.get().session.projectVerified, false, 'a new local namespace does not inherit the previous project verification');
    assert.equal(h.get().session.canWrite, false);
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
  const { SetupRequestReview } = await tsImport('../../src/pages/ArcaneWarriorPage/SetupRequestReview.tsx', { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../tsconfig.app.json', import.meta.url)) });
  const h = await harness(SetupRequestReview);
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
    assert.match(content(h.root()), /冻结输入修订/);
    assert.ok(content(h.root()).includes(stage)); assert.ok(content(h.root()).includes(original.idempotencyKey));
    assert.ok(content(h.root()).includes(scopedContext.productBrief.productName));
    assert.ok(content(h.root()).includes(pending.operation.rejection!.code));
    assert.match(content(h.root()), /请先读取最新项目/);
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
    assert.match(content(h.root()), stage === 'create' ? /已读取项目列表/ : /原请求与当前 R/);
    if (stage !== 'create') assert.ok(content(h.root()).includes('Concurrent employee source'), 'comparison exposes the actual concurrent business change');
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
  const h = await harness(), releaseConflict = materialIntakeStorage.releaseConflict;
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
    assert.ok(h.get().session.conflictBefore); assert.equal(h.get().session.pending?.kind, 'material');
    assert.equal(h.get().session.canWrite, false); assert.equal(h.get().session.canRetry, false); assert.equal(h.get().session.canResolveConflict, false);
    await act(async () => { await h.get().session.resolveConflict(); await h.get().intake.retryLocal(h.get().intake.entries[0]!); });
    assert.equal(uploads().length, 1); assert.ok(h.get().session.pending);
    await act(async () => { await h.get().session.refresh(); });
    assert.equal(h.get().session.canResolveConflict, true); assert.equal(h.get().session.canWrite, false);
    await act(async () => { await h.get().intake.retryLocal(h.get().intake.entries[0]!); await h.get().session.retry(); });
    assert.equal(uploads().length, 1, 'reading without human resolution never reopens writing');
    materialIntakeStorage.releaseConflict = async () => { throw new Error('Injected conflict release failure'); };
    await act(async () => { await h.get().session.resolveConflict(); });
    assert.ok(h.get().session.conflictBefore); assert.ok(h.get().session.pending); assert.equal(h.get().session.canWrite, false);
    assert.equal(h.get().intake.entries[0]!.status, 'conflict'); assert.equal(uploads().length, 1);
    await h.unmount(); await h.mount(); await h.connect();
    assert.equal(h.get().session.canResolveConflict, false, 'failed release cannot erase the durable review gate');
    assert.ok(h.get().session.conflictBefore); assert.equal(h.get().session.pending?.kind, 'material');
    materialIntakeStorage.releaseConflict = releaseConflict;
    await act(async () => { await h.get().session.refresh(); });
    await act(async () => { await h.get().session.resolveConflict(); });
    assert.equal(h.get().session.conflictBefore, null); assert.equal(h.get().session.pending, null);
    await h.settle(() => h.get().intake.canStart && h.get().intake.entries[0]?.status === 'waiting', 'atomic conflict release requeues the preserved File');
    assert.equal(uploads().length, 1);
    const revision = h.get().session.project!.revision;
    await act(async () => { await h.get().intake.retryLocal(h.get().intake.entries[0]!); });
    await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'explicit retry uploads preserved original');
    assert.equal(uploads().length, 2);
    const next = JSON.parse(uploads()[1]!.body!) as typeof original;
    assert.notEqual(next.idempotencyKey, original.idempotencyKey); assert.equal(next.expectedRevision, revision);
    assert.equal(h.get().session.project?.production?.startup, undefined); assert.equal(h.navigations.length, 0);
  } finally { materialIntakeStorage.releaseConflict = releaseConflict; await h.close(); }
});

for (const fault of ['before-commit', 'after-commit'] as const) test(`mounted upload conflict persistence failure ${fault} recovers locally before read and human review without replaying HTTP`, async () => {
  const h = await harness(), settleConflict = materialIntakeStorage.settle;
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().intake.addFiles([new File(['10 kg'], 'conflict-persistence.txt', { type: 'text/plain' })], { kind: 'local_upload' }); });
    await h.settle(() => h.get().intake.entries.length === 1, 'original queued');
    let injected = false, persistenceAttempts = 0;
    h.setIntercept(async (path, options, send) => {
      if (!injected && options?.method === 'POST' && path.endsWith('/production/materials')) {
        injected = true;
        await h.f.write(h.get().session.getLatestProject()!, 'evidence', { documentName: 'Concurrent business change', locator: 'line 1', usage: 'product_evidence', text: '11 kg' });
      }
      return send();
    });
    materialIntakeStorage.settle = async (...args) => {
      if (args[1] !== 'conflict') return settleConflict.apply(materialIntakeStorage, args);
      persistenceAttempts++;
      if (fault === 'after-commit') await settleConflict.apply(materialIntakeStorage, args);
      throw new Error('Injected conflict persistence failure');
    };
    await act(async () => { await h.get().intake.start(); });
    await h.settle(() => {
      const { session, intake } = h.get();
      return session.pending?.kind === 'material' && !!session.pending.operation.conflict && !intake.running && !session.busy;
    }, 'received conflict remains pending after persistence failure');
    const pending = h.get().session.pending; assert.equal(pending?.kind, 'material'); if (pending?.kind !== 'material') return;
    const frozen = structuredClone(pending.operation);
    const uploads = () => h.trace.filter(item => item.method === 'POST' && item.path.endsWith('/production/materials'));
    const businessWrites = () => h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length;
    const writes = businessWrites();
    assert.equal(uploads().length, 1); assert.equal(uploads()[0]!.body, frozen.prepared.body);
    assert.equal(persistenceAttempts, 1); assert.equal(h.get().session.canWrite, false);
    assert.equal(h.get().session.canResolveConflict, false); assert.equal(h.get().session.canRetry, true, 'the failed local save has an explicit recovery action');
    await act(async () => { await h.get().session.refresh(); await h.get().session.resolveConflict(); });
    assert.equal(h.get().session.canResolveConflict, false, 'reading cannot release an unpersisted conflict');
    await act(async () => { h.get().session.setToken(''); });
    await act(async () => { await h.get().session.retry(); });
    assert.equal(persistenceAttempts, 2, 'local persistence recovery does not require a credential');
    assert.equal(h.get().session.canRetry, true); assert.equal(h.get().session.canResolveConflict, false);
    assert.equal(businessWrites(), writes, 'a repeated persistence failure never replays the upload');
    materialIntakeStorage.settle = settleConflict;
    await act(async () => { await h.get().session.retry(); });
    let durable: Awaited<ReturnType<typeof materialIntakeStorage.readPending>>;
    await act(async () => { durable = await materialIntakeStorage.readPending(); }); assert.ok(durable?.conflict);
    assert.deepEqual(durable, frozen, 'local recovery persists the same before, body, key, File reference and conflict');
    await h.settle(() => h.get().intake.entries[0]?.status === 'conflict', 'File and conflict are persisted together');
    assert.equal(h.get().session.canRetry, false); assert.equal(h.get().session.canResolveConflict, false);
    assert.equal(h.get().session.recoveryNeedsCheck, true, 'a read before persistence cannot acknowledge the saved conflict');
    assert.equal(businessWrites(), writes);
    h.setIntercept(); await h.unmount(); await h.mount(); await h.connect();
    assert.ok(h.get().session.conflictBefore); assert.equal(h.get().session.canWrite, false);
    assert.equal(h.get().session.canRetry, false); assert.equal(h.get().session.canResolveConflict, false);
    assert.equal(businessWrites(), writes, 'reopening the now-durable conflict never writes');
    await act(async () => { await h.get().session.refresh(); });
    assert.equal(h.get().session.canResolveConflict, true);
    await act(async () => { await h.get().session.retry(); await h.get().intake.retryLocal(h.get().intake.entries[0]!); });
    assert.equal(businessWrites(), writes, 'reading alone does not release the upload');
    await act(async () => { await h.get().session.resolveConflict(); });
    await h.settle(() => h.get().intake.canStart && h.get().intake.entries[0]?.status === 'waiting', 'explicit review releases the preserved File');
    assert.equal(businessWrites(), writes);
    const revision = h.get().session.project!.revision;
    await act(async () => { await h.get().intake.retryLocal(h.get().intake.entries[0]!); });
    await h.settle(() => h.get().intake.materials.length === 1 && !h.get().intake.running, 'only the explicit new submission uploads');
    const submitted = JSON.parse(uploads()[1]!.body!) as { idempotencyKey: string; expectedRevision: number };
    assert.equal(uploads().length, 2); assert.notEqual(submitted.idempotencyKey, JSON.parse(frozen.prepared.body).idempotencyKey);
    assert.equal(submitted.expectedRevision, revision); assert.equal(h.navigations.length, 0);
  } finally { materialIntakeStorage.settle = settleConflict; await h.close(); }
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

test('mounted GET startup and check reject shape-valid status fields that disagree with the real queued project', async t => {
  const h = await harness();
  try {
    let project = await h.f.create();
    project = await h.f.write(project, 'production/initialize');
    project = await h.f.write(project, 'production/context/draft', { context: scopedContext });
    project = await h.f.write(project, 'evidence', { documentName: 'Synthetic bound source', locator: 'line 1', usage: 'product_evidence', text: '10 kg' });
    const checked = await new StageAApi(h.f.headers.authorization.slice(7)).startupCheck(project.id, scopedContext);
    const response = await h.f.post(`/api/projects/${project.id}/production/startup/start`, { context: scopedContext, inputFingerprint: checked.inputFingerprint,
      expectedProjectVersion: project.version, expectedRevision: project.revision, idempotencyKey: crypto.randomUUID() });
    assert.equal(response.statusCode, 200); project = response.json<{ project: Project }>().project;
    assert.equal(project.runs[0]!.queueStatus, 'queued');
    await h.mount(); await h.connect(); await act(async () => { await h.get().session.selectProject(project.id); });
    await h.settle(() => h.get().status.current && !!h.get().startup.check, 'valid queued status and check accepted');
    const mutations: { name: string; change: (status: StartupStatus) => StartupStatus | null }[] = [
      { name: 'missing startup', change: () => null },
      ...(['id', 'submittedBy', 'runId', 'retryRunId'] as const).map(field => ({ name: field, change: (status: StartupStatus) => ({ ...status, [field]: crypto.randomUUID() }) })),
      { name: 'context version', change: status => ({ ...status, contextVersion: status.contextVersion + 1 }) },
      { name: 'input fingerprint', change: status => ({ ...status, inputFingerprint: '0'.repeat(64) }) },
      { name: 'submitted timestamp', change: status => ({ ...status, submittedAt: '2000-01-01T00:00:00.000Z' }) },
      { name: 'succeeded while actual run is queued', change: status => ({ ...status, state: 'succeeded' }) },
      ...(['materialIds', 'manualEvidenceIds', 'evidenceIds', 'excludedMaterialIds', 'excludedManualEvidenceIds'] as const).map(field => ({ name: field, change: (status: StartupStatus) => ({ ...status, [field]: [crypto.randomUUID()] }) })),
      ...(['retainedMaterialIds', 'retainedManualEvidenceIds', 'addedMaterialIds', 'addedManualEvidenceIds'] as const).map(field => ({ name: `scope ${field}`, change: (status: StartupStatus) => ({ ...status, scopeRefresh: { ...status.scopeRefresh, [field]: [crypto.randomUUID()] } }) })),
      { name: 'scope refresh permitted for queued run', change: status => ({ ...status, scopeRefresh: { ...status.scopeRefresh, canRefresh: true } }) },
    ];
    for (const mutation of mutations) await t.test(mutation.name, async () => {
      h.setIntercept(async (path, options, send) => {
        const result = await send();
        if (path.endsWith('/production/startup') && (options?.method ?? 'GET') === 'GET') {
          const value = await result.json() as StartupRead; assert.ok(value.startup);
          return Response.json({ ...value, startup: mutation.change(value.startup) });
        }
        if (path.endsWith('/production/startup/check') && options?.method === 'POST') {
          const value = await result.json() as StartupCheck; assert.ok(value.existingStartup);
          return Response.json({ ...value, existingStartup: mutation.change(value.existingStartup) });
        }
        return result;
      });
      await act(async () => { h.get().status.reload(); h.get().startup.reload(); });
      await h.settle(() => !!h.get().status.error && !!h.get().startup.error && !h.get().status.loading && !h.get().startup.loading, 'both corrupted responses explicitly rejected');
      assert.equal(h.get().status.current, false); assert.equal(h.get().status.status, null); assert.equal(h.get().startup.check, null);
      const writes = h.trace.filter(item => item.path.endsWith('/start')).length;
      await act(async () => { await h.get().startup.start(); });
      assert.equal(h.trace.filter(item => item.path.endsWith('/start')).length, writes);
      assert.equal(h.get().session.project?.runs[0]?.queueStatus, 'queued'); assert.equal(h.navigations.length, 0);
    });
    h.setIntercept(); await act(async () => { h.get().status.reload(); h.get().startup.reload(); });
    await h.settle(() => h.get().status.current && h.get().status.status?.state === 'queued' && !!h.get().startup.check, 'valid reads recover after corrupted responses');
  } finally { await h.close(); }
});

for (const boundary of ['GET', 'readFlow', 'selectScope', 'unmount'] as const) test(`cancelled selectProject at ${boundary} preserves the prior project, draft and durable selection`, async () => {
  const h = await harness(), readFlow = setupRecoveryStorage.readFlow, selectScope = setupRecoveryStorage.selectScope;
  let release: (() => void) | undefined;
  try {
    const a = await h.f.create(), b = await h.f.create();
    await h.mount(); await h.connect(); await act(async () => { await h.get().session.selectProject(a.id); });
    assert.equal(h.get().session.projectVerified, true);
    await act(async () => { h.get().context.setField('productName', 'Draft A stays selected'); });
    assert.equal(await setupRecoveryStorage.readSelection(), a.id);
    const gate = new Promise<void>(resolve => { release = resolve; }); let held = false;
    if (boundary === 'GET' || boundary === 'unmount') h.setIntercept(async (path, options, send) => {
      const result = await send(); if (path === `/api/projects/${b.id}` && (options?.method ?? 'GET') === 'GET') { held = true; await gate; } return result;
    });
    if (boundary === 'readFlow') setupRecoveryStorage.readFlow = async scope => { const flow = await readFlow.call(setupRecoveryStorage, scope); if (scope === b.id) { held = true; await gate; } return flow; };
    if (boundary === 'selectScope') setupRecoveryStorage.selectScope = async (...args) => { if (args[0] === b.id) { held = true; await gate; } return selectScope.apply(setupRecoveryStorage, args); };
    let request: Promise<unknown> | undefined;
    await act(async () => { request = h.get().session.selectProject(b.id); await delay(0); });
    await h.settle(() => held, 'project B selection paused at the requested boundary');
    assert.equal(h.get().session.projectVerified, false, 'a pending project selection revokes the previous project verification');
    if (boundary === 'unmount') await h.unmount(); else await act(async () => { h.get().session.setToken(''); });
    await act(async () => { release!(); await request; });
    assert.equal(await setupRecoveryStorage.readSelection(), a.id, 'cancellation cannot commit durable selection B');
    assert.equal(h.get().session.project?.id, a.id); assert.equal(h.get().session.getCurrentScope(), a.id);
    assert.equal(h.get().session.projectVerified, false); assert.equal(h.get().session.canWrite, false);
    assert.equal(h.get().context.form.productName, 'Draft A stays selected');
    assert.equal(h.trace.some(item => item.method === 'POST' && !item.path.endsWith('/check')), false);
  } finally { release?.(); setupRecoveryStorage.readFlow = readFlow; setupRecoveryStorage.selectScope = selectScope; await h.close(); }
});

test('a newer IndexedDB capture restores the latest form and model backup when localStorage reads its old value but rejects writes', async () => {
  const h = await harness();
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { h.get().context.setField('productName', 'Older local value'); h.get().context.requestModel('legacy-canvas.1'); });
    await act(async () => { h.get().context.confirmCopy(); });
    const scope = h.get().session.draftScope, reviewedKey = draftKey(scope, 'productionContext:reviewed'), modelsKey = draftKey(scope, 'productionContextModels');
    const olderReviewed = h.local.get(reviewedKey)!, olderModels = h.local.get(modelsKey)!;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => h.local.get(key) ?? null,
      setItem: (key: string, value: string) => { if (key === reviewedKey || key === modelsKey) throw new Error('Quota: older value remains readable'); h.local.set(key, value); } } });
    await act(async () => { h.get().context.setField('productName', 'Latest frozen value'); });
    await act(async () => { h.get().context.requestModel('scoped-rules.1'); });
    await act(async () => { h.get().context.confirmCopy(); });
    await act(async () => { h.get().context.setField('productName', 'Latest frozen value'); });
    h.setIntercept(async (path, options, send) => path === '/api/projects' && options?.method === 'POST' ? new Response('', { status: 401 }) : send());
    await act(async () => { await h.get().session.ensureSetupProject(); });
    const pending = await setupRecoveryStorage.readPending(); assert.ok(pending);
    assert.equal(JSON.parse(pending.prepared.body).name, 'Latest frozen value');
    assert.equal(pending.capture.reviewed.value.productName, 'Latest frozen value');
    assert.ok(pending.capture.reviewedRevision! > JSON.parse(olderReviewed).revision); assert.ok(pending.capture.modelsRevision! > JSON.parse(olderModels).revision);
    assert.equal(h.local.get(reviewedKey), olderReviewed); assert.equal(h.local.get(modelsKey), olderModels);
    await h.unmount(); await h.mount();
    assert.equal(h.get().context.form.productName, 'Latest frozen value'); assert.equal(h.get().context.local.needsReview, false);
    assert.equal(h.get().context.backups['legacy-canvas.1']?.form.productName, 'Latest frozen value');
    assert.equal(h.get().context.recoveryConflict, false);
    const recovered = h.get().session.pending;
    assert.equal(recovered?.kind === 'setup' && recovered.operation.prepared.body, pending.prepared.body);
    assert.equal(h.trace.filter(item => item.method === 'POST').length, 1, 'recovery never submits the older visible value');
  } finally { await h.close(); }
});

test('a newer normal local edit wins over an older completed setup flow after reopening', async () => {
  const h = await harness();
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { await h.get().session.ensureSetupProject(); });
    const scope = h.get().session.draftScope, flow = await setupRecoveryStorage.readFlow(scope); assert.ok(flow);
    await act(async () => { h.get().context.setField('productName', 'Later normal edit'); });
    await act(async () => { h.get().context.requestModel('legacy-canvas.1'); });
    await act(async () => { h.get().context.confirmCopy(); });
    const frozen = structuredClone(flow.capture), writes = h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length;
    await h.unmount(); await h.mount();
    assert.equal(h.get().context.form.productName, 'Later normal edit'); assert.equal(h.get().context.local.needsReview, false);
    assert.equal(h.get().context.backups['scoped-rules.1']?.form.productName, 'Later normal edit');
    assert.deepEqual((await setupRecoveryStorage.readFlow(scope))?.capture, frozen, 'normal edits do not rewrite a completed request capture');
    assert.equal(h.trace.filter(item => item.method === 'POST' && !item.path.endsWith('/check')).length, writes);
  } finally { await h.close(); }
});

for (const format of ['same-revision', 'legacy'] as const) test(`ambiguous ${format} form and backups remain visible for explicit choice without rewriting the frozen request`, async () => {
  const assets = registerHooks({ load(url, context, next) { return /\.(png|jpe?g|webp|svg)(?:\?|$)/.test(url) ? { format: 'module', source: `export default ${JSON.stringify(url)}`, shortCircuit: true } : next(url, context); } });
  const { ContextControls } = await tsImport('../../src/pages/ArcaneWarriorPage/ProjectContextFields.tsx', { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../tsconfig.app.json', import.meta.url)) }).finally(() => assets.deregister());
  const h = await harness(ContextControls);
  try {
    await h.mount(); await h.connect(); await h.fill();
    await act(async () => { h.get().context.setField('productName', 'Frozen request name'); });
    h.setIntercept(async (path, options, send) => path === '/api/projects' && options?.method === 'POST' ? new Response('', { status: 401 }) : send());
    await act(async () => { await h.get().session.ensureSetupProject(); });
    const pending = (await setupRecoveryStorage.readPending())!;
    if (format === 'legacy') { delete pending.capture.reviewedRevision; delete pending.capture.modelsRevision; await setupRecoveryStorage.save(pending); }
    const reviewed = { ...pending.capture.reviewed, value: { ...pending.capture.reviewed.value, productName: 'Conflicting local name' } };
    const models = { 'legacy-canvas.1': { form: { ...reviewed.value, ruleModel: 'legacy-canvas.1', productName: 'Conflicting local backup' }, base: reviewed.base } };
    const record = (value: unknown, revision = 0) => JSON.stringify(format === 'legacy' ? value : { draftFormat: 'tujiang-local-draft.2', value, revision });
    h.local.set(draftKey(pending.scopeId, 'productionContext:reviewed'), record(reviewed, pending.capture.reviewedRevision));
    h.local.set(draftKey(pending.scopeId, 'productionContextModels'), record(models, pending.capture.modelsRevision));
    await h.unmount(); await h.mount();
    assert.equal(h.get().context.recoveryConflict, true); assert.equal(h.get().context.local.needsReview, true);
    assert.equal(h.get().context.canEdit, false); assert.equal(h.get().startup.canStart, false); assert.equal(h.get().context.getCurrentInput(), undefined);
    assert.match(content(h.root()), /Frozen request name/); assert.match(content(h.root()), /Conflicting local name/); assert.match(content(h.root()), /Conflicting local backup/);
    await act(async () => { h.get().context.chooseRecovery('reviewed', 'local'); });
    assert.equal(h.get().context.form.productName, 'Conflicting local name'); assert.equal(h.get().context.recoveryConflict, true, 'backup conflict independently blocks use');
    await act(async () => { h.get().context.chooseRecovery('models', 'restored'); });
    assert.equal(h.get().context.recoveryConflict, false); assert.deepEqual(h.get().context.backups, pending.capture.models);
    assert.ok(h.get().context.local.getRevision() > (pending.capture.reviewedRevision ?? 0));
    assert.equal((await setupRecoveryStorage.readPending())!.prepared.body, pending.prepared.body);
    assert.equal((await setupRecoveryStorage.readPending())!.capture.reviewed.value.productName, 'Frozen request name');
    assert.equal(h.trace.filter(item => item.method === 'POST').length, 1);
  } finally { await h.close(); }
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
