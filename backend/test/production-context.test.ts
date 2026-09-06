import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, command, extraction } from './helpers.js';
import { activateContext, loadProductionCatalog, productionCatalogSchema, saveContextDraft, type ContextDraft, type RulePack } from '../src/production-context.js';
import type { Production } from '../src/production.js';
import { Worker } from '../src/worker.js';

// Synthetic test-only rule; never used by the production directory.
const rule: RulePack = { id: 'synthetic', version: '1', officialUrl: 'https://example.org/synthetic-test-rule',
  verifiedAt: '2026-01-01T00:00:00Z', verifiedBy: 'test-reviewer',
  target: { platform: 'test', site: 'test-us', country: 'US', language: 'en-US', currency: 'USD', unitSystem: 'imperial' },
  allowedWidthsPx: [1000], allowedFormats: ['png'], requiredFacts: [{ key: 'identity', description: 'Test identity', allowUnknown: false, allowNotApplicable: false }] };
const context: ContextDraft = { productBrief: { productName: 'Test chair', internalCode: 'T1', category: 'chair', stage: 'new',
  introduction: 'Test only', commercialIntent: 'Test launch' }, primaryTarget: rule.target,
  canvasProfile: { widthPx: 1000, format: 'png' }, rulePackRef: { id: rule.id, version: rule.version } };

test('local rule catalog is explicit, validated and empty by default', async () => {
  assert.deepEqual(await loadProductionCatalog(), { rulePacks: [] });
  const dir = await mkdtemp(join(tmpdir(), 'tujiang-catalog-'));
  try {
    const path = join(dir, 'catalog.json');
    await writeFile(path, JSON.stringify({ rulePacks: [rule] }));
    assert.deepEqual(await loadProductionCatalog(path), { rulePacks: [rule] });
    await writeFile(path, JSON.stringify({ rulePacks: [{ ...rule, verifiedBy: '' }] }));
    await assert.rejects(loadProductionCatalog(path));
    const invalidCatalogs = [
      { rulePacks: [rule, rule] },
      { rulePacks: [{ ...rule, officialUrl: 'http://example.org/unverified' }] },
      { rulePacks: [{ ...rule, verifiedAt: new Date(Date.now() + 86400000).toISOString() }] },
      { rulePacks: [{ ...rule, verifiedBy: '' }] },
      { rulePacks: [{ ...rule, target: { ...rule.target, unitSystem: undefined } }] },
      { rulePacks: [{ ...rule, allowedFormats: [] }] },
      { rulePacks: [{ ...rule, allowedWidthsPx: [1000, 1000] }] },
      { rulePacks: [{ ...rule, requiredFacts: [rule.requiredFacts[0], rule.requiredFacts[0]] }] },
      { rulePacks: [{ ...rule, target: { ...rule.target, acceptsAnySite: true } }] },
    ];
    for (const catalog of invalidCatalogs) assert.equal(productionCatalogSchema.safeParse(catalog).success, false);
    await writeFile(path, '{invalid json');
    await assert.rejects(loadProductionCatalog(path));
    await assert.rejects(loadProductionCatalog(join(dir, 'missing.json')));
  } finally { await rm(dir, { recursive: true }); }
});

test('draft allows partial context but activation requires complete context and verified rule', async () => {
  const f = await fixture();
  try {
    let p = await f.create();
    const get = await f.app.inject({ method: 'GET', url: '/api/production/catalog', headers: f.headers });
    assert.deepEqual(get.json(), { contractVersion: 'production.1', rulePacks: [] });
    assert.equal((await f.app.inject({ method: 'GET', url: '/api/production/catalog' })).statusCode, 401);
    for (const route of ['draft', 'activate']) {
      const body = command(p, route === 'draft' ? { context } : {});
      const url = `/api/projects/${p.id}/production/context/${route}`;
      assert.equal((await f.app.inject({ method: 'POST', url, payload: body })).statusCode, 401);
      assert.equal((await f.post(url, body)).json().error.code, 'PRODUCTION_NOT_INITIALIZED');
    }
    assert.deepEqual(await f.store.get(p.id), p);
    p = await f.write(p, 'production/initialize');
    p = await f.write(p, 'production/context/draft', { context: { productBrief: { productName: 'Draft' } } });
    assert.deepEqual(p.production!.context!.versions, []);
    const partial = await f.post(`/api/projects/${p.id}/production/context/activate`, command(p));
    assert.equal(partial.json().error.code, 'PRODUCTION_CONTEXT_INCOMPLETE');
    p = await f.write(p, 'production/context/draft', { context });
    const missing = await f.post(`/api/projects/${p.id}/production/context/activate`, command(p));
    assert.equal(missing.json().error.code, 'RULE_PACK_UNAVAILABLE');
    assert.deepEqual(await f.store.get(p.id), p);
    assert.equal((await f.post(`/api/projects/${p.id}/production/context/draft`, command(p, { context: { unexpected: true } }))).statusCode, 400);
    assert.equal((await f.post(`/api/projects/${p.id}/production/context/activate`, command(p, { activatedBy: 'model' }))).statusCode, 400);
    const schemas = await f.app.inject({ method: 'GET', url: '/api/contracts', headers: f.headers });
    assert.equal(schemas.statusCode, 200);
    assert.ok(schemas.json().requests.productionContextDraft);
    assert.ok(schemas.json().requests.productionContextActivate);
  } finally { await f.close(); }
});

