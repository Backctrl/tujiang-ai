import type { MaterialSource } from '../../../backend/src/production-materials.js'
import { ApiError, type PreparedProjectWrite, type Project } from './stage-a-api.js'
import { isReviewTarget, reviewFieldsAllowed, type ReviewKind } from './review-requests.js'

export type MaterialLocalEntry = {
  id: string; projectId: string; fileName: string; mimeType: string; sizeBytes: number; file: Blob;
  source: MaterialSource; addedAt: string;
  status: 'waiting' | 'uploading' | 'uncertain' | 'rejected' | 'conflict'; message?: string;
}
export type MaterialOperation = {
  id: 'active'; kind: 'upload' | 'parse-retry' | 'review'; prepared: PreparedProjectWrite; before: Project; label: string; entryId?: string;
  reviewKind?: ReviewKind;
  parseProgressRebases?: number;
}
export interface MaterialIntakeStorage {
  list(projectId: string): Promise<MaterialLocalEntry[]>
  put(entry: MaterialLocalEntry): Promise<void>
  remove(id: string): Promise<void>
  readPending(): Promise<MaterialOperation | undefined>
  savePending(operation: MaterialOperation): Promise<void>
  replacePending(previous: MaterialOperation, operation: MaterialOperation): Promise<void>
  settle(operation: MaterialOperation, result: 'saved' | 'rejected' | 'conflict', message?: string): Promise<void>
  markUncertain(operation: MaterialOperation, message: string): Promise<void>
  subscribe(listener: () => void): () => void
}

export function validateMaterialOperation(value: unknown): MaterialOperation {
  if (!value || typeof value !== 'object') throw new ApiError('INVALID_MATERIAL_RECOVERY', 0)
  const op = value as Partial<MaterialOperation>
  const p = op.before
  if (op.id !== 'active' || !op.prepared || typeof op.prepared.body !== 'string' || typeof op.label !== 'string' ||
    !p || p.contractVersion !== 'stage-a.1' || typeof p.id !== 'string' || !Number.isInteger(p.revision) || !Number.isInteger(p.version) ||
    !Array.isArray(p.facts) || !Array.isArray(p.evidence) || !Array.isArray(p.runs) || !Array.isArray(p.sections) || !Array.isArray(p.audit) ||
    op.prepared.projectId !== p.id ||
    (op.parseProgressRebases !== undefined && (!Number.isInteger(op.parseProgressRebases) || op.parseProgressRebases < 0 || op.parseProgressRebases > 1)) ||
    !(op.kind === 'upload' && op.prepared.suffix === 'production/materials' && typeof op.entryId === 'string') &&
    !(op.kind === 'parse-retry' && /^production\/materials\/[a-f\d-]+\/parse\/retry$/i.test(op.prepared.suffix)) &&
    !(op.kind === 'review' && op.entryId === undefined && op.parseProgressRebases === undefined && isReviewTarget(op.reviewKind, op.prepared.suffix))) throw new ApiError('INVALID_MATERIAL_RECOVERY', 0)
  let body: Record<string, unknown>
  try { body = JSON.parse(op.prepared.body) as Record<string, unknown> } catch { throw new ApiError('INVALID_MATERIAL_RECOVERY', 0) }
  if (!body || body.expectedProjectVersion !== p.version || body.expectedRevision !== p.revision ||
    typeof body.idempotencyKey !== 'string' || !/^[a-f\d-]{36}$/i.test(body.idempotencyKey) ||
    (op.kind === 'upload' && (typeof body.contentBase64 !== 'string' || typeof body.fileName !== 'string' || typeof body.mimeType !== 'string' || !body.source)) ||
    (op.kind === 'review' && (!op.reviewKind || !reviewFieldsAllowed(op.reviewKind, body, true)))) throw new ApiError('INVALID_MATERIAL_RECOVERY', 0)
  return op as MaterialOperation
}

function sameOperation(left: MaterialOperation, right: MaterialOperation) {
  return left.prepared.projectId === right.prepared.projectId && left.prepared.suffix === right.prepared.suffix && left.prepared.body === right.prepared.body
}

