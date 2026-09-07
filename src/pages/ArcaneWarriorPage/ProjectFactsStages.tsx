import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react'
import type { StageId } from './domain'
import type { ProjectSession } from './useProjectSession'
import type { Evidence, Fact } from '../../../backend/src/contracts'
import { Button, Chip, PanelTitle, StatusDot } from './WorkbenchUI'
import { useProjectContext } from './useProjectContext'
import { CanvasFields, ContextControls, LocaleFields, ProductBriefFields, TargetFields } from './ProjectContextFields'
import { StartupReadiness } from './StartupReadiness'
import { useProjectStartup } from './useProjectStartup'
import type { StartupFinding } from './startup-contract'
import { ProjectEntryFields } from './ProjectEntryFields'
import { MaterialList, MaterialUploadFields } from './MaterialIntakeFields'
import type { MaterialIntakeController } from './useMaterialIntake'
import { ManualEvidenceFields } from './ManualEvidenceFields'

type Props = { session: ProjectSession; onStage: (stage: StageId) => void; intake: MaterialIntakeController }
const setupAnchors = ['产品基础信息', '产品资料', '平台与站点', '本地化配置', '页面尺寸']

export function ProjectSetup({ session: s, onStage, intake }: Props) {
  const context = useProjectContext(s)
  const main = useRef<HTMLElement>(null)
  const [activeAnchor, setActiveAnchor] = useState(0)
  const manualSources = s.project?.evidence.filter(source => !source.materialSource) ?? []
  const scrollTo = (index: number) => {
    const container = main.current, section = container?.querySelector<HTMLElement>(`#setup-${index}`)
    if (!container || !section) return
    container.scrollTo({ top: container.scrollTop + section.getBoundingClientRect().top - container.getBoundingClientRect().top, behavior: 'auto' })
    setActiveAnchor(index)
  }
  const onFinding = (finding: StartupFinding) => {
    if (finding.location.page === 'facts') { if (s.project?.production?.startup) onStage('facts'); else scrollTo(1); return }
    scrollTo(({ 'product-info': 0, materials: 1, 'primary-target': 2, 'canvas-profile': 4, 'creation-confirmation': 0, 'pending-center': 1 })[finding.location.anchor])
  }
  const startup = useProjectStartup(s, context, () => onStage('facts'), onFinding)
  const trackScroll = () => {
    const container = main.current
    if (!container) return
    const top = container.getBoundingClientRect().top + 24
    let index = 0
    setupAnchors.forEach((_label, current) => { if ((container.querySelector(`#setup-${current}`)?.getBoundingClientRect().top ?? Infinity) <= top) index = current })
    if (container.scrollTop > 0 && container.scrollHeight - container.clientHeight - container.scrollTop < 2) index = 4
    setActiveAnchor(index)
  }
  return <div className="setup-workbench">
    <aside className="rail setup-steps"><PanelTitle eyebrow="PROJECT SETUP" title="项目设置" />{setupAnchors.map((item, index) => <button key={item} className={activeAnchor === index ? 'active' : undefined} aria-current={activeAnchor === index ? 'location' : undefined} aria-controls={`setup-${index}`} onClick={() => scrollTo(index)}><span>{String(index + 1).padStart(2, '0')}</span><b>{item}</b></button>)}</aside>
    <section className="setup-main" ref={main} onScroll={trackScroll} aria-label="项目设置连续表单">
      <ProjectEntryFields session={s} />
      <div className="form-panel setup-section" id="setup-0"><PanelTitle eyebrow="01 / PRODUCT FOUNDATION" title="产品基础信息" action={<Chip tone={context.activeVersion ? 'green' : 'muted'}>{context.activeVersion?.label ?? (context.initialized ? '配置草稿' : '待开启配置')}</Chip>} />
        <div className="form-grid setup-form-grid"><ContextControls context={context} session={s} /><ProductBriefFields context={context} /></div>
      </div>
      <div className="form-panel setup-section setup-sources" id="setup-1"><PanelTitle eyebrow="02 / SOURCE INTAKE" title="产品资料" action={<span className="hint">已接收 {intake.materials.length} 份原件</span>} />
        <MaterialUploadFields intake={intake} session={s} surface="setup" />
        <div className="setup-source-list material-list"><MaterialList intake={intake} session={s} /></div>
        <details className="inspector-block"><summary>原有文字证据录入 · {manualSources.length} 份</summary><p className="integration-note">可继续人工粘贴文字证据。这里的记录与上方原件候选分开保存，不会自动把上传资料转成证据。</p>
          <ManualEvidenceFields session={s} />
          <div className="setup-source-list">{manualSources.map(source => <SourceCard key={source.id} source={source} facts={s.project?.facts ?? []} />)}</div>
        </details>
      </div>
      <div className="form-panel setup-section compact-section" id="setup-2"><PanelTitle eyebrow="03 / CHANNEL" title="平台与站点" /><TargetFields context={context} session={s} /></div>
      <div className="form-panel setup-section compact-section" id="setup-3"><PanelTitle eyebrow="04 / LOCALE" title="本地化配置" /><LocaleFields context={context} /></div>
      <div className="form-panel setup-section compact-section page-size" id="setup-4"><PanelTitle eyebrow="05 / CANVAS" title="页面尺寸" /><CanvasFields context={context} /></div>
    </section>
    <aside className="inspector setup-check"><StartupReadiness context={context} session={s} startup={startup} onFinding={onFinding} /></aside>
    <div className="stage-bottom setup-bottom"><Button disabled><ArrowLeft size={15} />返回项目列表</Button><span>{startup.submitting ? '正在检查并保存项目启动' : '创建后在产品事实中审核资料与候选'}</span><Button tone="primary" disabled={!startup.canStart} onClick={() => void startup.start()}>创建项目并开始事实提取 <ArrowRight size={15} /></Button></div>
  </div>
}

function SourceCard({ source, facts }: { source: Evidence; facts: Fact[] }) {
  return <div className="source-card"><FileText size={19} /><div><b>{source.documentName}</b><span>{source.locator}</span><details><summary>查看资料原文</summary><p>{source.text}</p></details></div><div className="source-status"><StatusDot tone="muted" />{facts.filter(f => f.evidenceId === source.id).length} 项事实</div></div>
}

export { FactsStage } from './MaterialFactsStage'
