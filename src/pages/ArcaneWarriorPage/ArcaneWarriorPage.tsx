import { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import arcaneWarriorLogo from '@shared/static/images/arcane-warrior-brand-source.png'
import './arcane-warrior.css'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  Info,
  Layers3,
  Lock,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import type { AuditEvent, Fact, QaIssue, StageId, StorySection } from './domain'
import { initialFacts, initialMarkets, initialQaIssues, initialSections, initialSources } from './mockData'

const stages: { id: StageId; label: string; en: string }[] = [
  { id: 'setup', label: '项目设置', en: 'PROJECT SETUP' },
  { id: 'facts', label: '产品事实', en: 'PRODUCT FACTS' },
  { id: 'story', label: '故事线', en: 'STORYLINE' },
  { id: 'chapters', label: '章节制作', en: 'CHAPTERS' },
  { id: 'market', label: '市场适配', en: 'MARKET ADAPT' },
  { id: 'qa', label: 'QA与导出', en: 'QA & EXPORT' },
]

const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

function StatusDot({ tone = 'violet' }: { tone?: 'violet' | 'green' | 'yellow' | 'red' | 'muted' }) {
  return <span className={`status-dot ${tone}`} />
}

function Chip({ children, tone = 'violet' }: { children: React.ReactNode; tone?: 'violet' | 'green' | 'yellow' | 'red' | 'muted' }) {
  return <span className={`chip ${tone}`}>{children}</span>
}

function Button({ children, tone = 'ghost', disabled, onClick, className = '' }: { children: React.ReactNode; tone?: 'primary' | 'violet' | 'ghost' | 'danger'; disabled?: boolean; onClick?: () => void; className?: string }) {
  return <button className={`button ${tone} ${className}`} disabled={disabled} onClick={onClick}>{children}</button>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label"><span />{children}</div>
}

function PanelTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="panel-title">
      <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>
      {action}
    </div>
  )
}

function ClientLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`client-logo ${compact ? 'compact' : ''}`} role="img" aria-label="ARCANE WARRIOR">
      <img src={arcaneWarriorLogo} alt="" aria-hidden="true" />
    </span>
  )
}

function BrandMark() {
  return (
    <div className="brand">
      <ClientLogo />
    </div>
  )
}

