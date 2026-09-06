import type { Project } from '../../../backend/src/contracts.js'
export type { Project, Fact, Storyboard, Section } from '../../../backend/src/contracts.js'

export class ApiError extends Error {
  constructor(public code: string, public status: number, public fields: string[] = []) { super(code) }
}

// Same-origin only: the reverse proxy owns the backend destination, never the browser token.
export class StageAApi {
  constructor(private token: string, private request: typeof fetch = fetch) {}
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
    if (!response.ok) throw new ApiError(data.error?.code ?? 'REQUEST_FAILED', response.status, data.error?.fields)
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
  return error instanceof ApiError ? `${messages[error.code] ?? '操作未完成，请核对当前项目和前置条件。'}（${error.code}${error.fields.length ? `：${error.fields.join('、')}` : ''}）` : '操作未完成，请稍后检查连接。'
}
