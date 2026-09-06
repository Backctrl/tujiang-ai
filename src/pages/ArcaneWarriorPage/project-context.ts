import type { ContextDraft, PrimaryTarget, RulePack } from '../../../backend/src/production-context.js'
import type { Project } from '../../../backend/src/contracts.js'

export const briefFields = ['productName', 'internalCode', 'category', 'stage', 'introduction', 'commercialIntent'] as const
export const targetFields = ['platform', 'site', 'country', 'language', 'currency', 'unitSystem'] as const
export type ContextForm = Record<typeof briefFields[number] | typeof targetFields[number] | 'widthPx' | 'format' | 'rulePackId' | 'rulePackVersion', string>
export type ContextIssue = { field: string; message: string }
const labels: Record<string, string> = {
  context: '制作配置', productBrief: '产品基础信息', primaryTarget: '目标市场', canvasProfile: '页面尺寸', rulePackRef: '已核验的平台规则',
  'productBrief.productName': '产品名称', 'productBrief.internalCode': '内部代号', 'productBrief.category': '产品品类',
  'productBrief.stage': '产品阶段', 'productBrief.introduction': '产品介绍', 'productBrief.commercialIntent': '商业目标',
  'primaryTarget.platform': '首发平台', 'primaryTarget.site': '站点', 'primaryTarget.country': '国家 / 地区代码',
  'primaryTarget.language': '目标语言', 'primaryTarget.currency': '货币', 'primaryTarget.unitSystem': '计量单位',
  'canvasProfile.widthPx': '图片宽度', 'canvasProfile.format': '图片格式', 'rulePackRef.id': '平台规则', 'rulePackRef.version': '平台规则版本', catalog: '平台规则目录',
}
export function contextFieldLabel(path: string) { return labels[path.replace(/^context\./, '')] ?? path }
function displayValue(field: keyof ContextForm, value: string) {
  if (!value) return '未填写'
  if (field === 'unitSystem') return value === 'metric' ? '公制' : value === 'imperial' ? '英制' : value
  return field === 'format' ? value.toUpperCase() : value
}
const formats = ['png', 'jpeg', 'webp'] as const

export function contextForm(context?: ContextDraft | null): ContextForm {
  return {
    productName: context?.productBrief?.productName ?? '', internalCode: context?.productBrief?.internalCode ?? '',
    category: context?.productBrief?.category ?? '', stage: context?.productBrief?.stage ?? '',
    introduction: context?.productBrief?.introduction ?? '', commercialIntent: context?.productBrief?.commercialIntent ?? '',
    platform: context?.primaryTarget?.platform ?? '', site: context?.primaryTarget?.site ?? '', country: context?.primaryTarget?.country ?? '',
    language: context?.primaryTarget?.language ?? '', currency: context?.primaryTarget?.currency ?? '', unitSystem: context?.primaryTarget?.unitSystem ?? '',
    widthPx: context?.canvasProfile?.widthPx === undefined ? '' : String(context.canvasProfile.widthPx), format: context?.canvasProfile?.format ?? '',
    rulePackId: context?.rulePackRef?.id ?? '', rulePackVersion: context?.rulePackRef?.version ?? '',
  }
}

