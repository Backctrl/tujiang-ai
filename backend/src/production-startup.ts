import { z } from 'zod';
import { writeSchema } from './contracts.js';
import { contextDraftSchema, type CompleteContext } from './production-context-shapes.js';
import { runnerConfigSchema } from './model-policy.js';
import type { OpenRouterConfig } from './openrouter.js';

export const STARTUP_CONTRACT_VERSION = 'startup.1';
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const startupCheckSchema = z.object({ context: contextDraftSchema }).strict();
export const startupStartSchema = writeSchema.extend({ context: contextDraftSchema, inputFingerprint: fingerprint }).strict();
export const startupScopeRefreshSchema = writeSchema.extend({ inputFingerprint: fingerprint,
  reason: z.string().trim().min(1).max(1000) }).strict();

export type StartupState = 'awaiting_parse' | 'awaiting_usage_review' | 'awaiting_product_evidence'
  | 'awaiting_model_configuration' | 'awaiting_existing_run' | 'ready_to_extract' | 'queued' | 'running' | 'succeeded' | 'failed' | 'input_changed';
export interface StartupFinding {
  code: string; message: string;
  location: { page: 'setup' | 'facts';
    anchor: 'product-info' | 'materials' | 'primary-target' | 'canvas-profile' | 'creation-confirmation' | 'pending-center';
    fields?: string[]; materialIds?: string[] };
}
export interface StartupMaterialRef { id: string; sha256: string; parserVersion: string; metadataSha256: string }
export interface StartupEvidenceRef { id: string; sha256: string }
export interface StartupSourceScope { version: number; materials: StartupMaterialRef[]; manualEvidence: StartupEvidenceRef[] }
export interface StartupHistoryEntry {
  type: 'started' | 'scope_refreshed' | 'extraction_queued'; at: string; actor: string;
  scopeSha256: string; previousScopeSha256?: string; reason?: string;
  addedMaterialIds?: string[]; addedManualEvidenceIds?: string[]; runId?: string; evidenceIds?: string[];
}
export interface ProjectStartup {
  contractVersion: typeof STARTUP_CONTRACT_VERSION; id: string;
  context: CompleteContext; contextVersion: number; contextSha256: string; rulePackSha256: string;
  identity: { productName: string; revision: number };
  inputFingerprint: string; submittedAt: string; submittedBy: string;
  scope: StartupSourceScope; runId?: string; history: StartupHistoryEntry[];
}
export interface StartupRunInput {
  startupId: string; contextVersion: number; contextSha256: string; rulePackSha256: string;
  identity: ProjectStartup['identity']; scopeSha256: string; evidence: StartupEvidenceRef[];
}
export interface StartupScopeRefresh {
  canRefresh: boolean; inputFingerprint: string;
  addedMaterialIds: string[]; addedManualEvidenceIds: string[];
  retainedMaterialIds: string[]; retainedManualEvidenceIds: string[];
}
export interface StartupExecutionCapability {
  status: 'unavailable' | 'configured' | 'synthetic'; code: string; message: string;
  dispatchPreflight: 'not_performed';
}
/** Server wiring only. Request schemas never accept these fields. */
export type StartupExecutionConfig = { mode: 'synthetic'; workerEnabled: boolean }
  | { mode: 'openrouter'; workerEnabled: boolean; modelConfig: OpenRouterConfig };
export function startupExecutionCapability(config?: StartupExecutionConfig): StartupExecutionCapability {
  const result = (status: StartupExecutionCapability['status'], code: string, message: string): StartupExecutionCapability =>
    ({ status, code, message, dispatchPreflight: 'not_performed' });
  if (!config) return result('unavailable', 'MODEL_EXECUTION_UNAVAILABLE', '当前服务未配置事实提取执行能力；可先进入产品事实页处理资料。');
  if (!config.workerEnabled) return result('unavailable', 'MODEL_WORKER_UNAVAILABLE', '事实提取 Worker 尚未启用；管理员恢复执行服务后可继续。');
  if (config.mode === 'synthetic') return result('synthetic', 'SYNTHETIC_GATEWAY', '当前使用合成测试 Gateway；不代表真实模型已就绪。');
  const model = config.modelConfig;
  const modelId = model.factModel || model.model;
  if (!model.apiKey?.trim() || !modelId?.trim()) return result('unavailable', 'MODEL_NOT_CONFIGURED', '事实提取模型或访问凭证未配置；管理员完成配置后可继续。');
  const parsed = runnerConfigSchema.safeParse({ modelId, provider: model.provider, maxRequests: 1,
    maxInputTokens: model.maxInputTokens, maxOutputTokens: model.maxOutputTokens, maxCostUsd: model.maxCostUsd,
    timeoutMs: model.timeoutMs, acceptEstimatedBudget: model.acceptEstimatedBudget });
  if (!parsed.success || !parsed.data.acceptEstimatedBudget || model.timeoutMs > 90_000)
    return result('unavailable', 'MODEL_POLICY_NOT_CONFIGURED', '事实提取的路由、输入输出上限或预算策略尚未完整配置；管理员完成后可继续。');
  return result('configured', 'MODEL_CONFIGURED', '本地模型执行配置已具备；实际能力、输入与费用预检会在 Worker 执行时核验。');
}
export interface StartupStatistics {
  requiredFieldsPresent: number; requiredFieldsTotal: number;
  receivedMaterials: number; availableProductEvidence: number; availableImageAssets: number;
  awaitingParse: number; awaitingUsageReview: number; parseFailed: number;
}
export interface StartupStatus {
  id: string; state: StartupState; contextVersion: number; inputFingerprint: string; submittedAt: string; submittedBy: string;
  runId: string | null; retryRunId: string | null; evidenceIds: string[]; materialIds: string[]; manualEvidenceIds: string[];
  prerequisites: StartupFinding[]; excludedMaterialIds: string[]; excludedManualEvidenceIds: string[];
  scopeRefresh: StartupScopeRefresh; modelExecution: StartupExecutionCapability;
}
export interface StartupCheck {
  contractVersion: typeof STARTUP_CONTRACT_VERSION; projectId: string; projectVersion: number; revision: number;
  inputFingerprint: string; canStart: boolean; canQueueExtraction: boolean; nextState: StartupState | 'blocked';
  blockers: StartupFinding[]; suggestions: StartupFinding[]; extractionPrerequisites: StartupFinding[];
  statistics: StartupStatistics; materialIds: string[]; manualEvidenceIds: string[];
  modelExecution: StartupExecutionCapability; existingStartup: StartupStatus | null;
}
