import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Connection, Database } from '../src/database.js';
import { migrate } from '../src/database.js';
import { Store } from '../src/store.js';
import { createProject } from '../src/domain.js';
import { fixture } from './helpers.js';

test('disk restart preserves revisions, audit and idempotency receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tujiang-persistence-'));
  const open = () => {
    const engine = new PGlite(join(dir, 'db'));
    const wrap = (conn: Pick<PGlite, 'query'>): Connection => ({
      async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await conn.query<T>(sql, params); return { rows: result.rows };
      },
    });
    const db: Database = { ...wrap(engine), transaction: fn => engine.transaction(tx => fn(wrap(tx))), close: () => engine.close() };
    return db;
  };
  let db = open();
  try {
    await migrate(db);
    const body = { expectedProjectVersion: 0, expectedRevision: 0, idempotencyKey: randomUUID() };
    const p = await new Store(db).command(undefined, body, 'project.created', 'test-human', () => createProject('persisted'));
    await db.close();
    db = open();
    await migrate(db);
    const store = new Store(db);
    assert.deepEqual(await store.get(p.id), p);
    const replay = await store.command(undefined, body, 'project.created', 'test-human', () => { throw new Error('must replay persisted response'); });
    assert.deepEqual(replay, p);
    const history = await db.query('SELECT state FROM project_revisions WHERE project_id=$1', [p.id]);
    assert.equal(history.rows.length, 1);
  } finally { await db.close(); await rm(dir, { recursive: true }); }
});

test('real HTTP SSE replays committed events, resumes by Last-Event-ID and closes cleanly', async () => {
  const f = await fixture();
  try {
    let p = await f.create();
    p = await f.write(p, 'identity/confirm', { productName: 'SSE product' });
    const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
    async function receive(lastEventId?: string) {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${address}/api/projects/${p.id}/events`, {
        headers: { ...f.headers, ...(lastEventId ? { 'last-event-id': lastEventId } : {}) }, signal: controller.signal,
      });
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type')?.includes('text/event-stream'));
      const reader = response.body!.getReader();
      let text = '';
      try {
        while (!text.includes('event: project.changed')) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += new TextDecoder().decode(chunk.value);
        }
      } finally { clearTimeout(deadline); await reader.cancel(); controller.abort(); }
      return text;
    }
    const all = await receive();
    assert.match(all, /id: 1\nevent: project.changed/);
    const resumed = await receive('1');
    assert.doesNotMatch(resumed, /id: 1\nevent:/);
    assert.match(resumed, /id: 2\nevent: project.changed/);
  } finally { await f.close(); }
});
