import type { Material, MaterialBlock, MaterialSource } from '../../../backend/src/production-materials.js'
import { ApiError, errorMessage, prepareProjectWrite, writeFailureKind, type Project, type StageAApi } from './stage-a-api.js'
import type { MaterialIntakeStorage, MaterialLocalEntry, MaterialOperation } from './material-storage.js'
import { sameJsonValue } from './project-drafts.js'

export const materialFileAccept = '.txt,.md,.markdown,.csv,.json,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,text/csv,application/json,image/png,image/jpeg,image/webp'
export const maxMaterialFileBytes = 10 * 1024 * 1024
export type MaterialSourceForm = { kind: 'local_upload' | 'feishu_export'; url: string; title: string; revision: string; locator: string }
export const emptyMaterialSource: MaterialSourceForm = { kind: 'local_upload', url: '', title: '', revision: '', locator: '' }
function storageText(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 0) return false
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false }
    else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}
export function compileMaterialSource(form: MaterialSourceForm): { source: MaterialSource; errors: Partial<Record<keyof MaterialSourceForm, string>> } {
  const source: MaterialSource = { kind: form.kind }
  const errors: Partial<Record<keyof MaterialSourceForm, string>> = {}
  const limits = { url: 2000, title: 300, revision: 100, locator: 500 }
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = form[key].trim()
    if (value.length > limits[key] || !storageText(value)) errors[key] = '内容过长或包含无法保存的字符，请检查。'
    if (value) source[key] = value
  }
  if (source.url) {
    try { if (!['http:', 'https:'].includes(new URL(source.url).protocol)) errors.url = '请填写完整的 HTTP 或 HTTPS 原文链接。' }
    catch { errors.url = '请填写完整的 HTTP 或 HTTPS 原文链接。' }
  } else if (source.kind === 'feishu_export') errors.url = '飞书导出资料需要原文链接。'
  return { source, errors }
}

export async function fileContentBase64(file: Blob): Promise<string> {
  if (file.size > maxMaterialFileBytes) throw new ApiError('FILE_TOO_LARGE', 413)
  if (!file.size) throw new ApiError('EMPTY_FILE', 400)
  let bytes: Uint8Array
  try { bytes = new Uint8Array(await file.arrayBuffer()) } catch { throw new ApiError('LOCAL_FILE_READ_FAILED', 0) }
  let binary = ''
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768))
  return btoa(binary)
}

// Read the current receipt after reading bytes; an SSE snapshot may arrive while the File is read.
export async function prepareMaterialUpload(entry: MaterialLocalEntry, getLatestProject: () => Project | null): Promise<MaterialOperation> {
  const contentBase64 = await fileContentBase64(entry.file)
  const before = getLatestProject()
  if (!before || before.id !== entry.projectId) throw new ApiError('PROJECT_CHANGED_DURING_UPLOAD', 409)
  return { id: 'active', kind: 'upload', entryId: entry.id, before: structuredClone(before), parseProgressRebases: 0, label: `原件「${entry.fileName}」已接收，解析状态将自动更新。`,
    prepared: prepareProjectWrite(before, 'production/materials', { fileName: entry.fileName, mimeType: entry.mimeType, contentBase64, source: entry.source }) }
}
export function prepareMaterialRetry(before: Project, materialId: string): MaterialOperation {
  return { id: 'active', kind: 'parse-retry', before: structuredClone(before), label: '已提交此文件的解析重试，其他资料保持当前状态。',
    prepared: prepareProjectWrite(before, `production/materials/${encodeURIComponent(materialId)}/parse/retry`) }
}

export function receivedMaterial(project: Project): Material {
  const received = project.audit.findLast(item => item.revision === project.revision && ['material.original.received', 'material.original.deduplicated'].includes(item.type))
  const material = project.production?.materials?.find(item => item.id === received?.data.materialId)
  if (!material) throw new ApiError('INVALID_RESPONSE', 502)
  return material
}
export type MaterialWriteOutcome =
  | { kind: 'saved'; project: Project; operation: MaterialOperation }
  | { kind: 'rejected' | 'conflict' | 'uncertain' | 'storage'; error: unknown; operation?: MaterialOperation }
  | { kind: 'blocked' }

export function onlyMaterialParseProgress(before: Project, after: Project) {
  if (after.id !== before.id || after.revision <= before.revision || after.audit.length <= before.audit.length
    || !sameJsonValue(before.audit, after.audit.slice(0, before.audit.length))) return false
  const ids = new Set(before.production?.materials?.map(material => material.id))
  const parserEvents = new Set(['material.parse.started', 'material.parse.succeeded', 'material.parse.failed', 'material.parse.interrupted'])
  if (!after.audit.slice(before.audit.length).every(event => event.actor === 'material-parser' && parserEvents.has(event.type)
    && typeof event.data.materialId === 'string' && ids.has(event.data.materialId)
    && event.revision > before.revision && event.revision <= after.revision)) return false
  const comparable = (project: Project) => ({ ...project, revision: 0, audit: [],
    production: project.production ? { ...project.production, materials: project.production.materials?.map(material => ({ ...material,
      detectedMimeType: undefined, blocks: [],
      // The parser may advance execution, but its identity and original dependency stay fixed.
      parse: { id: material.parse.id, parserVersion: material.parse.parserVersion, sourceSha256: material.parse.sourceSha256 },
    })) } : undefined,
  })
  return sameJsonValue(comparable(before), comparable(after))
}

