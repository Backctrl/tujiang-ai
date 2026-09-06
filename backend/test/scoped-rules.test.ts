import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, command } from './helpers.js';
import { rule, context } from './fixtures/production-context.js';
import { scopedRule, scopedContext, logoScope, headerScope, numericRule } from './fixtures/scoped-rules.js';
import { numericFailure, numericBoundsSchema, checkScopedRuleInputs, ruleCheckSchema, scopedRulePackSchema, type RuleCheckInput, type ScopedRulePack, type ScopedConstraint } from '../src/production-rules.js';
import { activateContext, loadProductionCatalog, hashRulePack, saveContextDraft, productionCatalogSchema, storedRulePackSchema, type ProductionCatalog } from '../src/production-context.js';
import type { Production } from '../src/production.js';
import { migrate } from '../src/database.js';
import { buildApp } from '../src/app.js';
import type { Project } from '../src/contracts.js';
import { AppError } from '../src/errors.js';

const catalog: ProductionCatalog = { rulePacks: [rule], scopedRulePacks: [scopedRule] };
const input = (...subjects: RuleCheckInput['subjects']): RuleCheckInput => ({ contextVersion: 1, subjects });
const image = (id: string, scope = headerScope, widthPx = 1200, heightPx = 700, format = 'png') => ({ id, scope, values: { widthPx, heightPx, format } });
const run = (request: RuleCheckInput, pack = scopedRule) => checkScopedRuleInputs(pack, scopedContext, ruleCheckSchema.parse(request));
const initialized = async (f: Awaited<ReturnType<typeof fixture>>) => f.write(await f.create(), 'production/initialize');
async function activated(f: Awaited<ReturnType<typeof fixture>>, value = scopedContext) {
  let p = await initialized(f); p = await f.write(p, 'production/context/draft', { context: value });
  return f.write(p, 'production/context/activate');
}

test('scoped catalog preserves legacy parsing/hash and rejects self-asserted or inconsistent scoped metadata', async () => {
  assert.deepEqual(productionCatalogSchema.parse(catalog), catalog);
  assert.deepEqual(await loadProductionCatalog(), { rulePacks: [] });
  assert.deepEqual(storedRulePackSchema.parse(rule), rule);
  const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
      : JSON.stringify(value) ?? 'null';
  assert.equal(hashRulePack(rule), createHash('sha256').update(canonical(rule)).digest('hex'));
  for (const altered of [
    { ...scopedRule, publication: undefined }, { ...scopedRule, publication: { ...scopedRule.publication, status: 'candidate' } },
    { ...scopedRule, publication: { ...scopedRule.publication, at: new Date(Date.now() + 86400000).toISOString() } },
    { ...scopedRule, officialUrl: 'https://example.com/self-approval', verifiedBy: 'caller' },
    { ...scopedRule, constraints: [{ ...scopedRule.constraints[3], status: 'verified', sourceIds: ['upload-example'], constraint: { kind: 'formats', allowed: ['png'], exhaustive: true } }] },
    { ...scopedRule, constraints: [{ ...scopedRule.constraints[0], sourceIds: ['missing'] }] },
    { ...scopedRule, activationRequirements: ['missing-rule'] },
    { ...scopedRule, constraints: [numericRule('wrong-unit', logoScope, 'moduleCount', { max: 5 })], activationRequirements: ['wrong-unit'] },
  ]) assert.equal(scopedRulePackSchema.safeParse(altered).success, false);
  assert.equal(productionCatalogSchema.safeParse({ rulePacks: [rule], scopedRulePacks: [{ ...scopedRule, id: rule.id, version: rule.version }] }).success, false);
  const dir = await mkdtemp(join(tmpdir(), 'tujiang-scoped-catalog-'));
  try {
    const path = join(dir, 'catalog.json'); await writeFile(path, JSON.stringify(catalog));
    assert.deepEqual(await loadProductionCatalog(path), catalog);
    await writeFile(path, JSON.stringify({ scopedRulePacks: [{ ...scopedRule, publication: undefined }] }));
    await assert.rejects(loadProductionCatalog(path));
  } finally { await rm(dir, { recursive: true }); }
});

