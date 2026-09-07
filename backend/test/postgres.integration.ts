import { test } from 'node:test';
import './authorization-postgres.integration.js';
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
import { activateContext, bindRulePackVersion, saveContextDraft, type ProductionCatalog, type RulePack } from '../src/production-context.js';
import { context, rule } from './fixtures/production-context.js';
import { scopedContext, scopedRule, headerScope } from './fixtures/scoped-rules.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { IngestionWorker } from '../src/ingestion-worker.js';
import { parseMaterial } from '../src/material-parser.js';
import { availableConfirmedFacts, evidenceIsAvailable } from '../src/material-source-gates.js';
import type { StartupCheck, StartupStatus } from '../src/production-startup.js';
import type { StartupCommandResponse } from '../src/startup-routes.js';
import { buildStructuredRequest } from '../src/openrouter.js';

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

async function startupHttpServices(databases: Database[], catalogs?: ProductionCatalog[]) {
  const directory = await mkdtemp(join(tmpdir(), 'tujiang-pg-startup-'));
  const objects = new LocalObjects(directory);
  const token = randomUUID(); const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const stores = databases.map(db => new Store(db));
  const catalog: ProductionCatalog = { rulePacks: [rule], scopedRulePacks: [scopedRule] };
  const apps = stores.map((store, index) => buildApp(store, objects, { actor: 'pg-startup-employee', token,
    productionCatalog: catalogs?.[index] ?? catalog, startupExecution: { mode: 'synthetic', workerEnabled: true } }));
  const urls = await Promise.all(apps.map(app => app.listen({ host: '127.0.0.1', port: 0 })));
  const request = (index: number, path: string, body?: unknown) => fetch(`${urls[index]}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const write = async (p: Project, route: string, body: Record<string, unknown> = {}, index = 0) => {
    const response = await request(index, `/api/projects/${p.id}/${route}`, { ...command(p), ...body });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value as Project;
  };
  const create = async (index = 0) => {
    const response = await request(index, '/api/projects', { ...command(), name: 'Synthetic PostgreSQL startup project' });
    assert.equal(response.status, 201); return response.json() as Promise<Project>;
  };
  const check = async (p: Project, index = 0) => {
    const response = await request(index, `/api/projects/${p.id}/production/startup/check`, { context: scopedContext });
    assert.equal(response.status, 200); return response.json() as Promise<StartupCheck>;
  };
  const status = async (p: Project, index = 0) => {
    const response = await request(index, `/api/projects/${p.id}/production/startup`); assert.equal(response.status, 200);
    return (await response.json() as { startup: StartupStatus | null }).startup;
  };
  const evidence = (p: Project, index = 0) => write(p, 'evidence', { documentName: 'synthetic-pg.txt', locator: 'line 1',
    usage: 'product_evidence', text: 'Synthetic capacity: 10 kg' }, index);
  const upload = async (p: Project, fileName: string, text: string, index = 0) => {
    if (!p.production) p = await write(p, 'production/initialize', {}, index);
    return write(p, 'production/materials', { fileName, mimeType: fileName.endsWith('.json') ? 'application/json' : 'text/plain',
      contentBase64: Buffer.from(text, 'utf8').toString('base64'), source: { kind: 'local_upload' } }, index);
  };
  return { objects, stores, apps, urls, token, headers, catalog, request, create, check, status, write, evidence, upload,
    async close() { await Promise.all(apps.map(app => app.close())); await rm(directory, { recursive: true }); } };
}

test('real PostgreSQL over HTTP: startup serializes across services and replays exact responses after fresh pools and model completion', async () => {
  await isolated(async (db, peer, reconnect) => {
    await migrate(db); const s = await startupHttpServices([db, peer]);
    const freshApps: ReturnType<typeof buildApp>[] = [];
    try {
      let p = await s.evidence(await s.create()); const original = structuredClone(p);
      const beforeRevisions = (await db.query('SELECT revision FROM project_revisions')).rows;
      const check = await s.check(p); assert.equal(check.canQueueExtraction, true);
      assert.deepEqual((await db.query('SELECT revision FROM project_revisions')).rows, beforeRevisions);
      const path = `/api/projects/${p.id}/production/startup/start`;
      const bodies = [0, 1].map(() => ({ ...command(p), context: scopedContext, inputFingerprint: check.inputFingerprint }));
      const attempts = await Promise.all(bodies.map((body, index) => s.request(index, path, body)));
      assert.deepEqual(attempts.map(response => response.status).sort(), [200, 409]);
      const winner = attempts.findIndex(response => response.status === 200);
      const accepted = await attempts[winner]!.json() as StartupCommandResponse; p = accepted.project;
      assert.equal(p.production!.context!.versions.length, 1); assert.equal(p.production!.startup!.history.length, 2);
      assert.equal(p.runs.length, 1); assert.equal(accepted.startup.runId, p.runs[0]!.id); assert.equal(accepted.startup.state, 'queued');
      assert.deepEqual(p.facts, []); assert.deepEqual(p.production!.objects, []); assert.equal(p.storyboard, undefined);
      assert.equal(p.identity!.confirmedBy, 'pg-startup-employee');
      assert.deepEqual(await (await s.request(1 - winner, path, bodies[winner])).json(), accepted);
      const beforeNoop = structuredClone(p); const currentCheck = await s.check(p, 1);
      const noop = await s.request(1, path, { ...command(p), context: scopedContext, inputFingerprint: currentCheck.inputFingerprint });
      assert.equal(noop.status, 200); assert.deepEqual((await noop.json() as StartupCommandResponse).project, beforeNoop);
      assert.deepEqual(await s.stores[0]!.get(p.id), beforeNoop);
      const freshDb = await reconnect(); const freshStore = new Store(freshDb);
      const fresh = buildApp(freshStore, s.objects, { actor: 'pg-startup-employee', token: s.token, productionCatalog: s.catalog });
      freshApps.push(fresh); const freshUrl = await fresh.listen({ host: '127.0.0.1', port: 0 });
      assert.deepEqual(await freshStore.get(p.id), p);
      let calls = 0;
      await new Worker(s.stores[1]!, { generate: async (skill, project, _observe, run) => {
        calls++; const input = JSON.parse(buildStructuredRequest(skill, project, 'synthetic-pg-startup', 1000, run).messages[1]!.content);
        assert.deepEqual(input.evidence.map((value: { id: string }) => value.id), [original.evidence[0]!.id]);
        return { facts: [{ attribute: 'capacity', role: 'core', value: '10 kg', evidenceId: input.evidence[0].id, quote: '10 kg' }] };
      } }).tick();
      p = await freshStore.get(p.id); assert.equal(calls, 1); assert.equal(p.runs[0]!.runStatus, 'succeeded');
      assert.equal(p.facts[0]!.status, 'candidate'); assert.equal(p.facts[0]!.locked, false); assert.equal(p.facts[0]!.confirmedBy, undefined);
      const replay = await fetch(`${freshUrl}${path}`, { method: 'POST', headers: s.headers, body: JSON.stringify(bodies[winner]) });
      assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), accepted);
      const current = await (await fetch(`${freshUrl}/api/projects/${p.id}/production/startup`, { headers: s.headers })).json();
      assert.equal(current.startup.state, 'succeeded'); assert.equal(current.startup.modelExecution.status, 'unavailable');
      const saved = await db.query<{ state: Project }>('SELECT state FROM project_revisions WHERE project_id=$1 AND revision=$2', [original.id, original.revision]);
      assert.deepEqual(saved.rows[0]!.state, original);
    } finally { await Promise.all(freshApps.map(app => app.close())); await s.close(); }
  });
});

test('real PostgreSQL over HTTP: startup scope refresh recovers parse failures and explicit continue queues only reviewed sources', async () => {
  await isolated(async (db, peer, reconnect) => {
    await migrate(db); const s = await startupHttpServices([db, peer]);
    try {
      let p = await s.upload(await s.create(), 'broken.json', '{invalid JSON');
      await new IngestionWorker(s.stores[1]!, s.objects).tick(); p = await s.stores[0]!.get(p.id);
      const broken = structuredClone(p.production!.materials![0]!); assert.equal(broken.parse.runStatus, 'failed');
      const check = await s.check(p); assert.equal(check.canStart, true); assert.equal(check.statistics.parseFailed, 1);
      const startupPath = `/api/projects/${p.id}/production/startup`;
      const response = await s.request(0, `${startupPath}/start`, { ...command(p), context: scopedContext, inputFingerprint: check.inputFingerprint });
      assert.equal(response.status, 200); const started = await response.json() as StartupCommandResponse; p = started.project;
      assert.equal(started.startup.state, 'awaiting_product_evidence'); assert.equal(started.startup.runId, null);
      p = await s.upload(p, 'corrected.txt', 'Corrected capacity: 10 kg', 1); const correctId = p.production!.materials![1]!.id;
      const earlierProposal = (await s.status(p, 1))!.scopeRefresh;
      const stale = { ...command(p), inputFingerprint: earlierProposal.inputFingerprint, reason: 'Reviewed corrected original' };
      p = await s.upload(p, 'later.txt', 'Later unreviewed material', 0);
      assert.equal((await s.request(1, `${startupPath}/scope-refresh`, stale)).status, 409);
      const wrongFingerprint = await s.request(1, `${startupPath}/scope-refresh`, { ...stale, ...command(p) });
      assert.equal(wrongFingerprint.status, 409); assert.equal((await wrongFingerprint.json()).error.code, 'STARTUP_SCOPE_CHECK_CHANGED');
      const beforeContinue = structuredClone(p);
      const waiting = await s.request(0, `${startupPath}/continue-extraction`, command(p));
      assert.equal(waiting.status, 200); assert.deepEqual((await waiting.json() as StartupCommandResponse).project, beforeContinue);
      const proposal = (await s.status(p, 1))!.scopeRefresh; assert.equal(proposal.canRefresh, true);
      assert.equal(proposal.addedMaterialIds.length, 2); assert.deepEqual(proposal.retainedMaterialIds, [broken.id]);
      const refreshBodies = [0, 1].map(() => ({ ...command(p), inputFingerprint: proposal.inputFingerprint, reason: 'Employee reviewed both new originals for this first batch' }));
      const refreshed = await Promise.all(refreshBodies.map((body, index) => s.request(index, `${startupPath}/scope-refresh`, body)));
      assert.deepEqual(refreshed.map(response => response.status).sort(), [200, 409]);
      const winner = refreshed.findIndex(response => response.status === 200);
      const refreshReceipt = await refreshed[winner]!.json() as StartupCommandResponse; p = refreshReceipt.project;
      assert.equal(p.runs.length, 0); assert.equal(p.production!.startup!.scope.version, 2);
      assert.deepEqual(p.production!.materials!.find(material => material.id === broken.id), broken);
      const parser = new IngestionWorker(s.stores[1]!, s.objects); while (await parser.tick()) { /* finish each original independently */ }
      p = await s.stores[0]!.get(p.id); assert.equal((await s.status(p))!.state, 'awaiting_usage_review');
      const correct = p.production!.materials!.find(material => material.id === correctId)!;
      p = await s.write(p, `production/materials/${correct.id}/usage`, { reason: 'Employee checked corrected product source',
        decisions: correct.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })) }, 1);
      assert.equal(p.runs.length, 0); assert.equal((await s.status(p))!.state, 'ready_to_extract');
      const continueBodies = [command(p), command(p)];
      const continued = await Promise.all(continueBodies.map((body, index) => s.request(index, `${startupPath}/continue-extraction`, body)));
      assert.deepEqual(continued.map(response => response.status).sort(), [200, 409]);
      p = await s.stores[0]!.get(p.id); assert.equal(p.runs.length, 1);
      assert.deepEqual(p.runs[0]!.startupInput!.evidence.map(ref => ref.id), [p.evidence[0]!.id]);
      assert.equal(p.evidence[0]!.materialSource!.materialId, correctId);
      const fresh = new Store(await reconnect()); assert.deepEqual(await fresh.get(p.id), p);
      assert.deepEqual(await (await s.request(1 - winner, `${startupPath}/scope-refresh`, refreshBodies[winner])).json(), refreshReceipt);
      const noop = await s.request(1, `${startupPath}/continue-extraction`, command(p));
      assert.equal(noop.status, 200); assert.deepEqual((await noop.json() as StartupCommandResponse).project, p);
      const locked = await s.request(0, `${startupPath}/scope-refresh`, { ...command(p), inputFingerprint: (await s.status(p))!.scopeRefresh.inputFingerprint, reason: 'Cannot rewrite a queued batch' });
      assert.equal((await locked.json()).error.code, 'STARTUP_SCOPE_LOCKED');
    } finally { await s.close(); }
  });
});

test('real PostgreSQL over HTTP: conflicting same-version rules cannot partially start separate projects', async () => {
  await isolated(async (db, peer) => {
    await migrate(db);
    const changed = { ...scopedRule, publication: { ...scopedRule.publication, actor: 'different-synthetic-reviewer' } };
    const s = await startupHttpServices([db, peer], [
      { rulePacks: [], scopedRulePacks: [scopedRule] }, { rulePacks: [], scopedRulePacks: [changed] },
    ]);
    try {
      const projects = [await s.evidence(await s.create(0), 0), await s.evidence(await s.create(1), 1)];
      const checks = await Promise.all(projects.map((p, index) => s.check(p, index)));
      const beforeReceipts = (await db.query('SELECT key FROM command_receipts')).rows.length;
      const attempts = await Promise.all(projects.map((p, index) => s.request(index, `/api/projects/${p.id}/production/startup/start`,
        { ...command(p), context: scopedContext, inputFingerprint: checks[index]!.inputFingerprint })));
      assert.deepEqual(attempts.map(response => response.status).sort(), [200, 409]);
      const loser = attempts.findIndex(response => response.status === 409);
      const error = (await attempts[loser]!.json()).error;
      assert.ok(['RULE_PACK_VERSION_CHANGED', 'STARTUP_BLOCKED'].includes(error.code));
      assert.deepEqual(await s.stores[loser]!.get(projects[loser]!.id), projects[loser]);
      const winner = await attempts[1 - loser]!.json() as StartupCommandResponse;
      assert.equal(winner.project.production!.context!.versions.length, 1); assert.equal(winner.project.runs.length, 1);
      assert.equal((await db.query('SELECT key FROM command_receipts')).rows.length, beforeReceipts + 1);
      const registered = await db.query<{ sha256: string }>('SELECT sha256 FROM production_rule_packs');
      assert.equal(registered.rows.length, 1); assert.equal(registered.rows[0]!.sha256, winner.project.production!.startup!.rulePackSha256);
      assert.equal((await db.query('SELECT revision FROM project_revisions WHERE project_id=$1', [projects[loser]!.id])).rows.length, projects[loser]!.revision);
    } finally { await s.close(); }
  });
});

test('real PostgreSQL over HTTP: startup transaction rolls back P, identity, rule registration, run and revisions when receipt persistence fails', async () => {
  await isolated(async (db, peer) => {
    await migrate(db); let failReceipt = false;
    const interrupted: Database = { ...db, transaction: action => db.transaction(tx => action({
      async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (failReceipt && sql.startsWith('INSERT INTO command_receipts')) { failReceipt = false; throw new Error('Synthetic receipt persistence failure'); }
        return tx.query<T>(sql, params);
      },
    })) };
    const s = await startupHttpServices([interrupted, peer]);
    try {
      const p = await s.evidence(await s.create()); const check = await s.check(p);
      const beforeReceipts = (await db.query('SELECT key FROM command_receipts')).rows;
      const beforeRevisions = (await db.query('SELECT project_id,revision,state FROM project_revisions ORDER BY revision')).rows;
      const body = { ...command(p), context: scopedContext, inputFingerprint: check.inputFingerprint };
      const path = `/api/projects/${p.id}/production/startup/start`;
      failReceipt = true; const response = await s.request(0, path, body);
      assert.equal(response.status, 500); assert.equal((await response.json()).error.code, 'INTERNAL_ERROR');
      assert.deepEqual(await s.stores[1]!.get(p.id), p);
      assert.deepEqual((await db.query('SELECT key FROM command_receipts')).rows, beforeReceipts);
      assert.deepEqual((await db.query('SELECT project_id,revision,state FROM project_revisions ORDER BY revision')).rows, beforeRevisions);
      assert.equal((await db.query('SELECT id FROM production_rule_packs')).rows.length, 0);
      const recovered = await s.request(1, path, body); assert.equal(recovered.status, 200);
      const accepted = await recovered.json() as StartupCommandResponse;
      assert.equal(accepted.project.production!.context!.versions.length, 1); assert.equal(accepted.project.runs.length, 1);
      assert.equal(accepted.project.identity!.productName, scopedContext.productBrief.productName);
      assert.deepEqual(await (await s.request(0, path, body)).json(), accepted);
    } finally { await s.close(); }
  });
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
async function stagedContext(store: Store, draft = context) {
  const p = await seed(store);
  return store.command(p.id, command(p), 'test.context.draft', 'pg-test', current => {
    initializeProduction(current!); saveContextDraft(current!.production!, draft); return current!;
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
    const drafts = await Promise.all(stores.map(store => stagedContext(store)));
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
    const drafts = await Promise.all(stores.map(store => stagedContext(store)));
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

test('real PostgreSQL: concurrent HTTP services bind one scoped rule content and roll back the conflicting project', async () => {
  await isolated(async (db, peer) => {
    await migrate(db);
    const stores = [new Store(db), new Store(peer)];
    const drafts = await Promise.all(stores.map(store => stagedContext(store, scopedContext)));
    const packs = [scopedRule, { ...scopedRule, description: 'Different scoped content under the same identity' }];
    const token = randomUUID(); const headers = { authorization: `Bearer ${token}` };
    const objects = new LocalObjects(join(tmpdir(), `unused-scoped-${randomUUID()}`));
    const apps = stores.map((store, index) => buildApp(store, objects, { actor: 'pg-test', token,
      productionCatalog: { rulePacks: [rule], scopedRulePacks: [packs[index]!] } }));
    try {
      const receipts = (await db.query('SELECT key FROM command_receipts')).rows.length;
      const responses = await Promise.all(apps.map((app, index) => app.inject({ method: 'POST',
        url: `/api/projects/${drafts[index]!.id}/production/context/activate`, headers, payload: command(drafts[index]) })));
      assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
      const loser = responses.findIndex(response => response.statusCode === 409); const winner = 1 - loser;
      assert.equal(responses[loser]!.json().error.code, 'RULE_PACK_VERSION_CHANGED');
      assert.deepEqual(await stores[loser]!.get(drafts[loser]!.id), drafts[loser]);
      const result = responses[winner]!.json<Project>();
      assert.deepEqual(result.production!.context!.versions[0]!.rulePack, packs[winner]);
      assert.deepEqual(await stores[winner]!.get(result.id), result);
      assert.equal((await db.query('SELECT id FROM production_rule_packs')).rows.length, 1);
      assert.equal((await db.query('SELECT key FROM command_receipts')).rows.length, receipts + 1);
    } finally { await Promise.all(apps.map(app => app.close())); }
  });
});

test('real PostgreSQL: both rule models backfill unchanged, survive restart and check the frozen scope after catalog changes', async () => {
  await isolated(async (db, peer, reconnect) => {
    await migrate(db);
    const store = new Store(db); const token = randomUUID(); const headers = { authorization: `Bearer ${token}` };
    const objects = new LocalObjects(join(tmpdir(), `unused-scoped-${randomUUID()}`));
    const app = buildApp(store, objects, { token, actor: 'pg-test', productionCatalog: { rulePacks: [rule], scopedRulePacks: [scopedRule] } });
    let closed = false;
    try {
      let p = await activateRegistered(store, await stagedContext(store));
      const legacy = structuredClone(p.production!.context!.versions[0]!);
      p = await store.command(p.id, command(p), 'test.scoped.draft', 'pg-test', current => {
        saveContextDraft(current!.production!, scopedContext); return current!;
      }, { preserveStageAInput: true });
      const response = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/production/context/activate`, headers, payload: command(p) });
      assert.equal(response.statusCode, 200); p = response.json<Project>();
      const readBindings = (connection: Database) => connection.query('SELECT id,version,sha256,rule_pack FROM production_rule_packs ORDER BY id,version');
      const bindings = (await readBindings(db)).rows;
      const revisions = (await db.query('SELECT * FROM project_revisions WHERE project_id=$1 ORDER BY revision', [p.id])).rows;
      const receipts = (await db.query('SELECT key,fingerprint,response FROM command_receipts ORDER BY key')).rows;
      assert.equal(bindings.length, 2);
      // This table belongs only to the invocation's isolated, random test schema.
      await db.query('DROP TABLE production_rule_packs');
      await Promise.all([migrate(db), migrate(peer)]); await migrate(db);
      assert.deepEqual((await readBindings(db)).rows, bindings);
      assert.deepEqual(await store.get(p.id), p);
      await app.close(); closed = true;
      await Promise.all([db.close(), peer.close()]); db.close = peer.close = async () => {};
      const fresh = await reconnect(); await migrate(fresh);
      const freshStore = new Store(fresh);
      const altered = { ...scopedRule, constraints: scopedRule.constraints.map(constraint => constraint.ruleId === 'header-width'
        ? { ...constraint, status: 'verified' as const, sourceIds: ['module-fields'], constraint: { kind: 'numeric' as const, min: 1900 } } : constraint) };
      const restarted = buildApp(freshStore, objects, { token, actor: 'pg-test', productionCatalog: { rulePacks: [rule], scopedRulePacks: [altered] } });
      try {
        const checked = await restarted.inject({ method: 'POST', url: `/api/projects/${p.id}/production/rules/check`, headers,
          payload: { contextVersion: 2, subjects: [{ id: 'frozen header', scope: headerScope, values: { widthPx: 1200, heightPx: 700, format: 'png' } }] } });
        assert.equal(checked.statusCode, 200);
        assert.equal(checked.json().issueSeverity, 'none');
        assert.equal(checked.json().rulePackSha256, p.production!.context!.versions[1]!.rulePackSha256);
        assert.deepEqual((await freshStore.get(p.id)).production!.context!.versions[0], legacy);
        assert.deepEqual(await freshStore.get(p.id), p);
        assert.deepEqual((await readBindings(fresh)).rows, bindings);
        assert.deepEqual((await fresh.query('SELECT * FROM project_revisions WHERE project_id=$1 ORDER BY revision', [p.id])).rows, revisions);
        assert.deepEqual((await fresh.query('SELECT key,fingerprint,response FROM command_receipts ORDER BY key')).rows, receipts);
      } finally { await restarted.close(); }
    } finally { if (!closed) await app.close(); }
  });
});

