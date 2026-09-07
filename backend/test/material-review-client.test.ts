import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { tsImport } from 'tsx/esm/api';
import { createElement, isValidElement, useRef, useState, type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { fixture, plan } from './helpers.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import { Worker } from '../src/worker.js';
import type { Project } from '../src/contracts.js';
import type { MaterialReviewCenter } from '../src/production-material-usage.js';
import { ApiError, StageAApi } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';
import { executeMaterialOperation } from '../../src/pages/ArcaneWarriorPage/material-intake.js';
import { prepareReviewWrite, type ReviewKind } from '../../src/pages/ArcaneWarriorPage/review-requests.js';
import { validateMaterialOperation, type MaterialOperation, type MaterialIntakeStorage, type MaterialLocalEntry } from '../../src/pages/ArcaneWarriorPage/material-storage.js';
import { draftKey } from '../../src/pages/ArcaneWarriorPage/project-drafts.js';
import { useReviewDraft } from '../../src/pages/ArcaneWarriorPage/useReviewDraft.js';
import { useProjectSnapshot } from '../../src/pages/ArcaneWarriorPage/useProjectSnapshot.js';
import { useProjectSession } from '../../src/pages/ArcaneWarriorPage/useProjectSession.js';
import { useMaterialIntake } from '../../src/pages/ArcaneWarriorPage/useMaterialIntake.js';
import { candidateDraftBase, candidateValid, emptyFactCandidate, emptyUsageDraft, evidenceAvailable, isMaterialReviewCenter, reconfirmEvidence,
  reviewCenterMatches, reviewTypes, usageChangeImpact, usageDecisions, usageDraftBase, usageDraftValid, type UsageDraft } from '../../src/pages/ArcaneWarriorPage/material-review.js';
import type { MaterialReviewsController } from '../../src/pages/ArcaneWarriorPage/useMaterialReviews.js';

// Review recovery uses the same durable executor as original uploads. Browser IndexedDB and layout are accepted separately.
class ReviewStorage implements MaterialIntakeStorage {
  async releaseConflict() { this.pending = undefined; }
  pending: MaterialOperation | undefined;
  failSave = false;
  failSettle = false;
  readPending() { return Promise.resolve(this.pending ? validateMaterialOperation(structuredClone(this.pending)) : undefined); }
  async savePending(operation: MaterialOperation) {
    if (this.failSave) throw new Error('Synthetic storage quota failure');
    assert.ok(!this.pending || this.pending.prepared.body === operation.prepared.body);
    this.pending = structuredClone(operation);
  }
  async replacePending() { throw new Error('Reviews must never automatically replace their request'); }
  async settle() { if (this.failSettle) throw new Error('Synthetic settlement failure'); this.pending = undefined; }
  async markUncertain() { /* No original-file entry exists for review operations. */ }
  async list() { return [] as MaterialLocalEntry[]; }
  async put() { throw new Error('Review requests do not create local File entries'); }
  async remove() { throw new Error('Review requests do not remove original File entries'); }
  subscribe() { return () => undefined; }
}
async function parsed(f: Awaited<ReturnType<typeof fixture>>) {
  let p = await f.write(await f.create(), 'production/initialize');
  p = await f.write(p, 'identity/confirm', { productName: 'Synthetic review fixture product' });
  p = await f.write(p, 'production/materials', { fileName: 'review-source.txt', mimeType: 'text/plain', source: { kind: 'local_upload', title: 'Synthetic source only' }, contentBase64: Buffer.from('Capacity 10 kg\nMaterial steel\nUnreviewed line\nReference layout').toString('base64') });
  await new IngestionWorker(f.store, f.objects).tick();
  return f.store.get(p.id);
}
function currentReviews(center: MaterialReviewCenter): MaterialReviewsController {
  return { center, tasks: center.tasks, counts: Object.fromEntries(reviewTypes.map(type => [type, center.tasks.filter(task => task.type === type).length])) as MaterialReviewsController['counts'],
    current: true, isCurrent: () => true, initialized: true, loading: false, error: '', reload: () => undefined };
}
async function withStorage(run: (values: Map<string, string>) => void | Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
  } });
  try { await run(values); } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}
