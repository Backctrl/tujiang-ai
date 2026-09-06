import type { Evidence, Fact, Project } from '../../../backend/src/contracts.js'
import type { Material, MaterialBlock } from '../../../backend/src/production-materials.js'
import type { MaterialReviewCenter, MaterialReviewTask, MaterialSourceImpact, MaterialUse } from '../../../backend/src/production-material-usage.js'
import { sameJsonValue } from './project-drafts.js'

export const reviewTypes = ['material_usage', 'fact_extraction', 'fact_review', 'fact_source_reconfirmation'] as const
export const reviewLabels: Record<MaterialReviewTask['type'], string> = {
  material_usage: '用途待审核', fact_extraction: '待提取候选', fact_review: '事实待确认', fact_source_reconfirmation: '来源待重确认',
}
export const usageLabels: Record<MaterialUse, string> = { product_evidence: '产品证据', asset: '可用图片素材', reference: '参考内容' }
export const usageStatusLabels: Record<Material['usage']['status'], string> = { pending: '用途待审核', partially_reviewed: '用途部分已审核', reviewed: '用途已审核' }
export const factStatusLabels: Record<Fact['status'], string> = { candidate: '待确认', confirmed: '已确认', rejected: '已拒绝', retracted: '已撤回' }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') }
export function isMaterialReviewCenter(value: unknown): value is MaterialReviewCenter {
  if (!record(value) || typeof value.projectId !== 'string' || !Number.isInteger(value.projectVersion) || !Number.isInteger(value.revision) || !Array.isArray(value.tasks)) return false
  const valid = value.tasks.every((task: unknown) => {
    if (!record(task) || typeof task.id !== 'string') return false
    if (task.type === 'material_usage') return task.status === 'pending' && typeof task.materialId === 'string' && strings(task.blockIds)
    if (task.type === 'fact_extraction') return task.status === 'extraction_needed' && ['materialId', 'blockId', 'evidenceId', 'usageDecisionId'].every(key => typeof task[key] === 'string') && Number.isInteger(task.usageVersion)
    if (task.type === 'fact_review') return task.status === 'pending' && typeof task.factId === 'string' && typeof task.evidenceId === 'string' && (task.materialId === undefined || typeof task.materialId === 'string')
    return task.type === 'fact_source_reconfirmation' && ['ready', 'blocked'].includes(String(task.status))
      && ['factId', 'evidenceId', 'materialId', 'blockId'].every(key => typeof task[key] === 'string')
      && strings(task.affectedSectionIds) && strings(task.affectedStoryboardIds)
      && (task.status === 'ready' ? typeof task.replacementEvidenceId === 'string' : task.replacementEvidenceId === undefined)
  })
  return valid && new Set(value.tasks.map(task => (task as { id: string }).id)).size === value.tasks.length
}
export function reviewCenterMatches(project: Project | null, center: MaterialReviewCenter | null | undefined) {
  return !!project && !!center && center.projectId === project.id && center.projectVersion === project.version && center.revision === project.revision
}
export function allowedMaterialUses(block: MaterialBlock): MaterialUse[] {
  return block.image && block.locator.type === 'image' ? ['asset', 'reference'] : block.text ? ['product_evidence', 'reference'] : []
}

