import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { tsImport } from 'tsx/esm/api';
import { createElement, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { command, fixture } from './helpers.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import type { MaterialSource } from '../src/production-materials.js';
import { ApiError, StageAApi, prepareProjectWrite, type Project } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';
import { compileMaterialSource, emptyMaterialSource, executeMaterialOperation, fileContentBase64, materialBlockLocation, materialStatus,
  onlyMaterialParseProgress, prepareMaterialRetry, prepareMaterialUpload, receivedMaterial, safeSourceUrl, verifyOriginal } from '../../src/pages/ArcaneWarriorPage/material-intake.js';
import { validateMaterialOperation, type MaterialIntakeStorage, type MaterialLocalEntry, type MaterialOperation } from '../../src/pages/ArcaneWarriorPage/material-storage.js';
import { useProjectSnapshot } from '../../src/pages/ArcaneWarriorPage/useProjectSnapshot.js';
import { useProjectSession } from '../../src/pages/ArcaneWarriorPage/useProjectSession.js';
import { useMaterialIntake } from '../../src/pages/ArcaneWarriorPage/useMaterialIntake.js';

// Deterministic persistence fault injection for the actual write executor. IndexedDB and UI
// interaction still require the separate real-browser acceptance; this is not a browser claim.
class MemoryMaterialStorage implements MaterialIntakeStorage {
  entries = new Map<string, MaterialLocalEntry>();
  pending: MaterialOperation | undefined;
  replacements: MaterialOperation[] = [];
  failSave = false;
  failSettle = false;
  failReplace = false;
  subscribe() { return () => undefined; }
  async list(projectId: string) { return structuredClone([...this.entries.values()].filter(entry => entry.projectId === projectId)); }
  async put(entry: MaterialLocalEntry) { this.entries.set(entry.id, structuredClone(entry)); }
  async remove(id: string) { this.entries.delete(id); }
  async readPending() { return this.pending ? validateMaterialOperation(structuredClone(this.pending)) : undefined; }
  async savePending(operation: MaterialOperation) {
    if (this.failSave) throw new Error('Injected quota failure');
    if (this.pending && this.pending.prepared.body !== operation.prepared.body) throw new Error('Another unresolved operation exists');
    this.pending = structuredClone(operation);
    if (operation.entryId) this.entries.get(operation.entryId)!.status = 'uploading';
  }
  async replacePending(previous: MaterialOperation, operation: MaterialOperation) {
    if (this.failReplace) throw new Error('Injected replacement failure');
    assert.equal(this.pending?.prepared.body, previous.prepared.body);
    this.pending = structuredClone(operation);
    this.replacements.push(structuredClone(operation));
    if (operation.entryId) this.entries.get(operation.entryId)!.status = 'uploading';
  }
  async settle(operation: MaterialOperation, result: 'saved' | 'rejected' | 'conflict', message?: string) {
    if (this.failSettle) throw new Error('Injected settlement failure');
    this.pending = undefined;
    if (!operation.entryId) return;
    if (result === 'saved') this.entries.delete(operation.entryId);
    else { const entry = this.entries.get(operation.entryId)!; entry.status = result; entry.message = message; }
  }
  async markUncertain(operation: MaterialOperation, message: string) {
    if (operation.entryId) { const entry = this.entries.get(operation.entryId)!; entry.status = 'uncertain'; entry.message = message; }
  }
}

function entry(project: Project, fileName: string, bytes: Uint8Array | string, mimeType = 'text/plain', source: MaterialSource = { kind: 'local_upload' }): MaterialLocalEntry {
  const content = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  const file = new File([content], fileName, { type: mimeType });
  return { id: crypto.randomUUID(), projectId: project.id, fileName, mimeType, sizeBytes: file.size, file, source, status: 'waiting', addedAt: new Date().toISOString() };
}

test('the actual session and material hooks render a disconnected first screen with no selection errors, including reload before a saved project is read', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    for (const savedProjectId of ['', crypto.randomUUID()]) {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => key === 'tujiang_stage_a_project_id' ? savedProjectId : null,
      } });
      function InitialScreen() {
        const session = useProjectSession();
        const intake = useMaterialIntake(session);
        assert.equal(session.project, null);
        assert.equal(session.projectId, savedProjectId);
        assert.equal(session.canWrite, false);
        assert.equal(intake.canSelect, false);
        assert.equal(intake.running, false);
        assert.deepEqual(intake.selectionErrors, []);
        assert.deepEqual(intake.entries, []);
        assert.deepEqual(intake.materials, []);
        return createElement('p', null, '尚未连接项目');
      }
      assert.equal(renderToStaticMarkup(createElement(InitialScreen)), '<p>尚未连接项目</p>');
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('the actual setup component limits only manual evidence, independently of twelve material-derived blocks', async () => {
  const f = await fixture();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    let project = await f.write(await f.create(), 'production/initialize');
    const text = Array.from({ length: 12 }, (_, index) => `Synthetic source line ${index + 1}`).join('\n');
    project = await f.write(project, 'production/materials', { fileName: 'twelve-lines.txt', mimeType: 'text/plain', contentBase64: Buffer.from(text).toString('base64'), source: { kind: 'local_upload' } });
    await new IngestionWorker(f.store, f.objects).tick(); project = await f.store.get(project.id);
    const material = project.production!.materials![0]!;
    assert.equal(material.blocks.length, 12);
    project = await f.write(project, `production/materials/${material.id}/usage`, { reason: 'Check each source line', decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })) });
    assert.equal(project.evidence.filter(evidence => !!evidence.materialSource).length, 12);
    const drafts: Record<string, string> = { documentName: 'Independent manual source', locator: 'Manual paragraph', evidenceText: 'Independently entered text' };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => {
      for (const [field, value] of Object.entries(drafts)) if (key === `tujiang_draft_v1:${project.id}:${field}`) return JSON.stringify(value);
      return null;
    } } });
    // Compile the actual UI with its JSX and alias configuration, independently from the Node backend compiler.
    const componentPath = '../../src/pages/ArcaneWarriorPage/ProjectFactsStages.tsx';
    const assets = registerHooks({ load(url, context, nextLoad) {
      if (/\.(png|jpe?g|webp|svg)(?:\?|$)/.test(url)) return { format: 'module', source: `export default ${JSON.stringify(url)}`, shortCircuit: true };
      return nextLoad(url, context);
    } });
    const { ProjectSetup } = await tsImport(componentPath, { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../tsconfig.app.json', import.meta.url)) }).finally(() => assets.deregister());
    function Setup() {
      const connected = useProjectSession();
      const session = { ...connected, project, getLatestProject: () => project, canWrite: true, token: 'synthetic-session' };
      return createElement(ProjectSetup, { session, intake: useMaterialIntake(session), onStage: () => undefined });
    }
    const render = () => {
      const html = renderToStaticMarkup(createElement(Setup));
      const attributes = html.match(/<button\b([^>]*)>保存文字证据<\/button>/)?.[1];
      assert.ok(attributes !== undefined, 'the actual manual-evidence action must be present');
      return { html, disabled: /\bdisabled(?:=|\s|$)/.test(attributes) };
    };
    const emptyManual = render();
    assert.equal(emptyManual.disabled, false);
    assert.match(emptyManual.html, /原有文字证据录入 · 0 份/);
    for (let index = 0; index < 10; index++) project = await f.write(project, 'evidence', { documentName: `Manual source ${index}`, locator: `Paragraph ${index}`, text: `Independent statement ${index}`, usage: 'product_evidence' });
    const fullManual = render();
    assert.equal(fullManual.disabled, true);
    assert.match(fullManual.html, /原有文字证据录入 · 10 份/);
    assert.equal(project.evidence.length, 22, 'material evidence remains in the project for the facts stage');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    await f.close();
  }
});

