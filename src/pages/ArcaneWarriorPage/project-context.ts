import type { ContextDraft, StoredRulePack } from '../../../backend/src/production-context.js'
import type { Project } from '../../../backend/src/contracts.js'
import { canvasFormats, describeBounds, isScopedRule, legacyTargetFields, modelLabel, requiredScopedRules, ruleKey, withinBounds, type RuleModel } from './rule-catalog.js'
export { isRuleCatalog, ruleKey } from './rule-catalog.js'

export const briefFields = ['productName', 'internalCode', 'category', 'stage', 'introduction', 'commercialIntent'] as const
export const requiredBriefFields = ['productName', 'category', 'stage', 'introduction'] as const
export const targetFields = legacyTargetFields
export const scopedTargetFields = [...targetFields, 'contentType'] as const
export type ContextForm = Record<typeof briefFields[number] | typeof scopedTargetFields[number] | 'widthPx' | 'format' | 'selectionBasis' | 'rulePackId' | 'rulePackVersion' | 'ruleModel', string>
export type ContextIssue = { field: string; message: string }
const labels: Record<string, string> = {
  context: '制作配置', productBrief: '产品基础信息', primaryTarget: '目标市场', canvasProfile: '页面尺寸', rulePackRef: '已核验的平台规则',
  'productBrief.productName': '产品名称', 'productBrief.internalCode': '内部代号', 'productBrief.category': '产品品类',
  'productBrief.stage': '产品阶段', 'productBrief.introduction': '产品介绍', 'productBrief.commercialIntent': '商业目标',
  'primaryTarget.platform': '首发平台', 'primaryTarget.site': '站点', 'primaryTarget.country': '国家 / 地区代码',
  'primaryTarget.language': '目标语言', 'primaryTarget.currency': '货币', 'primaryTarget.unitSystem': '计量单位',
  'primaryTarget.contentType': '内容类型', 'canvasProfile.selectionBasis': '画布选择依据', ruleModel: '规则类型',
  'canvasProfile.widthPx': '图片宽度', 'canvasProfile.format': '图片格式', 'rulePackRef.id': '平台规则', 'rulePackRef.version': '平台规则版本', catalog: '平台规则目录',
}
export function contextFieldLabel(path: string) { return labels[path.replace(/^context\./, '')] ?? path }
function displayValue(field: keyof ContextForm, value: string) {
  if (!value) return '未填写'
  if (field === 'unitSystem') return value === 'metric' ? '公制' : value === 'imperial' ? '英制' : value
  if (field === 'ruleModel') return modelLabel(value as RuleModel)
  if (field === 'selectionBasis' && value === 'local_production_policy') return '本地制作策略'
  return field === 'format' ? value.toUpperCase() : value
}
const formats = canvasFormats

export function contextForm(context?: ContextDraft | null, model?: RuleModel): ContextForm {
  return {
    productName: context?.productBrief?.productName ?? '', internalCode: context?.productBrief?.internalCode ?? '',
    category: context?.productBrief?.category ?? '', stage: context?.productBrief?.stage ?? '',
    introduction: context?.productBrief?.introduction ?? '', commercialIntent: context?.productBrief?.commercialIntent ?? '',
    platform: context?.primaryTarget?.platform ?? '', site: context?.primaryTarget?.site ?? '', country: context?.primaryTarget?.country ?? '',
    language: context?.primaryTarget?.language ?? '', currency: context?.primaryTarget?.currency ?? '', unitSystem: context?.primaryTarget?.unitSystem ?? '',
    contentType: context?.primaryTarget?.contentType ?? '', selectionBasis: context?.canvasProfile?.selectionBasis ?? '',
    widthPx: context?.canvasProfile?.widthPx === undefined ? '' : String(context.canvasProfile.widthPx), format: context?.canvasProfile?.format ?? '',
    rulePackId: context?.rulePackRef?.id ?? '', rulePackVersion: context?.rulePackRef?.version ?? '',
    ruleModel: model ?? (context?.primaryTarget?.contentType !== undefined || context?.canvasProfile?.selectionBasis !== undefined || !context?.rulePackRef ? 'scoped-rules.1' : 'legacy-canvas.1'),
  }
}

