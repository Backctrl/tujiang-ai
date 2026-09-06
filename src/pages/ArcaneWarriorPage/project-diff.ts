import type { Project } from './stage-a-api.js'
import { contextDifferences, projectContextBase } from './project-context.js'
import { sameJsonValue } from './project-drafts.js'
import { materialStatus } from './material-intake.js'

export function projectDifferences(before: Project, after: Project) {
  const changes: string[] = []
  const status = { candidate: '待确认', confirmed: '已确认', rejected: '已拒绝', retracted: '已撤回' }
  if (before.name !== after.name) changes.push(`项目名称：${before.name} → ${after.name}`)
  if (!sameJsonValue(before.identity, after.identity)) changes.push(`产品身份：${before.identity?.productName ?? '未确认'} → ${after.identity?.productName ?? '未确认'}`)
  for (const fact of after.facts) {
    const old = before.facts.find(f => f.id === fact.id)
    if (!old) changes.push(`新增事实：${fact.attribute}：${fact.value}`)
    else if (!sameJsonValue(old, fact)) changes.push(`事实变化：${fact.attribute}：${old.value} → ${fact.value}；审核状态 ${status[old.status]} → ${status[fact.status]}`)
  }
  for (const fact of before.facts) if (!after.facts.some(f => f.id === fact.id)) changes.push(`移除事实：${fact.attribute}：${fact.value}`)
  if (!sameJsonValue(before.evidence, after.evidence)) changes.push(`文字证据已更新（${before.evidence.length} → ${after.evidence.length} 份），请在项目设置核对原文。`)
  if (!sameJsonValue(before.storyboard, after.storyboard)) changes.push('故事顺序或依赖已变化，请在故事线对照服务端顺序与保留的草稿。')
  if (!sameJsonValue(before.sections, after.sections)) changes.push('项目诊断稿已变化，请重新核对诊断预检。')
  for (const material of after.production?.materials ?? []) {
    const old = before.production?.materials?.find(item => item.id === material.id)
    if (!old) changes.push(`新增原件：${material.fileName} · ${materialStatus(material)}`)
    else {
      if (!sameJsonValue(old.parse, material.parse) || !sameJsonValue(old.blocks, material.blocks)) changes.push(`原件解析：${material.fileName} · ${materialStatus(old)} → ${materialStatus(material)}（${material.blocks.length} 个候选）`)
      if (!sameJsonValue(old.origins, material.origins)) changes.push(`原件来源：${material.fileName}（${old.origins.length} → ${material.origins.length} 次导入）`)
      if (!sameJsonValue(old.usageReview, material.usageReview)) changes.push(`原件用途：${material.fileName}（第 ${old.usageReview?.version ?? 0} → ${material.usageReview?.version ?? 0} 版），请核对资料块用途及关联事实。`)
    }
  }
  changes.push(...contextDifferences(projectContextBase(before), projectContextBase(after)))
  if (!changes.length) changes.push(sameJsonValue(before, after) ? '服务端数据与请求依据相同，请核对错误说明和保留输入。' : '运行任务、预检或其他服务端记录已更新；本地输入仍保留。')
  return changes
}