test('browser File bytes become standard Base64 without text decoding, and source fields remain optional except an export URL', async () => {
  const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
  assert.deepEqual(Buffer.from(await fileContentBase64(new File([bytes], 'binary.png')), 'base64'), Buffer.from(bytes));
  assert.deepEqual(compileMaterialSource(emptyMaterialSource), { source: { kind: 'local_upload' }, errors: {} });
  const compiled = compileMaterialSource({ kind: 'feishu_export', title: ' Source ', url: 'https://example.feishu.cn/docx/test', revision: ' 33 ', locator: ' 表格第 2 行 ' });
  assert.deepEqual(compiled.source, { kind: 'feishu_export', title: 'Source', url: 'https://example.feishu.cn/docx/test', revision: '33', locator: '表格第 2 行' });
  assert.deepEqual(compiled.errors, {});
  assert.ok(compileMaterialSource({ ...emptyMaterialSource, kind: 'feishu_export' }).errors.url);
  assert.ok(compileMaterialSource({ ...emptyMaterialSource, url: 'javascript:alert(1)' }).errors.url);
  assert.ok(compileMaterialSource({ ...emptyMaterialSource, locator: '\ud800' }).errors.locator);
  assert.equal(safeSourceUrl('javascript:alert(1)'), undefined);
  await assert.rejects(fileContentBase64(new File([], 'empty.txt')), (error: unknown) => error instanceof ApiError && error.code === 'EMPTY_FILE');
});

