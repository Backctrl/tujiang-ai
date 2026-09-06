import { z } from 'zod';
import { AppError } from './errors.js';
import { canvasProfileSchema, legacyPrimaryTargetSchema, requiredFactSchema, rulePackRefSchema, type CompleteContext } from './production-context-shapes.js';
import { isStorageText } from './production-materials.js';

const identifier = z.string().trim().min(1).max(200).refine(isStorageText, 'Valid Unicode required');
const explanation = z.string().trim().min(1).max(2000).refine(isStorageText, 'Valid Unicode required');
const verifiedTime = z.string().datetime().refine(value => Date.parse(value) <= Date.now(), 'Verification cannot be in the future');
const wholeNumber = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const numericBoundsSchema = z.object({ min: wholeNumber.optional(), max: wholeNumber.optional(), exact: wholeNumber.optional() }).strict()
  .superRefine((bounds, ctx) => {
    if (bounds.min === undefined && bounds.max === undefined && bounds.exact === undefined) ctx.addIssue({ code: 'custom', message: 'At least one numeric bound is required' });
    if (bounds.exact !== undefined && (bounds.min !== undefined || bounds.max !== undefined)) ctx.addIssue({ code: 'custom', message: 'Exact cannot be combined with min or max' });
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) ctx.addIssue({ code: 'custom', message: 'Min cannot exceed max' });
  });
export type NumericBounds = z.infer<typeof numericBoundsSchema>;
const contentScope = z.object({ kind: z.literal('content'), contentType: identifier }).strict();
const moduleScope = z.object({ kind: z.literal('module'), contentType: identifier, moduleType: identifier }).strict();
const imageScope = z.object({ kind: z.literal('image_slot'), contentType: identifier, moduleType: identifier, slotId: identifier }).strict();
const textScope = z.object({ kind: z.literal('text_field'), contentType: identifier, moduleType: identifier, fieldId: identifier }).strict();
export const ruleSubjectScopeSchema = z.discriminatedUnion('kind', [contentScope, moduleScope, imageScope, textScope]);
export const ruleScopeSchema = z.discriminatedUnion('kind', [
  contentScope.extend({ category: identifier.optional() }), moduleScope.extend({ category: identifier.optional() }),
  imageScope.extend({ category: identifier.optional() }), textScope.extend({ category: identifier.optional() }),
]);
export type RuleScope = z.infer<typeof ruleScopeSchema>;
export type RuleSubjectScope = z.infer<typeof ruleSubjectScopeSchema>;
export const ruleSourceSchema = z.object({ id: identifier, title: identifier,
  url: z.string().url().refine(value => new URL(value).protocol === 'https:', 'HTTPS source required'),
  locator: explanation, kind: z.enum(['official_requirement', 'official_example']), verifiedBy: identifier, verifiedAt: verifiedTime }).strict();
export const ruleMeasureSchema = z.enum(['moduleCount', 'imageCount', 'widthPx', 'heightPx', 'bytes', 'textLength', 'format']);
export type RuleMeasure = z.infer<typeof ruleMeasureSchema>;
const measures: Record<RuleSubjectScope['kind'], RuleMeasure[]> = {
  content: ['moduleCount'], module: ['imageCount'], image_slot: ['widthPx', 'heightPx', 'bytes', 'format'], text_field: ['textLength'],
};
const constraintBase = z.object({ ruleId: identifier, name: identifier, description: explanation,
  scope: ruleScopeSchema, severity: z.enum(['warning', 'blocker']), measure: ruleMeasureSchema });
