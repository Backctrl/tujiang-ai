import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import logo from '@shared/static/images/arcane-warrior-brand-source.png'
import { ApiError, errorMessage, StageAApi } from './stage-a-api'
import type { Project, Fact, Storyboard } from './stage-a-api'
import './arcane-warrior.css'
import './stage-a.css'
import SectionDraftEditor from './SectionDraftEditor'

const stages = ['项目设置', '产品事实', '故事线', '章节制作', '市场适配', 'QA与导出']
const factLabels = { candidate: '待确认', confirmed: '已确认', rejected: '已拒绝', retracted: '已撤回' }
type Chapter = Storyboard['chapters'][number]
const roles = { identity: '产品身份', feature: '功能特点', evidence: '事实证明', usage: '使用方式' }
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="sa-field"><span>{label}</span>{children}</label>
}
function Action({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="button" onClick={onClick} disabled={disabled}>{children}</button>
}

export default function StageAWorkbench() {
  const [stage, setStage] = useState(0)
  const [token, setToken] = useState('')
  const [projectId, setProjectId] = useState(() => localStorage.getItem('tujiang_stage_a_project_id') ?? '')
  const [project, setProject] = useState<Project | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('输入后端连接凭据后创建项目，或读取已有项目。凭据仅在当前页面内存中使用。')
  const [pending, setPending] = useState<null | { run: () => Promise<Project>; label: string }>(null)
  const [conflict, setConflict] = useState(false)
  const [conflictBefore, setConflictBefore] = useState<Project | null>(null)
  const [name, setName] = useState('')
  const [productName, setProductName] = useState('')
  const [reason, setReason] = useState('')
  const [documentName, setDocumentName] = useState('')
  const [locator, setLocator] = useState('')
  const [text, setText] = useState('')
  const [selectedFactId, setSelectedFactId] = useState('')
  const [evidenceId, setEvidenceId] = useState('')
  const [attribute, setAttribute] = useState('')
  const [value, setValue] = useState('')
  const [quote, setQuote] = useState('')
  const [role, setRole] = useState<'core' | 'supporting'>('core')
  const [correctsFactId, setCorrectsFactId] = useState('')
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [storyDirty, setStoryDirty] = useState(false)
  const [runConsent, setRunConsent] = useState(false)
  const api = new StageAApi(token)
  const accept = (next: Project) => {
    setProject(next); if (JSON.stringify(next.storyboard?.chapters) === JSON.stringify(chapters)) setStoryDirty(false); setProjectId(next.id); localStorage.setItem('tujiang_stage_a_project_id', next.id)
  }
  // No background polling: refresh never replaces an employee's unsaved chapter edits.
  const perform = async (run: () => Promise<Project>, label: string, write = true) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    if (write) setPending({ run, label })
    try {
      const next = await run(); accept(next); setNotice(label)
      if (write) { setPending(null); setConflict(false); setConflictBefore(null) }
      return next
    } catch (err) {
      setError(errorMessage(err))
      if (err instanceof ApiError && (err.code === 'VERSION_CONFLICT' || err.code === 'REVISION_CONFLICT')) {
        setConflict(true); setConflictBefore(project); setPending(null)
      } else if (err instanceof ApiError && err.status > 0 && err.code !== 'INVALID_RESPONSE') setPending(null)
    } finally { busyRef.current = false; setBusy(false) }
  }
  const write = (path: string, fields: Record<string, unknown>, label: string, onSaved?: (next: Project) => void) => {
    if (!project || conflict || pending) return
    const key = crypto.randomUUID()
    return perform(async () => { const next = await api.write(project, path, fields, key); onSaved?.(next); return next }, label)
  }
  const refresh = () => { if (pending && !project) return; void perform(() => api.get(project?.id ?? projectId.trim()), '已读取服务端当前快照；未保存的表单保留，请核对后提交。', false) }
  const disabled = busy || !token.trim() || conflict || !!pending
  const canWrite = !!project && !disabled
  const confirmed = project?.facts.filter(f => f.status === 'confirmed') ?? []
  const hasConflict = project?.facts.some(f => f.issueSeverity === 'blocker') ?? false
  const canPlan = canWrite && !!project?.identity && confirmed.some(f => f.role === 'core') && !hasConflict
  const selected = project?.facts.find(f => f.id === selectedFactId)
  const selectedEvidence = project?.evidence.find(e => e.id === evidenceId)
  const reasonValid = !!reason.trim() && reason.length <= 1000
  const updateChapter = (index: number, patch: Partial<Chapter>) => {
    setChapters(items => items.map((c, i) => i === index ? { ...c, ...patch } : c)); setStoryDirty(true)
  }
  const loadStory = () => { setChapters(structuredClone(project?.storyboard?.chapters ?? [])); setStoryDirty(false) }
  useEffect(() => { setRunConsent(false) }, [project?.id])

  return <div className="arcane-warrior-page app-shell sa-shell">
    <header className="topbar"><div className="brand"><span className="client-logo"><img src={logo} alt="ARCANE WARRIOR" /></span></div>
      <div className="context-item"><span>阶段 A 项目</span><strong>{project?.name ?? '尚未连接'}</strong></div>
      <div className="context-item"><span>聚合版本 / API 快照</span><strong>{project ? `V${project.version} / R${project.revision}` : '—'}</strong></div>
      <div className="topbar-spacer" /><NavLink to="/arcane-warrior">查看交互演示</NavLink>
    </header>
    <nav className="stage-nav" aria-label="工作阶段">{stages.map((label, i) => <button key={label} className={i === stage ? 'active' : ''} aria-current={i === stage ? 'step' : undefined} onClick={() => setStage(i)}><span className="stage-number">0{i + 1}</span><b>{label}</b></button>)}</nav>
    <main className="workspace sa-workspace">
      <div className="sa-messages" aria-live="polite">{notice && <p role="status">{notice}</p>}{busy && <p role="status">正在读取或保存项目…</p>}{error && <p role="alert">{error}</p>}
        {pending && !busy && <div><Action onClick={() => void perform(pending.run, pending.label)}>重试原请求（相同操作编号）</Action><Action disabled={!project} onClick={refresh}>读取项目核对结果</Action></div>}
        {conflict && <div><p>已暂停写入；本地表单保留。先读取最新版本，再复核受影响的事实、故事顺序和审计记录。</p><Action disabled={busy} onClick={refresh}>读取最新版本</Action>
          <pre>{conflictBefore && project ? JSON.stringify({ before: { revision: conflictBefore.revision, facts: conflictBefore.facts, storyboard: conflictBefore.storyboard }, latest: { revision: project.revision, facts: project.facts, storyboard: project.storyboard } }, null, 2) : ''}</pre>
          <Action disabled={busy || project?.revision === conflictBefore?.revision} onClick={() => { setConflict(false); setConflictBefore(null); setError(''); setNotice('复核完成。请检查保留的表单，再手动提交新的操作。') }}>已复核差异，恢复编辑</Action></div>}
      </div>
      <div className="sa-columns">
        <aside className="sa-panel">
          <h2>项目连接</h2><Field label="后端连接凭据"><input type="password" autoComplete="off" disabled={busy || !!pending || !!project} value={token} onChange={e => setToken(e.target.value)} /></Field>
          <Field label="项目 ID（仅此 ID 保存到本机）"><input disabled={busy || !!pending || !!project} value={projectId} onChange={e => setProjectId(e.target.value)} /></Field>
          <Action disabled={busy || (!!pending && !project) || !token.trim() || !projectId.trim() || (!!project && projectId !== project.id)} onClick={refresh}>读取 / 刷新项目</Action>
          <p>切换项目或更新凭据请重新打开页面。未保存的表单不会自动提交。</p>
          <h3>证据资料（{project?.evidence.length ?? 0}）</h3>
          {project?.evidence.map(e => <button className="sa-list-item" key={e.id} onClick={() => { setEvidenceId(e.id); setStage(1) }}><b>{e.documentName}</b><small>{e.locator} · {e.text.length} 字符</small></button>)}
          {!project?.evidence.length && <p>尚未提交产品资料。</p>}
          <h3>运行记录</h3><p>运行不会自动重试；点击刷新查看后台进度。</p>
          {project?.runs.map(run => <div className="sa-record" key={run.id}><b>{run.skill}</b><p>队列：{run.queueStatus} · 执行：{run.runStatus} · 第 {run.attempt} 次</p><p>有效性：{run.freshness} · 审核：{run.approvalStatus} · 问题：{run.issueSeverity}</p>{run.errorCode && <p>{run.errorCode}</p>}
            {run.observations?.map(o => <small key={o.attempt}>第{o.attempt}次 · 模型 {o.actualModel ?? '未知'} · 输入 {o.inputTokens ?? '未知'} / 输出 {o.outputTokens ?? '未知'} tokens · 费用 {o.costUsd === null ? '未知' : `$${o.costUsd}`}</small>)}
            <Action disabled={!canWrite || !runConsent || run.runStatus !== 'failed'} onClick={() => write(`runs/${run.id}/retry`, {}, '已提交人工重试。请刷新查看进度。')}>重试此运行</Action></div>)}
        </aside>
        <section className="sa-panel sa-main"><h1>{stages[stage]}</h1>
          {stage === 0 && <>
            <p>当前接入项目、产品身份和纯文本证据。品类、ProductBrief、RulePack、CanvasProfile与文件解析尚未接入。</p>
            <Field label="项目名称"><input maxLength={150} value={name} onChange={e => setName(e.target.value)} /></Field>
            <Action disabled={disabled || !!project || !name.trim()} onClick={() => { const key = crypto.randomUUID(); void perform(() => api.create(name.trim(), key), '项目已创建。请确认产品身份并提交资料。') }}>创建阶段 A 项目</Action>
            <Field label="产品名称（确认后用于当前商品身份）"><input maxLength={150} value={productName} onChange={e => setProductName(e.target.value)} /></Field>
            <p>当前身份：{project?.identity?.productName ?? '未确认'}</p>
            <Action disabled={!canWrite || !productName.trim() || (!!project?.identity && !reasonValid)} onClick={() => write(project?.identity ? 'identity/correct' : 'identity/confirm', { productName: productName.trim(), ...(project?.identity ? { reason } : {}) }, '产品身份已保存。身份纠正可能使原故事顺序与草稿失效。')}>{project?.identity ? '纠正同一商品的身份文字' : '确认产品身份'}</Action>
            <h2>提交产品证据</h2><p>仅接受本产品的文字资料。PDF、图片和资料用途识别尚未接入。</p>
            <Field label="资料名称"><input maxLength={200} value={documentName} onChange={e => setDocumentName(e.target.value)} /></Field>
            <Field label="原文位置（页码或段落）"><input maxLength={300} value={locator} onChange={e => setLocator(e.target.value)} /></Field>
            <Field label="资料原文"><textarea maxLength={80000} rows={8} value={text} onChange={e => setText(e.target.value)} /></Field>
            <Action disabled={!canWrite || !documentName.trim() || !locator.trim() || !text.trim() || (project?.evidence.length ?? 0) >= 10} onClick={() => write('evidence', { documentName, locator, text, usage: 'product_evidence' }, '证据已保存。可以进入产品事实，补充候选或请求提取。')}>保存本批文字证据</Action>
            <Action onClick={() => setStage(1)}>进入产品事实</Action>
          </>}
          {stage === 1 && <>
            <p>候选保存与人工确认分开。确认后才能进入初步顺序；纠错保留旧事实和证据。</p>
            <Action disabled={!canWrite || !runConsent || !project?.evidence.length} onClick={() => write('runs', { skill: 'extract-facts' }, '已请求事实提取。请刷新查看候选与运行结果。')}>请求提取候选事实</Action>
            <div className="sa-facts">{project?.facts.map(f => <button className={`sa-list-item ${selectedFactId === f.id ? 'selected' : ''}`} key={f.id} onClick={() => setSelectedFactId(f.id)}><b>{f.attribute}：{f.value}</b><small>{factLabels[f.status]} · {f.role === 'core' ? '核心' : '辅助'} · {f.locked ? '锁定' : '未锁定'} · {f.issueSeverity === 'blocker' ? '冲突阻断' : f.issueSeverity}</small></button>)}</div>
            {!project?.facts.length && <p>没有事实候选。可从产品证据手工补充，或请求后台提取。</p>}
            {selected && <FactReview fact={selected} project={project!} canWrite={canWrite && reasonValid} review={action => write(`facts/${selected.id}/${action}`, { reason }, '事实审核已保存。请查看状态及下游影响。')} correct={() => { setCorrectsFactId(selected.id); setEvidenceId(selected.evidenceId); setAttribute(selected.attribute); setValue(selected.value); setQuote(selected.quote); setRole(selected.role) }} />}
            <h2>{correctsFactId ? '创建纠错候选' : '补充事实候选'}</h2>
            {correctsFactId && <p>关联原事实：{correctsFactId} <Action onClick={() => setCorrectsFactId('')}>取消纠错关联</Action></p>}
            <Field label="产品证据"><select value={evidenceId} onChange={e => setEvidenceId(e.target.value)}><option value="">请选择</option>{project?.evidence.map(e => <option key={e.id} value={e.id}>{e.documentName} · {e.locator}</option>)}</select></Field>
            {selectedEvidence && <details><summary>查看所选资料原文</summary><pre>{selectedEvidence.text}</pre></details>}
            <Field label="属性"><input maxLength={100} value={attribute} onChange={e => setAttribute(e.target.value)} /></Field>
            <Field label="事实用途"><select value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="core">核心事实</option><option value="supporting">辅助事实</option></select></Field>
            <Field label="候选值"><input maxLength={1000} value={value} onChange={e => setValue(e.target.value)} /></Field>
            <Field label="精确连续原文引用"><textarea maxLength={2000} value={quote} onChange={e => setQuote(e.target.value)} /></Field>
            {quote && !selectedEvidence?.text.includes(quote) && <p role="alert">引用与资料原文不匹配。</p>}
            <Action disabled={!canWrite || !reasonValid || !attribute.trim() || !value.trim() || !quote || !selectedEvidence?.text.includes(quote)} onClick={() => write('facts/candidates', { attribute, role, value, evidenceId, quote, reason, ...(correctsFactId ? { correctsFactId } : {}) }, '新的事实候选已保存，尚未确认。')}>保存新候选（不确认）</Action>
            <Action onClick={() => setStage(2)}>查看初步故事顺序</Action>
          </>}
          {stage === 2 && <>
            <p>初步故事顺序（无文案·未定稿）。阶段 A 只支持平铺章节的角色、目的和已确认事实引用；没有正式批准入口。</p>
            {!canPlan && <p>规划前需确认产品身份、至少一条核心事实并处理冲突。</p>}
            <Action disabled={!canPlan || !runConsent} onClick={() => write('runs', { skill: 'plan-section' }, '已请求初步顺序。已有顺序时只追加候选，请刷新后复核并选择应用。')}>请求新的初步顺序候选</Action>
            <h2>当前服务端顺序 · {project?.storyboard?.freshness ?? '尚无'}</h2>
            <ol>{project?.storyboard?.chapters.map((c, i) => <li key={i}>{roles[c.role]}：{c.purpose} <small>引用 {c.factIds.length} 条事实</small></li>)}</ol>
            <Action disabled={!project || busy} onClick={loadStory}>{storyDirty ? '放弃本地顺序编辑，重新载入当前稿' : '载入当前顺序供编辑'}</Action>
            <h2>人工顺序草稿 {storyDirty ? '· 未保存' : ''}</h2>
            {chapters.map((c, i) => <div className="sa-record" key={i}><h3>第 {i + 1} 章</h3>
              <Field label="内容角色"><select value={c.role} onChange={e => updateChapter(i, { role: e.target.value as Chapter['role'] })}>{Object.entries(roles).map(([r, label]) => <option value={r} key={r}>{label}</option>)}</select></Field>
              <Field label="简要表达目的（非最终文案）"><textarea maxLength={300} value={c.purpose} onChange={e => updateChapter(i, { purpose: e.target.value })} /></Field>
              <fieldset><legend>引用已确认事实（1–20 条）</legend>{confirmed.map(f => <label className="sa-check" key={f.id}><input type="checkbox" checked={c.factIds.includes(f.id)} onChange={e => updateChapter(i, { factIds: e.target.checked ? [...c.factIds, f.id] : c.factIds.filter(id => id !== f.id) })} />{f.attribute}：{f.value}</label>)}</fieldset>
              {c.factIds.some(id => !confirmed.some(f => f.id === id)) && <p role="alert">包含已撤回或无效事实，请移除后重新绑定。</p>}
              <Action onClick={() => updateChapter(i, { factIds: c.factIds.filter(id => confirmed.some(f => f.id === id)) })}>移除无效引用</Action>
              <Action disabled={i === 0} onClick={() => { setChapters(items => { const next = [...items]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next }); setStoryDirty(true) }}>上移</Action>
              <Action disabled={i === chapters.length - 1} onClick={() => { setChapters(items => { const next = [...items]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; return next }); setStoryDirty(true) }}>下移</Action>
              <Action onClick={() => { setChapters(items => items.filter((_, j) => j !== i)); setStoryDirty(true) }}>删除此章</Action>
            </div>)}
            <Action disabled={chapters.length >= 50} onClick={() => { setChapters(items => [...items, { role: 'feature', purpose: '', factIds: [] }]); setStoryDirty(true) }}>新增章节</Action>
            <Action disabled={!canPlan || !reasonValid || !chapters.length || chapters.some(c => !c.purpose.trim() || !c.factIds.length || c.factIds.length > 20 || c.factIds.some(id => !confirmed.some(f => f.id === id)))} onClick={() => write('storyboard/draft', { chapters, reason }, '人工顺序已保存。旧章节草稿可能失效，请复核当前依赖。')}>保存人工顺序（保持草稿）</Action>
            <h2>候选顺序</h2>{project?.storyboardCandidates?.map((candidate, i) => <details key={candidate.id ?? i}><summary>{candidate.sourceRunId === 'human' ? '人工顺序历史' : '模型候选'} {i + 1} · {candidate.freshness}</summary><ol>{candidate.chapters.map((c, j) => <li key={j}>{roles[c.role]}：{c.purpose}（{c.factIds.join('、')}）</li>)}</ol><Action disabled={!canWrite || !reasonValid || !candidate.id || candidate.freshness !== 'current' || !project.sections.some(s => s.storyboardId === candidate.id && s.freshness === 'current')} onClick={() => write(`storyboard/candidates/${candidate.id}/apply`, { reason }, '已显式应用候选顺序及关联草稿。本地未保存编辑仍保留。')}>应用此候选，替换当前顺序和关联草稿</Action></details>)}
          </>}
          <div hidden={stage !== 3}><SectionDraftEditor key={project?.id ?? 'disconnected'} project={project} canWrite={canWrite} busy={busy} reasonValid={reasonValid} reason={reason} write={write} onStory={() => setStage(2)} /></div>
          {stage === 4 && <><p>市场版本、RulePack、翻译、CanvasProfile覆盖和逐章批准尚未实现。当前没有可提交的真实市场版本。</p><Action disabled onClick={() => {}}>生成市场适配（尚未实现）</Action></>}
          {stage === 5 && <><p>阶段 A 只做诊断预检；不会生成文件或批准交付。预检通过也不代表可导出。</p><Action disabled={!canWrite} onClick={() => write('qa/preflight', {}, '预检已完成。请查看问题与未检查范围。')}>运行阶段 A 预检</Action>{project?.qa && <pre>{JSON.stringify(project.qa, null, 2)}</pre>}<Action disabled onClick={() => {}}>批准并下载（尚未实现）</Action></>}
        </section>
        <aside className="sa-panel"><h2>当前操作与影响</h2><p>项目：{project?.name ?? '尚未创建'}</p><p>已确认事实 {confirmed.length} 条{hasConflict ? ' · 存在冲突' : ''}</p>
          <Field label="本次人工操作原因（审核、纠错、顺序保存与候选应用必填）"><textarea maxLength={1000} rows={4} value={reason} onChange={e => setReason(e.target.value)} /></Field>
          {!reasonValid && <p>填写原因后才能执行人工审核与草稿修改。</p>}
          <label className="sa-check"><input type="checkbox" checked={runConsent} onChange={e => setRunConsent(e.target.checked)} />我已核对后端模型配置，允许本项目的显式运行请求</label><p>本地合成服务不调用外部模型。连接真实服务时，请求提取、规划和重试可能产生费用；本页不会自动发起。</p>
          <h3>最近审计记录</h3>{project?.audit.slice(-12).reverse().map(a => <details key={a.id}><summary>R{a.revision} · {a.type}</summary><p>{a.actor} · {a.at}</p><pre>{JSON.stringify(a.data, null, 2)}</pre></details>)}
        </aside>
      </div>
    </main>
    <footer className="actionbar"><Action disabled={stage === 0} onClick={() => setStage(stage - 1)}>上一阶段</Action><p>导航不代表正式放行 · 服务端保存与业务批准分开</p><div className="action-spacer" /><Action disabled={stage === 5} onClick={() => setStage(stage + 1)}>查看下一阶段</Action></footer>
  </div>
}

function FactReview({ fact, project, canWrite, review, correct }: { fact: Fact; project: Project; canWrite: boolean; review: (action: string) => void; correct: () => void }) {
  const source = project.evidence.find(e => e.id === fact.evidenceId)
  return <section className="sa-record"><h2>审核：{fact.attribute} = {fact.value}</h2><p>{source?.documentName} · {source?.locator}</p><blockquote>{fact.quote}</blockquote><p>位置 {fact.start}–{fact.end} · {factLabels[fact.status]}</p>
    <details><summary>原文与影响范围</summary><pre>{source?.text}</pre><p>引用此事实的诊断草稿：{project.sections.filter(s => s.factIds.includes(fact.id)).map(s => `${s.id} (${s.freshness})`).join('、') || '无'}</p></details>
    <Action disabled={!canWrite || fact.status !== 'candidate'} onClick={() => review('confirm')}>确认这条事实</Action>
    <Action disabled={!canWrite || fact.status !== 'candidate'} onClick={() => review('reject')}>拒绝这条候选</Action>
    <Action disabled={!canWrite || fact.status !== 'confirmed'} onClick={() => review('retract')}>撤回这条已确认事实</Action>
    <Action onClick={correct}>编辑为新的纠错候选</Action>
  </section>
}