// The durable boundary is before HTTP. Settlement removes the file and pending request atomically.
export async function executeMaterialOperation(operation: MaterialOperation, api: Pick<StageAApi, 'executePrepared' | 'get'>, storage: MaterialIntakeStorage,
  receiveSnapshot: (project: Project) => void, replay = false, onRebased?: (operation: MaterialOperation) => void): Promise<MaterialWriteOutcome> {
  let current = operation
  const uncertain = async (error: unknown): Promise<MaterialWriteOutcome> => {
    await storage.markUncertain(current, errorMessage(error)).catch(() => undefined)
    return { kind: 'uncertain', error, operation: current }
  }
  // The server already rejected this request. Retrying only repairs its local review record.
  if (operation.conflict) {
    try { await storage.settle(operation, 'conflict', operation.conflict.message) }
    catch { return uncertain(new ApiError('LOCAL_RECOVERY_SETTLE_FAILED', 0)) }
    return { kind: 'conflict', error: new ApiError(operation.conflict.code, 409), operation }
  }
  try { await storage.savePending(operation) }
  catch { return { kind: replay ? 'uncertain' : 'storage', error: new ApiError(replay ? 'LOCAL_RECOVERY_SETTLE_FAILED' : 'LOCAL_RECOVERY_SAVE_FAILED', 0), operation } }
  for (;;) {
    let next: Project
    try {
      next = await api.executePrepared(current.prepared)
      if (next.id !== current.prepared.projectId) throw new ApiError('INVALID_RESPONSE', 502)
      if (current.kind === 'upload') receivedMaterial(next)
      receiveSnapshot(next)
    } catch (error) {
      const kind = current.kind === 'review' && error instanceof ApiError && error.status === 409 ? 'conflict' : writeFailureKind(error)
      if (kind === 'uncertain') return uncertain(error)
      if (!replay && current.kind === 'upload' && error instanceof ApiError && error.status === 409 && error.code === 'REVISION_CONFLICT'
        && (current.parseProgressRebases ?? 0) < 1) {
        let latest: Project
        try {
          latest = await api.get(current.before.id)
          if (latest.id !== current.before.id) throw new ApiError('INVALID_RESPONSE', 502)
          receiveSnapshot(latest)
        } catch (readError) { return uncertain(readError) }
        if (onlyMaterialParseProgress(current.before, latest)) {
          const rebased: MaterialOperation = { ...current, before: structuredClone(latest), parseProgressRebases: 1,
            prepared: prepareProjectWrite(latest, current.prepared.suffix, JSON.parse(current.prepared.body) as Record<string, unknown>),
          }
          // Replace body/key and its used budget together before the next HTTP request.
          try { await storage.replacePending(current, rebased) }
          catch { return uncertain(new ApiError('LOCAL_RECOVERY_SETTLE_FAILED', 0)) }
          current = rebased
          onRebased?.(current)
          continue
        }
      }
      if (kind === 'conflict') current = { ...current, conflict: {
        code: error instanceof ApiError ? error.code : 'REQUEST_FAILED', message: errorMessage(error),
        allowsSameRevision: current.kind === 'review' && error instanceof ApiError && !['VERSION_CONFLICT', 'REVISION_CONFLICT'].includes(error.code),
      } }
      try { await storage.settle(current, kind, errorMessage(error)) }
      catch { return uncertain(new ApiError('LOCAL_RECOVERY_SETTLE_FAILED', 0)) }
      return { kind, error, operation: current }
    }
    try { await storage.settle(current, 'saved') }
    catch { return uncertain(new ApiError('LOCAL_RECOVERY_SETTLE_FAILED', 0)) }
    return { kind: 'saved', project: next, operation: current }
  }
}

export function materialStatus(material: Material) {
  if (material.parse.queueStatus === 'queued') return '排队解析'
  if (material.parse.queueStatus === 'claimed') return '解析中'
  return material.parse.runStatus === 'succeeded' ? '解析成功' : '解析失败'
}
export function materialBlockLocation(block: MaterialBlock) {
  const position = block.locator
  if (position.type === 'image') return '图片第 1 帧'
  const range = `原文字符 ${position.startOffset}–${position.endOffset}（末位不含）`
  if (position.type === 'json') return `JSON Pointer：${position.pointer || '根节点'} · ${range}`
  const lines = position.startLine === position.endLine ? `原文第 ${position.startLine} 行` : `原文第 ${position.startLine}–${position.endLine} 行`
  return `${position.type === 'csv' ? `CSV 第 ${position.row} 行 · ` : ''}${lines} · ${range}`
}
export function safeSourceUrl(value?: string) {
  try { return value && ['http:', 'https:'].includes(new URL(value).protocol) ? value : undefined } catch { return undefined }
}
export async function verifyOriginal(blob: Blob, material: Pick<Material, 'sizeBytes' | 'sha256'>) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  if (blob.size !== material.sizeBytes || sha256 !== material.sha256) throw new ApiError('ORIGINAL_INTEGRITY_MISMATCH', 409)
}