/** Empty controls are omitted: the server replaces the complete draft instead of merging it. */
export function compileContextForm(form: ContextForm): { context: ContextDraft; errors: ContextIssue[] } {
  const context: ContextDraft = {}, errors: ContextIssue[] = []
  const invalid = (field: string, message: string) => errors.push({ field, message: `${contextFieldLabel(field)}：${message}` })
  if (!['legacy-canvas.1', 'scoped-rules.1'].includes(form.ruleModel)) invalid('ruleModel', '请选择当前客户端支持的规则类型')
  for (const key of briefFields) {
    const value = form[key].trim()
    if (!value) continue
    const max = key === 'introduction' ? 10000 : key === 'commercialIntent' ? 2000 : 200
    if (value.length > max) invalid(`productBrief.${key}`, `最多 ${max} 个字符`)
    context.productBrief ??= {}; context.productBrief[key] = value
  }
  for (const key of scopedTargetFields) {
    const value = form[key].trim()
    if (!value) continue
    const field = `primaryTarget.${key}`
    if (key === 'unitSystem') {
      if (value !== 'metric' && value !== 'imperial') invalid(field, '请选择公制或英制')
      else { context.primaryTarget ??= {}; context.primaryTarget.unitSystem = value }
      continue
    }
    if (key === 'country' && !/^[A-Z]{2}$/.test(value)) invalid(field, '使用 2 位大写代码，例如 CN')
    else if (key === 'currency' && !/^[A-Z]{3}$/.test(value)) invalid(field, '使用 3 位大写代码，例如 CNY')
    else if (key === 'language' && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) invalid(field, '使用语言标签，例如 zh-CN')
    else if ((key === 'platform' || key === 'site' || key === 'contentType') && value.length > 200) invalid(field, '最多 200 个字符')
    context.primaryTarget ??= {}; context.primaryTarget[key] = value
  }
  if (form.widthPx.trim()) {
    const width = Number(form.widthPx)
    if (!/^\d+$/.test(form.widthPx.trim()) || !Number.isInteger(width) || width < 1 || width > 20000) invalid('canvasProfile.widthPx', '填写 1—20000 之间的整数像素')
    else { context.canvasProfile ??= {}; context.canvasProfile.widthPx = width }
  }
  if (form.format) {
    if (!formats.includes(form.format as typeof formats[number])) invalid('canvasProfile.format', '请选择 PNG、JPEG 或 WebP')
    else { context.canvasProfile ??= {}; context.canvasProfile.format = form.format as typeof formats[number] }
  }
  if (form.selectionBasis) {
    if (form.selectionBasis !== 'local_production_policy') invalid('canvasProfile.selectionBasis', '请选择本地制作策略')
    else { context.canvasProfile ??= {}; context.canvasProfile.selectionBasis = 'local_production_policy' }
  }
  if (form.ruleModel === 'legacy-canvas.1' && (form.contentType || form.selectionBasis)) invalid('rulePackRef', '保留了范围规则字段，请切换到按范围核验的目标规则，或明确复核模式转换')
  if (form.rulePackId || form.rulePackVersion) {
    if (!form.rulePackId.trim() || !form.rulePackVersion.trim() || form.rulePackId.length > 200 || form.rulePackVersion.length > 200) invalid('rulePackRef', '请重新选择完整规则版本')
    else context.rulePackRef = { id: form.rulePackId.trim(), version: form.rulePackVersion.trim() }
  }
  return { context, errors }
}

export function selectedRule(context: ContextDraft, rules: StoredRulePack[] | null) {
  return rules?.find(rule => ruleKey(rule) === ruleKey(context.rulePackRef))
}

export function contextReadiness(context: ContextDraft, rules: StoredRulePack[] | null): ContextIssue[] {
  const issues: ContextIssue[] = []
  const add = (field: string, message: string) => issues.push({ field, message })
  for (const key of requiredBriefFields) if (!context.productBrief?.[key]) add(`productBrief.${key}`, `补齐${contextFieldLabel(`productBrief.${key}`)}`)
  for (const key of targetFields) if (!context.primaryTarget?.[key]) add(`primaryTarget.${key}`, `补齐${contextFieldLabel(`primaryTarget.${key}`)}`)
  if (context.canvasProfile?.widthPx === undefined) add('canvasProfile.widthPx', '填写图片宽度')
  if (!context.canvasProfile?.format) add('canvasProfile.format', '选择图片格式')
  if (!context.rulePackRef) add('rulePackRef', '选择已核验的平台规则')
  if (rules === null) { add('catalog', '请先读取已核验的平台规则'); return issues }
  if (!rules.length) { add('catalog', '暂无已核验的平台规则，可先保存草稿；补齐规则后才能启用'); return issues }
  const rule = selectedRule(context, rules)
  if (!rule) {
    if (context.rulePackRef) add('rulePackRef', '所选规则版本不在当前目录中，请重新选择或补齐该版本')
    return issues
  }
  const scoped = isScopedRule(rule)
  if (scoped && !context.primaryTarget?.contentType) add('primaryTarget.contentType', '选择当前规则的内容类型')
  if (scoped && context.canvasProfile?.selectionBasis !== 'local_production_policy') add('canvasProfile.selectionBasis', '明确使用本地制作策略选择画布')
  if (!scoped && (context.primaryTarget?.contentType !== undefined || context.canvasProfile?.selectionBasis !== undefined)) add('rulePackRef', '此草稿含范围规则字段，请选择按范围核验的目标规则')
  for (const key of scoped ? scopedTargetFields : targetFields) {
    const value = context.primaryTarget?.[key]
    const expected = key === 'contentType' ? isScopedRule(rule) ? rule.target.contentType : undefined : rule.target[key]
    if (value && value !== expected) add(`primaryTarget.${key}`, `${contextFieldLabel(`primaryTarget.${key}`)}与规则不匹配，应为 ${key === 'unitSystem' ? expected === 'metric' ? '公制' : '英制' : expected}`)
  }
  if (scoped) {
    const required = requiredScopedRules(rule, { contentType: context.primaryTarget?.contentType, category: context.productBrief?.category })
    if (!required.length) add('rulePackRef', '当前内容类型与产品品类没有适用的启用规则，请补齐已核验规则')
    for (const item of required) if (item.status === 'unknown') add(`rulePackRef.${item.ruleId}`, `${item.name}尚未核验：${item.reason}；${item.recovery}`)
    if (context.canvasProfile?.widthPx !== undefined && !withinBounds(context.canvasProfile.widthPx, rule.localProductionPolicy.canvasWidthPx)) add('canvasProfile.widthPx', `本地画布宽度策略：${describeBounds(rule.localProductionPolicy.canvasWidthPx)}`)
    if (context.canvasProfile?.format && !rule.localProductionPolicy.canvasFormats.includes(context.canvasProfile.format)) add('canvasProfile.format', `本地画布格式：${rule.localProductionPolicy.canvasFormats.map(value => value.toUpperCase()).join('、')}`)
  } else {
    if (context.canvasProfile?.widthPx !== undefined && !rule.allowedWidthsPx.includes(context.canvasProfile.widthPx)) add('canvasProfile.widthPx', `规则允许的图片宽度：${rule.allowedWidthsPx.join('、')} px`)
    if (context.canvasProfile?.format && !rule.allowedFormats.includes(context.canvasProfile.format)) add('canvasProfile.format', `规则允许的图片格式：${rule.allowedFormats.map(value => value.toUpperCase()).join('、')}`)
  }
  return issues
}

