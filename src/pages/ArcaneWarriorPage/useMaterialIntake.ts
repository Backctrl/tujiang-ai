import { useEffect, useRef, useState } from 'react'
import type { Material, MaterialSource } from '../../../backend/src/production-materials.js'
import { ApiError, errorMessage } from './stage-a-api.js'
import { materialIntakeStorage, type MaterialLocalEntry } from './material-storage.js'
import { maxMaterialFileBytes } from './material-intake.js'
import type { ProjectSession } from './useProjectSession.js'

export function useMaterialIntake(session: ProjectSession) {
  const [entries, setEntries] = useState<MaterialLocalEntry[]>([])
  const [storageVersion, setStorageVersion] = useState(0)
  const [loaded, setLoaded] = useState<{ projectId: string; version: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [selectionErrors, setSelectionErrors] = useState<{ projectId: string; messages: string[] } | null>(null)
  const [runningProject, setRunningProject] = useState<string | null>(null)
  const [onlyEntryId, setOnlyEntryId] = useState<string | null>(null)
  const inFlight = useRef(false)
  const addingRef = useRef(false)
  const claimed = useRef(new Set<string>())
  const projectId = session.project?.id
  const currentId = useRef(projectId)
  currentId.current = projectId
  const reload = () => setStorageVersion(value => value + 1)
  useEffect(() => materialIntakeStorage.subscribe(() => setStorageVersion(value => value + 1)), [])
  useEffect(() => {
    let disposed = false
    setLoading(true)
    if (!projectId) { setEntries([]); setLoading(false); return }
    void materialIntakeStorage.list(projectId).then(next => {
      if (!disposed) { setEntries(next); setLoaded({ projectId, version: storageVersion }); setError('') }
    }).catch(() => { if (!disposed) setError('无法读取本地文件队列，请检查浏览器存储后重新读取。') })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [projectId, storageVersion])
  useEffect(() => { if (runningProject && runningProject !== projectId) setRunningProject(null) }, [projectId, runningProject])

  const localEntries = entries.filter(entry => entry.projectId === projectId)
  const materials = session.project?.production?.materials ?? []
  const initialized = !!session.project?.production
  // A storage mutation can finish before the effect has reloaded its new entries.
  // Do not act on the previous list during that render, including an explicit single-file retry.
  const ready = loaded?.projectId === projectId && loaded?.version === storageVersion && !loading
  const canSelect = session.canWrite && initialized && !adding && ready

  const addFiles = async (files: File[], source: MaterialSource) => {
    if (!projectId || !canSelect || addingRef.current || !files.length) return
    addingRef.current = true; setAdding(true); setError(''); setSelectionErrors(null)
    const failures: string[] = []
    try {
      const previous = await materialIntakeStorage.list(projectId)
      const start = Math.max(Date.now(), ...previous.map(entry => Date.parse(entry.addedAt) + 1))
      for (let index = 0; index < files.length; index++) {
        const file = files[index]!
        if (!file.size || file.size > maxMaterialFileBytes) {
          failures.push(`${file.name}：${errorMessage(new ApiError(file.size ? 'FILE_TOO_LARGE' : 'EMPTY_FILE', file.size ? 413 : 400))} 尚未上传。`)
          continue
        }
        const entry: MaterialLocalEntry = { id: crypto.randomUUID(), projectId, fileName: file.name, mimeType: file.type,
          sizeBytes: file.size, file, source: structuredClone(source), addedAt: new Date(start + index).toISOString(), status: 'waiting' }
        try { await materialIntakeStorage.put(entry) }
        catch { failures.push(`${file.name}：浏览器未能保存此文件，可能是空间不足。未加入可恢复队列，也未上传；请重新选择。`) }
      }
    } catch { failures.push('无法读取浏览器存储，本次选择的文件尚未加入队列，也未上传。') }
    finally { setSelectionErrors({ projectId, messages: failures }); addingRef.current = false; setAdding(false) }
  }
  const start = () => {
    if (!projectId || !session.canWrite || !ready || !initialized) return
    setError(''); setOnlyEntryId(null); setRunningProject(projectId)
  }
  const retryLocal = async (entry: MaterialLocalEntry) => {
    if (!session.canWrite || !projectId || entry.projectId !== projectId || inFlight.current) return
    try {
      // Re-read before requeueing; a late UI render must never recreate an already accepted entry.
      const current = (await materialIntakeStorage.list(projectId)).find(item => item.id === entry.id)
      if (!current || current.status === 'uploading' || current.status === 'uncertain') return
      await materialIntakeStorage.put({ ...current, status: 'waiting', message: undefined })
      claimed.current.delete(entry.id); setError(''); setOnlyEntryId(entry.id); setRunningProject(projectId)
    } catch { setError('未能更新本地队列，此文件没有重新发送。请检查浏览器存储后重试。') }
  }
  const remove = async (entry: MaterialLocalEntry) => {
    if (!session.canWrite || entry.projectId !== projectId || inFlight.current || ['uploading', 'uncertain'].includes(entry.status)) return
    try { await materialIntakeStorage.remove(entry.id); claimed.current.delete(entry.id) }
    catch { setError('未能移除本地文件，请检查浏览器存储后重试。') }
  }
  useEffect(() => {
    if (!runningProject || runningProject !== projectId || !session.canWrite || inFlight.current || !ready) return
    const entry = entries.find(item => item.projectId === projectId && item.status === 'waiting' && (!onlyEntryId || item.id === onlyEntryId) && !claimed.current.has(item.id))
    if (!entry) { setRunningProject(null); return }
    claimed.current.add(entry.id); inFlight.current = true
    void session.uploadMaterial(entry).then(async outcome => {
      if (outcome.kind === 'blocked') claimed.current.delete(entry.id)
      else if (outcome.kind === 'rejected') {
        try {
          const current = (await materialIntakeStorage.list(entry.projectId)).find(item => item.id === entry.id)
          if (current) await materialIntakeStorage.put({ ...current, status: 'rejected', message: errorMessage(outcome.error) })
        } catch { setError('此文件未完成上传，浏览器也未能保存失败状态。队列已暂停。'); setRunningProject(null) }
      } else if (outcome.kind !== 'saved') {
        if (outcome.kind === 'storage') claimed.current.delete(entry.id)
        setRunningProject(null)
      }
    }).finally(() => {
      inFlight.current = false
      if (currentId.current !== entry.projectId) setRunningProject(null)
      setStorageVersion(value => value + 1)
    })
  }, [entries, ready, onlyEntryId, projectId, runningProject, session])

  const download = async (material: Material) => {
    const blob = await session.originalMaterial(material)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = material.fileName.split(/[\\/]/).filter(Boolean).at(-1) ?? `original.${material.format}`
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return { entries: localEntries, materials, initialized, canSelect, adding, loading, error,
    selectionErrors: selectionErrors && selectionErrors.projectId === projectId ? selectionErrors.messages : [], addFiles, start,
    retryLocal, remove, reload, running: runningProject === projectId && !!projectId, pause: () => setRunningProject(null), download }
}
export type MaterialIntakeController = ReturnType<typeof useMaterialIntake>
