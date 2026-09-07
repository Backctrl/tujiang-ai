import { ApiError, isProjectResponse, prepareProjectWrite, type PreparedProjectWrite, type Project, type StageAApi } from './stage-a-api.js'
import { projectContextBase, type ContextBase, type ContextForm } from './project-context.js'
import { sameJsonValue } from './project-drafts.js'
import type { MaterialLocalEntry } from './material-storage.js'
import type { StartupStatus } from './startup-contract.js'

export type SetupCapture = { reviewed: { value: ContextForm; base: ContextBase | null; active: boolean }; models: Record<string, unknown> }
export type SetupAction = 'create' | 'initialize' | 'start' | 'continue-extraction' | 'scope-refresh' | 'retry'
export type SetupOperation = { id: 'active'; kind: 'setup'; action: SetupAction; scopeId: string; before: Project | null;
  capture: SetupCapture; prepared: PreparedProjectWrite; label: string; rejected?: true }
export type SetupFlow = { id: string; scopeId: string; capture: SetupCapture; project: Project }
export interface SetupRecoveryStorage {
  readSelection(): Promise<string | undefined>
  selectScope(scopeId: string): Promise<void>
  readPending(): Promise<SetupOperation | undefined>
  readFlow(scopeId: string): Promise<SetupFlow | undefined>
  save(operation: SetupOperation): Promise<void>
  complete(operation: SetupOperation, project: Project): Promise<void>
  release(operation: SetupOperation): Promise<void>
}
const actions: Record<SetupAction, string> = {
  create: '', initialize: 'production/initialize', start: 'production/startup/start',
  'continue-extraction': 'production/startup/continue-extraction', 'scope-refresh': 'production/startup/scope-refresh', retry: '',
}
const labels: Record<SetupAction, string> = { create: '项目草稿已创建', initialize: '资料空间已就绪', start: '项目启动已保存',
  'continue-extraction': '已核对并继续原事实提取', 'scope-refresh': '已加入明确选择的补充资料', retry: '已提交原任务重试' }
export function prepareSetupOperation(scopeId: string, capture: SetupCapture, before: Project | null, action: SetupAction, fields: Record<string, unknown> = {}, runId?: string): SetupOperation {
  const suffix = action === 'retry' ? `runs/${runId ?? ''}/retry` : actions[action]
  const prepared = before ? prepareProjectWrite(before, suffix, fields) : Object.freeze({ projectId: '', suffix: '', body: JSON.stringify({
    name: capture.reviewed.value.productName.trim() || '新建制作项目', expectedProjectVersion: 0, expectedRevision: 0, idempotencyKey: crypto.randomUUID(),
  }) })
  return validateSetupOperation({ id: 'active', kind: 'setup', action, scopeId, before: before ? structuredClone(before) : null, capture: structuredClone(capture), prepared, label: labels[action] })
}
export function validateSetupOperation(value: unknown): SetupOperation {
  const invalid = () => { throw new ApiError('INVALID_SETUP_RECOVERY', 0) }
  if (!value || typeof value !== 'object') return invalid()
  const op = value as SetupOperation
  if (op.id !== 'active' || op.kind !== 'setup' || !Object.hasOwn(actions, op.action) || typeof op.scopeId !== 'string' || !op.scopeId
    || !op.capture?.reviewed || typeof op.capture.reviewed.active !== 'boolean' || !op.capture.reviewed.value || !op.capture.models
    || typeof op.label !== 'string' || !op.prepared || typeof op.prepared.body !== 'string' || op.rejected !== undefined && op.rejected !== true) return invalid()
  const creating = op.action === 'create'
  if (creating ? op.before !== null || op.prepared.projectId !== '' || op.prepared.suffix !== ''
    : !isProjectResponse(op.before) || op.before.id !== op.prepared.projectId || (op.action === 'retry' ? !/^runs\/[a-f\d-]{36}\/retry$/i.test(op.prepared.suffix) : op.prepared.suffix !== actions[op.action])) return invalid()
  let body: Record<string, unknown>
  try { body = JSON.parse(op.prepared.body) as Record<string, unknown> } catch { return invalid() }
  const extra = creating ? ['name'] : op.action === 'start' ? ['context', 'inputFingerprint'] : op.action === 'scope-refresh' ? ['inputFingerprint', 'reason'] : []
  const allowed = ['expectedProjectVersion', 'expectedRevision', 'idempotencyKey', ...extra]
  if (!body || Object.keys(body).some(key => !allowed.includes(key)) || body.expectedProjectVersion !== (op.before?.version ?? 0)
    || body.expectedRevision !== (op.before?.revision ?? 0) || typeof body.idempotencyKey !== 'string' || !/^[a-f\d-]{36}$/i.test(body.idempotencyKey)
    || creating && (typeof body.name !== 'string' || !body.name.trim())
    || (op.action === 'start' || op.action === 'scope-refresh') && (typeof body.inputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.inputFingerprint))
    || op.action === 'start' && (!body.context || typeof body.context !== 'object')
    || op.action === 'scope-refresh' && (typeof body.reason !== 'string' || !body.reason.trim())) return invalid()
  return op
}
const same = (left: unknown, right: SetupOperation) => {
  const item = left as Partial<SetupOperation> | undefined
  return item?.kind === 'setup' && item.scopeId === right.scopeId && item.action === right.action && item.prepared?.projectId === right.prepared.projectId
    && item.prepared?.suffix === right.prepared.suffix && item.prepared?.body === right.prepared.body
}

