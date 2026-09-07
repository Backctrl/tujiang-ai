import { randomUUID } from 'node:crypto';
import type { Project } from './contracts.js';
import type { Connection } from './database.js';
import { enqueue } from './domain.js';
import { AppError } from './errors.js';
import { availableEvidence, materialAssetIsAvailable } from './material-source-gates.js';
import { activateContext, completeContextSchema, hashRulePack, saveContextDraft, type ContextDraft,
  type ProductionCatalog, type ProjectContextVersion } from './production-context.js';
import { initializeProduction } from './production.js';
import { STARTUP_CONTRACT_VERSION, type ProjectStartup, type StartupCheck, type StartupExecutionCapability,
  type StartupFinding, type StartupSourceScope, type StartupState, type StartupStatistics, type StartupStatus } from './production-startup.js';
import { currentStartupScope, scopedStartupEvidence, scopeRefreshFingerprint, startupBindingError, startupEvidenceRef,
  startupHash, startupScopeAdditions, validateStartupRun } from './startup-scope.js';
import { audit } from './store.js';

const infoFields = ['productName', 'category', 'stage', 'introduction'] as const;
const labels: Record<string, string> = { productName: '产品名称', category: '产品品类', stage: '产品阶段', introduction: '一句话产品介绍' };
export function startupFinding(code: string, message: string, anchor: StartupFinding['location']['anchor'] = 'pending-center',
  details: Pick<StartupFinding['location'], 'fields' | 'materialIds'> = {}): StartupFinding {
  return { code, message, location: { page: anchor === 'pending-center' ? 'facts' : 'setup', anchor, ...details } };
}
function fieldAnchor(field: string): StartupFinding['location']['anchor'] {
  if (field.startsWith('productBrief')) return 'product-info';
  if (field.startsWith('canvasProfile')) return 'canvas-profile';
  if (field.startsWith('primaryTarget') || field.startsWith('rulePackRef')) return 'primary-target';
  return 'creation-confirmation';
}
const contextMessages: Record<string, string> = {
  RULE_PACK_UNAVAILABLE: '所选 RulePack 不在当前已支持目录中，请选择已核验的目标组合。',
  SCOPED_RULE_PACK_REQUIRED: '指定内容类型的目标需要 scoped-rules.1，请重新选择支持该内容类型的规则。',
  SCOPED_CONTENT_TYPE_REQUIRED: '请选择当前规则对应的内容类型。',
  RULE_PACK_TARGET_MISMATCH: '平台、站点、语言、货币或单位与所选 RulePack 不一致，请按已支持组合修正。',
  CANVAS_OUTSIDE_RULE_PACK: '页面宽度或格式超出当前规则支持范围。',
  LOCAL_PRODUCTION_SELECTION_REQUIRED: '请明确选择本地生产尺寸策略，再建立首发 CanvasProfile。',
  CANVAS_OUTSIDE_LOCAL_PRODUCTION_POLICY: '页面宽度或格式超出已配置的本地生产策略。',
  RULE_PACK_INCOMPLETE: '当前目标所需的规则仍有未核验或不适用项，管理员补齐规则后才能启动。',
  RULE_PACK_VERSION_CHANGED: '同一 RulePack 版本的内容与已冻结记录不同，需要管理员发布新版本。',
  UNSUPPORTED_PRODUCTION_CONTRACT: '当前项目的生产数据版本不受此服务支持。',
};
const bindingMessages: Record<string, string> = {
  STARTUP_CONTEXT_CHANGED: '首发上下文已改变，本次启动仍绑定原先提交的 P；请核对并恢复原输入，后续新批次需要独立明确提交。',
  STARTUP_IDENTITY_CHANGED: '产品身份已在启动后改变，请核对原身份和更正记录；本次提取不会自动采用新身份。',
  STARTUP_SOURCE_CHANGED: '已提交原件或独立证据的内容发生变化，请核对来源；本次启动不会静默替换已冻结资料。',
  STARTUP_INPUT_CHANGED: '本次提取的启动依赖不一致，请核对原启动记录。',
  STARTUP_EVIDENCE_CHANGED: '本次提取绑定的证据已撤回或变更，不能继续使用；请在事实页核对来源。',
};
export function requireStartup(p: Project): ProjectStartup {
  const startup = p.production?.startup;
  if (!startup) throw new AppError('STARTUP_NOT_FOUND', 409);
  return startup;
}
export function assertStartupBinding(p: Project): ProjectStartup {
  const startup = requireStartup(p);
  const code = startupBindingError(p, startup);
  if (code) throw new AppError(code, 409, { recovery: bindingMessages[code] });
  return startup;
}
function materialProgress(p: Project, scope?: StartupSourceScope) {
  const materials = (p.production?.materials ?? []).filter(material => !scope || scope.materials.some(ref => ref.id === material.id));
  const pending = materials.filter(material => material.parse.queueStatus !== 'done');
  const failed = materials.filter(material => material.parse.queueStatus === 'done' && material.parse.runStatus === 'failed');
  const usage = materials.filter(material => material.parse.queueStatus === 'done' && material.parse.runStatus === 'succeeded'
    && material.blocks.some(block => !material.usageReview?.current[block.id]));
  const pendingBlocks = usage.reduce((count, material) => count + material.blocks.filter(block => !material.usageReview?.current[block.id]).length, 0);
  return { materials, pending, failed, usage, pendingBlocks };
}
export function startupStatistics(p: Project, context: ContextDraft): StartupStatistics {
  const progress = materialProgress(p);
  return { requiredFieldsPresent: infoFields.filter(field => !!context.productBrief?.[field]?.trim()).length,
    requiredFieldsTotal: infoFields.length, receivedMaterials: progress.materials.length,
    availableProductEvidence: availableEvidence(p).length,
    availableImageAssets: (p.production?.assets ?? []).filter(asset => materialAssetIsAvailable(p, asset)).length,
    awaitingParse: progress.pending.length, awaitingUsageReview: progress.pendingBlocks, parseFailed: progress.failed.length };
}
function extractionReadiness(p: Project, scope: StartupSourceScope, execution: StartupExecutionCapability) {
  const sources = scopedStartupEvidence(p, scope);
  const progress = materialProgress(p, scope);
  const prerequisites: StartupFinding[] = [];
  if (progress.pending.length) prerequisites.push(startupFinding('MATERIAL_PARSE_PENDING', '部分原件等待解析或正在解析；已接收的其它有效证据可继续处理。',
    'pending-center', { materialIds: progress.pending.map(item => item.id) }));
  if (progress.usage.length) prerequisites.push(startupFinding('MATERIAL_USAGE_REVIEW_REQUIRED', '部分内容块需要员工确认用途，确认前不会成为模型可用产品证据。',
    'pending-center', { materialIds: progress.usage.map(item => item.id) }));
  if (!sources.length) prerequisites.push(startupFinding('PRODUCT_EVIDENCE_REQUIRED', '本次资料范围尚无有效产品证据；请处理解析或用途待办，或明确补充有来源的产品资料。'));
  if (execution.status === 'unavailable') prerequisites.push(startupFinding(execution.code, execution.message));
  if (progress.failed.length) prerequisites.push(startupFinding('MATERIAL_PARSE_FAILED', '部分原件解析失败；可在产品事实页重试或重新上传，其他有效资料仍可处理。',
    'pending-center', { materialIds: progress.failed.map(item => item.id) }));
  const state: StartupState = !sources.length ? progress.pending.length ? 'awaiting_parse'
    : progress.usage.length ? 'awaiting_usage_review' : 'awaiting_product_evidence'
    : execution.status === 'unavailable' ? 'awaiting_model_configuration' : 'ready_to_extract';
  return { state, prerequisites, sources };
}
export function startupStatus(p: Project, execution: StartupExecutionCapability): StartupStatus | null {
  const startup = p.production?.startup;
  if (!startup) return null;
  const readiness = extractionReadiness(p, startup.scope, execution);
  const additions = startupScopeAdditions(p, startup.scope);
  const bindingError = startupBindingError(p, startup);
  const prerequisites = [...readiness.prerequisites];
  if (bindingError) prerequisites.unshift(startupFinding(bindingError, bindingMessages[bindingError]!));
  const run = startup.runId ? p.runs.find(item => item.id === startup.runId) : undefined;
  let state: StartupState = bindingError ? 'input_changed' : readiness.state;
  if (startup.runId && !run) {
    state = 'input_changed'; prerequisites.unshift(startupFinding('STARTUP_RUN_NOT_FOUND', '本次启动关联的任务不存在，请核对服务端项目记录。'));
  } else if (run) {
    state = run.queueStatus === 'queued' ? 'queued' : run.queueStatus === 'claimed' ? 'running'
      : run.runStatus === 'succeeded' ? 'succeeded' : 'failed';
    if (!bindingError) try { validateStartupRun(p, run); }
    catch (error) {
      if (!(error instanceof AppError)) throw error;
      prerequisites.unshift(startupFinding(error.code, bindingMessages[error.code] ?? '本次任务依赖已变化，请核对原启动记录。'));
    }
    if (state === 'failed') prerequisites.unshift(startupFinding('STARTUP_RUN_FAILED', '本次提取未成功；请先处理具体失败原因，再显式重试原任务。'));
  }
  if (!run && p.runs.some(item => item.queueStatus !== 'done')) {
    prerequisites.unshift(startupFinding('RUN_ALREADY_ACTIVE', '项目已有其它在途任务；本次启动需等待其结束后再继续。'));
    if (!bindingError) state = 'awaiting_existing_run';
  }
  return { id: startup.id, state, contextVersion: startup.contextVersion, inputFingerprint: startup.inputFingerprint,
    submittedAt: startup.submittedAt, submittedBy: startup.submittedBy, runId: startup.runId ?? null,
    retryRunId: run?.queueStatus === 'done' && run.runStatus === 'failed' ? run.id : null,
    evidenceIds: run?.startupInput?.evidence.map(ref => ref.id) ?? [], materialIds: startup.scope.materials.map(ref => ref.id),
    manualEvidenceIds: startup.scope.manualEvidence.map(ref => ref.id), prerequisites,
    excludedMaterialIds: additions.materials.map(ref => ref.id), excludedManualEvidenceIds: additions.manualEvidence.map(ref => ref.id),
    scopeRefresh: { canRefresh: !startup.runId && !bindingError && !!(additions.materials.length + additions.manualEvidence.length),
      inputFingerprint: scopeRefreshFingerprint(startup, additions), addedMaterialIds: additions.materials.map(ref => ref.id),
      addedManualEvidenceIds: additions.manualEvidence.map(ref => ref.id), retainedMaterialIds: startup.scope.materials.map(ref => ref.id),
      retainedManualEvidenceIds: startup.scope.manualEvidence.map(ref => ref.id) }, modelExecution: execution };
}
/** Preview activation on a clone: no original P, revision, receipt, audit or rule binding is written. */
export function previewStartupContext(p: Project, context: ContextDraft, catalog: ProductionCatalog): ProjectContextVersion {
  const clone = structuredClone(p);
  initializeProduction(clone);
  saveContextDraft(clone.production!, context);
  return activateContext(clone.production!, catalog, 'startup-check');
}
function sameSourceScope(a: StartupSourceScope, b: StartupSourceScope) {
  return startupHash({ materials: a.materials, manualEvidence: a.manualEvidence })
    === startupHash({ materials: b.materials, manualEvidence: b.manualEvidence });
}
export async function startupCheck(p: Project, context: ContextDraft, catalog: ProductionCatalog,
  execution: StartupExecutionCapability, connection: Connection): Promise<StartupCheck> {
  const blockers: StartupFinding[] = [];
  const suggestions: StartupFinding[] = [];
  const complete = completeContextSchema.safeParse(context);
  let snapshot: ProjectContextVersion | undefined;
  if (!complete.success) {
    for (const issue of complete.error.issues) {
      const field = issue.path.join('.');
      const key = String(issue.path.at(-1));
      blockers.push(startupFinding('PRODUCTION_CONTEXT_INCOMPLETE', `请补全或修正${labels[key] ?? (field || '项目设置')}。`, fieldAnchor(field), { fields: [field] }));
    }
  } else try {
    snapshot = previewStartupContext(p, context, catalog);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const fields = Array.isArray(error.details?.fields) ? error.details.fields as string[] : ['rulePackRef'];
    const ruleBlockers = error.code === 'RULE_PACK_INCOMPLETE' && Array.isArray(error.details?.blockers)
      ? error.details.blockers as { ruleId?: string; reason?: string; recovery?: string }[] : [];
    if (ruleBlockers.length) for (const detail of ruleBlockers) {
      const subject = detail.ruleId ? `规则「${detail.ruleId}」尚未核验。` : '当前内容类型和品类缺少适用的启用规则。';
      const message = [subject, detail.reason, detail.recovery].filter(Boolean).join(' ');
      blockers.push(startupFinding(error.code, message, fieldAnchor(fields[0] ?? ''), { fields }));
    } else blockers.push(startupFinding(error.code, contextMessages[error.code] ?? '当前设置未通过服务端校验。', fieldAnchor(fields[0] ?? ''), { fields }));
  }
  const ref = context.rulePackRef;
  const rule = ref ? [...catalog.rulePacks, ...(catalog.scopedRulePacks ?? [])].find(item => item.id === ref.id && item.version === ref.version) : undefined;
  const ruleHash = rule ? hashRulePack(rule) : null;
  if (rule) {
    const { rows } = await connection.query<{ sha256: string }>('SELECT sha256 FROM production_rule_packs WHERE id=$1 AND version=$2', [rule.id, rule.version]);
    if (rows[0] && rows[0].sha256 !== ruleHash && !blockers.some(item => item.code === 'RULE_PACK_VERSION_CHANGED'))
      blockers.push(startupFinding('RULE_PACK_VERSION_CHANGED', contextMessages.RULE_PACK_VERSION_CHANGED!, 'primary-target', { fields: ['rulePackRef'] }));
  }
  if (p.identity && context.productBrief?.productName && p.identity.productName !== context.productBrief.productName)
    blockers.push(startupFinding('PRODUCT_IDENTITY_MISMATCH', '提交的产品名称与已有员工确认身份不同；请先在产品事实页显式更正身份。',
      'product-info', { fields: ['productBrief.productName'] }));
  const scope = currentStartupScope(p);
  const statistics = startupStatistics(p, context);
  if (!scope.materials.length && !scope.manualEvidence.length)
    blockers.push(startupFinding('STARTUP_MATERIAL_REQUIRED', '请先上传至少一份原件，或补充有来源的产品证据。', 'materials'));
  const existingStartup = startupStatus(p, execution);
  if (p.runs.some(run => run.queueStatus !== 'done' && run.id !== p.production?.startup?.runId))
    blockers.push(startupFinding('RUN_ALREADY_ACTIVE', '项目已有其它在途任务；请等待其结束后再启动本次提取。', 'creation-confirmation'));
  if (p.production?.startup) {
    const startup = p.production.startup;
    const bindingError = startupBindingError(p, startup);
    if (bindingError) blockers.push(startupFinding(bindingError, bindingMessages[bindingError]!, 'creation-confirmation'));
    if (startupHash(context) !== startup.contextSha256 || ruleHash !== startup.rulePackSha256)
      blockers.push(startupFinding('STARTUP_CONTEXT_ALREADY_SUBMITTED', '项目已经建立初始启动；新上下文不能覆盖原启动输入，请在事实页查看原记录。', 'creation-confirmation'));
    if (!sameSourceScope(scope, startup.scope))
      blockers.push(startupFinding('STARTUP_SCOPE_REVIEW_REQUIRED', '项目已有启动范围；新增资料需在产品事实页明确复核范围，不能通过再次创建项目自动纳入。', 'creation-confirmation'));
  }
  if (!context.productBrief?.internalCode) suggestions.push(startupFinding('INTERNAL_CODE_OPTIONAL', '内部编号可稍后补充。', 'product-info', { fields: ['productBrief.internalCode'] }));
  if (!context.productBrief?.commercialIntent) suggestions.push(startupFinding('COMMERCIAL_INTENT_OPTIONAL', '可补充希望消费者记住的重点；它仅提供商业意图，不会成为已确认事实。', 'product-info', { fields: ['productBrief.commercialIntent'] }));
  if (!statistics.availableImageAssets) suggestions.push(startupFinding('IMAGE_ASSET_RECOMMENDED', '尚无已确认用途的图片素材，可在产品事实页处理或后续补充。', 'materials'));
  const readiness = extractionReadiness(p, scope, execution);
  suggestions.push(...readiness.prerequisites.filter(item => ['MATERIAL_PARSE_FAILED', 'MATERIAL_USAGE_REVIEW_REQUIRED', 'MATERIAL_PARSE_PENDING'].includes(item.code)));
  const inputFingerprint = startupHash({ projectId: p.id, context, rulePackSha256: ruleHash, sourceScope: { materials: scope.materials, manualEvidence: scope.manualEvidence } });
  const canQueueExtraction = !blockers.length && !!snapshot && execution.status !== 'unavailable'
    && readiness.sources.length > 0 && !existingStartup?.runId;
  return { contractVersion: STARTUP_CONTRACT_VERSION, projectId: p.id, projectVersion: p.version, revision: p.revision,
    inputFingerprint, canStart: !blockers.length, canQueueExtraction,
    nextState: blockers.length ? 'blocked' : existingStartup?.state ?? (canQueueExtraction ? 'queued' : readiness.state),
    blockers, suggestions, extractionPrerequisites: existingStartup?.prerequisites ?? readiness.prerequisites,
    statistics, materialIds: scope.materials.map(item => item.id), manualEvidenceIds: scope.manualEvidence.map(item => item.id),
    modelExecution: execution, existingStartup };
}
export function assertStartupCheck(check: StartupCheck, inputFingerprint: string) {
  if (!check.canStart) throw new AppError('STARTUP_BLOCKED', 409, { blockers: check.blockers, inputFingerprint: check.inputFingerprint });
  if (check.inputFingerprint !== inputFingerprint) throw new AppError('STARTUP_CHECK_CHANGED', 409,
    { inputFingerprint: check.inputFingerprint, recovery: '请重新检查当前表单和已接收资料，再明确提交启动。' });
}
export function registerStartup(p: Project, snapshot: ProjectContextVersion, inputFingerprint: string, actor: string) {
  if (p.production!.startup) throw new AppError('STARTUP_ALREADY_CREATED', 409);
  const at = new Date().toISOString();
  if (!p.identity) {
    p.identity = { productName: snapshot.context.productBrief.productName, confirmedBy: actor, confirmedAt: at };
    p.identityRevision = 1; p.version++;
    p.inputRevision = p.revision; delete p.qa;
    audit(p, 'identity.employee_answer', actor, { productName: p.identity.productName, source: 'project_startup' });
  }
  const scope = currentStartupScope(p);
  const startup: ProjectStartup = { contractVersion: STARTUP_CONTRACT_VERSION, id: randomUUID(), context: structuredClone(snapshot.context),
    contextVersion: snapshot.version, contextSha256: startupHash(snapshot.context), rulePackSha256: snapshot.rulePackSha256,
    identity: { productName: p.identity.productName, revision: p.identityRevision ?? 1 }, inputFingerprint,
    submittedAt: at, submittedBy: actor, scope, history: [{ type: 'started', actor, at, scopeSha256: startupHash(scope) }] };
  p.production!.startup = startup;
}
export function enqueueStartup(p: Project, execution: StartupExecutionCapability, actor: string): boolean {
  const startup = assertStartupBinding(p);
  if (startup.runId) return false;
  const readiness = extractionReadiness(p, startup.scope, execution);
  if (readiness.state !== 'ready_to_extract') return false;
  enqueue(p, 'extract-facts', actor);
  const run = p.runs.at(-1)!;
  startup.runId = run.id;
  run.startupInput = { startupId: startup.id, contextVersion: startup.contextVersion, contextSha256: startup.contextSha256,
    rulePackSha256: startup.rulePackSha256, identity: structuredClone(startup.identity), scopeSha256: startupHash(startup.scope),
    evidence: readiness.sources.map(startupEvidenceRef) };
  validateStartupRun(p, run);
  startup.history.push({ type: 'extraction_queued', at: new Date().toISOString(), actor, scopeSha256: startupHash(startup.scope),
    runId: run.id, evidenceIds: run.startupInput.evidence.map(ref => ref.id) });
  audit(p, 'startup.extraction_queued', actor, { startupId: startup.id, runId: run.id, evidenceIds: run.startupInput.evidence.map(ref => ref.id) });
  return true;
}
export function continuationIsNoop(p: Project, execution: StartupExecutionCapability): boolean {
  const startup = requireStartup(p);
  if (startup.runId) {
    if (!p.runs.some(run => run.id === startup.runId)) throw new AppError('STARTUP_RUN_NOT_FOUND', 409);
    return true;
  }
  assertStartupBinding(p);
  if (p.runs.some(run => run.queueStatus !== 'done')) throw new AppError('RUN_ALREADY_ACTIVE', 409);
  return extractionReadiness(p, startup.scope, execution).state !== 'ready_to_extract';
}
export function refreshStartupScope(p: Project, inputFingerprint: string, reason: string, actor: string, dryRun = false): boolean {
  const startup = assertStartupBinding(p);
  if (startup.runId) throw new AppError('STARTUP_SCOPE_LOCKED', 409, { recovery: '初始提取已排队，不能更改其范围；请保留原任务，后续资料需要独立新批次。' });
  const additions = startupScopeAdditions(p, startup.scope);
  if (scopeRefreshFingerprint(startup, additions) !== inputFingerprint) throw new AppError('STARTUP_SCOPE_CHECK_CHANGED', 409,
    { recovery: '新增资料范围已变化，请重新查看并复核资料差异。' });
  if (!additions.materials.length && !additions.manualEvidence.length) return false;
  if (dryRun) return true;
  const previousScopeSha256 = startupHash(startup.scope);
  startup.scope.version++;
  startup.scope.materials.push(...additions.materials);
  startup.scope.manualEvidence.push(...additions.manualEvidence);
  startup.scope.materials.sort((a, b) => a.id < b.id ? -1 : 1);
  startup.scope.manualEvidence.sort((a, b) => a.id < b.id ? -1 : 1);
  startup.history.push({ type: 'scope_refreshed', at: new Date().toISOString(), actor, reason, previousScopeSha256,
    scopeSha256: startupHash(startup.scope), addedMaterialIds: additions.materials.map(ref => ref.id), addedManualEvidenceIds: additions.manualEvidence.map(ref => ref.id) });
  audit(p, 'startup.scope_refreshed', actor, { startupId: startup.id, reason, previousScopeSha256, scopeSha256: startupHash(startup.scope),
    addedMaterialIds: additions.materials.map(ref => ref.id), addedManualEvidenceIds: additions.manualEvidence.map(ref => ref.id) });
  return true;
}
