import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluate, recordedRunSchema } from '../evaluation/evaluate.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(readFileSync(join(root, 'evaluation/fixtures/synthetic-extraction.json'), 'utf8'));
const output = JSON.parse(readFileSync(join(root, 'evaluation/fixtures/synthetic-extraction-output.json'), 'utf8'));

test('offline extraction preserves conflicts and never declares semantic acceptance', () => {
  const report = evaluate(fixture, output);
  assert.equal(report.automaticChecksPassed, true);
  assert.equal(report.verdict, 'needs_human_review');
  assert.equal(report.businessAcceptance, false);
  assert.ok(report.humanReviewRequired.includes('quote_entails_claim'));
});
test('offline extraction rejects malformed structure, false quotes, omissions and extra claims', () => {
  assert.ok(evaluate(fixture, { ...output, approved: true }).failures.includes('INVALID_MODEL_OUTPUT'));
  const changed = structuredClone(output);
  changed.facts[0].quote = '不存在的文字';
  assert.ok(evaluate(fixture, changed).failures.includes('INVALID_EVIDENCE_REFERENCE'));
  const omitted = evaluate(fixture, { facts: [output.facts[0]] });
  assert.ok(omitted.failures.includes('EXPECTED_FACT_MISSING:1'));
  assert.ok(omitted.failures.includes('CONFLICT_NOT_PRESERVED:0'));
  changed.facts[0] = { ...output.facts[0], value: '999 ml' };
  assert.ok(evaluate(fixture, changed).failures.includes('UNEXPECTED_CLAIM:0'));
});
test('planning reuses domain gates and rejects unconfirmed references and approval fields', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const planFixture = { ...fixture, skill: 'plan-section', productName: 'Synthetic bottle', expectedFacts: [], expectedConflictAttributes: [],
    facts: [{ ...output.facts[0], id, status: 'confirmed' }] };
  const plan = { chapters: [{ role: 'feature', purpose: '说明容量', factIds: [id] }], section: { purpose: '验证容量信息', factIds: [id], missingInputs: ['产品图片'] } };
  assert.equal(evaluate(planFixture, plan).automaticChecksPassed, true);
  assert.ok(evaluate(planFixture, { ...plan, section: { ...plan.section, approvalStatus: 'approved' } }).failures.includes('INVALID_MODEL_OUTPUT'));
  const candidateId = '33333333-3333-4333-8333-333333333333';
  const mixed = { ...planFixture, facts: [...planFixture.facts, { ...planFixture.facts[0], id: candidateId, status: 'candidate' }] };
  assert.ok(evaluate(mixed, { ...plan, section: { ...plan.section, factIds: [candidateId] } }).failures.includes('UNCONFIRMED_FACT_REFERENCE'));
});
test('run metadata requires explicit model identity, budget and observed usage', () => {
  assert.equal(recordedRunSchema.safeParse({ modelId: 'auto' }).success, false);
  assert.equal(recordedRunSchema.safeParse({ modelId: 'vendor/model', provider: 'vendor', fixtureId: 'sample', inputSha256: 'a'.repeat(64),
    budget: { maxRequests: 1, maxOutputTokens: 1000, maxCostUsd: 0.1 },
    observed: { requestId: 'record-1', latencyMs: 100, inputTokens: 10, outputTokens: 20, costUsd: 0.001, finishReason: 'stop' } }).success, true);
});
test('planning fixtures recompute production conflicts for candidate and confirmed competing values', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const competingId = '33333333-3333-4333-8333-333333333333';
  const unrelatedId = '44444444-4444-4444-8444-444444444444';
  const plan = { chapters: [{ role: 'feature', purpose: '说明容量', factIds: [id] }],
    section: { purpose: '验证容量信息', factIds: [id], missingInputs: [] } };
  for (const status of ['candidate', 'confirmed']) {
    const planFixture = { ...fixture, skill: 'plan-section', productName: 'Synthetic bottle', expectedFacts: [], expectedConflictAttributes: [],
      facts: [{ ...output.facts[0], id, status: 'confirmed' }, { ...output.facts[1], id: competingId, status },
        { ...output.facts[0], attribute: '其他核心参数', id: unrelatedId, status: 'confirmed' }] };
    const report = evaluate(planFixture, plan);
    assert.equal(report.automaticChecksPassed, false, status);
    assert.ok(report.failures.includes('UNRESOLVED_FACT_CONFLICT'), status);
  }
});
test('CLI produces JSON and uses distinct success, hard-failure and input-error exit codes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tujiang-eval-'));
  try {
    const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'evaluation/cli.ts', ...args], { cwd: root, encoding: 'utf8' });
    const valid = run('evaluation/fixtures/synthetic-extraction.json', 'evaluation/fixtures/synthetic-extraction-output.json');
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).verdict, 'needs_human_review');
    const badPath = join(directory, 'bad.json');
    writeFileSync(badPath, '{"approved":true}');
    const failed = run('evaluation/fixtures/synthetic-extraction.json', badPath);
    assert.equal(failed.status, 1, failed.stderr);
    assert.equal(JSON.parse(failed.stdout).verdict, 'failed');
    writeFileSync(badPath, 'invalid JSON');
    assert.equal(run('evaluation/fixtures/synthetic-extraction.json', badPath).status, 2);
    assert.equal(run().status, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
