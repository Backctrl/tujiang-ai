import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { postgres, migrate, type Database } from '../src/database.js';
import { Store } from '../src/store.js';
import { createProject, enqueue, retryRun } from '../src/domain.js';
import { Worker } from '../src/worker.js';
import { AppError } from '../src/errors.js';
import type { Project } from '../src/contracts.js';
import { buildApp } from '../src/app.js';
import { LocalObjects } from '../src/objects.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeProduction } from '../src/production.js';
import { activateContext, bindRulePackVersion, saveContextDraft, type RulePack } from '../src/production-context.js';
import { context, rule } from './fixtures/production-context.js';

const configuredUrl = process.env.TEST_DATABASE_URL;
if (!configuredUrl) throw new Error('TEST_DATABASE_URL is required: real PostgreSQL integration tests cannot be skipped.');
let baseUrl: URL;
try { baseUrl = new URL(configuredUrl); } catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }
if (!['postgres:', 'postgresql:'].includes(baseUrl.protocol)) throw new Error('TEST_DATABASE_URL must use PostgreSQL.');

async function isolated(action: (db: Database, peer: Database, reconnect: (onIdleError?: () => void) => Promise<Database>) => Promise<void>) {
  const schema = `tujiang_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^tujiang_test_[a-f0-9]{32}$/);
  const admin = postgres(baseUrl.toString());
  const connections: Database[] = [];
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const url = new URL(baseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    const open = async (onIdleError?: () => void) => {
      const db = postgres(url.toString(), onIdleError);
      connections.push(db);
      const result = await db.query<{ schema: string; version: string }>('SELECT current_schema() AS schema, version() AS version');
      assert.equal(result.rows[0]?.schema, schema);
      assert.match(result.rows[0]!.version, /^PostgreSQL /);
      return db;
    };
    const db = await open();
    const peer = await open();
    await action(db, peer, open);
  } finally {
    try {
      await Promise.all(connections.map(db => db.close()));
    } finally {
      try {
        // Only this invocation's random, validated schema is eligible for cleanup.
        if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally { await admin.close(); }
    }
  }
}

const command = (p?: Project, idempotencyKey = randomUUID()) => ({
  expectedProjectVersion: p?.version ?? 0, expectedRevision: p?.revision ?? 0, idempotencyKey,
});

test('real PostgreSQL: HTTP production initialization preserves legacy snapshots and receipts', async () => {
  await isolated(async (db) => {
    await migrate(db);
    const store = new Store(db);
    const token = randomUUID();
    // These routes never write object files; no fixture directory is created.
    const app = buildApp(store, new LocalObjects(join(tmpdir(), `unused-${randomUUID()}`)), { token, actor: 'pg-test' });
    const headers = { authorization: `Bearer ${token}` };
    const body = { ...command(), name: 'Legacy production migration fixture' };
    try {
      const create = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: body });
      assert.equal(create.statusCode, 201);
      const old = create.json<Project>();
      const oldHistory = await db.query('SELECT state FROM project_revisions WHERE project_id=$1 ORDER BY revision', [old.id]);
      const unauthorized = await app.inject({ method: 'GET', url: '/api/projects' });
      assert.equal(unauthorized.statusCode, 401);
      const listing = await app.inject({ method: 'GET', url: '/api/projects', headers });
      assert.equal(listing.json().projects[0].id, old.id);
      assert.deepEqual(await store.get(old.id), old);
      const url = `/api/projects/${old.id}/production/initialize`;
      const initBody = command(old);
      const initialized = await app.inject({ method: 'POST', url, headers, payload: initBody });
      assert.equal(initialized.statusCode, 200);
      const next = initialized.json<Project>();
      assert.deepEqual(next.production?.objects, []);
      assert.deepEqual(next.sections, old.sections);
      assert.equal(next.revision, old.revision + 1);
      const repeat = await app.inject({ method: 'POST', url, headers, payload: command(next) });
      assert.deepEqual(repeat.json(), next);
      const replay = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: body });
      assert.deepEqual(replay.json(), old);
      assert.deepEqual((await db.query('SELECT state FROM project_revisions WHERE project_id=$1 AND revision=$2', [old.id, old.revision])).rows, oldHistory.rows);
      assert.deepEqual(await store.get(old.id), next);
      const conflict = await app.inject({ method: 'POST', url, headers, payload: { ...initBody, expectedRevision: next.revision } });
      assert.equal(conflict.statusCode, 409);
    } finally { await app.close(); }
  });
});
async function seed(store: Store, queued = false) {
  return store.command(undefined, command(), 'project.created', 'pg-test', () => {
    const p = createProject('PostgreSQL integration fixture');
    if (queued) {
      p.evidence.push({ id: randomUUID(), documentName: 'synthetic.txt', locator: 'line 1', usage: 'product_evidence',
        text: 'Capacity: 10 kg.', sha256: 'test-only', objectKey: 'test-only', createdBy: 'pg-test' });
      enqueue(p, 'extract-facts', 'pg-test');
    }
    return p;
  });
}
async function stagedContext(store: Store) {
  const p = await seed(store);
  return store.command(p.id, command(p), 'test.context.draft', 'pg-test', current => {
    initializeProduction(current!); saveContextDraft(current!.production!, context); return current!;
  }, { preserveStageAInput: true });
}
async function activateRegistered(store: Store, p: Project, rulePack: RulePack = rule, body = command(p)) {
  return store.command(p.id, body, 'production.context.activated', 'pg-test', async (current, tx) => {
    const activated = activateContext(current!.production!, { rulePacks: [rulePack] }, 'pg-test');
    await bindRulePackVersion(tx, activated);
    return current!;
  }, { preserveStageAInput: true });
}

test('real PostgreSQL: concurrent migrations are repeatable and failed transactions roll back', async () => {
  await isolated(async (db, peer) => {
    await Promise.all([migrate(db), migrate(peer)]);
    await migrate(db);
    const tables = await db.query<{ table_name: string }>('SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name');
    assert.deepEqual(tables.rows.map(r => r.table_name), ['command_receipts', 'production_rule_packs', 'project_revisions', 'projects']);
    const p = createProject('rollback');
    await assert.rejects(db.transaction(async tx => {
      await new Store(db).save(p, tx);
      throw new Error('intentional rollback');
    }), /intentional rollback/);
    assert.equal((await peer.query('SELECT id FROM projects')).rows.length, 0);
    assert.equal((await peer.query('SELECT revision FROM project_revisions')).rows.length, 0);
  });
});

test('real PostgreSQL: competing business version writes have exactly one winner', async () => {
  await isolated(async (db, peer) => {
    await migrate(db);
    const p = await seed(new Store(db));
    const results = await Promise.allSettled([db, peer].map(connection => new Store(connection).command(
      p.id, command(p), 'identity.confirmed', 'pg-test', current => { current!.version++; return current!; },
    )));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const failure = results.find(r => r.status === 'rejected');
    assert.ok(failure?.status === 'rejected' && failure.reason instanceof AppError);
    assert.equal(failure.reason.code, 'VERSION_CONFLICT');
    const stored = await new Store(db).get(p.id);
    assert.equal(stored.version, 2);
    assert.equal(stored.revision, 2);
    assert.equal((await db.query('SELECT revision FROM project_revisions')).rows.length, 2);
    assert.equal((await db.query('SELECT key FROM command_receipts')).rows.length, 2);
  });
});

test('real PostgreSQL: concurrent identical idempotency keys execute one mutation and return one receipt', async () => {
  await isolated(async (db, peer) => {
    await migrate(db);
    const body = command();
    let executions = 0;
    const results = await Promise.all([db, peer].map(connection => new Store(connection).command(
      undefined, body, 'project.created', 'pg-test', () => { executions++; return createProject('once'); },
    )));
    assert.equal(executions, 1);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await db.query('SELECT id FROM projects')).rows.length, 1);
    assert.equal((await db.query('SELECT key FROM command_receipts')).rows.length, 1);
    await assert.rejects(new Store(peer).command(undefined, body, 'different.operation', 'pg-test', () => createProject('forbidden')),
      error => error instanceof AppError && error.code === 'IDEMPOTENCY_CONFLICT');
  });
});

test('real PostgreSQL: two Workers execute a queued run only once while its model call is in flight', async () => {
  await isolated(async (db, peer) => {
    await migrate(db);
    const p = await seed(new Store(db), true);
    let calls = 0;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const model = { generate: async () => { calls++; entered(); if (calls === 1) await gate; return { facts: [] }; } };
    const first = new Worker(new Store(db), model).tick();
    try {
      await Promise.race([started, first.then(() => { throw new Error('first Worker did not enter model'); })]);
      assert.equal(await new Worker(new Store(peer), model).tick(), false);
    } finally { release(); await first; }
    const run = (await new Store(db).get(p.id)).runs[0]!;
    assert.equal(calls, 1);
    assert.equal(run.attempt, 1);
    assert.equal(run.runStatus, 'succeeded');
    assert.equal(run.queueStatus, 'done');
  });
});

test('real PostgreSQL: expired lease fails safely, ignores late result and supports explicit retry', async () => {
  await isolated(async (db, peer) => {
    await migrate(db);
    const store = new Store(db);
    const p = await seed(store, true);
    const claimed = await store.claim();
    assert.ok(claimed);
    await db.query(`UPDATE projects SET state=jsonb_set(state, '{runs,0,leaseUntil}', to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1`, [p.id]);
    assert.equal(await new Store(peer).claim(), undefined);
    const failed = await store.get(p.id);
    assert.equal(failed.runs[0]!.errorCode, 'WORKER_INTERRUPTED');
    assert.equal(failed.runs[0]!.runStatus, 'failed');
    assert.equal(failed.runs[0]!.queueStatus, 'done');
    await store.finish(p.id, claimed.run.id, claimed.run.attempt, () => { throw new Error('late result must not apply'); });
    assert.deepEqual(await store.get(p.id), failed);
    await store.command(p.id, command(failed), 'run.retry', 'pg-test', current => { retryRun(current!, claimed.run.id); return current!; });
    await new Worker(new Store(peer), { generate: async () => ({ facts: [] }) }).tick();
    const completed = await store.get(p.id);
    assert.equal(completed.runs[0]!.attempt, 2);
    assert.equal(completed.runs[0]!.runStatus, 'succeeded');
    assert.equal(completed.runs[0]!.leaseUntil, undefined);
  });
});

test('real PostgreSQL: fresh connection pools preserve project, audit, revisions and idempotency receipts', async () => {
  await isolated(async (db, peer, reconnect) => {
    await migrate(db);
    const body = command();
    const p = await new Store(db).command(undefined, body, 'project.created', 'pg-test', () => createProject('persistent'));
    // End both original pools; their close methods become no-ops for fixture cleanup.
    await Promise.all([db.close(), peer.close()]);
    db.close = peer.close = async () => {};
    const fresh = await reconnect();
    await migrate(fresh);
    const store = new Store(fresh);
    assert.deepEqual(await store.get(p.id), p);
    assert.deepEqual(await store.command(undefined, body, 'project.created', 'pg-test', () => { throw new Error('receipt must replay'); }), p);
    const history = await fresh.query<{ state: Project }>('SELECT state FROM project_revisions WHERE project_id=$1', [p.id]);
    assert.deepEqual(history.rows.map(r => r.state), [p]);
    assert.equal((await store.get(p.id)).audit.length, 1);
  });
});

test('real PostgreSQL: terminating its own idle connection reports safely and reconnects without data loss', async () => {
  await isolated(async (db, peer, reconnect) => {
    await migrate(db);
    let reportIdleError!: () => void;
    const idleError = new Promise<void>(resolve => { reportIdleError = resolve; });
    let callbackCount = 0;
    const target = await reconnect(() => { callbackCount++; reportIdleError(); });
    const p = await seed(new Store(target));
    const own = await target.query<{ pid: number; schema: string; started: string }>(
      'SELECT pg_backend_pid() AS pid, current_schema() AS schema, backend_start::text AS started FROM pg_stat_activity WHERE pid=pg_backend_pid()',
    );
    const connection = own.rows[0]!;
    const scope = await peer.query<{ schema: string }>('SELECT current_schema() AS schema');
    assert.match(connection.schema, /^tujiang_test_[a-f0-9]{32}$/);
    assert.equal(connection.schema, scope.rows[0]!.schema);
    assert.ok(Number.isInteger(connection.pid) && connection.pid > 0);
    // Match PID and server start time to avoid terminating any reused or unrelated PID.
    const killed = await peer.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
       WHERE pid=$1 AND backend_start=$2::timestamptz AND state='idle' AND pid<>pg_backend_pid()`,
      [connection.pid, connection.started],
    );
    assert.equal(killed.rows[0]?.terminated, true);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([idleError, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('idle connection error callback did not fire')), 5000);
      })]);
    } finally { clearTimeout(timer); }
    assert.equal(callbackCount, 1);
    const resumed = await target.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    assert.notEqual(resumed.rows[0]!.pid, connection.pid);
    assert.deepEqual(await new Store(target).get(p.id), p);
    const history = await target.query<{ state: Project }>('SELECT state FROM project_revisions WHERE project_id=$1', [p.id]);
    assert.deepEqual(history.rows.map(r => r.state), [p]);
  });
});

