import { useState, type ReactNode } from 'react'
import type { Evidence, Project } from '../../../backend/src/contracts'
import type { Material } from '../../../backend/src/production-materials'
import type { MaterialReviewTask, MaterialSourceImpact, MaterialUse } from '../../../backend/src/production-material-usage'
import type { ProjectSession } from './useProjectSession'
import type { MaterialReviewsController } from './useMaterialReviews'
import { Button, Chip, PanelTitle } from './WorkbenchUI'
import { CandidateContent, SourceLocation } from './MaterialIntakeFields'
import { materialBlockLocation } from './material-intake'
import { useReviewDraft } from './useReviewDraft'
import { allowedMaterialUses, emptyUsageDraft, usageLabels, usageStatusLabels, usageDraftBase, usageDraftValid, usageDecisions,
  usageChangeImpact, factTaskBase, reconfirmEvidence } from './material-review'

export function DraftReviewNotice({ needsReview, disabled, title, children, acknowledge, discard }: {
  needsReview: boolean; disabled: boolean; title: string; children: ReactNode; acknowledge: () => void; discard: () => void
}) {
  if (!needsReview) return null
  return <div className="inspector-block review-change-notice" role="alert"><b>{title}</b>{children}
    <p>保留的输入尚未提交。比较当前来源与影响后，再决定是否继续。</p>
    <Button disabled={disabled} onClick={acknowledge}>已比较当前依据，保留草稿</Button><Button disabled={disabled} onClick={discard}>放弃此草稿</Button>
  </div>
}
export function EvidenceDetails({ evidence }: { evidence: Evidence }) {
  const source = evidence.materialSource
  return <div className="inspector-block"><b>{evidence.documentName}</b><p>{evidence.locator} · {evidence.availability === 'withdrawn' ? '已撤回' : '有效产品证据'}</p>
    <p className="review-source-text">{evidence.text}</p>
    {source ? <><p>原件：{source.fileName} · 用途第 {source.usageVersion} 版</p><SourceLocation source={source.source} /><details><summary>查看来源标识</summary><p>证据 ID：{evidence.id}</p><p>原件 ID：{source.materialId}</p><p>资料块：{source.blockId}</p><p>原件 SHA-256：{source.sourceSha256}</p><p>解析器：{source.parserVersion}</p></details></> : <p>独立人工录入 · 证据 ID：{evidence.id}</p>}
  </div>
}
export function SourceImpact({ impact, project, onFact, preview = false }: { impact: MaterialSourceImpact; project: Project; onFact: (id: string) => void; preview?: boolean }) {
  const facts = (ids: string[], verb: string) => !!ids.length && <div><p>{verb} {ids.length} 条：</p>{ids.map(id => {
    const fact = project.facts.find(item => item.id === id)
    return <button className="source-link" type="button" key={id} onClick={() => onFact(id)}>{fact ? `${fact.attribute}：${fact.value}` : id}</button>
  })}</div>
  return <div className="inspector-block"><b>{preview ? '提交后将产生的影响' : '服务端记录的实际影响'}</b>
    {impact.affectedEvidenceIds.length ? <><p>{preview ? '将撤回' : '已撤回'} {impact.affectedEvidenceIds.length} 条旧产品证据。</p><details><summary>查看旧证据</summary>{impact.affectedEvidenceIds.map(id => {
      const evidence = project.evidence.find(item => item.id === id)
      return <p key={id}>{evidence?.documentName ?? id} · {evidence?.locator ?? ''} · {id}</p>
    })}</details></> : <p>本次不撤回产品证据。</p>}
    {facts(impact.affectedCandidateIds, preview ? '原候选将失效' : '原候选已标记失效')}
    {facts(impact.reconfirmationRequiredFactIds, preview ? '已锁事实将保留值并等待来源重确认' : '已锁事实已保留值并标记来源待重确认')}
    {!!impact.affectedSectionIds.length && <p>{preview ? '将标记失效' : '已记录受影响'}章节 {impact.affectedSectionIds.length} 个：{impact.affectedSectionIds.join('、')}</p>}
    {!!impact.affectedStoryboardIds.length && <p>{preview ? '将标记失效' : '已记录受影响'}故事顺序 {impact.affectedStoryboardIds.length} 份：{impact.affectedStoryboardIds.join('、')}</p>}
    {preview && !!impact.affectedFactIds.length && <p>恢复产品证据用途会创建新证据；旧候选不会自动恢复，已锁事实仍需逐条重确认来源。</p>}
  </div>
}
export function UsageInspector({ material, session: s, reviews, onFact }: { material: Material; session: ProjectSession; reviews: MaterialReviewsController; onFact: (id: string) => void }) {
  const draft = useReviewDraft(s, `materialUsage:${material.id}`, emptyUsageDraft, (project, value) => usageDraftBase(project, material.id, value))
  const [page, setPage] = useState(0)
  const form = draft.value
  const size = 15
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(material.blocks.length / size) - 1))
  const decisions = usageDecisions(material, form)
  const changed = decisions.filter(item => material.usageReview?.current[item.blockId]?.usage !== item.usage)
  const impact = usageChangeImpact(s.project!, material, form)
  const save = () => {
    const latest = s.getLatestProject()
    const current = latest?.production?.materials?.find(item => item.id === material.id)
    if (!current || !reviews.isCurrent() || !draft.currentForSave() || !usageDraftValid(current, form)) return
    void s.reviewWrite('material-usage', `production/materials/${material.id}/usage`, { reason: form.reason.trim(), decisions: usageDecisions(current, form) }, '资料块用途已保存，待处理任务将更新。', draft.afterSave)
  }
  return <><PanelTitle eyebrow="MATERIAL USAGE" title="逐块审核用途" action={<Chip tone={material.usage.status === 'reviewed' ? 'green' : 'muted'}>{usageStatusLabels[material.usage.status]}</Chip>} />
    <b>{material.fileName}</b><SourceLocation source={material.source} />
    <p className="integration-note">每个资料块单独选择用途；未选择的块保持当前状态。产品证据进入候选提取，参考内容不会作为产品事实。</p>
    <DraftReviewNotice needsReview={draft.needsReview} disabled={!s.canWrite} title="用途草稿依据已变化" acknowledge={draft.acknowledge} discard={draft.discard}>
      <p>用途版本：{draft.originalBase?.material?.usageReview?.version ?? 0} → {draft.currentBase.material?.usageReview?.version ?? 0}；产品身份：{draft.originalBase?.identity?.productName ?? '未确认'} → {draft.currentBase.identity?.productName ?? '未确认'}</p>
      <p>请比较每块当前用途与下面保留的选择，并重新检查影响。</p>
    </DraftReviewNotice>
    {material.blocks.slice(pageIndex * size, (pageIndex + 1) * size).map(block => {
      const current = material.usageReview?.current[block.id]
      return <div className="review-block" key={block.id}><CandidateContent block={block} />
        <p>当前用途：{current ? `${usageLabels[current.usage]} · 第 ${current.version} 版` : '尚未审核'}</p>
        <label>为「{materialBlockLocation(block)}」选择用途<select value={form.choices[block.id] ?? ''} disabled={!s.canWrite} onChange={e => draft.update({ ...form, choices: { ...form.choices, [block.id]: e.target.value as MaterialUse | '' } })}>
          <option value="">本次不提交此块</option>{allowedMaterialUses(block).map(usage => <option key={usage} value={usage}>{usageLabels[usage]}</option>)}
        </select></label>
      </div>
    })}
    {material.blocks.length > size && <div className="connection-actions"><Button disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>上一页</Button><span>第 {pageIndex + 1}/{Math.ceil(material.blocks.length / size)} 页</span><Button disabled={(pageIndex + 1) * size >= material.blocks.length} onClick={() => setPage(pageIndex + 1)}>下一页</Button></div>}
    <div className="inspector-block"><label>用途审核原因<textarea maxLength={1000} value={form.reason} disabled={!s.canWrite} onChange={e => draft.update({ ...form, reason: e.target.value })} placeholder="说明这些资料块用于产品证据、素材或参考的依据" /></label></div>
    <p className="hint">本次明确选择 {decisions.length} 块，其中 {changed.length} 块用途会改变。</p>
    <SourceImpact impact={impact} project={s.project!} onFact={onFact} preview />
    {changed.some(item => material.usageReview?.current[item.blockId] && material.usageReview.current[item.blockId].usage !== 'product_evidence') && <p className="integration-note">已存在的旧素材或参考记录会撤回，新用途生成独立记录并保留历史。</p>}
    {changed.some(item => item.usage === 'product_evidence' && material.usageReview?.current[item.blockId]) && <p className="integration-note">此次会创建新的产品证据。已失效的旧候选保持失效，已锁事实需到来源待重确认逐条处理。</p>}
    <Button tone="violet" className="full" disabled={!s.canWrite || !reviews.current || draft.needsReview || !usageDraftValid(material, form)} onClick={save}>保存所选资料块用途</Button>
    {draft.active && !draft.needsReview && <Button disabled={!s.canWrite} onClick={draft.discard}>放弃未保存用途选择</Button>}
    <details className="inspector-block"><summary>用途审核历史（{material.usageReview?.history.length ?? 0}）</summary>{[...(material.usageReview?.history ?? [])].reverse().map(receipt => <div className="review-block" key={receipt.id}>
      <b>用途第 {receipt.version} 版 · {receipt.actor}</b><p>{new Date(receipt.at).toLocaleString('zh-CN')} · {receipt.reason}</p>
      {receipt.changes.map(change => <p key={change.blockId}>{material.blocks.find(block => block.id === change.blockId) ? materialBlockLocation(material.blocks.find(block => block.id === change.blockId)!) : change.blockId}：{change.previousUsage ? usageLabels[change.previousUsage] : '未审核'} → {usageLabels[change.usage]}</p>)}
      <SourceImpact impact={receipt.impact} project={s.project!} onFact={onFact} />
    </div>)}</details>
  </>
}
export function ReconfirmationInspector({ task, session: s, reviews, onUsage }: {
  task: Extract<MaterialReviewTask, { type: 'fact_source_reconfirmation' }>; session: ProjectSession; reviews: MaterialReviewsController; onUsage: (id: string) => void
}) {
  const draft = useReviewDraft(s, `sourceReconfirm:${task.factId}`, { reason: '', evidenceId: '' }, project => factTaskBase(project, task.factId))
  const fact = s.project!.facts.find(item => item.id === task.factId)
  const replacement = reconfirmEvidence(s.project!, task)
  const save = () => {
    const latest = s.getLatestProject()
    if (!latest || !reviews.isCurrent() || !draft.currentForSave() || !draft.value.reason.trim() || draft.value.reason.length > 1000) return
    const source = reconfirmEvidence(latest, task)
    if (!source || source.id !== draft.value.evidenceId) return
    void s.reviewWrite('source-reconfirm', `facts/${task.factId}/source/reconfirm`, { reason: draft.value.reason.trim(), evidenceId: source.id }, '事实来源已重确认，原事实值与既有失效标记保留。', draft.afterSave)
  }
  return <><PanelTitle eyebrow="SOURCE RECONFIRMATION" title="事实来源重确认" action={<Chip tone={replacement ? 'yellow' : 'red'}>{replacement ? '新证据可用' : '等待有效新证据'}</Chip>} />
    <div className="inspector-block"><b>{fact?.attribute}</b><p className="assertion">{fact?.value}</p><p>原事实值已锁定。这里只更新证据来源。</p><p>原摘录：{fact?.quote}</p><p>来源变化原因：{fact?.sourceReview?.reason}</p></div>
    <DraftReviewNotice needsReview={draft.needsReview} disabled={!s.canWrite} title="重确认草稿依据已变化" acknowledge={draft.acknowledge} discard={draft.discard}>
      <p>原依据值：{draft.originalBase?.fact?.value ?? '未记录'}；当前值：{fact?.value}。</p><p>请比较当前新证据与旧摘录，再选择有效来源。</p>
    </DraftReviewNotice>
    {replacement ? <><EvidenceDetails evidence={replacement} /><label>重确认使用的新证据<select value={draft.value.evidenceId} disabled={!s.canWrite} onChange={e => draft.update({ ...draft.value, evidenceId: e.target.value })}>
      <option value="">明确选择同原件、同资料块的新证据</option><option value={replacement.id}>{replacement.documentName} · {replacement.locator} · 用途第 {replacement.materialSource!.usageVersion} 版</option>
      {draft.value.evidenceId && draft.value.evidenceId !== replacement.id && <option value={draft.value.evidenceId} disabled>草稿原证据已不可用</option>}
    </select></label></> : <p>此资料块当前没有可重确认的有效产品证据。先纠正该原件的用途，再回来核对同一块的新证据。</p>}
    <Button onClick={() => onUsage(task.materialId)}>查看该原件用途</Button>
    <div className="inspector-block"><label>来源重确认原因<textarea maxLength={1000} value={draft.value.reason} disabled={!s.canWrite} onChange={e => draft.update({ ...draft.value, reason: e.target.value })} /></label></div>
    <p className="integration-note">重确认保留 locked 值、原确认记录和来源历史；已有章节与故事顺序失效状态需继续处理。</p>
    {!!task.affectedSectionIds.length && <p>受影响章节：{task.affectedSectionIds.join('、')}</p>}{!!task.affectedStoryboardIds.length && <p>受影响故事顺序：{task.affectedStoryboardIds.join('、')}</p>}
    <Button tone="violet" className="full" disabled={!s.canWrite || !reviews.current || draft.needsReview || !replacement || draft.value.evidenceId !== replacement.id || !draft.value.reason.trim()} onClick={save}>仅重确认此事实的来源</Button>
    {!!fact?.sourceReconfirmations?.length && <details className="inspector-block"><summary>以往来源重确认记录</summary>{fact.sourceReconfirmations.map((record, index) => <p key={index}>{record.actor} · {record.at} · {record.reason}；{record.previousEvidenceId} → {record.evidenceId}</p>)}</details>}
  </>
}