test('numeric min means greater-than-or-equal, max and exact remain distinct, and malformed bounds reject', () => {
  assert.equal(numericFailure(970, { min: 970 }), undefined); assert.equal(numericFailure(1200, { min: 970 }), undefined);
  assert.equal(numericFailure(969, { min: 970 }), 'BELOW_MINIMUM'); assert.equal(numericFailure(970, { exact: 970 }), undefined);
  assert.equal(numericFailure(1200, { exact: 970 }), 'NOT_EXACT'); assert.equal(numericFailure(6, { max: 5 }), 'ABOVE_MAXIMUM');
  for (const bounds of [{}, { exact: 970, min: 970 }, { min: 1000, max: 970 }, { min: -1 }, { max: 5.5 }])
    assert.equal(numericBoundsSchema.safeParse(bounds).success, false);
  assert.deepEqual(run(input(image('header'))), []);
  assert.deepEqual(run(input(image('below', headerScope, 969))).map(f => [f.ruleId, f.code]), [['header-width', 'BELOW_MINIMUM']]);
});

test('image slots and text fields are isolated; no page-wide minimum or universal body-length rule is inferred', () => {
  assert.deepEqual(run(input(image('logo', logoScope, 600, 180))), []);
  assert.deepEqual(run(input(image('header', headerScope, 600, 180))).map(f => f.ruleId), ['header-width', 'header-height']);
  const headerText = { kind: 'text_field' as const, contentType: 'amazon_basic_aplus', moduleType: 'StandardHeaderImageText', fieldId: 'block.body' };
  const sidebarText = { kind: 'text_field' as const, contentType: 'amazon_basic_aplus', moduleType: 'StandardImageSidebar', fieldId: 'descriptionTextBlock.body' };
  assert.deepEqual(run(input({ id: 'header body', scope: headerText, values: { text: 'a'.repeat(1000) } })), []);
  assert.deepEqual(run(input({ id: 'sidebar body', scope: sidebarText, values: { text: 'a'.repeat(1000) } })).map(f => [f.ruleId, f.code]), [['sidebar-body', 'ABOVE_MAXIMUM']]);
  assert.equal(run(input(image('unknown slot', { ...headerScope, slotId: 'unregistered' }))).every(f => f.code === 'RULE_COVERAGE_MISSING'), true);
  const specific = { ...scopedRule, constraints: [...scopedRule.constraints,
    numericRule('unrelated-category-width', { ...headerScope, category: 'unrelated-category' }, 'widthPx', { min: 1900 })] };
  assert.deepEqual(run(input(image('category isolated')), specific), []);
});

test('Basic A+ module counts never cap Section or Frame counts and cannot leak into another content type', () => {
  const scope = { kind: 'content' as const, contentType: 'amazon_basic_aplus' };
  assert.deepEqual(run(input({ id: 'five modules', scope, values: { moduleCount: 5 } })), []);
  assert.deepEqual(run(input({ id: 'six modules', scope, values: { moduleCount: 6 } })).map(f => f.code), ['ABOVE_MAXIMUM']);
  const other = run(input({ id: 'premium context', scope: { ...scope, contentType: 'amazon_premium_aplus' }, values: { moduleCount: 6 } }));
  assert.deepEqual(other.map(f => f.code), ['RULE_SCOPE_OUTSIDE_TARGET']);
  for (const values of [{ sectionCount: 6 }, { frameCount: 6 }]) assert.equal(ruleCheckSchema.safeParse(input({ id: 'wrong object', scope, values } as never)).success, false);
  // Context activation itself accepts an independent Canvas, with no chapter or Frame list/count gate.
  const production: Production = { contractVersion: 'production.1', objects: [] };
  saveContextDraft(production, scopedContext); activateContext(production, catalog, 'test-human');
  assert.equal(production.context!.versions[0]!.context.canvasProfile.widthPx, 1200);
});

