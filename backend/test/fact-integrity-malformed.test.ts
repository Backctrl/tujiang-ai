import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, command } from './helpers.js';
import type { Fact, Project } from '../src/contracts.js';
import { checkSkillInputs } from '../src/domain.js';
import { IngestionWorker } from '../src/ingestion-worker.js';
import {
  availableConfirmedFacts,
  evaluateFactEligibility,
  factGovernanceHasBlockingIssue,
  factIntegrityReason,
  factSourceIsCurrent,
  projectActiveFactIntegrityIsValid,
  skillInput,
  type FactIntegrityReason,
} from '../src/material-source-gates.js';
import type { MaterialReviewCenter } from '../src/production-material-usage.js';
import { FACT_RISK_KINDS } from '../src/production-fact-sources.js';
import { rule } from './fixtures/production-context.js';
import { scopedContext, scopedRule } from './fixtures/scoped-rules.js';

let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
after(async () => { await f?.close(); });

async function structuredCandidateProject(label: string) {
  let p = await f.create();
  p = await f.write(p, 'production/initialize');
  p = await f.write(p, 'identity/confirm', { productName: `Malformed guard ${label}` });
  p = await f.write(p, 'evidence', {
    documentName: `${label}.txt`, locator: 'line 1', usage: 'product_evidence', text: 'steel',
  });
  let response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p, {
    attribute: 'material', role: 'core', normalizedValue: { kind: 'text', value: 'steel' },
    sources: [{ id: randomUUID(), evidenceId: p.evidence[0]!.id, quote: 'steel', start: 0, end: 5,
      valueSpan: { start: 0, end: 5 } }],
    applicability: { models: { kind: 'unspecified' }, conditions: [] },
    reason: 'Create a valid candidate before simulating persisted corruption',
  }));
  assert.equal(response.statusCode, 200, response.body); p = response.json<Project>();
  return p;
}

async function confirmedStructuredProject(label: string) {
  let p = await structuredCandidateProject(label);
  let response = await f.post(`/api/projects/${p.id}/facts/${p.facts[0]!.id}/structured/confirm`, command(p, {
    reason: 'Confirm a valid Fact before simulating persisted corruption', acknowledgedRiskIds: [],
    riskReview: { categories: FACT_RISK_KINDS.map(kind => ({ kind, assessment: 'not_found',
      reason: `No ${kind} issue in the bounded fixture`, reviewedRiskIds: [] })) },
  }));
  assert.equal(response.statusCode, 200, response.body); p = response.json<Project>();
  assert.deepEqual(availableConfirmedFacts(p).map(fact => fact.id), [p.facts[0]!.id]);
  return p;
}

async function materialEvidenceProject(label: string) {
  let p = await f.write(await f.create(), 'production/initialize');
  p = await f.write(p, 'production/materials', {
    fileName: `${label}.txt`, mimeType: 'text/plain', contentBase64: Buffer.from('steel').toString('base64'),
    source: { kind: 'local_upload' }, usageHint: 'unknown',
  });
  await new IngestionWorker(f.store, f.objects).tick();
  p = await f.store.get(p.id);
  const material = p.production!.materials![0]!;
  p = await f.write(p, `production/materials/${material.id}/usage`, {
    reason: 'Create current material Evidence before simulating persisted corruption',
    decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })),
  });
  return p;
}

async function materialStructuredCandidateProject(label: string) {
  let p = await materialEvidenceProject(label);
  p = await f.write(p, 'identity/confirm', { productName: `Malformed material Fact ${label}` });
  const response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p, {
    attribute: 'material', role: 'core', normalizedValue: { kind: 'text', value: 'steel' },
    sources: [{ id: randomUUID(), evidenceId: p.evidence[0]!.id, quote: 'steel', start: 0, end: 5,
      valueSpan: { start: 0, end: 5 } }],
    applicability: { models: { kind: 'unspecified' }, conditions: [] },
    reason: 'Create a valid material-backed candidate before simulating persisted corruption',
  }));
  assert.equal(response.statusCode, 200, response.body);
  return response.json<Project>();
}

