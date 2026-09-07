import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fixture } from './helpers.js';
import { contextDraftSchema, type ContextDraft, type RulePack } from '../src/production-context.js';
import { ApiError, errorMessage, StageAApi, type Project } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';
import { compileContextForm, contextDifferences, contextForm, contextReadiness, isRuleCatalog, projectContextBase } from '../../src/pages/ArcaneWarriorPage/project-context.js';
import { useProjectContext, type ContextSession, type ProjectContextController } from '../../src/pages/ArcaneWarriorPage/useProjectContext.js';
import { useProjectSnapshot } from '../../src/pages/ArcaneWarriorPage/useProjectSnapshot.js';

// Explicit synthetic fixtures; no platform defaults or production catalog fallback are created.
const rule: RulePack = {
  id: 'client-test-rule', version: '1', officialUrl: 'https://example.org/client-test-rule',
  verifiedBy: 'synthetic-reviewer', verifiedAt: '2026-01-01T00:00:00Z',
  target: { platform: 'synthetic', site: 'test-site', country: 'US', language: 'en-US', currency: 'USD', unitSystem: 'imperial' },
  allowedWidthsPx: [1000], allowedFormats: ['png'], requiredFacts: [],
};
const complete: ContextDraft = {
  productBrief: { productName: 'Synthetic production product', internalCode: 'TEST-ONLY', category: 'Fixture', stage: 'test', introduction: 'Synthetic introduction', commercialIntent: 'Verify the client flow' },
  primaryTarget: rule.target, canvasProfile: { widthPx: 1000, format: 'png' }, rulePackRef: { id: rule.id, version: rule.version },
};