async function ui(name: string) {
  const assets = registerHooks({ load(url, context, nextLoad) {
    if (/\.(png|jpe?g|webp|svg)(?:\?|$)/.test(url)) return { format: 'module', source: `export default ${JSON.stringify(url)}`, shortCircuit: true };
    return nextLoad(url, context);
  } });
  try { return await tsImport(`../../src/pages/ArcaneWarriorPage/${name}.tsx`, { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../tsconfig.app.json', import.meta.url)) }); }
  finally { assets.deregister(); }
}

test('actual manual evidence controls normalize labels and clear after HTTP receipt or same-request replay without changing source text', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const transport: typeof fetch = (path, options) => fetch(`${url}${path}`, options);
    const client = new StageAApi(f.headers.authorization.slice(7), transport);
    const { ManualEvidenceFields } = await ui('ManualEvidenceFields');
    for (const surface of ['setup', 'facts'] as const) for (const loseResponse of [false, true]) await withStorage(async values => {
      const project = await client.create(`Manual receipt ${surface} ${loseResponse}`);
      const field = (name: string) => surface === 'setup' ? name : `manualEvidence:facts:${name}`;
      const inputs = { documentName: '  Manual QA source  ', locator: '  paragraph 1  ', evidenceText: '  Capacity 10 kg\n' };
      for (const [name, value] of Object.entries(inputs)) values.set(draftKey(project.id, field(name)), JSON.stringify(value));
      let captured: Record<string, unknown> | undefined, receipt: Project | undefined, current = project;
      function findSave(node: ReactNode): ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }> | undefined {
        if (Array.isArray(node)) { for (const child of node) { const found = findSave(child); if (found) return found; } return; }
        if (!isValidElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>(node)) return;
        return node.props.children === '保存文字证据' ? node : findSave(node.props.children);
      }
      function Invoke() {
        const once = useRef(false);
        const session = { ...useProjectSession(), project: current, getLatestProject: () => current, canWrite: true,
          reviewWrite: (_kind: ReviewKind, _path: string, fields: Record<string, unknown>, _label: string, onSaved?: (next: Project) => void) => {
            captured = fields; if (receipt) { current = receipt; onSaved?.(receipt); } return Promise.resolve({ kind: 'blocked' as const });
          } };
        const tree = ManualEvidenceFields({ session, surface }) as ReactNode;
        if (!once.current) { once.current = true; const save = findSave(tree); assert.ok(save?.props.onClick); assert.equal(save.props.disabled, false); save.props.onClick(); }
        return tree;
      }
      renderToStaticMarkup(createElement(Invoke));
      assert.deepEqual(captured, { documentName: 'Manual QA source', locator: 'paragraph 1', text: inputs.evidenceText, usage: 'product_evidence' });
      const storage = new ReviewStorage();
      const operation = prepareReviewWrite(project, 'manual-evidence', 'evidence', captured!, 'Manual evidence saved');
      const sent: string[] = [];
      const dropping = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
        sent.push(String(options?.body)); const response = await transport(path, options);
        if (loseResponse && sent.length === 1) throw new Error('Synthetic lost success response');
        return response;
      });
      let outcome = await executeMaterialOperation(operation, dropping, storage, () => undefined);
      if (loseResponse) {
        assert.equal(outcome.kind, 'uncertain'); assert.ok(storage.pending);
        const read = await client.get(project.id); assert.equal(read.evidence.length, 1);
        outcome = await executeMaterialOperation((await storage.readPending())!, dropping, storage, () => undefined, true);
        assert.deepEqual(sent, [operation.prepared.body, operation.prepared.body]);
      }
      assert.equal(outcome.kind, 'saved'); if (outcome.kind !== 'saved') throw new Error('Expected saved receipt');
      receipt = outcome.project;
      assert.equal(receipt.evidence.length, 1); assert.equal(receipt.evidence[0]!.text, inputs.evidenceText);
      const html = renderToStaticMarkup(createElement(Invoke));
      for (const name of Object.keys(inputs)) assert.equal(JSON.parse(values.get(draftKey(project.id, field(name)))!), '');
      assert.match(html, /disabled=""[^>]*>保存文字证据/);
      assert.equal((await client.get(project.id)).evidence.length, 1);
      const withdrawn = structuredClone(receipt); withdrawn.evidence[0]!.availability = 'withdrawn';
      for (const [name, value] of Object.entries(inputs)) values.set(draftKey(project.id, field(name)), JSON.stringify(value));
      function Withdrawn() { return createElement(ManualEvidenceFields, { surface, session: { ...useProjectSession(), project: withdrawn, getLatestProject: () => withdrawn, canWrite: true } }); }
      const withdrawnHtml = renderToStaticMarkup(createElement(Withdrawn));
      assert.doesNotMatch(withdrawnHtml, /这份文字证据已保存/); assert.doesNotMatch(withdrawnHtml, /disabled=""[^>]*>保存文字证据/);
    });
  } finally { await f.close(); }
});