test('material preparation uses a same-batch snapshot received during File reading and then freezes the whole envelope', async () => {
  const f = await fixture();
  try {
    const before = await f.write(await f.create(), 'production/initialize');
    const newer = structuredClone(before); newer.revision++;
    const local = entry(before, 'source.txt', 'Original input');
    let prepared: Promise<MaterialOperation> | undefined;
    function Probe() {
      const snapshot = useProjectSnapshot(before);
      const started = useRef(false);
      if (!started.current) {
        started.current = true;
        prepared = prepareMaterialUpload(local, snapshot.getLatestProject);
        snapshot.receiveSnapshot(newer, before.id);
      }
      return null;
    }
    renderToStaticMarkup(createElement(Probe)); assert.ok(prepared);
    const operation = await prepared;
    assert.equal(JSON.parse(operation.prepared.body).expectedRevision, newer.revision);
    assert.equal(operation.before.revision, newer.revision);
    const body = operation.prepared.body;
    local.source.title = 'Edited after preparation';
    newer.revision++;
    assert.equal(operation.prepared.body, body, 'source edits and new snapshots must not change a pending request');
    const restored = validateMaterialOperation(structuredClone(operation));
    assert.equal(restored.prepared.body, body);
  } finally { await f.close(); }
});

test('real HTTP intake preserves mixed-file outcomes, candidate locators, original bytes and repeated source provenance', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const secret = f.headers.authorization.slice(7);
    const requests: { path: string; body?: string }[] = [];
    let inFlight = 0, maxInFlight = 0;
    const client = new StageAApi(secret, async (path, options) => {
      const address = String(path);
      assert.equal(new Headers(options?.headers).get('Authorization'), f.headers.authorization);
      assert.equal(options?.redirect, 'error'); assert.equal(address.includes(secret), false);
      requests.push({ path: address, body: options?.body as string | undefined });
      if (options?.method === 'POST') maxInFlight = Math.max(maxInFlight, ++inFlight);
      try { return await fetch(`${url}${address}`, options); }
      finally { if (options?.method === 'POST') inFlight--; }
    });
    let project = await client.write(await client.create('Material client fixtures'), 'production/initialize');
    const storage = new MemoryMaterialStorage();
    const source: MaterialSource = { kind: 'feishu_export', url: 'https://example.feishu.cn/docx/synthetic', title: 'Synthetic source', revision: '33', locator: '产品说明' };
    const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#2356aaff' } }).png().toBuffer();
    const plain = '第一行\n容量：10 L\n';
    const selected = [
      entry(project, 'source.txt', plain, 'text/plain', source),
      entry(project, 'unsupported.pdf', '%PDF-1.4 fixture', 'application/pdf'),
      entry(project, 'table.csv', '名称,说明\r\n"AW FLEX","第一行\r\n第二行"', 'text/csv'),
      entry(project, 'broken.json', '{"capacity":1,}', 'application/json'),
      entry(project, 'product.png', png, 'image/png'),
      entry(project, 'data.json', '{"a/b~": [10, true]}', 'application/json'),
    ];
    const outcomes: string[] = [];
    for (const local of selected) {
      await storage.put(local);
      const operation = await prepareMaterialUpload(local, () => project);
      const outcome = await executeMaterialOperation(operation, client, storage, next => { project = next; });
      outcomes.push(outcome.kind);
    }
    assert.deepEqual(outcomes, ['saved', 'rejected', 'saved', 'saved', 'saved', 'saved']);
    assert.equal(maxInFlight, 1);
    assert.equal(project.production!.materials!.length, 5);
    assert.deepEqual((await storage.list(project.id)).map(item => [item.fileName, item.status]), [['unsupported.pdf', 'rejected']]);
    assert.equal(await storage.readPending(), undefined);
    const worker = new IngestionWorker(f.store, f.objects);
    while (await worker.tick()) { /* Read persisted parsing results independently of uploads. */ }
    project = await client.get(project.id);
    const material = (name: string) => project.production!.materials!.find(item => item.fileName === name)!;
    assert.equal(materialStatus(material('broken.json')), '解析失败');
    assert.equal(materialStatus(material('product.png')), '解析成功');
    assert.ok(project.production!.materials!.every(item => item.usage.status === 'pending'));
    assert.ok(project.production!.materials!.flatMap(item => item.blocks).every(block => block.status === 'candidate'));
    assert.deepEqual(project.evidence, []); assert.deepEqual(project.facts, []);
    const image = material('product.png').blocks[0]!;
    assert.equal(image.image!.widthPx, 3); assert.equal(image.image!.heightPx, 2);
    assert.equal(image.image!.textRecognition, 'not_performed'); assert.equal(image.image!.semanticAnalysis, 'not_performed'); assert.equal(image.text, undefined);
    assert.match(materialBlockLocation(material('table.csv').blocks[1]!), /CSV 第 2 行.*原文第 2–3 行/);
    assert.match(materialBlockLocation(material('data.json').blocks[0]!), /\/a~1b~0\/0/);
    const original = await client.original(project.id, material('source.txt').id);
    await verifyOriginal(original, material('source.txt'));
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), Buffer.from(plain));
    const originalRequest = requests.findLast(request => request.path.endsWith('/original'))!;
    assert.equal(originalRequest.body, undefined);
    assert.equal(originalRequest.path.includes(material('source.txt').objectKey), false);
    const first = structuredClone(material('source.txt'));
    const reorderedSource: MaterialSource = { locator: source.locator, revision: source.revision, title: source.title, url: source.url, kind: 'feishu_export' };
    for (const nextSource of [reorderedSource, { ...source, revision: '34' }]) {
      const duplicate = entry(project, 'source.txt', plain, 'text/plain', nextSource);
      await storage.put(duplicate);
      const outcome = await executeMaterialOperation(await prepareMaterialUpload(duplicate, () => project), client, storage, next => { project = next; });
      assert.equal(outcome.kind, 'saved');
    }
    assert.equal(project.production!.materials!.length, 5);
    assert.equal(material('source.txt').id, first.id); assert.equal(material('source.txt').origins.length, 2);
    assert.deepEqual(material('source.txt').blocks, first.blocks); assert.deepEqual(material('source.txt').parse, first.parse);
    const failed = material('broken.json');
    const retry = await executeMaterialOperation(prepareMaterialRetry(project, failed.id), client, storage, next => { project = next; });
    assert.equal(retry.kind, 'saved');
    await worker.tick(); project = await client.get(project.id);
    assert.equal(material('broken.json').parse.attempt, 2);
    assert.equal(material('product.png').parse.attempt, 1, 'retrying one failed parser does not rerun a successful sibling');
  } finally { await f.close(); }
});