/** Empty controls are omitted: the server replaces the complete draft instead of merging it. */
export function compileContextForm(form: ContextForm): { context: ContextDraft; errors: ContextIssue[] } {
  const context: ContextDraft = {}, errors: ContextIssue[] = []
  const invalid = (field: string, message: string) => errors.push({ field, message: `${contextFieldLabel(field)}：${message}` })
  for (const key of briefFields) {
    const value = form[key].trim()
    if (!value) continue
    const max = key === 'introduction' ? 10000 : key === 'commercialIntent' ? 2000 : 200
    if (value.length > max) invalid(`productBrief.${key}`, `最多 ${max} 个字符`)
    context.productBrief ??= {}; context.productBrief[key] = value
  }
  for (const key of targetFields) {
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
    else if ((key === 'platform' || key === 'site') && value.length > 200) invalid(field, '最多 200 个字符')
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
  if (form.rulePackId || form.rulePackVersion) {
    if (!form.rulePackId.trim() || !form.rulePackVersion.trim() || form.rulePackId.length > 200 || form.rulePackVersion.length > 200) invalid('rulePackRef', '请重新选择完整规则版本')
    else context.rulePackRef = { id: form.rulePackId.trim(), version: form.rulePackVersion.trim() }
  }
  return { context, errors }
}

export function ruleKey(rule?: { id: string; version: string }) { return rule ? JSON.stringify([rule.id, rule.version]) : '' }
export function selectedRule(context: ContextDraft, rules: RulePack[] | null) {
  return rules?.find(rule => ruleKey(rule) === ruleKey(context.rulePackRef))
}

export function contextReadiness(context: ContextDraft, rules: RulePack[] | null): ContextIssue[] {
  const issues: ContextIssue[] = []
  const add = (field: string, message: string) => issues.push({ field, message })
  for (const key of briefFields) if (!context.productBrief?.[key]) add(`productBrief.${key}`, `补齐${contextFieldLabel(`productBrief.${key}`)}`)
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
  for (const key of targetFields) {
    const value = context.primaryTarget?.[key]
    if (value && value !== rule.target[key]) add(`primaryTarget.${key}`, `${contextFieldLabel(`primaryTarget.${key}`)}与规则不匹配，应为 ${key === 'unitSystem' ? rule.target[key] === 'metric' ? '公制' : '英制' : rule.target[key]}`)
  }
  if (context.canvasProfile?.widthPx !== undefined && !rule.allowedWidthsPx.includes(context.canvasProfile.widthPx)) add('canvasProfile.widthPx', `规则允许的图片宽度：${rule.allowedWidthsPx.join('、')} px`)
  if (context.canvasProfile?.format && !rule.allowedFormats.includes(context.canvasProfile.format)) add('canvasProfile.format', `规则允许的图片格式：${rule.allowedFormats.map(value => value.toUpperCase()).join('、')}`)
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
export function contextDifferences(before: ContextBase | null, after: ContextBase): string[] {
  if (!before) return ['这份本地草稿没有记录原配置依据，请与当前配置逐项比较。']
  const changes: string[] = []
  if (before.initialized !== after.initialized) changes.push(after.initialized ? '制作配置已开启。' : '制作配置状态已变化。')
  if (before.activeVersion !== after.activeVersion) changes.push(`启用版本：${before.activeVersion ? `P${before.activeVersion}` : '尚无'} → ${after.activeVersion ? `P${after.activeVersion}` : '尚无'}`)
  if (!!before.draft !== !!after.draft) changes.push(after.draft ? '服务端已有配置草稿。' : '服务端草稿已被启用或移除。')
  const left = contextForm(before.draft ?? before.activeContext), right = contextForm(after.draft ?? after.activeContext)
  for (const key of Object.keys(left) as (keyof ContextForm)[]) {
    if (left[key] === right[key]) continue
    const path = briefFields.includes(key as typeof briefFields[number]) ? `productBrief.${key}` : targetFields.includes(key as typeof targetFields[number]) ? `primaryTarget.${key}` : key === 'rulePackId' ? 'rulePackRef.id' : key === 'rulePackVersion' ? 'rulePackRef.version' : `canvasProfile.${key}`
    changes.push(`${contextFieldLabel(path)}：${displayValue(key, left[key])} → ${displayValue(key, right[key])}`)
  }
  return [...new Set(changes)]
}

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function nonempty(value: unknown): value is string { return typeof value === 'string' && !!value.trim() }
/** Guard the browser-facing catalog without importing server modules that use node:crypto/fs. */
export function isRuleCatalog(value: unknown): value is { contractVersion: 'production.1'; rulePacks: RulePack[] } {
  if (!object(value) || value.contractVersion !== 'production.1' || !Array.isArray(value.rulePacks)) return false
  const valid = value.rulePacks.every(rule => {
    if (!object(rule) || !nonempty(rule.id) || !nonempty(rule.version) || !nonempty(rule.verifiedBy) || !nonempty(rule.verifiedAt) || !Number.isFinite(Date.parse(rule.verifiedAt))) return false
    try { if (new URL(String(rule.officialUrl)).protocol !== 'https:') return false } catch { return false }
    if (!object(rule.target) || !targetFields.every(key => nonempty((rule.target as Record<string, unknown>)[key]))) return false
    const target = rule.target as PrimaryTarget
    if (!/^[A-Z]{2}$/.test(target.country) || !/^[A-Z]{3}$/.test(target.currency) || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(target.language) || !['metric', 'imperial'].includes(target.unitSystem)) return false
    if (!Array.isArray(rule.allowedWidthsPx) || !rule.allowedWidthsPx.length || !rule.allowedWidthsPx.every(width => Number.isInteger(width) && width >= 1 && width <= 20000)) return false
    if (!Array.isArray(rule.allowedFormats) || !rule.allowedFormats.length || !rule.allowedFormats.every(format => formats.includes(format))) return false
    if (!Array.isArray(rule.requiredFacts) || !rule.requiredFacts.every(fact => object(fact) && nonempty(fact.key) && nonempty(fact.description) && typeof fact.allowUnknown === 'boolean' && typeof fact.allowNotApplicable === 'boolean')) return false
    return true
  })
  return valid && new Set(value.rulePacks.map(rule => ruleKey(rule))).size === value.rulePacks.length
}