// Display/selection guard. The backend independently validates source integrity and the text hash on every command.
export function evidenceAvailable(project: Project, evidence: Evidence) {
  if (evidence.usage !== 'product_evidence' || evidence.availability === 'withdrawn') return false
  if (!evidence.materialSource) return evidence.origin !== 'material'
  if (evidence.origin !== 'material' || evidence.availability !== 'available') return false
  const source = evidence.materialSource
  const material = project.production?.materials?.find(item => item.id === source.materialId)
  const block = material?.blocks.find(item => item.id === source.blockId)
  const current = material?.usageReview?.current[source.blockId]
  return !!material && !!block && !!current && material.parse.runStatus === 'succeeded' && material.parse.queueStatus === 'done'
    && material.sha256 === source.sourceSha256 && material.parse.parserVersion === source.parserVersion
    && block.materialId === material.id && block.sourceSha256 === source.sourceSha256 && block.parserVersion === source.parserVersion
    && sameJsonValue(source.locator, block.locator) && sameJsonValue(source.source, material.source)
    && current.usage === 'product_evidence' && current.projectionId === evidence.id && current.decisionId === source.usageDecisionId
    && current.version === source.usageVersion && !block.image && !!block.text && evidence.text === block.text
}
export function factSourceAvailable(project: Project, fact: Fact) {
  const evidence = project.evidence.find(item => item.id === fact.evidenceId)
  return !fact.sourceReview && !!evidence && evidenceAvailable(project, evidence) && fact.start >= 0
    && fact.end === fact.start + fact.quote.length && evidence.text.slice(fact.start, fact.end) === fact.quote
}