export function projectContextBase(project?: Project | null) {
  const state = project?.production?.context
  return {
    initialized: project?.production?.contractVersion === 'production.1', activeVersion: state?.activeVersion ?? null,
    draft: state?.draft ?? null,
    activeContext: state?.versions.find(version => version.version === state.activeVersion)?.context ?? null,
  }
}
export type ContextBase = ReturnType<typeof projectContextBase>
export function contextFormDifferences(left: ContextForm, right: ContextForm): string[] {
  const changes: string[] = []
  for (const key of Object.keys(left) as (keyof ContextForm)[]) {
    if (left[key] === right[key]) continue
    const path = briefFields.includes(key as typeof briefFields[number]) ? `productBrief.${key}` : scopedTargetFields.includes(key as typeof scopedTargetFields[number]) ? `primaryTarget.${key}` : key === 'rulePackId' ? 'rulePackRef.id' : key === 'rulePackVersion' ? 'rulePackRef.version' : key === 'ruleModel' ? 'ruleModel' : `canvasProfile.${key}`
    changes.push(`${contextFieldLabel(path)}：${displayValue(key, left[key])} → ${displayValue(key, right[key])}`)
  }
  return changes
}
export function contextDifferences(before: ContextBase | null, after: ContextBase): string[] {
  if (!before) return ['这份本地草稿没有记录原配置依据，请与当前配置逐项比较。']
  const changes: string[] = []
  if (before.initialized !== after.initialized) changes.push(after.initialized ? '制作配置已开启。' : '制作配置状态已变化。')
  if (before.activeVersion !== after.activeVersion) changes.push(`启用版本：${before.activeVersion ? `P${before.activeVersion}` : '尚无'} → ${after.activeVersion ? `P${after.activeVersion}` : '尚无'}`)
  if (!!before.draft !== !!after.draft) changes.push(after.draft ? '服务端已有配置草稿。' : '服务端草稿已被启用或移除。')
  const left = contextForm(before.draft ?? before.activeContext), right = contextForm(after.draft ?? after.activeContext)
  changes.push(...contextFormDifferences(left, right))
  return [...new Set(changes)]
}

/** Old local inputs inherit new fields only from their recorded base, never the latest server state. */
export function normalizeContextForm(value: unknown, base: ContextBase | null) {
  const old = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const original = contextForm(base?.draft ?? base?.activeContext)
  const form = { ...original }
  for (const key of Object.keys(form) as (keyof ContextForm)[]) if (typeof old[key] === 'string') form[key] = old[key]
  const migration = ['contentType', 'selectionBasis', 'ruleModel'].some(key => typeof old[key] !== 'string')
  if (typeof old.ruleModel !== 'string') form.ruleModel = form.contentType || form.selectionBasis ? 'scoped-rules.1' : form.rulePackId ? 'legacy-canvas.1' : original.ruleModel
  const unsupported = Object.keys(old).filter(key => !(key in form) || typeof old[key] !== 'string')
  return { form, migration, unsupported }
}