function ArcaneWarriorPage() {
  const [stage, setStage] = useState<StageId>('facts')
  const [sources, setSources] = useState(initialSources)
  const [facts, setFacts] = useState(initialFacts)
  const [selectedFactId, setSelectedFactId] = useState('F-001')
  const [sections, setSections] = useState(initialSections)
  const [selectedSectionId, setSelectedSectionId] = useState('CH-03')
  const [storyPreview, setStoryPreview] = useState(true)
  const [storyView, setStoryView] = useState<'overview' | 'detail'>('overview')
  const [storyApproved, setStoryApproved] = useState(true)
  const [chapterDraft, setChapterDraft] = useState(true)
  const [chapterCopy, setChapterCopy] = useState('X1 通过 Wi-Fi 6 双频并发，为多设备家庭提供稳定、低延迟的连接体验。')
  const [agentPatchOpen, setAgentPatchOpen] = useState(true)
  const [markets, setMarkets] = useState(initialMarkets)
  const [qaIssues, setQaIssues] = useState(initialQaIssues)
  const [approvedVersion, setApprovedVersion] = useState(false)
  const [exported, setExported] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [audit, setAudit] = useState<AuditEvent[]>([
    { id: 1, time: '10:42', action: '自动保存工作副本 R-013', actor: '系统' },
    { id: 2, time: '10:39', action: '提出章节文案 Patch', actor: 'Agent' },
    { id: 3, time: '10:33', action: '锁定事实 F-005', actor: '你' },
  ])

  const selectedFact = facts.find((fact) => fact.id === selectedFactId) ?? facts[0]
  const selectedSection = sections.find((item) => item.id === selectedSectionId) ?? sections[0]
  const confirmedCount = facts.filter((fact) => fact.confirmed).length
  const activeBlockers = qaIssues.filter((issue) => issue.severity === 'blocker' && !issue.resolved)
  const activeWarnings = qaIssues.filter((issue) => issue.severity === 'warning' && !issue.resolved)
  const canApproveStory = storyPreview && confirmedCount >= 2
  const canCreateChapter = storyApproved
  const currentChapterLocked = selectedSection.locked
  const canApproveVersion = activeBlockers.length === 0 && markets.some((market) => market.status === 'approved')

  const log = (action: string, actor: AuditEvent['actor'] = '你') => {
    setAudit((items) => [{ id: Date.now(), time: now(), action, actor }, ...items].slice(0, 8))
  }
  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2600)
  }

  const confirmFact = () => {
    if (selectedFact.severity === 'blocker') return notify('该事实存在冲突，需先处理证据。')
    setFacts((items) => items.map((fact) => fact.id === selectedFact.id ? { ...fact, confirmed: true, locked: true } : fact))
    log(`确认并锁定事实 ${selectedFact.id}`)
    notify('事实已确认，并进入正式事实基线。')
  }

  const reviseConfirmedFact = () => {
    setFacts((items) => items.map((fact) => fact.id === selectedFact.id ? { ...fact, claim: `${fact.claim.replace('。', '')}（已修订）。`, freshness: 'current' } : fact))
    setSections((items) => items.map((item) => ['CH-03', 'CH-04'].includes(item.id) ? { ...item, freshness: 'stale' } : item))
    setMarkets((items) => items.map((market) => market.id === 'DE-AMZ' ? { ...market, progress: Math.max(0, market.progress - 8) } : market))
    log(`修订事实 ${selectedFact.id}，标记 2 个下游对象过期`)
    notify('事实已修订，仅受影响章节与市场版本被标记为过期。')
  }

  const mockUpload = () => {
    if (parsing) return
    setParsing(true)
    const source = { id: `S-0${sources.length + 1}`, name: 'X1-认证报告.pdf', meta: '12 页 · 刚刚', status: 'running' as const, facts: 0 }
    setSources((items) => [...items, source])
    log('上传 X1-认证报告.pdf')
    window.setTimeout(() => {
      setSources((items) => items.map((item) => item.id === source.id ? { ...item, status: 'succeeded', facts: 14 } : item))
      setParsing(false)
      log('解析完成：新增 14 个事实候选', '系统')
      notify('模拟解析完成，新增 14 个事实候选。')
    }, 1400)
  }

  const moveSection = (direction: -1 | 1) => {
    const index = sections.findIndex((item) => item.id === selectedSectionId)
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    const next = [...sections]
    ;[next[index], next[target]] = [next[target], next[index]]
    setSections(next)
    log(`调整 ${selectedSectionId} 的故事顺序`)
  }

  const lockChapter = () => {
    if (!chapterDraft) return notify('请先创建本章草稿。')
    setSections((items) => items.map((item) => item.id === selectedSectionId ? { ...item, locked: true, status: 'approved', freshness: 'current' } : item))
    log(`锁定章节 ${selectedSectionId}`)
    notify('本章已人工锁定，Agent 将不能覆盖其内容。')
  }

  const adoptPatch = () => {
    if (currentChapterLocked) return notify('当前字段已锁定，Agent Patch 不可覆盖。')
    setChapterCopy('X1 以 Wi-Fi 6 双频并发为核心，让多设备连接更稳定、延迟更低，并保留清晰可追溯的产品事实。')
    setAgentPatchOpen(false)
    log(`采纳 Agent 对 ${selectedSectionId} 的文案 Patch`)
    notify('Patch 已采纳为工作草稿，尚未获得人工批准。')
  }

  const resolveIssue = (issue: QaIssue) => {
    setQaIssues((items) => items.map((item) => item.id === issue.id ? { ...item, resolved: true } : item))
    log(`解决 QA 问题 ${issue.id}`)
    notify(`${issue.id} 已标记为解决。`)
  }

  const stageIndex = stages.findIndex((item) => item.id === stage)
  const goNext = () => setStage(stages[Math.min(stages.length - 1, stageIndex + 1)].id)
  const goPrevious = () => setStage(stages[Math.max(0, stageIndex - 1)].id)

  return (
    <div className="arcane-warrior-page app-shell">
      <div className="atmosphere" aria-hidden="true" />
      <header className="topbar">
        <BrandMark />
        <div className="context-item"><span>项目</span><strong>AW X1 全球详情页</strong></div>
        <div className="context-item"><span>市场</span><strong>DE / AMAZON</strong></div>
        <div className="context-item"><span>工作副本</span><strong>R-013</strong></div>
        <div className="topbar-spacer" />
        <div className="sync-state">模拟交互演示 · <NavLink to="/arcane-warrior/stage-a">进入阶段 A 真实联调</NavLink></div>
        <div className="autosave">自动保存 {audit[0]?.time}</div>
        <button className="icon-button" aria-label="更多操作"><MoreHorizontal size={18} /></button>
      </header>

      <nav className="stage-nav" aria-label="工作阶段">
        {stages.map((item, index) => (
          <button key={item.id} className={stage === item.id ? 'active' : ''} onClick={() => setStage(item.id)}>
            <span className="stage-number">{String(index + 1).padStart(2, '0')}</span>
            <span><b>{item.label}</b><small>{item.en}</small></span>
            {index < stageIndex && <Check size={14} className="stage-check" />}
          </button>
        ))}
      </nav>

      <main className="workspace">
        {stage === 'setup' && <ProjectSetup sources={sources} parsing={parsing} onUpload={mockUpload} />}
        {stage === 'facts' && <FactsStage sources={sources} facts={facts} selected={selectedFact} onSelect={setSelectedFactId} onConfirm={confirmFact} onRevise={reviseConfirmedFact} onUpload={mockUpload} parsing={parsing} confirmedCount={confirmedCount} onPreview={() => { setStoryPreview(true); setStage('story'); log('生成无文案初步故事顺序', 'Agent') }} />}
        {stage === 'story' && <StoryStage sections={sections} selectedId={selectedSectionId} onSelect={setSelectedSectionId} preview={storyPreview} approved={storyApproved} confirmedCount={confirmedCount} canApprove={canApproveStory} view={storyView} onView={setStoryView} onGenerate={() => { setStoryPreview(true); log('生成无文案初步故事顺序', 'Agent'); notify('已生成初步顺序，仍需人工确认。') }} onMove={moveSection} onApprove={() => { setStoryApproved(true); log('批准故事线 V1'); notify('故事线已批准，可进入章节制作。') }} />}
        {stage === 'chapters' && <ChapterStage sections={sections} selected={selectedSection} onSelect={setSelectedSectionId} canCreate={canCreateChapter} draft={chapterDraft} copy={chapterCopy} setCopy={setChapterCopy} patchOpen={agentPatchOpen} onCreate={() => { setChapterDraft(true); log(`创建 ${selectedSectionId} 章节 Draft`, 'Agent'); notify('Agent 已创建章节草稿，等待人工编辑。') }} onAdopt={adoptPatch} onReject={() => { setAgentPatchOpen(false); log('拒绝 Agent Patch'); notify('Patch 已拒绝。') }} onLock={lockChapter} />}
        {stage === 'market' && <MarketStage markets={markets} onGenerate={(id) => { setMarkets((items) => items.map((market) => market.id === id ? { ...market, progress: 100, status: 'in_review' } : market)); log(`生成市场适配 ${id}`, 'Agent'); notify('市场版本已生成，等待人工审核。') }} onApprove={(id) => { setMarkets((items) => items.map((market) => market.id === id ? { ...market, status: 'approved' } : market)); log(`批准市场版本 ${id}`); notify('该市场版本已批准。') }} />}
        {stage === 'qa' && <QaStage issues={qaIssues} approved={approvedVersion} exported={exported} onResolve={resolveIssue} canApprove={canApproveVersion} onApprove={() => { setApprovedVersion(true); log('批准交付版本 V1'); notify('版本已批准，可以模拟导出。') }} onExport={() => { setExported(true); log('生成模拟交付包', '系统'); notify('模拟交付包已生成。') }} />}
      </main>

      <footer className="actionbar">
        <Button onClick={goPrevious} disabled={stageIndex === 0}><ArrowLeft size={16} /> 上一阶段</Button>
        <div className="action-status">
          <span><StatusDot tone="red" /> {activeBlockers.length} 阻断</span>
          <span><StatusDot tone="yellow" /> {activeWarnings.length} 警告</span>
          <span><Clock3 size={14} /> 工作副本已保存</span>
        </div>
        <div className="action-spacer" />
        <button className="activity-trigger" title={audit.slice(0, 3).map((item) => `${item.time} ${item.actor}：${item.action}`).join('\n')}><Clock3 size={15} /> 活动记录 <ChevronDown size={14} /></button>
        <Button tone="violet" onClick={goNext} disabled={stageIndex === stages.length - 1}>下一阶段 <ArrowRight size={16} /></Button>
      </footer>

      {toast && <div className="toast"><CheckCircle2 size={18} />{toast}</div>}
    </div>
  )
}

