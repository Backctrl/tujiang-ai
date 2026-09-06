import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { fixture, command, extraction } from './helpers.js';
import type { Project } from '../src/contracts.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import { MaterialQueue } from '../src/material-queue.js';
import { parseMaterial } from '../src/material-parser.js';
import { MAX_FILE_BYTES, MAX_TEXT_BYTES, MATERIAL_UPLOAD_BODY_LIMIT, createMaterial, decodeMaterialUpload, materialUploadSchema, type MaterialSource, type MaterialUsageHint } from '../src/production-materials.js';
import { Worker } from '../src/worker.js';

function upload(fileName: string, content: Buffer | string, mimeType = 'text/plain',
  source: MaterialSource = { kind: 'local_upload' }, usageHint: MaterialUsageHint = 'unknown') {
  return { fileName, mimeType, contentBase64: Buffer.from(content).toString('base64'), source, usageHint };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const initialized = async (f: Fixture) => f.write(await f.create(), 'production/initialize');
const material = (p: Project, index = 0) => p.production!.materials![index]!;

test('binary originals are byte-exact, content-addressed, authenticated and deduplicated with source history', async () => {
  const f = await fixture();
  try {
    let p = await initialized(f);
    const inputRevision = p.inputRevision;
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#2356aaff' } }).png().toBuffer();
    const source: MaterialSource = { kind: 'feishu_export', url: 'https://example.feishu.cn/docx/synthetic', title: 'Synthetic source', revision: '15', locator: 'image 1' };
    const payload = command(p, upload('../../原图.png', bytes, 'image/png', source));
    const url = `/api/projects/${p.id}/production/materials`;
    const received = await f.post(url, payload);
    assert.equal(received.statusCode, 200);
    const receipt = received.json<Project>();
    p = receipt;
    const firstId = material(p).id;
    assert.equal(material(p).sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.match(material(p).objectKey, /^[a-f0-9]{64}\.bin$/);
    assert.deepEqual(material(p).source, source);
    assert.deepEqual(material(p).usage, { status: 'pending', hint: 'unknown' });
    await new IngestionWorker(f.store, f.objects).tick();
    p = await f.store.get(p.id);
    const blocks = structuredClone(material(p).blocks);
    assert.equal(material(p).parse.runStatus, 'succeeded');
    assert.equal(blocks[0]!.kind, 'asset');
    assert.equal(blocks[0]!.status, 'candidate');
    assert.deepEqual(blocks[0]!.image, { widthPx: 3, heightPx: 2, format: 'png', hasAlpha: true,
      textRecognition: 'not_performed', semanticAnalysis: 'not_performed' });
    assert.equal(blocks[0]!.text, undefined);
    assert.equal(p.inputRevision, inputRevision);
    assert.deepEqual(p.evidence, []);
    const originalUrl = `${url}/${firstId}/original`;
    assert.equal((await f.app.inject({ method: 'GET', url: originalUrl })).statusCode, 401);
    const original = await f.app.inject({ method: 'GET', url: originalUrl, headers: f.headers });
    assert.deepEqual(original.rawPayload, bytes);
    assert.match(String(original.headers['content-disposition']), /^attachment;/);
    assert.doesNotMatch(String(original.headers['content-disposition']), /\.\.\//);
    assert.equal(original.headers['x-content-type-options'], 'nosniff');
    const another = await initialized(f);
    assert.equal((await f.app.inject({ method: 'GET', url: `/api/projects/${another.id}/production/materials/${firstId}/original`, headers: f.headers })).statusCode, 404);
    assert.deepEqual((await f.post(url, payload)).json(), receipt);
    assert.deepEqual(await f.store.get(p.id), p);
    assert.equal((await f.post(url, { ...payload, fileName: 'different.png' })).json().error.code, 'IDEMPOTENCY_CONFLICT');
    p = await f.write(p, 'production/materials', upload('second-export.png', bytes, 'image/png', { ...source, revision: '16' }));
    assert.equal(p.production!.materials!.length, 1);
    assert.equal(material(p).id, firstId);
    assert.equal(material(p).origins.length, 2);
    assert.deepEqual(material(p).blocks, blocks);
    assert.equal(material(p).parse.attempt, 1);
    assert.deepEqual(await readdir(f.objectDirectory), [material(p).objectKey]);
  } finally { await f.close(); }
});

test('upload limits and unsupported types reject before storage; expanded bodyLimit is confined to the upload route', async () => {
  const f = await fixture();
  try {
    let p = await f.create();
    const url = `/api/projects/${p.id}/production/materials`;
    assert.equal((await f.post(url, command(p, upload('test.txt', 'test')))).json().error.code, 'PRODUCTION_NOT_INITIALIZED');
    p = await f.write(p, 'production/initialize');
    assert.equal((await f.app.inject({ method: 'POST', url, payload: command(p, upload('test.txt', 'test')) })).statusCode, 401);
    const invalidCases = [
      { payload: upload('source.pdf', '%PDF-1.4 test', 'application/pdf'), status: 415, code: 'UNSUPPORTED_FILE_TYPE' },
      { payload: upload('source.docx', Buffer.from('504b0304', 'hex'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), status: 415, code: 'UNSUPPORTED_FILE_TYPE' },
      { payload: { ...upload('source.txt', 'test'), contentBase64: 'AAAA!' }, status: 400, code: 'INVALID_FILE_ENCODING' },
      { payload: upload('empty.txt', ''), status: 400, code: 'EMPTY_FILE' },
      { payload: { ...upload('source.txt', 'test'), source: { kind: 'feishu_export' } }, status: 400, code: 'INVALID_REQUEST' },
      { payload: { ...upload('source.txt', 'test'), approved: true }, status: 400, code: 'INVALID_REQUEST' },
    ];
    for (const invalid of invalidCases) {
      const response = await f.post(url, command(p, invalid.payload));
      assert.equal(response.statusCode, invalid.status);
      assert.equal(response.json().error.code, invalid.code);
      if (invalid.status === 415) assert.ok(response.json().error.details.supportedFormats.includes('csv'));
    }
    const oversized = await f.post(url, command(p, upload('large.txt', Buffer.alloc(MAX_FILE_BYTES + 1, 'a'))));
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.json().error.code, 'FILE_TOO_LARGE');
    const transportLimit = await f.post(url, command(p, { ...upload('large.txt', 'a'), padding: 'x'.repeat(MATERIAL_UPLOAD_BODY_LIMIT) }));
    assert.equal(transportLimit.statusCode, 413);
    assert.equal(transportLimit.json().error.code, 'FILE_TOO_LARGE');
    assert.equal(transportLimit.json().error.details.maxFileBytes, MAX_FILE_BYTES);
    assert.deepEqual(await readdir(f.objectDirectory), []);
    assert.deepEqual(await f.store.get(p.id), p);
    const overLegacyBodyLimit = ('x'.repeat(600) + '\n').repeat(1000);
    p = await f.write(p, 'production/materials', upload('large-but-supported.txt', overLegacyBodyLimit));
    assert.equal(material(p).sizeBytes, Buffer.byteLength(overLegacyBodyLimit));
    const otherRoute = await f.post(`/api/projects/${p.id}/identity/confirm`, command(p, { productName: 'x', padding: overLegacyBodyLimit }));
    assert.equal(otherRoute.statusCode, 413);
    assert.equal(otherRoute.json().error.code, 'INVALID_REQUEST');
  } finally { await f.close(); }
});

test('text, Markdown, multiline CSV and JSON preserve source positions and never become confirmed evidence', async () => {
  const f = await fixture();
  try {
    let p = await initialized(f);
    const plain = '第一行\r\n\r\n  容量：10 L  \n';
    const csv = '名称,说明\r\n"AW FLEX","第一行\r\n第二行 ""引用"""\r\n箱子,3\r\n';
    const json = '{ "product": { "name": "AW FLEX", "a/b~": [10, true, null], "empty": {} } }';
    p = await f.write(p, 'production/materials', upload('source.txt', '\uFEFF' + plain));
    p = await f.write(p, 'production/materials', upload('source.md', '# 原文\n<script>neverRun()</script>', 'text/markdown', { kind: 'local_upload' }, 'reference'));
    p = await f.write(p, 'production/materials', upload('sheet.csv', csv, 'text/csv', { kind: 'local_upload' }, 'product_evidence'));
    p = await f.write(p, 'production/materials', upload('source.json', json, 'application/json', { kind: 'local_upload' }, 'mixed'));
    const worker = new IngestionWorker(f.store, f.objects);
    for (let i = 0; i < 4; i++) assert.equal(await worker.tick(), true);
    p = await f.store.get(p.id);
    assert.ok(p.production!.materials!.every(item => item.parse.runStatus === 'succeeded' && item.usage.status === 'pending'));
    assert.equal(material(p, 0).blocks[1]!.text, '  容量：10 L  ');
    assert.deepEqual(material(p, 0).blocks[1]!.locator, { type: 'text', startLine: 3, endLine: 3, startOffset: 7, endOffset: 18 });
    assert.equal(material(p, 1).blocks[1]!.kind, 'reference_block');
    assert.equal(material(p, 1).blocks[1]!.text, '<script>neverRun()</script>');
    const table = material(p, 2).blocks;
    assert.equal(table.length, 3);
    assert.deepEqual(table[1]!.cells, ['AW FLEX', '第一行\r\n第二行 "引用"']);
    assert.equal(table[1]!.kind, 'evidence_block');
    assert.deepEqual(table[1]!.locator, { type: 'csv', row: 2, startLine: 2, endLine: 3, startOffset: 7, endOffset: 34 });
    const jsonBlocks = material(p, 3).blocks;
    assert.deepEqual(jsonBlocks.map(item => item.locator.type === 'json' ? item.locator.pointer : ''),
      ['/product/name', '/product/a~1b~0/0', '/product/a~1b~0/1', '/product/a~1b~0/2', '/product/empty']);
    for (const item of jsonBlocks) {
      assert.equal(item.kind, 'unclassified_block');
      assert.ok(item.locator.type === 'json');
      assert.equal(json.slice(item.locator.startOffset, item.locator.endOffset), item.text);
    }
    assert.deepEqual(p.evidence, []);
    assert.deepEqual(p.facts, []);
  } finally { await f.close(); }
});

test('invalid source parsing fails per file, keeps original and retains explicit retry attempt history', async () => {
  const f = await fixture();
  try {
    let p = await initialized(f);
    const sources = [
      ['broken.csv', 'a,"unclosed', 'text/csv', 'INVALID_CSV'],
      ['duplicate.json', '{"name":1,"na\\u006de":2}', 'application/json', 'DUPLICATE_JSON_KEY'],
      ['invalid.json', '{"a":1,}', 'application/json', 'INVALID_JSON'],
      ['deep.json', '['.repeat(65) + '0' + ']'.repeat(65), 'application/json', 'JSON_TOO_DEEP'],
      ['good.json', '{"capacity":10}', 'application/json', undefined],
    ] as const;
    for (const [name, text, mime] of sources) p = await f.write(p, 'production/materials', upload(name, text, mime));
    p = await f.write(p, 'production/materials', upload('bad-encoding.txt', Buffer.from([0xff, 0xfe, 0x61, 0x00])));
    const worker = new IngestionWorker(f.store, f.objects);
    for (let i = 0; i < 6; i++) await worker.tick();
    p = await f.store.get(p.id);
    for (let i = 0; i < sources.length; i++) {
      assert.equal(material(p, i).parse.errorCode, sources[i]![3]);
      assert.equal(material(p, i).parse.runStatus, sources[i]![3] ? 'failed' : 'succeeded');
      if (sources[i]![3]) assert.deepEqual(material(p, i).blocks, []);
    }
    assert.equal(material(p, 5).parse.errorCode, 'INVALID_TEXT_ENCODING');
    const id = material(p).id;
    const download = await f.app.inject({ method: 'GET', url: `/api/projects/${p.id}/production/materials/${id}/original`, headers: f.headers });
    assert.equal(download.rawPayload.toString(), sources[0][1]);
    const beforeRetry = command(p);
    p = await f.write(p, `production/materials/${id}/parse/retry`);
    await worker.tick();
    p = await f.store.get(p.id);
    assert.equal(material(p).parse.attempt, 2);
    assert.deepEqual(material(p).parse.attempts.map(item => item.status), ['failed', 'failed']);
    assert.deepEqual(material(p).blocks, []);
    const stale = await f.post(`/api/projects/${p.id}/production/materials/${id}/parse/retry`, beforeRetry);
    assert.equal(stale.json().error.code, 'REVISION_CONFLICT');
    assert.equal((await f.post(`/api/projects/${p.id}/production/materials/${material(p, 4).id}/parse/retry`, command(p))).json().error.code, 'PARSE_RETRY_NOT_ALLOWED');
  } finally { await f.close(); }
});

test('PNG, JPEG and WebP decode fully; corrupt images and disguised image types do not produce assets', async () => {
  const f = await fixture();
  try {
    let p = await initialized(f);
    const png = await sharp({ create: { width: 12, height: 7, channels: 3, background: '#9a4723' } }).png().toBuffer();
    const jpeg = await sharp(png).jpeg().toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    for (const [name, bytes, mime] of [['image.png', png, 'image/png'], ['image.jpg', jpeg, 'image/jpeg'], ['image.webp', webp, 'image/webp']] as const)
      p = await f.write(p, 'production/materials', upload(name, bytes, mime));
    const mismatched = await f.post(`/api/projects/${p.id}/production/materials`, command(p, upload('disguised.jpg', png, 'image/jpeg')));
    assert.equal(mismatched.statusCode, 415);
    assert.equal(mismatched.json().error.code, 'FILE_TYPE_MISMATCH');
    p = await f.write(p, 'production/materials', upload('truncated.png', png.subarray(0, Math.floor(png.length / 2)), 'image/png'));
    p = await f.write(p, 'production/materials', upload('truncated.jpg', jpeg.subarray(0, jpeg.length - 20), 'image/jpeg'));
    const worker = new IngestionWorker(f.store, f.objects);
    for (let i = 0; i < 5; i++) await worker.tick();
    p = await f.store.get(p.id);
    for (let i = 0; i < 3; i++) {
      assert.equal(material(p, i).parse.runStatus, 'succeeded');
      assert.equal(material(p, i).blocks[0]!.image!.widthPx, 12);
      assert.equal(material(p, i).blocks[0]!.image!.heightPx, 7);
    }
    for (let i = 3; i < 5; i++) {
      assert.equal(material(p, i).parse.errorCode, 'INVALID_IMAGE');
      assert.deepEqual(material(p, i).blocks, []);
    }
  } finally { await f.close(); }
});

test('expired parser lease and late completions cannot duplicate blocks; retry recovers the same file', async () => {
  const f = await fixture();
  try {
    let p = await initialized(f);
    p = await f.write(p, 'production/materials', upload('source.txt', 'line one\nline two'));
    const queue = new MaterialQueue(f.store);
    const original = (await queue.claim())!;
    assert.equal(original.material.parse.attempt, 1);
    const output = await parseMaterial(original.material, Buffer.from('line one\nline two'));
    await f.db.query(`UPDATE projects SET state=jsonb_set(state, '{production,materials,0,parse,leaseUntil}', to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1`, [p.id]);
    assert.equal(await new MaterialQueue(f.store).claim(), undefined);
    p = await f.store.get(p.id);
    assert.equal(material(p).parse.errorCode, 'PARSE_WORKER_INTERRUPTED');
    assert.equal(await queue.finish(original, { output }), false);
    p = await f.write(p, `production/materials/${material(p).id}/parse/retry`);
    const current = (await queue.claim())!;
    assert.equal(current.material.parse.id, original.material.parse.id);
    assert.equal(current.material.parse.attempt, 2);
    assert.equal(await queue.finish(original, { output }), false);
    assert.equal(await queue.finish(current, { output: await parseMaterial(current.material, Buffer.from('line one\nline two')) }), true);
    p = await f.store.get(p.id);
    assert.deepEqual(material(p).blocks, output.blocks);
    assert.deepEqual(material(p).parse.attempts.map(item => item.status), ['failed', 'succeeded']);
    assert.equal(await queue.finish(current, { output }), false);
    assert.deepEqual(await f.store.get(p.id), p);
  } finally { await f.close(); }
});

test('file storage failures are explicit; a missing original can be restored without creating duplicate material', async () => {
  const f = await fixture();
  try {
    let p = await initialized(f);
    const input = upload('source.txt', 'source content');
    p = await f.write(p, 'production/materials', input);
    const stored = material(p);
    await unlink(join(f.objectDirectory, stored.objectKey));
    const worker = new IngestionWorker(f.store, f.objects);
    await worker.tick(); p = await f.store.get(p.id);
    assert.equal(material(p).parse.errorCode, 'SOURCE_FILE_MISSING');
    p = await f.write(p, 'production/materials', input);
    assert.equal(p.production!.materials!.length, 1);
    p = await f.write(p, `production/materials/${stored.id}/parse/retry`);
    await worker.tick(); p = await f.store.get(p.id);
    assert.equal(material(p).parse.runStatus, 'succeeded');
    await writeFile(join(f.objectDirectory, stored.objectKey), 'corrupted');
    const original = await f.app.inject({ method: 'GET', url: `/api/projects/${p.id}/production/materials/${stored.id}/original`, headers: f.headers });
    assert.equal(original.statusCode, 409);
    assert.equal(original.json().error.code, 'SOURCE_FILE_INTEGRITY_FAILED');
    await assert.rejects(f.objects.readBinary('../../outside', 0), /INVALID_SOURCE_OBJECT_KEY/);
    await assert.rejects(f.objects.putBinary(Buffer.from('source content')), /SOURCE_FILE_INTEGRITY_FAILED/);
    assert.ok((await readdir(f.objectDirectory)).every(name => !name.endsWith('.tmp')));
  } finally { await f.close(); }
});

test('parser resource limits reject without truncation and CSV empty cells retain their positions', async () => {
  const parse = (name: string, bytes: Buffer | string, mime = 'text/plain') => {
    const input = materialUploadSchema.parse({ expectedProjectVersion: 1, expectedRevision: 1, idempotencyKey: randomUUID(), ...upload(name, bytes, mime) });
    const decoded = decodeMaterialUpload(input);
    const item = createMaterial(input, decoded, `${decoded.sha256}.bin`, 'test-human');
    return parseMaterial(item, decoded.bytes);
  };
  await assert.rejects(parse('over-text-limit.txt', Buffer.alloc(MAX_TEXT_BYTES + 1, 'a')), /TEXT_SIZE_LIMIT/);
  await assert.rejects(parse('too-many-lines.txt', 'line\n'.repeat(2001)), /PARSE_OUTPUT_LIMIT/);
  await assert.rejects(parse('too-long-line.txt', 'a'.repeat(32001)), /PARSE_OUTPUT_LIMIT/);
  const cells = await parse('empty-cells.csv', ',"",\r\na,"b,b",', 'text/csv');
  assert.deepEqual(cells.blocks.map(item => item.cells), [['', '', ''], ['a', 'b,b', '']]);
  const strings = await parse('brackets.json', JSON.stringify({ text: '['.repeat(100) }), 'application/json');
  assert.equal(strings.blocks.length, 1);
  await assert.rejects(parse('unicode.json', '{"\\ud800":1}', 'application/json'), /INVALID_JSON_UNICODE/);
  await assert.rejects(parse('null-character.json', '{"text":"\\u0000"}', 'application/json'), /INVALID_JSON_UNICODE/);
  await assert.rejects(parse('long-pointer.json', JSON.stringify({ ['x'.repeat(2001)]: [1, 2] }), 'application/json'), /PARSE_OUTPUT_LIMIT/);
  await assert.rejects(parse('expanded-output.json', JSON.stringify({ ['x'.repeat(1900)]: Array.from({ length: 2000 }, () => 1) }), 'application/json'), /PARSE_OUTPUT_LIMIT/);
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  let marker = -1;
  for (let i = 0; i < tiny.length - 9; i++) if (tiny[i] === 0xff && [0xc0, 0xc1, 0xc2].includes(tiny[i + 1]!)) { marker = i; break; }
  assert.ok(marker >= 0);
  tiny.writeUInt16BE(5000, marker + 5);
  tiny.writeUInt16BE(10000, marker + 7);
  await assert.rejects(parse('too-many-pixels.jpg', tiny, 'image/jpeg'), /IMAGE_DIMENSIONS_LIMIT/);
});

test('atomic binary publication deduplicates concurrent writers and unusual display names cannot become paths', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.from('concurrent content');
    const saved = await Promise.all([f.objects.putBinary(bytes), f.objects.putBinary(bytes)]);
    assert.deepEqual(saved[0], saved[1]);
    assert.deepEqual(await readdir(f.objectDirectory), [saved[0]!.objectKey]);
    let p = await initialized(f);
    const invalidName = await f.post(`/api/projects/${p.id}/production/materials`, command(p, upload('..\\\ud800.txt', bytes)));
    assert.equal(invalidName.statusCode, 400);
    assert.equal(invalidName.json().error.code, 'INVALID_REQUEST');
    p = await f.write(p, 'production/materials', upload("..\\原文'().txt", bytes));
    const downloaded = await f.app.inject({ method: 'GET', url: `/api/projects/${p.id}/production/materials/${material(p).id}/original`, headers: f.headers });
    assert.equal(downloaded.statusCode, 200);
    assert.deepEqual(downloaded.rawPayload, bytes);
  } finally { await f.close(); }
});

test('concurrent uploads have one revision winner, same intent replays once, and independent old model inputs stay valid', async () => {
  const f = await fixture();
  try {
    let p = await initialized(f);
    const input = upload('source.txt', 'first');
    const body = command(p, input);
    const url = `/api/projects/${p.id}/production/materials`;
    const same = await Promise.all([f.post(url, body), f.post(url, body)]);
    assert.equal(same[0]!.statusCode, 200);
    assert.deepEqual(same[0]!.json(), same[1]!.json());
    p = same[0]!.json<Project>();
    const competing = await Promise.all([f.post(url, command(p, upload('a.txt', 'second'))), f.post(url, command(p, upload('b.txt', 'third')))]);
    assert.deepEqual(competing.map(result => result.statusCode).sort(), [200, 409]);
    p = await f.store.get(p.id);
    p = await f.write(p, 'evidence', { documentName: 'legacy.txt', locator: 'p1', usage: 'product_evidence', text: '10 kg' });
    p = await f.write(p, 'runs', { skill: 'extract-facts' });
    const inputRevision = p.inputRevision;
    await new Worker(f.store, { generate: async (_skill, snapshot) => {
      const changed = await f.write(snapshot, 'production/materials', upload('during.txt', 'new unrelated source'));
      assert.equal(changed.inputRevision, inputRevision);
      const parser = new IngestionWorker(f.store, f.objects);
      while (await parser.tick()) { /* Drain deterministic files during the synthetic legacy call. */ }
      return extraction(snapshot);
    } }).tick();
    p = await f.store.get(p.id);
    assert.equal(p.runs[0]!.runStatus, 'succeeded');
    assert.equal(p.facts.length, 1);
    assert.equal(p.evidence.length, 1);
    assert.ok(p.production!.materials!.every(item => item.usage.status === 'pending'));
    const schema = await f.app.inject({ method: 'GET', url: '/api/contracts', headers: f.headers });
    assert.ok(schema.json().requests.materialUpload);
    assert.ok(schema.json().requests.materialParseRetry);
    const unknown = await f.app.inject({ method: 'GET', url: `/api/projects/${p.id}/production/materials/${randomUUID()}/original`, headers: f.headers });
    assert.equal(unknown.statusCode, 404);
  } finally { await f.close(); }
});
