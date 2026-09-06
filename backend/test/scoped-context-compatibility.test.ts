import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createProject } from '../src/domain.js';
import { initializeProduction } from '../src/production.js';
import { activateContext, saveContextDraft, type CompleteContext, type ContextDraft } from '../src/production-context.js';
import { rule, context } from './fixtures/production-context.js';
import { scopedRule, scopedContext } from './fixtures/scoped-rules.js';
import { useProjectContext, type ContextSession, type ProjectContextController } from '../../src/pages/ArcaneWarriorPage/useProjectContext.js';
import { draftKey } from '../../src/pages/ArcaneWarriorPage/project-drafts.js';

const catalog = { rulePacks: [rule], scopedRulePacks: [scopedRule] };
function projectWith(...contexts: CompleteContext[]) {
  const project = createProject('Synthetic scoped compatibility fixture'); initializeProduction(project);
  for (const value of contexts) { saveContextDraft(project.production!, value); activateContext(project.production!, catalog, 'test-human'); }
  return project;
}
function sessionFor(project: ReturnType<typeof projectWith>, calls: string[] = []): ContextSession {
  return { project, getLatestProject: () => project, canWrite: true, catalog: [rule], write: path => { calls.push(path); return undefined; } };
}
function withStorage(run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try { run(); } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}
// Exercise the actual hook with React's render-phase updates, as in the existing context client tests.
function renderSteps(steps: { session: ContextSession; update?: (context: ProjectContextController) => void }[]) {
  let result: ProjectContextController | undefined;
  function Probe() {
    const [index, setIndex] = useState(0); const step = steps[index]!;
    const context = useProjectContext(step.session); result = context;
    if (index < steps.length - 1) { step.update?.(context); setIndex(index + 1); }
    return null;
  }
  renderToStaticMarkup(createElement(Probe)); assert.ok(result); return result;
}

test('actual context hook keeps a scoped active snapshot read-only and rejects direct legacy edit, copy, save and activate calls', () => {
  withStorage(() => {
    const project = projectWith(scopedContext); const before = structuredClone(project); const calls: string[] = [];
    const session = sessionFor(project, calls);
    const result = renderSteps([{ session, update: c => {
      c.requestCopy(c.activeVersion!); c.setField('productName', 'Must not replace scoped context');
      c.setRule(rule.id, rule.version); c.applyRuleTarget(); c.save(); c.activate();
    } }, { session }]);
    assert.equal(result.compatibilityBlocked, true); assert.equal(result.readOnly, true);
    assert.equal(result.canEdit, false); assert.equal(result.canSave, false); assert.equal(result.canActivate, false);
    assert.equal(result.canCopyVersion(result.activeVersion), false); assert.equal(result.local.active, false); assert.equal(result.pendingCopy, null);
    assert.equal(result.form.productName, scopedContext.productBrief.productName);
    assert.deepEqual(result.rule, scopedRule); assert.deepEqual(calls, []); assert.deepEqual(project, before);
  });
});

test('actual context hook blocks scoped server drafts without showing an unrelated legacy active rule or losing partial markers', () => {
  const drafts: ContextDraft[] = [
    { productBrief: { productName: 'Content type draft' }, primaryTarget: { contentType: 'amazon_basic_aplus' } },
    { productBrief: { productName: 'Local selection draft' }, canvasProfile: { selectionBasis: 'local_production_policy' } },
    { ...scopedContext, productBrief: { ...scopedContext.productBrief, productName: 'Complete scoped draft' } },
  ];
  for (const existing of [false, true]) for (const draft of drafts) withStorage(() => {
    const project = existing ? projectWith(context) : projectWith(); saveContextDraft(project.production!, draft);
    const before = structuredClone(project); const calls: string[] = []; const session = sessionFor(project, calls);
    const result = renderSteps([{ session, update: c => {
      if (c.activeVersion) c.requestCopy(c.activeVersion);
      c.setField('productName', 'Forbidden edit'); c.setRule(rule.id, rule.version); c.save(); c.activate();
    } }, { session }]);
    assert.equal(result.compatibilityBlocked, true); assert.equal(result.readOnly, false, 'a saved draft is not an active-version view');
    assert.equal(result.rule, undefined, 'never present the previous active legacy rule as this draft rule');
    assert.equal(result.form.productName, draft.productBrief!.productName);
    assert.equal(result.canEdit, false); assert.equal(result.canSave, false); assert.equal(result.canActivate, false);
    assert.equal(result.local.active, false); assert.equal(result.pendingCopy, null); assert.deepEqual(calls, []); assert.deepEqual(project, before);
  });
});