function ProjectSetup({ sources, parsing, onUpload }: { sources: typeof initialSources; parsing: boolean; onUpload: () => void }) {
  return (
    <div className="setup-workbench">
      <aside className="rail setup-steps">
        <PanelTitle eyebrow="PROJECT SETUP" title="项目设置" />
        {['产品基础信息', '产品资料', '平台与站点', '本地化配置', '页面尺寸'].map((item, index) => <button key={item} className={index === 1 ? 'active' : ''}><span>{String(index + 1).padStart(2, '0')}</span><b>{item}</b>{index !== 1 && <Check size={13} />}</button>)}
      </aside>
      <section className="setup-main">
        <div className="form-panel setup-section">
          <PanelTitle eyebrow="01 / PRODUCT FOUNDATION" title="产品基础信息" action={<Chip tone="green">已保存</Chip>} />
          <div className="form-grid setup-form-grid">
            <label>产品名称<input defaultValue="AW 智能路由器 X1" /></label><label>内部代号<input defaultValue="AW-X1" /></label>
            <label>产品品类<select defaultValue="router"><option value="router">网络设备 / 智能路由器</option></select></label><label>产品阶段<select defaultValue="launch"><option value="launch">上市准备</option><option>研发中</option></select></label>
            <label className="wide">一句话介绍<input defaultValue="面向多设备家庭的 Wi-Fi 6 智能路由方案" /></label>
          </div>
        </div>
        <div className="form-panel setup-section setup-sources">
          <PanelTitle eyebrow="02 / SOURCE INTAKE" title="产品资料" action={<span className="hint">已上传 {sources.length} 个 · 均作为事实证据</span>} />
          <div className="upload-zone" onClick={onUpload}><Upload size={26} /><b>{parsing ? '正在解析资料…' : '拖拽文件到这里，或选择文件'}</b><span>规格表、说明书、检测报告与产品图片</span><Button tone="violet">选择资料</Button></div>
          <div className="setup-source-list">{sources.map((source) => <SourceCard key={source.id} source={source} />)}</div>
        </div>
        <div className="form-panel setup-section compact-section"><PanelTitle eyebrow="03 / CHANNEL" title="平台与站点" /><div className="form-grid"><label>首发平台<select defaultValue="Amazon"><option>Amazon</option><option>Tmall</option></select></label><label>站点 / 国家<select defaultValue="DE"><option value="DE">德国 / Germany</option></select></label></div></div>
        <div className="form-panel setup-section compact-section"><PanelTitle eyebrow="04 / LOCALE" title="本地化配置" /><div className="form-grid"><label>目标语言<select defaultValue="de-DE"><option>de-DE</option></select></label><label>货币<select defaultValue="EUR"><option>EUR €</option></select></label></div></div>
        <div className="form-panel setup-section compact-section page-size"><PanelTitle eyebrow="05 / CANVAS" title="页面尺寸" /><button className="size-choice active"><Circle size={13} />平台要求尺寸 <b>1200 px</b><small>来自 Amazon DE RulePack</small></button><button className="size-choice"><Circle size={13} />自定义尺寸</button></div>
      </section>
      <aside className="inspector setup-check"><PanelTitle eyebrow="LAUNCH CHECK" title="可以开始提取" action={<CheckCircle2 size={28} className="good" />} /><p className="check-lead">5 / 5 项已完成</p>{['基础信息', `产品资料 · ${sources.length} 个文件`, '事实型资料', '图片素材', '平台规则已加载'].map((item) => <div className="check-row" key={item}><CheckCircle2 size={14} /><span>{item}</span></div>)}<div className="check-result"><b>检查结果</b><span><StatusDot tone="green" />0 个阻断问题</span><span><StatusDot tone="yellow" />1 个建议</span></div><p className="setup-tip"><Info size={15} />进入产品事实页后，可继续上传资料并确认事实。</p></aside>
      <div className="stage-bottom setup-bottom"><Button><ArrowLeft size={15} />返回项目列表</Button><span>草稿自动保存 · 所有 Agent 输出受项目边界约束</span><Button tone="primary">创建项目并开始事实提取 <ArrowRight size={15} /></Button></div>
    </div>
  )
}

