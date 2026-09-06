import type { Project } from './stage-a-api.js'

export function projectDifferences(before: Project, after: Project) {
  const changes: string[] = []
  const status = { candidate: '待确认', confirmed: '已确认', rejected: '已拒绝', retracted: '已撤回' }
  if (before.name !== after.name) changes.push(`项目名称：${before.name} → ${after.name}`)
  if (JSON.stringify(before.identity) !== JSON.stringify(after.identity)) changes.push(`产品身份：${before.identity?.productName ?? '未确认'} → ${after.identity?.productName ?? '未确认'}`)
  for (const fact of after.facts) {
    const old = before.facts.find(f => f.id === fact.id)
    if (!old) changes.push(`新增事实：${fact.attribute}：${fact.value}`)
    else if (JSON.stringify(old) !== JSON.stringify(fact)) changes.push(`事实变化：${fact.attribute}：${old.value} → ${fact.value}；审核状态 ${status[old.status]} → ${status[fact.status]}`)
  }
  for (const fact of before.facts) if (!after.facts.some(f => f.id === fact.id)) changes.push(`移除事实：${fact.attribute}：${fact.value}`)
  if (JSON.stringify(before.evidence) !== JSON.stringify(after.evidence)) changes.push(`产品资料已更新（${before.evidence.length} → ${after.evidence.length} 份），请在项目设置核对原文。`)
  if (JSON.stringify(before.storyboard) !== JSON.stringify(after.storyboard)) changes.push('故事顺序或依赖已变化，请在故事线对照服务端顺序与保留的草稿。')
  if (JSON.stringify(before.sections) !== JSON.stringify(after.sections)) changes.push('项目诊断稿已变化，请重新核对诊断预检。')
  if (!changes.length) changes.push('运行任务、预检或其他服务端记录已更新；本地输入仍保留。')
  return changes
}
