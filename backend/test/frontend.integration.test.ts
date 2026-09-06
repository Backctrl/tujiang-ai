import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, extraction, plan } from './helpers.js';
import { Worker } from '../src/worker.js';
import { ApiError, StageAApi } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';

test('browser API client over real HTTP: setup, facts, draft, conflict, candidate apply and stale dependencies', async () => {
  const f = await fixture();
  const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
  const request: typeof fetch = (path, options) => fetch(`${url}${path}`, options);
  const client = new StageAApi(f.headers.authorization.slice(7), request);
  const worker = new Worker(f.store, { generate: async (skill, project) => skill === 'extract-facts' ? extraction(project) : plan(project) });
  try {
    await assert.rejects(new StageAApi('wrong', request).create('denied'), (e: unknown) => e instanceof ApiError && e.status === 401);
    let p = await client.create('Synthetic frontend project');
    p = await client.write(p, 'identity/confirm', { productName: '测试支架' });
    p = await client.write(p, 'evidence', { documentName: 'spec.txt', locator: 'line 1', text: 'Capacity: 10 kg. Alternate: 20 kg.', usage: 'product_evidence' });
    p = await client.write(p, 'runs', { skill: 'extract-facts' });
    await worker.tick(); p = await client.get(p.id);
    assert.equal(p.facts[0]?.status, 'candidate');
    const before = p;
    p = await client.write(p, `facts/${p.facts[0]!.id}/confirm`, { reason: 'synthetic evidence checked' });
    await assert.rejects(client.write(before, 'qa/preflight'), (e: unknown) => e instanceof ApiError && e.code === 'VERSION_CONFLICT');
    assert.deepEqual(await client.get(p.id), p, 'reload reflects server snapshot');
    p = await client.write(p, 'storyboard/draft', { chapters: plan(p).chapters, reason: 'manual sequence' });
    assert.equal(p.currentSectionId, null);
    const manualId = p.storyboard?.id;
    p = await client.write(p, 'runs', { skill: 'plan-section' });
    await worker.tick(); p = await client.get(p.id);
    assert.equal(p.storyboard?.id, manualId, 'candidate does not overwrite employee sequence');
    assert.equal(p.currentSectionId, null, 'new candidate is not silently selected');
    p = await client.write(p, `storyboard/candidates/${p.storyboardCandidates!.at(-1)!.id}/apply`, { reason: 'compared candidate with manual draft' });
    assert.ok(p.currentSectionId);
    p = await client.write(p, 'qa/preflight');
    assert.equal(p.qa?.exportAllowed, false);
    const idempotencyKey = crypto.randomUUID();
    const replayInput = p;
    const corrected = { productName: '测试支架文字纠正', reason: 'same product' };
    p = await client.write(p, 'identity/correct', corrected, idempotencyKey);
    assert.deepEqual(await client.write(replayInput, 'identity/correct', corrected, idempotencyKey), p);
    assert.equal(p.storyboard?.freshness, 'stale');
    p = await client.write(p, 'facts/candidates', { attribute: 'capacity', role: 'core', value: '20 kg', evidenceId: p.evidence[0]!.id, quote: '20 kg', correctsFactId: p.facts[0]!.id, reason: 'alternative quote for review' });
    assert.equal(p.facts[0]?.value, '10 kg', 'locked original remains unchanged');
    assert.equal(p.facts[1]?.status, 'candidate');
    p = await client.write(p, `facts/${p.facts[1]!.id}/reject`, { reason: 'retain original' });
    p = await client.write(p, `facts/${p.facts[0]!.id}/retract`, { reason: 'explicit withdrawal' });
    assert.equal(p.facts[0]?.status, 'retracted');
    assert.equal(p.sections.find(s => s.id === p.currentSectionId)?.freshness, 'stale');
  } finally { await f.close(); }
});

test('client never retries a failed transport or follows redirects, and replays only on explicit request', async () => {
  let calls = 0;
  const client = new StageAApi('synthetic', async (_url, options) => {
    calls++; assert.equal(options?.redirect, 'error'); throw new Error('connection interrupted');
  });
  await assert.rejects(client.create('test'), (e: unknown) => e instanceof ApiError && e.code === 'CONNECTION_UNCERTAIN');
  assert.equal(calls, 1);
});