test('restored manual evidence has an explicit saved-record state without onSaved, preserves old requests and other surface drafts, and guards stale clicks', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const transport: typeof fetch = (path, options) => fetch(`${url}${path}`, options);
    const client = new StageAApi(f.headers.authorization.slice(7), transport);
    const { ManualEvidenceFields } = await ui('ManualEvidenceFields');
    for (const surface of ['setup', 'facts'] as const) await withStorage(async values => {
      const project = await client.create(`Restored manual input ${surface}`);
      const otherSurface = surface === 'setup' ? 'facts' : 'setup';
      const field = (area: 'setup' | 'facts', name: string) => area === 'setup' ? name : `manualEvidence:facts:${name}`;
      const fields = { documentName: '  Manual recovery source  ', locator: '  paragraph 1  ', text: '  Capacity 10 kg\n', usage: 'product_evidence' };
      for (const area of [surface, otherSurface] as const) for (const [name, value] of Object.entries({ documentName: area === surface ? fields.documentName : 'Other independent draft', locator: fields.locator, evidenceText: fields.text })) {
        values.set(draftKey(project.id, field(area, name)), JSON.stringify(value));
      }
      const beforeDrafts = new Map(values), storage = new ReviewStorage();
      // This is an old, already-frozen operation from before label normalization was introduced.
      const operation = prepareReviewWrite(project, 'manual-evidence', 'evidence', fields, 'Old manual request');
      const bodies: string[] = [];
      const interrupted = new StageAApi(f.headers.authorization.slice(7), async (path, options) => {
        bodies.push(String(options?.body)); await transport(path, options); throw new Error('Synthetic lost success');
      });
      assert.equal((await executeMaterialOperation(operation, interrupted, storage, () => undefined)).kind, 'uncertain');
      assert.ok(storage.pending);
      let latest = await client.get(project.id), visible = latest, calls = 0;
      function findAction(node: ReactNode, label: string): ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }> | undefined {
        if (Array.isArray(node)) { for (const child of node) { const found = findAction(child, label); if (found) return found; } return; }
        if (!isValidElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>(node)) return;
        return node.props.children === label ? node : findAction(node.props.children, label);
      }
      let action = '保存文字证据', expectedDisabled = true, permitted = false;
      function Inspect() {
        const once = useRef(false);
        const session = { ...useProjectSession(), project: visible, getLatestProject: () => latest, canWrite: permitted,
          reviewWrite: () => { calls++; return Promise.resolve({ kind: 'blocked' as const }); } };
        const tree = ManualEvidenceFields({ session, surface }) as ReactNode;
        if (!once.current) { once.current = true; const button = findAction(tree, action); assert.ok(button?.props.onClick); assert.equal(button.props.disabled, expectedDisabled); button.props.onClick(); }
        return tree;
      }
      const beforeReplay = renderToStaticMarkup(createElement(Inspect));
      assert.match(beforeReplay, /这份文字证据已保存/); assert.deepEqual(values, beforeDrafts); assert.ok(storage.pending);
      const recovering = new StageAApi(f.headers.authorization.slice(7), async (path, options) => { bodies.push(String(options?.body)); return transport(path, options); });
      const restored = (await storage.readPending())!;
      const replay = await executeMaterialOperation(restored, recovering, storage, next => { latest = next; visible = next; }, true);
      assert.equal(replay.kind, 'saved'); assert.equal(storage.pending, undefined);
      assert.deepEqual(bodies, [operation.prepared.body, operation.prepared.body]);
      assert.equal(JSON.parse(bodies[1]!).documentName, fields.documentName, 'the frozen old body was not normalized during recovery');
      assert.deepEqual(values, beforeDrafts, 'no serialized onSaved callback or cross-surface automatic clearing');
      permitted = true;
      assert.match(renderToStaticMarkup(createElement(Inspect)), /这份文字证据已保存/); assert.equal(calls, 0);
      // A pre-GET callback must also refuse another write when only the latest ref has the receipt.
      visible = project; expectedDisabled = false;
      renderToStaticMarkup(createElement(Inspect)); assert.equal(calls, 0);
      visible = latest; action = '清空这份已保存草稿';
      renderToStaticMarkup(createElement(Inspect));
      for (const name of ['documentName', 'locator', 'evidenceText']) {
        assert.equal(JSON.parse(values.get(draftKey(project.id, field(surface, name)))!), '');
        assert.equal(values.get(draftKey(project.id, field(otherSurface, name))), beforeDrafts.get(draftKey(project.id, field(otherSurface, name))));
      }
      assert.equal((await client.get(project.id)).evidence.length, 1);
    });
    await withStorage(async values => {
      let derived = await parsed(f); const material = derived.production!.materials![0]!;
      derived = await f.write(derived, `production/materials/${material.id}/usage`, { reason: 'Synthetic product source', decisions: [{ blockId: material.blocks[0]!.id, usage: 'product_evidence' }] });
      const source = derived.evidence[0]!; assert.ok(source.materialSource);
      for (const [name, value] of Object.entries({ documentName: source.documentName, locator: source.locator, evidenceText: source.text })) values.set(draftKey(derived.id, name), JSON.stringify(value));
      function View() { return createElement(ManualEvidenceFields, { session: { ...useProjectSession(), project: derived, getLatestProject: () => derived, canWrite: true } }); }
      const html = renderToStaticMarkup(createElement(View));
      assert.doesNotMatch(html, /这份文字证据已保存/); assert.doesNotMatch(html, /disabled=""[^>]*>保存文字证据/);
    });
  } finally { await f.close(); }
});

