import { createHash } from 'node:crypto';
import { evaluate } from './evaluate.js';
import { runnerConfigSchema, preflight, RunnerError } from '../src/model-policy.js';
import { compileRequests } from './authorization-input.js';
import { runAuthorizedEvaluation, type LiveAuthorization } from './authorization-runner.js';
import type { AuthorizationStatus } from './authorization-ledger.js';
export { runnerConfigSchema, preflight } from '../src/model-policy.js';
export type { RunnerConfig } from '../src/model-policy.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
type EvaluationSummary = Omit<ReturnType<typeof evaluate>, 'fixtureId'>;
interface ItemReport {
  fixtureSha256: string; provenance: 'synthetic' | 'human-curated'; requestSha256: string;
  estimatedCostUsd: number; status: string; code?: string;
  observed?: { latencyMs: number | null; requestIdSha256: string | null; inputTokens: number | null;
    outputTokens: number | null; costUsd: number | null; finishReason: string };
  evaluation?: EvaluationSummary; attemptId?: string; responseArtifactId?: string | null; parsedArtifactId?: string | null;
}
export interface RunnerReport {
  reportVersion: 'runner.1'; mode: 'dry-run' | 'live'; businessAcceptance: false;
  budgetEnforcement: 'local-estimate-not-billing-cap'; status: string; code?: string;
  modelId?: string; provider?: string; configSha256?: string; capabilitiesSha256?: string;
  budget?: { maxRequests: number; maxInputTokens: number; maxOutputTokens: number; maxCostUsd: number; timeoutMs: number };
  capabilitiesSource?: 'offline-snapshot' | 'live-endpoints'; plannedRequests: number; requestsAttempted: number; metadataRequests: number;
  observedCostUsd: number | null; items: ItemReport[]; authorization?: AuthorizationStatus; preflightArtifactId?: string;
}
export interface RunnerOptions {
  live?: boolean; capabilities?: unknown; request?: typeof fetch; authorization?: LiveAuthorization;
  // Never accessed by dry-run. The live path requires a pre-existing, independently reviewed batch.
  environmentEnabled?: () => boolean; getApiKey?: () => string | undefined;
}
export async function runEvaluation(configInput: unknown, fixtureInputs: unknown[], options: RunnerOptions = {}): Promise<RunnerReport> {
  if (options.live === true) return runAuthorizedEvaluation(configInput, fixtureInputs, options);
  const report: RunnerReport = { reportVersion: 'runner.1', mode: 'dry-run', businessAcceptance: false,
    budgetEnforcement: 'local-estimate-not-billing-cap', status: 'blocked', plannedRequests: 0,
    requestsAttempted: 0, metadataRequests: 0, observedCostUsd: 0, items: [] };
  try {
    const config = runnerConfigSchema.parse(configInput);
    const { fixtures, requestBodies } = compileRequests(config, fixtureInputs);
    report.modelId = config.modelId; report.provider = config.provider; report.configSha256 = hash(config);
    report.budget = { maxRequests: config.maxRequests, maxInputTokens: config.maxInputTokens,
      maxOutputTokens: config.maxOutputTokens, maxCostUsd: config.maxCostUsd, timeoutMs: config.timeoutMs };
    report.plannedRequests = fixtures.length;
    const checked = preflight(options.capabilities, config); report.capabilitiesSource = 'offline-snapshot';
    report.capabilitiesSha256 = checked.capabilitiesSha256;
    if (checked.estimatedCostUsd * fixtures.length > config.maxCostUsd) throw new RunnerError('ESTIMATED_COST_EXCEEDS_BUDGET');
    report.items = fixtures.map((fixture, index) => ({ fixtureSha256: hash(fixture), provenance: fixture.provenance,
      requestSha256: hash(JSON.parse(requestBodies[index]!)), estimatedCostUsd: checked.estimatedCostUsd, status: 'dry_run' }));
    report.status = 'dry_run';
  } catch (error) { report.code = error instanceof RunnerError ? error.code : 'INVALID_RUN_INPUT'; }
  return report;
}
