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
import { compileContextForm, contextForm, projectContextBase } from '../../src/pages/ArcaneWarriorPage/project-context.js';

const catalog = { rulePacks: [rule], scopedRulePacks: [scopedRule] };
function projectWith(...contexts: CompleteContext[]) {
  const project = createProject('Synthetic scoped compatibility fixture'); initializeProduction(project);
  for (const value of contexts) { saveContextDraft(project.production!, value); activateContext(project.production!, catalog, 'test-human'); }
  return project;
}
function sessionFor(project: ReturnType<typeof projectWith>, calls: string[] = []): ContextSession {
  return { project, getLatestProject: () => project, canWrite: true, catalog: [rule], scopedCatalog: [scopedRule], write: path => { calls.push(path); return undefined; } };
}
function withStorage(run: (values: Map<string, string>) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true,
    value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try { run(values); } finally { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); }
}
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

test('actual hook keeps scoped active snapshots read-only, then explicitly copies every field without mutating history', () => {
  withStorage(() => {
    const project = projectWith(scopedContext); const before = structuredClone(project); const calls: string[] = [];
    const session = sessionFor(project, calls);
    const active = renderSteps([{ session, update: c => { c.setField('productName', 'Blocked direct edit'); c.setRule(rule.id, rule.version); c.save(); c.activate(); } }, { session }]);
    assert.equal(active.readOnly, true); assert.equal(active.canEdit, false); assert.equal(active.canSave, false); assert.equal(active.canActivate, false);
    assert.equal(active.canCopyVersion(active.activeVersion), true); assert.deepEqual(active.rule, scopedRule); assert.deepEqual(calls, []);
    const copied = renderSteps([{ session, update: c => c.requestCopy(c.activeVersion!) }, { session }]);
    assert.equal(copied.readOnly, false); assert.equal(copied.canEdit, true); assert.equal(copied.canSave, true); assert.equal(copied.canActivate, false);
    assert.deepEqual(compileContextForm(copied.form).context, scopedContext); assert.deepEqual(project, before);
    copied.save(); assert.deepEqual(calls, ['production/context/draft']);
  });
});

test('partial scoped drafts remain editable and retain their markers without borrowing an unrelated active rule', () => {
  const drafts: ContextDraft[] = [
    { productBrief: { productName: 'Content type draft' }, primaryTarget: { contentType: 'amazon_basic_aplus' } },
    { productBrief: { productName: 'Local policy draft' }, canvasProfile: { selectionBasis: 'local_production_policy' } },
    { ...scopedContext, productBrief: { ...scopedContext.productBrief, productName: 'Complete scoped draft' } },
  ];
  for (const existing of [false, true]) for (const draft of drafts) withStorage(() => {
    const project = existing ? projectWith(context) : projectWith(); saveContextDraft(project.production!, draft);
    const session = sessionFor(project), before = structuredClone(project);
    const result = renderSteps([{ session, update: c => c.setField('introduction', 'Editable partial source') }, { session }]);
    assert.equal(result.readOnly, false); assert.equal(result.canEdit, true); assert.equal(result.canSave, true); assert.equal(result.canActivate, false);
    assert.equal(result.form.productName, draft.productBrief!.productName);
    assert.equal(result.compiled.context.primaryTarget?.contentType, draft.primaryTarget?.contentType);
    assert.equal(result.compiled.context.canvasProfile?.selectionBasis, draft.canvasProfile?.selectionBasis);
    assert.deepEqual(result.rule, draft.rulePackRef ? scopedRule : undefined); assert.deepEqual(project, before);
  });
});

