import { useCallback, useEffect, useRef, useState } from 'react'
import { readProjectEvents } from './project-events.js'
import { readDraft, draftKey } from './project-drafts.js'
import { useProjectSnapshot } from './useProjectSnapshot.js'
import { ApiError, errorMessage, StageAApi } from './stage-a-api.js'
import type { Project, ProjectSummary } from './stage-a-api.js'
import type { RulePack } from '../../../backend/src/production-context.js'
import type { Material } from '../../../backend/src/production-materials.js'
import { executeMaterialOperation, prepareMaterialRetry, prepareMaterialUpload, verifyOriginal, type MaterialWriteOutcome } from './material-intake.js'
import { materialIntakeStorage, type MaterialLocalEntry, type MaterialOperation } from './material-storage.js'
import { prepareReviewWrite, type ReviewKind } from './review-requests.js'

type SessionPending = { kind: 'standard'; run: () => Promise<Project>; label: string } | { kind: 'material'; operation: MaterialOperation; label: string; onSaved?: (project: Project) => void }

const projectStorageKey = 'tujiang_stage_a_project_id'
function previousProjectId() {
  try { return localStorage.getItem(projectStorageKey) ?? '' } catch { return '' }
}

export function useProjectSession() {
  const { project, getLatestProject, receiveSnapshot } = useProjectSnapshot()
  const currentId = useRef<string | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [catalog, setCatalog] = useState<RulePack[] | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [catalogRequest, setCatalogRequest] = useState(0)
  const [eventsStatus, setEventsStatus] = useState('尚未连接')
  const [projectId, setProjectId] = useState(previousProjectId)
  const [token, updateToken] = useState('')
  const tokenRef = useRef('')
  const [authExpired, updateAuthExpired] = useState(false)
  const authExpiredRef = useRef(false)
  const setAuthExpired = useCallback((value: boolean) => { authExpiredRef.current = value; updateAuthExpired(value) }, [])
  const setToken = (value: string) => { tokenRef.current = value; updateToken(value) }
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reason, updateReason] = useState('')
  const setReason = (value: string) => {
    updateReason(value)
    if (currentId.current) try { localStorage.setItem(draftKey(currentId.current, 'reason'), JSON.stringify(value)) } catch { /* Optional draft persistence. */ }
  }
  const [runConsent, setRunConsent] = useState(false)
  const [pending, updatePending] = useState<SessionPending | null>(null)
  const pendingRef = useRef<SessionPending | null>(null)
  const setPending = useCallback((value: SessionPending | null) => { pendingRef.current = value; updatePending(value) }, [])
  const [conflictBefore, updateConflictBefore] = useState<Project | null>(null)
  const conflictRef = useRef<Project | null>(null)
  const [conflictAllowsSameRevision, setConflictAllowsSameRevision] = useState(false)
  const [conflictChecked, setConflictChecked] = useState(false)
  const setConflictBefore = useCallback((value: Project | null, allowSameRevision = false) => {
    conflictRef.current = value; updateConflictBefore(value); setConflictAllowsSameRevision(allowSameRevision); setConflictChecked(false)
  }, [])
  const [recoveryLoading, setRecoveryLoading] = useState(true)
  const [recoveryError, setRecoveryError] = useState('')
  const [recoveryRequest, setRecoveryRequest] = useState(0)
  const recoveryReady = useRef(false)
  const [recoveryNeedsCheck, updateRecoveryNeedsCheck] = useState(false)
  const recoveryCheckRef = useRef(false)
  const setRecoveryNeedsCheck = useCallback((value: boolean) => { recoveryCheckRef.current = value; updateRecoveryNeedsCheck(value) }, [])
  const [materialActivity, setMaterialActivity] = useState<{ entryId?: string; phase: 'reading' | 'sending' } | null>(null)
  const api = () => new StageAApi(tokenRef.current)
  const accept = useCallback((next: Project) => {
    if (currentId.current !== next.id) { updateReason(readDraft(next.id, 'reason', '')); setRunConsent(false) }
    currentId.current = next.id
    receiveSnapshot(next)
    setProjectId(next.id)
    try { localStorage.setItem(projectStorageKey, next.id) } catch { /* Persistence is optional; the server snapshot remains authoritative. */ }
  }, [receiveSnapshot])
  useEffect(() => {
    let disposed = false
    recoveryReady.current = false; setRecoveryLoading(true); setRecoveryError('')
    void materialIntakeStorage.readPending().then(operation => {
      if (disposed) return
      if (operation) {
        accept(operation.before)
        setPending({ kind: 'material', operation, label: operation.label })
        setRecoveryNeedsCheck(true)
        setNotice(`已恢复一份结果未确认的${operation.kind === 'review' ? '审核' : '材料'}请求。请输入凭据并读取最新项目核对，再使用原操作重试；不会自动提交。`)
      }
      recoveryReady.current = true
    }).catch(err => {
      if (!disposed) setRecoveryError(errorMessage(err instanceof ApiError ? err : new ApiError('LOCAL_RECOVERY_READ_FAILED', 0)))
    }).finally(() => { if (!disposed) setRecoveryLoading(false) })
    return () => { disposed = true }
  }, [recoveryRequest, accept, setPending, setRecoveryNeedsCheck])
  const reloadMaterialRecovery = () => { if (!busyRef.current) setRecoveryRequest(value => value + 1) }
  const canSwitchNow = () => recoveryReady.current && !busyRef.current && !pendingRef.current && !conflictRef.current
  const canWriteNow = () => canSwitchNow() && !!getLatestProject() && !!tokenRef.current.trim() && !authExpiredRef.current
  const perform = async (run: () => Promise<Project>, label: string, isWrite = true) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    if (isWrite) setPending({ kind: 'standard', run, label })
    try {
      const next = await run()
      accept(next); setNotice(label); setAuthExpired(false)
      if (isWrite) { setPending(null); setConflictBefore(null) }
      return next
    } catch (err) {
      setError(errorMessage(err))
      if (err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false) }
      if (isWrite && err instanceof ApiError && ['VERSION_CONFLICT', 'REVISION_CONFLICT'].includes(err.code)) {
        setConflictBefore(project); setPending(null)
      } else if (isWrite && err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.code !== 'INVALID_RESPONSE') setPending(null)
    } finally { busyRef.current = false; setBusy(false) }
  }
  const canWrite = !!project && !!token.trim() && !busy && !pending && !conflictBefore && !authExpired && !recoveryLoading && !recoveryError
  const canSwitch = !busy && !pending && !conflictBefore && !recoveryLoading && !recoveryError
  const listProjects = async () => {
    if (!tokenRef.current.trim() || !canSwitchNow()) return
    busyRef.current = true; setBusy(true); setError('')
    try { setProjects(await api().list()); setAuthExpired(false); setNotice('项目列表已更新，选择项目继续。') }
    catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false) } }
    finally { busyRef.current = false; setBusy(false) }
  }
  const selectProject = async (id: string) => {
    if (!canSwitchNow() || !tokenRef.current.trim() || !id) return
    await perform(() => api().get(id), '已打开项目，恢复该项目的本地草稿。', false)
  }
  useEffect(() => {
    setCatalog(null); setCatalogError(''); setCatalogLoading(false)
    if (!project?.id || !token.trim() || authExpired) return
    let disposed = false
    setCatalogLoading(true)
    void new StageAApi(token).catalog().then(rules => {
      if (!disposed) setCatalog(rules)
    }).catch(err => {
      if (disposed) return
      setCatalogError(errorMessage(err))
      if (err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false); setError(errorMessage(err)) }
    }).finally(() => { if (!disposed) setCatalogLoading(false) })
    return () => { disposed = true }
  }, [project?.id, token, authExpired, catalogRequest, setAuthExpired])
  const reloadCatalog = () => { if (!catalogLoading && token.trim() && !authExpired) setCatalogRequest(value => value + 1) }
  useEffect(() => {
    const id = project?.id
    if (!id || !token || authExpired) return
    let disposed = false, cursor = '', attempt = 0, timer: ReturnType<typeof setTimeout> | undefined
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    let reading = false, dirty = false
    const refreshFromEvent = async () => {
      dirty = true
      if (reading) return
      reading = true
      try {
        while (dirty && !disposed) {
          dirty = false
          const next = await new StageAApi(token).get(id)
          if (!disposed && currentId.current === id) receiveSnapshot(next, id)
        }
      } catch (err) {
        if (!disposed && err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false) }
        else if (!disposed) { clearTimeout(snapshotTimer); snapshotTimer = setTimeout(() => void refreshFromEvent(), 3000) }
      } finally { reading = false }
    }
    const connect = async () => {
      if (disposed) return
      setEventsStatus(attempt ? '连接中断，正在重连' : '正在连接状态通知')
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(id)}/events${cursor ? `?after=${cursor}` : ''}`, { headers: { Authorization: `Bearer ${token}`, ...(cursor ? { 'Last-Event-ID': cursor } : {}) }, signal: controller.signal, redirect: 'error' })
        if (response.ok) { setEventsStatus('任务状态自动更新'); void refreshFromEvent() }
        await readProjectEvents(response, nextCursor => { if (!cursor || Number(nextCursor) > Number(cursor)) { cursor = nextCursor; void refreshFromEvent() } })
      } catch (err) {
        if (!disposed && err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false); setEventsStatus('凭据已失效'); return }
      }
      if (!disposed) { setEventsStatus('连接中断，稍后自动重连'); timer = setTimeout(() => void connect(), Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5))) }
    }
    void connect()
    return () => { disposed = true; controller.abort(); clearTimeout(timer); clearTimeout(snapshotTimer) }
  }, [project?.id, token, authExpired, receiveSnapshot, setAuthExpired])
  const write = (path: string, body: Record<string, unknown>, label: string, onSaved?: (next: Project) => void) => {
    if (!project || !canWriteNow() || getLatestProject()?.id !== project.id) return
    const key = crypto.randomUUID()
    return perform(async () => {
      const next = await api().write(project, path, body, key)
      receiveSnapshot(next, project.id)
      onSaved?.(next)
      return next
    }, label)
  }
  const create = (name: string) => {
    if (!tokenRef.current.trim() || !canSwitchNow() || !name.trim()) return
    const key = crypto.randomUUID()
    setRunConsent(false)
    return perform(() => api().create(name.trim(), key), '项目已创建，请确认产品身份并添加资料。')
  }
  const refresh = async () => {
    const id = project?.id ?? projectId.trim()
    if (!token.trim() || !id || (pending && !project) || busyRef.current) return
    const next = await perform(() => api().get(id), '已读取最新服务端数据。未保存修改仍保留。', false)
    if (next && pendingRef.current?.kind === 'material' && pendingRef.current.operation.before.id === next.id) setRecoveryNeedsCheck(false)
    if (next && conflictRef.current?.id === next.id && next.revision >= conflictRef.current.revision) setConflictChecked(true)
    return next
  }
  const readMaterialReviews = useCallback(async () => {
    const before = getLatestProject()
    const requestedToken = tokenRef.current
    if (!before || !requestedToken.trim()) throw new ApiError('UNAUTHORIZED', 401)
    try {
      const client = new StageAApi(requestedToken)
      const center = await client.materialReviews(before.id)
      const latest = getLatestProject()
      // A newer list must have its corresponding project snapshot before the UI can act on it.
      if (latest?.id === before.id && center.revision > latest.revision) {
        const next = await client.get(before.id)
        if (getLatestProject()?.id === before.id) receiveSnapshot(next, before.id)
      }
      return center
    } catch (err) {
      if (getLatestProject()?.id === before.id && tokenRef.current === requestedToken && err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false); setError(errorMessage(err)) }
      throw err
    }
  }, [getLatestProject, receiveSnapshot, setAuthExpired])
  const materialAttempt = async (prepare: () => MaterialOperation | Promise<MaterialOperation>, replay = false, entryId?: string, onSaved?: (project: Project) => void): Promise<MaterialWriteOutcome> => {
    if (busyRef.current) return { kind: 'blocked' }
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); setMaterialActivity({ entryId, phase: 'reading' })
    try {
      const operation = await prepare()
      setMaterialActivity({ entryId: operation.entryId, phase: 'sending' })
      setPending({ kind: 'material', operation, label: operation.label, onSaved })
      const outcome = await executeMaterialOperation(operation, api(), materialIntakeStorage, next => receiveSnapshot(next, operation.before.id), replay,
        rebased => { setPending({ kind: 'material', operation: rebased, label: rebased.label, onSaved }); setNotice('已同步后台解析进度，正在继续上传此文件（自动更新 1 / 1 次）。') })
      if (outcome.kind === 'saved') {
        accept(outcome.project); setPending(null); setConflictBefore(null); setAuthExpired(false)
        setNotice(`${outcome.operation.parseProgressRebases ? '已同步后台解析进度。' : ''}${operation.label}`); setRecoveryNeedsCheck(false)
        onSaved?.(outcome.project)
      } else if (outcome.kind !== 'blocked') {
        setError(errorMessage(outcome.error)); setNotice('')
        if (outcome.kind === 'uncertain' && outcome.operation) setPending({ kind: 'material', operation: outcome.operation, label: outcome.operation.label, onSaved })
        if (outcome.error instanceof ApiError && outcome.error.status === 401) { setAuthExpired(true); setRunConsent(false) }
        if (outcome.kind === 'conflict') setConflictBefore(outcome.operation?.before ?? operation.before,
          operation.kind === 'review' && outcome.error instanceof ApiError && !['VERSION_CONFLICT', 'REVISION_CONFLICT'].includes(outcome.error.code))
        if (outcome.kind !== 'uncertain') { setPending(null); setRecoveryNeedsCheck(false) }
      }
      return outcome
    } catch (err) {
      // Preparation failed before HTTP; the original remains in the local queue.
      setError(errorMessage(err)); return { kind: 'rejected', error: err }
    } finally { busyRef.current = false; setBusy(false); setMaterialActivity(null) }
  }
  const uploadMaterial = (entry: MaterialLocalEntry): Promise<MaterialWriteOutcome> => {
    if (!canWriteNow() || getLatestProject()?.id !== entry.projectId) return Promise.resolve({ kind: 'blocked' })
    return materialAttempt(() => prepareMaterialUpload(entry, getLatestProject), false, entry.id)
  }
  const retryMaterialParse = (materialId: string): Promise<MaterialWriteOutcome> => {
    const before = getLatestProject()
    if (!before || !canWriteNow()) return Promise.resolve({ kind: 'blocked' })
    return materialAttempt(() => prepareMaterialRetry(before, materialId))
  }
  const reviewWrite = (kind: ReviewKind, path: string, body: Record<string, unknown>, label: string, onSaved?: (next: Project) => void): Promise<MaterialWriteOutcome> => {
    const before = getLatestProject()
    if (!before || !canWriteNow() || before.id !== project?.id) return Promise.resolve({ kind: 'blocked' })
    return materialAttempt(() => prepareReviewWrite(before, kind, path, body, label), false, undefined, onSaved)
  }
  const canRetry = !!pending && !!token.trim() && !busy && !(pending.kind === 'material' && recoveryNeedsCheck)
  const retry = () => {
    const current = pendingRef.current
    if (!current || busyRef.current || !tokenRef.current.trim()) return
    if (current.kind === 'material') {
      if (recoveryCheckRef.current) return
      return materialAttempt(() => current.operation, true, current.operation.entryId, current.onSaved)
    }
    return perform(current.run, current.label)
  }
  const originalMaterial = async (material: Material) => {
    if (!project || !tokenRef.current.trim()) throw new ApiError('UNAUTHORIZED', 401)
    try {
      const blob = await api().original(project.id, material.id)
      await verifyOriginal(blob, material)
      return blob
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false); setError(errorMessage(err)) }
      throw err
    }
  }
  const canResolveConflict = !busy && !!project && !!conflictBefore && (project.revision > conflictBefore.revision
    || (conflictAllowsSameRevision && conflictChecked && project.revision === conflictBefore.revision))
  const resolveConflict = () => {
    if (busyRef.current || !canResolveConflict || !conflictRef.current) return
    setConflictBefore(null); setError(''); setNotice('差异已复核。请检查保留的修改，再重新提交。')
  }
  const confirmed = project?.facts.filter(f => f.status === 'confirmed') ?? []
  const hasConflict = project?.facts.some(f => f.issueSeverity === 'blocker') ?? false
  const canPlan = canWrite && !!project?.identity && confirmed.some(f => f.role === 'core') && !hasConflict
  return { project, getLatestProject, projectId, setProjectId, token, setToken, authExpired, busy, error, notice, pending, conflictBefore, projects, listProjects, selectProject, canSwitch, eventsStatus,
    catalog, catalogLoading, catalogError, reloadCatalog,
    canWrite, write, reviewWrite, readMaterialReviews, create, refresh, retry, canRetry, resolveConflict, canResolveConflict, confirmed, hasConflict, canPlan,
    recoveryLoading, recoveryError, reloadMaterialRecovery, recoveryNeedsCheck, materialActivity, uploadMaterial, retryMaterialParse, originalMaterial,
    reason, setReason, reasonValid: !!reason.trim() && reason.length <= 1000, runConsent, setRunConsent }
}

export type ProjectSession = ReturnType<typeof useProjectSession>
