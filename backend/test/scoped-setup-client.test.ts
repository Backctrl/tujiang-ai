import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { fixture } from './helpers.js';
import { rule, context } from './fixtures/production-context.js';
import { scopedRule, scopedContext, numericRule } from './fixtures/scoped-rules.js';
import { contextDraftSchema, type ContextDraft, type ScopedRulePack } from '../src/production-context.js';
import type { Project } from '../src/contracts.js';
import { ApiError, StageAApi, prepareProjectWrite } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';
import { compileContextForm, contextForm, contextReadiness, scopedTargetFields } from '../../src/pages/ArcaneWarriorPage/project-context.js';
import { isRuleCatalog, type RuleCatalog } from '../../src/pages/ArcaneWarriorPage/rule-catalog.js';
import { useProjectContext, type ContextSession, type ProjectContextController } from '../../src/pages/ArcaneWarriorPage/useProjectContext.js';
import { useProjectSnapshot } from '../../src/pages/ArcaneWarriorPage/useProjectSnapshot.js';
import { useProjectSession } from '../../src/pages/ArcaneWarriorPage/useProjectSession.js';
import { useMaterialIntake } from '../../src/pages/ArcaneWarriorPage/useMaterialIntake.js';

const catalog: RuleCatalog = { contractVersion: 'production.1', rulePacks: [rule], scopedRulePacks: [scopedRule] };
async function withStorage(run: () => void | Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try { await run(); } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}
function render(session: ContextSession, update?: (context: ProjectContextController) => void) {
  let result: ProjectContextController | undefined;
  function Probe() { const once = useRef(false), controller = useProjectContext(session); result = controller; if (update && !once.current) { once.current = true; update(controller); } return null; }
  renderToStaticMarkup(createElement(Probe)); assert.ok(result); return result;
}
async function ui(name: string) {
  const assets = registerHooks({ load(url, context, next) { return /\.(png|jpe?g|webp|svg)(?:\?|$)/.test(url) ? { format: 'module', source: `export default ${JSON.stringify(url)}`, shortCircuit: true } : next(url, context); } });
  try { return await tsImport(`../../src/pages/ArcaneWarriorPage/${name}.tsx`, { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../tsconfig.app.json', import.meta.url)) }); }
  finally { assets.deregister(); }
}

test('full catalog preserves optional legacy compatibility and rejects malformed scoped semantics before exposing choices', async () => {
  let reads = 0;
  const client = new StageAApi('catalog-secret', async (path, options) => {
    reads++; assert.equal(path, '/api/production/catalog'); assert.equal(options?.body, undefined);
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer catalog-secret'); assert.equal(options?.redirect, 'error');
    return Response.json(catalog);
  });
  assert.deepEqual(await client.ruleCatalog(), catalog); assert.equal(reads, 1);
  assert.deepEqual(await client.catalog(), [rule]);
  assert.deepEqual(await new StageAApi('test', async () => Response.json({ contractVersion: 'production.1', rulePacks: [] })).ruleCatalog(), { contractVersion: 'production.1', rulePacks: [], scopedRulePacks: [] });
  const changed = (mutate: (rule: ScopedRulePack) => void) => { const value = structuredClone(scopedRule); mutate(value); return { ...catalog, scopedRulePacks: [value] }; };
  const malformed: unknown[] = [
    { ...catalog, scopedRulePacks: null },
    { ...catalog, scopedRulePacks: [scopedRule, scopedRule] },
    { ...catalog, scopedRulePacks: [{ ...scopedRule, id: rule.id, version: rule.version }] },
    changed(value => { value.sources[0]!.url = 'javascript:alert(1)'; }),
    changed(value => { value.localProductionPolicy.canvasWidthPx = { min: 1200, exact: 1200 }; }),
    changed(value => { value.localProductionPolicy.canvasWidthPx = { min: 2400, max: 640 }; }),
    changed(value => { value.activationRequirements = ['missing-rule']; }),
    changed(value => { const item = value.constraints.find(item => item.status === 'verified' && item.constraint.kind === 'formats')!; if (item.status === 'verified' && item.constraint.kind === 'formats') item.constraint.exhaustive = true; }),
    changed(value => { const item = value.constraints[0]!; if (item.status === 'verified') item.sourceIds = ['missing-source']; }),
    changed(value => { value.constraints[0]!.measure = 'widthPx'; }),
  ];
  for (const payload of malformed) {
    assert.equal(isRuleCatalog(payload), false);
    await assert.rejects(new StageAApi('test', async () => Response.json(payload)).ruleCatalog(), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_PRODUCTION_CATALOG');
  }
  await assert.rejects(new StageAApi('test', async () => new Response('', { status: 401 })).ruleCatalog(), (error: unknown) => error instanceof ApiError && error.status === 401);
});

test('scoped forms round-trip partial markers and match exact targets, category requirements and local numeric bounds', () => {
  for (const input of [{ primaryTarget: { contentType: 'partial' } }, { canvasProfile: { selectionBasis: 'local_production_policy' as const } }, scopedContext]) {
    const output = compileContextForm(contextForm(input)); assert.deepEqual(output.errors, []); assert.deepEqual(output.context, input); assert.equal(contextDraftSchema.safeParse(output.context).success, true);
  }
  const noOptional = structuredClone(scopedContext) as ContextDraft; delete noOptional.productBrief!.internalCode; delete noOptional.productBrief!.commercialIntent;
  assert.deepEqual(contextReadiness(noOptional, [scopedRule]), [], 'optional business fields never become UI blockers');
  for (const key of scopedTargetFields) {
    const changed = structuredClone(scopedContext) as ContextDraft;
    changed.primaryTarget = { ...changed.primaryTarget, [key]: key === 'unitSystem' ? 'metric' : 'different' };
    assert.ok(contextReadiness(changed, [scopedRule]).some(issue => issue.field === `primaryTarget.${key}`));
  }
  for (const [width, valid] of [[639, false], [640, true], [1200, true], [2400, true], [2401, false]] as const) {
    assert.equal(contextReadiness({ ...scopedContext, canvasProfile: { ...scopedContext.canvasProfile, widthPx: width } }, [scopedRule]).some(issue => issue.field === 'canvasProfile.widthPx'), !valid);
  }
  const exact = structuredClone(scopedRule); exact.localProductionPolicy.canvasWidthPx = { exact: 1200 };
  assert.deepEqual(contextReadiness(scopedContext, [exact]), []);
  assert.ok(contextReadiness({ ...scopedContext, canvasProfile: { ...scopedContext.canvasProfile, widthPx: 1201 } }, [exact]).some(issue => issue.field === 'canvasProfile.widthPx'));
  assert.deepEqual(contextReadiness(scopedContext, [scopedRule]), [], 'WebP is a local policy choice, independent of the official known PNG/JPEG subset');
  const unknown = structuredClone(scopedRule), original = unknown.constraints[0]!;
  unknown.constraints[0] = { ruleId: original.ruleId, name: original.name, description: original.description, scope: original.scope, measure: original.measure, severity: 'blocker', status: 'unknown', reason: 'Synthetic missing official value', recovery: 'Administrator must verify this scope' };
  assert.ok(contextReadiness(scopedContext, [unknown]).some(issue => issue.message.includes('Synthetic missing official value')));
  const wrongCategory = structuredClone(scopedRule); wrongCategory.constraints[0]!.scope.category = 'other category';
  assert.ok(contextReadiness(scopedContext, [wrongCategory]).some(issue => issue.message.includes('没有适用')));
  const missingType = structuredClone(scopedContext) as ContextDraft; delete missingType.primaryTarget!.contentType;
  assert.ok(contextReadiness(missingType, [scopedRule]).some(issue => issue.field === 'primaryTarget.contentType'));
  assert.ok(contextReadiness({ ...scopedContext, rulePackRef: { id: rule.id, version: rule.version } }, [rule]).some(issue => issue.field === 'rulePackRef'));
});

test('actual hook selections save and activate scoped P versions over HTTP, preserve history and use explicit same-body retry after 401', async () => {
  const f = await fixture({ rulePacks: [rule], scopedRulePacks: [scopedRule] });
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const transport: typeof fetch = (path, options) => fetch(`${url}${path}`, options);
    const client = new StageAApi(f.headers.authorization.slice(7), transport);
    let project = await client.write(await client.create('Scoped frontend HTTP'), 'production/initialize');
    project = await client.write(project, 'production/context/draft', { context: { productBrief: scopedContext.productBrief } });
    assert.deepEqual(await client.ruleCatalog(), catalog);
    await withStorage(async () => {
      const session: ContextSession = { project, getLatestProject: () => project, catalog: [rule], scopedCatalog: [scopedRule], canWrite: true, write: () => undefined };
      let selected = render(session, value => value.setRule(scopedRule.id, scopedRule.version));
      assert.deepEqual(selected.compiled.context.primaryTarget, scopedRule.target); assert.equal(selected.form.selectionBasis, 'local_production_policy');
      selected = render(session, value => value.setField('widthPx', '1200'));
      selected = render(session, value => value.setField('format', 'webp'));
      assert.equal(selected.canSave, true); assert.equal(selected.canActivate, false);
      const prepared = prepareProjectWrite(project, 'production/context/draft', { context: selected.compiled.context });
      const bodies: string[] = [];
      const expired = new StageAApi('expired-token', (path, options) => { bodies.push(String(options?.body)); return transport(path, options); });
      await assert.rejects(expired.executePrepared(prepared), (error: unknown) => error instanceof ApiError && error.status === 401);
      assert.equal((await client.get(project.id)).revision, project.revision);
      const authorized = new StageAApi(f.headers.authorization.slice(7), (path, options) => { bodies.push(String(options?.body)); return transport(path, options); });
      project = await authorized.executePrepared(prepared); assert.deepEqual(bodies, [prepared.body, prepared.body]);
      assert.deepEqual(project.production!.context!.draft, scopedContext);
    });
    await withStorage(async () => {
      const session: ContextSession = { project, getLatestProject: () => project, catalog: [rule], scopedCatalog: [scopedRule], canWrite: true, write: () => undefined };
      assert.equal(render(session).canActivate, true);
      project = await client.write(project, 'production/context/activate');
      const p1 = structuredClone(project.production!.context!.versions[0]!);
      const activeSession = { ...session, project };
      const copied = render(activeSession, value => value.requestCopy(value.activeVersion!));
      const next = { ...copied.compiled.context, canvasProfile: { ...copied.compiled.context.canvasProfile, widthPx: 1500 } };
      project = await client.write(project, 'production/context/draft', { context: next });
      project = await client.write(project, 'production/context/activate');
      assert.deepEqual(project.production!.context!.versions[0], p1); assert.equal(project.production!.context!.activeVersion, 2);
      assert.equal(project.production!.context!.versions[1]!.context.primaryTarget.contentType, scopedContext.primaryTarget.contentType);
      assert.equal(project.production!.context!.versions[1]!.context.canvasProfile.selectionBasis, 'local_production_policy');
      assert.equal(project.identity, undefined, 'configuration editing never creates extraction identity'); assert.equal(project.runs.length, 0);
    });
    let optional = await client.write(await client.create('Optional brief fields'), 'production/initialize');
    const fourFields = structuredClone(scopedContext); delete fourFields.productBrief.internalCode; delete fourFields.productBrief.commercialIntent;
    optional = await client.write(optional, 'production/context/draft', { context: compileContextForm(contextForm(fourFields)).context });
    optional = await client.write(optional, 'production/context/activate');
    assert.deepEqual(optional.production!.context!.versions[0]!.context.productBrief, fourFields.productBrief);
  } finally { await f.close(); }
});

test('actual UI keeps all five setup sections together and separates image-slot minimums, format subsets and local delivery', async () => {
  const f = await fixture({ rulePacks: [rule], scopedRulePacks: [scopedRule] });
  try {
    let project = await f.write(await f.create(), 'production/initialize'); project = await f.write(project, 'production/context/draft', { context: scopedContext });
    const { ProjectSetup } = await ui('ProjectFactsStages');
    await withStorage(() => {
      function View() {
        const session = { ...useProjectSession(), project, getLatestProject: () => project, token: 'test-only', canWrite: true, catalog: [rule], scopedCatalog: [scopedRule], catalogLoading: false };
        return createElement(ProjectSetup, { session, intake: useMaterialIntake(session), onStage: () => undefined });
      }
      const html = renderToStaticMarkup(createElement(View));
      for (let index = 0; index < 5; index++) { assert.match(html, new RegExp(`aria-controls="setup-${index}"`)); assert.match(html, new RegExp(`id="setup-${index}"`)); }
      assert.ok(html.indexOf('setup-project-entry') < html.indexOf('id="setup-0"'));
      assert.ok(html.indexOf('id="setup-2"') < html.indexOf('id="setup-3"')); assert.ok(html.indexOf('id="setup-3"') < html.indexOf('id="setup-4"'));
      assert.match(html, /至少 970 px/); assert.match(html, /至少 640 px，至多 2400 px/);
      assert.doesNotMatch(html, /<datalist/); assert.doesNotMatch(html, /list="context-allowed-widths"/);
      assert.match(html, /已知可用格式子集/); assert.match(html, /其它格式支持情况未核验/); assert.match(html, /本地交付格式/);
      assert.match(html, /画布格式：PNG、JPEG、WEBP/); assert.doesNotMatch(html, /已有数据/); assert.doesNotMatch(html, /暂不支持复制/);
      assert.match(html, /内部代号（选填）/); assert.match(html, /商业目标（选填）/);
    });
  } finally { await f.close(); }
});

test('scope and catalog changes in the same React batch preserve input and cannot activate unseen rule data', async () => {
  const f = await fixture({ rulePacks: [rule], scopedRulePacks: [scopedRule] });
  try {
    let project = await f.write(await f.create(), 'production/initialize'); project = await f.write(project, 'production/context/draft', { context: scopedContext });
    const saved = await f.write(project, 'production/context/draft', { context: { ...scopedContext, productBrief: { ...scopedContext.productBrief, introduction: 'Saved local value' } } });
    const external = await f.write(saved, 'production/context/draft', { context: { ...scopedContext, primaryTarget: { ...scopedContext.primaryTarget, contentType: 'External changed type' } } });
    await withStorage(() => {
      let result: ProjectContextController | undefined, callback: ((project: Project) => void) | undefined, writes = 0;
      function Probe() {
        const [step, setStep] = useState(0), snapshot = useProjectSnapshot(project);
        const c = useProjectContext({ ...snapshot, canWrite: true, catalog: [rule], scopedCatalog: [scopedRule], write: (_path, _body, _label, saved) => { writes++; callback = saved; return undefined; } }); result = c;
        if (step === 0) { c.setField('introduction', 'Saved local value'); setStep(1); }
        else if (step === 1) { c.save(); setStep(2); }
        else if (step === 2) { snapshot.receiveSnapshot(external, project.id); snapshot.receiveSnapshot(saved, project.id); assert.ok(callback); callback(saved); c.save(); c.activate(); setStep(3); }
        return null;
      }
      renderToStaticMarkup(createElement(Probe)); assert.ok(result); assert.equal(writes, 1); assert.equal(result.local.needsReview, true); assert.equal(result.form.introduction, 'Saved local value'); assert.equal(result.form.contentType, scopedContext.primaryTarget.contentType);
    });
    await withStorage(() => {
      let latest: RuleCatalog | null = catalog, writes = 0;
      const c = render({ project, getLatestProject: () => project, catalog: [rule], scopedCatalog: [scopedRule], getLatestCatalog: () => latest, canWrite: true, write: () => { writes++; return undefined; } });
      assert.equal(c.canActivate, true); latest = null; c.activate(); assert.equal(writes, 0);
      latest = { ...catalog, scopedRulePacks: [{ ...scopedRule, constraints: [numericRule('replacement', { kind: 'content', contentType: scopedRule.target.contentType }, 'moduleCount', { max: 1 })] }] };
      c.activate(); assert.equal(writes, 0);
    });
  } finally { await f.close(); }
});