test('a definite HTTP revision conflict caused only by an existing parser continues the next original with one new envelope', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const order: string[] = [];
    const client = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
      const response = await fetch(`${url}${path}`, options);
      order.push(`${options?.method ?? 'GET'} ${response.status}`);
      return response;
    });
    let project = await client.write(await client.create('Parser progress fixture'), 'production/initialize');
    project = await client.write(project, 'production/materials', { fileName: 'sibling.txt', mimeType: 'text/plain', contentBase64: btoa('Sibling original'), source: { kind: 'local_upload' } });
    const local = entry(project, 'next.csv', 'name,value\r\nfixture,10');
    const storage = new MemoryMaterialStorage(); await storage.put(local);
    const original = await prepareMaterialUpload(local, () => project);
    await new IngestionWorker(f.store, f.objects).tick();
    order.length = 0;
    const outcome = await executeMaterialOperation(original, client, storage, next => { project = next; });
    assert.equal(outcome.kind, 'saved');
    assert.deepEqual(order, ['POST 409', 'GET 200', 'POST 200']);
    assert.equal(storage.replacements.length, 1);
    assert.equal(storage.replacements[0]!.parseProgressRebases, 1);
    const firstBody = JSON.parse(original.prepared.body);
    const nextBody = JSON.parse(storage.replacements[0]!.prepared.body);
    assert.notEqual(firstBody.idempotencyKey, nextBody.idempotencyKey);
    assert.ok(nextBody.expectedRevision > firstBody.expectedRevision);
    assert.deepEqual({ ...nextBody, expectedRevision: firstBody.expectedRevision, idempotencyKey: firstBody.idempotencyKey }, firstBody);
    assert.equal(project.production!.materials!.length, 2);
    assert.equal(project.production!.materials![0]!.parse.runStatus, 'succeeded');
    assert.deepEqual(await storage.list(project.id), []);
    assert.equal(await storage.readPending(), undefined);
  } finally { await f.close(); }
});