test('module image counts, exact bounds and warning severity stay scoped to the declared subject', () => {
  const scope = { kind: 'module' as const, contentType: 'amazon_basic_aplus', moduleType: 'synthetic-example-module' };
  const scoped = { ...scopedRule, constraints: [...scopedRule.constraints,
    { ...numericRule('synthetic-exact-image-count', scope, 'imageCount', { exact: 1 }), severity: 'warning' as const }] };
  assert.deepEqual(run(input({ id: 'one module', scope, values: { imageCount: 1 } }), scoped), []);
  const finding = run(input({ id: 'two images', scope, values: { imageCount: 2 } }), scoped);
  assert.deepEqual(finding.map(value => [value.ruleId, value.code, value.severity, value.sourceIds]),
    [['synthetic-exact-image-count', 'NOT_EXACT', 'warning', ['module-fields']]]);
  assert.deepEqual(run(input({ id: 'other module', scope: { ...scope, moduleType: 'unregistered-module' }, values: { imageCount: 1 } }), scoped)
    .map(value => value.code), ['RULE_COVERAGE_MISSING']);
  assert.deepEqual(run(input(image('image slot unaffected')), scoped), []);
});

test('known format subsets, local export formats and unknown limits remain separate', () => {
  for (const format of ['png', 'jpeg']) assert.deepEqual(run(input(image('documented subset', headerScope, 1200, 700, format))), []);
  for (const format of ['webp', 'pdf', 'html']) {
    assert.ok(scopedRule.localProductionPolicy.exportFormats.includes(format as 'webp' | 'pdf' | 'html'));
    assert.deepEqual(run(input(image('unverified upload format', headerScope, 1200, 700, format))).map(f => [f.code, f.severity]), [['FORMAT_SUPPORT_UNKNOWN', 'blocker']]);
  }
  const subject = image('image bytes'); subject.values = { ...subject.values, bytes: 2 * 1024 * 1024 } as typeof subject.values;
  assert.ok(run(input(subject)).some(f => f.measure === 'bytes' && f.code === 'RULE_COVERAGE_MISSING'));
  const unknown: ScopedConstraint = { ruleId: 'unknown-upload-bytes', name: 'Unknown official bytes limit', description: 'Do not invent a universal 2 MB limit',
    scope: headerScope, measure: 'bytes', severity: 'blocker', status: 'unknown', reason: 'Official slot byte limit has not been verified', recovery: '管理员核对当前模块上传限制并发布新规则版本。' };
  const result = run(input(image('unknown byte limit')), { ...scopedRule, constraints: [...scopedRule.constraints, unknown] });
  assert.ok(result.some(f => f.ruleId === unknown.ruleId && f.code === 'RULE_CONSTRAINT_UNKNOWN' && f.recovery === unknown.recovery));
});

test('missing measurements block with exact scope and text length is measured server-side without echoing source text', () => {
  const missing = run(input({ id: 'partial header', scope: headerScope, values: { widthPx: 1200 } }));
  assert.deepEqual(missing.map(f => [f.ruleId, f.code]), [['header-height', 'RULE_INPUT_MISSING'], ['header-format-subset', 'RULE_INPUT_MISSING']]);
  const scope = { kind: 'text_field' as const, contentType: 'amazon_basic_aplus', moduleType: 'StandardHeaderImageText', fieldId: 'headline' };
  assert.deepEqual(run(input({ id: 'unicode', scope, values: { text: '🙂'.repeat(150) } })), []);
  const result = run(input({ id: 'unicode too long', scope, values: { text: '🙂'.repeat(151) } }));
  assert.equal(result[0]!.actual, 151); assert.equal(JSON.stringify(result).includes('🙂'), false);
  assert.equal(ruleCheckSchema.safeParse(input({ id: 'self-reported length', scope, values: { textLength: 1 } } as never)).success, false);
  assert.equal(ruleCheckSchema.safeParse(input({ id: 'forged category', scope: { ...headerScope, category: 'unrelated-category' }, values: { widthPx: 1200 } } as never)).success, false);
});