async function materialConfirmedStructuredProject(label: string) {
  let p = await materialStructuredCandidateProject(label);
  const response = await f.post(`/api/projects/${p.id}/facts/${p.facts[0]!.id}/structured/confirm`, command(p, {
    reason: 'Confirm the valid material-backed candidate before the test transition', acknowledgedRiskIds: [],
    riskReview: { categories: FACT_RISK_KINDS.map(kind => ({ kind, assessment: 'not_found',
      reason: `No ${kind} issue in the bounded fixture`, reviewedRiskIds: [] })) },
  }));
  assert.equal(response.statusCode, 200, response.body);
  return response.json<Project>();
}

async function materialReviewCenter(p: Project) {
  const response = await f.app.inject({
    url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  const center = response.json<MaterialReviewCenter>();
  assert.equal(center.tasks.some(task => task.status === 'ready'), false);
  return center;
}

async function receiptCount() {
  return Number((await f.db.query('SELECT count(*) AS count FROM command_receipts')).rows[0]!.count);
}

async function assertWriteRejectedWithoutMutation(p: Project, path: string, body: Record<string, unknown>, code: string) {
  const persisted = structuredClone(p); const receipts = await receiptCount();
  const response = await f.post(`/api/projects/${p.id}/${path}`, command(p, body));
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, code);
  assert.deepEqual(await f.store.get(p.id), persisted);
  assert.equal(await receiptCount(), receipts, 'a rejected write must not persist a command receipt');
}

async function persistCorruption(p: Project, operation: string, mutate: (current: Project) => void) {
  return f.store.command(p.id, command(p), operation, 'test-human', current => {
    mutate(current!); return current!;
  });
}

async function assertEveryReadPathFailsClosed(p: Project, factId: string, reason: FactIntegrityReason) {
  const fact = p.facts.find(item => item && item.id === factId)!;
  assert.equal(factIntegrityReason(p, fact), reason);
  assert.equal(projectActiveFactIntegrityIsValid(p), false);
  assert.equal(factSourceIsCurrent(p, fact), false);
  assert.equal(factGovernanceHasBlockingIssue(p), true);
  assert.deepEqual(availableConfirmedFacts(p), []);
  assert.deepEqual(skillInput(p, 'plan-section').confirmedFacts, []);
  assert.ok(evaluateFactEligibility(p, fact).reasons.includes(reason));
  assert.throws(() => checkSkillInputs(p, 'plan-section'), error =>
    typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'UNRESOLVED_FACT_CONFLICT');

  const details = await f.app.inject({
    url: `/api/projects/${p.id}/facts/${factId}/details`, headers: f.headers,
  });
  assert.equal(details.statusCode, 200, details.body);
  assert.equal(details.json().integrityValid, false);
  assert.ok(details.json().eligibility.reasons.includes(reason));

  const pending = await f.app.inject({
    url: `/api/projects/${p.id}/production/material-reviews`, headers: f.headers,
  });
  assert.equal(pending.statusCode, 200, pending.body);
  assert.equal((pending.json().tasks as { status: string }[]).some(task => task.status === 'ready'), false);

  const downstream = await f.post(`/api/projects/${p.id}/storyboard/draft`, command(p, {
    chapters: [{ role: 'feature', purpose: 'Malformed facts must remain unavailable', factIds: [factId] }],
    reason: 'Verify the downstream write is rejected before persistence',
  }));
  assert.equal(downstream.statusCode, 409, downstream.body);
  assert.equal(downstream.json().error.code, 'UNRESOLVED_FACT_CONFLICT');
}

test('a referenced Evidence with a null text field fails every integrity consumer closed', async () => {
  let p = await confirmedStructuredProject('null-text'); const factId = p.facts[0]!.id;
  p = await persistCorruption(p, 'test.malformed.evidence-text', current => {
    Reflect.set(current.evidence[0]!, 'text', null);
  });
  const persisted = structuredClone(p);
  await assertEveryReadPathFailsClosed(p, factId, 'INVALID_EVIDENCE_CONTRACT');
  assert.deepEqual(await f.store.get(p.id), persisted, 'reads must not repair malformed persistence');
});

test('a null Evidence collection element fails every integrity consumer closed', async () => {
  let p = await confirmedStructuredProject('null-evidence'); const factId = p.facts[0]!.id;
  p = await persistCorruption(p, 'test.malformed.evidence-element', current => {
    Reflect.set(current, 'evidence', [null, ...current.evidence]);
  });
  const persisted = structuredClone(p);
  await assertEveryReadPathFailsClosed(p, factId, 'INVALID_EVIDENCE_CONTRACT');
  assert.deepEqual(await f.store.get(p.id), persisted, 'reads must not remove malformed Evidence elements');
});

test('a null Fact collection element blocks the project and is itself reported as an invalid Fact contract', async () => {
  let p = await confirmedStructuredProject('null-fact'); const factId = p.facts[0]!.id;
  p = await persistCorruption(p, 'test.malformed.fact-element', current => {
    Reflect.set(current, 'facts', [...current.facts, null]);
  });
  const persisted = structuredClone(p);
  await assertEveryReadPathFailsClosed(p, factId, 'INVALID_PROJECT_FACT_COLLECTION');
  assert.equal(factIntegrityReason(p, (p.facts as unknown[])[1] as Fact), 'INVALID_FACT_CONTRACT');
  assert.deepEqual(await f.store.get(p.id), persisted, 'reads must not remove malformed Fact elements');
});

test('material review center fails closed for a null Fact collection and deep malformed structured sources', async () => {
  let missingCollection = await structuredCandidateProject('missing-fact-collection');
  missingCollection = await persistCorruption(missingCollection, 'test.malformed.fact-collection', current => {
    Reflect.set(current, 'facts', null);
  });
  let persisted = structuredClone(missingCollection);
  assert.deepEqual((await materialReviewCenter(missingCollection)).tasks, []);
  assert.deepEqual(await f.store.get(missingCollection.id), persisted);

  for (const [label, mutate] of [
    ['missing-sources', (fact: Fact) => Reflect.set(fact, 'structured', {})],
    ['null-source', (fact: Fact) => Reflect.set(fact.structured!, 'sources', [null])],
  ] as const) {
    let p = await structuredCandidateProject(label);
    const factId = p.facts[0]!.id;
    p = await persistCorruption(p, `test.malformed.${label}`, current => { mutate(current!.facts[0]!); });
    persisted = structuredClone(p);
    const task = (await materialReviewCenter(p)).tasks.find(item => item.type === 'fact_review' && item.factId === factId);
    assert.equal(task?.status, 'blocked', label);
    if (task?.type === 'fact_review') assert.equal(task.blockedReason, 'INVALID_FACT_BINDING', label);
    assert.deepEqual(await f.store.get(p.id), persisted, `${label} read must not repair persistence`);
  }
});

test('material review center suppresses material actions when current Fact or Evidence persistence is malformed', async () => {
  for (const [label, mutate] of [
    ['null-facts', (current: Project) => Reflect.set(current, 'facts', null)],
    ['null-collection', (current: Project) => Reflect.set(current, 'evidence', null)],
    ['null-element', (current: Project) => Reflect.set(current, 'evidence', [null, ...current.evidence])],
    ['null-text', (current: Project) => Reflect.set(current.evidence[0]!, 'text', null)],
  ] as const) {
    let p = await materialEvidenceProject(`material-${label}`);
    p = await persistCorruption(p, `test.malformed.material-evidence-${label}`, mutate);
    const persisted = structuredClone(p);
    const center = await materialReviewCenter(p);
    assert.equal(center.tasks.some(task => task.type === 'fact_extraction'), false, label);
    assert.equal(center.tasks.some(task => task.type === 'material_usage'), false, label);
    assert.deepEqual(await f.store.get(p.id), persisted, `${label} read must not repair persistence`);
  }
});

test('Evidence creation rejects malformed Evidence persistence before object or receipt writes', async () => {
  const body = { documentName: 'new.txt', locator: 'line 1', usage: 'product_evidence', text: 'new evidence' };
  for (const [label, mutate] of [
    ['null-collection', (current: Project) => Reflect.set(current, 'evidence', null)],
    ['null-element', (current: Project) => Reflect.set(current, 'evidence', [null, ...current.evidence])],
    ['null-text', (current: Project) => Reflect.set(current.evidence[0]!, 'text', null)],
  ] as const) {
    let p = await f.write(await f.create(), 'evidence', {
      documentName: `${label}.txt`, locator: 'line 1', usage: 'product_evidence', text: 'steel',
    });
    p = await persistCorruption(p, `test.malformed.evidence-add-${label}`, mutate);
    await assertWriteRejectedWithoutMutation(p, 'evidence', body, 'INVALID_EVIDENCE_CONTRACT');
  }
});

test('material usage rejects malformed collections and deep structured payloads before its no-change path', async () => {
  for (const [label, mutate, code] of [
    ['null-facts', (current: Project) => Reflect.set(current, 'facts', null), 'INVALID_PROJECT_FACT_COLLECTION'],
    ['null-evidence', (current: Project) => Reflect.set(current, 'evidence', null), 'INVALID_EVIDENCE_CONTRACT'],
    ['null-evidence-element', (current: Project) => Reflect.set(current, 'evidence', [null, ...current.evidence]), 'INVALID_EVIDENCE_CONTRACT'],
  ] as const) {
    let p = await materialEvidenceProject(`usage-${label}`);
    const material = p.production!.materials![0]!;
    const body = { reason: 'A replay must still validate persisted collections',
      decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })) };
    p = await persistCorruption(p, `test.malformed.material-usage-${label}`, mutate);
    await assertWriteRejectedWithoutMutation(p, `production/materials/${material.id}/usage`, body, code);
  }

  let p = await materialEvidenceProject('usage-deep-structured');
  p = await f.write(p, 'identity/confirm', { productName: 'Malformed material usage guard' });
  let response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p, {
    attribute: 'material', role: 'core', normalizedValue: { kind: 'text', value: 'steel' },
    sources: [{ id: randomUUID(), evidenceId: p.evidence[0]!.id, quote: 'steel', start: 0, end: 5,
      valueSpan: { start: 0, end: 5 } }],
    applicability: { models: { kind: 'unspecified' }, conditions: [] },
    reason: 'Create a candidate before corrupting its nested source contract',
  }));
  assert.equal(response.statusCode, 200, response.body); p = response.json<Project>();
  const material = p.production!.materials![0]!;
  const body = { reason: 'A no-change replay must reject malformed nested source persistence',
    decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })) };
  p = await persistCorruption(p, 'test.malformed.material-usage-structured', current => {
    Reflect.set(current!.facts[0]!, 'structured', {});
  });
  const center = await materialReviewCenter(p);
  assert.equal(center.tasks.some(task => task.type === 'fact_extraction' || task.type === 'material_usage'), false);
  const review = center.tasks.find(task => task.type === 'fact_review');
  assert.equal(review?.status, 'blocked');
  await assertWriteRejectedWithoutMutation(p, `production/materials/${material.id}/usage`, body, 'INVALID_FACT_BINDING');

  p = await materialEvidenceProject('usage-missing-source-quote');
  p = await f.write(p, 'identity/confirm', { productName: 'Malformed nested source guard' });
  response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p, {
    attribute: 'material', role: 'core', normalizedValue: { kind: 'text', value: 'steel' },
    sources: [{ id: randomUUID(), evidenceId: p.evidence[0]!.id, quote: 'steel', start: 0, end: 5,
      valueSpan: { start: 0, end: 5 } }],
    applicability: { models: { kind: 'unspecified' }, conditions: [] },
    reason: 'Create a candidate before deleting one nested source field',
  }));
  assert.equal(response.statusCode, 200, response.body); p = response.json<Project>();
  const quoteMaterial = p.production!.materials![0]!;
  const quoteBody = { reason: 'A no-change replay must validate the full stored source shape',
    decisions: quoteMaterial.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })) };
  p = await persistCorruption(p, 'test.malformed.material-usage-source-quote', current => {
    Reflect.deleteProperty(current!.facts[0]!.structured!.sources[0]!, 'quote');
  });
  const quoteCenter = await materialReviewCenter(p);
  const quoteReview = quoteCenter.tasks.find(task => task.type === 'fact_review');
  assert.equal(quoteReview?.status, 'blocked');
  await assertWriteRejectedWithoutMutation(p, `production/materials/${quoteMaterial.id}/usage`, quoteBody,
    'INVALID_FACT_BINDING');
});

