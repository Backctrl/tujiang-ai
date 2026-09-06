import type { Project } from '../../../backend/src/contracts.js'
import type { RulePack } from '../../../backend/src/production-context.js'
import { contextFieldLabel, isRuleCatalog } from './project-context.js'
export type { Project, Fact, Storyboard, Section } from '../../../backend/src/contracts.js'
export type ProjectSummary = Pick<Project, 'id' | 'name' | 'version' | 'revision' | 'contractVersion'> & { updatedAt: string }

export class ApiError extends Error {
  constructor(public code: string, public status: number, public fields: string[] = []) { super(code) }
}

// Same-origin only: the reverse proxy owns the backend destination, never the browser token.
export class StageAApi {
  constructor(private token: string, private request: typeof fetch = fetch) {}
  async catalog(): Promise<RulePack[]> {
    let response: Response
    try {
      response = await this.request('/api/production/catalog', { headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) })
    } catch { throw new ApiError('CONNECTION_UNCERTAIN', 0) }
    if (!response.ok) throw new ApiError(response.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED', response.status)
    const data: unknown = await response.json().catch(() => { throw new ApiError('INVALID_PRODUCTION_CATALOG', 502) })
    if (!isRuleCatalog(data)) throw new ApiError('INVALID_PRODUCTION_CATALOG', 502)
    return data.rulePacks
  }
  async list(): Promise<ProjectSummary[]> {
    const response = await this.request('/api/projects', { headers: { Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new ApiError(response.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED', response.status)
    const data = await response.json()
    if (!Array.isArray(data.projects) || !data.projects.every((p: ProjectSummary) => typeof p.id === 'string' && typeof p.name === 'string' && Number.isInteger(p.revision) && Number.isInteger(p.version) && p.contractVersion === 'stage-a.1' && typeof p.updatedAt === 'string')) throw new ApiError('INVALID_RESPONSE', 502)
    return data.projects
  }
  async send(path: string, body?: Record<string, unknown>): Promise<Project> {
    let response: Response
    try {
      response = await this.request(`/api${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch { throw new ApiError('CONNECTION_UNCERTAIN', 0) }
    const data = await response.json().catch(() => { throw new ApiError('INVALID_RESPONSE', response.status) })
    if (!response.ok) {
      const fields: unknown = data.error?.fields ?? data.error?.details?.fields
      throw new ApiError(data.error?.code ?? 'REQUEST_FAILED', response.status, Array.isArray(fields) ? fields.filter((field): field is string => typeof field === 'string') : [])
    }
    if (data.contractVersion !== 'stage-a.1' || typeof data.id !== 'string' || !Number.isInteger(data.revision) ||
      !Number.isInteger(data.version) || !Array.isArray(data.facts) || !Array.isArray(data.evidence) ||
      !Array.isArray(data.runs) || !Array.isArray(data.sections) || !Array.isArray(data.audit)) throw new ApiError('INVALID_RESPONSE', 502)
    return data as Project
  }
  get(id: string) { return this.send(`/projects/${encodeURIComponent(id)}`) }
  create(name: string, key = crypto.randomUUID()) {
    return this.send('/projects', { name, expectedProjectVersion: 0, expectedRevision: 0, idempotencyKey: key })
  }
  write(project: Project, suffix: string, fields: Record<string, unknown> = {}, key = crypto.randomUUID()) {
    return this.send(`/projects/${encodeURIComponent(project.id)}/${suffix}`, {
      ...fields, expectedProjectVersion: project.version, expectedRevision: project.revision, idempotencyKey: key,
    })
  }
}

const messages: Record<string, string> = {
  UNAUTHORIZED: '连接凭据无效或已失效，请重新输入凭据。',
  INVALID_REQUEST: '有字段不符合接口要求，请检查输入。',
  VERSION_CONFLICT: '项目已被其他操作更新。请读取最新版本，复核差异后重新提交。',
  REVISION_CONFLICT: '项目已被其他操作更新。请读取最新版本，复核差异后重新提交。',
  CONNECTION_UNCERTAIN: '连接中断，结果尚未确认。请读取最新项目核对；重试原请求会保留同一个操作编号。',
  INVALID_RESPONSE: '服务返回内容不符合阶段 A 契约，请检查 API 代理与后端版本。',
  INVALID_PRODUCTION_CATALOG: '平台规则目录暂不可用，请重新读取或联系维护人员核对。',
  PRODUCTION_NOT_INITIALIZED: '请先在项目设置明确开启制作配置，再保存草稿。',
  UNSUPPORTED_PRODUCTION_CONTRACT: '当前制作配置与服务版本不兼容，请更新客户端后重试。',
  PRODUCTION_CONTEXT_INCOMPLETE: '制作配置尚未完整，请补齐列出的字段后启用。',
  RULE_PACK_UNAVAILABLE: '所选平台规则版本暂不可用。可保留草稿，补齐规则或重新选择后启用。',
  RULE_PACK_TARGET_MISMATCH: '目标市场与所选平台规则不一致，请核对列出的目标字段。',
  CANVAS_OUTSIDE_RULE_PACK: '图片宽度或格式超出所选平台规则，请按允许值修改。',
  RULE_PACK_VERSION_CHANGED: '已使用的平台规则内容发生变化，请核验并提供新规则版本后启用。',
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
  return error instanceof ApiError ? `${messages[error.code] ?? '操作未完成，请核对当前项目和前置条件。'}（${error.code}${error.fields.length ? `：${error.fields.map(contextFieldLabel).join('、')}` : ''}）` : '操作未完成，请稍后检查连接。'
}