test('unknown Taobao rules block activation without inventing widths while complete drafts and legacy paths remain compatible', () => {
  const unknown: ScopedConstraint = { ruleId: 'taobao-image-width', name: 'Taobao official width pending verification', description: 'No numeric official source',
    scope: { kind: 'image_slot', contentType: 'detail_page', moduleType: 'detail', slotId: 'image' }, measure: 'widthPx', severity: 'blocker',
    status: 'unknown', reason: 'No verified official limit', recovery: '管理员提供有位置和日期的官方规则，核验后发布新版本。' };
  const taobao: ScopedRulePack = { ...scopedRule, id: 'synthetic-taobao-pending', target: { platform: 'taobao', site: 'taobao.com', country: 'CN', language: 'zh-CN', currency: 'CNY', unitSystem: 'metric', contentType: 'detail_page' },
    constraints: [unknown], activationRequirements: [unknown.ruleId] };
  const production: Production = { contractVersion: 'production.1', objects: [] };
  saveContextDraft(production, { ...scopedContext, primaryTarget: taobao.target, rulePackRef: { id: taobao.id, version: taobao.version } });
  assert.throws(() => activateContext(production, { rulePacks: [], scopedRulePacks: [taobao] }, 'test'), error =>
    error instanceof AppError && error.code === 'RULE_PACK_INCOMPLETE' && (error.details?.blockers as { ruleId: string }[])[0]!.ruleId === unknown.ruleId);
  assert.equal(production.context!.versions.length, 0); assert.ok(production.context!.draft);
  saveContextDraft(production, { ...context, primaryTarget: { ...context.primaryTarget, contentType: 'amazon_basic_aplus' } });
  assert.throws(() => activateContext(production, catalog, 'test'), error => error instanceof AppError && error.code === 'SCOPED_RULE_PACK_REQUIRED');
  saveContextDraft(production, context); const legacy = activateContext(production, catalog, 'test');
  assert.deepEqual(legacy.rulePack, rule); assert.equal(legacy.rulePackSha256, hashRulePack(rule));
});