test('material usage no-change replay rejects malformed stored Structured Fact cardinality and state', async () => {
  const cases: [string, (fact: Fact) => void][] = [
    ['empty-sources', fact => { fact.structured!.sources = []; }],
    ['duplicate-source-id', fact => {
      const duplicate = structuredClone(fact.structured!.sources[0]!);
      duplicate.evidenceId = randomUUID();
      fact.structured!.sources.push(duplicate);
    }],
    ['duplicate-evidence-range', fact => {
      const duplicate = structuredClone(fact.structured!.sources[0]!);
      duplicate.id = randomUUID();
      fact.structured!.sources.push(duplicate);
    }],
    ['too-many-sources', fact => {
      const source = fact.structured!.sources[0]!;
      fact.structured!.sources = Array.from({ length: 11 }, () => ({
        ...structuredClone(source), id: randomUUID(), evidenceId: randomUUID(),
      }));
    }],
    ['missing-contract-version', fact => { Reflect.deleteProperty(fact.structured!, 'contractVersion'); }],
    ['missing-candidate-binding', fact => { Reflect.deleteProperty(fact.structured!, 'candidateBinding'); }],
  ];
  for (const [label, mutate] of cases) {
    let p = await materialStructuredCandidateProject(`usage-${label}`);
    const material = p.production!.materials![0]!;
    const body = { reason: 'A no-change replay must reject malformed stored Structured Fact state',
      decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })) };
    p = await persistCorruption(p, `test.malformed.material-usage-${label}`, current => mutate(current!.facts[0]!));
    await assertWriteRejectedWithoutMutation(p, `production/materials/${material.id}/usage`, body,
      'INVALID_FACT_BINDING');
  }

  for (const field of ['confirmation', 'riskReview'] as const) {
    let confirmed = await materialConfirmedStructuredProject(`usage-confirmed-missing-${field}`);
    const material = confirmed.production!.materials![0]!;
    const body = { reason: 'A no-change replay must reject incomplete confirmed Fact state',
      decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })) };
    confirmed = await persistCorruption(confirmed, `test.malformed.material-usage-missing-${field}`, current => {
      Reflect.deleteProperty(current!.facts[0]!.structured!, field);
    });
    await assertWriteRejectedWithoutMutation(confirmed, `production/materials/${material.id}/usage`, body,
      'INVALID_FACT_BINDING');
  }

  let candidateWithConfirmation = await materialConfirmedStructuredProject('usage-candidate-with-confirmation');
  const candidateMaterial = candidateWithConfirmation.production!.materials![0]!;
  const candidateBody = { reason: 'A no-change replay must reject confirmation data on a candidate',
    decisions: candidateMaterial.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })) };
  candidateWithConfirmation = await persistCorruption(candidateWithConfirmation,
    'test.malformed.material-usage-candidate-with-confirmation', current => {
      const fact = current!.facts[0]!;
      fact.status = 'candidate'; fact.locked = false;
      delete fact.confirmedBy; delete fact.confirmedAt;
    });
  await assertWriteRejectedWithoutMutation(candidateWithConfirmation,
    `production/materials/${candidateMaterial.id}/usage`, candidateBody, 'INVALID_FACT_BINDING');
});

