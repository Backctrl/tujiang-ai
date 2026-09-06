import { createHash } from 'node:crypto';
import { z } from 'zod';
import { checkSkillInputs } from '../src/domain.js';
import { buildStructuredRequest } from '../src/openrouter.js';
import { evaluate, fixtureSchema, projectFromFixture } from './evaluate.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
import { runnerConfigSchema, preflight, requestJson, RunnerError } from '../src/model-policy.js';
export { runnerConfigSchema, preflight } from '../src/model-policy.js';
export type { RunnerConfig } from '../src/model-policy.js';
function fail(code: string): never { throw new RunnerError(code); }

type EvaluationSummary = Omit<ReturnType<typeof evaluate>, 'fixtureId'>;
interface ItemReport {
  fixtureSha256: string; provenance: 'synthetic' | 'human-curated'; requestSha256: string;
  estimatedCostUsd: number; status: string; code?: string;
  observed?: { latencyMs: number; requestIdSha256: string | null; inputTokens: number | null;
    outputTokens: number | null; costUsd: number | null; finishReason: string };
  evaluation?: EvaluationSummary;
}
export interface RunnerReport {
  reportVersion: 'runner.1'; mode: 'dry-run' | 'live'; businessAcceptance: false;
  budgetEnforcement: 'local-estimate-not-billing-cap'; status: string; code?: string;
  modelId?: string; provider?: string; configSha256?: string; capabilitiesSha256?: string;
  budget?: { maxRequests: number; maxInputTokens: number; maxOutputTokens: number; maxCostUsd: number; timeoutMs: number };
  capabilitiesSource?: 'offline-snapshot' | 'live-endpoints';
  plannedRequests: number; requestsAttempted: number; metadataRequests: number;
  observedCostUsd: number | null; items: ItemReport[];
}
export interface RunnerOptions {
  live?: boolean; capabilities?: unknown; request?: typeof fetch;
  // Lazy credential access: never called in dry-run or before local validation passes.
  environmentEnabled?: () => boolean; getApiKey?: () => string | undefined;
}

