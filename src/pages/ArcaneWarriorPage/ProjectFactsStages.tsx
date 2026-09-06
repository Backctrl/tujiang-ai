import { useReviewedDraft } from './project-drafts'
import { useState } from 'react'
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react'
import type { StageId } from './domain'
import type { ProjectSession } from './useProjectSession'
import type { Evidence, Fact } from '../../../backend/src/contracts'
import { Button, Chip, PanelTitle, StatusDot } from './WorkbenchUI'
import { useProjectContext } from './useProjectContext'
import { CanvasFields, ContextControls, ContextReadiness, LocaleFields, ProductBriefFields, TargetFields } from './ProjectContextFields'
import { MaterialList, MaterialUploadFields } from './MaterialIntakeFields'
import type { MaterialIntakeController } from './useMaterialIntake'
import { ManualEvidenceFields } from './ManualEvidenceFields'

type Props = { session: ProjectSession; onStage: (stage: StageId) => void; intake: MaterialIntakeController }

export function ProjectSetup({ session: s, onStage, intake }: Props) {
  const [name, setName] = useState('')
  const context = useProjectContext(s)
  const identityDraft = useReviewedDraft<string | null, { revision: number; name: string }>(s.project?.id, 'productName', null, () => ({ revision: s.project?.identityRevision ?? 0, name: s.project?.identity?.productName ?? '未确认' }))
  const productName = identityDraft.value
  const setProductName = identityDraft.setValue
  const manualSources = s.project?.evidence.filter(source => !source.materialSource) ?? []
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
    <aside className="inspector setup-check"><ContextReadiness context={context} session={s} /></aside>
    <div className="stage-bottom setup-bottom"><Button disabled><ArrowLeft size={15} />返回项目列表</Button><span>配置需保存并启用 · 事实身份独立确认</span><Button tone="primary" disabled={!s.project} onClick={() => onStage('facts')}>进入产品事实 <ArrowRight size={15} /></Button></div>
  </div>
}

function SourceCard({ source, facts }: { source: Evidence; facts: Fact[] }) {
  return <div className="source-card"><FileText size={19} /><div><b>{source.documentName}</b><span>{source.locator}</span><details><summary>查看资料原文</summary><p>{source.text}</p></details></div><div className="source-status"><StatusDot tone="muted" />{facts.filter(f => f.evidenceId === source.id).length} 项事实</div></div>
}

export { FactsStage } from './MaterialFactsStage'
