import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, command } from './helpers.js';
import { reviseProductionObject, type Production, type ProductionObject } from '../src/production.js';

test('explicit initialization preserves legacy snapshots and receipts and is repeatable', async () => {
  const f = await fixture();
  try {
    const p = await f.create();
    const before = await f.db.query('SELECT * FROM project_revisions WHERE project_id=$1', [p.id]);
    const receipts = await f.db.query('SELECT * FROM command_receipts');
    const body = command(p);
    const route = `/api/projects/${p.id}/production/initialize`;
    const first = await f.post(route, body);
    assert.equal(first.statusCode, 200);
    const next = first.json();
    assert.equal(next.contractVersion, 'stage-a.1');
    assert.deepEqual(next.production, { contractVersion: 'production.1', objects: [] });
    assert.deepEqual(next.sections, []);
    assert.equal(next.inputRevision, p.inputRevision);
    assert.equal(next.version, p.version);
    assert.deepEqual((await f.post(route, body)).json(), next);
    assert.deepEqual(await f.write(next, 'production/initialize'), next);
    assert.equal((await f.post(route, command(p))).statusCode, 409);
    const history = await f.db.query('SELECT * FROM project_revisions WHERE project_id=$1 AND revision=$2', [p.id, p.revision]);
    assert.deepEqual(history.rows, before.rows);
    const priorReceipt = await f.db.query('SELECT * FROM command_receipts WHERE key=$1', [receipts.rows[0]!.key]);
    assert.deepEqual(priorReceipt.rows, receipts.rows);
    const revisions = await f.db.query('SELECT * FROM project_revisions WHERE project_id=$1', [p.id]);
    assert.equal(revisions.rows.length, 2);
  } finally { await f.close(); }
});

test('project discovery is authenticated, summary-only and deterministically ordered', async () => {
  const f = await fixture();
  try {
    const a = await f.create(); const b = await f.create();
    await f.db.query("UPDATE projects SET updated_at='2026-01-01T00:00:00Z'");
    assert.equal((await f.app.inject({ method: 'GET', url: '/api/projects' })).statusCode, 401);
    const result = await f.app.inject({ method: 'GET', url: '/api/projects', headers: f.headers });
    const rows = result.json().projects;
    assert.deepEqual(rows.map((p: { id: string }) => p.id), [a.id, b.id].sort());
    assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'name', 'version', 'revision', 'contractVersion', 'updatedAt'].sort());
    assert.equal((await f.store.get(a.id)).production, undefined);
  } finally { await f.close(); }
});

test('business revision invalidates only transitive dependants and rejects stale edits', () => {
  const make = (id: string, deps: string[] = []): ProductionObject => ({ id, kind: 'section', revision: 1,
    dependencies: deps.map(id => ({ id, revision: 1 })), freshness: 'current', approvalStatus: 'approved' });
  const p: Production = { contractVersion: 'production.1', objects: [make('a'), make('b', ['a']), make('c', ['b']), make('other')] };
  p.objects[0]!.approvalStatus = 'draft';
  reviseProductionObject(p, 'a', 1);
  assert.deepEqual(p.objects.map(o => o.freshness), ['current', 'stale', 'stale', 'current']);
  assert.equal(p.objects[0]!.approvalStatus, 'draft');
  const before = structuredClone(p);
  assert.throws(() => reviseProductionObject(p, 'a', 1), /PRODUCTION_REVISION_CONFLICT/);
  assert.deepEqual(p, before);
});

test('approved production objects reject revisions without losing approved content', () => {
  const p: Production = { contractVersion: 'production.1', objects: [{ id: 'approved', kind: 'section',
    revision: 1, dependencies: [], freshness: 'current', approvalStatus: 'approved' }] };
  const before = structuredClone(p);
  assert.throws(() => reviseProductionObject(p, 'approved', 1), /APPROVED_PRODUCTION_OBJECT_IMMUTABLE/);
  assert.deepEqual(p, before);
});

test('unrelated audited writes retain production dependency snapshots', async () => {
  const f = await fixture();
  try {
    let p = await f.write(await f.create(), 'production/initialize');
    p = await f.store.command(p.id, command(p), 'test.production.fixture', 'test-human', current => {
      current!.production!.objects.push({ id: 'section-a', kind: 'section', revision: 1, dependencies: [],
        freshness: 'current', approvalStatus: 'draft' });
      return current!;
    });
    const production = structuredClone(p.production);
    const after = await f.write(p, 'evidence', { documentName: 'source', locator: 'p1', usage: 'product_evidence', text: 'test' });
    assert.deepEqual(after.production, production);
    assert.ok(after.revision > p.revision);
  } finally { await f.close(); }
});