export const scopedConstraintSchema = z.discriminatedUnion('status', [
  constraintBase.extend({ status: z.literal('verified'), sourceIds: z.array(identifier).min(1).max(20),
    constraint: z.union([numericBoundsSchema.safeExtend({ kind: z.literal('numeric') }),
      z.object({ kind: z.literal('formats'), allowed: z.array(identifier).min(1).max(30), exhaustive: z.boolean() }).strict()]) }).strict(),
  constraintBase.extend({ status: z.literal('unknown'), reason: explanation, recovery: explanation }).strict(),
]).superRefine((rule, ctx) => {
  if (!measures[rule.scope.kind].includes(rule.measure)) ctx.addIssue({ code: 'custom', path: ['measure'], message: 'Measure does not belong to this scope kind' });
  if (rule.status === 'unknown') {
    if (rule.severity !== 'blocker') ctx.addIssue({ code: 'custom', path: ['severity'], message: 'Unknown constraints must block' });
    return;
  }
  if ((rule.measure === 'format') !== (rule.constraint.kind === 'formats')) ctx.addIssue({ code: 'custom', path: ['constraint'], message: 'Measure and constraint type disagree' });
  if (new Set(rule.sourceIds).size !== rule.sourceIds.length) ctx.addIssue({ code: 'custom', path: ['sourceIds'], message: 'Duplicate sources' });
  if (rule.constraint.kind === 'formats' && new Set(rule.constraint.allowed).size !== rule.constraint.allowed.length)
    ctx.addIssue({ code: 'custom', path: ['constraint', 'allowed'], message: 'Duplicate formats' });
});
export type ScopedConstraint = z.infer<typeof scopedConstraintSchema>;
export const localProductionPolicySchema = z.object({ description: explanation, canvasWidthPx: numericBoundsSchema,
  canvasFormats: z.array(canvasProfileSchema.shape.format).min(1),
  exportFormats: z.array(z.enum(['html', 'png', 'jpeg', 'webp', 'pdf'])).min(1),
  maxExportImageBytes: wholeNumber.positive().optional() }).strict().superRefine((policy, ctx) => {
  if (Object.values(policy.canvasWidthPx).some(value => value < 1 || value > 20000)) ctx.addIssue({ code: 'custom', path: ['canvasWidthPx'], message: 'Canvas bounds must fit the local renderer range 1-20000' });
  for (const field of ['canvasFormats', 'exportFormats'] as const)
    if (new Set(policy[field]).size !== policy[field].length) ctx.addIssue({ code: 'custom', path: [field], message: 'Duplicate local choices' });
});
export const scopedRulePackSchema = rulePackRefSchema.extend({ schemaVersion: z.literal('scoped-rules.1'), name: identifier, description: explanation,
  target: legacyPrimaryTargetSchema.extend({ contentType: identifier }).strict(),
  publication: z.object({ status: z.literal('admin_verified'), recordId: identifier, actor: identifier, at: verifiedTime }).strict(),
  sources: z.array(ruleSourceSchema).min(1).max(200), constraints: z.array(scopedConstraintSchema).min(1).max(2000),
  activationRequirements: z.array(identifier).min(1).max(2000), localProductionPolicy: localProductionPolicySchema,
  requiredFacts: z.array(requiredFactSchema),
}).strict().superRefine((pack, ctx) => {
  const unique = { sources: pack.sources.map(source => source.id), constraints: pack.constraints.map(rule => rule.ruleId),
    activationRequirements: pack.activationRequirements, requiredFacts: pack.requiredFacts.map(fact => fact.key) };
  for (const [field, values] of Object.entries(unique)) if (new Set(values).size !== values.length)
    ctx.addIssue({ code: 'custom', path: [field], message: 'Duplicate identities' });
  for (const [index, rule] of pack.constraints.entries()) {
    if (rule.status !== 'verified') continue;
    const sources = rule.sourceIds.map(id => pack.sources.find(source => source.id === id));
    if (sources.some(source => !source)) ctx.addIssue({ code: 'custom', path: ['constraints', index, 'sourceIds'], message: 'Source is not in this rule pack' });
    if (rule.constraint.kind === 'formats' && rule.constraint.exhaustive && sources.some(source => source?.kind === 'official_example'))
      ctx.addIssue({ code: 'custom', path: ['constraints', index, 'constraint'], message: 'Examples do not prove an exhaustive format list' });
    if (rule.constraint.kind === 'numeric' && !sources.some(source => source?.kind === 'official_requirement'))
      ctx.addIssue({ code: 'custom', path: ['constraints', index, 'sourceIds'], message: 'Numeric limits require an official requirement source' });
  }
  if (pack.activationRequirements.some(id => !pack.constraints.some(rule => rule.ruleId === id)))
    ctx.addIssue({ code: 'custom', path: ['activationRequirements'], message: 'Required rule is missing' });
});
export type ScopedRulePack = z.infer<typeof scopedRulePackSchema>;
function applicable(rule: ScopedConstraint, contentType: string, category: string) {
  return rule.scope.contentType === contentType && (rule.scope.category === undefined || rule.scope.category === category);
}
export function numericFailure(value: number, bounds: NumericBounds): 'BELOW_MINIMUM' | 'ABOVE_MAXIMUM' | 'NOT_EXACT' | undefined {
  if (bounds.exact !== undefined && value !== bounds.exact) return 'NOT_EXACT';
  if (bounds.min !== undefined && value < bounds.min) return 'BELOW_MINIMUM';
  if (bounds.max !== undefined && value > bounds.max) return 'ABOVE_MAXIMUM';
}
export function validateScopedContext(context: CompleteContext, pack: ScopedRulePack): void {
  if (!context.primaryTarget.contentType) throw new AppError('SCOPED_CONTENT_TYPE_REQUIRED', 409, { fields: ['primaryTarget.contentType'] });
  if (context.canvasProfile.selectionBasis !== 'local_production_policy')
    throw new AppError('LOCAL_PRODUCTION_SELECTION_REQUIRED', 409, { fields: ['canvasProfile.selectionBasis'] });
  const required = pack.constraints.filter(rule => pack.activationRequirements.includes(rule.ruleId)
    && applicable(rule, context.primaryTarget.contentType!, context.productBrief.category));
  const unknown = required.filter(rule => rule.status === 'unknown');
  if (!required.length || unknown.length) throw new AppError('RULE_PACK_INCOMPLETE', 409, { fields: ['rulePackRef'],
    blockers: unknown.length ? unknown.map(rule => ({ ruleId: rule.ruleId, scope: rule.scope, measure: rule.measure,
      reason: rule.status === 'unknown' ? rule.reason : '', recovery: rule.status === 'unknown' ? rule.recovery : '' }))
      : [{ code: 'NO_APPLICABLE_ACTIVATION_RULE', recovery: '管理员补齐当前内容类型和品类适用的已核验启用规则。' }] });
  const policy = pack.localProductionPolicy;
  const fields = [...(numericFailure(context.canvasProfile.widthPx, policy.canvasWidthPx) ? ['canvasProfile.widthPx'] : []),
    ...(!policy.canvasFormats.includes(context.canvasProfile.format) ? ['canvasProfile.format'] : [])];
  if (fields.length) throw new AppError('CANVAS_OUTSIDE_LOCAL_PRODUCTION_POLICY', 409, { fields, basis: 'local_production_policy' });
}

