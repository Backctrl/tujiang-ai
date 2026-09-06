import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { draftKey, sameJsonValue, useReviewedDraft } from '../../src/pages/ArcaneWarriorPage/project-drafts.js';

type IdentityBase = { revision: number; name: string };
type DraftState<T, B> = ReturnType<typeof useReviewedDraft<T, B>>;

function withStorage(run: (values: Map<string, string>) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try { run(values); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

// Exercise the actual hook on a fresh React render, as happens when a project subtree remounts.
// This does not replace the real-browser project-switching and event-stream acceptance.
function renderDraft<T, B>(projectId: string, field: string, fallback: T, baseFor: (value: T) => B,
  update?: (draft: DraftState<T, B>) => void): DraftState<T, B> {
  let result: DraftState<T, B> | undefined;
  function Probe() {
    const updated = useRef(false);
    const draft = useReviewedDraft(projectId, field, fallback, baseFor);
    result = draft;
    if (update && !updated.current) { updated.current = true; update(draft); }
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.ok(result);
  return result;
}

test('restored identity draft retains its original dependency and requires explicit review after an external change', () => withStorage(values => {
  const before: IdentityBase = { revision: 1, name: '产品 A' };
  const after: IdentityBase = { revision: 2, name: '外部纠正后的产品 A' };
  const created = renderDraft<string | null, IdentityBase>('a', 'productName', null, () => before, draft => draft.setValue('本地纠正草稿'));
  assert.equal(created.needsReview, false);
  assert.deepEqual(created.originalBase, before);

  const other = renderDraft<string | null, IdentityBase>('b', 'productName', null, () => ({ revision: 1, name: '产品 B' }));
  assert.equal(other.value, null);
  const restored = renderDraft<string | null, IdentityBase>('a', 'productName', null, () => after);
  assert.equal(restored.value, '本地纠正草稿');
  assert.deepEqual(restored.originalBase, before);
  assert.equal(restored.needsReview, true);

  const edited = renderDraft<string | null, IdentityBase>('a', 'productName', null, () => after, draft => draft.setValue('继续输入的草稿'));
  assert.equal(edited.needsReview, true, 'typing must not silently acknowledge the new dependency');
  assert.deepEqual(edited.originalBase, before);
  const reviewed = renderDraft<string | null, IdentityBase>('a', 'productName', null, () => after, draft => draft.acknowledge());
  assert.equal(reviewed.needsReview, false);
  assert.equal(reviewed.value, '继续输入的草稿');
  assert.deepEqual(reviewed.originalBase, after);
  assert.ok(values.has(draftKey('a', 'productName:reviewed')));
}));

test('legacy drafts without a base stay blocked until reviewed or discarded', () => withStorage(values => {
  values.set(draftKey('a', 'productName'), JSON.stringify('旧身份草稿'));
  const base = { revision: 3, name: '当前身份' };
  const restored = renderDraft<string | null, IdentityBase>('a', 'productName', null, () => base);
  assert.equal(restored.value, '旧身份草稿');
  assert.equal(restored.originalBase, null);
  assert.equal(restored.needsReview, true);
  const discarded = renderDraft<string | null, IdentityBase>('a', 'productName', null, () => base, draft => draft.discard());
  assert.equal(discarded.value, null);
  assert.equal(discarded.needsReview, false);
  assert.equal(renderDraft<string | null, IdentityBase>('a', 'productName', null, () => base).value, null, 'legacy content must not return after discard');
}));

test('candidate correction dependency includes identity and the corrected fact snapshot', () => withStorage(() => {
  type Candidate = { value: string; correctsFactId?: string };
  type CandidateBase = { identityRevision: number; identityName: string; correctedFact: { id: string; value: string; status: string } | null };
  const before: CandidateBase = { identityRevision: 1, identityName: '产品 A', correctedFact: { id: 'fact-a', value: '10 kg', status: 'confirmed' } };
  const fallback: Candidate = { value: '' };
  renderDraft<Candidate, CandidateBase>('a', 'factCandidate', fallback, () => before, draft => draft.replace(draft.prepareReplacement({ value: '8 kg', correctsFactId: 'fact-a' })));
  const changedFact = { ...before, correctedFact: { ...before.correctedFact!, status: 'retracted' } };
  const restored = renderDraft<Candidate, CandidateBase>('a', 'factCandidate', fallback, () => changedFact);
  assert.equal(restored.needsReview, true);
  assert.equal(restored.value.correctsFactId, 'fact-a');
  assert.equal(restored.originalBase?.correctedFact?.status, 'confirmed');
  assert.equal(restored.currentBase.correctedFact?.status, 'retracted');
  assert.equal(renderDraft<Candidate, CandidateBase>('a', 'factCandidate', fallback, () => ({ ...before, identityRevision: 2 })).needsReview, true);
  assert.equal(renderDraft<Candidate, CandidateBase>('a', 'factCandidate', fallback, () => ({ ...before, correctedFact: null })).needsReview, true);
  assert.equal(renderDraft<Candidate, CandidateBase>('a', 'factCandidate', fallback, () => before).needsReview, false);
}));

test('replacement confirmation preserves the dependency captured before an external update', () => withStorage(() => {
  type Candidate = { value: string; correctsFactId?: string };
  type CandidateBase = { identityRevision: number; correctedFact: { id: string; status: string } | null };
  const before: CandidateBase = { identityRevision: 1, correctedFact: { id: 'fact-a', status: 'confirmed' } };
  const fallback: Candidate = { value: '' };
  const existing = renderDraft<Candidate, CandidateBase>('a', 'factCandidate', fallback, () => before, draft => draft.setValue({ value: '未保存候选' }));
  const prepared = existing.prepareReplacement({ value: '旧事实的纠正', correctsFactId: 'fact-a' });
  const after: CandidateBase = { identityRevision: 2, correctedFact: { id: 'fact-a', status: 'retracted' } };
  const replaced = renderDraft<Candidate, CandidateBase>('a', 'factCandidate', fallback, () => after, draft => draft.replace(prepared));
  assert.equal(replaced.value.value, '旧事实的纠正');
  assert.deepEqual(replaced.originalBase, before, 'replacement must keep the basis shown when the correction was requested');
  assert.deepEqual(replaced.currentBase, after);
  assert.equal(replaced.needsReview, true, 'accepting replacement cannot acknowledge an unseen identity or fact change');
}));

test('reviewed JSON bases ignore nested object key order while preserving array order and changed values', () => withStorage(() => {
  const before = { product: { name: 'Product', code: 'A' }, facts: [{ id: 'one', value: '1' }, { id: 'two', value: '2' }] };
  const reordered = { facts: [{ value: '1', id: 'one' }, { value: '2', id: 'two' }], product: { code: 'A', name: 'Product' } };
  assert.equal(sameJsonValue(before, reordered), true);
  renderDraft('a', 'ordered-base', '', () => before, draft => draft.setValue('Local input'));
  assert.equal(renderDraft('a', 'ordered-base', '', () => reordered).needsReview, false);
  assert.equal(renderDraft('a', 'ordered-base', '', () => ({ ...reordered, facts: [...reordered.facts].reverse() })).needsReview, true);
  assert.equal(renderDraft('a', 'ordered-base', '', () => ({ ...reordered, product: { ...reordered.product, code: 'B' } })).needsReview, true);
}));

test('a legacy JSON value identical to the server except for key ordering does not become an active draft', () => withStorage(values => {
  values.set(draftKey('a', 'legacy-object'), JSON.stringify({ nested: { name: 'Product', code: 'A' } }));
  const result = renderDraft('a', 'legacy-object', { nested: { code: 'A', name: 'Product' } }, () => ({ revision: 1 }));
  assert.equal(result.active, false);
  assert.equal(result.needsReview, false);
}));
