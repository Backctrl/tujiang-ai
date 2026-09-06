import { useState } from 'react'
import { ArrowLeft, Bot, Check, Circle, Download, Eye, Layers3, Lock, Menu, Plus, Search, Sparkles } from 'lucide-react'
import { Button, Chip, PanelTitle, StatusDot } from './WorkbenchUI'
import type { ProjectSession } from './useProjectSession'
import type { StageId } from './domain'

type Props = { session: ProjectSession; onStage: (stage: StageId) => void }
const roleLabels = { identity: '产品身份', feature: '功能特点', evidence: '事实证明', usage: '使用方式' }

export function ChapterStage({ session, onStage }: Props) {
  const { project } = session
  const chapters = project?.storyboard?.chapters ?? []
  const [index, setIndex] = useState(0)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('AGENT')
  const selected = chapters[index]
  return <div className="three-column chapter-layout">
    <aside className="rail chapter-tree">
      <PanelTitle eyebrow="PAGE STRUCTURE" title="章节结构" action={<button type="button" className="icon-button" aria-label="添加章节" disabled><Plus size={15} /></button>} />
      <label className="tree-search"><Search size={15} /><input aria-label="搜索章节" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索章节" /></label>
      <div className="tree-list">{chapters.map((chapter, i) => (!query || chapter.purpose.includes(query)) && <button type="button" key={i} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}><span>{String(i + 1).padStart(2, '0')}</span><b>{roleLabels[chapter.role]}</b><i><Circle size={12} /></i></button>)}{!chapters.length && <p className="integration-note">尚无故事章节，请先在故事线保存或应用顺序。</p>}</div>
      <div className="tree-legend"><span><StatusDot tone="muted" />故事结构 · 未制作</span>{project?.storyboard?.freshness === 'stale' && <span><StatusDot tone="yellow" />故事顺序需复核</span>}</div>
    </aside>
    <section className="canvas-panel">
      <div className="canvas-toolbar"><span><b>{selected ? `第 ${index + 1} 章` : '尚未选择章节'}</b> {selected ? roleLabels[selected.role] : ''}</span><Chip tone="muted">尚无章节成稿</Chip><span className="canvas-device">页面尺寸尚未配置</span></div>
      <div className="canvas-stage"><div className="canvas-gate"><Lock size={34} /><h3>章节制作尚未接通</h3><p>逐章内容、素材、布局和正式画布尚未提供。当前只可查看已保存的故事结构。</p><Button tone="primary" disabled><Sparkles size={16} />创建 Draft</Button></div></div>
    </section>
    <aside className="inspector chapter-inspector">
      <div className="inspector-tabs">{['属性','AGENT','QA'].map(t => <button type="button" key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      <PanelTitle eyebrow="CONTROLLED AI" title={tab === '属性' ? '章节属性' : tab === 'QA' ? '章节检查' : '内容建议'} action={<Chip tone="muted">尚未接通</Chip>} />
      {tab === '属性' ? <div className="inspector-block"><label>故事章节目的</label><p>{selected?.purpose ?? '选择章节后查看'}</p><label>故事引用事实</label>{selected?.factIds.map(id => { const fact = project?.facts.find(f => f.id === id); return <p key={id}>{fact ? `${fact.attribute}：${fact.value}` : '引用不可用'}</p> })}<p className="integration-note">这是故事线数据，不表示已经创建正式章节。</p></div> : <div className="inspector-empty"><Bot size={30} /><p>{tab === 'QA' ? '尚无逐章检查结果。项目诊断预检可在QA与导出查看。' : '尚无针对本章的内容建议或差异提案。'}</p></div>}
    </aside>
    <div className="stage-bottom chapter-bottom"><div><b>{selected ? `第 ${index + 1} 章 · ${roleLabels[selected.role]}` : '尚无章节'}</b><span>逐章制作接口尚未接入</span></div><Button onClick={() => onStage('story')}>返回故事线</Button><Button disabled>保存草稿</Button><Button tone="primary" disabled><Lock size={16} />锁定本章并继续</Button></div>
  </div>
}

export function MarketStage({ onStage }: Props) {
  const [tab, setTab] = useState('文案')
  return <div className="market-workbench">
    <aside className="rail market-rail"><PanelTitle eyebrow="GLOBAL VARIANTS" title="市场适配版本" action={<button type="button" className="icon-button" aria-label="新增市场版本" disabled><Plus size={14} /></button>} /><div className="master-version"><span>语义母版</span><b>尚未生成</b><Chip tone="muted">未批准</Chip></div><div className="inspector-empty"><Layers3 size={28} /><p>尚无市场版本。</p></div><div className="market-count"><Layers3 size={15} />尚未接入市场版本数据</div></aside>
    <section className="market-canvas"><div className="market-head"><div><h2>市场详情页</h2><p>市场配置、本地化与规则接口尚未接入。</p></div><Chip tone="muted">尚无母版与规则</Chip></div><div className="canvas-toolbar"><select aria-label="市场章节" disabled><option>尚无可选章节</option></select><Button disabled tone="violet">当前章节</Button><Button disabled>整页详情</Button><Button disabled>HTML 预览</Button><span className="canvas-device">尺寸待配置</span></div><div className="market-preview"><div className="canvas-gate"><Layers3 size={34} /><h3>尚无市场成稿</h3><p>接入市场版本和渲染能力后，在此查看真实结果。</p></div></div><div className="chapter-strip"><span>尚无市场章节状态</span></div></section>
    <aside className="inspector market-inspector"><PanelTitle eyebrow="MARKET INSPECTOR" title="市场适配 Inspector" /><div className="inspector-tabs five">{['文案','图片','Layout','术语','规则'].map(t => <button type="button" key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>{tab === '文案' ? <><div className="inspector-block"><label>源语义文案（只读）</label><p>尚无源文案</p></div><div className="inspector-block"><label>目标文案</label><textarea aria-label="目标文案" disabled value="" /></div><div className="term-list"><b>术语对照</b><span>尚无术语数据</span></div></> : <div className="inspector-empty"><Layers3 size={28} /><p>{tab}数据尚未接入。</p></div>}<Button tone="violet" className="full" disabled><Sparkles size={14} />生成 / 更新适配</Button><Button tone="primary" className="full" disabled><Check size={14} />确认本章</Button></aside>
    <div className="stage-bottom market-bottom"><Button onClick={() => onStage('chapters')}><ArrowLeft size={15} />返回章节制作</Button><Button disabled><Eye size={15} />查看母版差异</Button><span>市场版本与正式批准尚未接通</span><Button tone="violet" disabled><Sparkles size={15} />生成未完成章节</Button><Button tone="primary" disabled>批准整套详情页并进入 QA</Button></div>
  </div>
}

const issueMap: Record<string, { title: string; stage: StageId }> = {
  CONFIRMED_PRODUCT_IDENTITY_REQUIRED: { title: '请确认产品身份', stage: 'setup' },
  SECTION_DRAFT_REQUIRED: { title: '尚无项目诊断稿', stage: 'story' },
  SECTION_SELECTION_REQUIRED: { title: '尚未应用规划候选', stage: 'story' },
  CURRENT_STORYBOARD_REQUIRED: { title: '尚无当前故事顺序', stage: 'story' },
  STALE_STORYBOARD: { title: '故事顺序依赖已变化', stage: 'story' },
  STALE_SECTION: { title: '项目诊断稿依赖已变化', stage: 'story' },
  SECTION_OUTSIDE_STORYBOARD: { title: '诊断稿与当前故事顺序不一致', stage: 'story' },
  UNRESOLVED_FACT_CONFLICT: { title: '存在未处理的事实冲突', stage: 'facts' },
  INVALID_FACT_EVIDENCE: { title: '事实或证据引用无效', stage: 'facts' },
  MISSING_INPUTS: { title: '项目诊断稿记录了资料缺口', stage: 'setup' },
}
const scopeLabels: Record<string, string> = { market_rules: '市场规则', rendered_file: '渲染文件', asset_quality: '素材质量', formal_approval: '正式批准' }
const issueInfo = (code: string) => issueMap[code.split(':')[0]]
export function QaStage({ session, onStage }: Props) {
  const { project } = session
  const qa = project?.qa
  const [selectedId, setSelectedId] = useState('')
  const selected = qa?.issues.includes(selectedId) ? selectedId : qa?.issues[0]
  const info = selected ? issueInfo(selected) : undefined
  const missingInputs = selected?.startsWith('MISSING_INPUTS:') ? project?.sections.find(section => section.id === selected.slice('MISSING_INPUTS:'.length))?.missingInputs : undefined
  const current = !!qa && qa.checkedRevision === project?.revision && qa.checkedVersion === project?.version
  return <div className="three-column qa-layout">
    <aside className="rail qa-rail"><PanelTitle eyebrow="RULE SET" title="QA 导航" action={<button type="button" className="icon-button" aria-label="QA菜单" disabled><Menu size={15} /></button>} />
      <div className="qa-group"><h3>项目诊断预检<span>{qa ? qa.issues.length : '未检查'}</span></h3>{qa?.issues.map((issue, i) => <button type="button" key={`${issue}-${i}`} className={selected === issue ? 'active' : ''} onClick={() => setSelectedId(issue)}><StatusDot tone="yellow" /><span>{issueInfo(issue)?.title ?? issue}</span></button>)}{!qa && <p className="integration-note">尚未运行诊断预检。</p>}{qa && !qa.issues.length && <p className="integration-note">诊断范围内未发现问题，正式交付尚未检查。</p>}</div>
      <div className="qa-group"><h3>未检查范围</h3>{qa ? qa.notChecked.map(scope => <p key={scope}>{scopeLabels[scope] ?? scope}</p>) : <p className="integration-note">运行后显示后端明确返回的检查范围。</p>}</div>
      <div className="qa-total"><span>诊断问题 {qa?.issues.length ?? '未检查'}</span><span>正式交付未通过验收</span></div>
    </aside>
    <section className="qa-preview"><div className="preview-head"><span><b>全局详情页</b> · 正式预览尚未接通</span><span>尺寸未配置</span></div><div className="preview-workspace"><div className="preview-controls"><button type="button" disabled>+</button><span>未渲染</span><button type="button" disabled>−</button></div><div className="canvas-gate"><Eye size={34} /><h3>尚无可预览的详情页</h3><p>当前只提供项目诊断预检，不生成页面或文件。</p></div></div><div className="diff-strip"><span>变更对比</span><p>尚无正式交付版本可供比较</p></div></section>
    <aside className="inspector delivery-gate"><PanelTitle eyebrow="DELIVERY GATE" title="交付验收" action={<Chip tone="muted">尚未接通</Chip>} />
      <div className="gate-state"><span><Lock size={24} /></span><div><b>正式交付与导出尚未开放</b><p>诊断预检不等于文件或市场规则检查。</p></div></div>
      <div className="selected-issue"><label>选中问题</label>{selected ? <><div className="issue-title"><Chip tone="yellow">待处理</Chip><b>{info?.title ?? '诊断问题'}</b></div><p className="integration-note">{selected}</p>{missingInputs && <div><b>项目诊断记录的资料缺口</b><ul>{missingInputs.map((input, index) => <li key={index}>{input}</li>)}</ul><p>补充资料后，回到故事线重新规划并复核应用候选，再运行预检。</p></div>}{info && <Button tone="violet" className="full" onClick={() => onStage(info.stage)}>前往对应步骤处理</Button>}</> : <p>{qa ? '没有诊断问题需要展示' : '等待预检结果'}</p>}</div>
      <div className="market-mini"><label>预检记录</label>{qa ? <><p>检查时间：{new Date(qa.at).toLocaleString('zh-CN')}</p><p>检查版本：R{qa.checkedRevision} / V{qa.checkedVersion}</p><p>{current ? '对应当前快照' : '结果已过期，请重新检查'}</p><p>导出许可：{qa.exportAllowed === false ? '未允许' : '未知'}</p></> : <p>尚无记录</p>}</div>
    </aside>
    <div className="stage-bottom qa-bottom"><div className="qa-count"><b>{qa ? `${qa.issues.length} 项诊断问题` : '尚未检查'}</b></div><div className="block-reason">市场规则、渲染文件、素材质量与正式批准不在当前预检范围</div><Button tone="violet" disabled={!session.canWrite} onClick={() => void session.write('qa/preflight', {}, '诊断预检已完成，请查看真实问题与未检查范围。')}>运行诊断预检</Button><Button disabled><Check size={16} />批准版本</Button><Button tone="primary" disabled><Download size={16} />导出交付包</Button></div>
  </div>
}