function SourceCard({ source }: { source: (typeof initialSources)[number] }) {
  return <div className="source-card"><FileText size={19} /><div><b>{source.name}</b><span>{source.meta}</span></div><div className="source-status"><StatusDot tone={source.status === 'running' ? 'yellow' : 'green'} />{source.status === 'running' ? '提取中' : `${source.facts} 项事实`}</div></div>
}

function FactsStage({ sources, facts, selected, onSelect, onConfirm, onRevise, onUpload, parsing, confirmedCount, onPreview }: { sources: typeof initialSources; facts: Fact[]; selected: Fact; onSelect: (id: string) => void; onConfirm: () => void; onRevise: () => void; onUpload: () => void; parsing: boolean; confirmedCount: number; onPreview: () => void }) {
  const blockers = facts.filter((fact) => fact.severity === 'blocker').length
  return (
    <div className="three-column facts-layout">
      <aside className="rail sources-rail">
        <PanelTitle eyebrow="EVIDENCE" title="证据与来源" action={<button className="icon-button" onClick={onUpload}>{parsing ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />}</button>} />
        <div className="rail-tabs"><button className="active">全部 {sources.length}</button><button>已提取 {sources.length}</button></div>
        <div className="rail-list">{sources.map((source) => <SourceCard key={source.id} source={source} />)}</div>
        <Button className="full"><ShieldCheck size={15} />证据库设置</Button>
      </aside>
      <section className="primary-panel fact-queue">
        <PanelTitle title="待处理中心" eyebrow={`PRODUCT FACTS / ${facts.length} ITEMS`} action={<div className="filters"><button>全部 <ChevronDown size={13} /></button><button>类型 <ChevronDown size={13} /></button><Search size={16} /></div>} />
        <div className="fact-table-head"><span>类型</span><span>事实断言</span><span>证据</span><span>置信度</span><span>状态</span></div>
        <div className="fact-list">
          {facts.map((fact) => <button key={fact.id} className={`fact-row ${selected.id === fact.id ? 'selected' : ''}`} onClick={() => onSelect(fact.id)}>
            <span><StatusDot tone={fact.severity === 'blocker' ? 'red' : fact.kind === '缺证据' ? 'yellow' : 'green'} />{fact.kind}</span>
            <span><small>{fact.id}</small><b>{fact.claim}</b>{fact.freshness === 'stale' && <Chip tone="yellow">过期</Chip>}</span>
            <span>{fact.evidence}</span>
            <span className={fact.confidence && fact.confidence >= 85 ? 'good' : 'warn'}>{fact.confidence ? `${fact.confidence}%` : '—'}</span>
            <span>{fact.confirmed ? <Chip tone="green">已确认</Chip> : fact.severity === 'blocker' ? <Chip tone="red">需处理</Chip> : <Chip>待确认</Chip>}</span>
          </button>)}
        </div>
        <div className="queue-summary"><span>显示 1–{facts.length} 项</span><b>{confirmedCount} 项已进入事实基线</b></div>
      </section>
      <aside className="inspector fact-inspector">
        <PanelTitle eyebrow="FACT INSPECTOR" title="事实详情" action={selected.locked ? <Chip tone="yellow"><Lock size={12} /> 已锁定</Chip> : <Chip>待确认</Chip>} />
        <div className="meta-grid"><span>事实 ID<b>{selected.id}</b></span><span>类型<b>{selected.kind}</b></span><span>置信度<b className="good">{selected.confidence ? `${selected.confidence}%` : '—'}</b></span></div>
        <div className="inspector-block"><label>事实断言</label><p className="assertion">{selected.claim}</p></div>
        <div className="inspector-block"><label>证据摘录</label><p>{selected.excerpt}</p><button className="source-link"><FileText size={14} /> {selected.source}</button></div>
        <div className="agent-draft"><div className="agent-label"><Bot size={15} /> AGENT DRAFT <Chip tone="violet">建议表述</Chip></div><p>{selected.kind === '确认' ? selected.claim.replace('。', '，让多设备连接保持稳定。') : '当前证据不足，不建议写入正式文案。'}</p><div className="diff"><del>{selected.claim}</del><ins>{selected.kind === '确认' ? selected.claim.replace('。', '，兼顾速度与稳定性。') : '保留为待确认事实'}</ins></div></div>
        {selected.confirmed ? <Button tone="violet" className="full" onClick={onRevise}><RefreshCw size={15} />修订事实并标记影响</Button> : <Button tone="primary" className="full" onClick={onConfirm} disabled={selected.severity === 'blocker'}><Lock size={15} />确认事实</Button>}
        <p className="hint">Agent 只能提出建议；确认后由人工锁定并进入事实基线。</p>
      </aside>
      <div className="stage-bottom facts-bottom">
        <div className="metric-block"><span>阻断项</span><strong className="bad">{blockers}</strong><small>冲突 {blockers}</small></div>
        <div className="metric-block"><span>事实基线</span><strong>{confirmedCount}</strong><small>已人工确认</small></div>
        <Button tone="violet" onClick={onPreview} disabled={confirmedCount < 2}><Layers3 size={16} />查看无文案初步故事顺序</Button>
        <div className="gate-disabled"><Lock size={17} /><div><b>生成正式故事线</b><span>{confirmedCount < 2 ? '至少需确认 2 项关键事实' : '需先人工确认初步故事顺序'}</span></div></div>
      </div>
    </div>
  )
}

