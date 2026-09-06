import { useRef, useState } from 'react'
import { ApiError, errorMessage, StageAApi } from './stage-a-api'
import type { Project } from './stage-a-api'

const projectStorageKey = 'tujiang_stage_a_project_id'
function previousProjectId() {
  try { return localStorage.getItem(projectStorageKey) ?? '' } catch { return '' }
}

export function useProjectSession() {
  const [project, setProject] = useState<Project | null>(null)
  const [projectId, setProjectId] = useState(previousProjectId)
  const [token, updateToken] = useState('')
  const tokenRef = useRef('')
  const [authExpired, setAuthExpired] = useState(false)
  const setToken = (value: string) => { tokenRef.current = value; updateToken(value) }
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reason, setReason] = useState('')
  const [runConsent, setRunConsent] = useState(false)
  const [pending, setPending] = useState<null | { run: () => Promise<Project>; label: string }>(null)
  const [conflictBefore, setConflictBefore] = useState<Project | null>(null)
  const api = () => new StageAApi(tokenRef.current)
  const accept = (next: Project) => {
    setProject(old => old?.id === next.id && old.revision > next.revision ? old : next)
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
  const write = (path: string, body: Record<string, unknown>, label: string, onSaved?: (next: Project) => void) => {
    if (!project || !canWrite || busyRef.current) return
    const key = crypto.randomUUID()
    return perform(async () => {
      const next = await api().write(project, path, body, key)
      onSaved?.(next)
      return next
    }, label)
  }
  const create = (name: string) => {
    if (project || !token.trim() || pending || conflictBefore || busyRef.current || !name.trim()) return
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
  return { project, projectId, setProjectId, token, setToken, authExpired, busy, error, notice, pending, conflictBefore,
    canWrite, write, create, refresh, retry, resolveConflict, confirmed, hasConflict, canPlan,
    reason, setReason, reasonValid: !!reason.trim() && reason.length <= 1000, runConsent, setRunConsent }
}

export type ProjectSession = ReturnType<typeof useProjectSession>