// Original File/Blob and pending bodies are local recovery data. Authentication is never stored here.
class IndexedMaterialStorage implements MaterialIntakeStorage {
  private opening: Promise<IDBDatabase> | undefined
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private open() {
    this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tujiang_material_intake_v1', 1)
      request.onupgradeneeded = () => {
        const entries = request.result.createObjectStore('entries', { keyPath: 'id' })
        entries.createIndex('projectId', 'projectId')
        request.result.createObjectStore('pending', { keyPath: 'id' })
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Material recovery storage is blocked'))
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => { db.close(); this.opening = undefined }
        resolve(db)
      }
    }).catch(error => { this.opening = undefined; throw error })
    return this.opening
  }
  private async transaction<T>(names: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode)
      let result: T
      let failure: unknown
      tx.oncomplete = () => {
        if (mode === 'readwrite') this.listeners.forEach(listener => listener())
        resolve(result)
      }
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Material recovery transaction failed'))
      try { action(tx, value => { result = value }) } catch (error) { failure = error; tx.abort() }
    })
  }
  list(projectId: string) {
    return this.transaction<MaterialLocalEntry[]>(['entries'], 'readonly', (tx, result) => {
      const request = tx.objectStore('entries').index('projectId').getAll(projectId)
      request.onsuccess = () => result((request.result as MaterialLocalEntry[]).sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id)))
    })
  }
  put(entry: MaterialLocalEntry) {
    return this.transaction<void>(['entries'], 'readwrite', tx => { tx.objectStore('entries').put(entry) })
  }
  remove(id: string) {
    return this.transaction<void>(['entries', 'pending'], 'readwrite', tx => {
      const request = tx.objectStore('pending').get('active')
      request.onsuccess = () => {
        if ((request.result as MaterialOperation | undefined)?.entryId === id) { tx.abort(); return }
        tx.objectStore('entries').delete(id)
      }
    })
  }
  async readPending() {
    const pending = await this.transaction<unknown>(['pending'], 'readonly', (tx, result) => {
      const request = tx.objectStore('pending').get('active')
      request.onsuccess = () => result(request.result)
    })
    return pending === undefined ? undefined : validateMaterialOperation(pending)
  }
  savePending(operation: MaterialOperation) {
    return this.writePending(operation)
  }
  replacePending(previous: MaterialOperation, operation: MaterialOperation) {
    return this.writePending(operation, previous)
  }
  private writePending(operation: MaterialOperation, previous?: MaterialOperation) {
    return this.transaction<void>(['pending', 'entries'], 'readwrite', tx => {
      const request = tx.objectStore('pending').get('active')
      request.onsuccess = () => {
        if (previous ? !request.result || !sameOperation(request.result as MaterialOperation, previous)
          || previous.entryId !== operation.entryId || previous.before.id !== operation.before.id
          : request.result && !sameOperation(request.result as MaterialOperation, operation)) { tx.abort(); return }
        tx.objectStore('pending').put(operation)
        if (operation.entryId) {
          const entry = tx.objectStore('entries').get(operation.entryId)
          entry.onsuccess = () => {
            if (!entry.result || (entry.result as MaterialLocalEntry).projectId !== operation.before.id) { tx.abort(); return }
            tx.objectStore('entries').put({ ...entry.result as MaterialLocalEntry, status: 'uploading', message: undefined })
          }
        }
      }
    })
  }
  settle(operation: MaterialOperation, result: 'saved' | 'rejected' | 'conflict', message?: string) {
    return this.transaction<void>(['pending', 'entries'], 'readwrite', tx => {
      const request = tx.objectStore('pending').get('active')
      request.onsuccess = () => {
        if (request.result && !sameOperation(request.result as MaterialOperation, operation)) { tx.abort(); return }
        tx.objectStore('pending').delete('active')
        if (!operation.entryId) return
        if (result === 'saved') { tx.objectStore('entries').delete(operation.entryId); return }
        const entry = tx.objectStore('entries').get(operation.entryId)
        entry.onsuccess = () => { if (entry.result) tx.objectStore('entries').put({ ...entry.result as MaterialLocalEntry, status: result, message }) }
      }
    })
  }
  markUncertain(operation: MaterialOperation, message: string) {
    return this.transaction<void>(['entries'], 'readwrite', tx => {
      if (!operation.entryId) return
      const entry = tx.objectStore('entries').get(operation.entryId)
      entry.onsuccess = () => { if (entry.result) tx.objectStore('entries').put({ ...entry.result as MaterialLocalEntry, status: 'uncertain', message }) }
    })
  }
}

export const materialIntakeStorage: MaterialIntakeStorage = new IndexedMaterialStorage()
