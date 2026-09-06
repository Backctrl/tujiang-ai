import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, StageAApi } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';
import { readProjectEvents } from '../../src/pages/ArcaneWarriorPage/project-events.js';
import { draftKey, readDraft } from '../../src/pages/ArcaneWarriorPage/project-drafts.js';
import { projectDifferences } from '../../src/pages/ArcaneWarriorPage/project-diff.js';
import { fixture } from './helpers.js';

test('project list sends bearer only in headers and accepts the agreed envelope', async () => {
  let calls = 0;
  const projects = [{ id: 'one', name: 'One', version: 1, revision: 2, contractVersion: 'stage-a.1', updatedAt: '2026-09-06T00:00:00Z' }];
  const client = new StageAApi('secret', async (url, options) => {
    calls++; assert.equal(url, '/api/projects');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer secret');
    assert.equal(options?.redirect, 'error'); assert.equal(options?.body, undefined);
    return Response.json({ projects });
  });
  assert.deepEqual(await client.list(), projects); assert.equal(calls, 1);
});

test('list rejects authentication and malformed snapshots without retries', async () => {
  await assert.rejects(new StageAApi('bad', async () => new Response('', { status: 401 })).list(), (e: unknown) => e instanceof ApiError && e.status === 401);
  await assert.rejects(new StageAApi('valid', async () => Response.json({ projects: [{ id: 'bad' }] })).list(), (e: unknown) => e instanceof ApiError && e.code === 'INVALID_RESPONSE');
});

test('SSE parses fragmented CRLF frames and emits audit cursor, not data revision', async () => {
  const encoder = new TextEncoder();
  const chunks = [': heartbeat\r\n\r\nid: 8\r\neve', 'nt: project.changed\r\ndata: {"revision":99}\r', '\n\r\nid: 9\nevent: ignored\n\nid: 10\nevent: project.changed\n\n'];
  const stream = new ReadableStream({ start(controller) { chunks.forEach(c => controller.enqueue(encoder.encode(c))); controller.close(); } });
  const ids: string[] = [];
  await readProjectEvents(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), id => ids.push(id));
  assert.deepEqual(ids, ['8', '10']);
});

test('SSE rejects expired credentials and non-stream response', async () => {
  await assert.rejects(readProjectEvents(new Response('', { status: 401 }), () => {}), (e: unknown) => e instanceof ApiError && e.status === 401);
  await assert.rejects(readProjectEvents(Response.json({}), () => {}));
});

test('drafts are restored by project namespace, malformed JSON falls back', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([[draftKey('a', 'storyDraft'), JSON.stringify({ text: 'A draft' })], [draftKey('b', 'storyDraft'), JSON.stringify({ text: 'B draft' })]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null } });
  try {
    assert.deepEqual(readDraft('a', 'storyDraft', null), { text: 'A draft' });
    assert.deepEqual(readDraft('b', 'storyDraft', null), { text: 'B draft' });
    assert.equal(readDraft(undefined, 'storyDraft', null), null);
    values.set(draftKey('a', 'storyDraft'), '{bad');
    assert.equal(readDraft('a', 'storyDraft', null), null);
    assert.ok([...values.keys()].every(key => !key.includes('token')));
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('business conflict comparison identifies identity changes', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const client = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${url}${path}`, options));
    const before = await client.create('Conflict comparison');
    const after = await client.write(before, 'identity/confirm', { productName: '真实产品' });
    assert.ok(projectDifferences(before, after).some(line => line.includes('真实产品')));
  } finally { await f.close(); }
});