test('parser progress requires both an unchanged business projection and an exact append-only parser audit trail', async () => {
  const f = await fixture();
  try {
    let before = await f.write(await f.create(), 'production/initialize');
    before = await f.write(before, 'production/materials', { fileName: 'sibling.txt', mimeType: 'text/plain', contentBase64: btoa('Sibling original'), source: { kind: 'local_upload' } });
    await new IngestionWorker(f.store, f.objects).tick();
    const after = await f.store.get(before.id);
    assert.equal(onlyMaterialParseProgress(before, after), true);
    const mutations: ((project: Project) => void)[] = [
      p => { p.version++; },
      p => { p.inputRevision = (p.inputRevision ?? 0) + 1; },
      p => { p.identity = { productName: 'Changed identity', confirmedBy: 'human', confirmedAt: new Date().toISOString() }; },
      p => { p.production!.context = { versions: [], draft: { productBrief: { productName: 'Changed context' } } }; },
      p => { p.production!.materials![0]!.usage.hint = 'reference'; },
      p => { p.production!.materials![0]!.source.locator = 'Changed source'; },
      p => { p.production!.materials![0]!.origins[0]!.source.revision = 'Changed origin'; },
      p => { p.production!.materials![0]!.sha256 = '0'.repeat(64); },
      p => { p.production!.materials![0]!.objectKey = 'Changed original object'; },
      p => { p.production!.materials![0]!.parse.id = crypto.randomUUID(); },
      p => { p.production!.materials![0]!.parse.sourceSha256 = '0'.repeat(64); },
      p => { p.production!.materials!.push({ ...structuredClone(p.production!.materials![0]!), id: crypto.randomUUID() }); },
      p => { p.audit[before.audit.length]!.actor = 'human'; },
      p => { p.audit[before.audit.length]!.type = 'material.usage.reviewed'; },
      p => { p.audit[before.audit.length]!.data.materialId = crypto.randomUUID(); },
      p => { p.audit[0]!.actor = 'Changed historical actor'; },
      p => { p.audit = p.audit.slice(0, before.audit.length); },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const changed = structuredClone(after); mutate(changed);
      assert.equal(onlyMaterialParseProgress(before, changed), false, `unexpected automatic update for changed dimension ${index}`);
    }
  } finally { await f.close(); }
});

test('real HTTP identity, context and usage changes remain manual conflicts even when a parser also finishes', async t => {
  for (const change of ['identity', 'context', 'usage'] as const) await t.test(change, async () => {
    const f = await fixture();
    try {
      const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
      const order: string[] = [];
      const client = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
        const response = await fetch(`${url}${path}`, options); order.push(`${options?.method ?? 'GET'} ${response.status}`); return response;
      });
      let before = await client.write(await client.create(`Business ${change} fixture`), 'production/initialize');
      before = await client.write(before, 'production/materials', { fileName: 'sibling.txt', mimeType: 'text/plain', contentBase64: btoa('Sibling original'), source: { kind: 'local_upload' } });
      const local = entry(before, 'waiting.txt', 'Not accepted yet');
      const storage = new MemoryMaterialStorage(); await storage.put(local);
      const operation = await prepareMaterialUpload(local, () => before);
      await new IngestionWorker(f.store, f.objects).tick();
      const latest = await client.get(before.id);
      if (change === 'identity') await client.write(latest, 'identity/confirm', { productName: 'External product identity' });
      else if (change === 'context') await client.write(latest, 'production/context/draft', { context: { productBrief: { productName: 'External context draft' } } });
      else await f.store.command(latest.id, command(latest), 'material.usage.reviewed', 'external-reviewer', current => {
        // The usage-review route belongs to 2D2. Persist its distinct business effect in this 2D1 fixture.
        current!.production!.materials![0]!.usage.hint = 'reference'; return current!;
      }, { preserveStageAInput: true });
      order.length = 0;
      const outcome = await executeMaterialOperation(operation, client, storage, () => undefined);
      assert.equal(outcome.kind, 'conflict');
      assert.deepEqual(order, change === 'identity' ? ['POST 409'] : ['POST 409', 'GET 200']);
      if (change === 'identity') assert.ok(outcome.error instanceof ApiError && outcome.error.code === 'VERSION_CONFLICT');
      assert.equal(storage.replacements.length, 0);
      assert.equal(storage.entries.get(local.id)!.status, 'conflict');
      assert.equal(await storage.readPending(), undefined);
      assert.equal((await client.get(before.id)).production!.materials!.length, 1);
    } finally { await f.close(); }
  });
});