function StoryStage({ sections, selectedId, onSelect, preview, approved, confirmedCount, canApprove, view, onView, onGenerate, onMove, onApprove }: { sections: StorySection[]; selectedId: string; onSelect: (id: string) => void; preview: boolean; approved: boolean; confirmedCount: number; canApprove: boolean; view: 'overview' | 'detail'; onView: (view: 'overview' | 'detail') => void; onGenerate: () => void; onMove: (direction: -1 | 1) => void; onApprove: () => void }) {
  const selected = sections.find((section) => section.id === selectedId) ?? sections[0]
  return (
    <div className="story-workbench">
      <aside className="rail story-tree"><PanelTitle eyebrow="NARRATIVE TREE" title="叙事结构树" />{sections.map((section, index) => <button key={section.id} className={section.id === selectedId ? 'active' : ''} onClick={() => onSelect(section.id)}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{section.title}</b><small>{section.purpose}</small></div>{section.locked ? <CheckCircle2 size={14} /> : <Circle size={12} />}</button>)}<div className="tree-tools"><Button><Plus size={14} />添加同级</Button><Button onClick={() => onMove(-1)}><ArrowUp size={14} />上移</Button><Button onClick={() => onMove(1)}><ArrowDown size={14} />下移</Button></div></aside>
      <aside className="story-preview"><PanelTitle eyebrow="MOBILE PREVIEW" title="移动端阅读预览" /><div className="phone-shell"><div className="phone-screen"><ClientLogo compact /><span className="phone-no">01</span><div className="device-slab"><i/><i/><i/></div><b>{selected.title}</b><small>{selected.purpose}</small><span className="phone-no second">02</span><div className="phone-card" /></div></div></aside>
      <section className="story-main">
        <div className="story-viewbar"><div><Button onClick={() => onView('overview')} tone={view === 'overview' ? 'violet' : 'ghost'}>出图脚本</Button><Button onClick={() => onView('detail')} tone={view === 'detail' ? 'violet' : 'ghost'}>章节规格编辑器</Button></div><Chip tone={approved ? 'green' : 'violet'}>{approved ? 'V1 已批准' : '工作草稿'}</Chip></div>
        {!preview ? <div className="empty-state"><Layers3 size={38} /><h3>基于事实基线生成章节顺序</h3><p>只组织信息主题与阅读路径，不生成正式文案。</p><Button tone="primary" onClick={onGenerate} disabled={confirmedCount < 2}><Play size={16} />生成初步顺序</Button></div> : view === 'overview' ? <div className="script-stack"><PanelTitle eyebrow="PRIMARY SELLING POINT" title="一级卖点 · 出图脚本" action={<span className="hint">共 {sections.length} 章 · 预计 12 张</span>} />{sections.map((section, index) => <article key={section.id} className={section.id === selectedId ? 'selected' : ''} onClick={() => onSelect(section.id)}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{section.title}</h3><p>{section.purpose}</p>{section.id === selectedId && <><div className="script-promise">“从事实出发，建立可信、清晰的阅读路径。”</div><div className="module-chips"><Chip>主标题</Chip><Chip>副标题</Chip><Chip>正文 × 4</Chip><Chip>图解 × 3</Chip><Chip>收尾文案</Chip></div><div className="material-plan"><div><b>效果图</b><div className="dark-thumb"><ImageIcon size={23} /></div></div><div><b>结构示意图</b><div className="dark-thumb missing"><AlertTriangle size={22} /></div></div></div></>}</div><ChevronDown size={15} /></article>)}</div> : <div className="spec-editor"><div className="chapter-objective"><div><label>章节目标</label><p>传达“稳定连接与技术可信”的价值，建立选择理由。</p></div><div><label>预期客户结论</label><p>这不是参数堆砌，而是面向真实使用场景的可靠方案。</p></div></div><div className="editor-tabs"><button className="active">内容脚本</button><button>图片与元素 1</button><button>事实与证据</button><button>分镜与 Layout</button></div><PanelTitle eyebrow={`${selectedId} / 10 MODULES`} title="AI 建议内容结构" action={<Button tone="violet"><Sparkles size={14} />智能重排</Button>} /><div className="module-list">{['主标题｜稳定连接从核心开始', '副标题｜Wi-Fi 6 双频并发', '正文段落 01｜多设备同时在线', '重点强调｜低延迟与稳定性', '爆炸图解说 01｜核心芯片与散热', '爆炸图解说 02｜信号覆盖结构', '爆炸图解说 03｜安全协议', '收尾文案｜从事实到信任'].map((item, index) => <div className={index === 4 ? 'editing' : ''} key={item}><MoreHorizontal size={14} /><b>{item}</b><span>{index === 4 ? '编辑中' : '已绑定'}</span>{index === 4 && <div className="inline-editor"><label>模块类型<select><option>编号解说</option></select></label><label>引用事实<input value="F-001 · F-005" readOnly /></label><label className="wide">正文内容<textarea defaultValue="以芯片、散热与协议三层结构说明稳定连接的技术依据。" /></label><Button tone="primary">保存修改</Button></div>}</div>)}</div></div>}
      </section>
      <aside className="inspector story-agent"><PanelTitle eyebrow="AGENT RECOMMENDATION" title="Agent 故事线建议" action={<Bot size={18} />} /><div className="agent-score"><Sparkles size={18} /><div><b>本章建议采用</b><span>主标题 + 副标题 + 正文 × 4 + 图解 × 3</span></div></div><div className="reason-list"><b>为什么</b><p><CheckCircle2 size={13} />先建立用户价值，再解释技术依据</p><p><CheckCircle2 size={13} />章节数量由内容需要决定</p><p><CheckCircle2 size={13} />冲突事实 F-003 未被引用</p></div><Button tone="primary" className="full">接受全部建议</Button><Button className="full">逐项调整</Button><div className="agent-boundary"><Bot size={18} /><div><b>Agent 边界</b><span>可建议与重排，不可替你批准。</span></div></div></aside>
      <div className="stage-bottom story-bottom"><Button><ArrowLeft size={15} />返回产品事实</Button><span className="formula"><b>一章</b> = 一个主题 + 一组事实 + 一组素材 + 一种呈现</span><Button tone="primary" onClick={onApprove} disabled={!canApprove || approved}><Check size={16} />{approved ? '故事线已批准' : '批准故事线并开始章节制作'}</Button></div>
    </div>
  )
}