test('real HTTP JSONB key ordering does not invalidate continued, reopened or copied context drafts', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const client = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${url}${path}`, options));
    let saved = await client.write(await client.create('JSONB order regression'), 'production/initialize');
    saved = await client.write(saved, 'production/context/draft', { context: complete });
    const read = await client.get(saved.id);
    assert.equal(read.revision, saved.revision);
    assert.deepEqual(projectContextBase(saved), projectContextBase(read));
    assert.notEqual(JSON.stringify(projectContextBase(saved)), JSON.stringify(projectContextBase(read)), 'exercise actual POST/JSONB ordering, not a synthetic reorder');
    withStorage(() => {
      const session: ContextSession = { project: saved, getLatestProject: () => saved, canWrite: true, catalog: [rule], write: () => undefined };
      const continued = renderContextUpdates([
        { session, update: context => context.setField('introduction', 'Local input kept') },
        { session: { ...session, project: read }, update: context => context.setField('commercialIntent', 'Continue editing after GET') },
        { session: { ...session, project: read } },
      ]);
      assert.deepEqual(continued.changes, []);
      assert.equal(continued.local.needsReview, false);
      assert.equal(continued.canSave, true);
      const reopened = renderContext({ ...session, project: read });
      assert.equal(reopened.local.needsReview, false);
      assert.equal(reopened.form.introduction, 'Local input kept');
    });
    const activated = await client.write(saved, 'production/context/activate');
    const activeRead = await client.get(activated.id);
    assert.equal(activeRead.revision, activated.revision);
    assert.deepEqual(projectContextBase(activated), projectContextBase(activeRead));
    assert.notEqual(JSON.stringify(projectContextBase(activated)), JSON.stringify(projectContextBase(activeRead)));
    withStorage(() => {
      const session: ContextSession = { project: activated, getLatestProject: () => activated, canWrite: true, catalog: [rule], write: () => undefined };
      const copied = renderContextUpdates([
        { session, update: context => context.requestCopy(context.activeVersion!) },
        { session: { ...session, project: activeRead }, update: context => context.setField('internalCode', 'LOCAL-P2') },
        { session: { ...session, project: activeRead } },
      ]);
      assert.equal(copied.local.active, true);
      assert.equal(copied.local.needsReview, false);
      assert.equal(copied.canSave, true);
      assert.deepEqual(copied.changes, []);
      const reopened = renderContext({ ...session, project: activeRead });
      assert.equal(reopened.form.internalCode, 'LOCAL-P2');
      assert.equal(reopened.local.needsReview, false);
    });
  } finally { await f.close(); }
});

test('form compilation omits cleared fields and preserves partial drafts accepted by the server schema', () => {
  assert.deepEqual(compileContextForm(contextForm()).context, {});
  const form = contextForm(complete);
  form.internalCode = ''; form.language = ''; form.widthPx = ''; form.rulePackId = ''; form.rulePackVersion = '';
  const compiled = compileContextForm(form);
  assert.deepEqual(compiled.errors, []);
  assert.equal(compiled.context.productBrief?.internalCode, undefined);
  assert.equal(compiled.context.primaryTarget?.language, undefined);
  assert.equal(compiled.context.canvasProfile?.widthPx, undefined);
  assert.equal(compiled.context.rulePackRef, undefined);
  assert.equal(contextDraftSchema.safeParse(compiled.context).success, true);
  const invalid = compileContextForm({ ...contextForm(), country: 'cn', currency: 'US', widthPx: '1.5', format: 'svg' });
  assert.deepEqual(invalid.errors.map(issue => issue.field), ['primaryTarget.country', 'primaryTarget.currency', 'canvasProfile.widthPx', 'canvasProfile.format']);
});

test('readiness requires an available exact rule and rejects every target or canvas mismatch', () => {
  assert.equal(contextReadiness({}, []).some(issue => issue.field === 'catalog'), true);
  assert.equal(contextReadiness(complete, null).some(issue => issue.field === 'catalog'), true);
  assert.deepEqual(contextReadiness(complete, [rule]), []);
  const changed: ContextDraft = { ...complete, primaryTarget: { platform: 'other', site: 'other', country: 'CA', language: 'fr-CA', currency: 'CAD', unitSystem: 'metric' }, canvasProfile: { widthPx: 999, format: 'jpeg' } };
  assert.deepEqual(contextReadiness(changed, [rule]).map(issue => issue.field), [
    'primaryTarget.platform', 'primaryTarget.site', 'primaryTarget.country', 'primaryTarget.language', 'primaryTarget.currency', 'primaryTarget.unitSystem', 'canvasProfile.widthPx', 'canvasProfile.format',
  ]);
  assert.equal(contextReadiness(complete, [{ ...rule, version: '2' }])[0]?.field, 'rulePackRef');
});

test('catalog reads send authentication only in headers and reject unsafe or malformed rule data', async () => {
  let count = 0;
  const client = new StageAApi('test-secret', async (url, options) => {
    count++; assert.equal(url, '/api/production/catalog'); assert.equal(options?.body, undefined);
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-secret');
    assert.equal(options?.redirect, 'error');
    return Response.json({ contractVersion: 'production.1', rulePacks: [] });
  });
  assert.deepEqual(await client.catalog(), []); assert.equal(count, 1);
  assert.equal(isRuleCatalog({ contractVersion: 'production.1', rulePacks: [rule] }), true);
  for (const invalid of [
    { contractVersion: 'other', rulePacks: [rule] },
    { contractVersion: 'production.1', rulePacks: [rule, rule] },
    { contractVersion: 'production.1', rulePacks: [{ ...rule, officialUrl: 'javascript:alert(1)' }] },
    { contractVersion: 'production.1', rulePacks: [{ ...rule, allowedFormats: [] }] },
  ]) {
    await assert.rejects(new StageAApi('test', async () => Response.json(invalid)).catalog(), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_PRODUCTION_CATALOG');
  }
  await assert.rejects(new StageAApi('test', async () => new Response('', { status: 401 })).catalog(), (error: unknown) => error instanceof ApiError && error.status === 401);
});

test('context client over HTTP saves partial drafts, explains blocked activation and creates immutable P1/P2', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const client = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${url}${path}`, options));
    let p = await client.create('Production context client test');
    p = await client.write(p, 'identity/confirm', { productName: 'Confirmed extraction identity' });
    const originalIdentity = structuredClone(p.identity);
    assert.deepEqual(await client.catalog(), [rule]);
    assert.equal((await client.get(p.id)).production, undefined, 'catalog and project reads never initialize production');
    p = await client.write(p, 'production/initialize');
    const partial = compileContextForm({ ...contextForm(), productName: 'Partial product' }).context;
    p = await client.write(p, 'production/context/draft', { context: partial });
    assert.deepEqual(p.production?.context?.draft, partial);
    await assert.rejects(client.write(p, 'production/context/activate'), (error: unknown) => {
      assert.ok(error instanceof ApiError); assert.equal(error.code, 'PRODUCTION_CONTEXT_INCOMPLETE');
      assert.ok(error.fields.includes('productBrief.category'));
      assert.equal(error.fields.includes('productBrief.internalCode'), false);
      assert.ok(errorMessage(error).includes('产品品类')); return true;
    });
    p = await client.write(p, 'production/context/draft', { context: compileContextForm(contextForm(complete)).context });
    p = await client.write(p, 'production/context/activate');
    const first = structuredClone(p.production!.context!.versions[0]!);
    assert.equal(first.label, 'P1'); assert.equal(p.production!.context!.draft, undefined);
    const changed = contextForm(first.context); changed.introduction = 'Explicit P2 introduction';
    p = await client.write(p, 'production/context/draft', { context: compileContextForm(changed).context });
    p = await client.write(p, 'production/context/activate');
    assert.equal(p.production!.context!.activeVersion, 2);
    assert.deepEqual(p.production!.context!.versions[0], first);
    assert.deepEqual(p.identity, originalIdentity, 'production product naming does not silently correct the fact extraction identity');
    assert.equal(p.production!.context!.versions[1]!.context.productBrief.introduction, changed.introduction);
    assert.deepEqual(await client.get(p.id), p);
  } finally { await f.close(); }
});