test('real HTTP: scoped context, published strict schemas and read-only checks preserve P snapshots, revisions and QA', async () => {
  const f = await fixture(catalog); const base = await f.app.listen({ port: 0, host: '127.0.0.1' });
  const request = (path: string, payload?: unknown, auth = true) => fetch(`${base}${path}`, { method: payload ? 'POST' : 'GET',
    headers: { ...(auth ? f.headers : {}), 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  try {
    const available = await (await request('/api/production/catalog')).json();
    assert.deepEqual(available.rulePacks, [rule]); assert.deepEqual(available.scopedRulePacks, [scopedRule]);
    const contracts = await (await request('/api/contracts')).json();
    assert.equal(contracts.requests.productionRuleCheck.additionalProperties, false);
    assert.equal(contracts.rulePackModels['scoped-rules.1'].additionalProperties, false);
    let p = await activated(f); p = await f.write(p, 'qa/preflight');
    const before = structuredClone(p); const path = `/api/projects/${p.id}/production/rules/check`;
    const body = input(image('header'));
    assert.equal((await request(path, body, false)).status, 401);
    const check = await request(path, body); assert.equal(check.status, 200);
    const result = await check.json();
    assert.equal(result.kind, 'rule_input_check'); assert.equal(result.issueSeverity, 'none');
    assert.equal(result.rulePackSha256, p.production!.context!.versions[0]!.rulePackSha256);
    assert.ok(result.notChecked.includes('actual_files')); assert.ok(result.notChecked.includes('formal_approval'));
    assert.equal('exportAllowed' in result, false); assert.equal('approvalStatus' in result, false);
    assert.deepEqual(await f.store.get(p.id), before);
    assert.equal((await request(path, { ...body, rulePack: scopedRule, approved: true })).status, 400);
    assert.equal((await request(path, { ...body, contextVersion: 999 })).status, 404);
    const over = await (await request(path, input(image('too small', headerScope, 969)))).json();
    assert.equal(over.issueSeverity, 'blocker'); assert.equal(over.findings[0].ruleId, 'header-width');
    assert.deepEqual(await f.store.get(p.id), before);
    const old = await activated(f, context);
    assert.equal((await request(`/api/projects/${old.id}/production/rules/check`, body)).status, 409);
  } finally { await f.close(); }
});

test('HTTP activation requires explicit new-model intent, precise target and local policy; rollback preserves the draft', async () => {
  const f = await fixture(catalog);
  try {
    let p = await initialized(f);
    for (const [value, code] of [
      [{ ...scopedContext, primaryTarget: { ...scopedContext.primaryTarget, contentType: undefined } }, 'SCOPED_CONTENT_TYPE_REQUIRED'],
      [{ ...scopedContext, canvasProfile: { widthPx: 1200, format: 'webp' } }, 'LOCAL_PRODUCTION_SELECTION_REQUIRED'],
      [{ ...scopedContext, primaryTarget: { ...scopedContext.primaryTarget, contentType: 'amazon_premium_aplus' } }, 'RULE_PACK_TARGET_MISMATCH'],
      [{ ...scopedContext, primaryTarget: { ...scopedContext.primaryTarget, site: 'amazon.co.uk', country: 'GB' } }, 'RULE_PACK_TARGET_MISMATCH'],
      [{ ...scopedContext, canvasProfile: { ...scopedContext.canvasProfile, widthPx: 600 } }, 'CANVAS_OUTSIDE_LOCAL_PRODUCTION_POLICY'],
      [{ ...context, primaryTarget: { ...context.primaryTarget, contentType: 'amazon_basic_aplus' } }, 'SCOPED_RULE_PACK_REQUIRED'],
    ] as const) {
      p = await f.write(p, 'production/context/draft', { context: value });
      const response = await f.post(`/api/projects/${p.id}/production/context/activate`, command(p));
      assert.equal(response.json().error.code, code); assert.deepEqual(await f.store.get(p.id), p);
    }
    p = await f.write(p, 'production/context/draft', { context: scopedContext });
    p = await f.write(p, 'production/context/activate');
    assert.equal(p.production!.context!.versions[0]!.context.canvasProfile.widthPx, 1200);
    assert.equal(p.production!.context!.versions[0]!.context.canvasProfile.format, 'webp');
  } finally { await f.close(); }
});

test('HTTP blocks unknown Taobao rules and activation requirements that cover another content type or category', async () => {
  const f = await fixture(catalog);
  const taobaoTarget = { platform: 'taobao', site: 'taobao.com', country: 'CN', language: 'zh-CN', currency: 'CNY', unitSystem: 'metric' as const, contentType: 'detail_page' };
  const unknown: ScopedConstraint = { ruleId: 'taobao-width-pending', name: 'Taobao official width pending', description: 'No invented width is configured',
    status: 'unknown', severity: 'blocker', scope: { kind: 'image_slot', contentType: 'detail_page', moduleType: 'detail', slotId: 'image' }, measure: 'widthPx',
    reason: 'Official rule has not been verified', recovery: '管理员核验并发布有官方依据的新规则版本。' };
  const taobao: ScopedRulePack = { ...scopedRule, target: taobaoTarget, constraints: [unknown], activationRequirements: [unknown.ruleId] };
  const foreignContent: ScopedRulePack = { ...scopedRule, constraints: scopedRule.constraints.map(rule => rule.ruleId === 'basic-module-count'
    ? { ...rule, scope: { ...rule.scope, contentType: 'amazon_premium_aplus' } } : rule) };
  const foreignCategory: ScopedRulePack = { ...scopedRule, constraints: scopedRule.constraints.map(rule => rule.ruleId === 'basic-module-count'
    ? { ...rule, scope: { ...rule.scope, category: 'other-category' } } : rule) };
  try {
    let p = await initialized(f);
    for (const pack of [taobao, foreignContent, foreignCategory]) {
      const app = buildApp(f.store, f.objects, { actor: 'test-human', token: f.headers.authorization.slice(7),
        productionCatalog: { rulePacks: [rule], scopedRulePacks: [pack] } });
      try {
        p = await f.write(p, 'production/context/draft', { context: { ...scopedContext, primaryTarget: pack.target } });
        const response = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/production/context/activate`, headers: f.headers, payload: command(p) });
        assert.equal(response.statusCode, 409); assert.equal(response.json().error.code, 'RULE_PACK_INCOMPLETE');
        const blocker = response.json().error.details.blockers[0];
        if (pack === taobao) { assert.equal(blocker.ruleId, unknown.ruleId); assert.equal(blocker.recovery, unknown.recovery); }
        else assert.equal(blocker.code, 'NO_APPLICABLE_ACTIVATION_RULE');
        assert.deepEqual(await f.store.get(p.id), p);
        assert.equal(p.production!.context!.versions.length, 0);
        assert.equal((await f.db.query('SELECT id FROM production_rule_packs')).rows.length, 0);
      } finally { await app.close(); }
    }
  } finally { await f.close(); }
});

test('migrations bind both models idempotently without changing historical context, revision or command receipts', async () => {
  const f = await fixture(catalog);
  try {
    let p = await activated(f, context); const legacy = structuredClone(p.production!.context!.versions[0]!);
    p = await f.write(p, 'production/context/draft', { context: scopedContext }); p = await f.write(p, 'production/context/activate');
    const before = structuredClone(p);
    const revisions = (await f.db.query('SELECT * FROM project_revisions WHERE project_id=$1 ORDER BY revision', [p.id])).rows;
    const receipts = (await f.db.query('SELECT key,fingerprint,response FROM command_receipts ORDER BY key')).rows;
    await f.db.query('DROP TABLE production_rule_packs');
    await migrate(f.db); await migrate(f.db);
    assert.deepEqual(await f.store.get(p.id), before);
    assert.deepEqual((await f.store.get(p.id)).production!.context!.versions[0], legacy);
    assert.deepEqual((await f.db.query('SELECT * FROM project_revisions WHERE project_id=$1 ORDER BY revision', [p.id])).rows, revisions);
    assert.deepEqual((await f.db.query('SELECT key,fingerprint,response FROM command_receipts ORDER BY key')).rows, receipts);
    assert.deepEqual((await f.db.query<{ id: string }>('SELECT id FROM production_rule_packs ORDER BY id')).rows.map(row => row.id), [rule.id, scopedRule.id].sort());
    assert.deepEqual(p.production!.context!.versions[0]!.rulePack, rule);
  } finally { await f.close(); }
});

test('same id/version cannot change scoped content across projects, and unrelated catalog changes never rewrite bound targets', async () => {
  const f = await fixture(catalog); const changed = { ...scopedRule, description: 'different content under the same identity' };
  const app = buildApp(f.store, f.objects, { token: f.headers.authorization.slice(7), actor: 'test-human', productionCatalog: { rulePacks: [rule], scopedRulePacks: [changed] } });
  try {
    const first = await activated(f); let other = await initialized(f);
    other = await f.write(other, 'production/context/draft', { context: scopedContext });
    const failed = await app.inject({ method: 'POST', url: `/api/projects/${other.id}/production/context/activate`, headers: f.headers, payload: command(other) });
    assert.equal(failed.json().error.code, 'RULE_PACK_VERSION_CHANGED'); assert.deepEqual(await f.store.get(other.id), other);
    assert.deepEqual(await f.store.get(first.id), first);
    const checked = await app.inject({ method: 'POST', url: `/api/projects/${first.id}/production/rules/check`, headers: f.headers, payload: input(image('bound snapshot')) });
    assert.equal(checked.json().rulePackSha256, first.production!.context!.versions[0]!.rulePackSha256);
    assert.equal(checked.json().issueSeverity, 'none', 'checks use the bound snapshot, never the current server catalog');
    assert.deepEqual(await f.store.get(first.id), first);
  } finally { await app.close(); await f.close(); }
});
