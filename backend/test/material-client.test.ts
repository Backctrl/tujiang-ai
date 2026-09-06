import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { fixture } from './helpers.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import type { MaterialSource } from '../src/production-materials.js';
import { ApiError, StageAApi, prepareProjectWrite, type Project } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';
import { compileMaterialSource, emptyMaterialSource, executeMaterialOperation, fileContentBase64, materialBlockLocation, materialStatus,
  prepareMaterialRetry, prepareMaterialUpload, receivedMaterial, safeSourceUrl, verifyOriginal } from '../../src/pages/ArcaneWarriorPage/material-intake.js';
import { validateMaterialOperation, type MaterialIntakeStorage, type MaterialLocalEntry, type MaterialOperation } from '../../src/pages/ArcaneWarriorPage/material-storage.js';
import { useProjectSnapshot } from '../../src/pages/ArcaneWarriorPage/useProjectSnapshot.js';
import { useProjectSession } from '../../src/pages/ArcaneWarriorPage/useProjectSession.js';
import { useMaterialIntake } from '../../src/pages/ArcaneWarriorPage/useMaterialIntake.js';

// Deterministic persistence fault injection for the actual write executor. IndexedDB and UI
// interaction still require the separate real-browser acceptance; this is not a browser claim.
class MemoryMaterialStorage implements MaterialIntakeStorage {
  entries = new Map<string, MaterialLocalEntry>();
  pending: MaterialOperation | undefined;
  failSave = false;
  failSettle = false;
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
    const conflict = await executeMaterialOperation(stale, client, storage, () => assert.fail('a conflict is not an upload receipt'));
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
    await assert.rejects(new StageAApi('expired', async () => Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })).original(project.id, crypto.randomUUID()),
      (error: unknown) => error instanceof ApiError && error.status === 401);
    await assert.rejects(verifyOriginal(new Blob(['altered']), { sizeBytes: 7, sha256: '0'.repeat(64) }),
      (error: unknown) => error instanceof ApiError && error.code === 'ORIGINAL_INTEGRITY_MISMATCH');
    assert.throws(() => receivedMaterial(project), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
  } finally { await f.close(); }
});