test('real HTTP review client: precise block decisions, pre-submit impact, all four task types and locked source reconfirmation', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const client = new StageAApi(f.headers.authorization.slice(7), (path, options) => fetch(`${url}${path}`, options));
    let project = await parsed(f);
    const storage = new ReviewStorage();
    const write = async (kind: ReviewKind, path: string, fields: Record<string, unknown>) => {
      const operation = prepareReviewWrite(project, kind, path, fields, 'Synthetic review saved');
      const outcome = await executeMaterialOperation(operation, client, storage, next => { project = next; });
      assert.equal(outcome.kind, 'saved'); assert.equal(storage.pending, undefined);
    };
    const material = project.production!.materials![0]!;
    const [capacity, steel, unreviewed, reference] = material.blocks;
    const originalBlocks = structuredClone(material.blocks);
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#335599' } }).png().toBuffer();
    project = await client.write(project, 'production/materials', { fileName: 'synthetic-image.png', mimeType: 'image/png', source: { kind: 'local_upload' }, contentBase64: image.toString('base64') });
    await new IngestionWorker(f.store, f.objects).tick(); project = await client.get(project.id);
    const draft: UsageDraft = { reason: 'Explicit row-level decisions', choices: { [capacity!.id]: 'product_evidence', [steel!.id]: 'product_evidence', [reference!.id]: 'reference' } };
    assert.equal(usageDraftValid(material, draft), true);
    assert.deepEqual(usageDecisions(material, draft).map(item => item.blockId), [capacity!.id, steel!.id, reference!.id]);
    await write('material-usage', `production/materials/${material.id}/usage`, { reason: draft.reason, decisions: usageDecisions(material, draft) });
    assert.deepEqual(project.production!.materials![0]!.blocks, originalBlocks);
    assert.equal(project.evidence.length, 2); assert.equal(project.production!.references!.length, 1);
    assert.ok(!project.production!.materials![0]!.usageReview!.current[unreviewed!.id]);
    assert.equal(project.facts.length, 0, 'purpose decisions must never approve or create product facts');
    const capacityEvidence = project.evidence.find(evidence => evidence.materialSource!.blockId === capacity!.id)!;
    const steelEvidence = project.evidence.find(evidence => evidence.materialSource!.blockId === steel!.id)!;
    await write('fact-candidate', 'facts/candidates', { ...emptyFactCandidate, attribute: 'capacity', value: '10 kg', evidenceId: capacityEvidence.id, quote: '10 kg', reason: 'Synthetic source checked' });
    const lockedId = project.facts[0]!.id;
    await write('fact-confirm', `facts/${lockedId}/confirm`, { reason: 'Explicitly confirm this synthetic fact' });
    const originalLocked = structuredClone(project.facts[0]!);
    await write('fact-candidate', 'facts/candidates', { ...emptyFactCandidate, attribute: 'capacity note', value: '10 kg', evidenceId: capacityEvidence.id, quote: '10 kg', reason: 'Keep a pending candidate to test withdrawal' });
    const invalidatedId = project.facts.at(-1)!.id;
    await write('fact-candidate', 'facts/candidates', { ...emptyFactCandidate, attribute: 'material', value: 'steel', evidenceId: steelEvidence.id, quote: 'steel', reason: 'Keep a separate current candidate' });
    project = await client.write(project, 'storyboard/draft', { chapters: plan(project).chapters, reason: 'Synthetic dependent draft' });
    project = await client.write(project, 'runs', { skill: 'plan-section' });
    await new Worker(f.store, { generate: async (_skill, p) => plan(p) }).tick(); project = await client.get(project.id);
    const current = project.production!.materials![0]!;
    const correction: UsageDraft = { reason: 'This block was reference content', choices: { [capacity!.id]: 'reference' } };
    const predicted = usageChangeImpact(project, current, correction);
    assert.deepEqual(predicted.affectedCandidateIds, [invalidatedId]);
    assert.deepEqual(predicted.reconfirmationRequiredFactIds, [lockedId]);
    assert.ok(predicted.affectedSectionIds.length > 0); assert.ok(predicted.affectedStoryboardIds.length > 0);
    await withStorage(async values => {
      values.set(draftKey(project.id, `materialUsage:${material.id}:reviewed`), JSON.stringify({ value: correction, base: usageDraftBase(project, material.id, correction), active: true }));
      const { UsageInspector } = await ui('MaterialReviewInspectors');
      const center = await client.materialReviews(project.id);
      function Preview() {
        const session = { ...useProjectSession(), project, getLatestProject: () => project, token: 'synthetic', canWrite: true };
        return createElement(UsageInspector, { material: current, session, reviews: currentReviews(center), onFact: () => undefined });
      }
      const html = renderToStaticMarkup(createElement(Preview));
      assert.match(html, /提交后将产生的影响/); assert.match(html, /已锁事实将保留值并等待来源重确认/);
      assert.match(html, /原候选将失效/); assert.match(html, /capacity note：10 kg/);
      assert.match(html, /将撤回.*?1.*?条旧产品证据/s);
    });
    await write('material-usage', `production/materials/${material.id}/usage`, { reason: correction.reason, decisions: usageDecisions(current, correction) });
    assert.deepEqual(project.production!.materials![0]!.usageReview!.history.at(-1)!.impact, predicted, 'preview is checked against the independently computed server receipt');
    assert.equal(project.facts.find(fact => fact.id === invalidatedId)!.sourceReview!.status, 'invalidated');
    assert.equal(evidenceAvailable(project, project.evidence.find(evidence => evidence.id === capacityEvidence.id)!), false);
    const blocked = (await client.materialReviews(project.id)).tasks.find(task => task.type === 'fact_source_reconfirmation')!;
    assert.equal(blocked.status, 'blocked');
    await write('material-usage', `production/materials/${material.id}/usage`, { reason: 'Restore the same block as product evidence after checking', decisions: [{ blockId: capacity!.id, usage: 'product_evidence' }] });
    const center = await client.materialReviews(project.id);
    assert.equal(reviewCenterMatches(project, center), true);
    for (const type of reviewTypes) assert.ok(center.tasks.some(task => task.type === type), `real ${type} tasks are present`);
    const task = center.tasks.find(task => task.type === 'fact_source_reconfirmation')!;
    assert.equal(task.type, 'fact_source_reconfirmation');
    const replacement = reconfirmEvidence(project, task)!;
    assert.ok(replacement); assert.notEqual(replacement.id, capacityEvidence.id);
    assert.equal(replacement.materialSource!.blockId, capacity!.id);
    await withStorage(async () => {
      const { MaterialFactsContent } = await ui('MaterialFactsStage');
      function View() {
        const session = { ...useProjectSession(), project, getLatestProject: () => project, token: 'synthetic', canWrite: true };
        return createElement(MaterialFactsContent, { session, intake: useMaterialIntake(session), reviews: currentReviews(center), onStage: () => undefined });
      }
      const html = renderToStaticMarkup(createElement(View));
      assert.match(html, /用途待审核 <b>2<\/b>/); assert.match(html, /待提取候选 <b>1<\/b>/);
      assert.match(html, /事实待确认 <b>1<\/b>/); assert.match(html, /来源待重确认 <b>1<\/b>/);
      assert.match(html, /review-source.txt/); assert.doesNotMatch(html, /一键确认/);
      const { UsageInspector } = await ui('MaterialReviewInspectors');
      function ImageView() {
        const session = { ...useProjectSession(), project, getLatestProject: () => project, token: 'synthetic', canWrite: true };
        return createElement(UsageInspector, { material: project.production!.materials![1]!, session, reviews: currentReviews(center), onFact: () => undefined });
      }
      const imageHtml = renderToStaticMarkup(createElement(ImageView));
      assert.match(imageHtml, /<option value="asset">/); assert.match(imageHtml, /<option value="reference">/);
      assert.doesNotMatch(imageHtml, /<option value="product_evidence">/);
    });
    await write('source-reconfirm', `facts/${lockedId}/source/reconfirm`, { reason: 'Compare same original block and unchanged quote', evidenceId: replacement.id });
    const after = project.facts.find(fact => fact.id === lockedId)!;
    for (const key of ['value', 'attribute', 'role', 'locked', 'confirmedAt', 'confirmedBy'] as const) assert.equal(after[key], originalLocked[key]);
    assert.equal(after.evidenceId, replacement.id); assert.equal(after.sourceReview, undefined);
    assert.equal(after.sourceReconfirmations!.length, 1); assert.equal(after.sourceReconfirmations![0]!.previousEvidenceId, capacityEvidence.id);
    assert.equal(project.facts.find(fact => fact.id === invalidatedId)!.sourceReview!.status, 'invalidated');
    assert.ok(project.sections.some(section => section.freshness === 'stale')); assert.equal(project.storyboard!.freshness, 'stale');
    assert.deepEqual(project.production!.materials![0]!.blocks, originalBlocks);
  } finally { await f.close(); }
});

