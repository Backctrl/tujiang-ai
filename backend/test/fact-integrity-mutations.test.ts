import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { command, fixture } from './helpers.js';
import type { Project } from '../src/contracts.js';
import { FACT_RISK_KINDS } from '../src/production-fact-sources.js';

let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
after(async () => { await f?.close(); });

async function projectWithEvidence(label: string) {
  let p = await f.create();
  p = await f.write(p, 'production/initialize');
  p = await f.write(p, 'identity/confirm', { productName: `Mutation guard ${label}` });
  return f.write(p, 'evidence', {
    documentName: `${label}.txt`, locator: 'line 1', usage: 'product_evidence', text: 'steel',
  });
}

async function persistCorruption(p: Project, operation: string, mutate: (current: Project) => void) {
  return f.store.command(p.id, command(p), operation, 'test-human', current => {
    mutate(current!); return current!;
  });
}

function candidateBody(p: Project) {
  return {
    attribute: 'material', role: 'core', normalizedValue: { kind: 'text', value: 'steel' },
    sources: [{ id: randomUUID(), evidenceId: p.evidence[0]!.id, quote: 'steel', start: 0, end: 5,
      valueSpan: { start: 0, end: 5 } }],
    applicability: { models: { kind: 'unspecified' }, conditions: [] },
    reason: 'Verify malformed persistence rejects the mutation',
  };
}

async function assertRejectedWithoutMutation(p: Project, path: string, body: Record<string, unknown>, code: string) {
  const persisted = structuredClone(p);
  const response = await f.post(`/api/projects/${p.id}/${path}`, command(p, body));
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, code);
  assert.deepEqual(await f.store.get(p.id), persisted, 'a rejected mutation must not alter malformed persistence');
}

test('structured candidate rejects a null Fact collection with a stable contract error', async () => {
  let p = await projectWithEvidence('null-facts');
  const body = candidateBody(p);
  p = await persistCorruption(p, 'test.malformed.mutation-facts', current => {
    Reflect.set(current, 'facts', null);
  });
  await assertRejectedWithoutMutation(p, 'facts/structured/candidates', body, 'INVALID_PROJECT_FACT_COLLECTION');
});

test('structured candidate rejects a null Evidence collection with a stable contract error', async () => {
  let p = await projectWithEvidence('null-evidence');
  const body = candidateBody(p);
  p = await persistCorruption(p, 'test.malformed.mutation-evidence', current => {
    Reflect.set(current, 'evidence', null);
  });
  await assertRejectedWithoutMutation(p, 'facts/structured/candidates', body, 'INVALID_EVIDENCE_CONTRACT');
});

test('structured confirmation rejects a deep malformed Fact without traversing it', async () => {
  let p = await projectWithEvidence('malformed-structured');
  let response = await f.post(`/api/projects/${p.id}/facts/structured/candidates`, command(p, candidateBody(p)));
  assert.equal(response.statusCode, 200, response.body); p = response.json<Project>();
  const factId = p.facts[0]!.id;
  p = await persistCorruption(p, 'test.malformed.mutation-structured', current => {
    Reflect.set(current.facts[0]!, 'structured', {});
  });
  await assertRejectedWithoutMutation(p, `facts/${factId}/structured/confirm`, {
    reason: 'This must fail before reading malformed structured fields', acknowledgedRiskIds: [],
    riskReview: { categories: FACT_RISK_KINDS.map(kind => ({ kind, assessment: 'not_found',
      reason: `No ${kind} issue in the bounded fixture`, reviewedRiskIds: [] })) },
  }, 'INVALID_FACT_BINDING');
});