const valuesByKind = {
  content: z.object({ moduleCount: wholeNumber.optional() }).strict(),
  module: z.object({ imageCount: wholeNumber.optional() }).strict(),
  image_slot: z.object({ widthPx: wholeNumber.positive().optional(), heightPx: wholeNumber.positive().optional(), bytes: wholeNumber.optional(), format: identifier.optional() }).strict(),
  text_field: z.object({ text: z.string().max(20000).refine(isStorageText, 'Valid Unicode required').optional() }).strict(),
};
export const ruleCheckSubjectSchema = z.object({ id: identifier, scope: ruleSubjectScopeSchema,
  values: z.object({ moduleCount: wholeNumber.optional(), imageCount: wholeNumber.optional(), widthPx: wholeNumber.positive().optional(),
    heightPx: wholeNumber.positive().optional(), bytes: wholeNumber.optional(), format: identifier.optional(),
    text: z.string().max(20000).refine(isStorageText, 'Valid Unicode required').optional() }).strict(),
}).strict().superRefine((subject, ctx) => {
  const result = valuesByKind[subject.scope.kind].safeParse(subject.values);
  if (!result.success || !Object.values(subject.values).some(value => value !== undefined))
    ctx.addIssue({ code: 'custom', path: ['values'], message: 'Provide at least one measurement belonging to this scope kind' });
});
export const ruleCheckSchema = z.object({ contextVersion: z.number().int().positive(), subjects: z.array(ruleCheckSubjectSchema).min(1).max(100) }).strict()
  .superRefine((input, ctx) => {
    if (new Set(input.subjects.map(subject => subject.id)).size !== input.subjects.length) ctx.addIssue({ code: 'custom', path: ['subjects'], message: 'Subject ids must be unique' });
  });