export async function runEvaluation(configInput: unknown, fixtureInputs: unknown[], options: RunnerOptions = {}): Promise<RunnerReport> {
  const report: RunnerReport = { reportVersion: 'runner.1', mode: options.live === true ? 'live' : 'dry-run',
    businessAcceptance: false, budgetEnforcement: 'local-estimate-not-billing-cap', status: 'blocked',
    plannedRequests: 0, requestsAttempted: 0, metadataRequests: 0, observedCostUsd: 0, items: [] };
  let apiKey: string | undefined;
  let dispatchedAt: number | undefined;
  try {
    const config = runnerConfigSchema.parse(configInput);
    const fixtures = z.array(fixtureSchema).min(1).max(100).parse(fixtureInputs);
    report.modelId = config.modelId; report.provider = config.provider; report.configSha256 = hash(config);
    report.budget = { maxRequests: config.maxRequests, maxInputTokens: config.maxInputTokens,
      maxOutputTokens: config.maxOutputTokens, maxCostUsd: config.maxCostUsd, timeoutMs: config.timeoutMs };
    report.plannedRequests = fixtures.length;
    if (fixtures.length > config.maxRequests) fail('REQUEST_BUDGET_EXCEEDED');
    // Validate every fixture before any network activity. Gold labels never enter the prompt.
    const bodies = fixtures.map(fixture => {
      const project = projectFromFixture(fixture);
      checkSkillInputs(project, fixture.skill);
      const body = { ...buildStructuredRequest(fixture.skill, project, config.modelId, config.maxOutputTokens),
        stream: false, provider: { only: [config.provider], order: [config.provider], allow_fallbacks: false, require_parameters: true } };
      // Conservative local heuristic, including schema and framing; not a tokenizer guarantee.
      const inputEstimate = Buffer.byteLength(JSON.stringify(body), 'utf8') + 1024;
      if (inputEstimate > config.maxInputTokens) fail('INPUT_ESTIMATE_EXCEEDS_LIMIT');
      return body;
    });
    const request = options.request ?? fetch;
    let capabilities = options.capabilities;
    if (options.live === true) {
      if (!config.acceptEstimatedBudget || options.environmentEnabled?.() !== true) fail('LIVE_NOT_ENABLED');
      if (fixtures.some(f => f.provenance !== 'human-curated')) fail('LIVE_REQUIRES_HUMAN_CURATED_FIXTURES');
      apiKey = options.getApiKey?.();
      if (!apiKey?.trim()) fail('KEY_NOT_CONFIGURED');
      report.metadataRequests++;
      capabilities = await requestJson(request, `https://openrouter.ai/api/v1/models/${config.modelId.split('/').map(encodeURIComponent).join('/')}/endpoints`,
        { headers: { Authorization: `Bearer ${apiKey}` } }, config.timeoutMs);
    }
    const checked = preflight(capabilities, config);
    report.capabilitiesSource = options.live === true ? 'live-endpoints' : 'offline-snapshot';
    report.capabilitiesSha256 = checked.capabilitiesSha256;
    if (checked.estimatedCostUsd * fixtures.length > config.maxCostUsd) fail('ESTIMATED_COST_EXCEEDS_BUDGET');
    for (const [index, fixture] of fixtures.entries()) {
      const item: ItemReport = { fixtureSha256: hash(fixture), provenance: fixture.provenance,
        requestSha256: hash(bodies[index]), estimatedCostUsd: checked.estimatedCostUsd, status: 'dry_run' };
      report.items.push(item);
      if (options.live !== true) continue;
      if (report.requestsAttempted >= config.maxRequests || report.observedCostUsd === null ||
          report.observedCostUsd + checked.estimatedCostUsd > config.maxCostUsd) {
        item.status = 'not_dispatched'; item.code = 'REMAINING_BUDGET_INSUFFICIENT'; fail('REMAINING_BUDGET_INSUFFICIENT');
      }
      report.requestsAttempted++;
      item.status = 'failed';
      const start = performance.now();
      dispatchedAt = start;
      item.observed = { latencyMs: 0, requestIdSha256: null, inputTokens: null, outputTokens: null, costUsd: null, finishReason: 'unknown' };
      // A dispatched request may be charged even on transport/parse failure.
      const previousCost = report.observedCostUsd;
      report.observedCostUsd = null;
      const raw = await requestJson(request, 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(bodies[index]),
      }, config.timeoutMs);
      const meta = z.object({ id: z.string().optional(), model: z.string().optional(), provider: z.string().optional(),
        usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional(),
          cost: z.number().nonnegative().finite().optional() }).optional(),
      }).safeParse(raw);
      if (!meta.success) fail('INVALID_RESPONSE');
      const { usage } = meta.data;
      item.observed = { latencyMs: Math.round(performance.now() - start), requestIdSha256: meta.data.id ? hash(meta.data.id) : null,
        inputTokens: usage?.prompt_tokens ?? null, outputTokens: usage?.completion_tokens ?? null,
        costUsd: usage?.cost ?? null, finishReason: 'unknown' };
      if (usage?.cost !== undefined) report.observedCostUsd = previousCost + usage.cost;
      const envelope = z.object({ error: z.unknown().optional(), choices: z.array(z.object({
        finish_reason: z.string(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
      })).length(1) }).safeParse(raw);
      if (!envelope.success || envelope.data.error !== undefined) fail('INVALID_RESPONSE');
      const choice = envelope.data.choices[0]!;
      item.observed.finishReason = ['stop', 'length', 'content_filter', 'tool_calls', 'error'].includes(choice.finish_reason) ? choice.finish_reason : 'unknown';
      if (meta.data.model !== config.modelId || meta.data.provider !== checked.endpoint.provider_name) fail('RESPONSE_ROUTE_MISMATCH');
      if (choice.finish_reason === 'length') fail('OUTPUT_TRUNCATED');
      if (choice.message.refusal || choice.finish_reason === 'content_filter') fail('MODEL_REFUSAL');
      if (choice.finish_reason !== 'stop') fail('UNEXPECTED_FINISH_REASON');
      if (usage?.cost === undefined || usage.prompt_tokens === undefined || usage.completion_tokens === undefined) fail('USAGE_UNKNOWN');
      if (usage.prompt_tokens > config.maxInputTokens || usage.completion_tokens > config.maxOutputTokens) fail('OBSERVED_TOKEN_LIMIT_EXCEEDED');
      if (report.observedCostUsd! > config.maxCostUsd) fail('OBSERVED_COST_EXCEEDED');
      let output: unknown;
      try { output = JSON.parse(choice.message.content ?? ''); } catch { fail('INVALID_OUTPUT_JSON'); }
      const { fixtureId: _fixtureId, ...summary } = evaluate(fixture, output);
      item.evaluation = summary;
      item.status = summary.automaticChecksPassed ? 'needs_human_review' : 'rule_failed';
      dispatchedAt = undefined;
      if (!summary.automaticChecksPassed) fail('EVALUATION_RULE_FAILED');
    }
    report.status = options.live === true ? 'needs_human_review' : 'dry_run';
  } catch (error) {
    report.status = report.requestsAttempted ? 'failed' : 'blocked';
    report.code = error instanceof RunnerError ? error.code : 'INVALID_RUN_INPUT';
    const last = report.items.at(-1);
    if (last && last.status === 'failed') {
      last.code = report.code;
      if (last.observed && dispatchedAt !== undefined) last.observed.latencyMs = Math.round(performance.now() - dispatchedAt);
    }
  }
  // Last-resort exact credential redaction also covers accidental echo into otherwise safe metadata.
  return apiKey ? JSON.parse(JSON.stringify(report).split(apiKey).join('[REDACTED]')) as RunnerReport : report;
}
