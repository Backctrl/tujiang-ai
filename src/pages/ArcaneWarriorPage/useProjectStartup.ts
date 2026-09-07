import { useEffect, useRef, useState } from 'react'
import type { ProjectContextController } from './useProjectContext.js'
import type { ProjectSession } from './useProjectSession.js'
import { ApiError, errorMessage } from './stage-a-api.js'
import { sameJsonValue } from './project-drafts.js'
import { startupReadMatches, type StartupCheck, type StartupFinding, type StartupRead } from './startup-contract.js'

export function useProjectStartup(s: ProjectSession, context: ProjectContextController, onStarted: () => void, onFinding: (finding: StartupFinding) => void) {
  const [result, setResult] = useState<{ value: StartupCheck; formKey: string; token: string; scope: string } | null>(null)
  const [loading, setLoading] = useState(false), [submitting, setSubmitting] = useState(false), [error, setError] = useState('')
  const [request, setRequest] = useState(0)
  const current = useRef({ s, context, onStarted, onFinding }); current.current = { s, context, onStarted, onFinding }
  const submittingRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const formKey = JSON.stringify(context.compiled.context), rulesKey = JSON.stringify(context.rules)
  const scope = s.draftScope, projectId = s.project?.id, version = s.project?.version, revision = s.project?.revision
  const canRead = !!projectId && !!s.token.trim() && !s.authExpired && !context.compiled.errors.length && !context.local.needsReview && !context.pendingCopy
  const delivered = useRef<string | null>(null)
  useEffect(() => {
    const receipt = s.startupReceipt, latest = current.current
    if (!receipt || delivered.current === receipt.key) return
    if (!mounted.current || receipt.scopeId !== latest.s.getCurrentScope() || receipt.token !== latest.s.getCurrentToken()
      || receipt.project.id !== latest.s.getLatestProject()?.id || !sameJsonValue(receipt.context, latest.context.compiled.context)) return
    if (latest.context.afterStartup(receipt.project, receipt.form) && latest.s.consumeStartupReceipt(receipt.key)) {
      delivered.current = receipt.key
      latest.onStarted()
    }
  }, [s.startupReceipt, s.draftScope, projectId, version, revision, s.token, formKey, context.pendingCopy, context.local.needsReview])
  useEffect(() => {
    setResult(null); setError(''); setLoading(false)
    if (!canRead) return
    let disposed = false
    const token = s.token
    const timer = setTimeout(() => {
      setLoading(true)
      const input = current.current.context.getCurrentInput()
      if (!input || JSON.stringify(input.context) !== formKey) { setLoading(false); return }
      void current.current.s.setupRead(input.context).then(value => {
        const latest = current.current
        if (disposed || !('contractVersion' in value) || latest.s.getCurrentToken() !== token || latest.s.getCurrentScope() !== scope
          || JSON.stringify(latest.context.getCurrentInput()?.context) !== formKey || !startupReadMatches(value, latest.s.getLatestProject())) return
        setResult({ value, token, scope, formKey })
      }).catch(err => { if (!disposed) setError(errorMessage(err)) }).finally(() => { if (!disposed) setLoading(false) })
    }, 250)
    return () => { disposed = true; clearTimeout(timer) }
  }, [projectId, version, revision, s.token, s.authExpired, s.startupVersion, scope, formKey, rulesKey, canRead, request])
  const check = result && result.formKey === formKey && result.token === s.token && result.scope === scope && startupReadMatches(result.value, s.project) ? result.value : null
  const start = async () => {
    const first = current.current, input = first.context.getCurrentInput()
    if (submittingRef.current || first.s.getCurrentScope() !== scope || !first.s.canPrepareSetup || !input || first.context.rules === null || first.context.local.needsReview || first.context.pendingCopy) return
    const requestedScope = first.s.getCurrentScope(), token = first.s.getCurrentToken(), submitted = structuredClone(input)
    const stillCurrent = () => mounted.current && current.current.s.getCurrentScope() === requestedScope && current.current.s.getCurrentToken() === token
      && sameJsonValue(current.current.context.getCurrentInput()?.context, submitted.context)
    submittingRef.current = true; setSubmitting(true); setError('')
    try {
      const project = await first.s.ensureSetupProject()
      if (!project) return
      if (!stillCurrent()) throw new ApiError('SETUP_INPUT_CHANGED', 0)
      const checked = await current.current.s.setupRead(submitted.context)
      if (!('contractVersion' in checked) || !stillCurrent() || !startupReadMatches(checked, current.current.s.getLatestProject())) throw new ApiError('SETUP_INPUT_CHANGED', 0)
      setResult({ value: checked, token, scope: requestedScope, formKey: JSON.stringify(submitted.context) })
      if (!checked.canStart) { if (checked.blockers[0]) current.current.onFinding(checked.blockers[0]); return }
      const before = current.current.s.getLatestProject()
      if (!before || !stillCurrent() || current.current.context.rules === null) throw new ApiError('SETUP_INPUT_CHANGED', 0)
      await current.current.s.setupCommand('start', { context: submitted.context, inputFingerprint: checked.inputFingerprint }, before)
    } catch (err) { setError(errorMessage(err)) }
    finally { submittingRef.current = false; setSubmitting(false) }
  }
  return { check, loading, submitting, error, start, reload: () => setRequest(value => value + 1),
    canStart: s.canPrepareSetup && !submitting && !context.local.needsReview && !context.pendingCopy && !context.compiled.errors.length && context.rules !== null }
}

export function useStartupStatus(s: ProjectSession) {
  const [result, setResult] = useState<{ value: StartupRead; token: string; scope: string } | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [request, setRequest] = useState(0)
  const current = useRef(s); current.current = s
  useEffect(() => {
    setResult(null); setError(''); setLoading(false)
    if (!s.project || !s.token.trim() || s.authExpired) return
    let disposed = false
    const token = s.token, scope = s.draftScope
    setLoading(true)
    void s.setupRead().then(value => {
      if (!disposed && current.current.getCurrentToken() === token && current.current.getCurrentScope() === scope && startupReadMatches(value, current.current.getLatestProject())) setResult({ value: value as StartupRead, token, scope })
    }).catch(err => { if (!disposed) setError(errorMessage(err)) }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [s.project?.id, s.project?.version, s.project?.revision, s.token, s.authExpired, s.startupVersion, s.draftScope, request])
  const isCurrent = () => !!result && current.current.getCurrentToken() === result.token && current.current.getCurrentScope() === result.scope && startupReadMatches(result.value, current.current.getLatestProject())
  return { status: isCurrent() ? result!.value.startup : null, current: isCurrent(), isCurrent, loading, error, reload: () => setRequest(value => value + 1) }
}
