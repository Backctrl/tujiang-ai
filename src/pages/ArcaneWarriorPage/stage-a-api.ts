import type { Project } from '../../../backend/src/contracts.js'
import type { RulePack } from '../../../backend/src/production-context.js'
import type { RuleCatalog } from './rule-catalog.js'
import type { MaterialReviewCenter } from '../../../backend/src/production-material-usage.js'
import { contextFieldLabel, isRuleCatalog } from './project-context.js'
import { isMaterialReviewCenter } from './material-review.js'
import { isStartupCheck, isStartupRead, isStartupStatus, startupStatusMatchesProject, type StartupCheck, type StartupRead, type StartupStatus } from './startup-contract.js'
import type { ContextDraft } from '../../../backend/src/production-context.js'
export type { Project, Fact, Storyboard, Section } from '../../../backend/src/contracts.js'
export type ProjectSummary = Pick<Project, 'id' | 'name' | 'version' | 'revision' | 'contractVersion'> & { updatedAt: string }
export type PreparedProjectWrite = Readonly<{ projectId: string; suffix: string; body: string }>

export function prepareProjectWrite(project: Project, suffix: string, fields: Record<string, unknown> = {}, key = crypto.randomUUID()): PreparedProjectWrite {
  return Object.freeze({ projectId: project.id, suffix, body: JSON.stringify({
    ...fields, expectedProjectVersion: project.version, expectedRevision: project.revision, idempotencyKey: key,
  }) })
}

export class ApiError extends Error {
  constructor(public code: string, public status: number, public fields: string[] = [], public hint = '') { super(code) }
}

export function writeFailureKind(error: unknown): 'conflict' | 'rejected' | 'uncertain' {
  if (error instanceof ApiError && ['VERSION_CONFLICT', 'REVISION_CONFLICT'].includes(error.code)) return 'conflict'
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.code !== 'INVALID_RESPONSE' ? 'rejected' : 'uncertain'
}