export type UsageDraft = { choices: Record<string, MaterialUse | ''>; reason: string }
export const emptyUsageDraft: UsageDraft = { choices: {}, reason: '' }
export function usageDecisions(material: Material, draft: UsageDraft) {
  return Object.entries(draft.choices).filter((item): item is [string, MaterialUse] => !!item[1])
    .sort(([left], [right]) => material.blocks.findIndex(block => block.id === left) - material.blocks.findIndex(block => block.id === right))
    .map(([blockId, usage]) => ({ blockId, usage }))
}
export function usageDraftValid(material: Material, draft: UsageDraft) {
  const decisions = usageDecisions(material, draft)
  return !!draft.reason.trim() && draft.reason.length <= 1000 && decisions.length > 0 && decisions.length <= 2000 && decisions.every(item => {
    const block = material.blocks.find(block => block.id === item.blockId)
    return !!block && allowedMaterialUses(block).includes(item.usage)
  }) && material.parse.runStatus === 'succeeded' && material.parse.queueStatus === 'done'
}
export function usageChangeImpact(project: Project, material: Material, draft: UsageDraft): MaterialSourceImpact {
  const evidenceIds = usageDecisions(material, draft).flatMap(item => {
    const previous = material.usageReview?.current[item.blockId]
    return previous?.usage === 'product_evidence' && previous.usage !== item.usage ? [previous.projectionId] : []
  })
  const facts = project.facts.filter(fact => evidenceIds.includes(fact.evidenceId))
  const ids = new Set(facts.map(fact => fact.id))
  return { affectedEvidenceIds: evidenceIds, affectedFactIds: [...ids], affectedCandidateIds: facts.filter(fact => fact.status === 'candidate').map(fact => fact.id),
    reconfirmationRequiredFactIds: facts.filter(fact => fact.status === 'confirmed' && fact.locked).map(fact => fact.id),
    affectedSectionIds: project.sections.filter(section => section.factIds.some(id => ids.has(id))).map(section => section.id),
    affectedStoryboardIds: [...new Set([...(project.storyboard ? [project.storyboard] : []), ...(project.storyboardCandidates ?? [])]
      .filter(story => story.chapters.some(chapter => chapter.factIds.some(id => ids.has(id)))).flatMap(story => story.id ? [story.id] : []))] }
}
export function usageDraftBase(project: Project | null, materialId: string, draft: UsageDraft) {
  const material = project?.production?.materials?.find(item => item.id === materialId)
  const impact = project && material ? usageChangeImpact(project, material, draft) : null
  return { identityRevision: project?.identityRevision ?? 0, identity: project?.identity ?? null,
    material: material ? { id: material.id, sha256: material.sha256, source: material.source, parse: material.parse, blocks: material.blocks, usage: material.usage, usageReview: material.usageReview ?? null } : null,
    affectedFacts: project?.facts.filter(fact => impact?.affectedFactIds.includes(fact.id)) ?? [],
    affectedSections: project?.sections.filter(section => impact?.affectedSectionIds.includes(section.id)) ?? [],
    affectedStories: [...(project?.storyboard ? [project.storyboard] : []), ...(project?.storyboardCandidates ?? [])]
      .filter(story => story.chapters.some(chapter => chapter.factIds.some(id => impact?.affectedFactIds.includes(id)))) }
}
export type FactCandidateDraft = { attribute: string; value: string; role: 'core' | 'supporting'; evidenceId: string; quote: string; reason: string; correctsFactId?: string }
export const emptyFactCandidate: FactCandidateDraft = { attribute: '', value: '', role: 'core', evidenceId: '', quote: '', reason: '' }
export function candidateDraftBase(project: Project | null, draft: FactCandidateDraft) {
  const evidence = project?.evidence.find(item => item.id === draft.evidenceId) ?? null
  const material = project?.production?.materials?.find(item => item.id === evidence?.materialSource?.materialId)
  return { identityRevision: project?.identityRevision ?? 0, identity: project?.identity ?? null, evidence,
    currentUsage: evidence?.materialSource ? material?.usageReview?.current[evidence.materialSource.blockId] ?? null : null,
    correctedFact: project?.facts.find(item => item.id === draft.correctsFactId) ?? null }
}
export function candidateValid(project: Project, draft: FactCandidateDraft) {
  const evidence = project.evidence.find(item => item.id === draft.evidenceId)
  return !!project.identity && !!evidence && evidenceAvailable(project, evidence) && !!draft.attribute.trim() && !!draft.value.trim()
    && !!draft.quote && evidence.text.includes(draft.quote) && !!draft.reason.trim() && draft.reason.length <= 1000
}
export function factTaskBase(project: Project | null, factId: string) {
  const fact = project?.facts.find(item => item.id === factId) ?? null
  const evidence = project?.evidence.find(item => item.id === fact?.evidenceId) ?? null
  const material = project?.production?.materials?.find(item => item.id === evidence?.materialSource?.materialId)
  const replacement = evidence?.materialSource && material?.usageReview?.current[evidence.materialSource.blockId]
  return { identityRevision: project?.identityRevision ?? 0, identity: project?.identity ?? null, fact, evidence,
    currentUsage: replacement ?? null, replacementEvidence: project?.evidence.find(item => item.id === replacement?.projectionId) ?? null,
    sections: project?.sections.filter(section => section.factIds.includes(factId)) ?? [],
    stories: [...(project?.storyboard ? [project.storyboard] : []), ...(project?.storyboardCandidates ?? [])].filter(story => story.chapters.some(chapter => chapter.factIds.includes(factId))) }
}
export function reconfirmEvidence(project: Project, task: Extract<MaterialReviewTask, { type: 'fact_source_reconfirmation' }>) {
  if (task.status !== 'ready' || !task.replacementEvidenceId) return undefined
  const fact = project.facts.find(item => item.id === task.factId)
  const previous = project.evidence.find(item => item.id === task.evidenceId)
  const evidence = project.evidence.find(item => item.id === task.replacementEvidenceId)
  return fact?.status === 'confirmed' && fact.locked && fact.sourceReview?.status === 'reconfirmation_required'
    && fact.evidenceId === task.evidenceId && previous?.materialSource?.materialId === task.materialId && previous.materialSource.blockId === task.blockId
    && evidence?.materialSource?.materialId === task.materialId
    && evidence.materialSource.blockId === task.blockId && evidenceAvailable(project, evidence) && evidence.text.includes(fact.quote) ? evidence : undefined
}
export function reviewTaskSource(project: Project, task: MaterialReviewTask) {
  const material = project.production?.materials?.find(item => item.id === task.materialId)
  const evidence = 'evidenceId' in task ? project.evidence.find(item => item.id === task.evidenceId) : undefined
  const fact = 'factId' in task ? project.facts.find(item => item.id === task.factId) : undefined
  return { material, evidence, fact }
}