function withStorage(run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try { run(); } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}
function renderContext(session: ContextSession, update?: (context: ProjectContextController) => void): ProjectContextController {
  let result: ProjectContextController | undefined;
  function Probe() {
    const updated = useRef(false);
    const context = useProjectContext(session); result = context;
    if (update && !updated.current) { updated.current = true; update(context); }
    return null;
  }
  renderToStaticMarkup(createElement(Probe)); assert.ok(result); return result;
}

function renderContextUpdates(steps: { session: ContextSession; update?: (context: ProjectContextController) => void }[]): ProjectContextController {
  let result: ProjectContextController | undefined;
  function Probe() {
    const [index, setIndex] = useState(0);
    const step = steps[index]!;
    const context = useProjectContext(step.session); result = context;
    if (index < steps.length - 1) { step.update?.(context); setIndex(index + 1); }
    return null;
  }
  renderToStaticMarkup(createElement(Probe)); assert.ok(result); return result;
}

test('context draft restoration gates saves after upstream changes and unsubmitted edits never activate a saved draft', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    let project = await f.write(await f.create(), 'production/initialize');
    project = await f.write(project, 'production/context/draft', { context: complete });
    withStorage(() => {
      const calls: string[] = [];
      const session: ContextSession = { project, getLatestProject: () => project, canWrite: true, catalog: [rule], write: path => { calls.push(path); return undefined; } };
      const saved = renderContext(session);
      assert.equal(saved.canActivate, true); assert.equal(calls.length, 0);
      const edited = renderContext(session, context => context.setField('introduction', 'Local unsaved introduction'));
      assert.equal(edited.local.active, true); assert.equal(edited.canSave, true); assert.equal(edited.canActivate, false);
      edited.activate(); assert.equal(calls.length, 0);
      const external = structuredClone(project); external.revision++;
      external.production!.context!.draft!.productBrief!.introduction = 'External update';
      const restored = renderContext({ ...session, project: external, getLatestProject: () => external });
      assert.equal(restored.form.introduction, 'Local unsaved introduction');
      assert.equal(restored.local.needsReview, true); assert.equal(restored.canSave, false);
      assert.ok(restored.changes.some(change => change.includes('External update')));
      const discarded = renderContext({ ...session, project: external, getLatestProject: () => external }, context => context.discard());
      assert.equal(discarded.form.introduction, 'External update');
      assert.equal(discarded.local.active, false); assert.equal(discarded.canActivate, true);
      const unrelated = structuredClone(external); unrelated.revision++; unrelated.name = 'Unrelated project rename';
      assert.deepEqual(projectContextBase(unrelated), projectContextBase(external));
      assert.deepEqual(contextDifferences(projectContextBase(external), projectContextBase(unrelated)), []);
    });
  } finally { await f.close(); }
});

test('activated versions are read-only until explicitly copied, and project-local drafts remain isolated', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    let project = await f.write(await f.create(), 'production/initialize');
    project = await f.write(project, 'production/context/draft', { context: complete });
    project = await f.write(project, 'production/context/activate');
    withStorage(() => {
      const session: ContextSession = { project, getLatestProject: () => project, canWrite: true, catalog: [rule], write: () => undefined };
      const active = renderContext(session);
      assert.equal(active.readOnly, true); assert.equal(active.canEdit, false); assert.equal(active.canSave, false);
      const changedCatalog = renderContext({ ...session, catalog: [{ ...rule, allowedWidthsPx: [999] }] });
      assert.deepEqual(changedCatalog.rule, project.production!.context!.versions[0]!.rulePack, 'read-only versions display their frozen rule snapshot');
      const copied = renderContext(session, context => context.requestCopy(context.activeVersion!));
      assert.equal(copied.readOnly, false); assert.equal(copied.canEdit, true); assert.equal(copied.local.active, true);
      assert.deepEqual(compileContextForm(copied.form).context, project.production!.context!.versions[0]!.context);
      renderContext(session, context => context.setField('internalCode', 'LOCAL-A'));
      const other = structuredClone(project); other.id = 'other-project';
      assert.equal(renderContext({ ...session, project: other }).form.internalCode, 'TEST-ONLY');
      assert.equal(renderContext(session).form.internalCode, 'LOCAL-A');
      const blocked = renderContext({ ...session, canWrite: false });
      assert.equal(blocked.canSave, false); assert.equal(blocked.canActivate, false); assert.equal(blocked.canEdit, false);
    });
  } finally { await f.close(); }
});

