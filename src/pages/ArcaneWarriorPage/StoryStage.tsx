import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronDown, Circle, Image as ImageIcon, Layers3, Plus, RefreshCw, Sparkles } from 'lucide-react'
import type { StageId } from './domain'
import type { Project, Storyboard } from './stage-a-api'
import type { ProjectSession } from './useProjectSession'
import { Button, Chip, ClientLogo, PanelTitle } from './WorkbenchUI'

type Chapter = Storyboard['chapters'][number]
type Draft = { projectId: string; base: string; chapters: Chapter[] }
const roles: Record<Chapter['role'], string> = { identity: '产品介绍', feature: '核心特点', evidence: '事实依据', usage: '使用场景' }
function dependencyKey(project: Project | null) {
  return JSON.stringify([project?.id, project?.identityRevision, project?.identity, project?.facts, project?.storyboard])
}
export default function StoryStage({ session, onStage }: { session: ProjectSession; onStage: (stage: StageId) => void }) {
  const { project, canPlan, busy, write, confirmed, reason, setReason, reasonValid, runConsent, setRunConsent } = session
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [view, setView] = useState<'overview' | 'detail'>('overview')
  const chapters = draft?.chapters ?? project?.storyboard?.chapters ?? []
  const selected = chapters[selectedIndex]
  const base = dependencyKey(project)
  const needsReview = !!draft && draft.base !== base
  const differentProject = !!draft && draft.projectId !== project?.id
  const editable = !!project && !busy && !session.pending && !differentProject && !needsReview
  const validFacts = confirmed.filter(f => f.issueSeverity === 'none')
  const valid = chapters.length > 0 && chapters.length <= 50 && chapters.every(c => c.purpose.trim() && c.purpose.length <= 300 && c.factIds.length > 0 && c.factIds.length <= 20 && c.factIds.every(id => validFacts.some(f => f.id === id)))
  const planningRuns = project?.runs.filter(run => run.skill === 'plan-section') ?? []
  const activeRun = planningRuns.some(run => run.queueStatus !== 'done')
  const update = (next: Chapter[]) => { if (editable && project) setDraft({ projectId: project.id, base, chapters: next }) }
  const edit = (patch: Partial<Chapter>) => update(chapters.map((chapter, index) => index === selectedIndex ? { ...chapter, ...patch } : chapter))
  const add = () => { update([...chapters, { role: 'feature', purpose: '', factIds: [] }]); setSelectedIndex(chapters.length); setView('detail') }
  const move = (direction: -1 | 1) => {
    const target = selectedIndex + direction
    if (!selected || target < 0 || target >= chapters.length) return
    const next = [...chapters]; [next[selectedIndex], next[target]] = [next[target], next[selectedIndex]]
    update(next); setSelectedIndex(target)
  }
  const save = () => {
    if (!canPlan || !valid || needsReview || !reasonValid) return
    void write('storyboard/draft', { chapters, reason }, '人工故事顺序已保存，仍为草稿。', () => setDraft(null))
  }
  return (
    <div className="story-workbench">
      <aside className="rail story-tree"><PanelTitle eyebrow="NARRATIVE TREE" title="叙事结构树" />
        {chapters.map((chapter, index) => <button key={index} className={index === selectedIndex ? 'active' : ''} onClick={() => setSelectedIndex(index)}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{roles[chapter.role]}</b><small>{chapter.purpose || '请填写章节目的'}</small></div><Circle size={12} /></button>)}
        {!chapters.length && <p className="hint">尚无章节顺序</p>}
        <div className="tree-tools"><Button onClick={add} disabled={!editable || chapters.length >= 50}><Plus size={14} />添加同级</Button><Button onClick={() => move(-1)} disabled={!editable || !selected || selectedIndex === 0}><ArrowUp size={14} />上移</Button><Button onClick={() => move(1)} disabled={!editable || !selected || selectedIndex === chapters.length - 1}><ArrowDown size={14} />下移</Button></div>
      </aside>
      <aside className="story-preview"><PanelTitle eyebrow="MOBILE PREVIEW" title="移动端阅读预览" /><div className="phone-shell"><div className="phone-screen"><ClientLogo compact />{selected ? <><span className="phone-no">{String(selectedIndex + 1).padStart(2, '0')}</span><b>{roles[selected.role]}</b><small>{selected.purpose || '尚未填写章节目的'}</small><p className="hint">仅展示章节顺序；图片与正式文案尚未生成。</p></> : <p className="hint">尚无章节可预览</p>}</div></div></aside>
      <section className="story-main">
        <div className="story-viewbar"><div><Button onClick={() => setView('overview')} tone={view === 'overview' ? 'violet' : 'ghost'}>出图脚本</Button><Button onClick={() => setView('detail')} tone={view === 'detail' ? 'violet' : 'ghost'}>章节规格编辑器</Button></div><Chip tone={needsReview || project?.storyboard?.freshness === 'stale' ? 'yellow' : 'violet'}>{needsReview ? '本地修改待复核' : draft ? '未保存草稿' : project?.storyboard?.freshness === 'stale' ? '顺序已失效' : '工作草稿'}</Chip></div>
        {needsReview && <div className="agent-boundary" role="status"><div><b>上游数据已变化，本地修改已保留</b><p>请对照当前身份、事实和服务端顺序后再保存。</p><details><summary>查看最新服务端顺序</summary><ol>{project?.storyboard?.chapters.map((chapter, index) => <li key={index}>{roles[chapter.role]}：{chapter.purpose}（{chapter.factIds.join('、')}）</li>)}</ol></details><Button disabled={busy || !!session.pending || differentProject} onClick={() => setDraft(current => current ? { ...current, base } : current)}>已复核，保留本地修改</Button></div></div>}
        {draft && <Button disabled={busy || !!session.pending} onClick={() => { setDraft(null); setSelectedIndex(0) }}>放弃本地修改，载入服务端顺序</Button>}
        {!chapters.length ? <div className="empty-state"><Layers3 size={38} /><h3>基于事实组织章节顺序</h3><p>添加章节手动编辑，或在右侧明确发起规划。</p><Button tone="primary" onClick={add} disabled={!editable}><Plus size={16} />添加第一章</Button></div> : view === 'overview' ? <div className="script-stack"><PanelTitle eyebrow="PRIMARY SELLING POINT" title="一级卖点 · 出图脚本" action={<span className="hint">共 {chapters.length} 章</span>} />{chapters.map((chapter, index) => <article key={index} className={index === selectedIndex ? 'selected' : ''} onClick={() => setSelectedIndex(index)}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{roles[chapter.role]}</h3><p>{chapter.purpose || '尚未填写章节目的'}</p>{index === selectedIndex && <><div className="script-promise">{chapter.factIds.length ? chapter.factIds.map(id => { const fact = project?.facts.find(f => f.id === id); return fact ? `${fact.attribute}：${fact.value}${fact.status !== 'confirmed' ? '（引用已失效）' : ''}` : `${id}（引用已失效）` }).join('；') : '尚未引用事实'}</div><div className="module-chips"><Chip tone="muted">内容模块尚未接入</Chip></div><div className="material-plan"><div><b>效果图</b><div className="dark-thumb"><ImageIcon size={23} /></div><small>尚无素材</small></div><div><b>结构示意图</b><div className="dark-thumb missing"><ImageIcon size={22} /></div><small>尚无素材</small></div></div></>}</div><ChevronDown size={15} /></article>)}</div> : <div className="spec-editor">
          <div className="chapter-objective"><div><label>章节目标</label><p>{selected?.purpose || '请选择章节并填写目的'}</p></div><div><label>预期客户结论</label><p>该字段尚未接入后端</p></div></div>
          <div className="editor-tabs"><button className="active">内容脚本</button><button disabled>图片与元素</button><button disabled>事实与证据</button><button disabled>分镜与 Layout</button></div>
          <PanelTitle eyebrow={selected ? `CHAPTER ${selectedIndex + 1}` : 'CHAPTER'} title="章节顺序与事实引用" action={<Button tone="violet" disabled><Sparkles size={14} />智能重排</Button>} />
          <div className="module-list">{selected && <div className="editing"><Circle size={14} /><b>{roles[selected.role]}</b><span>人工草稿</span><div className="inline-editor"><label>章节角色<select value={selected.role} disabled={!editable} onChange={event => edit({ role: event.target.value as Chapter['role'] })}>{Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="wide">章节目的<textarea value={selected.purpose} maxLength={300} disabled={!editable} onChange={event => edit({ purpose: event.target.value })} /></label><fieldset disabled={!editable}><legend>引用已确认事实（每章 1–20 条）</legend>{validFacts.map(fact => <label key={fact.id}><input type="checkbox" checked={selected.factIds.includes(fact.id)} onChange={event => edit({ factIds: event.target.checked ? [...selected.factIds, fact.id] : selected.factIds.filter(id => id !== fact.id) })} />{fact.attribute}：{fact.value}</label>)}{!validFacts.length && <p>尚无可引用事实，请先到产品事实确认。</p>}{selected.factIds.filter(id => !validFacts.some(f => f.id === id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => edit({ factIds: selected.factIds.filter(value => value !== id) })} />失效引用 {id}，取消勾选以移除</label>)}</fieldset><Button tone="danger" disabled={!editable} onClick={() => { update(chapters.filter((_, index) => index !== selectedIndex)); setSelectedIndex(Math.max(0, selectedIndex - 1)) }}>删除本地章节</Button></div></div>}</div>
          <p className="hint">正式文案、内容模块、图片与 Layout 尚未接入。</p>
        </div>}
        <label>保存或应用原因<textarea disabled={busy || !!session.pending} value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></label><Button tone="primary" disabled={!canPlan || !valid || needsReview || !reasonValid} onClick={save}>保存人工顺序（保持草稿）</Button>
      </section>
      <aside className="inspector story-agent"><PanelTitle eyebrow="AGENT RECOMMENDATION" title="Agent 故事线建议" action={<Bot size={18} />} />
        <div className="agent-score"><Sparkles size={18} /><div><b>规划候选</b><span>规划会调用模型；结果需要复核后显式应用。</span></div></div>
        <label><input type="checkbox" checked={runConsent} disabled={busy || !!session.pending} onChange={event => setRunConsent(event.target.checked)} />允许本项目的模型运行请求</label>
        <Button tone="primary" className="full" disabled={!canPlan || !runConsent || activeRun} onClick={() => { void write('runs', { skill: 'plan-section' }, '规划请求已提交，请读取运行结果。') }}>生成规划候选</Button>
        <Button className="full" disabled={!project || busy} onClick={() => { void session.refresh() }}><RefreshCw size={14} />读取规划结果</Button>
        {planningRuns.map(run => <div className="reason-list" key={run.id}><b>规划运行 · {run.queueStatus === 'done' ? run.runStatus === 'failed' ? '失败' : '已结束' : '处理中'}</b><p>{run.id}</p>{run.errorCode && <p>{run.errorCode}</p>}{run.runStatus === 'failed' && <Button disabled={!canPlan || !runConsent || activeRun || run.queueStatus !== 'done'} onClick={() => { void write(`runs/${run.id}/retry`, {}, '已请求重试规划。') }}>重试此规划</Button>}</div>)}
        {!project?.storyboardCandidates?.length && <div className="reason-list"><p>尚无规划候选。</p></div>}
        {project?.storyboardCandidates?.map((candidate, index) => <details className="reason-list" key={candidate.id ?? index}><summary>{candidate.sourceRunId === 'human' ? '人工顺序历史' : '模型候选'} {index + 1} · {candidate.freshness === 'current' ? '当前依赖' : '已失效'}</summary><ol>{candidate.chapters.map((chapter, order) => <li key={order}>{roles[chapter.role]}：{chapter.purpose}<small>引用：{chapter.factIds.join('、')}</small></li>)}</ol><p>应用将替换服务端顺序和关联诊断草稿；本地未保存修改保留。</p><Button disabled={!canPlan || !reasonValid || !candidate.id || candidate.freshness !== 'current' || !project.sections.some(section => section.storyboardId === candidate.id && section.freshness === 'current')} onClick={() => { void write(`storyboard/candidates/${candidate.id}/apply`, { reason }, '已显式应用候选。保留的本地修改需重新复核。') }}>应用此候选</Button>{!project.sections.some(section => section.storyboardId === candidate.id && section.freshness === 'current') && <p>缺少有效关联诊断草稿，无法应用此历史顺序。</p>}</details>)}
        <div className="agent-boundary"><Bot size={18} /><div><b>Agent 边界</b><span>可建议与重排，不可替你批准。</span></div></div>
      </aside>
      <div className="stage-bottom story-bottom"><Button onClick={() => onStage('facts')}><ArrowLeft size={15} />返回产品事实</Button><span className="formula"><b>一章</b> = 一个主题 + 一组事实 + 一组素材 + 一种呈现</span><Button tone="primary" disabled><Check size={16} />批准故事线并开始章节制作（尚未接入）</Button></div>
    </div>
  )
}