test('both historical models can be copied while unavailable catalog versions remain readable and block activation', () => {
  withStorage(() => {
    const project = projectWith(scopedContext, context), session = sessionFor(project);
    const history = renderSteps([{ session, update: c => c.requestCopy(c.state!.versions[0]!) }, { session }]);
    assert.deepEqual(history.compiled.context, scopedContext); assert.equal(history.canSave, true); assert.equal(history.model, 'scoped-rules.1');
    const pending = renderSteps([{ session, update: c => c.requestCopy(c.activeVersion!) }, { session }]);
    assert.ok(pending.pendingCopy?.changes.some(change => change.includes('内容类型')));
    const legacy = renderSteps([{ session, update: c => c.requestCopy(c.activeVersion!) }, { session, update: c => c.confirmCopy() }, { session }]);
    assert.deepEqual(legacy.compiled.context, context); assert.equal(legacy.model, 'legacy-canvas.1');
  });
  withStorage(() => {
    const project = projectWith(scopedContext), session = { ...sessionFor(project), catalog: [], scopedCatalog: [] };
    const active = renderSteps([{ session }]); assert.deepEqual(active.rule, scopedRule); assert.equal(active.canCopyVersion(active.activeVersion), true);
    const copied = renderSteps([{ session, update: c => c.requestCopy(c.activeVersion!) }, { session }]);
    assert.equal(copied.rule, undefined); assert.deepEqual(copied.frozenReference, scopedRule); assert.equal(copied.canSave, true); assert.equal(copied.canActivate, false);
    assert.ok(copied.issues.some(issue => issue.field === 'catalog')); assert.deepEqual(copied.compiled.context, scopedContext);
  });
});

test('prepared copies preserve their old dependency and stale same-batch callbacks cannot change or submit context', () => {
  withStorage(() => {
    const project = projectWith(context); saveContextDraft(project.production!, context);
    const updated = structuredClone(project); updated.revision++; saveContextDraft(updated.production!, scopedContext);
    const calls: string[] = [], oldSession = sessionFor(project, calls), newSession = sessionFor(updated, calls);
    const copied = renderSteps([{ session: oldSession, update: c => c.requestCopy(c.activeVersion!) }, { session: newSession, update: c => c.confirmCopy() }, { session: newSession }]);
    assert.equal(copied.local.needsReview, true); assert.equal(copied.canSave, false); assert.equal(copied.form.contentType, '');
    assert.ok(copied.changes.some(change => change.includes('内容类型'))); assert.deepEqual(copied.local.originalBase, projectContextBase(project));
  });
  withStorage(() => {
    const project = projectWith(context); saveContextDraft(project.production!, context);
    let latest = project; const calls: string[] = [];
    const session = { ...sessionFor(project, calls), getLatestProject: () => latest };
    const active = renderSteps([{ session }]);
    const edited = renderSteps([{ session, update: c => c.setField('productName', 'Local before SSE') }, { session }]);
    const key = draftKey(project.id, 'productionContext:reviewed'), original = localStorage.getItem(key);
    latest = structuredClone(project); latest.revision++; saveContextDraft(latest.production!, scopedContext);
    edited.setField('productName', 'Stale edit'); edited.setRule(rule.id, rule.version); edited.applyRuleTarget(); edited.requestCopy(edited.activeVersion!);
    edited.requestModel('scoped-rules.1'); edited.save(); active.activate(); edited.local.acknowledge();
    assert.deepEqual(calls, []); assert.equal(localStorage.getItem(key), original); assert.equal(edited.canCopyVersion(edited.activeVersion), false);
  });
});

test('old local forms migrate against their recorded base and project switches preserve independent inputs', () => {
  withStorage(values => {
    const project = projectWith(scopedContext); saveContextDraft(project.production!, scopedContext);
    const old = contextForm(scopedContext) as Partial<ReturnType<typeof contextForm>>;
    delete old.contentType; delete old.selectionBasis; delete old.ruleModel; old.introduction = 'Retained old input';
    values.set(draftKey(project.id, 'productionContext:reviewed'), JSON.stringify({ value: old, base: projectContextBase(project), active: true }));
    const updated = structuredClone(project); updated.revision++; updated.production!.context!.draft!.primaryTarget!.contentType = 'another_content';
    const session = sessionFor(updated);
    const restored = renderSteps([{ session }]);
    assert.equal(restored.migrationRequired, true); assert.equal(restored.canEdit, false); assert.equal(restored.canSave, false);
    assert.equal(restored.form.contentType, scopedContext.primaryTarget.contentType); assert.equal(restored.form.selectionBasis, 'local_production_policy');
    const migrated = renderSteps([{ session, update: c => c.migrateLocal() }, { session }]);
    assert.equal(migrated.migrationRequired, false); assert.equal(migrated.local.needsReview, true); assert.equal(migrated.canSave, false);
    const reviewed = renderSteps([{ session, update: c => c.local.acknowledge() }, { session }]);
    assert.equal(reviewed.canSave, true); assert.equal(reviewed.form.introduction, 'Retained old input');
    assert.equal(reviewed.form.contentType, scopedContext.primaryTarget.contentType);
    const other = projectWith(scopedContext);
    assert.notEqual(renderSteps([{ session: sessionFor(other) }]).form.introduction, 'Retained old input');
    assert.equal(renderSteps([{ session }]).form.introduction, 'Retained old input');
  });
});

