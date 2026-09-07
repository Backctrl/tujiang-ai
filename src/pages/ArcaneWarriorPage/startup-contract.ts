import type { StartupCheck, StartupFinding, StartupState, StartupStatus } from '../../../backend/src/production-startup.js'
import type { Project } from './stage-a-api.js'
export type { StartupCheck, StartupFinding, StartupState, StartupStatus }
export type StartupRead = { projectId: string; projectVersion: number; revision: number; startup: StartupStatus | null }
export const startupLabels: Record<StartupState, string> = {
  awaiting_parse: '等待资料解析', awaiting_usage_review: '等待资料用途审核', awaiting_product_evidence: '等待可用产品证据',
  awaiting_model_configuration: '等待提取服务配置', awaiting_existing_run: '等待已有任务结束', ready_to_extract: '可以继续事实提取',
  queued: '事实提取已排队', running: '正在提取事实', succeeded: '提取完成，待审核候选', failed: '提取失败，可明确重试', input_changed: '启动输入已变化，需要复核',
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const count = (value: unknown) => Number.isInteger(value) && Number(value) >= 0
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const state = (value: unknown) => typeof value === 'string' && Object.hasOwn(startupLabels, value)
const execution = (value: unknown) => object(value) && ['unavailable', 'configured', 'synthetic'].includes(String(value.status)) && typeof value.code === 'string' && typeof value.message === 'string' && value.dispatchPreflight === 'not_performed'
const findings = (value: unknown) => Array.isArray(value) && value.every(item => object(item) && typeof item.code === 'string' && typeof item.message === 'string'
  && object(item.location) && ['setup', 'facts'].includes(String(item.location.page))
  && ['product-info', 'materials', 'primary-target', 'canvas-profile', 'creation-confirmation', 'pending-center'].includes(String(item.location.anchor))
  && (item.location.fields === undefined || strings(item.location.fields)) && (item.location.materialIds === undefined || strings(item.location.materialIds)))
export function isStartupStatus(value: unknown): value is StartupStatus {
  if (!object(value)) return false
  const scope = value.scopeRefresh
  return typeof value.id === 'string' && state(value.state) && count(value.contextVersion) && hash(value.inputFingerprint)
    && typeof value.submittedAt === 'string' && typeof value.submittedBy === 'string'
    && (value.runId === null || typeof value.runId === 'string') && (value.retryRunId === null || typeof value.retryRunId === 'string')
    && ['evidenceIds', 'materialIds', 'manualEvidenceIds', 'excludedMaterialIds', 'excludedManualEvidenceIds'].every(key => strings(value[key]))
    && findings(value.prerequisites) && execution(value.modelExecution) && object(scope) && typeof scope.canRefresh === 'boolean'
    && hash(scope.inputFingerprint) && ['addedMaterialIds', 'addedManualEvidenceIds', 'retainedMaterialIds', 'retainedManualEvidenceIds'].every(key => strings(scope[key]))
}
export function isStartupRead(value: unknown): value is StartupRead {
  return object(value) && typeof value.projectId === 'string' && count(value.projectVersion) && count(value.revision) && (value.startup === null || isStartupStatus(value.startup))
}
export function isStartupCheck(value: unknown): value is StartupCheck {
  if (!object(value) || !object(value.statistics)) return false
  return value.contractVersion === 'startup.1' && typeof value.projectId === 'string' && count(value.projectVersion) && count(value.revision)
    && hash(value.inputFingerprint) && typeof value.canStart === 'boolean' && typeof value.canQueueExtraction === 'boolean'
    && (value.nextState === 'blocked' || state(value.nextState)) && findings(value.blockers) && findings(value.suggestions) && findings(value.extractionPrerequisites)
    && ['requiredFieldsPresent', 'requiredFieldsTotal', 'receivedMaterials', 'availableProductEvidence', 'availableImageAssets', 'awaitingParse', 'awaitingUsageReview', 'parseFailed'].every(key => count((value.statistics as Record<string, unknown>)[key]))
    && strings(value.materialIds) && strings(value.manualEvidenceIds) && execution(value.modelExecution) && (value.existingStartup === null || isStartupStatus(value.existingStartup))
}
export function startupStatusMatchesProject(status: StartupStatus, project: Project) {
  const stored = project.production?.startup, scope = stored?.scope
  const sameIds = (left: string[], right: unknown) => strings(right) && left.length === right.length && left.every((id, index) => id === right[index])
  if (!stored || !Array.isArray(scope?.materials) || !Array.isArray(scope.manualEvidence)) return false
  const run = project.runs.find(item => item.id === stored.runId)
  const runState = run ? run.queueStatus === 'queued' ? 'queued' : run.queueStatus === 'claimed' ? 'running' : run.runStatus === 'succeeded' ? 'succeeded' : 'failed' : null
  return status.id === stored.id && status.contextVersion === stored.contextVersion && status.inputFingerprint === stored.inputFingerprint
    && status.submittedAt === stored.submittedAt && status.submittedBy === stored.submittedBy && status.runId === (stored.runId ?? null)
    && status.retryRunId === (run?.queueStatus === 'done' && run.runStatus === 'failed' ? run.id : null)
    && (runState ? status.state === runState : !['queued', 'running', 'succeeded', 'failed'].includes(status.state))
    && sameIds(status.materialIds, scope.materials.map(item => item?.id)) && sameIds(status.manualEvidenceIds, scope.manualEvidence.map(item => item?.id))
    && sameIds(status.evidenceIds, run?.startupInput?.evidence.map(item => item?.id) ?? [])
    && sameIds(status.scopeRefresh.retainedMaterialIds, status.materialIds) && sameIds(status.scopeRefresh.retainedManualEvidenceIds, status.manualEvidenceIds)
    && sameIds(status.scopeRefresh.addedMaterialIds, status.excludedMaterialIds) && sameIds(status.scopeRefresh.addedManualEvidenceIds, status.excludedManualEvidenceIds)
}
export const startupReadMatches = (value: Pick<StartupRead, 'projectId' | 'projectVersion' | 'revision'>, project: Project | null) => !!project && value.projectId === project.id && value.projectVersion === project.version && value.revision === project.revision