test('material withdrawal can quarantine a strict historical V1 Structured Fact without upgrading its proofs', async () => {
  let p = await materialStructuredCandidateProject('historical-v1-withdrawal');
  const material = p.production!.materials![0]!;
  p = await persistCorruption(p, 'test.historical-v1-structured-fact', current => {
    const fact = current!.facts[0]!;
    Reflect.set(fact.structured!.candidateBinding!, 'contractVersion', 'fact-candidate-binding.1');
    Reflect.deleteProperty(fact.structured!.candidateBinding!, 'originalSources');
    Reflect.set(fact.lifecycleBinding!, 'contractVersion', 'fact-lifecycle-binding.1');
  });
  assert.equal(projectActiveFactIntegrityIsValid(p), false, 'obsolete proofs must remain unusable');
  const response = await f.post(`/api/projects/${p.id}/production/materials/${material.id}/usage`, command(p, {
    reason: 'Withdraw the historical source without legitimizing obsolete Fact proofs',
    decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'reference' })),
  }));
  assert.equal(response.statusCode, 200, response.body);
  p = response.json<Project>();
  assert.equal(p.facts[0]!.structured!.sources[0]!.review?.status, 'invalidated');
  assert.equal(p.facts[0]!.structured!.candidateBinding!.contractVersion, 'fact-candidate-binding.1');
  assert.equal(p.facts[0]!.lifecycleBinding!.contractVersion, 'fact-lifecycle-binding.1');
  assert.equal(projectActiveFactIntegrityIsValid(p), false, 'withdrawal must not upgrade historical proofs');
});

