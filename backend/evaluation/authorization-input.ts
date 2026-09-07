import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { checkSkillInputs } from '../src/domain.js';
import { buildStructuredRequest } from '../src/openrouter.js';
import { preflight, runnerConfigSchema, type RunnerConfig } from '../src/model-policy.js';
import { evaluate, fixtureSchema, projectFromFixture, type Fixture } from './evaluate.js';
import { canonical, fail, objectSha256, usdToMicros, validateAuthorizedConfig, type BatchPayload } from './authorization-contract.js';
import type { LocalAnalysis, ReservationPlan } from './authorization-ledger.js';

export const EXTRACTION_ADAPTER = Object.freeze({ id: 'fact-extraction', version: '1' });
export type SourceSnapshot = BatchPayload['sources'][number];
export const runFileSchema = z.object({ config: runnerConfigSchema,
  fixtures: z.array(z.string().min(1)).min(1).max(100), capabilitiesFile: z.string().min(1).optional() }).strict();

export function compileRequests(config: RunnerConfig, inputs: unknown[]) {
  const fixtures = z.array(fixtureSchema).min(1).max(100).parse(inputs);
  if (fixtures.length > config.maxRequests) fail('REQUEST_BUDGET_EXCEEDED');
  const requestBodies = fixtures.map(fixture => {
    const project = projectFromFixture(fixture); checkSkillInputs(project, fixture.skill);
    const requestBody = JSON.stringify({ ...buildStructuredRequest(fixture.skill, project, config.modelId, config.maxOutputTokens),
      stream: false, provider: { only: [config.provider], order: [config.provider], allow_fallbacks: false, require_parameters: true } });
    if (Buffer.byteLength(requestBody) + 1024 > config.maxInputTokens) fail('INPUT_ESTIMATE_EXCEEDS_LIMIT');
    return requestBody;
  });
  return { fixtures, requestBodies };
}
export function capabilityPlan(capabilities: unknown, config: RunnerConfig): ReservationPlan {
  const checked = preflight(capabilities, config);
  return { capabilities, estimatedMicros: usdToMicros(checked.estimatedCostUsd), providerName: checked.endpoint.provider_name,
    capabilityFingerprint: objectSha256({ endpoint: checked.endpoint, pricingPolicy: checked.pricingPolicy,
      estimatedMicros: usdToMicros(checked.estimatedCostUsd) }) };
}
export function extractionItems(config: RunnerConfig, fixtureInputs: unknown[]): BatchPayload['items'] {
  const fixtures = z.array(fixtureSchema).min(1).max(100).parse(fixtureInputs);
  if (fixtures.some(f => f.skill !== 'extract-facts')) fail('PURPOSE_ADAPTER_NOT_READY');
  const { requestBodies } = compileRequests(config, fixtures);
  return fixtures.map((fixture, index) => {
    const { expectedFacts, expectedConflictAttributes, ...input } = fixture;
    return { id: `item-${index + 1}`, input, expected: { expectedFacts, expectedConflictAttributes }, requestBody: requestBodies[index]! };
  });
}
export function prepareExtractionBatch(configInput: unknown, fixtureInputs: unknown[], capabilities: unknown, sources: SourceSnapshot[]): BatchPayload {
  const config = validateAuthorizedConfig(configInput, 'fact_extraction');
  const items = extractionItems(config, fixtureInputs); const plan = capabilityPlan(capabilities, config);
  return { purpose: 'fact_extraction', adapter: EXTRACTION_ADAPTER, config, items, sources, upstreamReviewIds: [],
    reviewedCapabilitySha256: plan.capabilityFingerprint, reviewedEstimatedMicros: plan.estimatedMicros,
    reviewedProviderName: plan.providerName };
}
export function assertExtractionAdapter(payload: BatchPayload) {
  if (payload.purpose !== 'fact_extraction' || canonical(payload.adapter) !== canonical(EXTRACTION_ADAPTER)) fail('PURPOSE_ADAPTER_NOT_READY');
}
export function itemFixture(item: BatchPayload['items'][number]): Fixture {
  const input = z.record(z.string(), z.unknown()).parse(item.input);
  const expected = z.record(z.string(), z.unknown()).parse(item.expected);
  return fixtureSchema.parse({ ...input, ...expected });
}
export function analyzeItem(item: BatchPayload['items'][number], output: unknown): LocalAnalysis {
  const { fixtureId: _id, ...evaluation } = evaluate(itemFixture(item), output);
  return { automaticChecksPassed: evaluation.automaticChecksPassed, evaluation };
}
export async function readRunInputs(runPathInput: string) {
  const runPath = resolve(runPathInput); const sources: SourceSnapshot[] = [];
  const readJson = async (path: string, name: string) => {
    const bytes = await readFile(path); if (bytes.byteLength > 2_000_000) fail('INVALID_RUN_INPUT');
    sources.push({ id: `source-${sources.length + 1}`, name, bytesBase64: bytes.toString('base64') });
    return JSON.parse(bytes.toString('utf8')) as unknown;
  };
  const file = runFileSchema.parse(await readJson(runPath, 'run.json'));
  const fixtures = [];
  for (const [index, path] of file.fixtures.entries()) fixtures.push(await readJson(resolve(dirname(runPath), path), `fixture-${index + 1}.json`));
  const capabilities = file.capabilitiesFile ? await readJson(resolve(dirname(runPath), file.capabilitiesFile), 'capabilities.json') : undefined;
  return { config: file.config, fixtures, capabilities, sources };
}