test('a second parser race exhausts the persisted one-update budget and pauses the unaccepted file', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const worker = new IngestionWorker(f.store, f.objects);
    const order: string[] = [];
    const client = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
      if (options?.method === 'POST' && JSON.parse(options.body as string).fileName === 'waiting.txt') assert.equal(await worker.tick(), true);
      const response = await fetch(`${url}${path}`, options); order.push(`${options?.method ?? 'GET'} ${response.status}`); return response;
    });
    let before = await client.write(await client.create('Bounded parser race fixture'), 'production/initialize');
    for (let index = 0; index < 2; index++) before = await client.write(before, 'production/materials', { fileName: `sibling-${index}.txt`, mimeType: 'text/plain', contentBase64: btoa(`Sibling ${index}`), source: { kind: 'local_upload' } });
    const local = entry(before, 'waiting.txt', 'Still unaccepted');
    const storage = new MemoryMaterialStorage(); await storage.put(local);
    order.length = 0;
    const outcome = await executeMaterialOperation(await prepareMaterialUpload(local, () => before), client, storage, () => undefined);
    assert.equal(outcome.kind, 'conflict');
    assert.deepEqual(order, ['POST 409', 'GET 200', 'POST 409']);
    assert.equal(storage.replacements.length, 1);
    assert.equal(storage.replacements[0]!.parseProgressRebases, 1);
    assert.equal(outcome.operation?.parseProgressRebases, 1);
    assert.equal(storage.entries.get(local.id)!.status, 'conflict');
    assert.equal(await storage.readPending(), undefined);
  } finally { await f.close(); }
});

test('a replaced operation whose second POST commits but loses its response restores and replays the new body and key', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const bodies: string[] = [];
    let memoryPending: MaterialOperation | undefined;
    const client = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
      const target = options?.method === 'POST' && JSON.parse(options.body as string).fileName === 'waiting.txt';
      if (target) {
        bodies.push(options.body as string);
        if (bodies.length === 2) assert.equal(memoryPending?.prepared.body, options.body, 'memory must switch before the second HTTP request');
      }
      const response = await fetch(`${url}${path}`, options);
      if (target && bodies.length === 2) { assert.equal(response.status, 200); throw new Error('Lost second response after commit'); }
      return response;
    });
    let before = await client.write(await client.create('Rebased response loss fixture'), 'production/initialize');
    before = await client.write(before, 'production/materials', { fileName: 'sibling.txt', mimeType: 'text/plain', contentBase64: btoa('Sibling original'), source: { kind: 'local_upload' } });
    const local = entry(before, 'waiting.txt', 'Durable new request original');
    const storage = new MemoryMaterialStorage(); await storage.put(local);
    const initial = await prepareMaterialUpload(local, () => before); memoryPending = initial;
    await new IngestionWorker(f.store, f.objects).tick();
    const outcome = await executeMaterialOperation(initial, client, storage, () => undefined, false, next => { memoryPending = next; });
    assert.equal(outcome.kind, 'uncertain');
    assert.equal(bodies.length, 2); assert.notEqual(bodies[0], bodies[1]);
    const restored = validateMaterialOperation(structuredClone(await storage.readPending()));
    assert.equal(restored.prepared.body, bodies[1]); assert.equal(restored.parseProgressRebases, 1);
    assert.equal(memoryPending!.prepared.body, restored.prepared.body);
    const checked = await client.get(before.id); assert.equal(checked.production!.materials!.length, 2);
    const replay = await executeMaterialOperation(restored, client, storage, () => undefined, true, () => assert.fail('restored requests cannot automatically update'));
    assert.equal(replay.kind, 'saved');
    assert.deepEqual(bodies, [initial.prepared.body, restored.prepared.body, restored.prepared.body]);
    assert.equal((await client.get(before.id)).production!.materials!.length, 2);
    assert.equal(storage.replacements.length, 1); assert.equal(await storage.readPending(), undefined);
  } finally { await f.close(); }
});

