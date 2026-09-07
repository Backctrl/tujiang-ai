import { randomUUID } from 'node:crypto';
import { RunnerError, runnerConfigSchema } from '../src/model-policy.js';
import { AUTHORIZATION_POLICY, canonical, describeBatch, fail, microsToUsd, objectSha256, sha256, validateAuthorizedConfig } from './authorization-contract.js';
import { analyzeItem, assertExtractionAdapter, capabilityPlan, extractionItems, itemFixture, type SourceSnapshot } from './authorization-input.js';
import { assertRunnerLedger, type AuthorizationLedger, type AttemptView } from './authorization-ledger.js';
import { inspectCapturedResponse } from './authorization-observation.js';
import { captureResponse } from './authorization-transport.js';
import type { RunnerOptions, RunnerReport } from './runner.js';

// Management commands cannot be reached through the live runner's dependency surface.
export type LiveLedger = Pick<AuthorizationLedger, 'status' | 'reviewedBatch' | 'protectSecrets' | 'reserve' |
  'beginDispatch' | 'recordCapture' | 'finish' | 'recordPreflightCapture'>;
export interface LiveAuthorization { ledger: LiveLedger; batchId: string; sources: SourceSnapshot[] }

export async function runAuthorizedEvaluation(configInput: unknown, fixtureInputs: unknown[], options: RunnerOptions): Promise<RunnerReport> {
  const report: RunnerReport = { reportVersion: 'runner.1', mode: 'live', businessAcceptance: false,
    budgetEnforcement: 'local-estimate-not-billing-cap', status: 'blocked', plannedRequests: 0,
    requestsAttempted: 0, metadataRequests: 0, observedCostUsd: 0, items: [] };
  let apiKey: string | undefined;
  let trustedLedger = false;
  const authorization = options.authorization;
  try {
    const rawConfig = runnerConfigSchema.parse(configInput);
    if (!rawConfig.acceptEstimatedBudget || options.environmentEnabled?.() !== true) fail('LIVE_NOT_ENABLED');
    if (!authorization) fail('AUTHORIZATION_REQUIRED');
    assertRunnerLedger(authorization.ledger);
    trustedLedger = true;
    if (rawConfig.modelId === AUTHORIZATION_POLICY.image.modelId) fail('PURPOSE_ADAPTER_NOT_READY');
    const config = validateAuthorizedConfig(rawConfig, 'fact_extraction');
    const submittedItems = extractionItems(config, fixtureInputs);
    if (submittedItems.some(item => itemFixture(item).provenance !== 'human-curated')) fail('LIVE_REQUIRES_HUMAN_CURATED_FIXTURES');
    const ledger = authorization.ledger;
    const snapshot = await ledger.reviewedBatch(authorization.batchId);
    assertExtractionAdapter(snapshot.payload);
    const submitted = describeBatch(authorization.batchId, { ...snapshot.payload, config, items: submittedItems, sources: authorization.sources });
    if (submitted.manifestSha256 !== snapshot.manifestSha256) fail('BATCH_INPUT_CHANGED');
    const state = await ledger.status(); report.authorization = state; report.observedCostUsd = state.modalities.text.observedTotalUsd;
    report.modelId = config.modelId; report.provider = config.provider; report.configSha256 = objectSha256(config);
    report.budget = { maxRequests: config.maxRequests, maxInputTokens: config.maxInputTokens, maxOutputTokens: config.maxOutputTokens,
      maxCostUsd: config.maxCostUsd, timeoutMs: config.timeoutMs }; report.plannedRequests = submittedItems.length;
    const previous = state.attempts.filter(a => a.batchId === authorization.batchId);
    const append = (index: number, attempt?: AttemptView) => {
      const item = submittedItems[index]!; const fixture = itemFixture(item);
      report.items.push({ fixtureSha256: objectSha256(fixture), provenance: fixture.provenance, requestSha256: sha256(item.requestBody),
        estimatedCostUsd: microsToUsd(snapshot.payload.reviewedEstimatedMicros), status: attempt?.outcome ?? 'not_dispatched',
        ...(attempt ? { attemptId: attempt.id, responseArtifactId: attempt.responseArtifactId, parsedArtifactId: attempt.parsedArtifactId,
          ...(attempt.code ? { code: attempt.code } : {}), ...(attempt.observation ? { observed: { latencyMs: attempt.latencyMs, ...attempt.observation } } : {}) } : {}) });
    };
    if (snapshot.status !== 'approved') {
      for (let i = 0; i < submittedItems.length; i++) append(i, previous.find(a => a.itemId === submittedItems[i]!.id));
      if (snapshot.status === 'completed') { report.status = 'needs_human_review'; return report; }
      fail('BATCH_NOT_RUNNABLE');
    }
    if (state.status !== 'ready') fail(state.effectiveHold ? 'AUTHORIZATION_EFFECTIVE_HOLD' : 'AUTHORIZATION_HELD');
    apiKey = options.getApiKey?.(); if (!apiKey?.trim()) fail('KEY_NOT_CONFIGURED');
    ledger.protectSecrets([apiKey]);
    // Credential redaction must not silently change an already approved source/request.
    const protectedSnapshot = await ledger.reviewedBatch(authorization.batchId);
    if (canonical(protectedSnapshot.payload) !== canonical(snapshot.payload)) fail('SENSITIVE_INPUT_DETECTED');
    const request = options.request ?? fetch;
    report.metadataRequests++;
    const metadata = await captureResponse(request,
      `https://openrouter.ai/api/v1/models/${config.modelId.split('/').map(encodeURIComponent).join('/')}/endpoints`,
      { headers: { Authorization: `Bearer ${apiKey}` } }, config.timeoutMs);
    report.preflightArtifactId = await ledger.recordPreflightCapture(authorization.batchId, metadata);
    if (metadata.errorCode) fail(metadata.errorCode);
    let capabilities: unknown; try { capabilities = JSON.parse(Buffer.from(metadata.bytes).toString('utf8')); } catch { fail('INVALID_RESPONSE_JSON'); }
    const plan = capabilityPlan(capabilities, config); report.capabilitiesSource = 'live-endpoints'; report.capabilitiesSha256 = objectSha256(capabilities);
    if (plan.capabilityFingerprint !== snapshot.payload.reviewedCapabilitySha256 || plan.estimatedMicros !== snapshot.payload.reviewedEstimatedMicros ||
        plan.providerName !== snapshot.payload.reviewedProviderName) fail('CAPABILITIES_CHANGED_REVIEW_REQUIRED');
    for (const [index, item] of submittedItems.entries()) {
      const old = previous.find(a => a.itemId === item.id);
      if (old?.state === 'finished') { append(index, old); continue; }
      const reservation = await ledger.reserve(authorization.batchId, item.id, plan);
      const owner = randomUUID(); const dispatch = await ledger.beginDispatch(reservation.id, owner);
      if (!dispatch.claimed) { append(index, dispatch.attempt); fail(dispatch.code ?? 'ATTEMPT_ALREADY_DISPATCHED'); }
      report.requestsAttempted++; report.observedCostUsd = null;
      const capture = await captureResponse(request, 'https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: item.requestBody }, config.timeoutMs);
      await ledger.recordCapture(reservation.id, owner, capture);
      const inspected = inspectCapturedResponse(capture.bytes, { state: capture.state, httpStatus: capture.httpStatus,
        errorCode: capture.errorCode, latencyMs: capture.latencyMs, bodySha256: capture.state === 'unavailable' ? null : sha256(capture.bytes) },
      { modelId: config.modelId, providerName: plan.providerName, maxInputTokens: config.maxInputTokens, maxOutputTokens: config.maxOutputTokens });
      const analysis = inspected.protocolCode ? undefined : analyzeItem(item, inspected.parsedOutput);
      const settled = await ledger.finish(reservation.id, owner, analysis, { commandId: `finish-${reservation.id}` });
      append(index, settled);
      if (analysis) report.items.at(-1)!.evaluation = analysis.evaluation as NonNullable<RunnerReport['items'][number]['evaluation']>;
      if (report.items.at(-1)?.observed) report.items.at(-1)!.observed!.latencyMs = capture.latencyMs;
      report.authorization = await ledger.status(); report.observedCostUsd = report.authorization.modalities.text.observedTotalUsd;
      if (settled.code) fail(settled.code);
    }
    report.status = 'needs_human_review';
  } catch (error) {
    report.status = report.requestsAttempted ? 'failed' : 'blocked'; report.code = error instanceof RunnerError ? error.code : 'INVALID_RUN_INPUT';
    if (authorization && trustedLedger) {
      try { report.authorization = await authorization.ledger.status(); report.observedCostUsd = report.authorization.modalities.text.observedTotalUsd; } catch { /* Never replace the original safe error. */ }
    }
  }
  return apiKey ? JSON.parse(JSON.stringify(report).split(apiKey).join('[REDACTED]')) as RunnerReport : report;
}
