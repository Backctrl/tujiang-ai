import { useCallback, useEffect, useRef, useState } from 'react'
import { readProjectEvents } from './project-events.js'
import { readDraft, draftKey } from './project-drafts.js'
import { useProjectSnapshot } from './useProjectSnapshot.js'
import { ApiError, errorMessage, StageAApi } from './stage-a-api.js'
import type { Project, ProjectSummary } from './stage-a-api.js'
import type { RuleCatalog } from './rule-catalog.js'
import type { Material } from '../../../backend/src/production-materials.js'
import { executeMaterialOperation, prepareMaterialRetry, prepareMaterialUpload, verifyOriginal, type MaterialWriteOutcome } from './material-intake.js'
import { materialIntakeStorage, type MaterialLocalEntry, type MaterialOperation } from './material-storage.js'
import { prepareReviewWrite, type ReviewKind } from './review-requests.js'
import { executeSetupOperation, prepareSetupOperation, setupRecoveryStorage, type SetupAction, type SetupCapture, type SetupOperation, type SetupOutcome } from './setup-recovery.js'
import type { ContextDraft } from '../../../backend/src/production-context.js'
import type { StartupStatus } from './startup-contract.js'

type SessionPending = { kind: 'standard'; run: () => Promise<Project>; label: string } | { kind: 'material'; operation: MaterialOperation; label: string; onSaved?: (project: Project) => void }
  | { kind: 'setup'; operation: SetupOperation; label: string }

const projectStorageKey = 'tujiang_stage_a_project_id'
function previousProjectId() {
  try { return localStorage.getItem(projectStorageKey) ?? '' } catch { return '' }
}
const setupScopeKey = 'tujiang_setup_scope_v1'
function storedSetupScope() { try { return localStorage.getItem(setupScopeKey) || previousProjectId() } catch { return '' } }
function previousSetupScope() {
  return storedSetupScope() || `local-${crypto.randomUUID()}`
}