test('a failed conflict GET or atomic replacement keeps the original request, and a restored conflict never starts an automatic update', async t => {
  for (const failure of ['read-401', 'replace'] as const) await t.test(failure, async () => {
    const f = await fixture();
    try {
      const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
      const storage = new MemoryMaterialStorage();
      const bodies: string[] = [];
      let failRead = false;
      const client = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
        if (failRead && options?.method === 'GET') return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
        if (options?.method === 'POST' && JSON.parse(options.body as string).fileName === 'waiting.txt') bodies.push(options.body as string);
        return fetch(`${url}${path}`, options);
      });
      let before = await client.write(await client.create(`Recovery ${failure} fixture`), 'production/initialize');
      before = await client.write(before, 'production/materials', { fileName: 'sibling.txt', mimeType: 'text/plain', contentBase64: btoa('Sibling original'), source: { kind: 'local_upload' } });
      const local = entry(before, 'waiting.txt', 'Unaccepted original'); await storage.put(local);
      const initial = await prepareMaterialUpload(local, () => before);
      await new IngestionWorker(f.store, f.objects).tick();
      failRead = failure === 'read-401'; storage.failReplace = failure === 'replace';
      const outcome = await executeMaterialOperation(initial, client, storage, () => undefined);
      assert.equal(outcome.kind, 'uncertain'); assert.deepEqual(bodies, [initial.prepared.body]);
      const restored = (await storage.readPending())!; assert.equal(restored.prepared.body, initial.prepared.body);
      failRead = false; storage.failReplace = false;
      await client.get(before.id);
      const replay = await executeMaterialOperation(restored, client, storage, () => undefined, true);
      assert.equal(replay.kind, 'conflict'); assert.equal(storage.replacements.length, 0);
      assert.deepEqual(bodies, [initial.prepared.body, initial.prepared.body]);
      assert.equal(await storage.readPending(), undefined);
    } finally { await f.close(); }
  });
});

test('a committed upload with a lost response restores the exact body and key, reads first, and only explicitly replays once', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const bodies: string[] = [];
    let dropUploadResponse = true;
    let calls = 0;
    const client = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
      calls++;
      const response = await fetch(`${url}${path}`, options);
      if (String(path).endsWith('/production/materials')) {
        bodies.push(options!.body as string);
        if (dropUploadResponse) { dropUploadResponse = false; throw new Error('Injected connection loss after commit'); }
      }
      return response;
    });
    const project = await client.write(await client.create('Lost response fixture'), 'production/initialize');
    const storage = new MemoryMaterialStorage();
    const local = entry(project, 'original.txt', '原始内容'); await storage.put(local);
    const operation = await prepareMaterialUpload(local, () => project);
    const result = await executeMaterialOperation(operation, client, storage, () => assert.fail('lost response cannot report receipt'));
    assert.equal(result.kind, 'uncertain'); assert.equal(storage.entries.get(local.id)!.status, 'uncertain');
    const countBeforeRecovery = calls;
    const recovered = (await storage.readPending())!;
    assert.equal(calls, countBeforeRecovery, 'loading recovery data does not perform network requests');
    assert.equal(recovered.prepared.body, operation.prepared.body);
    assert.equal(JSON.stringify(recovered).includes(f.headers.authorization.slice(7)), false, 'the token is not recovery data');
    await new IngestionWorker(f.store, f.objects).tick();
    const checked = await client.get(project.id);
    assert.equal(checked.production!.materials!.length, 1);
    const materialId = checked.production!.materials![0]!.id;
    const replay = await executeMaterialOperation(recovered, client, storage, () => undefined, true);
    assert.equal(replay.kind, 'saved'); assert.deepEqual(bodies, [operation.prepared.body, operation.prepared.body]);
    assert.equal(await storage.readPending(), undefined); assert.deepEqual(await storage.list(project.id), []);
    const latest = await client.get(project.id);
    assert.equal(latest.production!.materials!.length, 1); assert.equal(latest.production!.materials![0]!.id, materialId);
    assert.equal(latest.production!.materials![0]!.parse.attempt, 1);
    assert.equal(latest.revision, checked.revision, 'idempotent replay does not rewind or advance the completed parser');
  } finally { await f.close(); }
});

