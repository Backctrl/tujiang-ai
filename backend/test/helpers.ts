import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database, Connection } from '../src/database.js';
import { migrate } from '../src/database.js';
import { Store } from '../src/store.js';
import { buildApp } from '../src/app.js';
import { LocalObjects } from '../src/objects.js';
import type { Project } from '../src/contracts.js';
import type { ProductionCatalog } from '../src/production-context.js';

export async function fixture(productionCatalog?: ProductionCatalog) {
  const engine = new PGlite();
  const wrap = (client: Pick<PGlite, 'query'>): Connection => ({
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      const result = await client.query<T>(sql, params); return { rows: result.rows };
    },
  });
  const db: Database = { ...wrap(engine), transaction: action => engine.transaction(tx => action(wrap(tx))), close: () => engine.close() };
  await migrate(db);
  const dir = await mkdtemp(join(tmpdir(), 'tujiang-backend-'));
  const store = new Store(db);
  const token = randomUUID();
  const app = buildApp(store, new LocalObjects(dir), { token, actor: 'test-human', productionCatalog });
  const headers = { authorization: `Bearer ${token}` };
  async function post(url: string, payload: unknown) { return app.inject({ method: 'POST', url, headers, payload: payload as Record<string, unknown> }); }
  async function create() {
    const result = await post('/api/projects', { name: 'Test product', expectedProjectVersion: 0, expectedRevision: 0, idempotencyKey: randomUUID() });
    if (result.statusCode !== 201) throw new Error(result.body);
    return result.json<Project>();
  }
  async function write(p: Project, route: string, body: Record<string, unknown> = {}) {
    const result = await post(`/api/projects/${p.id}/${route}`, command(p, body));
    if (result.statusCode >= 400) throw new Error(result.body);
    return result.json<Project>();
  }
  return { db, store, app, headers, post, create, write,
    async close() { await app.close(); await db.close(); await rm(dir, { recursive: true }); } };
}
export function command(p: Project, body: Record<string, unknown> = {}) {
  return { expectedProjectVersion: p.version, expectedRevision: p.revision, idempotencyKey: randomUUID(), ...body };
}
export function extraction(p: Project, value = '10 kg') {
  return { facts: [{ attribute: 'capacity', role: 'core', value, evidenceId: p.evidence[0]!.id, quote: value }] };
}
export function plan(p: Project) {
  const factIds = p.facts.filter(f => f.status === 'confirmed').map(f => f.id);
  return { chapters: [{ role: 'feature', purpose: '说明产品承重参数', factIds }], section: { purpose: '参数证据草稿', factIds, missingInputs: [] } };
}
