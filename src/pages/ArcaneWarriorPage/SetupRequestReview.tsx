import type { ProjectSession } from './useProjectSession'
import { projectDifferences } from './project-diff'

export function SetupRequestReview({ session: s }: { session: ProjectSession }) {
  const operation = s.pending?.kind === 'setup' && s.setupRejected ? s.pending.operation : null
  if (!operation) return null
  const before = operation.before, current = s.project
  const body = JSON.parse(operation.prepared.body) as { idempotencyKey: string }
  const differences = before && current?.id === before.id ? projectDifferences(before, current) : []
  return <section className="inspector-block" aria-label="启动失败请求复核依据"><b>启动请求复核</b>
    <p>{operation.rejection?.message ?? '服务端已明确拒绝这份原请求，请比较以下依据后重新提交。'}{operation.rejection?.code && `（${operation.rejection.code}）`}</p>
    <p>步骤：{operation.action} · 操作编号：{body.idempotencyKey} · 原请求依据：{before ? `P${before.version} / R${before.revision}` : '尚无服务端项目 ID'}</p>
    <p>冻结输入修订：{operation.capture.reviewedRevision ?? 0} · 规则类型备份修订：{operation.capture.modelsRevision ?? 0}</p>
    <details><summary>查看冻结输入与原请求正文</summary><pre className="context-raw-draft">{JSON.stringify({ capture: operation.capture, request: JSON.parse(operation.prepared.body) }, null, 2)}</pre></details>
    {s.recoveryNeedsCheck ? <p>请先读取最新项目。未读取前不能完成本次复核。</p> : before && current?.id === before.id ? <>
      <b>原请求与当前 R{current.revision} 的差异</b><ul>{differences.map((difference, index) => <li key={index}>{difference}</li>)}</ul>
      {!differences.length && <p>可见业务字段没有变化；仍需核对上方失败原因与冻结请求。</p>}
      <details><summary>查看原请求依据与当前服务端快照</summary><div className="snapshot-comparison"><pre>{JSON.stringify(before, null, 2)}</pre><pre>{JSON.stringify(current, null, 2)}</pre></div></details>
    </> : <p>已读取项目列表；创建结果仍以原操作回执为准，列表中的同名项目不会被自动认领。</p>}
  </section>
}