test('actual context hook refuses scoped historical copies while preserving legacy copying, saving and activation', () => {
  withStorage(() => {
    const project = projectWith(scopedContext, context); const calls: string[] = []; const session = sessionFor(project, calls);
    const first = renderSteps([{ session, update: c => c.requestCopy(c.state!.versions[0]!) }, { session }]);
    assert.equal(first.compatibilityBlocked, false); assert.equal(first.readOnly, true); assert.equal(first.local.active, false);
    assert.equal(first.canCopyVersion(first.state!.versions[0]), false); assert.equal(first.canCopyVersion(first.activeVersion), true);
    assert.deepEqual(first.rule, rule);
    const copied = renderSteps([{ session, update: c => c.requestCopy(c.activeVersion!) },
      { session, update: c => c.setField('internalCode', 'LEGACY-CONTINUES') }, { session }]);
    assert.equal(copied.compatibilityBlocked, false); assert.equal(copied.canEdit, true); assert.equal(copied.canSave, true);
    assert.equal(copied.form.internalCode, 'LEGACY-CONTINUES'); copied.save(); assert.deepEqual(calls, ['production/context/draft']);
  });
  withStorage(() => {
    const project = projectWith(); saveContextDraft(project.production!, context); const calls: string[] = [];
    const saved = renderSteps([{ session: sessionFor(project, calls) }]);
    assert.equal(saved.compatibilityBlocked, false); assert.equal(saved.canActivate, true);
    saved.activate(); assert.deepEqual(calls, ['production/context/activate']);
  });
});

test('actual context hook blocks a pending copy or restored local draft when upstream moves to the scoped model', () => {
  for (const pendingCopy of [true, false]) withStorage(() => {
    const project = projectWith(context); saveContextDraft(project.production!, { productBrief: { productName: 'Legacy saved draft' } });
    const updated = structuredClone(project); updated.revision++;
    saveContextDraft(updated.production!, { ...scopedContext, productBrief: { ...scopedContext.productBrief, productName: 'Upstream scoped draft' } });
    const calls: string[] = []; const oldSession = sessionFor(project, calls); const newSession = sessionFor(updated, calls);
    const result = renderSteps([
      { session: oldSession, update: c => pendingCopy ? c.requestCopy(c.activeVersion!) : c.setField('productName', 'Local legacy input') },
      { session: newSession, update: c => pendingCopy ? c.confirmCopy() : c.local.acknowledge() },
      { session: newSession, update: c => { c.save(); c.activate(); c.requestCopy(c.activeVersion!); } },
      { session: newSession },
    ]);
    assert.equal(result.compatibilityBlocked, true); assert.equal(result.readOnly, false); assert.equal(result.rule, undefined);
    assert.equal(result.canEdit, false); assert.equal(result.canSave, false); assert.equal(result.canActivate, false); assert.deepEqual(calls, []);
    if (pendingCopy) { assert.ok(result.pendingCopy); assert.equal(result.local.active, false); assert.equal(result.form.productName, 'Upstream scoped draft'); }
    else { assert.equal(result.local.active, true); assert.equal(result.form.productName, 'Local legacy input'); }
    assert.equal(updated.production!.context!.draft!.primaryTarget!.contentType, 'amazon_basic_aplus');
    assert.equal(updated.production!.context!.draft!.canvasProfile!.selectionBasis, 'local_production_policy');
  });
});

test('actual context hook rechecks the latest project before stale callbacks can overwrite scoped fields', () => {
  withStorage(() => {
    const project = projectWith(context); saveContextDraft(project.production!, context);
    let latest = project; const calls: string[] = [];
    const session = { ...sessionFor(project, calls), getLatestProject: () => latest };
    const saved = renderSteps([{ session }]); assert.equal(saved.canActivate, true);
    const edited = renderSteps([{ session, update: c => c.setField('productName', 'Local input before SSE') }, { session }]);
    assert.equal(edited.canSave, true);
    const key = draftKey(project.id, 'productionContext:reviewed'); const localBefore = localStorage.getItem(key);
    latest = structuredClone(project); latest.revision++; saveContextDraft(latest.production!, scopedContext);
    const before = structuredClone(latest);
    // Keep the old callbacks deliberately: the newer snapshot reached the session before a UI render.
    edited.setField('productName', 'Forbidden stale edit'); edited.setRule(rule.id, rule.version); edited.applyRuleTarget();
    edited.requestCopy(edited.activeVersion!); edited.save(); saved.activate();
    assert.equal(edited.canCopyVersion(edited.activeVersion), false);
    assert.deepEqual(calls, []); assert.equal(localStorage.getItem(key), localBefore); assert.deepEqual(latest, before);
  });
});