function responseError(response: Response, data: { error?: { code?: string; fields?: unknown; details?: { fields?: unknown; hint?: unknown } } }) {
  const fields: unknown = data.error?.fields ?? data.error?.details?.fields
  const hint = data.error?.details?.hint
  return new ApiError(data.error?.code ?? (response.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED'), response.status,
    Array.isArray(fields) ? fields.filter((field): field is string => typeof field === 'string') : [], typeof hint === 'string' ? hint : '')
}

// Same-origin only: the reverse proxy owns the backend destination, never the browser token.
export class StageAApi {
  constructor(private token: string, private request: typeof fetch = fetch) {}
  async startupRequest(projectId: string, suffix = '', body?: string): Promise<unknown> {
    let response: Response
    try { response = await this.request(`/api/projects/${encodeURIComponent(projectId)}/production/startup${suffix ? `/${suffix}` : ''}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(15000), ...(body ? { body } : {}),
    }) } catch { throw new ApiError('CONNECTION_UNCERTAIN', 0) }
    const data: unknown = await response.json().catch(() => { if (!response.ok) return {}; throw new ApiError('INVALID_STARTUP_RESPONSE', 502) })
    if (!response.ok) throw responseError(response, (data ?? {}) as Parameters<typeof responseError>[1])
    return data
  }
  async startupCheck(projectId: string, context: ContextDraft): Promise<StartupCheck> {
    const data = await this.startupRequest(projectId, 'check', JSON.stringify({ context }))
    if (!isStartupCheck(data) || data.projectId !== projectId) throw new ApiError('INVALID_STARTUP_RESPONSE', 502)
    return data
  }
  async startup(projectId: string): Promise<StartupRead> {
    const data = await this.startupRequest(projectId)
    if (!isStartupRead(data) || data.projectId !== projectId) throw new ApiError('INVALID_STARTUP_RESPONSE', 502)
    return data
  }
  async startupCommand(prepared: PreparedProjectWrite): Promise<{ project: Project; startup: StartupStatus }> {
    const data = await this.startupRequest(prepared.projectId, prepared.suffix.replace('production/startup/', ''), prepared.body) as { project?: unknown; startup?: unknown }
    if (!data || !isProjectResponse(data.project) || data.project.id !== prepared.projectId || !isStartupStatus(data.startup)
      || !startupStatusMatchesProject(data.startup, data.project)) throw new ApiError('INVALID_STARTUP_RESPONSE', 502)
    return { project: data.project, startup: data.startup }
  }
  async materialReviews(projectId: string): Promise<MaterialReviewCenter> {
    let response: Response
    try {
      response = await this.request(`/api/projects/${encodeURIComponent(projectId)}/production/material-reviews`, {
        headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
      })
    } catch { throw new ApiError('CONNECTION_UNCERTAIN', 0) }
    const data: unknown = await response.json().catch(() => { if (!response.ok) return {}; throw new ApiError('INVALID_MATERIAL_REVIEWS', 502) })
    if (!response.ok) throw responseError(response, (data ?? {}) as Parameters<typeof responseError>[1])
    if (!isMaterialReviewCenter(data) || data.projectId !== projectId) throw new ApiError('INVALID_MATERIAL_REVIEWS', 502)
    return data
  }
  async catalog(): Promise<RulePack[]> { return (await this.ruleCatalog()).rulePacks }
  async ruleCatalog(): Promise<RuleCatalog> {
    let response: Response
    try {
      response = await this.request('/api/production/catalog', { headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) })
    } catch { throw new ApiError('CONNECTION_UNCERTAIN', 0) }
    if (!response.ok) throw new ApiError(response.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED', response.status)
    const data: unknown = await response.json().catch(() => { throw new ApiError('INVALID_PRODUCTION_CATALOG', 502) })
    if (!isRuleCatalog(data)) throw new ApiError('INVALID_PRODUCTION_CATALOG', 502)
    return { ...data, scopedRulePacks: data.scopedRulePacks ?? [] }
  }
  async list(): Promise<ProjectSummary[]> {
    const response = await this.request('/api/projects', { headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new ApiError(response.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED', response.status)
    const data = await response.json()
    if (!Array.isArray(data.projects) || !data.projects.every((p: ProjectSummary) => typeof p.id === 'string' && typeof p.name === 'string' && Number.isInteger(p.revision) && Number.isInteger(p.version) && p.contractVersion === 'stage-a.1' && typeof p.updatedAt === 'string')) throw new ApiError('INVALID_RESPONSE', 502)
    return data.projects
  }
  async original(projectId: string, materialId: string): Promise<Blob> {
    let response: Response
    try {
      response = await this.request(`/api/projects/${encodeURIComponent(projectId)}/production/materials/${encodeURIComponent(materialId)}/original`, {
        headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
      })
    } catch { throw new ApiError('CONNECTION_UNCERTAIN', 0) }
    if (!response.ok) throw responseError(response, await response.json().catch(() => ({})))
    try { return await response.blob() } catch { throw new ApiError('CONNECTION_UNCERTAIN', 0) }
  }
  async send(path: string, body?: Record<string, unknown> | string): Promise<Project> {
    let response: Response
    try {
      response = await this.request(`/api${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      })
    } catch { throw new ApiError('CONNECTION_UNCERTAIN', 0) }
    const data = await response.json().catch(() => { throw new ApiError('INVALID_RESPONSE', response.status) })
    if (!response.ok) {
      throw responseError(response, data)
    }
    if (!isProjectResponse(data)) throw new ApiError('INVALID_RESPONSE', 502)
    return data as Project
  }
  get(id: string) { return this.send(`/projects/${encodeURIComponent(id)}`) }
  create(name: string, key = crypto.randomUUID()) {
    return this.send('/projects', { name, expectedProjectVersion: 0, expectedRevision: 0, idempotencyKey: key })
  }
  write(project: Project, suffix: string, fields: Record<string, unknown> = {}, key = crypto.randomUUID()) {
    return this.executePrepared(prepareProjectWrite(project, suffix, fields, key))
  }
  executePrepared(prepared: PreparedProjectWrite) { return this.send(`/projects/${encodeURIComponent(prepared.projectId)}/${prepared.suffix}`, prepared.body) }
}

export function isProjectResponse(data: unknown): data is Project {
  if (!data || typeof data !== 'object') return false
  const value = data as Partial<Project>
  return value.contractVersion === 'stage-a.1' && typeof value.id === 'string' && Number.isInteger(value.revision) && Number.isInteger(value.version)
    && Array.isArray(value.facts) && Array.isArray(value.evidence) && Array.isArray(value.runs) && Array.isArray(value.sections) && Array.isArray(value.audit)
}

const messages: Record<string, string> = {
  UNAUTHORIZED: '连接凭据无效或已失效，请重新输入凭据。',
  INVALID_REQUEST: '有字段不符合接口要求，请检查输入。',
  VERSION_CONFLICT: '项目已被其他操作更新。请读取最新版本，复核差异后重新提交。',
  REVISION_CONFLICT: '项目已被其他操作更新。请读取最新版本，复核差异后重新提交。',
  CONNECTION_UNCERTAIN: '连接中断，结果尚未确认。请读取最新项目核对；重试原请求会保留同一个操作编号。',
  INVALID_RESPONSE: '服务返回内容不符合阶段 A 契约，请检查 API 代理与后端版本。',
  INVALID_STARTUP_RESPONSE: '启动检查或状态返回不完整，请重新读取并核对服务版本。',
  INVALID_SETUP_RECOVERY: '项目启动恢复记录不完整，新的写入已暂停。请核对浏览器中的原请求。',
  SETUP_INPUT_CHANGED: '本地配置或项目已变化，请重新检查后提交。',
  SETUP_REQUEST_REJECTED: '原请求已被明确拒绝。读取最新状态并复核失败原因后，再明确重新提交。',
  LOCAL_SETUP_REJECTION_SAVE_FAILED: '原请求已被拒绝，但浏览器未能保存拒绝标记。请恢复存储并读取最新状态后复核原请求。',
  LOCAL_DRAFT_RECOVERY_CONFLICT: '本地输入与恢复记录的先后顺序不明确，请比较并选择要继续使用的输入。',
  INVALID_PRODUCTION_CATALOG: '平台规则目录暂不可用，请重新读取或联系维护人员核对。',
  PRODUCTION_NOT_INITIALIZED: '请先在项目设置明确开启制作配置，再保存草稿。',
  FILE_TOO_LARGE: '单个原件最多 10 MiB，请缩小文件后重新选择。',
  EMPTY_FILE: '文件没有内容，请选择有内容的原件。',
  UNSUPPORTED_FILE_TYPE: '暂不支持该文件格式，请导出为 TXT、Markdown、CSV、JSON、PNG、JPEG 或 WebP。',
  FILE_TYPE_MISMATCH: '文件名、声明格式与实际内容不一致，请保留真实文件格式。',
  INVALID_FILE_ENCODING: '无法读取原始文件内容，请重新选择文件。',
  MATERIAL_LIMIT: '本项目已达到 50 份解析原件的上限。',
  MATERIAL_NOT_FOUND: '此项目中未找到该原件，请刷新资料列表。',
  PARSE_RETRY_NOT_ALLOWED: '该文件当前不处于解析失败状态，请刷新资料列表。',
  SOURCE_FILE_MISSING: '原件暂不可用，请重新上传相同原件后重试解析。',
  SOURCE_FILE_INTEGRITY_FAILED: '原件完整性检查未通过，请联系维护人员恢复正确原件。',
  ORIGINAL_INTEGRITY_MISMATCH: '下载内容与原件记录不一致，已停止保存，请刷新后重试。',
  LOCAL_FILE_READ_FAILED: '无法读取本地文件，请重新选择原件。',
  LOCAL_RECOVERY_SAVE_FAILED: '无法保存浏览器恢复记录，可能是存储不可用或空间不足。本次请求尚未发送，请恢复浏览器存储后重试。',
  LOCAL_RECOVERY_SETTLE_FAILED: '服务已返回结果，但浏览器恢复记录未能更新。请恢复浏览器存储后使用原操作重试核对。',
  LOCAL_RECOVERY_READ_FAILED: '无法读取浏览器恢复记录，新的写入已暂停。请检查浏览器存储后重新读取。',
  INVALID_MATERIAL_RECOVERY: '材料恢复记录不完整，新的写入已暂停。请联系维护人员核对浏览器中的原请求。',
  INVALID_MATERIAL_REVIEWS: '待处理任务返回内容不完整，请重新读取或核对服务版本。',
  INVALID_REVIEW_REQUEST: '审核请求类型或字段不符合当前接口，请刷新后重试。',
  MATERIAL_BLOCK_NOT_FOUND: '资料块已不可用，请读取最新原件并重新选择。',
  MATERIAL_PARSE_REQUIRED: '请等待原件成功解析后再审核用途。',
  MATERIAL_SOURCE_INVALID: '原件或用途来源已变化，请读取最新项目并复核该资料块。',
  TEXT_EVIDENCE_REQUIRED: '只有文字资料块可作为产品证据；图片可选择素材或参考用途。',
  DECODED_IMAGE_REQUIRED: '只有成功解码的图片资料块可作为可用素材。',
  SOURCE_RECONFIRMATION_NOT_REQUIRED: '该事实当前无需来源重确认，请读取最新任务。',
  INVALID_RECONFIRMATION_SOURCE: '新证据必须来自同一原件、同一资料块，并包含原事实摘录。',
  UNSUPPORTED_PRODUCTION_CONTRACT: '当前制作配置与服务版本不兼容，请更新客户端后重试。',
  PRODUCTION_CONTEXT_INCOMPLETE: '制作配置尚未完整，请补齐列出的字段后启用。',
  RULE_PACK_UNAVAILABLE: '所选平台规则版本暂不可用。可保留草稿，补齐规则或重新选择后启用。',
  RULE_PACK_TARGET_MISMATCH: '目标市场与所选平台规则不一致，请核对列出的目标字段。',
  CANVAS_OUTSIDE_RULE_PACK: '图片宽度或格式超出所选平台规则，请按允许值修改。',
  RULE_PACK_VERSION_CHANGED: '已使用的平台规则内容发生变化，请核验并提供新规则版本后启用。',
  SCOPED_RULE_PACK_REQUIRED: '当前草稿含内容类型或本地制作策略，需要选择按范围核验的目标规则。',
  SCOPED_CONTENT_TYPE_REQUIRED: '请明确选择内容类型，再启用制作配置。',
  LOCAL_PRODUCTION_SELECTION_REQUIRED: '请明确按本地制作策略选择画布。',
  RULE_PACK_INCOMPLETE: '当前内容类型或品类的启用规则缺失或尚未核验，请补齐对应规则。',
  CANVAS_OUTSIDE_LOCAL_PRODUCTION_POLICY: '画布宽度或格式超出本地制作策略，请按当前策略修改。',
  UNRESOLVED_FACT_CONFLICT: '存在事实冲突。请逐条拒绝新候选，或撤回旧事实后确认新候选。',
  INVALID_EVIDENCE_REFERENCE: '引用必须是所选产品资料中连续、完全一致的原文。',
  CONFIRMED_CORE_FACT_REQUIRED: '请先确认至少一条核心事实。',
  CONFIRMED_PRODUCT_IDENTITY_REQUIRED: '请先在项目设置确认产品身份。',
  STALE_STORYBOARD: '故事顺序已失效，请根据当前身份与事实复核并保存。',
  CURRENT_STORYBOARD_REQUIRED: '请先在故事线保存或应用一份有效顺序，再保存章节诊断稿。',
  SECTION_OUTSIDE_STORYBOARD: '此稿或事实不属于当前故事顺序，请重新绑定当前故事线的已确认事实。',
  UNCONFIRMED_FACT_REFERENCE: '引用的事实已撤回或尚未确认，请移除或重新绑定后保存新稿。',
  STALE_SECTION: '章节草稿已失效，请复核依赖后保存新草稿。',
}
export function errorMessage(error: unknown) {
  return error instanceof ApiError ? `${error.hint || messages[error.code] || '操作未完成，请核对当前项目和前置条件。'}（${error.code}${error.fields.length ? `：${error.fields.map(contextFieldLabel).join('、')}` : ''}）` : '操作未完成，请稍后检查连接。'
}