test('real PostgreSQL: file jobs have exclusive claims, do not block sibling files and survive a service restart', async () => {
  await isolated(async (db, peer, reconnect) => {
    await migrate(db);
    const directory = await mkdtemp(join(tmpdir(), 'tujiang-pg-materials-'));
    const objects = new LocalObjects(directory);
    const stores = [new Store(db), new Store(peer)];
    const apps = stores.map(store => buildApp(store, objects, { actor: 'pg-material-test', token: 'pg-material-test-token' }));
    let appsClosed = false;
    try {
      let p = await stagedContext(stores[0]!);
      const payload = { ...command(p), fileName: 'first.txt', mimeType: 'text/plain', contentBase64: Buffer.from('first file').toString('base64'), source: { kind: 'local_upload' } };
      const url = `/api/projects/${p.id}/production/materials`;
      const uploaded = await Promise.all(apps.map(app => app.inject({ method: 'POST', url, headers: { authorization: 'Bearer pg-material-test-token' }, payload })));
      assert.equal(uploaded[0]!.statusCode, 200);
      assert.deepEqual(uploaded[0]!.json(), uploaded[1]!.json());
      let release!: () => void; let entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      const worker = new IngestionWorker(stores[0]!, objects, async (material, bytes) => { entered(); await gate; return parseMaterial(material, bytes); });
      const peerWorker = new IngestionWorker(stores[1]!, objects);
      const first = worker.tick();
      try {
        await Promise.race([started, first.then(() => { throw new Error('first parser did not start'); })]);
        assert.equal(await peerWorker.tick(), false);
        p = await stores[1]!.get(p.id);
        const second = await apps[1]!.inject({ method: 'POST', url, headers: { authorization: 'Bearer pg-material-test-token' },
          payload: { ...payload, ...command(p), fileName: 'second.txt', contentBase64: Buffer.from('second file').toString('base64') } });
        assert.equal(second.statusCode, 200);
        assert.equal(await peerWorker.tick(), true);
        p = await stores[1]!.get(p.id);
        assert.equal(p.production!.materials![0]!.parse.runStatus, 'running');
        assert.equal(p.production!.materials![1]!.parse.runStatus, 'succeeded');
      } finally { release(); await first; }
      p = await stores[0]!.get(p.id);
      const queued = await apps[0]!.inject({ method: 'POST', url, headers: { authorization: 'Bearer pg-material-test-token' },
        payload: { ...payload, ...command(p), fileName: 'after-restart.txt', contentBase64: Buffer.from('restart source').toString('base64') } });
      assert.equal(queued.statusCode, 200);
      const queuedSnapshot = queued.json<Project>();
      await Promise.all(apps.map(app => app.close())); appsClosed = true;
      await Promise.all([db.close(), peer.close()]); db.close = peer.close = async () => {};
      const fresh = await reconnect();
      await migrate(fresh);
      const store = new Store(fresh);
      assert.deepEqual(await store.get(p.id), queuedSnapshot);
      assert.equal(await new IngestionWorker(store, new LocalObjects(directory)).tick(), true);
      p = await store.get(p.id);
      assert.ok(p.production!.materials!.every(item => item.parse.runStatus === 'succeeded' && item.parse.attempt === 1));
      const restored = p.production!.materials![2]!;
      assert.equal((await objects.readBinary(restored.objectKey, restored.sizeBytes)).toString(), 'restart source');
      assert.equal(restored.blocks.length, 1);
      assert.equal(restored.blocks[0]!.text, 'restart source');
      assert.equal(p.evidence.length, 0);
      assert.equal(p.facts.length, 0);
    } finally {
      if (!appsClosed) await Promise.all(apps.map(app => app.close()));
      await rm(directory, { recursive: true });
    }
  });
});