test('real PostgreSQL: rule binding is shared across projects, persists after restart and rejects a changed catalog', async () => {
  await isolated(async (db, peer, reconnect) => {
    await migrate(db);
    const stores = [new Store(db), new Store(peer)];
    const drafts = await Promise.all(stores.map(stagedContext));
    const firstBody = command(drafts[0]!);
    const activated = await Promise.all([
      activateRegistered(stores[0]!, drafts[0]!, rule, firstBody),
      activateRegistered(stores[1]!, drafts[1]!),
    ]);
    const bindings = (await db.query('SELECT * FROM production_rule_packs')).rows;
    assert.equal(bindings.length, 1);
    const first = activated[0]!;
    assert.equal(first.production!.context!.versions[0]!.rulePackSha256, activated[1]!.production!.context!.versions[0]!.rulePackSha256);
    await Promise.all([db.close(), peer.close()]);
    db.close = peer.close = async () => {};
    const fresh = await reconnect();
    await migrate(fresh);
    const store = new Store(fresh);
    assert.deepEqual((await fresh.query('SELECT * FROM production_rule_packs')).rows, bindings);
    assert.deepEqual(await store.get(first.id), first);
    const changed = { ...rule, verifiedBy: 'new-server-config' };
    assert.deepEqual(await activateRegistered(store, drafts[0]!, changed, firstBody), first);
    const other = await stagedContext(store);
    const receipts = (await fresh.query('SELECT key FROM command_receipts')).rows.length;
    await assert.rejects(activateRegistered(store, other, changed), error => error instanceof AppError && error.code === 'RULE_PACK_VERSION_CHANGED');
    assert.deepEqual(await store.get(other.id), other);
    assert.deepEqual(await store.get(first.id), first);
    assert.equal((await fresh.query('SELECT key FROM command_receipts')).rows.length, receipts);
  });
});

test('real PostgreSQL: concurrent services cannot bind different hashes to the same rule identity', async () => {
  await isolated(async (db, peer) => {
    await migrate(db);
    const stores = [new Store(db), new Store(peer)];
    const drafts = await Promise.all(stores.map(stagedContext));
    const receipts = (await db.query('SELECT key FROM command_receipts')).rows.length;
    const outcomes = await Promise.allSettled([
      activateRegistered(stores[0]!, drafts[0]!),
      activateRegistered(stores[1]!, drafts[1]!, { ...rule, verifiedBy: 'different-server-catalog' }),
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    const loserIndex = outcomes.findIndex(result => result.status === 'rejected');
    const loser = outcomes[loserIndex]!;
    assert.ok(loser.status === 'rejected' && loser.reason instanceof AppError && loser.reason.code === 'RULE_PACK_VERSION_CHANGED');
    assert.deepEqual(await stores[loserIndex]!.get(drafts[loserIndex]!.id), drafts[loserIndex]);
    assert.equal((await db.query('SELECT id FROM production_rule_packs')).rows.length, 1);
    assert.equal((await db.query('SELECT key FROM command_receipts')).rows.length, receipts + 1);
  });
});