test('legal retracted Structured Facts remain traversable during an unrelated material replay', async () => {
  let p = await materialConfirmedStructuredProject('retracted-material-replay');
  p = await f.write(p, `facts/${p.facts[0]!.id}/retract`, { reason: 'Create a legal retracted Fact for traversal' });
  assert.equal(projectActiveFactIntegrityIsValid(p), true);
  const material = p.production!.materials![0]!;
  const persisted = structuredClone(p);
  const response = await f.post(`/api/projects/${p.id}/production/materials/${material.id}/usage`, command(p, {
    reason: 'Replay the current material decision while the retracted Fact remains historical',
    decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'product_evidence' })),
  }));
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json<Project>(), persisted);
});

test('material withdrawal quarantines a Fact with a deleted confirmation audit without repairing that audit', async () => {
  let p = await materialConfirmedStructuredProject('missing-confirmation-audit-withdrawal');
  const material = p.production!.materials![0]!;
  p = await persistCorruption(p, 'test.missing-confirmation-audit', current => {
    const index = current!.audit.findIndex(entry => entry.type === 'fact.structured_confirmed');
    assert.ok(index >= 0);
    current!.audit.splice(index, 1);
  });
  assert.equal(projectActiveFactIntegrityIsValid(p), false, 'deleted confirmation audit must fail closed');
  const response = await f.post(`/api/projects/${p.id}/production/materials/${material.id}/usage`, command(p, {
    reason: 'Withdraw the source while preserving the missing confirmation audit failure',
    decisions: material.blocks.map(block => ({ blockId: block.id, usage: 'reference' })),
  }));
  assert.equal(response.statusCode, 200, response.body);
  p = response.json<Project>();
  assert.equal(p.facts[0]!.structured!.sources[0]!.review?.status, 'reconfirmation_required');
  assert.equal(p.audit.some(entry => entry.type === 'fact.structured_confirmed'), false);
  assert.equal(projectActiveFactIntegrityIsValid(p), false, 'withdrawal must not recreate the deleted confirmation audit');
});

