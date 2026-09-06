import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { Production } from './production.js';

const label = z.string().trim().min(1).max(200);
export const productBriefSchema = z.object({ productName: label, internalCode: label, category: label, stage: label,
  introduction: z.string().trim().min(1).max(10000), commercialIntent: z.string().trim().min(1).max(2000) }).strict();
export const primaryTargetSchema = z.object({ platform: label, site: label,
  country: z.string().regex(/^[A-Z]{2}$/), language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  currency: z.string().regex(/^[A-Z]{3}$/), unitSystem: z.enum(['metric', 'imperial']) }).strict();
export const canvasProfileSchema = z.object({ widthPx: z.number().int().min(1).max(20000), format: z.enum(['png', 'jpeg', 'webp']) }).strict();
export const rulePackRefSchema = z.object({ id: label, version: label }).strict();
export const rulePackSchema = rulePackRefSchema.extend({
  officialUrl: z.string().url().refine(value => new URL(value).protocol === 'https:', 'HTTPS source required'),
  verifiedAt: z.string().datetime().refine(value => Date.parse(value) <= Date.now(), 'Verification cannot be in the future'),
  verifiedBy: label,
  target: primaryTargetSchema,
  allowedWidthsPx: z.array(z.number().int().min(1).max(20000)).min(1),
  allowedFormats: z.array(canvasProfileSchema.shape.format).min(1),
  requiredFacts: z.array(z.object({ key: label, description: z.string().trim().min(1).max(1000),
    allowUnknown: z.boolean(), allowNotApplicable: z.boolean() }).strict()),
}).strict().superRefine((rule, ctx) => {
  const uniqueFields = {
    allowedWidthsPx: rule.allowedWidthsPx,
    allowedFormats: rule.allowedFormats,
    requiredFacts: rule.requiredFacts.map(fact => fact.key),
  };
  for (const [field, values] of Object.entries(uniqueFields)) {
    if (new Set<string | number>(values).size !== values.length) ctx.addIssue({ code: 'custom', path: [field], message: 'Duplicate rule values' });
  }
});
export const productionCatalogSchema = z.object({ rulePacks: z.array(rulePackSchema) }).strict().superRefine((catalog, ctx) => {
  const keys = catalog.rulePacks.map(rule => JSON.stringify([rule.id, rule.version]));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'Duplicate rule pack identity' });
});
export const contextDraftSchema = z.object({ productBrief: productBriefSchema.partial().optional(),
  primaryTarget: primaryTargetSchema.partial().optional(), canvasProfile: canvasProfileSchema.partial().optional(),
  rulePackRef: rulePackRefSchema.optional() }).strict();
export const completeContextSchema = z.object({ productBrief: productBriefSchema, primaryTarget: primaryTargetSchema,
  canvasProfile: canvasProfileSchema, rulePackRef: rulePackRefSchema }).strict();
export type ProductBrief = z.infer<typeof productBriefSchema>;
export type PrimaryTarget = z.infer<typeof primaryTargetSchema>;
export type CanvasProfile = z.infer<typeof canvasProfileSchema>;
export type RulePackRef = z.infer<typeof rulePackRefSchema>;
export type RulePack = z.infer<typeof rulePackSchema>;
export type ProductionCatalog = z.infer<typeof productionCatalogSchema>;
export type ContextDraft = z.infer<typeof contextDraftSchema>;
export type CompleteContext = z.infer<typeof completeContextSchema>;
export interface ProjectContextVersion {
  version: number; label: string; context: CompleteContext;
  rulePack: RulePack; rulePackSha256: string; activatedBy: string; activatedAt: string;
}
export interface ProjectContext {
  draft?: ContextDraft; versions: ProjectContextVersion[]; activeVersion?: number;
}
export async function loadProductionCatalog(path?: string): Promise<ProductionCatalog> {
  return productionCatalogSchema.parse(path ? JSON.parse(await readFile(path, 'utf8')) : { rulePacks: [] });
}
export function saveContextDraft(production: Production, draft: ContextDraft): void {
  production.context ??= { versions: [] };
  production.context.draft = structuredClone(contextDraftSchema.parse(draft));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function activateContext(production: Production, catalog: ProductionCatalog, actor: string): void {
  const parsed = completeContextSchema.safeParse(production.context?.draft);
  if (!parsed.success) throw new AppError('PRODUCTION_CONTEXT_INCOMPLETE', 409,
    { fields: parsed.error.issues.map(issue => issue.path.join('.') || 'context') });
  const context = parsed.data;
  const rulePack = catalog.rulePacks.find(rule => rule.id === context.rulePackRef.id && rule.version === context.rulePackRef.version);
  if (!rulePack) throw new AppError('RULE_PACK_UNAVAILABLE', 409, { fields: ['rulePackRef'] });
  const targetFields = (Object.keys(rulePack.target) as (keyof PrimaryTarget)[])
    .filter(key => rulePack.target[key] !== context.primaryTarget[key]).map(key => `primaryTarget.${key}`);
  if (targetFields.length) throw new AppError('RULE_PACK_TARGET_MISMATCH', 409, { fields: targetFields });
  const canvasFields = [
    ...(!rulePack.allowedWidthsPx.includes(context.canvasProfile.widthPx) ? ['canvasProfile.widthPx'] : []),
    ...(!rulePack.allowedFormats.includes(context.canvasProfile.format) ? ['canvasProfile.format'] : []),
  ];
  if (canvasFields.length) throw new AppError('CANVAS_OUTSIDE_RULE_PACK', 409, { fields: canvasFields });
  const rulePackSha256 = createHash('sha256').update(canonical(rulePack)).digest('hex');
  const state = production.context!;
  if (state.versions.some(v => v.rulePack.id === rulePack.id && v.rulePack.version === rulePack.version && v.rulePackSha256 !== rulePackSha256))
    throw new AppError('RULE_PACK_VERSION_CHANGED', 409, { fields: ['rulePackRef'] });
  const version = (state.versions.at(-1)?.version ?? 0) + 1;
  state.versions.push({ version, label: `P${version}`, context: structuredClone(context), rulePack: structuredClone(rulePack),
    rulePackSha256, activatedBy: actor, activatedAt: new Date().toISOString() });
  state.activeVersion = version;
  delete state.draft;
}