test('401 remains unresolved and credential replacement replays the original prepared request', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const client = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${url}${path}`, options));
    const project = await client.write(await client.create('Credential fixture'), 'production/initialize');
    const local = entry(project, 'auth.txt', 'Original authenticated upload');
    const storage = new MemoryMaterialStorage(); await storage.put(local);
    const operation = await prepareMaterialUpload(local, () => project);
    let deniedCalls = 0;
    const denied = new StageAApi('expired-token', async (_path, options) => {
      deniedCalls++; assert.equal(options?.body, operation.prepared.body);
      return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
    });
    const result = await executeMaterialOperation(operation, denied, storage, () => undefined);
    assert.equal(result.kind, 'uncertain'); assert.equal(deniedCalls, 1);
    assert.equal((await storage.readPending())!.prepared.body, operation.prepared.body);
    assert.equal((await client.get(project.id)).production?.materials?.length ?? 0, 0);
    const replay = await executeMaterialOperation((await storage.readPending())!, client, storage, () => undefined, true);
    assert.equal(replay.kind, 'saved'); assert.equal(await storage.readPending(), undefined);
  } finally { await f.close(); }
});

test('storage failure before HTTP sends nothing, while settlement failure after acceptance keeps the exact replay request', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    let uploadCalls = 0;
    const client = new StageAApi(f.headers.authorization.slice(7), (path, options) => {
      if (String(path).endsWith('/production/materials')) uploadCalls++;
      return fetch(`${url}${path}`, options);
    });
    const project = await client.write(await client.create('Persistence fault fixture'), 'production/initialize');
    const storage = new MemoryMaterialStorage();
    const local = entry(project, 'persist.txt', 'Durable original'); await storage.put(local);
    const operation = await prepareMaterialUpload(local, () => project);
    storage.failSave = true;
    assert.equal((await executeMaterialOperation(operation, client, storage, () => undefined)).kind, 'storage');
    assert.equal(uploadCalls, 0); assert.equal(await storage.readPending(), undefined);
    storage.failSave = false; storage.failSettle = true;
    let received = false;
    const accepted = await executeMaterialOperation(operation, client, storage, () => { received = true; });
    assert.equal(accepted.kind, 'uncertain'); assert.equal(received, true); assert.equal(uploadCalls, 1);
    assert.equal((await storage.readPending())!.prepared.body, operation.prepared.body);
    const checked = await client.get(project.id); assert.equal(checked.production!.materials!.length, 1);
    storage.failSettle = false;
    const replay = await executeMaterialOperation((await storage.readPending())!, client, storage, () => undefined, true);
    assert.equal(replay.kind, 'saved'); assert.equal(uploadCalls, 2);
    assert.equal((await client.get(project.id)).production!.materials!.length, 1);
  } finally { await f.close(); }
});

test('background parsing causes a definite revision conflict and only an explicit new envelope can resubmit the unaccepted file', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const client = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${url}${path}`, options));
    const before = await client.write(await client.create('Revision race fixture'), 'production/initialize');
    const local = entry(before, 'waiting.txt', 'Still local');
    const storage = new MemoryMaterialStorage(); await storage.put(local);
    const stale = await prepareMaterialUpload(local, () => before);
    await client.write(before, 'production/materials', { fileName: 'sibling.txt', mimeType: 'text/plain', contentBase64: btoa('Sibling original'), source: { kind: 'local_upload' } });
    await new IngestionWorker(f.store, f.objects).tick();
    const conflict = await executeMaterialOperation(stale, client, storage, next => { assert.equal(next.production!.materials!.length, 1, 'a conflict may read the external sibling but never report the unaccepted upload'); });
    assert.equal(conflict.kind, 'conflict'); assert.equal(await storage.readPending(), undefined);
    assert.equal(storage.entries.get(local.id)!.status, 'conflict');
    const checked = await client.get(before.id); assert.equal(checked.production!.materials!.length, 1);
    const next = await prepareMaterialUpload(local, () => checked);
    assert.notEqual(JSON.parse(next.prepared.body).idempotencyKey, JSON.parse(stale.prepared.body).idempotencyKey);
    assert.equal(JSON.parse(next.prepared.body).contentBase64, JSON.parse(stale.prepared.body).contentBase64);
    assert.equal((await executeMaterialOperation(next, client, storage, () => undefined)).kind, 'saved');
    assert.equal((await client.get(before.id)).production!.materials!.length, 2);
  } finally { await f.close(); }
});

test('original downloads require authentication and verify bytes; invalid restored routes or envelopes cannot be replayed', async () => {
  const f = await fixture();
  try {
    const project = await f.write(await f.create(), 'production/initialize');
    const local = entry(project, 'safe.txt', 'Original');
    const operation = await prepareMaterialUpload(local, () => project);
    assert.throws(() => validateMaterialOperation({ ...operation, prepared: { ...operation.prepared, suffix: '../identity/confirm' } }));
    assert.throws(() => validateMaterialOperation({ ...operation, prepared: prepareProjectWrite({ ...project, revision: project.revision + 1 }, 'production/materials', {}) }));
    assert.throws(() => validateMaterialOperation({ ...operation, parseProgressRebases: 2 }));
    await assert.rejects(new StageAApi('expired', async () => Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })).original(project.id, crypto.randomUUID()),
      (error: unknown) => error instanceof ApiError && error.status === 401);
    await assert.rejects(verifyOriginal(new Blob(['altered']), { sizeBytes: 7, sha256: '0'.repeat(64) }),
      (error: unknown) => error instanceof ApiError && error.code === 'ORIGINAL_INTEGRITY_MISMATCH');
    assert.throws(() => receivedMaterial(project), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
  } finally { await f.close(); }
});
