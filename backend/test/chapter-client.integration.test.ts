import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, extraction, plan } from './helpers.js';
import { Worker } from '../src/worker.js';
import { ApiError, StageAApi } from '../../src/pages/ArcaneWarriorPage/stage-a-api.js';

test('chapter client over HTTP preserves drafts, explicitly selects history and rejects stale writes and revoked facts', async () => {
  const f = await fixture();
  try {
    const url = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const request: typeof fetch = (path, options) => fetch(`${url}${path}`, options);
    const client = new StageAApi(f.headers.authorization.slice(7), request);
    const worker = new Worker(f.store, {
      generate: async (skill, project) => skill === 'extract-facts' ? extraction(project) : plan(project),
    });
    let p = await client.create('诊断章节客户端验收');
    p = await client.write(p, 'identity/confirm', { productName: '测试支架' });
    p = await client.write(p, 'evidence', {
      documentName: 'spec.txt', locator: 'line 1', text: 'Capacity: 10 kg.', usage: 'product_evidence',
    });
    p = await client.write(p, 'runs', { skill: 'extract-facts' });
    await worker.tick();
    p = await client.get(p.id);
    const factId = p.facts[0]!.id;
    p = await client.write(p, `facts/${factId}/confirm`, { reason: '已逐条核对合成证据' });
    p = await client.write(p, 'runs', { skill: 'plan-section' });
    await worker.tick();
    p = await client.get(p.id);

    const original = structuredClone(p.sections.find(s => s.id === p.currentSectionId)!);
    assert.ok(original, 'first planning run initializes a selected diagnostic draft');
    const beforeEdit = structuredClone(p);
    const edit = {
      purpose: '说明已核验承重参数及待补充信息', factIds: [factId],
      missingInputs: ['待人工补充使用范围说明'], reason: '按当前事实调整诊断目的',
    };
    p = await client.write(p, `sections/${original.id}/draft`, edit);
    const edited = p.sections.find(s => s.id === p.currentSectionId)!;
    assert.notEqual(edited.id, original.id);
    assert.equal(edited.replacesSectionId, original.id);
    assert.equal(edited.storyboardId, p.storyboard?.id);
    assert.equal(edited.kind, 'diagnostic_draft');
    assert.equal(edited.approvalStatus, 'draft');
    assert.equal(edited.purpose, edit.purpose);
    assert.deepEqual(edited.factIds, edit.factIds);
    assert.deepEqual(edited.missingInputs, edit.missingInputs);
    assert.equal(edited.editedBy, 'test-human');
    assert.equal(edited.reason, edit.reason);
    assert.equal(p.version, beforeEdit.version, 'draft save is not a business approval');
    assert.equal(p.sections.length, beforeEdit.sections.length + 1);
    assert.deepEqual(p.sections.find(s => s.id === original.id), original, 'old draft is not overwritten');
    assert.deepEqual(await client.get(p.id), p, 'saved selection survives a fresh HTTP read');
    assert.deepEqual(
      await client.send(`/projects/${p.id}/revisions/${beforeEdit.revision}`), beforeEdit,
      'editing does not rewrite the historical project revision',
    );

    await assert.rejects(
      client.write(beforeEdit, `sections/${original.id}/draft`, { ...edit, purpose: '迟到的旧表单' }),
      (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'REVISION_CONFLICT',
    );
    assert.deepEqual(await client.get(p.id), p, 'rejected stale write neither creates a draft nor changes selection');
    await assert.rejects(
      client.write(p, `sections/${edited.id}/draft`, { ...edit, approvalStatus: 'approved' }),
      (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === 'INVALID_REQUEST',
    );

    p = await client.write(p, 'qa/preflight');
    assert.ok(p.qa?.issues.includes(`MISSING_INPUTS:${edited.id}`));
    assert.equal(p.qa?.exportAllowed, false);
    p = await client.write(p, `sections/${original.id}/select`, { reason: '对照后明确选回无缺口原稿' });
    assert.equal(p.currentSectionId, original.id);
    assert.deepEqual(p.sections.find(s => s.id === edited.id), edited, 'selecting history preserves the later draft');
    assert.ok(p.audit.some(a => a.type === 'section.selected' && a.data.sectionId === original.id));
    p = await client.write(p, 'qa/preflight');
    assert.equal(p.qa?.sectionId, original.id);
    assert.equal(p.qa?.issueSeverity, 'none');
    assert.equal(p.qa?.exportAllowed, false, 'even a passing diagnostic preflight cannot export');
    assert.ok(p.qa?.notChecked.includes('formal_approval'));
    assert.ok(p.qa?.notChecked.includes('rendered_file'));

    p = await client.write(p, `facts/${factId}/retract`, { reason: '人工撤回当前引用事实' });
    assert.equal(p.sections.find(s => s.id === original.id)?.freshness, 'stale');
    assert.equal(p.sections.find(s => s.id === edited.id)?.freshness, 'stale');
    await assert.rejects(
      client.write(p, `sections/${edited.id}/select`, { reason: '验证历史选择不能绕过事实撤回' }),
      (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'CONFIRMED_CORE_FACT_REQUIRED',
    );
    // The core-fact gate runs before freshness validation; withdrawing the only core fact blocks selection here.
    assert.deepEqual(await client.get(p.id), p, 'rejected history selection leaves the snapshot unchanged');
    p = await client.write(p, 'qa/preflight');
    assert.equal(p.qa?.issueSeverity, 'blocker');
    assert.ok(p.qa?.issues.includes(`STALE_SECTION:${original.id}`));
    assert.equal(p.qa?.exportAllowed, false);
    assert.ok(p.sections.every(s => s.approvalStatus === 'draft'));
  } finally {
    await f.close();
  }
});