test('activation fixes immutable P versions; edits, retries and legacy writes preserve snapshots', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    let p = await f.write(await f.create(), 'production/initialize');
    const inputRevision = p.inputRevision;
    p = await f.write(p, 'production/context/draft', { context });
    const body = command(p); const url = `/api/projects/${p.id}/production/context/activate`;
    p = (await f.post(url, body)).json();
    assert.equal(p.production!.context!.activeVersion, 1);
    assert.equal(p.production!.context!.draft, undefined);
    assert.equal(p.inputRevision, inputRevision);
    const p1 = structuredClone(p.production!.context!.versions[0]);
    assert.equal(p1!.activatedBy, 'test-human');
    assert.match(p1!.rulePackSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(p1!.rulePack, rule);
    const historicalRevision = p.revision;
    assert.deepEqual((await f.post(url, body)).json(), p);
    const noDraft = (await f.post(url, command(p))).json().error;
    assert.equal(noDraft.code, 'PRODUCTION_CONTEXT_INCOMPLETE');
    assert.deepEqual(noDraft.details.fields, ['context']);
    p = await f.write(p, 'production/context/draft', { context: { ...context, productBrief: { ...context.productBrief, productName: 'Next' } } });
    assert.deepEqual(p.production!.context!.versions[0], p1);
    assert.equal(p.production!.context!.activeVersion, 1);
    p = await f.write(p, 'production/context/activate');
    assert.equal(p.production!.context!.activeVersion, 2);
    assert.deepEqual(p.production!.context!.versions[0], p1);
    const before = structuredClone(p.production);
    p = await f.write(p, 'identity/confirm', { productName: 'Legacy identity' });
    assert.deepEqual(p.production, before);
    assert.equal((await f.post(url, body)).json().production.context.versions.length, 1);
    const history = await f.app.inject({ method: 'GET', url: `/api/projects/${p.id}/revisions/${historicalRevision}`, headers: f.headers });
    assert.deepEqual(history.json().production.context.versions, [p1]);
  } finally { await f.close(); }
});

test('draft replacement clears omitted fields; concurrent drafts and stale activations do not overwrite current state', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    let p = await f.write(await f.create(), 'production/initialize');
    p = await f.write(p, 'production/context/draft', { context });
    p = await f.write(p, 'production/context/draft', { context: { productBrief: { productName: '  Trimmed name  ' } } });
    assert.deepEqual(p.production!.context!.draft, { productBrief: { productName: 'Trimmed name' } });
    const stale = command(p);
    const url = `/api/projects/${p.id}/production/context/draft`;
    const writes = await Promise.all([
      f.post(url, command(p, { context })),
      f.post(url, command(p, { context: { productBrief: { productName: 'Second editor' } } })),
    ]);
    assert.deepEqual(writes.map(result => result.statusCode).sort(), [200, 409]);
    const accepted = writes.find(result => result.statusCode === 200)!.json();
    assert.equal(writes.find(result => result.statusCode === 409)!.json().error.code, 'REVISION_CONFLICT');
    assert.equal((await f.post(`/api/projects/${p.id}/production/context/activate`, stale)).json().error.code, 'REVISION_CONFLICT');
    assert.deepEqual(await f.store.get(p.id), accepted);
    p = await f.write(accepted, 'production/context/draft', { context: {} });
    assert.deepEqual(p.production!.context!.draft, {});
    assert.equal((await f.post(`/api/projects/${p.id}/production/context/activate`, command(p))).json().error.code, 'PRODUCTION_CONTEXT_INCOMPLETE');
    assert.deepEqual(await f.store.get(p.id), p);
  } finally { await f.close(); }
});

test('activation rejects target, canvas and same-version rule substitution without mutating versions', () => {
  const p: Production = { contractVersion: 'production.1', objects: [] };
  saveContextDraft(p, { ...context, primaryTarget: { ...rule.target, country: 'GB' } });
  assert.throws(() => activateContext(p, { rulePacks: [rule] }, 'test'), /RULE_PACK_TARGET_MISMATCH/);
  saveContextDraft(p, { ...context, canvasProfile: { widthPx: 500, format: 'png' } });
  assert.throws(() => activateContext(p, { rulePacks: [rule] }, 'test'), /CANVAS_OUTSIDE_RULE_PACK/);
  saveContextDraft(p, context); activateContext(p, { rulePacks: [rule] }, 'test');
  saveContextDraft(p, context);
  const before = structuredClone(p);
  assert.throws(() => activateContext(p, { rulePacks: [{ ...rule, verifiedBy: 'changed' }] }, 'test'), /RULE_PACK_VERSION_CHANGED/);
  assert.deepEqual(p, before);
});

test('production context writes during a legacy fact run preserve its actual input dependency', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    let p = await f.write(await f.create(), 'production/initialize');
    p = await f.write(p, 'evidence', { documentName: 'synthetic.txt', locator: 'p1', usage: 'product_evidence', text: '10 kg' });
    p = await f.write(p, 'runs', { skill: 'extract-facts' });
    const inputRevision = p.inputRevision;
    await new Worker(f.store, { generate: async (_skill, snapshot) => {
      const drafted = await f.write(snapshot, 'production/context/draft', { context });
      const activated = await f.write(drafted, 'production/context/activate');
      assert.equal(activated.inputRevision, inputRevision);
      return extraction(snapshot);
    } }).tick();
    p = await f.store.get(p.id);
    assert.equal(p.runs.at(-1)!.runStatus, 'succeeded');
    assert.equal(p.facts.length, 1);
    assert.equal(p.facts[0]!.status, 'candidate');
    assert.equal(p.production!.context!.activeVersion, 1);
    assert.equal(p.contractVersion, 'stage-a.1');
    assert.deepEqual(p.sections, []);
  } finally { await f.close(); }
});