// The shared pending slot makes setup and material writes mutually exclusive, including across tabs.
// File binding, the confirmed project receipt and releasing the pending slot commit together.
class IndexedSetupRecovery implements SetupRecoveryStorage {
  private opening: Promise<IDBDatabase> | undefined
  private open() {
    this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tujiang_material_intake_v1', 1)
      request.onupgradeneeded = () => {
        const entries = request.result.createObjectStore('entries', { keyPath: 'id' }); entries.createIndex('projectId', 'projectId')
        request.result.createObjectStore('pending', { keyPath: 'id' })
      }
      request.onerror = request.onblocked = () => reject(request.error ?? new Error('Recovery storage blocked'))
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); this.opening = undefined }; resolve(db) }
    }).catch(error => { this.opening = undefined; throw error })
    return this.opening
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['pending', 'entries'], mode); let value: T; let failure: unknown
      tx.oncomplete = () => resolve(value)
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Recovery transaction failed'))
      try { action(tx, next => { value = next }) } catch (error) { failure = error; tx.abort() }
    })
  }
  async readPending() {
    const value = await this.transaction<unknown>('readonly', (tx, result) => { const request = tx.objectStore('pending').get('active'); request.onsuccess = () => result(request.result) })
    return (value as { kind?: string } | undefined)?.kind === 'setup' ? validateSetupOperation(value) : undefined
  }
  readSelection() {
    return this.transaction<string | undefined>('readonly', (tx, result) => { const request = tx.objectStore('pending').get('setup:selection'); request.onsuccess = () => {
      const value = request.result as { scopeId?: unknown } | undefined
      if (value && typeof value.scopeId !== 'string') { tx.abort(); return }
      result(value?.scopeId as string | undefined)
    } })
  }
  selectScope(scopeId: string) {
    return this.transaction<void>('readwrite', tx => {
      const store = tx.objectStore('pending'), request = store.get('active')
      request.onsuccess = () => {
        const current = request.result as { scopeId?: string; before?: Project } | undefined
        if (current && (current.scopeId ?? current.before?.id) !== scopeId) { tx.abort(); return }
        store.put({ id: 'setup:selection', scopeId })
      }
    })
  }
  async readFlow(scopeId: string) {
    const value = await this.transaction<SetupFlow | undefined>('readonly', (tx, result) => {
      const request = tx.objectStore('pending').get(`setup:${scopeId}`)
      request.onsuccess = () => {
        if (request.result) { result(request.result as SetupFlow); return }
        const records = tx.objectStore('pending').getAll()
        records.onsuccess = () => result((records.result as Partial<SetupFlow>[]).find(item => item.project?.id === scopeId && item.id === `setup:${item.scopeId}`) as SetupFlow | undefined)
      }
    })
    if (value && ((value.scopeId !== scopeId && value.project?.id !== scopeId) || !isProjectResponse(value.project) || !value.capture?.reviewed)) throw new ApiError('INVALID_SETUP_RECOVERY', 0)
    return value
  }
  save(operation: SetupOperation) {
    validateSetupOperation(operation)
    return this.transaction<void>('readwrite', tx => {
      const store = tx.objectStore('pending'), request = store.get('active')
      request.onsuccess = () => {
        if (request.result && (!same(request.result, operation) || (request.result as SetupOperation).rejected && !operation.rejected)) { tx.abort(); return }
        store.put(operation)
      }
    })
  }
  complete(operation: SetupOperation, project: Project) {
    if (!isProjectResponse(project) || operation.before && operation.before.id !== project.id) return Promise.reject(new ApiError('INVALID_RESPONSE', 502))
    return this.transaction<void>('readwrite', tx => {
      const store = tx.objectStore('pending'), request = store.get('active')
      request.onsuccess = () => {
        if (!same(request.result, operation)) { tx.abort(); return }
        const capture = structuredClone(operation.capture), base = projectContextBase(project)
        if (operation.action === 'initialize' && !operation.before?.production && base.initialized && !base.draft && !base.activeContext && base.activeVersion === null
          && capture.reviewed.active && sameJsonValue(capture.reviewed.base, projectContextBase(operation.before))) capture.reviewed.base = base
        store.put({ id: `setup:${operation.scopeId}`, scopeId: operation.scopeId, capture, project } satisfies SetupFlow)
        const entries = tx.objectStore('entries'), queued = entries.index('projectId').getAll(operation.scopeId)
        queued.onsuccess = () => {
          for (const entry of queued.result as MaterialLocalEntry[]) entries.put({ ...entry, projectId: project.id })
          store.delete('active')
        }
      }
    })
  }
  release(operation: SetupOperation) {
    return this.transaction<void>('readwrite', tx => { const store = tx.objectStore('pending'), request = store.get('active'); request.onsuccess = () => {
      if (!same(request.result, operation)) { tx.abort(); return }; store.delete('active')
    } })
  }
}
export const setupRecoveryStorage: SetupRecoveryStorage = new IndexedSetupRecovery()
export type SetupOutcome = { kind: 'saved'; project: Project; startup?: StartupStatus; operation: SetupOperation }
  | { kind: 'paused'; error: unknown; operation: SetupOperation; conflict: boolean } | { kind: 'storage'; error: unknown; operation: SetupOperation }