export function useProjectSession() {
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const { project, getLatestProject, receiveSnapshot, clearSnapshot } = useProjectSnapshot()
  const [draftScope, updateDraftScope] = useState(previousSetupScope)
  const scopeRef = useRef(draftScope)
  const setDraftScope = useCallback((scope: string) => { scopeRef.current = scope; updateDraftScope(scope); try { localStorage.setItem(setupScopeKey, scope) } catch { /* Durable request also contains its namespace. */ } }, [])
  const [setupRestoredDraft, setSetupRestoredDraft] = useState<SetupCapture | undefined>()
  const setupDraftRef = useRef<{ scopeId: string; capture: () => SetupCapture; initialized: (before: Project | null, next: Project) => void } | null>(null)
  const registerSetupDraft = useCallback((value: typeof setupDraftRef.current) => { setupDraftRef.current = value }, [])
  const [setupRejected, setSetupRejected] = useState(false)
  const [startupVersion, setStartupVersion] = useState(0)
  const [startupReceipt, updateStartupReceipt] = useState<{ project: Project; startup: StartupStatus; scopeId: string; token: string; key: string; context: ContextDraft; form: SetupCapture['reviewed']['value'] } | null>(null)
  const startupReceiptRef = useRef(startupReceipt)
  const setStartupReceipt = useCallback((value: typeof startupReceipt) => { startupReceiptRef.current = value; updateStartupReceipt(value) }, [])
  const consumeStartupReceipt = useCallback((key: string) => {
    if (startupReceiptRef.current?.key !== key) return false
    setStartupReceipt(null)
    return true
  }, [setStartupReceipt])
  const currentId = useRef<string | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [ruleCatalog, setRuleCatalog] = useState<RuleCatalog | null>(null)
  const catalogRef = useRef<RuleCatalog | null>(null)
  const getLatestCatalog = useCallback(() => catalogRef.current, [])
  const publishCatalog = useCallback((value: RuleCatalog | null) => { catalogRef.current = value; setRuleCatalog(value) }, [])
  const catalog = ruleCatalog?.rulePacks ?? null
  const scopedCatalog = ruleCatalog?.scopedRulePacks ?? null
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
  const setToken = (value: string) => { tokenRef.current = value; publishCatalog(null); updateToken(value) }
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
    void (async () => {
      const [operation, setup] = await Promise.all([materialIntakeStorage.readPending(), setupRecoveryStorage.readPending()])
      const selected = setup?.scopeId ?? operation?.before.id ?? (storedSetupScope() || await setupRecoveryStorage.readSelection() || scopeRef.current)
      const flow = await setupRecoveryStorage.readFlow(selected)
      const scope = setup?.scopeId ?? (operation ? flow?.scopeId ?? operation.before.id : flow?.scopeId ?? selected)
      if (!operation && !setup) await setupRecoveryStorage.selectScope(scope)
      return { operation, setup, flow, scope }
    })().then(({ operation, setup, flow, scope }) => {
      if (disposed) return
      setDraftScope(scope)
      if (setup) {
        setDraftScope(setup.scopeId); setSetupRestoredDraft(setup.capture)
        if (setup.before) accept(setup.before)
        setPending({ kind: 'setup', operation: setup, label: setup.label }); setRecoveryNeedsCheck(true); setSetupRejected(!!setup.rejected)
        setNotice('已恢复未确认的项目启动步骤。输入凭据并读取服务端核对后，明确重试原请求；页面恢复不会继续创建、初始化或启动。')
      } else if (operation) {
        if (flow) setSetupRestoredDraft(flow.capture)
        accept(operation.before)
        setPending({ kind: 'material', operation, label: operation.label })
        setRecoveryNeedsCheck(true)
        setNotice(`已恢复一份结果未确认的${operation.kind === 'review' ? '审核' : '材料'}请求。请输入凭据并读取最新项目核对，再使用原操作重试；不会自动提交。`)
      } else if (flow) {
        setSetupRestoredDraft(flow.capture); accept(flow.project)
        setNotice('已恢复此项目的本地输入与已确认回执。可读取最新项目核对；不会自动继续提交。')
      }
      recoveryReady.current = true
    }).catch(err => {
      if (!disposed) setRecoveryError(errorMessage(err instanceof ApiError ? err : new ApiError('LOCAL_RECOVERY_READ_FAILED', 0)))
    }).finally(() => { if (!disposed) setRecoveryLoading(false) })
    return () => { disposed = true }
  }, [recoveryRequest, accept, setPending, setRecoveryNeedsCheck, setDraftScope])
  const reloadMaterialRecovery = () => { if (!busyRef.current) setRecoveryRequest(value => value + 1) }
  const canSwitchNow = () => mountedRef.current && recoveryReady.current && !busyRef.current && !pendingRef.current && !conflictRef.current
  const canWriteNow = () => canSwitchNow() && !!getLatestProject() && !!tokenRef.current.trim() && !authExpiredRef.current
  const perform = async (run: () => Promise<Project>, label: string, isWrite = true) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    if (isWrite) setPending({ kind: 'standard', run, label })
    const requestedToken = tokenRef.current
    try {
      const next = await run()
      if (!mountedRef.current || tokenRef.current !== requestedToken) return
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
  const canEditSetup = canSwitch
  const canPrepareSetup = canSwitch && !!token.trim() && !authExpired
  const newLocalProject = async () => {
    if (!canSwitchNow()) return
    busyRef.current = true; setBusy(true)
    try {
      const scope = `local-${crypto.randomUUID()}`
      await setupRecoveryStorage.selectScope(scope)
      currentId.current = null; clearSnapshot(); setProjectId(''); setSetupRestoredDraft(undefined); setRunConsent(false)
      setStartupReceipt(null)
      setDraftScope(scope); setNotice('新的本地配置已准备好。首次上传或点击创建并提取时保存到服务端。')
    } catch { setError(errorMessage(new ApiError('LOCAL_RECOVERY_SAVE_FAILED', 0))) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const listProjects = async () => {
    if (!tokenRef.current.trim() || !canSwitchNow()) return
    busyRef.current = true; setBusy(true); setError('')
    try { setProjects(await api().list()); setAuthExpired(false); setNotice('项目列表已更新，选择项目继续。') }
    catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false) } }
    finally { busyRef.current = false; setBusy(false) }
  }
  const selectProject = async (id: string) => {
    if (!canSwitchNow() || !tokenRef.current.trim() || !id) return
    return perform(async () => {
      const next = await api().get(id), flow = await setupRecoveryStorage.readFlow(id)
      await setupRecoveryStorage.selectScope(flow?.scopeId ?? id)
      setDraftScope(flow?.scopeId ?? id); setSetupRestoredDraft(flow?.capture); setStartupReceipt(null)
      return next
    }, '已打开项目，恢复该项目的本地草稿。', false)
  }
  useEffect(() => {
    publishCatalog(null); setCatalogError(''); setCatalogLoading(false)
    if (!token.trim() || authExpired) return
    const requestedScope = draftScope
    let disposed = false
    setCatalogLoading(true)
    void new StageAApi(token).ruleCatalog().then(rules => {
      if (!disposed && tokenRef.current === token && scopeRef.current === requestedScope) publishCatalog(rules)
    }).catch(err => {
      if (disposed || tokenRef.current !== token || scopeRef.current !== requestedScope) return
      setCatalogError(errorMessage(err))
      if (err instanceof ApiError && err.status === 401) { setAuthExpired(true); setRunConsent(false); setError(errorMessage(err)) }
    }).finally(() => { if (!disposed) setCatalogLoading(false) })
    return () => { disposed = true }
  }, [draftScope, token, authExpired, catalogRequest, setAuthExpired, publishCatalog])
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
    const setup = pendingRef.current?.kind === 'setup' ? pendingRef.current.operation : undefined
    if (setup?.action === 'create') {
      if (!tokenRef.current.trim() || busyRef.current) return
      busyRef.current = true; setBusy(true); setError('')
      try { setProjects(await api().list()); setAuthExpired(false); setRecoveryNeedsCheck(false)
        setNotice('已读取服务端项目列表。不会按名称猜测创建结果；明确重试原请求会由原操作编号取回创建回执。') }
      catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.status === 401) setAuthExpired(true) }
      finally { busyRef.current = false; setBusy(false) }
      return
    }
    const id = project?.id ?? projectId.trim()
    if (!token.trim() || !id || (pending && !project) || busyRef.current) return
    const next = await perform(() => api().get(id), '已读取最新服务端数据。未保存修改仍保留。', false)
    if (next && pendingRef.current?.kind === 'material' && pendingRef.current.operation.before.id === next.id) setRecoveryNeedsCheck(false)
    if (next && setup?.before?.id === next.id) setRecoveryNeedsCheck(false)
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
    return materialAttempt(() => prepareMaterialUpload(entry, () => mountedRef.current ? getLatestProject() : null), false, entry.id)
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
  const runSetupStep = async (operation: SetupOperation): Promise<SetupOutcome> => {
    const requestedToken = tokenRef.current
    setPending({ kind: 'setup', operation, label: operation.label })
    const outcome = await executeSetupOperation(operation, api(), setupRecoveryStorage)
    if (outcome.kind === 'saved') {
      if (mountedRef.current && scopeRef.current === operation.scopeId && tokenRef.current === requestedToken) {
        accept(outcome.project)
        if (operation.action === 'initialize') setupDraftRef.current?.initialized(operation.before, outcome.project)
        if (operation.action === 'start' && outcome.startup) {
          const submitted = JSON.parse(operation.prepared.body) as { idempotencyKey: string; context: ContextDraft }
          setStartupReceipt({ project: outcome.project, startup: outcome.startup, scopeId: operation.scopeId, token: requestedToken, key: submitted.idempotencyKey, context: submitted.context, form: operation.capture.reviewed.value })
        }
        setStartupVersion(value => value + 1)
      }
      setPending(null); setRecoveryNeedsCheck(false); setSetupRejected(false); setAuthExpired(false); setNotice(operation.label)
    } else {
      setPending({ kind: 'setup', operation: outcome.operation, label: outcome.operation.label })
      setError(errorMessage(outcome.error)); setNotice('')
      if (outcome.kind === 'storage') setRecoveryNeedsCheck(false)
      else { setRecoveryNeedsCheck(true); setSetupRejected(outcome.conflict) }
      if (outcome.error instanceof ApiError && outcome.error.status === 401) setAuthExpired(true)
    }
    return outcome
  }
  const ensureSetupProject = async (): Promise<Project | undefined> => {
    if (!canSwitchNow() || !tokenRef.current.trim() || authExpiredRef.current) return
    const registration = setupDraftRef.current, scope = scopeRef.current, requestedToken = tokenRef.current
    if (!registration || registration.scopeId !== scope) { setError(errorMessage(new ApiError('SETUP_INPUT_CHANGED', 0))); return }
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const capture = registration.capture()
      // A confirmed receipt is the sole source of the server ID. Never search by product name.
      let before = getLatestProject()
      if (!before) {
        const flow = await setupRecoveryStorage.readFlow(scope)
        if (flow) { before = await api().get(flow.project.id); if (scopeRef.current === scope) accept(before) }
      }
      if (!before) {
        const created = await runSetupStep(prepareSetupOperation(scope, capture, null, 'create'))
        if (created.kind !== 'saved') return
        before = created.project
      }
      if (!mountedRef.current || scopeRef.current !== scope || tokenRef.current !== requestedToken) return
      if (!before.production) {
        const initialized = await runSetupStep(prepareSetupOperation(scope, capture, before, 'initialize'))
        if (initialized.kind !== 'saved') return
        before = initialized.project
      }
      return before
    } catch (err) { setError(errorMessage(err instanceof ApiError ? err : new ApiError('LOCAL_RECOVERY_READ_FAILED', 0))) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const setupCommand = async (action: Exclude<SetupAction, 'create' | 'initialize'>, fields: Record<string, unknown>, expected: Project, runId?: string) => {
    const before = getLatestProject(), registration = setupDraftRef.current
    if (!canWriteNow() || !before || before.id !== expected.id || before.revision !== expected.revision || before.version !== expected.version
      || !registration || registration.scopeId !== scopeRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    try { return await runSetupStep(prepareSetupOperation(scopeRef.current, registration.capture(), before, action, fields, runId)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const setupRead = async (context?: ContextDraft) => {
    const before = getLatestProject(), requestedToken = tokenRef.current
    if (!before || !requestedToken.trim()) throw new ApiError('UNAUTHORIZED', 401)
    try {
      const client = new StageAApi(requestedToken), result = context ? await client.startupCheck(before.id, context) : await client.startup(before.id)
      if (result.revision > (getLatestProject()?.revision ?? 0) && getLatestProject()?.id === before.id && tokenRef.current === requestedToken) {
        const next = await client.get(before.id)
        if (getLatestProject()?.id === before.id && tokenRef.current === requestedToken) receiveSnapshot(next, before.id)
      }
      return result
    } catch (err) { if (tokenRef.current === requestedToken && err instanceof ApiError && err.status === 401) { setAuthExpired(true); setError(errorMessage(err)) }; throw err }
  }
  const releaseSetupRequest = async () => {
    const current = pendingRef.current
    if (busyRef.current || recoveryCheckRef.current || !setupRejected || current?.kind !== 'setup') return
    busyRef.current = true; setBusy(true)
    try { await setupRecoveryStorage.release(current.operation); setPending(null); setSetupRejected(false); setError(''); setNotice('已复核失败请求。输入与原文件保留，请按最新状态明确重新提交。') }
    catch { setError(errorMessage(new ApiError('LOCAL_RECOVERY_SETTLE_FAILED', 0))) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const canRetry = !!pending && !!token.trim() && !busy && !((pending.kind === 'material' || pending.kind === 'setup') && recoveryNeedsCheck) && !(pending.kind === 'setup' && setupRejected)
  const retry = () => {
    const current = pendingRef.current
    if (!current || busyRef.current || !tokenRef.current.trim()) return
    if (current.kind === 'setup') {
      if (recoveryCheckRef.current || setupRejected) return
      busyRef.current = true; setBusy(true); setError('')
      return runSetupStep(current.operation).finally(() => { busyRef.current = false; setBusy(false) })
    }
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
    catalog, scopedCatalog, getLatestCatalog, catalogLoading, catalogError, reloadCatalog,
    canWrite, write, reviewWrite, readMaterialReviews, create, refresh, retry, canRetry, resolveConflict, canResolveConflict, confirmed, hasConflict, canPlan,
    recoveryLoading, recoveryError, reloadMaterialRecovery, recoveryNeedsCheck, materialActivity, uploadMaterial, retryMaterialParse, originalMaterial,
    reason, setReason, reasonValid: !!reason.trim() && reason.length <= 1000, runConsent, setRunConsent,
    draftScope, setupRestoredDraft, registerSetupDraft, canEditSetup, canPrepareSetup, newLocalProject, ensureSetupProject, setupCommand, setupRead,
    startupVersion, startupReceipt, consumeStartupReceipt, setupRejected, releaseSetupRequest, getCurrentScope: () => scopeRef.current, getCurrentToken: () => tokenRef.current }
}

export type ProjectSession = ReturnType<typeof useProjectSession>