test('review reads authenticate only in headers, reject malformed lists, and cannot match old projects or revisions', async () => {
  const center: MaterialReviewCenter = { projectId: 'synthetic-project', projectVersion: 2, revision: 8, tasks: [] };
  let calls = 0;
  const client = new StageAApi('synthetic-secret', async (path, options) => {
    calls++; assert.equal(path, '/api/projects/synthetic-project/production/material-reviews');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer synthetic-secret');
    assert.equal(options?.body, undefined); assert.equal(options?.redirect, 'error');
    return Response.json(center);
  });
  assert.deepEqual(await client.materialReviews(center.projectId), center); assert.equal(calls, 1);
  assert.equal(reviewCenterMatches({ id: center.projectId, version: 2, revision: 9 } as Project, center), false);
  assert.equal(reviewCenterMatches({ id: 'other-project', version: 2, revision: 8 } as Project, center), false);
  assert.equal(reviewCenterMatches({ id: center.projectId, version: 3, revision: 8 } as Project, center), false);
  assert.equal(isMaterialReviewCenter({ ...center, tasks: [{ id: 'bad', type: 'fact_source_reconfirmation', status: 'ready' }] }), false);
  for (const invalid of [null, { ...center, projectId: 'other-project' }, { ...center, tasks: [{ id: 'unknown', type: 'auto_approval' }] }])
    await assert.rejects(new StageAApi('synthetic', async () => Response.json(invalid)).materialReviews(center.projectId), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_MATERIAL_REVIEWS');
  await assert.rejects(new StageAApi('expired', async () => new Response('', { status: 401 })).materialReviews(center.projectId), (error: unknown) => error instanceof ApiError && error.status === 401);
});

test('every durable review kind has a bounded route; source fields, model runs, entry ids and parser rebase budgets cannot enter review recovery', async () => {
  const f = await fixture();
  try {
    const project = await parsed(f); const id = crypto.randomUUID();
    const targets: [ReviewKind, string][] = [['material-usage', `production/materials/${id}/usage`], ['source-reconfirm', `facts/${id}/source/reconfirm`], ['manual-evidence', 'evidence'], ['fact-candidate', 'facts/candidates'], ['fact-confirm', `facts/${id}/confirm`], ['fact-reject', `facts/${id}/reject`], ['fact-retract', `facts/${id}/retract`]];
    for (const [kind, path] of targets) {
      const operation = prepareReviewWrite(project, kind, path, {}, 'Synthetic request');
      assert.equal(validateMaterialOperation(structuredClone(operation)).prepared.body, operation.prepared.body);
      assert.throws(() => validateMaterialOperation({ ...operation, entryId: id }));
      assert.throws(() => validateMaterialOperation({ ...operation, parseProgressRebases: 0 }));
      assert.throws(() => prepareReviewWrite(project, kind, 'runs', {}, 'Outside review scope'));
    }
    assert.throws(() => prepareReviewWrite(project, 'manual-evidence', 'evidence', { materialSource: {}, token: 'must not persist' }, 'Invalid fields'));
    const original = prepareReviewWrite(project, 'fact-confirm', `facts/${id}/confirm`, { reason: 'Frozen reason' }, 'Saved');
    project.revision++;
    assert.equal(JSON.parse(original.prepared.body).expectedRevision, original.before.revision);
    assert.equal(JSON.parse(original.prepared.body).reason, 'Frozen reason');
  } finally { await f.close(); }
});

test('lost review responses and 401 retain the complete body and key across explicit recovery, without an automatic second POST', async t => {
  for (const fault of ['lost-response', '401', 'settlement'] as const) await t.test(fault, async () => {
    const f = await fixture();
    try {
      const url = await f.app.listen({ port: 0, host: '127.0.0.1' }); let project = await parsed(f);
      const material = project.production!.materials![0]!; const storage = new ReviewStorage(); storage.failSettle = fault === 'settlement';
      const operation = prepareReviewWrite(project, 'material-usage', `production/materials/${material.id}/usage`, { reason: 'Recover the same explicit decision', decisions: [{ blockId: material.blocks[0]!.id, usage: 'product_evidence' }] }, 'Synthetic saved');
      const requests: string[] = [];
      const first = new StageAApi(fault === '401' ? 'wrong' : f.headers.authorization.slice(7), async (path, options) => {
        if (options?.method === 'POST') requests.push(String(options.body));
        const response = await fetch(`${url}${path}`, options);
        if (fault === 'lost-response') { assert.equal(response.status, 200); await response.text(); throw new Error('Drop accepted response'); }
        return response;
      });
      const uncertain = await executeMaterialOperation(operation, first, storage, next => { project = next; });
      assert.equal(uncertain.kind, 'uncertain'); assert.equal(requests.length, 1);
      const restored = await storage.readPending(); assert.ok(restored); assert.equal(restored.prepared.body, operation.prepared.body);
      assert.ok(!JSON.stringify(restored).includes(f.headers.authorization.slice(7)), 'credentials are not persisted');
      const valid = new StageAApi(f.headers.authorization.slice(7), async (path, options) => { if (options?.method === 'POST') requests.push(String(options.body)); return fetch(`${url}${path}`, options); });
      project = await valid.get(project.id); assert.equal(requests.length, 1, 'checking recovery does not submit');
      storage.failSettle = false;
      const saved = await executeMaterialOperation(restored, valid, storage, next => { project = next; }, true);
      assert.equal(saved.kind, 'saved'); assert.deepEqual(requests, [operation.prepared.body, operation.prepared.body]);
      assert.equal(project.production!.materials![0]!.usageReview!.history.length, 1);
      assert.equal(project.evidence.length, 1); assert.equal(storage.pending, undefined);
    } finally { await f.close(); }
  });
});

test('review storage failure sends nothing and every 409 is returned for manual review without a parser rebase GET', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' }); const project = await parsed(f); const material = project.production!.materials![0]!;
    const requests: string[] = []; const client = new StageAApi(f.headers.authorization.slice(7), async (path, options) => { requests.push(String(path)); return fetch(`${url}${path}`, options); });
    const storage = new ReviewStorage(); storage.failSave = true;
    const valid = prepareReviewWrite(project, 'material-usage', `production/materials/${material.id}/usage`, { reason: 'Synthetic', decisions: [{ blockId: material.blocks[0]!.id, usage: 'reference' }] }, 'Saved');
    assert.equal((await executeMaterialOperation(valid, client, storage, () => undefined)).kind, 'storage'); assert.equal(requests.length, 0);
    storage.failSave = false;
    const invalid = prepareReviewWrite(project, 'material-usage', `production/materials/${material.id}/usage`, { reason: 'Text is not a decoded image', decisions: [{ blockId: material.blocks[0]!.id, usage: 'asset' }] }, 'Saved');
    const domain = await executeMaterialOperation(invalid, client, storage, () => undefined);
    assert.equal(domain.kind, 'conflict'); assert.equal(requests.length, 1); assert.equal(storage.pending, undefined);
    await f.write(project, 'production/materials', { fileName: 'new.txt', mimeType: 'text/plain', contentBase64: Buffer.from('Second original').toString('base64'), source: { kind: 'local_upload' } });
    const revision = await executeMaterialOperation(valid, client, storage, () => undefined);
    assert.equal(revision.kind, 'conflict'); assert.equal(requests.length, 2); assert.ok(requests.every(path => path.endsWith('/usage')));
    assert.equal(storage.pending, undefined);
  } finally { await f.close(); }
});

