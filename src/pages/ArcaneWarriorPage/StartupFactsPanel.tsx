import { useRef, useState } from 'react'
import type { ProjectSession } from './useProjectSession'
import type { StageId } from './domain'
import { useStartupStatus } from './useProjectStartup'
import { startupLabels } from './startup-contract'
import { StartupFindings } from './StartupReadiness'
import { useReviewedDraft } from './project-drafts'
import { Button, Chip } from './WorkbenchUI'

export function StartupFactsPanel({ session: s, onStage }: { session: ProjectSession; onStage: (stage: StageId) => void }) {
  const state = useStartupStatus(s), status = state.status
  const [working, setWorking] = useState(false), workingRef = useRef(false)
  const reason = useReviewedDraft(s.project?.id, 'startupScopeReason', '', () => status?.scopeRefresh.inputFingerprint ?? null)
  const current = useRef({ s, state, reason }); current.current = { s, state, reason }
  const submit = async (kind: 'continue-extraction' | 'scope-refresh' | 'retry') => {
    const latest = current.current, snapshot = latest.s.getLatestProject(), reviewed = latest.state.status
    if (workingRef.current || !snapshot || !latest.s.canWrite || !latest.state.isCurrent() || !reviewed
      || latest.s.getCurrentScope() !== s.draftScope || reviewed.id !== status?.id) return
    if (kind === 'scope-refresh' && (!reviewed.scopeRefresh.canRefresh || latest.reason.needsReview || !latest.reason.getStored().value.trim())) return
    if (kind === 'retry' && (!reviewed.retryRunId || reviewed.state !== 'failed')) return
    if (kind === 'continue-extraction' && reviewed.state !== 'ready_to_extract') return
    workingRef.current = true; setWorking(true)
    try {
      const outcome = await latest.s.setupCommand(kind, kind === 'scope-refresh' ? { inputFingerprint: reviewed.scopeRefresh.inputFingerprint, reason: latest.reason.getStored().value } : {}, snapshot, reviewed.retryRunId ?? undefined)
      if (outcome?.kind === 'saved') state.reload()
    } finally { workingRef.current = false; setWorking(false) }
  }
  if (!s.project?.production?.startup && !status) return null
  const materialName = (id: string) => s.project?.production?.materials.find(material => material.id === id)?.fileName ?? id
  const evidenceName = (id: string) => s.project?.evidence.find(evidence => evidence.id === id)?.documentName ?? id
  return <section className="inspector-block startup-facts-panel" aria-label="首次事实提取状态"><div className="connection-actions"><b>首次事实提取</b><Chip tone={status?.state === 'succeeded' ? 'green' : 'muted'}>{status ? startupLabels[status.state] : state.loading ? '正在读取' : '状态待读取'}</Chip><Button disabled={state.loading} onClick={state.reload}>重新读取状态</Button></div>
    {state.error && <p role="alert">{state.error}</p>}
    {status && <><p>已固定 P{status.contextVersion} · {status.materialIds.length} 份原件 · {status.manualEvidenceIds.length} 项独立证据。{status.runId ? `任务编号：${status.runId}` : '尚未创建模型任务。'}</p>
      <details><summary>查看本次固定的原始资料范围</summary><ul>{status.materialIds.map(id => <li key={id}>{materialName(id)} · {id}</li>)}{status.manualEvidenceIds.map(id => <li key={id}>{evidenceName(id)} · {id}</li>)}</ul></details>
      <StartupFindings items={status.prerequisites} onFinding={finding => { if (finding.location.page === 'setup') onStage('setup') }} />
      <p className="integration-note">{status.modelExecution.message} 实际能力、输入与费用预检尚未执行。</p>
      {status.state === 'ready_to_extract' && <Button tone="violet" disabled={!s.canWrite || !state.current || working} onClick={() => void submit('continue-extraction')}>继续本次事实提取</Button>}
      {status.state === 'failed' && status.retryRunId && <Button tone="violet" disabled={!s.canWrite || !state.current || working} onClick={() => void submit('retry')}>重试原事实提取任务</Button>}
      {(status.excludedMaterialIds.length > 0 || status.excludedManualEvidenceIds.length > 0) && <div className="startup-scope-proposal"><b>新增资料尚未纳入本次提取</b><ul>{status.excludedMaterialIds.map(id => <li key={id}>{materialName(id)} · {id}</li>)}{status.excludedManualEvidenceIds.map(id => <li key={id}>{evidenceName(id)} · {id}</li>)}</ul>
        {status.scopeRefresh.canRefresh ? <><p>确认后只加入下面列出的资料，原有失败原件和来源记录仍保留。本操作完成后需明确继续提取。</p>
          <ul>{status.scopeRefresh.addedMaterialIds.map(id => <li key={id}>加入原件：{materialName(id)} · {id}</li>)}{status.scopeRefresh.addedManualEvidenceIds.map(id => <li key={id}>加入独立证据：{evidenceName(id)} · {id}</li>)}</ul>
          <label>补充范围原因<textarea maxLength={1000} value={reason.value} disabled={!s.canWrite || working} onChange={e => reason.setValue(e.target.value)} /></label>
          {reason.needsReview && <p role="alert">补充范围已变化，原因输入保留。<Button disabled={!state.current || !s.canWrite} onClick={reason.acknowledge}>已核对最新资料范围，保留原因</Button></p>}
          <Button disabled={!s.canWrite || !state.current || working || reason.needsReview || !reason.value.trim()} onClick={() => void submit('scope-refresh')}>确认加入列出的补充资料</Button>
        </> : <p>本次任务已有固定运行范围，新增资料不会改变原任务。</p>}
      </div>}
    </>}
  </section>
}