test('model switching preserves both local field sets and never carries a rule into the other model', () => {
  withStorage(() => {
    const project = projectWith(); saveContextDraft(project.production!, scopedContext); const session = sessionFor(project);
    const legacy = renderSteps([{ session, update: c => c.requestModel('legacy-canvas.1') },
      { session, update: c => { assert.ok(c.pendingCopy?.changes.some(change => change.includes('画布选择依据'))); c.confirmCopy(); } }, { session }]);
    assert.equal(legacy.form.contentType, ''); assert.equal(legacy.form.selectionBasis, ''); assert.equal(legacy.form.rulePackId, '');
    assert.deepEqual(legacy.backups['scoped-rules.1']?.form, contextForm(scopedContext));
    const chosen = renderSteps([{ session, update: c => c.setRule(rule.id, rule.version) }, { session }]);
    assert.equal(chosen.form.rulePackId, rule.id); assert.equal(chosen.compiled.context.primaryTarget?.contentType, undefined);
    const scoped = renderSteps([{ session, update: c => c.requestModel('scoped-rules.1') }, { session, update: c => c.confirmCopy() }, { session }]);
    assert.deepEqual(scoped.compiled.context, scopedContext); assert.equal(scoped.local.needsReview, false);
    assert.equal(scoped.backups['legacy-canvas.1']?.form.rulePackId, rule.id);
    scoped.setRule(rule.id, rule.version);
    assert.equal(renderSteps([{ session }]).form.rulePackId, scopedRule.id, 'direct calls cannot attach a legacy rule to scoped input');
  });
});

test('an old successful save callback cannot dismiss a newly prepared copy or erase its field comparison', () => {
  withStorage(() => {
    const project = projectWith(context); saveContextDraft(project.production!, scopedContext);
    const saved = structuredClone(project); saved.revision++; saved.production!.context!.draft!.productBrief!.introduction = 'Submitted scoped input';
    let latest = project, callback: ((next: typeof project) => void) | undefined;
    const session: ContextSession = { ...sessionFor(project), getLatestProject: () => latest, write: (_path, _body, _label, onSaved) => { callback = onSaved; return undefined; } };
    const current = { ...session, project: saved };
    const result = renderSteps([
      { session, update: c => c.setField('introduction', 'Submitted scoped input') },
      { session, update: c => { c.save(); latest = saved; } },
      { session: current, update: c => c.requestCopy(c.activeVersion!) },
      { session: current, update: c => { assert.ok(c.pendingCopy); assert.equal(c.canEdit, false); assert.equal(c.canSave, false); assert.ok(callback); callback(saved); } },
      { session: current },
    ]);
    assert.ok(result.pendingCopy); assert.equal(result.local.active, true); assert.equal(result.form.contentType, scopedContext.primaryTarget.contentType);
    assert.ok(result.pendingCopy.changes.some(change => change.includes('内容类型')));
  });
});

test('an altered same-version catalog cannot enable a new context while the frozen historical rule stays unchanged', () => {
  withStorage(() => {
    const project = projectWith(scopedContext); saveContextDraft(project.production!, scopedContext);
    const changed = structuredClone(scopedRule); changed.localProductionPolicy.canvasWidthPx = { min: 1000, max: 1800 };
    const calls: string[] = [], result = renderSteps([{ session: { ...sessionFor(project, calls), scopedCatalog: [changed] } }]);
    assert.equal(result.canActivate, false); assert.ok(result.issues.some(issue => issue.message.includes('历史冻结内容不一致'))); result.activate(); assert.deepEqual(calls, []);
    assert.deepEqual(project.production!.context!.versions[0]!.rulePack, scopedRule);
  });
});