function renderDraft<T, B>(project: Project, field: string, fallback: T, base: (project: Project | null, value: T) => B, update?: (draft: ReturnType<typeof useReviewDraft<T, B>>) => void) {
  let result: ReturnType<typeof useReviewDraft<T, B>> | undefined;
  function Probe() {
    const once = useRef(false);
    const draft = useReviewDraft({ project, getLatestProject: () => project }, field, fallback, base); result = draft;
    if (update && !once.current) { once.current = true; update(draft); }
    return null;
  }
  renderToStaticMarkup(createElement(Probe)); assert.ok(result); return result;
}
test('the actual Facts component safely renders disconnected and reloaded-before-GET screens without issuing requests', async () => {
  await withStorage(async values => {
    const { FactsStage } = await ui('MaterialFactsStage');
    for (const savedId of ['', crypto.randomUUID()]) {
      values.set('tujiang_stage_a_project_id', savedId); let reads = 0;
      function View() {
        const session = useProjectSession();
        const readMaterialReviews = async () => { reads++; return { projectId: savedId, projectVersion: 0, revision: 0, tasks: [] }; };
        return createElement(FactsStage, { session: { ...session, readMaterialReviews }, intake: useMaterialIntake(session), onStage: () => undefined });
      }
      const html = renderToStaticMarkup(createElement(View));
      assert.match(html, /待处理数量尚未校准/); assert.match(html, /人工独立补充文字证据/); assert.equal(reads, 0);
    }
  });
});
test('usage and candidate drafts remain isolated by project and material, keep external source changes gated, and ignore JSONB key ordering', async () => {
  const f = await fixture();
  try {
    let project = await parsed(f); const material = project.production!.materials![0]!; const field = `materialUsage:${material.id}`;
    const base = (p: Project | null, value: UsageDraft) => usageDraftBase(p, material.id, value);
    await withStorage(async () => {
      renderDraft(project, field, emptyUsageDraft, base, draft => draft.update({ reason: 'Local reason', choices: {} }));
      const chosen = renderDraft(project, field, emptyUsageDraft, base, draft => draft.update({ ...draft.value, choices: { [material.blocks[0]!.id]: 'product_evidence' } }));
      assert.equal(chosen.needsReview, false, 'explicitly choosing a source does not look like an external change');
      const read = await f.store.get(project.id);
      assert.equal(renderDraft(read, field, emptyUsageDraft, base).needsReview, false);
      assert.deepEqual(renderDraft({ ...project, id: crypto.randomUUID() }, field, emptyUsageDraft, base).value, emptyUsageDraft);
      assert.deepEqual(renderDraft(project, 'materialUsage:other-material', emptyUsageDraft, base).value, emptyUsageDraft);
      project = await f.write(project, `production/materials/${material.id}/usage`, { reason: 'Another editor selected reference', decisions: [{ blockId: material.blocks[0]!.id, usage: 'reference' }] });
      const continued = renderDraft(project, field, emptyUsageDraft, base, draft => draft.update({ ...draft.value, reason: 'Continued local reason' }));
      assert.equal(continued.needsReview, true); assert.equal(continued.value.choices[material.blocks[0]!.id], 'product_evidence');
      assert.equal(continued.currentForSave(), false);
      const reviewed = renderDraft(project, field, emptyUsageDraft, base, draft => draft.acknowledge()); assert.equal(reviewed.needsReview, false);
      project = await f.write(project, `production/materials/${material.id}/usage`, { reason: 'Restore product source', decisions: [{ blockId: material.blocks[0]!.id, usage: 'product_evidence' }] });
      const evidence = project.evidence[0]!;
      renderDraft(project, 'factCandidate:extract:test', emptyFactCandidate, candidateDraftBase, draft => draft.update({ ...emptyFactCandidate, attribute: 'capacity', value: '10 kg', reason: 'Candidate source checked' }));
      const candidate = renderDraft(project, 'factCandidate:extract:test', emptyFactCandidate, candidateDraftBase, draft => draft.update({ ...draft.value, evidenceId: evidence.id, quote: '10 kg' }));
      assert.equal(candidate.needsReview, false); assert.equal(candidateValid(project, candidate.value), true);
      project = await f.write(project, `production/materials/${material.id}/usage`, { reason: 'Withdraw source again', decisions: [{ blockId: material.blocks[0]!.id, usage: 'reference' }] });
      const stale = renderDraft(project, 'factCandidate:extract:test', emptyFactCandidate, candidateDraftBase);
      assert.equal(stale.needsReview, true); assert.equal(candidateValid(project, stale.value), false); assert.equal(stale.value.value, '10 kg');
    });
  } finally { await f.close(); }
});

