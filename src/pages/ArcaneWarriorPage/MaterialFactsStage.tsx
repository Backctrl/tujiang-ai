import { useState } from 'react'
import { FileText, Layers3, Lock, Plus, RefreshCw } from 'lucide-react'
import type { Evidence } from '../../../backend/src/contracts'
import type { MaterialReviewTask } from '../../../backend/src/production-material-usage'
import type { StageId } from './domain'
import type { ProjectSession } from './useProjectSession'
import type { MaterialIntakeController } from './useMaterialIntake'
import { Button, PanelTitle, StatusDot } from './WorkbenchUI'
import { MaterialList, MaterialUploadFields } from './MaterialIntakeFields'
import { ManualEvidenceFields } from './ManualEvidenceFields'
import { EvidenceDetails, ReconfirmationInspector, UsageInspector } from './MaterialReviewInspectors'
import { CandidateInspector, FactInspector, type CandidateSelection } from './FactReviewInspectors'
import { useMaterialReviews, type MaterialReviewsController } from './useMaterialReviews'
import { emptyFactCandidate, evidenceAvailable, factSourceAvailable, factStatusLabels, reviewLabels, reviewTaskSource, reviewTypes } from './material-review'
import { useProjectDraft } from './project-drafts'

type Props = { session: ProjectSession; onStage: (stage: StageId) => void; intake: MaterialIntakeController }
type Selection = { kind: 'usage'; materialId: string } | { kind: 'task'; taskId: string } | { kind: 'fact'; factId: string } | CandidateSelection | { kind: 'manual-evidence' } | null
function SourceCard({ source, session: s, choose }: { source: Evidence; session: ProjectSession; choose: () => void }) {
  const available = !!s.project && evidenceAvailable(s.project, source)
  return <div className="source-card material-card"><FileText size={18} /><div><b>{source.documentName}</b><span>{source.locator}</span><span>{source.materialSource ? `原件派生 · 用途第 ${source.materialSource.usageVersion} 版` : '独立人工录入'}</span><span>{available ? '有效产品证据' : '已撤回或来源不可用'}</span><details><summary>查看证据原文</summary><p>{source.text}</p></details></div><div className="source-status"><Button onClick={choose}>筛选此文字证据</Button></div></div>
}
export function FactsStage(props: Props) {
  const reviews = useMaterialReviews(props.session)
  return <MaterialFactsContent {...props} reviews={reviews} />
}
export function MaterialFactsContent({ session: s, intake, onStage, reviews }: Props & { reviews: MaterialReviewsController }) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selection, setSelection] = useProjectDraft<Selection>(s.project?.id, 'factsReviewSelection', null)
  const [filter, setFilter] = useState<MaterialReviewTask['type'] | 'all' | 'facts'>('all')
  const [sourceFilter, setSourceFilter] = useState('')
  const [query, setQuery] = useState('')
  const [factFilter, setFactFilter] = useState('all')
  const project = s.project
  const facts = project?.facts ?? []
  const sources = project?.evidence ?? []
  const confirmed = facts.filter(fact => fact.status === 'confirmed')
  const readyFacts = project ? confirmed.filter(fact => factSourceAvailable(project, fact) && fact.issueSeverity === 'none') : []
  const blockers = facts.filter(fact => fact.issueSeverity === 'blocker').length
  const sourceTask = (task: MaterialReviewTask) => project ? reviewTaskSource(project, task) : { material: undefined, evidence: undefined, fact: undefined }
  const visibleTasks = reviews.tasks.filter(task => {
    const { material, evidence, fact } = sourceTask(task)
    return (filter === 'all' || filter === task.type) && (!sourceFilter || evidence?.id === sourceFilter || (task.type === 'material_usage' && material?.id === sources.find(source => source.id === sourceFilter)?.materialSource?.materialId))
      && `${material?.fileName ?? ''} ${evidence?.locator ?? ''} ${fact?.attribute ?? ''} ${fact?.value ?? ''}`.includes(query)
  })
  const visibleFacts = facts.filter(fact => (factFilter === 'all' || fact.status === factFilter) && (!sourceFilter || fact.evidenceId === sourceFilter) && `${fact.attribute} ${fact.value}`.includes(query))
  const task = selection?.kind === 'task' ? reviews.tasks.find(item => item.id === selection.taskId) : undefined
  const selectedFact = selection?.kind === 'fact' ? facts.find(item => item.id === selection.factId) : task && 'factId' in task ? facts.find(item => item.id === task.factId) : undefined
  const selectedMaterial = project?.production?.materials?.find(item => item.id === (selection?.kind === 'usage' ? selection.materialId : task?.type === 'material_usage' ? task.materialId : undefined))
  const chooseFact = (id: string) => setSelection({ kind: 'fact', factId: id })
  const chooseUsage = (id: string) => setSelection({ kind: 'usage', materialId: id })
  const runs = project?.runs.filter(run => run.skill === 'extract-facts') ?? []
  const activeRun = project?.runs.some(run => run.queueStatus !== 'done')
  const availableSources = project ? sources.filter(source => evidenceAvailable(project, source)) : []
  const extractionEvidence = task?.type === 'fact_extraction' ? sources.find(source => source.id === task.evidenceId) : undefined
  return <div className="three-column facts-layout material-review-layout">
    <aside className="rail sources-rail"><PanelTitle eyebrow="EVIDENCE" title="资料与来源" action={<button type="button" className="icon-button" aria-label="添加资料" aria-expanded={uploadOpen} onClick={() => setUploadOpen(value => !value)}><Plus size={16} /></button>} />
      <div className="rail-tabs"><button className={!sourceFilter ? 'active' : ''} onClick={() => setSourceFilter('')}>全部证据 {sources.length} · 有效 {availableSources.length}</button></div>
      <div className="rail-list material-sidebar">{uploadOpen && <MaterialUploadFields intake={intake} session={s} surface="facts" />}
        <Button onClick={() => setSelection({ kind: 'manual-evidence' })}>人工独立补充文字证据</Button>
        <p className="hint">原件资料 {intake.materials.length} 份</p><MaterialList intake={intake} session={s} onReview={chooseUsage} />
        <details className="inspector-block"><summary>产品证据（{sources.length}）</summary><div className="material-list">{sources.map(source => <SourceCard key={source.id} source={source} session={s} choose={() => { setSourceFilter(source.id); setFilter('all') }} />)}{!sources.length && <p>尚无产品证据。</p>}</div></details>
        <details className="inspector-block"><summary>素材与参考记录</summary><p>有效图片素材 {project?.production?.assets?.filter(asset => asset.availability === 'available').length ?? 0} 份 · 有效参考 {project?.production?.references?.filter(reference => reference.availability === 'available').length ?? 0} 块</p><p>在各原件的用途审核中查看与纠正。参考内容不进入事实候选来源。</p></details>
      </div>
    </aside>
    <section className="primary-panel fact-queue"><PanelTitle title="待处理中心" eyebrow="PRODUCT FACTS" action={<Button disabled={!project || !s.token.trim() || s.authExpired || reviews.loading} onClick={reviews.reload}><RefreshCw size={14} />读取任务</Button>} />
      <div className="rail-tabs material-review-tabs">{reviewTypes.map(type => <button type="button" key={type} className={filter === type ? 'active' : ''} aria-pressed={filter === type} onClick={() => setFilter(type)}>{reviewLabels[type]} <b>{reviews.current ? reviews.counts[type] : '—'}</b></button>)}</div>
      <div className="connection-actions review-filters"><Button onClick={() => setFilter('all')}>全部待处理</Button><Button onClick={() => setFilter('facts')}>全部事实与历史 {facts.length}</Button><input aria-label="搜索任务或事实" placeholder="搜索原件、属性或表述" value={query} onChange={e => setQuery(e.target.value)} />{sourceFilter && <Button onClick={() => setSourceFilter('')}>清除来源筛选</Button>}</div>
      {!reviews.initialized && <p className="integration-note">在项目设置开启制作配置后，可读取原件用途待处理任务。独立人工证据和既有事实仍可查看。</p>}
      {reviews.loading && <p role="status">正在校准待处理任务与当前项目版本…</p>}{reviews.error && <p role="alert">{reviews.error}</p>}
      {filter === 'facts' ? <>
        <label className="review-filters">事实状态<select value={factFilter} onChange={e => setFactFilter(e.target.value)}><option value="all">全部状态</option>{Object.entries(factStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="fact-table-head material-review-row"><span>状态</span><span>事实表述与来源</span><span>来源状态</span></div>
        <div className="fact-list">{visibleFacts.map(fact => <button className={`fact-row material-review-row ${selectedFact?.id === fact.id ? 'selected' : ''}`} key={fact.id} onClick={() => chooseFact(fact.id)}><span><StatusDot tone={fact.issueSeverity === 'blocker' || fact.sourceReview ? 'red' : 'muted'} />{factStatusLabels[fact.status]}</span><span><small>{fact.attribute} · {sources.find(source => source.id === fact.evidenceId)?.documentName ?? '来源不可用'}</small><b>{fact.value}</b></span><span>{fact.sourceReview?.status === 'invalidated' ? '候选失效' : fact.sourceReview ? '待重确认' : project && factSourceAvailable(project, fact) ? '当前有效' : '不可用'}</span></button>)}{!visibleFacts.length && <p>暂无符合条件的事实。</p>}</div>
      </> : <><div className="fact-table-head material-review-row"><span>任务类型</span><span>处理内容与来源</span><span>待办状态</span></div>
        <div className="fact-list">{visibleTasks.map(item => {
          const { material, evidence, fact } = sourceTask(item)
          return <button type="button" key={item.id} className={`fact-row material-review-row ${selection?.kind === 'task' && selection.taskId === item.id ? 'selected' : ''}`} onClick={() => setSelection({ kind: 'task', taskId: item.id })}>
            <span><StatusDot tone={item.type === 'fact_source_reconfirmation' ? 'yellow' : 'muted'} />{reviewLabels[item.type]}</span><span><small>{material?.fileName ?? evidence?.documentName ?? '独立人工来源'}{evidence?.locator ? ` · ${evidence.locator}` : ''}</small><b>{fact ? `${fact.attribute}：${fact.value}` : item.type === 'material_usage' ? `${item.blockIds.length} 个资料块需要明确用途` : '核对产品证据并提取候选'}</b></span><span>{item.type === 'fact_source_reconfirmation' ? item.status === 'ready' ? '新证据就绪' : '缺少有效证据' : '等待处理'}</span>
          </button>
        })}{reviews.current && !visibleTasks.length && <p>当前筛选下没有待处理任务。</p>}</div>
      </>}
      <div className="queue-summary"><span>{filter === 'facts' ? `显示 ${visibleFacts.length} 条事实` : reviews.current ? `显示 ${visibleTasks.length} 项 · R${reviews.center!.revision}` : '待处理数量尚未校准'}</span><b>{readyFacts.length} 条已确认且来源有效</b></div>
      <div className="inspector-block"><Button disabled={!s.canWrite} onClick={() => setSelection({ kind: 'candidate', scope: 'manual', initial: emptyFactCandidate })}>补充人工候选</Button>
        <details><summary>模型提取与运行记录</summary><label><input type="checkbox" checked={s.runConsent} disabled={!s.canWrite} onChange={e => s.setRunConsent(e.target.checked)} />允许本项目的模型运行请求</label><p className="integration-note">显式提交后，从全部当前有效产品证据提取候选；参考内容与已撤回证据不会进入模型输入。</p>
          <Button disabled={!s.canWrite || !s.runConsent || !availableSources.length || !project?.identity || activeRun || (!!project?.production && !reviews.current)} onClick={() => { if (project?.production && !reviews.isCurrent()) return; void s.write('runs', { skill: 'extract-facts' }, '事实提取已提交。') }}>从有效产品证据提取候选</Button>
          {runs.map(run => <p key={run.id}>{run.id} · {run.queueStatus === 'queued' ? '排队中' : run.queueStatus === 'claimed' ? '执行中' : run.runStatus === 'succeeded' ? '已完成' : run.runStatus === 'failed' ? '失败' : run.runStatus}{run.errorCode && ` · ${run.errorCode}`}{run.runStatus === 'failed' && <Button disabled={!s.canWrite || !s.runConsent || activeRun} onClick={() => void s.write(`runs/${run.id}/retry`, {}, '提取重试已提交。')}>重试提取</Button>}</p>)}
        </details>
      </div>
    </section>
    <aside className="inspector fact-inspector material-review-inspector">
      {selection?.kind === 'manual-evidence' ? <><PanelTitle eyebrow="MANUAL EVIDENCE" title="人工独立补证" /><p className="integration-note">人工粘贴独立文字证据。原件派生证据请在对应原件逐块审核用途。</p><ManualEvidenceFields session={s} surface="facts" /></>
        : selection?.kind === 'candidate' ? <CandidateInspector key={`candidate:${selection.scope}`} selection={selection} session={s} reviews={reviews} onSaved={chooseFact} />
          : selectedMaterial ? <UsageInspector key={`usage:${selectedMaterial.id}`} material={selectedMaterial} session={s} reviews={reviews} onFact={chooseFact} />
            : task?.type === 'fact_source_reconfirmation' ? <ReconfirmationInspector key={`reconfirm:${task.factId}`} task={task} session={s} reviews={reviews} onUsage={chooseUsage} />
              : selectedFact ? <FactInspector key={`fact:${selectedFact.id}`} fact={selectedFact} session={s} reviews={reviews} onCandidate={setSelection} onReconfirm={() => { const next = reviews.tasks.find(item => item.type === 'fact_source_reconfirmation' && item.factId === selectedFact.id); if (next) setSelection({ kind: 'task', taskId: next.id }) }} />
                : extractionEvidence ? <><PanelTitle eyebrow="FACT EXTRACTION" title="核对证据并提取候选" /><EvidenceDetails evidence={extractionEvidence} /><p>当前任务来自用途已审核的产品证据。核对原文后可人工补充候选；也可在中栏显式提交模型提取。</p><Button disabled={!s.canWrite || !reviews.current} onClick={() => setSelection({ kind: 'candidate', scope: `extract:${extractionEvidence.id}`, initial: { ...emptyFactCandidate, evidenceId: extractionEvidence.id } })}>基于此证据补充人工候选</Button></>
                  : <><PanelTitle eyebrow="REVIEW INSPECTOR" title="处理详情" /><p>{selection?.kind === 'task' ? '该任务正在重新读取，或已处理完成。保留的草稿不会被覆盖。' : '选择一项待处理任务，或从原件打开用途审核与纠正。'}</p></>}
    </aside>
    <div className="stage-bottom facts-bottom"><div className="metric-block"><span>冲突事实</span><strong className="bad">{blockers}</strong><small>依据服务端状态</small></div><div className="metric-block"><span>人工确认</span><strong>{confirmed.length}</strong><small>{readyFacts.length} 条来源当前有效</small></div><Button tone="violet" onClick={() => onStage('story')} disabled={!project}><Layers3 size={16} />查看初步故事顺序</Button><div className="gate-disabled"><Lock size={17} /><div><b>生成正式故事线</b><span>正式批准尚未接入</span></div></div></div>
  </div>
}