function ChapterStage({ sections, selected, onSelect, canCreate, draft, copy, setCopy, patchOpen, onCreate, onAdopt, onReject, onLock }: { sections: StorySection[]; selected: StorySection; onSelect: (id: string) => void; canCreate: boolean; draft: boolean; copy: string; setCopy: (value: string) => void; patchOpen: boolean; onCreate: () => void; onAdopt: () => void; onReject: () => void; onLock: () => void }) {
  return (
    <div className="three-column chapter-layout">
      <aside className="rail chapter-tree">
        <PanelTitle eyebrow="PAGE STRUCTURE" title="章节结构" action={<button className="icon-button"><Plus size={15} /></button>} />
        <div className="tree-search"><Search size={15} />搜索章节</div>
        <div className="tree-list">{sections.map((section) => <button key={section.id} className={selected.id === section.id ? 'active' : ''} onClick={() => onSelect(section.id)}><span>{section.id}</span><b>{section.title}</b><i>{section.freshness === 'stale' ? <Chip tone="yellow">过期</Chip> : section.locked ? <Lock size={13} /> : <StatusDot tone="violet" />}</i></button>)}</div>
        <div className="tree-legend"><span><StatusDot tone="violet" />编辑中</span><span><StatusDot tone="green" />已锁定</span><span><StatusDot tone="yellow" />需更新</span></div>
      </aside>
      <section className="canvas-panel">
        <div className="canvas-toolbar"><span><b>{selected.id}</b> {selected.title}</span><Chip tone="green">已保存 {now()}</Chip><span className="canvas-device">iPhone 15 Pro · 390 × 844</span><button className="icon-button"><PanelLeftClose size={15} /></button><span>75%</span></div>
        <div className="canvas-stage">
          {!canCreate ? <div className="canvas-gate"><Lock size={34} /><h3>故事线尚未批准</h3><p>可以查看本阶段，但需先由人工批准故事线才能创建正式章节草稿。</p></div> : !draft ? <div className="canvas-gate"><Sparkles size={34} /><h3>创建 {selected.id} 章节草稿</h3><p>Agent 将只读取本章上下文、事实基线与 Style Snapshot。</p><Button tone="primary" onClick={onCreate}><Sparkles size={16} />创建 Draft</Button></div> : <div className="mobile-canvas">
            <ClientLogo compact /><SectionLabel>CORE MODEL / {selected.id}</SectionLabel><h2>{selected.title}</h2><p className="canvas-lead">更快、更稳、更可靠，让复杂连接保持清晰。</p>
            <div className="comparison"><div><small>行业平均水平</small><strong>~850ms</strong><span>响应速度</span></div><i>VS</i><div className="highlight"><small>AW 事实基线</small><strong>~180ms</strong><span>响应速度</span></div></div>
            <div className={`selected-block ${selected.locked ? 'locked' : ''}`}><span className="handle tl"/><span className="handle tr"/><span className="handle bl"/><span className="handle br"/><label>证据与来源 <FileCheck2 size={12} /></label><textarea value={copy} disabled={selected.locked} onChange={(event) => setCopy(event.target.value)} /><div className="proof-metrics"><span><b>300万+</b>日处理请求</span><span><b>98.7%</b>平均通过率</span><span><b>10.2ms</b>P95 延迟</span></div><small>引用：F-001 · F-005 / 已确认事实</small></div>
            <div className="spec-box"><label>关键规格</label><p><span>无线协议</span><b>Wi-Fi 6</b></p><p><span>WAN 端口</span><b>2.5GbE</b></p><p><span>安全协议</span><b>WPA3</b></p></div>
          </div>}
        </div>
      </section>
      <aside className="inspector chapter-inspector">
        <div className="inspector-tabs"><button>属性</button><button className="active">AGENT</button><button>QA</button></div>
        <PanelTitle eyebrow="CONTROLLED AI" title="内容建议" action={<Chip tone="green">就绪</Chip>} />
        {!draft ? <div className="inspector-empty"><Bot size={30} /><p>创建章节草稿后，Agent 可提出受约束的 Patch。</p></div> : patchOpen ? <div className="patch-card"><div className="patch-head"><Sparkles size={15} /><b>强化证据与来源表述</b><Chip>内容优化</Chip></div><label>修改原因</label><p>增强专业度，同时保留事实边界与引用关系。</p><label>当前内容</label><div className="copy-box old">{copy}</div><label>建议修改</label><div className="copy-box new">X1 以 Wi-Fi 6 双频并发为核心，让多设备连接更稳定、延迟更低，并保留清晰可追溯的产品事实。</div><div className="evidence-chips"><Chip>F-001</Chip><Chip>F-005</Chip></div>{selected.locked && <div className="lock-warning"><Lock size={16} />章节已锁定，Patch 不可覆盖当前字段。</div>}<div className="patch-actions"><Button tone="primary" onClick={onAdopt} disabled={selected.locked}>采纳修改</Button><Button onClick={onReject}>拒绝</Button></div></div> : <div className="inspector-empty"><CheckCircle2 size={30} /><p>当前没有待处理的 Agent Patch。</p><Button tone="violet" onClick={() => undefined}>重新分析</Button></div>}
      </aside>
      <div className="stage-bottom chapter-bottom"><div><b>{selected.id} · {selected.title}</b><span>{selected.locked ? '已锁定，Agent 无法覆盖' : '工作草稿，仅本章可见'}</span></div><Button>保存草稿</Button><Button tone="primary" onClick={onLock} disabled={!draft || selected.locked}><Lock size={16} />{selected.locked ? '本章已锁定' : '锁定本章并继续'}</Button></div>
    </div>
  )
}