test('confirming a prepared context copy does not silently accept a newer server draft', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    let project = await f.write(await f.create(), 'production/initialize');
    project = await f.write(project, 'production/context/draft', { context: complete });
    project = await f.write(project, 'production/context/activate');
    project = await f.write(project, 'production/context/draft', { context: { productBrief: { productName: 'Existing server draft' } } });
    withStorage(() => {
      const session: ContextSession = { project, getLatestProject: () => project, canWrite: true, catalog: [rule], write: () => undefined };
      const external = structuredClone(project); external.revision++;
      external.production!.context!.draft!.productBrief!.productName = 'External replacement';
      const result = renderContextUpdates([
        { session, update: context => context.requestCopy(context.activeVersion!) },
        { session: { ...session, project: external }, update: context => context.confirmCopy() },
        { session: { ...session, project: external } },
      ]);
      assert.equal(result.form.productName, complete.productBrief!.productName);
      assert.equal(result.local.needsReview, true);
      assert.equal(result.canSave, false);
      assert.equal(result.local.originalBase?.draft?.productBrief?.productName, 'Existing server draft');
    });
  } finally { await f.close(); }
});

// Use the actual session snapshot hook, including receipt before React commits the next render.
function renderContextSaveReplay(project: Project, replay: Project, external: Project, sameBatch: boolean) {
  let result: ProjectContextController | undefined;
  let saved: ((next: Project) => void) | undefined;
  function Probe() {
    const [step, setStep] = useState(0);
    const snapshot = useProjectSnapshot(project);
    const context = useProjectContext({
      project: snapshot.project, getLatestProject: snapshot.getLatestProject, canWrite: true, catalog: [rule],
      write: (_path, _body, _label, callback) => { saved = callback; return undefined; },
    });
    result = context;
    const finishSave = () => {
      snapshot.receiveSnapshot(replay, project.id);
      assert.equal(snapshot.getLatestProject()?.revision, external.revision, 'the older write response cannot replace the latest receipt');
      assert.ok(saved); saved(replay);
    };
    if (step === 0) { context.setField('introduction', replay.production!.context!.draft!.productBrief!.introduction!); setStep(1); }
    else if (step === 1) { context.save(); setStep(2); }
    else if (step === 2) {
      snapshot.receiveSnapshot(external, project.id);
      if (sameBatch) finishSave();
      setStep(3);
    } else if (step === 3) {
      if (!sameBatch) finishSave();
      setStep(4);
    }
    return null;
  }
  renderToStaticMarkup(createElement(Probe)); assert.ok(result); return result;
}

test('an older successful save replay preserves local input when newer context arrives before or within the callback batch', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    let project = await f.write(await f.create(), 'production/initialize');
    project = await f.write(project, 'production/context/draft', { context: complete });
    for (const sameBatch of [false, true]) withStorage(() => {
      const replay = structuredClone(project); replay.revision++;
      replay.production!.context!.draft!.productBrief!.introduction = 'Local saved input';
      const external = structuredClone(replay); external.revision++;
      external.production!.context!.draft!.productBrief!.introduction = 'Newer external input';
      const result = renderContextSaveReplay(project, replay, external, sameBatch);
      assert.equal(result.form.introduction, 'Local saved input');
      assert.equal(result.local.active, true);
      assert.equal(result.local.needsReview, true);
      assert.equal(result.canActivate, false);
    });
  } finally { await f.close(); }
});

test('a successful save clears the local draft when a newer HTTP snapshot has semantically identical context', async () => {
  const f = await fixture({ rulePacks: [rule] });
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const client = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${url}${path}`, options));
    let project = await client.write(await client.create('Semantic save replay'), 'production/initialize');
    project = await client.write(project, 'production/context/draft', { context: complete });
    const replay = await client.write(project, 'production/context/draft', { context: { ...complete, productBrief: { ...complete.productBrief, introduction: 'Local saved input' } } });
    await client.write(replay, 'identity/confirm', { productName: 'Unrelated extraction identity' });
    const external = await client.get(project.id);
    assert.ok(external.revision > replay.revision);
    assert.deepEqual(projectContextBase(replay), projectContextBase(external));
    assert.notEqual(JSON.stringify(projectContextBase(replay)), JSON.stringify(projectContextBase(external)));
    for (const sameBatch of [false, true]) withStorage(() => {
      const result = renderContextSaveReplay(project, replay, external, sameBatch);
      assert.equal(result.form.introduction, 'Local saved input');
      assert.equal(result.local.active, false);
      assert.equal(result.local.needsReview, false);
      assert.equal(result.canActivate, true);
    });
  } finally { await f.close(); }
});