test('startup GET treats malformed persisted manual Evidence as a changed source instead of throwing', async () => {
  const server = await fixture({ rulePacks: [rule], scopedRulePacks: [scopedRule] }, { mode: 'synthetic', workerEnabled: true });
  try {
    for (const [label, mutate] of [
      ['null-collection', (current: Project) => Reflect.set(current, 'evidence', null)],
      ['null-element', (current: Project) => Reflect.set(current, 'evidence', [null, ...current.evidence])],
      ['null-text', (current: Project) => Reflect.set(current.evidence[0]!, 'text', null)],
    ] as const) {
      let p = await server.create();
      p = await server.write(p, 'evidence', {
        documentName: `startup-${label}.txt`, locator: 'line 1', usage: 'product_evidence', text: 'steel',
      });
      let response = await server.post(`/api/projects/${p.id}/production/startup/check`, { context: scopedContext });
      assert.equal(response.statusCode, 200, response.body);
      const check = response.json<{ inputFingerprint: string }>();
      response = await server.post(`/api/projects/${p.id}/production/startup/start`, command(p, {
        context: scopedContext, inputFingerprint: check.inputFingerprint,
      }));
      assert.equal(response.statusCode, 200, response.body);
      p = response.json<{ project: Project }>().project;
      p = await server.store.command(p.id, command(p), `test.malformed.startup-evidence-${label}`, 'test-human', current => {
        mutate(current!); return current!;
      });
      const persisted = structuredClone(p);
      response = await server.app.inject({
        url: `/api/projects/${p.id}/production/startup`, headers: server.headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      const status = response.json<{ startup: { prerequisites: { code: string }[] } }>();
      assert.ok(status.startup.prerequisites.some(item => item.code === 'STARTUP_SOURCE_CHANGED'), label);
      assert.deepEqual(await server.store.get(p.id), persisted, `${label} startup read must not repair persistence`);
    }
  } finally { await server.close(); }
});