export type RuleCheckInput = z.infer<typeof ruleCheckSchema>;
export interface RuleFinding {
  subjectId: string; scope: RuleSubjectScope; measure?: RuleMeasure; ruleId?: string; severity: 'warning' | 'blocker';
  code: string; sourceIds: string[]; recovery: string; actual?: number | string;
  expected?: NumericBounds | { allowed: string[]; exhaustive: boolean };
}
function sameScope(rule: RuleScope, subject: RuleSubjectScope): boolean {
  if (rule.kind !== subject.kind || rule.contentType !== subject.contentType) return false;
  if ('moduleType' in rule && (!('moduleType' in subject) || rule.moduleType !== subject.moduleType)) return false;
  if ('slotId' in rule && (!('slotId' in subject) || rule.slotId !== subject.slotId)) return false;
  return !('fieldId' in rule) || ('fieldId' in subject && rule.fieldId === subject.fieldId);
}
export function checkScopedRuleInputs(pack: ScopedRulePack, context: CompleteContext, input: RuleCheckInput): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const subject of input.subjects) {
    const common = { subjectId: subject.id, scope: subject.scope };
    if (subject.scope.contentType !== pack.target.contentType || subject.scope.contentType !== context.primaryTarget.contentType) {
      findings.push({ ...common, code: 'RULE_SCOPE_OUTSIDE_TARGET', severity: 'blocker', sourceIds: [], recovery: '使用该 P 版本的内容类型，其他目标需单独绑定已核验规则。' });
      continue;
    }
    const matching = pack.constraints.filter(rule => sameScope(rule.scope, subject.scope) && applicable(rule, subject.scope.contentType, context.productBrief.category));
    const values: Partial<Record<RuleMeasure, number | string>> = { ...subject.values };
    delete (values as Record<string, unknown>).text;
    if (subject.values.text !== undefined) values.textLength = [...subject.values.text].length;
    const checkedMeasures = new Set([...Object.keys(values) as RuleMeasure[], ...matching.map(rule => rule.measure)]);
    for (const measure of checkedMeasures) {
      const rules = matching.filter(rule => rule.measure === measure);
      if (!rules.length) {
        findings.push({ ...common, measure, code: 'RULE_COVERAGE_MISSING', severity: 'blocker', sourceIds: [], recovery: '管理员补齐这个内容类型、模块、槽或字段的已核验约束。' });
        continue;
      }
      for (const rule of rules) {
        const base = { ...common, measure, ruleId: rule.ruleId, sourceIds: rule.status === 'verified' ? rule.sourceIds : [] };
        if (rule.status === 'unknown') {
          findings.push({ ...base, code: 'RULE_CONSTRAINT_UNKNOWN', severity: 'blocker', recovery: rule.recovery }); continue;
        }
        const actual = values[measure];
        if (actual === undefined) {
          findings.push({ ...base, code: 'RULE_INPUT_MISSING', severity: 'blocker', recovery: '补齐该规则所需的实际测量值后重新检查。' }); continue;
        }
        if (rule.constraint.kind === 'numeric') {
          const { kind: _kind, ...expected } = rule.constraint;
          const code = numericFailure(Number(actual), expected);
          if (code) findings.push({ ...base, code, severity: rule.severity, actual, expected, recovery: '按此范围内的数值边界调整当前输入后重新检查。' });
        } else if (!rule.constraint.allowed.includes(String(actual))) {
          findings.push({ ...base, code: rule.constraint.exhaustive ? 'FORMAT_NOT_ALLOWED' : 'FORMAT_SUPPORT_UNKNOWN',
            severity: rule.constraint.exhaustive ? rule.severity : 'blocker', actual,
            expected: { allowed: rule.constraint.allowed, exhaustive: rule.constraint.exhaustive },
            recovery: rule.constraint.exhaustive ? '使用此范围内已允许的图片格式。' : '使用已核验格式子集，或由管理员补齐所选格式的官方依据。' });
        }
      }
    }
  }
  return findings;
}
