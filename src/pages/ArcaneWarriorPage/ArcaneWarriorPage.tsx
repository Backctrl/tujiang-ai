import { useState } from 'react'
import { projectDifferences } from './project-diff'
import { ArrowLeft, ArrowRight, ChevronDown, Clock3, RefreshCw } from 'lucide-react'
import { BrandMark, Button, StatusDot } from './WorkbenchUI'
import { useProjectSession } from './useProjectSession'
import { useMaterialIntake } from './useMaterialIntake'
import { ProjectSetup, FactsStage } from './ProjectFactsStages'
import StoryStage from './StoryStage'
import { ChapterStage, MarketStage, QaStage } from './DeliveryStages'
import type { StageId } from './domain'
import './arcane-warrior.css'
import './backend-integration.css'

const stages: { id: StageId; label: string; en: string }[] = [
  { id: 'setup', label: '项目设置', en: 'PROJECT SETUP' },
  { id: 'facts', label: '产品事实', en: 'PRODUCT FACTS' },
  { id: 'story', label: '故事线', en: 'STORYLINE' },
  { id: 'chapters', label: '章节制作', en: 'CHAPTERS' },
  { id: 'market', label: '市场适配', en: 'MARKET ADAPT' },
  { id: 'qa', label: 'QA与导出', en: 'QA & EXPORT' },
]
const components = [ProjectSetup, FactsStage, StoryStage, ChapterStage, MarketStage, QaStage]
export default function ArcaneWarriorPage() {
  const session = useProjectSession()
  const intake = useMaterialIntake(session)
  const { project, conflictBefore } = session
  const productionContext = project?.production?.context
  const activeTarget = productionContext?.versions.find(version => version.version === productionContext.activeVersion)?.context.primaryTarget
  const targetLabel = activeTarget ? `${activeTarget.platform} / ${activeTarget.site} / ${activeTarget.language}` : productionContext?.draft ? '草稿未启用' : '尚未配置'
  const [stage, setStage] = useState<StageId>('setup')
  const [activityOpen, setActivityOpen] = useState(false)
  const stageIndex = stages.findIndex(s => s.id === stage)
  return <div className="arcane-warrior-page app-shell connected-workbench">
    <div className="atmosphere" aria-hidden="true" />
    <header className="topbar">
      <BrandMark />
      <div className="context-item"><span>项目</span><strong>{project?.name ?? '尚未连接项目'}</strong></div>
      <div className="context-item"><span>首发目标</span><strong>{targetLabel}</strong></div>
      <div className="context-item"><span>服务端快照</span><strong>{project ? `R${project.revision}` : '尚未读取'}</strong></div>
      <div className="topbar-spacer" />
      <div className="sync-state" role="status">{session.busy ? '正在请求' : session.pending ? '结果待核对' : session.eventsStatus}</div>
      <Button onClick={() => setStage('setup')}>{session.authExpired ? '更新连接凭据' : '项目设置'}</Button>
      <button type="button" className="icon-button" aria-label="刷新项目" disabled={!project || session.busy} onClick={() => void session.refresh()}><RefreshCw size={16} /></button>
    </header>
    <nav className="stage-nav" aria-label="工作阶段">{stages.map((item, index) => <button type="button" key={item.id} className={stage === item.id ? 'active' : ''} aria-current={stage === item.id ? 'step' : undefined} onClick={() => setStage(item.id)}><span className="stage-number">{String(index + 1).padStart(2, '0')}</span><span><b>{item.label}</b><small>{item.en}</small></span></button>)}</nav>
    <main className="workspace">
      {(session.error || session.notice || session.pending || conflictBefore || session.recoveryLoading || session.recoveryError) && <div className="connection-feedback">
        {session.recoveryLoading && <p role="status">正在读取未决请求恢复记录，完成后开放写入。</p>}
        {session.recoveryError && <div role="alert"><p>{session.recoveryError}</p><Button disabled={session.busy || session.recoveryLoading} onClick={session.reloadMaterialRecovery}>重新读取恢复记录</Button></div>}
        {session.error && <p role="alert">{session.error}</p>}
        {session.notice && <p role="status">{session.notice}</p>}
        {session.pending && !session.busy && <div className="connection-actions"><span>{session.recoveryNeedsCheck ? '已恢复未确认请求，请先读取服务端核对。' : '请求结果尚未确认，新的写入已暂停。'}</span><Button disabled={!project || !session.token.trim()} onClick={() => void session.refresh()}>读取最新项目核对</Button><Button disabled={!session.canRetry} onClick={() => void session.retry()}>使用原操作编号重试</Button></div>}
        {conflictBefore && <div><p>提交发生冲突，本地修改已保留。读取最新项目，核对错误与差异后恢复提交。</p><div className="connection-actions"><Button disabled={session.busy} onClick={() => void session.refresh()}>读取最新版本</Button><Button disabled={!session.canResolveConflict} onClick={session.resolveConflict}>已复核差异，恢复提交</Button></div><ul>{project && projectDifferences(conflictBefore, project).map((change, index) => <li key={index}>{change}</li>)}</ul><details><summary>查看原始快照</summary><div className="snapshot-comparison"><pre>{JSON.stringify(conflictBefore, null, 2)}</pre><pre>{JSON.stringify(project, null, 2)}</pre></div></details></div>}
      </div>}
      <div className="stage-surfaces" key={project?.id ?? 'disconnected'}>{components.map((Component, i) => <div className="stage-surface" hidden={stageIndex !== i} key={stages[i].id} aria-label={stages[i].label}><Component session={session} intake={intake} onStage={setStage} /></div>)}</div>
    </main>
    <footer className="actionbar">
      <Button onClick={() => setStage(stages[stageIndex - 1].id)} disabled={stageIndex === 0}><ArrowLeft size={16} />上一阶段</Button>
      <div className="action-status"><span><StatusDot tone={session.hasConflict ? 'red' : 'muted'} />{project ? `${session.confirmed.length} 条已确认事实` : '尚无项目数据'}</span><span><Clock3 size={14} />{session.pending || conflictBefore ? '提交已暂停' : '以服务端保存结果为准'}</span></div>
      <div className="action-spacer" />
      <button type="button" className="activity-trigger" aria-expanded={activityOpen} onClick={() => setActivityOpen(!activityOpen)}><Clock3 size={15} />活动记录<ChevronDown size={14} /></button>
      <Button tone="violet" onClick={() => setStage(stages[stageIndex + 1].id)} disabled={stageIndex === stages.length - 1}>下一阶段<ArrowRight size={16} /></Button>
    </footer>
    {activityOpen && <section className="activity-panel" aria-label="活动记录"><Button onClick={() => setActivityOpen(false)}>关闭记录</Button>{!project?.audit.length && <p>尚无服务端活动。</p>}{project?.audit.slice(-20).reverse().map(a => <p key={a.id}><b>R{a.revision} · {a.type}</b><br />{a.actor} · {new Date(a.at).toLocaleString('zh-CN')}</p>)}</section>}
  </div>
}