test('real PostgreSQL over HTTP: usage decisions are atomic across services, preserve no-op receipts and survive reconnect', async () => {
  await isolated(async (db, peer, reconnect) => {
    await migrate(db);
    const directory = await mkdtemp(join(tmpdir(), 'tujiang-pg-usage-'));
    const stores = [new Store(db), new Store(peer)]; const objects = new LocalObjects(directory);
    const actor = 'pg-usage-human'; const token = randomUUID();
    const apps = stores.map(store => buildApp(store, objects, { actor, token }));
    const bases = await Promise.all(apps.map(app => app.listen({ port: 0, host: '127.0.0.1' })));
    const request = async (service: number, path: string, payload?: unknown) => fetch(`${bases[service]}${path}`, {
      method: payload ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const write = async (p: Project, route: string, body: Record<string, unknown> = {}) => {
      const response = await request(0, `/api/projects/${p.id}/${route}`, { ...command(p), ...body });
      assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<Project>;
    };
    try {
      let p = await (await request(0, '/api/projects', { ...command(), name: 'Postgres usage fixture' })).json() as Project;
      p = await write(p, 'production/initialize');
      p = await write(p, 'production/materials', { fileName: 'pg-source.txt', mimeType: 'text/plain',
        contentBase64: Buffer.from('Capacity: 10 kg\nMaterial: steel').toString('base64'),
        source: { kind: 'feishu_export', url: 'https://example.feishu.cn/docx/synthetic-pg', revision: '61', title: 'PG source' } });
      await new IngestionWorker(stores[0]!, objects).tick(); p = await stores[1]!.get(p.id);
      const material = p.production!.materials![0]!;
      const route = `/api/projects/${p.id}/production/materials/${material.id}/usage`;
      const body = { ...command(p), reason: 'first purpose', decisions: [{ blockId: material.blocks[0]!.id, usage: 'product_evidence' }] };
      const results = await Promise.all([request(0, route, body), request(1, route, body)]);
      assert.deepEqual(results.map(r => r.status), [200, 200]);
      const first = await results[0]!.json() as Project;
      assert.deepEqual(await results[1]!.json(), first);
      assert.equal(first.production!.materials![0]!.usageReview!.history.length, 1);
      assert.equal(evidenceIsAvailable(first, first.evidence[0]!), true, 'JSONB key reordering preserves source matching');
      const repeated = await request(1, route, { ...body, ...command(first), reason: 'same effective purpose' });
      assert.deepEqual(await repeated.json(), first);
      const revisions = await db.query('SELECT revision FROM project_revisions WHERE project_id=$1', [p.id]);
      assert.equal(revisions.rows.length, first.revision);
      const receipts = (await db.query('SELECT key FROM command_receipts')).rows.length;
      const invalid = await request(1, route, { ...command(first), reason: 'must validate whole batch', decisions: [
        { blockId: material.blocks[0]!.id, usage: 'reference' }, { blockId: material.blocks[1]!.id, usage: 'asset' },
      ] });
      assert.equal(invalid.status, 409); assert.deepEqual(await stores[0]!.get(p.id), first);
      assert.equal((await db.query('SELECT key FROM command_receipts')).rows.length, receipts);
      const competing = await Promise.all(['product_evidence', 'reference'].map((usage, index) => request(index, route, {
        ...command(first), reason: 'concurrent purposes', decisions: [{ blockId: material.blocks[1]!.id, usage }],
      })));
      assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
      p = await stores[0]!.get(p.id);
      assert.equal(p.revision, first.revision + 1); assert.equal(p.production!.materials![0]!.usageReview!.history.length, 2);
      const winner = structuredClone(p);
      assert.deepEqual(await (await request(0, route, body)).json(), first);
      await Promise.all(apps.map(app => app.close()));
      await Promise.all([db.close(), peer.close()]); db.close = peer.close = async () => {};
      const fresh = await reconnect(); await migrate(fresh);
      const restored = await new Store(fresh).get(p.id);
      assert.deepEqual(restored, winner);
      assert.equal(evidenceIsAvailable(restored, restored.evidence[0]!), true);
      const persistedReceipt = await fresh.query<{ response: Project }>('SELECT response FROM command_receipts WHERE key=$1', [`${actor}:${body.idempotencyKey}`]);
      assert.deepEqual(persistedReceipt.rows[0]!.response, first);
      assert.equal((await objects.readBinary(material.objectKey, material.sizeBytes)).toString(), 'Capacity: 10 kg\nMaterial: steel');
    } finally {
      await Promise.all(apps.map(app => app.close()));
      await rm(directory, { recursive: true });
    }
  });
});

test('real PostgreSQL: concurrent source reconfirmation retains lock history and cannot automatically refresh stale drafts', async () => {
  await isolated(async (db, peer) => {
    await migrate(db);
    const directory = await mkdtemp(join(tmpdir(), 'tujiang-pg-reconfirm-'));
    const stores = [new Store(db), new Store(peer)]; const objects = new LocalObjects(directory);
    const token = randomUUID(); const apps = stores.map(store => buildApp(store, objects, { actor: 'pg-reviewer', token }));
    const post = (index: number, p: Project, route: string, body: Record<string, unknown> = {}) => apps[index]!.inject({
      method: 'POST', url: `/api/projects/${p.id}/${route}`, headers: { authorization: `Bearer ${token}` }, payload: { ...command(p), ...body },
    });
    const write = async (p: Project, route: string, body: Record<string, unknown> = {}) => {
      const response = await post(0, p, route, body); assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body); return response.json<Project>();
    };
    try {
      let p = await stores[0]!.command(undefined, command(), 'created', 'pg-reviewer', () => createProject('PG locked source fixture'));
      p = await write(p, 'production/initialize');
      p = await write(p, 'production/materials', { fileName: 'locked.txt', mimeType: 'text/plain',
        contentBase64: Buffer.from('Capacity: 10 kg').toString('base64'), source: { kind: 'local_upload' } });
      await new IngestionWorker(stores[0]!, objects).tick(); p = await stores[0]!.get(p.id);
      const material = p.production!.materials![0]!;
      const usageRoute = `production/materials/${material.id}/usage`;
      const decide = (p: Project, usage: string) => write(p, usageRoute, { reason: 'source purpose checked', decisions: [{ blockId: material.blocks[0]!.id, usage }] });
      p = await decide(p, 'product_evidence');
      p = await write(p, 'identity/confirm', { productName: 'PG fixture product' });
      p = await write(p, 'facts/candidates', { attribute: 'capacity', role: 'core', value: '10 kg', quote: '10 kg', evidenceId: p.evidence[0]!.id, reason: 'checked source' });
      p = await write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'confirmed exact quote' });
      const fact = structuredClone(p.facts[0]!);
      p = await write(p, 'runs', { skill: 'plan-section' });
      await new Worker(stores[0]!, { generate: async () => ({ chapters: [{ role: 'feature', purpose: 'capacity', factIds: [fact.id] }],
        section: { purpose: 'capacity', factIds: [fact.id], missingInputs: [] } }) }).tick();
      p = await stores[0]!.get(p.id); p = await write(p, 'qa/preflight'); const approvedSourceSnapshot = structuredClone(p);
      p = await decide(p, 'reference');
      assert.equal(p.facts[0]!.status, 'confirmed'); assert.equal(p.facts[0]!.locked, true);
      assert.equal(p.facts[0]!.sourceReview!.status, 'reconfirmation_required'); assert.equal(p.qa, undefined);
      assert.equal((await post(1, p, 'runs', { skill: 'plan-section' })).json().error.code, 'CONFIRMED_CORE_FACT_REQUIRED');
      p = await decide(p, 'product_evidence');
      assert.equal(availableConfirmedFacts(p).length, 0);
      const replacement = p.evidence.at(-1)!;
      const reconfirmRoute = `facts/${fact.id}/source/reconfirm`;
      const results = await Promise.all([0, 1].map(index => post(index, p, reconfirmRoute, { reason: 'explicitly checked restored source', evidenceId: replacement.id })));
      assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
      p = await stores[0]!.get(p.id);
      assert.equal(p.facts[0]!.sourceReconfirmations!.length, 1); assert.equal(p.facts[0]!.confirmedAt, fact.confirmedAt);
      assert.equal(p.facts[0]!.value, fact.value); assert.equal(p.facts[0]!.locked, true);
      assert.equal(p.sections[0]!.freshness, 'stale'); assert.equal(p.storyboard!.freshness, 'stale');
      assert.deepEqual(await write(p, reconfirmRoute, { reason: 'repeat restored source', evidenceId: replacement.id }), p);
      const snapshot = await db.query<{ state: Project }>('SELECT state FROM project_revisions WHERE project_id=$1 AND revision=$2', [p.id, approvedSourceSnapshot.revision]);
      assert.deepEqual(snapshot.rows[0]!.state, approvedSourceSnapshot);
      p = await write(p, 'qa/preflight'); assert.equal(p.qa!.issueSeverity, 'blocker'); assert.equal(p.qa!.exportAllowed, false);
    } finally { await Promise.all(apps.map(app => app.close())); await rm(directory, { recursive: true }); }
  });
});
