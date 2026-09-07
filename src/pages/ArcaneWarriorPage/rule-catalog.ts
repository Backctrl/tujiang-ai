import type { LegacyRulePack, PrimaryTarget, ScopedRulePack, StoredRulePack } from '../../../backend/src/production-context.js'
import type { NumericBounds, RuleScope, ScopedConstraint } from '../../../backend/src/production-rules.js'

export type RuleCatalog = { contractVersion: 'production.1'; rulePacks: LegacyRulePack[]; scopedRulePacks: ScopedRulePack[] }
export type RuleModel = 'legacy-canvas.1' | 'scoped-rules.1'
export const legacyTargetFields = ['platform', 'site', 'country', 'language', 'currency', 'unitSystem'] as const
export const canvasFormats = ['png', 'jpeg', 'webp'] as const
export const ruleKey = (rule?: { id: string; version: string }) => rule ? JSON.stringify([rule.id, rule.version]) : ''
export const isScopedRule = (rule: StoredRulePack): rule is ScopedRulePack => 'schemaVersion' in rule && rule.schemaVersion === 'scoped-rules.1'
export const ruleModel = (rule: StoredRulePack): RuleModel => isScopedRule(rule) ? 'scoped-rules.1' : 'legacy-canvas.1'
export const modelLabel = (model: RuleModel) => model === 'scoped-rules.1' ? '按范围核验的目标规则' : '旧版画布规则'
export function withinBounds(value: number, bounds: NumericBounds) {
  return (bounds.exact === undefined || value === bounds.exact) && (bounds.min === undefined || value >= bounds.min) && (bounds.max === undefined || value <= bounds.max)
}
export function describeBounds(bounds: NumericBounds, unit = 'px') {
  return bounds.exact !== undefined ? `精确 ${bounds.exact} ${unit}` : [bounds.min !== undefined ? `至少 ${bounds.min} ${unit}` : '', bounds.max !== undefined ? `至多 ${bounds.max} ${unit}` : ''].filter(Boolean).join('，')
}
export function scopeLabel(scope: RuleScope) {
  const path = [scope.contentType, ...('moduleType' in scope ? [scope.moduleType] : []), ...('slotId' in scope ? [scope.slotId] : 'fieldId' in scope ? [scope.fieldId] : [])].join(' / ')
  return `${{ content: '整份内容', module: '模块', image_slot: '图片槽', text_field: '文字字段' }[scope.kind]} · ${path}${scope.category ? ` · 品类 ${scope.category}` : ''}`
}
export function constraintLabel(rule: ScopedConstraint) {
  if (rule.status === 'unknown') return `尚未核验：${rule.reason}`
  if (rule.constraint.kind === 'formats') return `${rule.constraint.exhaustive ? '完整允许格式' : '已知可用格式子集'}：${rule.constraint.allowed.map(value => value.toUpperCase()).join('、')}${rule.constraint.exhaustive ? '' : '；其它格式支持情况未核验'}`
  const measures = { moduleCount: ['模块数量', '个'], imageCount: ['图片数量', '张'], widthPx: ['宽度', 'px'], heightPx: ['高度', 'px'], bytes: ['文件大小', '字节'], textLength: ['文字长度', 'Unicode 字符'], format: ['格式', ''] }
  return `${measures[rule.measure][0]}：${describeBounds(rule.constraint, measures[rule.measure][1])}`
}
export function requiredScopedRules(rule: ScopedRulePack, context: { contentType?: string; category?: string }) {
  return rule.constraints.filter(item => rule.activationRequirements.includes(item.ruleId) && item.scope.contentType === context.contentType && (!item.scope.category || item.scope.category === context.category))
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))
const unique = (values: unknown[]) => new Set(values).size === values.length
const strings = (value: unknown, max = Infinity): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= max && value.every(nonempty) && unique(value)
const time = (value: unknown) => nonempty(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now()
function https(value: unknown) { try { return typeof value === 'string' && new URL(value).protocol === 'https:' } catch { return false } }
function target(value: unknown, scoped = false): value is PrimaryTarget {
  if (!object(value) || !keys(value, [...legacyTargetFields, ...(scoped ? ['contentType'] : [])]) || !legacyTargetFields.every(key => nonempty(value[key]))) return false
  return /^[A-Z]{2}$/.test(String(value.country)) && /^[A-Z]{3}$/.test(String(value.currency)) && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(String(value.language)) && ['metric', 'imperial'].includes(String(value.unitSystem)) && (!scoped || nonempty(value.contentType))
}
function facts(value: unknown) {
  return Array.isArray(value) && value.every(fact => object(fact) && keys(fact, ['key', 'description', 'allowUnknown', 'allowNotApplicable']) && nonempty(fact.key) && nonempty(fact.description) && typeof fact.allowUnknown === 'boolean' && typeof fact.allowNotApplicable === 'boolean') && unique(value.map(fact => fact.key))
}
function bounds(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER, constraint = false): value is NumericBounds {
  if (!object(value) || !keys(value, ['min', 'max', 'exact', ...(constraint ? ['kind'] : [])])) return false
  const numbers = ['min', 'max', 'exact'].filter(key => value[key] !== undefined)
  return numbers.length > 0 && numbers.every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= min && Number(value[key]) <= max) && !(value.exact !== undefined && numbers.length > 1) && !(value.min !== undefined && value.max !== undefined && Number(value.min) > Number(value.max))
}
function legacy(value: unknown): value is LegacyRulePack {
  return object(value) && keys(value, ['id', 'version', 'officialUrl', 'verifiedBy', 'verifiedAt', 'target', 'allowedWidthsPx', 'allowedFormats', 'requiredFacts']) && nonempty(value.id) && nonempty(value.version) && nonempty(value.verifiedBy) && time(value.verifiedAt) && https(value.officialUrl) && target(value.target)
    && Array.isArray(value.allowedWidthsPx) && value.allowedWidthsPx.length > 0 && unique(value.allowedWidthsPx) && value.allowedWidthsPx.every(width => Number.isInteger(width) && width >= 1 && width <= 20000)
    && strings(value.allowedFormats) && value.allowedFormats.every(format => canvasFormats.includes(format as typeof canvasFormats[number])) && facts(value.requiredFacts)
}
function scoped(value: unknown): value is ScopedRulePack {
  if (!object(value) || !keys(value, ['schemaVersion', 'id', 'version', 'name', 'description', 'target', 'publication', 'sources', 'constraints', 'activationRequirements', 'localProductionPolicy', 'requiredFacts']) || value.schemaVersion !== 'scoped-rules.1' || !nonempty(value.id) || !nonempty(value.version) || !nonempty(value.name) || !nonempty(value.description) || !target(value.target, true) || !facts(value.requiredFacts)) return false
  const publication = value.publication, policy = value.localProductionPolicy
  if (!object(publication) || !keys(publication, ['status', 'recordId', 'actor', 'at']) || publication.status !== 'admin_verified' || !nonempty(publication.recordId) || !nonempty(publication.actor) || !time(publication.at)) return false
  if (!object(policy) || !keys(policy, ['description', 'canvasWidthPx', 'canvasFormats', 'exportFormats', 'maxExportImageBytes']) || !nonempty(policy.description) || !bounds(policy.canvasWidthPx, 1, 20000)
    || !strings(policy.canvasFormats) || !policy.canvasFormats.every(format => canvasFormats.includes(format as typeof canvasFormats[number])) || !strings(policy.exportFormats) || !policy.exportFormats.every(format => ['html', ...canvasFormats, 'pdf'].includes(format))
    || (policy.maxExportImageBytes !== undefined && (!Number.isSafeInteger(policy.maxExportImageBytes) || Number(policy.maxExportImageBytes) <= 0))) return false
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 200 || !value.sources.every(source => object(source) && keys(source, ['id', 'title', 'url', 'locator', 'kind', 'verifiedBy', 'verifiedAt']) && nonempty(source.id) && nonempty(source.title) && https(source.url) && nonempty(source.locator) && ['official_requirement', 'official_example'].includes(String(source.kind)) && nonempty(source.verifiedBy) && time(source.verifiedAt)) || !unique(value.sources.map(source => source.id))) return false
  const sources = value.sources as ScopedRulePack['sources']
  if (!Array.isArray(value.constraints) || !value.constraints.length || value.constraints.length > 2000 || !value.constraints.every(item => {
    if (!object(item) || !nonempty(item.ruleId) || !nonempty(item.name) || !nonempty(item.description) || !['warning', 'blocker'].includes(String(item.severity)) || !object(item.scope)) return false
    const scope = item.scope, scopeFields: Record<string, string[]> = { content: [], module: ['moduleType'], image_slot: ['moduleType', 'slotId'], text_field: ['moduleType', 'fieldId'] }
    const measures: Record<string, string[]> = { content: ['moduleCount'], module: ['imageCount'], image_slot: ['widthPx', 'heightPx', 'bytes', 'format'], text_field: ['textLength'] }
    const fields = scopeFields[String(scope.kind)]
    if (!fields || !keys(scope, ['kind', 'contentType', 'category', ...fields]) || !nonempty(scope.contentType) || !fields.every(field => nonempty(scope[field])) || (scope.category !== undefined && !nonempty(scope.category)) || !measures[String(scope.kind)]?.includes(String(item.measure))) return false
    const base = ['ruleId', 'name', 'description', 'scope', 'severity', 'measure', 'status']
    if (item.status === 'unknown') return keys(item, [...base, 'reason', 'recovery']) && item.severity === 'blocker' && nonempty(item.reason) && nonempty(item.recovery)
    if (item.status !== 'verified' || !keys(item, [...base, 'sourceIds', 'constraint']) || !strings(item.sourceIds, 20) || !item.sourceIds.every(id => sources.some(source => source.id === id)) || !object(item.constraint)) return false
    const constraint = item.constraint, linked = sources.filter(source => (item.sourceIds as string[]).includes(source.id))
    if (item.measure === 'format') return constraint.kind === 'formats' && keys(constraint, ['kind', 'allowed', 'exhaustive']) && strings(constraint.allowed, 30) && typeof constraint.exhaustive === 'boolean' && (!constraint.exhaustive || linked.every(source => source.kind !== 'official_example'))
    return constraint.kind === 'numeric' && bounds(constraint, 0, Number.MAX_SAFE_INTEGER, true) && linked.some(source => source.kind === 'official_requirement')
  }) || !unique(value.constraints.map(item => item.ruleId))) return false
  return strings(value.activationRequirements, 2000) && value.activationRequirements.every(id => (value.constraints as ScopedRulePack['constraints']).some(item => item.ruleId === id))
}
/** Browser-only guard; the server schemas remain authoritative and never enter the browser bundle. */
export function isRuleCatalog(value: unknown): value is Omit<RuleCatalog, 'scopedRulePacks'> & { scopedRulePacks?: ScopedRulePack[] } {
  if (!object(value) || !keys(value, ['contractVersion', 'rulePacks', 'scopedRulePacks']) || value.contractVersion !== 'production.1' || !Array.isArray(value.rulePacks) || !value.rulePacks.every(legacy)) return false
  if (value.scopedRulePacks !== undefined && (!Array.isArray(value.scopedRulePacks) || !value.scopedRulePacks.every(scoped))) return false
  const all = [...value.rulePacks, ...(value.scopedRulePacks as ScopedRulePack[] | undefined ?? [])]
  return unique(all.map(ruleKey))
}