function MarketStage({ markets, onGenerate, onApprove }: { markets: typeof initialMarkets; onGenerate: (id: string) => void; onApprove: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState(markets[0].id)
  const [tab, setTab] = useState<'文案' | '图片' | 'Layout' | '术语' | '规则'>('文案')
  const selected = markets.find((market) => market.id === selectedId) ?? markets[0]
  return (
    <div className="market-workbench">
      <aside className="rail market-rail"><PanelTitle eyebrow="GLOBAL VARIANTS" title="市场适配版本" action={<button className="icon-button"><Plus size={14} /></button>} /><div className="master-version"><span>语义母版</span><b>中文</b><Chip tone="green">已批准</Chip></div>{markets.map((market) => <button key={market.id} className={selected.id === market.id ? 'active' : ''} onClick={() => setSelectedId(market.id)}><div><b>{market.name} · {market.channel}</b><small>{market.language} · {market.status === 'approved' ? '已批准' : market.status === 'in_review' ? '编辑中' : '待生成'}</small></div><span>{market.progress}%</span></button>)}<div className="market-count"><Layers3 size={15} />{markets.length} 个市场 · 3 种语言 · 1 个母版</div></aside>
      <section className="market-canvas"><div className="market-head"><div><h2>{selected.name} · {selected.channel} · {selected.language} 详情页</h2><p>事实只读，允许本地化文案、图片与 Layout；不能修改产品事实。</p></div><div><Chip tone="green"><Lock size={11} />母版 R-013</Chip><Chip>RulePack 2026.09</Chip></div></div><div className="canvas-toolbar"><select defaultValue="CH-03"><option value="CH-03">03 核心技术优势</option></select><Button tone="violet">当前章节</Button><Button>整页详情</Button><Button>HTML 预览</Button><span className="canvas-device">{selected.channel} · 1200px</span><span>适合宽度</span></div><div className="market-preview"><div className="localized-page"><ClientLogo compact /><SectionLabel>{selected.language} / CORE ADVANTAGE</SectionLabel><h2>{selected.language === 'DE' ? 'Stabile Verbindung.\nEinfach kontrolliert.' : selected.language === 'ZH' ? '稳定连接，简单掌控。' : '安定した接続を、もっと簡単に。'}</h2><div className="router-visual"><div className="device-slab"><i/><i/><i/><i/></div></div><div className="locale-proof"><b>Wi-Fi 6</b><span>2.5GbE</span><span>WPA3</span></div><div className="warning-pin" aria-label="标题安全区建议调整" title="标题安全区建议调整"><AlertTriangle size={13} /></div></div></div><div className="chapter-strip">{['01 已批准', '02 当前 · 待确认', '03 待检查', '04 已批准', '05 已批准', '06 有警告'].map((item, index) => <button className={index === 1 ? 'active' : ''} key={item}>{item}</button>)}</div></section>
      <aside className="inspector market-inspector"><PanelTitle eyebrow="MARKET INSPECTOR" title="市场适配 Inspector" /><div className="inspector-tabs five">{(['文案','图片','Layout','术语','规则'] as const).map((item) => <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>{tab === '文案' ? <><div className="inspector-block"><label>源语义文案（只读）</label><p>稳定连接，让复杂使用变得简单。</p></div><div className="inspector-block"><label>目标文案（{selected.language}）</label><textarea defaultValue={selected.language === 'DE' ? 'Stabile Verbindung. Einfach kontrolliert.' : '稳定连接，简单掌控。'} /></div><div className="locale-score"><span>忠实度<b className="good">高</b></span><span>品牌语气<b className="good">一致</b></span><span>事实绑定<b className="good">3 / 3</b></span></div><div className="lock-note"><Lock size={15} /><span><b>员工已锁定当前字段</b>Agent 后续只能提交差异提案。</span></div><div className="term-list"><b>术语对照</b><span>双频并发 <i>→</i> Dual-Band</span><span>稳定连接 <i>→</i> Stabile Verbindung</span><span>安全协议 <i>→</i> Sicherheitsprotokoll</span></div><div className="length-alert"><AlertTriangle size={15} /><span>标题长度接近规则上限，建议保留 2 行。</span></div></> : <div className="inspector-empty"><Layers3 size={28} /><p>{tab}规则已从 {selected.channel} RulePack 加载。</p></div>}<Button tone="violet" className="full" onClick={() => onGenerate(selected.id)}><Sparkles size={14} />生成 / 更新适配</Button><Button tone="primary" className="full" onClick={() => onApprove(selected.id)} disabled={selected.progress < 100 || selected.status === 'approved'}><Check size={14} />{selected.status === 'approved' ? '本章已批准' : '确认本章'}</Button></aside>
      <div className="stage-bottom market-bottom"><Button><ArrowLeft size={15} />返回章节制作</Button><Button><Eye size={15} />查看母版差异</Button><span>母版事实已锁定 · 所有市场版本可追溯</span><Button tone="violet" onClick={() => onGenerate(selected.id)}><Sparkles size={15} />生成未完成章节</Button><Button tone="primary" disabled={markets.some((market) => market.status !== 'approved')}>批准整套详情页并进入 QA</Button></div>
    </div>
  )
}

function QaStage({ issues, approved, exported, onResolve, canApprove, onApprove, onExport }: { issues: QaIssue[]; approved: boolean; exported: boolean; onResolve: (issue: QaIssue) => void; canApprove: boolean; onApprove: () => void; onExport: () => void }) {
  const [selectedId, setSelectedId] = useState(issues.find((issue) => !issue.resolved)?.id ?? issues[0].id)
  const selected = issues.find((issue) => issue.id === selectedId) ?? issues[0]
  const blockers = issues.filter((issue) => issue.severity === 'blocker' && !issue.resolved)
  const warnings = issues.filter((issue) => issue.severity === 'warning' && !issue.resolved)
  const groups = useMemo(() => [...new Set(issues.map((issue) => issue.category))], [issues])
  return (
    <div className="three-column qa-layout">
      <aside className="rail qa-rail"><PanelTitle eyebrow="RULE SET" title="QA 导航" action={<button className="icon-button"><Menu size={15} /></button>} />{groups.map((group) => <div className="qa-group" key={group}><h3>{group}<span>{issues.filter((issue) => issue.category === group && !issue.resolved).length}</span></h3>{issues.filter((issue) => issue.category === group).map((issue) => <button key={issue.id} className={selected.id === issue.id ? 'active' : ''} onClick={() => setSelectedId(issue.id)}><StatusDot tone={issue.resolved ? 'green' : issue.severity === 'blocker' ? 'red' : 'yellow'} /><span>{issue.title}</span>{issue.resolved && <Check size={13} />}</button>)}</div>)}<div className="qa-total"><span><StatusDot tone="red" />阻断 {blockers.length}</span><span><StatusDot tone="yellow" />警告 {warnings.length}</span><span><StatusDot tone="green" />通过 {18 + issues.filter((issue) => issue.resolved).length}</span></div></aside>
      <section className="qa-preview"><div className="preview-head"><span><b>全局详情页</b> · DE Amazon 桌面预览</span><span>1440 × 900</span></div><div className="preview-workspace"><div className="preview-controls"><button>+</button><span>75%</span><button>−</button></div><div className="page-preview"><ClientLogo compact /><SectionLabel>AW-X1 / GLOBAL DETAIL</SectionLabel><h2>连接更快，<br /><em>决策更简单。</em></h2><p>面向多设备家庭的 Wi-Fi 6 智能路由方案。</p><div className="preview-device"><div className="device-slab"><i/><i/><i/><i/></div></div><div className="preview-benefits"><span>高效<small>低延迟连接</small></span><span>高质<small>事实可追溯</small></span><span>简单<small>快速部署</small></span></div>{!issues[0].resolved && <button className="issue-pin pin-one" onClick={() => setSelectedId('QA-01')}>1</button>}{!issues[1].resolved && <button className="issue-pin pin-two" onClick={() => setSelectedId('QA-02')}>2</button>}</div></div><div className="diff-strip"><span>变更对比 · R-012 → R-013</span><div><i className="diff-thumb"><b>1</b></i><small>事实引用冲突</small></div><div><i className="diff-thumb yellow"><b>2</b></i><small>首图安全区</small></div><div><i className="diff-thumb violet"><b>3</b></i><small>标题本地化</small></div></div></section>
      <aside className="inspector delivery-gate"><PanelTitle eyebrow="DELIVERY GATE" title={blockers.length ? '未通过' : '可以批准'} action={<Chip tone={blockers.length ? 'red' : 'green'}>{blockers.length ? `${blockers.length} BLOCKERS` : 'READY'}</Chip>} /><div className="gate-state"><span className={blockers.length ? 'bad' : 'good'}>{blockers.length ? <X size={24} /> : <Check size={24} />}</span><div><b>{blockers.length ? '存在阻断问题，暂无法导出' : '所有阻断问题已解决'}</b><p>{blockers.length ? '逐项处理或进入对应章节修复。' : '仍可保留警告并提交人工批准。'}</p></div></div><div className="selected-issue"><label>选中问题</label><div className="issue-title"><Chip tone={selected.severity === 'blocker' ? 'red' : 'yellow'}>{selected.severity === 'blocker' ? '阻断' : '警告'}</Chip><b>{selected.title}</b></div><p>{selected.detail}</p><dl><dt>问题 ID</dt><dd>{selected.id}</dd><dt>影响市场</dt><dd>{selected.markets.join(' · ')}</dd><dt>负责人</dt><dd>{selected.owner}</dd><dt>状态</dt><dd>{selected.resolved ? '已解决' : '待处理'}</dd></dl><Button tone="primary" className="full" onClick={() => onResolve(selected)} disabled={selected.resolved}><Check size={15} />{selected.resolved ? '已解决' : '标记为已解决'}</Button></div><div className="market-mini"><label>市场变体</label><div><span>DE Amazon<b>{blockers.length ? '阻断' : '通过'}</b></span><span>CN Tmall<b>警告</b></span><span>JP Rakuten<b>待审</b></span></div></div></aside>
      <div className="stage-bottom qa-bottom"><div className="qa-count"><b className="bad">{blockers.length} BLOCKERS</b><span>·</span><b className="warn">{warnings.length} WARNINGS</b></div><div className="block-reason"><AlertTriangle size={16} />{blockers.length ? `导出被阻断：${blockers[0].title}` : approved ? '版本已批准，可生成模拟交付包' : '阻断已清零，等待人工批准版本'}</div><Button onClick={onApprove} disabled={!canApprove || approved}><Check size={16} />{approved ? '版本已批准' : '批准版本'}</Button><Button tone="primary" onClick={onExport} disabled={!approved || exported}><Download size={16} />{exported ? '交付包已生成' : blockers.length ? `解决 ${blockers.length} 个阻断后可导出` : '导出交付包'}</Button></div>
    </div>
  )
}

export default ArcaneWarriorPage