test('the actual review draft callback sees a newer same-batch receipt before clearing input, and stale center handlers cannot submit', async () => {
  const f = await fixture();
  try {
    const project = await parsed(f); const material = project.production!.materials![0]!;
    const saved = await f.write(project, `production/materials/${material.id}/usage`, { reason: 'Local saved reason', decisions: [{ blockId: material.blocks[0]!.id, usage: 'product_evidence' }] });
    const external = await f.write(saved, `production/materials/${material.id}/usage`, { reason: 'Newer external reference', decisions: [{ blockId: material.blocks[0]!.id, usage: 'reference' }] });
    await withStorage(() => {
      let result: ReturnType<typeof useReviewDraft<UsageDraft, ReturnType<typeof usageDraftBase>>> | undefined;
      function Probe() {
        const [step, setStep] = useState(0); const snapshot = useProjectSnapshot(project);
        const draft = useReviewDraft(snapshot, 'same-batch-usage', emptyUsageDraft, (p, value) => usageDraftBase(p, material.id, value)); result = draft;
        if (step === 0) { draft.update({ reason: 'Local saved reason', choices: { [material.blocks[0]!.id]: 'product_evidence' } }); setStep(1); }
        else if (step === 1) { snapshot.receiveSnapshot(external, project.id); snapshot.receiveSnapshot(saved, project.id); draft.afterSave(saved); setStep(2); }
        return null;
      }
      renderToStaticMarkup(createElement(Probe)); assert.ok(result); assert.equal(result.active, true); assert.equal(result.needsReview, true); assert.equal(result.value.reason, 'Local saved reason');
    });
    await withStorage(async values => {
      const form: UsageDraft = { reason: 'Filled local choice', choices: { [material.blocks[0]!.id]: 'product_evidence' } };
      values.set(draftKey(project.id, `materialUsage:${material.id}:reviewed`), JSON.stringify({ value: form, base: usageDraftBase(project, material.id, form), active: true }));
      const { UsageInspector } = await ui('MaterialReviewInspectors');
      let calls = 0;
      function findButton(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void }> | undefined {
        if (Array.isArray(node)) { for (const child of node) { const found = findButton(child); if (found) return found; } return; }
        if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
        if (node.props.children === '保存所选资料块用途') return node;
        return findButton(node.props.children);
      }
      function Invoke() {
        const once = useRef(false);
        const session = { ...useProjectSession(), project, getLatestProject: () => project, canWrite: true };
        const reviews = { ...currentReviews({ projectId: project.id, projectVersion: project.version, revision: project.revision, tasks: [] }), isCurrent: () => false };
        const tree = UsageInspector({ material, session: { ...session, reviewWrite: () => { calls++; return Promise.resolve({ kind: 'blocked' }); } }, reviews, onFact: () => undefined }) as ReactNode;
        if (!once.current) { once.current = true; const button = findButton(tree); assert.ok(button?.props.onClick); button.props.onClick(); }
        return tree;
      }
      const html = renderToStaticMarkup(createElement(Invoke)); assert.match(html, /提交后将产生的影响/); assert.equal(calls, 0);
    });
  } finally { await f.close(); }
});
