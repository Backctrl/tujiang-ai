import { useEffect, useRef, useState } from 'react'
import { readProjectEvents } from './project-events.js'
import { readDraft, draftKey } from './project-drafts.js'
import { useProjectSnapshot } from './useProjectSnapshot.js'
import { ApiError, errorMessage, StageAApi } from './stage-a-api.js'
import type { Project, ProjectSummary } from './stage-a-api.js'
import type { RulePack } from '../../../backend/src/production-context.js'

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
  const [authExpired, setAuthExpired] = useState(false)
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
  const [pending, setPending] = useState<null | { run: () => Promise<Project>; label: string }>(null)
  const [conflictBefore, setConflictBefore] = useState<Project | null>(null)
  const api = () => new StageAApi(tokenRef.current)
  const accept = (next: Project) => {
    if (currentId.current !== next.id) { updateReason(readDraft(next.id, 'reason', '')); setRunConsent(false) }
    currentId.current = next.id
    receiveSnapshot(next)
    setProjectId(next.id)
    try { localStorage.setItem(projectStorageKey, next.id) } catch { /* Persistence is optional; the server snapshot remains authoritative. */ }
  }
  const perform = async (run: () => Promise<Project>, label: string, isWrite = true) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    if (isWrite) setPending({ run, label })
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
  const canWrite = !!project && !!token.trim() && !busy && !pending && !conflictBefore && !authExpired
  const canSwitch = !busy && !pending && !conflictBefore
  const listProjects = async () => {
    if (!token.trim() || busyRef.current || pending) return
    busyRef.current = true; setBusy(true); setError('')
    try { setProjects(await api().list()); setAuthExpired(false); setNotice('项目列表已更新，选择项目继续。') }
    catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false) } }
    finally { busyRef.current = false; setBusy(false) }
  }
  const selectProject = async (id: string) => {
    if (!canSwitch || busyRef.current || !token.trim() || !id) return
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
  }, [project?.id, token, authExpired, catalogRequest])
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
  }, [project?.id, token, authExpired, receiveSnapshot])
  const write = (path: string, body: Record<string, unknown>, label: string, onSaved?: (next: Project) => void) => {
    if (!project || !canWrite || busyRef.current) return
    const key = crypto.randomUUID()
    return perform(async () => {
      const next = await api().write(project, path, body, key)
      receiveSnapshot(next, project.id)
      onSaved?.(next)
      return next
    }, label)
  }
  const create = (name: string) => {
    if (!token.trim() || pending || conflictBefore || busyRef.current || !name.trim()) return
    const key = crypto.randomUUID()
    setRunConsent(false)
    return perform(() => api().create(name.trim(), key), '项目已创建，请确认产品身份并添加资料。')
  }
  const refresh = () => {
    const id = project?.id ?? projectId.trim()
    if (!token.trim() || !id || (pending && !project) || busyRef.current) return
    return perform(() => api().get(id), '已读取最新服务端数据。未保存修改仍保留。', false)
  }
  const retry = () => { if (pending) return perform(pending.run, pending.label) }
  const resolveConflict = () => {
    if (busy || !project || !conflictBefore || project.revision <= conflictBefore.revision) return
    setConflictBefore(null); setError(''); setNotice('差异已复核。请检查保留的修改，再重新提交。')
  }
  const confirmed = project?.facts.filter(f => f.status === 'confirmed') ?? []
  const hasConflict = project?.facts.some(f => f.issueSeverity === 'blocker') ?? false
  const canPlan = canWrite && !!project?.identity && confirmed.some(f => f.role === 'core') && !hasConflict
  return { project, getLatestProject, projectId, setProjectId, token, setToken, authExpired, busy, error, notice, pending, conflictBefore, projects, listProjects, selectProject, canSwitch, eventsStatus,
    catalog, catalogLoading, catalogError, reloadCatalog,
    canWrite, write, create, refresh, retry, resolveConflict, confirmed, hasConflict, canPlan,
    reason, setReason, reasonValid: !!reason.trim() && reason.length <= 1000, runConsent, setRunConsent }
}

export type ProjectSession = ReturnType<typeof useProjectSession>
