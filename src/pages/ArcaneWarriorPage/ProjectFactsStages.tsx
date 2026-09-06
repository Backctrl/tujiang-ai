import { useProjectDraft, useReviewedDraft } from './project-drafts'
import { useState } from 'react'
import { ArrowLeft, ArrowRight, FileText, Layers3, Lock, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import type { StageId } from './domain'
import type { ProjectSession } from './useProjectSession'
import type { Evidence, Fact } from '../../../backend/src/contracts'
import { Button, Chip, PanelTitle, StatusDot } from './WorkbenchUI'
import { useProjectContext } from './useProjectContext'
import { CanvasFields, ContextControls, ContextReadiness, LocaleFields, ProductBriefFields, TargetFields } from './ProjectContextFields'
import { MaterialList, MaterialUploadFields } from './MaterialIntakeFields'
import type { MaterialIntakeController } from './useMaterialIntake'

type Props = { session: ProjectSession; onStage: (stage: StageId) => void; intake: MaterialIntakeController }
const statusLabel: Record<Fact['status'], string> = { candidate: '待确认', confirmed: '已确认', rejected: '已拒绝', retracted: '已撤回' }

export function ProjectSetup({ session: s, onStage, intake }: Props) {
  const [name, setName] = useState('')
  const context = useProjectContext(s)
  const identityDraft = useReviewedDraft<string | null, { revision: number; name: string }>(s.project?.id, 'productName', null, () => ({ revision: s.project?.identityRevision ?? 0, name: s.project?.identity?.productName ?? '未确认' }))
  const productName = identityDraft.value
  const setProductName = identityDraft.setValue
  const [documentName, setDocumentName] = useProjectDraft(s.project?.id, 'documentName', '')
  const [locator, setLocator] = useProjectDraft(s.project?.id, 'locator', '')
  const [text, setText] = useProjectDraft(s.project?.id, 'evidenceText', '')
  const sources = s.project?.evidence ?? []
  const identityValue = productName ?? s.project?.identity?.productName ?? ''
  return <div className="setup-workbench">
    <aside className="rail setup-steps"><PanelTitle eyebrow="PROJECT SETUP" title="项目设置" />{['产品基础信息', '产品资料', '平台与站点', '本地化配置', '页面尺寸'].map((item, index) => <button key={item} onClick={() => document.getElementById(`setup-${index}`)?.scrollIntoView({ block: 'nearest' })}><span>{String(index + 1).padStart(2, '0')}</span><b>{item}</b></button>)}</aside>
    <section className="setup-main">
      <div className="form-panel setup-section" id="setup-0"><PanelTitle eyebrow="01 / PRODUCT FOUNDATION" title="产品基础信息" action={<Chip tone={context.activeVersion ? 'green' : 'muted'}>{context.activeVersion?.label ?? (context.initialized ? '配置草稿' : '待开启配置')}</Chip>} />
        <div className="form-grid setup-form-grid">
          <label className="wide">连接凭据<input type="password" autoComplete="off" disabled={s.busy || ((!!s.project || !!s.pending) && !s.authExpired && !s.recoveryNeedsCheck)} value={s.token} onChange={e => s.setToken(e.target.value)} placeholder="仅保存在当前页面内存" /></label>
          <Button disabled={!s.token.trim() || s.busy || !!s.pending} onClick={() => void s.listProjects()}>连接并读取项目列表</Button>
          <label className="wide">已有项目<select value={s.projects.some(p => p.id === s.project?.id) ? s.project?.id : ''} disabled={!s.canSwitch || !s.token.trim()} onChange={e => void s.selectProject(e.target.value)}><option value="">选择项目</option>{s.projects.map(p => <option key={p.id} value={p.id}>{p.name} · R{p.revision}</option>)}</select></label>
          <label>新项目名称<input maxLength={150} value={name} disabled={!s.canSwitch} onChange={e => setName(e.target.value)} /></label><Button disabled={!s.token.trim() || !name.trim() || !s.canSwitch} onClick={() => void s.create(name)}>创建项目</Button>
          <p className="integration-note wide">切换项目时保留各项目本地草稿；凭据不保存。未决请求或未处理版本冲突期间不能切换。</p>
          <details className="wide"><summary>按项目 ID 打开（兼容入口）</summary><label>项目 ID<input value={s.projectId} disabled={!s.canSwitch} onChange={e => s.setProjectId(e.target.value)} /></label><Button disabled={!s.token.trim() || !s.projectId.trim() || !s.canSwitch} onClick={() => void s.selectProject(s.projectId.trim())}>打开项目</Button></details>
          <ContextControls context={context} session={s} />
          <ProductBriefFields context={context} />
          <details className="wide"><summary>事实提取身份 · {s.project?.identity?.productName ?? '待确认'}</summary><p className="integration-note">文字事实提取使用这里明确确认的产品身份。制作配置中的产品名称不会自动修改它。</p><div className="form-grid">
            <label className="wide">事实提取用产品名称<input maxLength={150} disabled={!s.canWrite} value={identityValue} onChange={e => setProductName(e.target.value)} /></label>
            {s.project?.identity && <label className="wide">修改原因<textarea maxLength={1000} value={s.reason} onChange={e => s.setReason(e.target.value)} disabled={!s.canWrite} /></label>}
            {identityDraft.needsReview && <div className="wide inspector-block" role="alert"><b>身份草稿需要复核</b><p>草稿依据：{identityDraft.originalBase?.name ?? '旧草稿未记录身份版本'}；当前产品：{identityDraft.currentBase.name}。保留的输入为：{productName}</p><Button disabled={!s.canWrite} onClick={identityDraft.acknowledge}>已比较身份，保留草稿继续</Button><Button disabled={!s.canWrite} onClick={identityDraft.discard}>放弃身份草稿，使用当前身份</Button></div>}
            <Button tone="primary" disabled={!s.canWrite || identityDraft.needsReview || !identityValue.trim() || (!!s.project?.identity && (!s.reasonValid || identityValue.trim() === s.project.identity.productName))} onClick={() => { if (identityDraft.needsReview) return; void s.write(s.project?.identity ? 'identity/correct' : 'identity/confirm', { productName: identityValue, ...(s.project?.identity ? { reason: s.reason } : {}) }, '产品身份已保存。', () => identityDraft.discard()) }}>{s.project?.identity ? '保存身份纠正' : '确认产品身份'}</Button>
          </div></details>
        </div>
      </div>
      <div className="form-panel setup-section setup-sources" id="setup-1"><PanelTitle eyebrow="02 / SOURCE INTAKE" title="产品资料" action={<span className="hint">已接收 {intake.materials.length} 份原件</span>} />
        <MaterialUploadFields intake={intake} session={s} surface="setup" />
        <div className="setup-source-list"><MaterialList intake={intake} session={s} /></div>
        <details className="inspector-block"><summary>原有文字证据录入 · {sources.length} 份</summary><p className="integration-note">可继续人工粘贴文字证据。这里的记录与上方原件候选分开保存，不会自动把上传资料转成证据。</p>
          <div className="form-grid"><label>资料名称<input maxLength={200} value={documentName} disabled={!s.canWrite} onChange={e => setDocumentName(e.target.value)} /></label><label>原文位置<input maxLength={300} value={locator} disabled={!s.canWrite} onChange={e => setLocator(e.target.value)} placeholder="例如：规格说明第 2 段" /></label><label className="wide">资料原文<textarea rows={5} maxLength={80000} value={text} disabled={!s.canWrite} onChange={e => setText(e.target.value)} placeholder="粘贴产品资料原文" /></label></div>
          <Button tone="violet" disabled={!s.canWrite || !documentName.trim() || !locator.trim() || !text.trim() || text.includes('\0') || sources.length >= 10} onClick={() => void s.write('evidence', { documentName, locator, text, usage: 'product_evidence' }, '文字证据已保存。', () => { setDocumentName(''); setLocator(''); setText('') })}>保存文字证据</Button><p className="hint">最多 10 份。点击保存后才写入后端。</p>
          <div className="setup-source-list">{sources.map(source => <SourceCard key={source.id} source={source} facts={s.project?.facts ?? []} />)}</div>
        </details>
      </div>
      <div className="form-panel setup-section compact-section" id="setup-2"><PanelTitle eyebrow="03 / CHANNEL" title="平台与站点" /><TargetFields context={context} session={s} /></div>
      <div className="form-panel setup-section compact-section" id="setup-3"><PanelTitle eyebrow="04 / LOCALE" title="本地化配置" /><LocaleFields context={context} /></div>
      <div className="form-panel setup-section compact-section page-size" id="setup-4"><PanelTitle eyebrow="05 / CANVAS" title="页面尺寸" /><CanvasFields context={context} /></div>
    </section>
    <aside className="inspector setup-check"><ContextReadiness context={context} session={s} /></aside>
    <div className="stage-bottom setup-bottom"><Button disabled><ArrowLeft size={15} />返回项目列表</Button><span>配置需保存并启用 · 事实身份独立确认</span><Button tone="primary" disabled={!s.project} onClick={() => onStage('facts')}>进入产品事实 <ArrowRight size={15} /></Button></div>
  </div>
}

function SourceCard({ source, facts }: { source: Evidence; facts: Fact[] }) {
  return <div className="source-card"><FileText size={19} /><div><b>{source.documentName}</b><span>{source.locator}</span><details><summary>查看资料原文</summary><p>{source.text}</p></details></div><div className="source-status"><StatusDot tone="muted" />{facts.filter(f => f.evidenceId === source.id).length} 项事实</div></div>
}

type Candidate = { attribute: string; value: string; role: 'core' | 'supporting'; evidenceId: string; quote: string; correctsFactId?: string }
const emptyCandidate: Candidate = { attribute: '', value: '', role: 'core', evidenceId: '', quote: '' }
export function FactsStage({ session: s, onStage, intake }: Props) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('')
  const [query, setQuery] = useState('')
  const candidateDraft = useReviewedDraft(s.project?.id, 'factCandidate', emptyCandidate, (value: Candidate) => ({ identityRevision: s.project?.identityRevision ?? 0, identityName: s.project?.identity?.productName ?? '未确认', correctedFact: s.project?.facts.find(f => f.id === value.correctsFactId) ?? null }))
  const draft = candidateDraft.value
  const setDraft = candidateDraft.setValue
  const [editing, setEditing] = useProjectDraft(s.project?.id, 'factEditing', false)
  const [replacement, setReplacement] = useState<ReturnType<typeof candidateDraft.prepareReplacement> | null>(null)
  const facts = s.project?.facts ?? []
  const sources = s.project?.evidence ?? []
  const selected = facts.find(f => f.id === selectedId)
  const visible = facts.filter(f => (filter === 'all' || f.status === filter) && (!sourceFilter || f.evidenceId === sourceFilter) && `${f.attribute} ${f.value}`.includes(query))
  const blockers = facts.filter(f => f.issueSeverity === 'blocker').length
  const evidence = sources.find(e => e.id === draft.evidenceId)
  const valid = !!draft.attribute.trim() && !!draft.value.trim() && !!draft.quote && !!evidence?.text.includes(draft.quote)
  const runs = s.project?.runs.filter(r => r.skill === 'extract-facts') ?? []
  const active = s.project?.runs.some(r => r.queueStatus !== 'done')
  const choose = (f: Fact) => { setSelectedId(f.id); setEditing(false) }
  const hasDraft = !!(draft.attribute || draft.value || draft.evidenceId || draft.quote || draft.correctsFactId || draft.role !== 'core')
  const edit = (f?: Fact) => {
    const next: Candidate = f ? { attribute: f.attribute, value: f.value, role: f.role, evidenceId: f.evidenceId, quote: f.quote, correctsFactId: f.id } : emptyCandidate
    const prepared = candidateDraft.prepareReplacement(next)
    if (hasDraft) { setReplacement(prepared); return }
    candidateDraft.replace(prepared); setEditing(true)
  }
  const review = (action: 'confirm' | 'reject' | 'retract') => { if (selected) void s.write(`facts/${selected.id}/${action}`, { reason: s.reason }, '人工审核已保存。') }
  return <div className="three-column facts-layout">
    <aside className="rail sources-rail"><PanelTitle eyebrow="EVIDENCE" title="资料与来源" action={<button type="button" className="icon-button" aria-label="添加资料" aria-expanded={uploadOpen} onClick={() => setUploadOpen(value => !value)}><Plus size={16} /></button>} /><div className="rail-tabs"><button className={!sourceFilter ? 'active' : ''} onClick={() => setSourceFilter('')}>全部文字证据 {sources.length}</button></div><div className="rail-list">{uploadOpen && <MaterialUploadFields intake={intake} session={s} surface="facts" />}<p className="hint">原件资料 {intake.materials.length} 份 · 候选用途待审核</p><MaterialList intake={intake} session={s} />{sources.map(source => <div key={source.id}><button className="source-link" onClick={() => setSourceFilter(source.id)}>筛选此文字证据</button><SourceCard source={source} facts={facts} /></div>)}{!sources.length && <p>尚无用于事实提取的文字证据。</p>}</div><Button className="full" disabled><ShieldCheck size={15} />证据库设置</Button></aside>
    <section className="primary-panel fact-queue"><PanelTitle title="待处理中心" eyebrow={`PRODUCT FACTS / ${facts.length} ITEMS`} action={<div className="filters"><select aria-label="事实状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部状态</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input aria-label="搜索事实" placeholder="搜索事实" value={query} onChange={e => setQuery(e.target.value)} /></div>} />
      <div className="fact-table-head"><span>类型</span><span>事实断言</span><span>证据</span><span>置信度</span><span>状态</span></div><div className="fact-list">{visible.map(f => <button key={f.id} className={`fact-row ${selectedId === f.id ? 'selected' : ''}`} onClick={() => choose(f)}><span><StatusDot tone={f.issueSeverity === 'blocker' ? 'red' : 'muted'} />{f.role === 'core' ? '核心' : '辅助'}</span><span><small>{f.attribute}</small><b>{f.value}</b></span><span>{sources.find(e => e.id === f.evidenceId)?.documentName ?? '来源不可用'}</span><span>未提供</span><span><Chip tone={f.issueSeverity === 'blocker' ? 'red' : f.status === 'confirmed' ? 'green' : 'muted'}>{statusLabel[f.status]}{f.issueSeverity === 'blocker' ? ' · 冲突' : ''}</Chip></span></button>)}{!visible.length && <p>暂无符合条件的事实。</p>}</div>
      <div className="queue-summary"><span>显示 {visible.length} 项</span><b>{s.confirmed.length} 项已人工确认</b></div>
      <div className="inspector-block"><label><input type="checkbox" checked={s.runConsent} disabled={!s.canWrite} onChange={e => s.setRunConsent(e.target.checked)} />允许本项目的模型运行请求</label><Button disabled={!s.canWrite || !s.runConsent || !sources.length || active} onClick={() => void s.write('runs', { skill: 'extract-facts' }, '事实提取已提交，请刷新查看结果。')}>提取事实候选</Button><Button disabled={!s.project || !s.token.trim() || s.busy} onClick={() => void s.refresh()}><RefreshCw size={14} />刷新状态</Button>{runs.map(run => <p key={run.id}>{run.id} · {run.queueStatus === 'queued' ? '排队中' : run.queueStatus === 'claimed' ? '执行中' : run.runStatus === 'succeeded' ? '已完成' : run.runStatus === 'failed' ? '失败' : run.runStatus}{run.errorCode && ` · ${run.errorCode}`}{run.runStatus === 'failed' && <Button disabled={!s.canWrite || !s.runConsent || active} onClick={() => void s.write(`runs/${run.id}/retry`, {}, '提取重试已提交。')}>重试提取</Button>}</p>)}</div>
    </section>
    <aside className="inspector fact-inspector"><PanelTitle eyebrow="FACT INSPECTOR" title="事实详情" action={selected && <Chip>{statusLabel[selected.status]}</Chip>} />
      {selected ? <><div className="meta-grid"><span>事实 ID<b>{selected.id}</b></span><span>类型<b>{selected.role === 'core' ? '核心' : '辅助'}</b></span><span>置信度<b>后端未提供</b></span></div><div className="inspector-block"><label>事实断言</label><p className="assertion">{selected.value}</p></div><div className="inspector-block"><label>证据摘录</label><p>{selected.quote}</p><span className="source-link"><FileText size={14} />{sources.find(e => e.id === selected.evidenceId)?.documentName ?? '来源不可用'}</span></div></> : <p>选择事实查看证据，或补充人工候选。</p>}
      <Button disabled={!s.canWrite} onClick={() => edit()}>补充人工候选</Button>{selected && <Button disabled={!s.canWrite} onClick={() => edit(selected)}>纠错为新候选</Button>}
      {hasDraft && !editing && <Button onClick={() => setEditing(true)}>继续编辑候选</Button>}
      {replacement && <div className="inspector-block" role="alert"><p>已有未保存候选。替换将放弃其内容。</p><Button disabled={!s.canWrite} onClick={() => { candidateDraft.replace(replacement); setReplacement(null); setEditing(true) }}>放弃原草稿并替换</Button><Button onClick={() => { setReplacement(null); setEditing(true) }}>保留并继续编辑</Button></div>}
      {hasDraft && candidateDraft.needsReview && <div className="inspector-block" role="alert"><b>候选草稿需要复核</b><p>产品身份：{candidateDraft.originalBase?.identityName ?? '旧草稿未记录身份版本'} → {candidateDraft.currentBase.identityName}</p>{draft.correctsFactId && <><p>原纠错依据：{candidateDraft.originalBase?.correctedFact ? `${candidateDraft.originalBase.correctedFact.attribute}：${candidateDraft.originalBase.correctedFact.value}（${statusLabel[candidateDraft.originalBase.correctedFact.status]}）` : '未记录或不存在'}</p><p>当前事实：{candidateDraft.currentBase.correctedFact ? `${candidateDraft.currentBase.correctedFact.attribute}：${candidateDraft.currentBase.correctedFact.value}（${statusLabel[candidateDraft.currentBase.correctedFact.status]}）` : '已不存在'}</p></>}<Button disabled={!s.canWrite} onClick={candidateDraft.acknowledge}>已比较候选依据，保留草稿继续</Button><Button disabled={!s.canWrite} onClick={() => { candidateDraft.discard(); setEditing(false); setReplacement(null) }}>放弃候选草稿</Button></div>}
      {editing && <div className="agent-draft"><b>人工候选草稿</b><div className="form-grid"><label className="wide">属性<input maxLength={100} value={draft.attribute} disabled={!s.canWrite} onChange={e => setDraft({ ...draft, attribute: e.target.value })} /></label><label className="wide">事实表述<textarea maxLength={1000} value={draft.value} disabled={!s.canWrite} onChange={e => setDraft({ ...draft, value: e.target.value })} /></label><label>角色<select value={draft.role} disabled={!s.canWrite} onChange={e => setDraft({ ...draft, role: e.target.value as Candidate['role'] })}><option value="core">核心</option><option value="supporting">辅助</option></select></label><label>来源<select value={draft.evidenceId} disabled={!s.canWrite} onChange={e => setDraft({ ...draft, evidenceId: e.target.value })}><option value="">选择来源</option>{sources.map(e => <option key={e.id} value={e.id}>{e.documentName}</option>)}</select></label><label className="wide">连续原文摘录<textarea maxLength={2000} value={draft.quote} disabled={!s.canWrite} onChange={e => setDraft({ ...draft, quote: e.target.value })} /></label></div><p className="hint">摘录必须与所选资料原文完全一致；纠错只创建候选，不自动撤回原事实。</p><Button tone="violet" disabled={!s.canWrite || candidateDraft.needsReview || !valid || !s.reasonValid} onClick={() => { if (candidateDraft.needsReview) return; void s.write('facts/candidates', { ...draft, reason: s.reason }, '人工候选已保存，仍需明确确认。', next => { setSelectedId(next.facts.at(-1)?.id ?? ''); setEditing(false); candidateDraft.discard(); setReplacement(null) }) }}>保存候选</Button><Button onClick={() => setEditing(false)}>收起草稿</Button></div>}
      <div className="inspector-block"><label>操作原因<textarea maxLength={1000} value={s.reason} disabled={!s.canWrite} onChange={e => s.setReason(e.target.value)} placeholder="说明确认、拒绝、撤回或补充的依据" /></label></div>
      {selected?.status === 'candidate' && <><Button tone="primary" className="full" disabled={!s.canWrite || !s.reasonValid || selected.issueSeverity === 'blocker'} onClick={() => review('confirm')}><Lock size={15} />确认事实</Button><Button disabled={!s.canWrite || !s.reasonValid} onClick={() => review('reject')}>拒绝候选</Button></>}{selected?.status === 'confirmed' && <Button disabled={!s.canWrite || !s.reasonValid} onClick={() => review('retract')}>撤回事实并标记影响</Button>}<p className="hint">候选需人工审核。正式事实基线批准尚未接入。</p>
    </aside>
    <div className="stage-bottom facts-bottom"><div className="metric-block"><span>冲突事实</span><strong className="bad">{blockers}</strong><small>依据服务端状态</small></div><div className="metric-block"><span>人工确认</span><strong>{s.confirmed.length}</strong><small>尚非正式批准基线</small></div><Button tone="violet" onClick={() => onStage('story')} disabled={!s.project}><Layers3 size={16} />查看初步故事顺序</Button><div className="gate-disabled"><Lock size={17} /><div><b>生成正式故事线</b><span>正式批准尚未接入</span></div></div></div>
  </div>
}