export async function executeSetupOperation(operation: SetupOperation, api: StageAApi, storage: SetupRecoveryStorage): Promise<SetupOutcome> {
  if (operation.rejected) return { kind: 'paused', operation, error: new ApiError('SETUP_REQUEST_REJECTED', 409), conflict: true }
  try { await storage.save(operation) } catch { return { kind: 'storage', operation, error: new ApiError('LOCAL_RECOVERY_SAVE_FAILED', 0) } }
  try {
    const result = operation.action === 'create' ? { project: await api.send('/projects', operation.prepared.body) }
      : ['start', 'continue-extraction', 'scope-refresh'].includes(operation.action) ? await api.startupCommand(operation.prepared)
        : { project: await api.executePrepared(operation.prepared) }
    try { await storage.complete(operation, result.project) } catch { return { kind: 'paused', operation, error: new ApiError('LOCAL_RECOVERY_SETTLE_FAILED', 0), conflict: false } }
    return { kind: 'saved', operation, ...result }
  } catch (error) {
    // Even a 409 remains durable until an explicit read and human review releases this exact request.
    const conflict = error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401
    if (conflict) {
      const rejected: SetupOperation = { ...operation, rejected: true }
      try { await storage.save(rejected) }
      catch { return { kind: 'paused', operation: rejected, error: new ApiError('LOCAL_SETUP_REJECTION_SAVE_FAILED', 0), conflict: true } }
      return { kind: 'paused', operation: rejected, error, conflict: true }
    }
    return { kind: 'paused', operation, error, conflict: false }
  }
}
