import type { ProjectSession } from './useProjectSession'
import type { ProjectContextController } from './useProjectContext'
import type { useProjectStartup } from './useProjectStartup'
import { startupLabels, type StartupFinding } from './startup-contract'
import { Button, Chip, PanelTitle } from './WorkbenchUI'

export function StartupFindings({ items, onFinding }: { items: StartupFinding[]; onFinding: (finding: StartupFinding) => void }) {
  return <ul className="startup-findings">{items.map((item, index) => <li key={`${item.code}:${index}`}><button type="button" onClick={() => onFinding(item)}>{item.message}<span>查看{item.location.page === 'facts' ? '产品事实' : '对应配置'} →</span></button></li>)}</ul>
}
export function StartupReadiness({ session: s, context: c, startup, onFinding }: {
  session: ProjectSession; context: ProjectContextController; startup: ReturnType<typeof useProjectStartup>; onFinding: (finding: StartupFinding) => void
}) {
  const check = startup.check
  return <><PanelTitle eyebrow="CREATION REVIEW" title="创建前检查" action={<Chip tone={check?.canStart ? 'green' : 'muted'}>{startup.loading ? '检查中' : check?.canStart ? '可创建' : '待检查'}</Chip>} />
    <p className="check-lead">{check ? check.nextState === 'blocked' ? '请先处理创建缺项' : startupLabels[check.nextState] : s.project ? '填写后读取当前项目的检查结果' : '本地输入已保留，首次提交时检查项目'}</p>
    {!!c.compiled.errors.length && <div className="check-result"><b>输入格式待处理</b>{c.compiled.errors.map((issue, index) => <span key={index}>{issue.message}</span>)}</div>}
    {c.local.needsReview && <p role="alert">本地配置依据已变化，请先比较并复核保留的输入。</p>}
    {c.rules === null && <p role="status">平台规则目录暂不可用。输入保留，重新读取目录后才能创建并提取。</p>}
    {startup.error && <p role="alert">{startup.error}</p>}
    {check && <>
      <div className="check-result"><b>服务端检查 · R{check.revision}</b><span>必填项 {check.statistics.requiredFieldsPresent} / {check.statistics.requiredFieldsTotal}</span><span>已接收 {check.statistics.receivedMaterials} 份原件</span><span>可用产品证据 {check.statistics.availableProductEvidence} 项 · 可用图片素材 {check.statistics.availableImageAssets} 项</span><span>待解析 {check.statistics.awaitingParse} 份 · 待用途审核 {check.statistics.awaitingUsageReview} 项 · 解析失败 {check.statistics.parseFailed} 份</span></div>
      {!!check.blockers.length && <section className="startup-finding-group"><b>创建前必须处理</b><StartupFindings items={check.blockers} onFinding={onFinding} /></section>}
      {!!check.suggestions.length && <section className="startup-finding-group"><b>建议与资料提示</b><StartupFindings items={check.suggestions} onFinding={onFinding} /></section>}
      {!!check.extractionPrerequisites.length && <section className="startup-finding-group"><b>进入产品事实后继续处理</b><StartupFindings items={check.extractionPrerequisites} onFinding={onFinding} /></section>}
      <div className="check-result"><b>{check.modelExecution.status === 'synthetic' ? '合成测试执行环境' : '事实提取执行条件'}</b><span>{check.modelExecution.message}</span><span>实际输入、能力与费用预检尚未执行。</span></div>
    </>}
    <Button className="full" disabled={!s.project || !s.token.trim() || s.authExpired || startup.loading || !!c.compiled.errors.length} onClick={startup.reload}>重新检查创建条件</Button>
    <p className="setup-tip">产品介绍用于理解产品。资料用途和候选事实在产品事实页逐项审核。</p>
    <details className="inspector-block"><summary>单独保存配置草稿</summary><p>未完成的配置可单独保存；主按钮会按本次完整配置创建启动记录。</p><Button disabled={!c.canSave} onClick={c.save}>保存配置草稿</Button></details>
  </>
}
