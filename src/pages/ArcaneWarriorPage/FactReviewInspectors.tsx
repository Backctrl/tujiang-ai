import { Lock } from 'lucide-react'
import type { Fact } from './stage-a-api'
import type { ProjectSession } from './useProjectSession'
import type { MaterialReviewsController } from './useMaterialReviews'
import { Button, Chip, PanelTitle } from './WorkbenchUI'
import { DraftReviewNotice, EvidenceDetails } from './MaterialReviewInspectors'
import { candidateDraftBase, candidateValid, emptyFactCandidate, evidenceAvailable, factSourceAvailable, factStatusLabels, factTaskBase, type FactCandidateDraft } from './material-review'
import { useReviewDraft } from './useReviewDraft'

export type CandidateSelection = { kind: 'candidate'; scope: string; initial: FactCandidateDraft }
export function CandidateInspector({ selection, session: s, reviews, onSaved }: { selection: CandidateSelection; session: ProjectSession; reviews: MaterialReviewsController; onSaved: (id: string) => void }) {
  const local = useReviewDraft(s, selection.scope === 'manual' ? 'factCandidate' : `factCandidate:${selection.scope}`, selection.initial, candidateDraftBase)
  // Older independent drafts had their reason in the shared session field. Keep their text and require review of their old base.
  const draft = { ...emptyFactCandidate, ...local.value, reason: local.value.reason ?? '' }
  const sources = s.project?.evidence.filter(evidence => evidenceAvailable(s.project!, evidence)) ?? []
  const evidence = s.project?.evidence.find(item => item.id === draft.evidenceId)
  const update = (next: Partial<FactCandidateDraft>) => local.update({ ...draft, ...next })
  const save = () => {
    const latest = s.getLatestProject()
    if (!latest || !local.currentForSave() || !candidateValid(latest, draft) || (latest.production && !reviews.isCurrent())) return
    void s.reviewWrite('fact-candidate', 'facts/candidates', { ...draft, reason: draft.reason.trim() }, '人工候选已保存，仍需逐条确认。', next => {
      if (local.afterSave(next)) onSaved(next.facts.at(-1)?.id ?? '')
    })
  }
  return <><PanelTitle eyebrow="FACT CANDIDATE" title={draft.correctsFactId ? '纠错为新候选' : '补充人工候选'} />
    <p className="integration-note">填写事实表述并逐字引用有效产品证据。保存形成候选，确认事实需单独操作。</p>
    <DraftReviewNotice needsReview={local.needsReview} disabled={!s.canWrite} title="候选草稿依据已变化" acknowledge={local.acknowledge} discard={local.discard}>
      <p>产品身份：{local.originalBase?.identity?.productName ?? '未记录或未确认'} → {local.currentBase.identity?.productName ?? '未确认'}</p>
      <p>原来源：{local.originalBase?.evidence?.documentName ?? '未记录'}；当前来源：{evidence?.documentName ?? '未选择或不可用'}{evidence?.availability === 'withdrawn' ? '（已撤回）' : ''}</p>
      {draft.correctsFactId && <p>当前被纠错事实：{local.currentBase.correctedFact?.value ?? '不存在'} · {local.currentBase.correctedFact ? factStatusLabels[local.currentBase.correctedFact.status] : ''}</p>}
    </DraftReviewNotice>
    <div className="agent-draft"><div className="form-grid">
      <label className="wide">属性<input maxLength={100} value={draft.attribute} disabled={!s.canWrite} onChange={e => update({ attribute: e.target.value })} /></label>
      <label className="wide">事实表述<textarea maxLength={1000} value={draft.value} disabled={!s.canWrite} onChange={e => update({ value: e.target.value })} /></label>
      <label>角色<select value={draft.role} disabled={!s.canWrite} onChange={e => update({ role: e.target.value as FactCandidateDraft['role'] })}><option value="core">核心</option><option value="supporting">辅助</option></select></label>
      <label>产品证据来源<select value={draft.evidenceId} disabled={!s.canWrite} onChange={e => update({ evidenceId: e.target.value })}><option value="">选择有效产品证据</option>{sources.map(source => <option key={source.id} value={source.id}>{source.documentName} · {source.locator}</option>)}
        {draft.evidenceId && !sources.some(source => source.id === draft.evidenceId) && <option value={draft.evidenceId} disabled>草稿来源已不可用，请重新选择</option>}
      </select></label>
      <label className="wide">连续原文摘录<textarea maxLength={2000} value={draft.quote} disabled={!s.canWrite} onChange={e => update({ quote: e.target.value })} /></label>
      <label className="wide">补充候选原因<textarea maxLength={1000} value={draft.reason} disabled={!s.canWrite} onChange={e => update({ reason: e.target.value })} /></label>
    </div></div>
    {evidence && <EvidenceDetails evidence={evidence} />}
    {!s.project?.identity && <p role="status">请先在项目设置确认事实提取用产品身份。</p>}
    <Button tone="violet" className="full" disabled={!s.canWrite || local.needsReview || !s.project || !candidateValid(s.project, draft) || (!!s.project.production && !reviews.current)} onClick={save}>保存候选</Button>
    {local.active && !local.needsReview && <Button disabled={!s.canWrite} onClick={local.discard}>放弃此候选草稿</Button>}
  </>
}
export function FactInspector({ fact, session: s, reviews, onCandidate, onReconfirm }: { fact: Fact; session: ProjectSession; reviews: MaterialReviewsController; onCandidate: (selection: CandidateSelection) => void; onReconfirm: () => void }) {
  const local = useReviewDraft(s, `factReview:${fact.id}`, { reason: '' }, project => factTaskBase(project, fact.id))
  const evidence = s.project!.evidence.find(item => item.id === fact.evidenceId)
  const sourceCurrent = factSourceAvailable(s.project!, fact)
  const confirmTask = reviews.tasks.some(task => task.type === 'fact_review' && task.factId === fact.id)
  const reconfirmTask = reviews.tasks.some(task => task.type === 'fact_source_reconfirmation' && task.factId === fact.id)
  const review = (action: 'confirm' | 'reject' | 'retract') => {
    const latest = s.getLatestProject()
    const current = latest?.facts.find(item => item.id === fact.id)
    if (!latest || !current || !local.currentForSave() || !local.value.reason.trim() || local.value.reason.length > 1000 || (latest.production && !reviews.isCurrent())) return
    if (action === 'confirm' && (!factSourceAvailable(latest, current) || current.issueSeverity === 'blocker' || (latest.production && !confirmTask))) return
    void s.reviewWrite(`fact-${action}`, `facts/${fact.id}/${action}`, { reason: local.value.reason.trim() }, '人工审核已保存。', local.afterSave)
  }
  const disabled = !s.canWrite || local.needsReview || !local.value.reason.trim() || (!!s.project?.production && !reviews.current)
  return <><PanelTitle eyebrow="FACT INSPECTOR" title="事实详情" action={<Chip tone={fact.sourceReview ? 'red' : fact.status === 'confirmed' ? 'green' : 'muted'}>{factStatusLabels[fact.status]}</Chip>} />
    <div className="meta-grid"><span>事实 ID<b>{fact.id}</b></span><span>类型<b>{fact.role === 'core' ? '核心' : '辅助'}</b></span><span>锁定<b>{fact.locked ? '已锁定值' : '未锁定'}</b></span></div>
    <div className="inspector-block"><b>{fact.attribute}</b><p className="assertion">{fact.value}</p><p>证据摘录：{fact.quote}</p></div>
    {fact.sourceReview && <div className="inspector-block" role="status"><b>{fact.sourceReview.status === 'invalidated' ? '候选来源已失效，不能确认' : '已锁事实等待来源重确认'}</b><p>{fact.sourceReview.reason}</p><p>{fact.sourceReview.actor} · 用途第 {fact.sourceReview.usageVersion} 版</p>{reconfirmTask && <Button onClick={onReconfirm}>处理来源重确认</Button>}</div>}
    {evidence && <EvidenceDetails evidence={evidence} />}
    <Button disabled={!s.canWrite} onClick={() => onCandidate({ kind: 'candidate', scope: `correct:${fact.id}`, initial: { ...emptyFactCandidate, attribute: fact.attribute, value: fact.value, role: fact.role, evidenceId: fact.evidenceId, quote: fact.quote, correctsFactId: fact.id } })}>纠错为新候选</Button>
    <DraftReviewNotice needsReview={local.needsReview} disabled={!s.canWrite} title="事实审核依据已变化" acknowledge={local.acknowledge} discard={local.discard}>
      <p>原事实：{local.originalBase?.fact?.value ?? '未记录'} · {local.originalBase?.fact ? factStatusLabels[local.originalBase.fact.status] : ''}</p><p>当前事实：{fact.value} · {factStatusLabels[fact.status]}；{sourceCurrent ? '来源有效' : '来源不可用于确认'}。</p>
    </DraftReviewNotice>
    <div className="inspector-block"><label>此事实的审核原因<textarea maxLength={1000} value={local.value.reason} disabled={!s.canWrite} onChange={e => local.update({ reason: e.target.value })} /></label></div>
    {fact.status === 'candidate' && <><Button tone="primary" className="full" disabled={disabled || !sourceCurrent || fact.issueSeverity === 'blocker' || (!!s.project?.production && !confirmTask)} onClick={() => review('confirm')}><Lock size={15} />确认此事实</Button><Button disabled={disabled} onClick={() => review('reject')}>拒绝此候选</Button></>}
    {fact.status === 'confirmed' && <Button disabled={disabled} onClick={() => review('retract')}>撤回此事实并标记影响</Button>}
    <p className="hint">人工确认不等于正式事实基线批准。</p>
    {(fact.confirmedAt || fact.sourceReconfirmations?.length) && <details className="inspector-block"><summary>查看确认与来源历史</summary>{fact.confirmedAt && <p>原确认：{fact.confirmedBy} · {fact.confirmedAt}</p>}{fact.sourceReconfirmations?.map((record, index) => <p key={index}>{record.actor} · {record.at} · {record.reason}；{record.previousEvidenceId} → {record.evidenceId}</p>)}</details>}
  </>
}
