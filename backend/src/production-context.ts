import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { Production } from './production.js';
import type { Connection } from './database.js';
import { label, legacyPrimaryTargetSchema, canvasProfileSchema, rulePackRefSchema, requiredFactSchema,
  completeContextSchema, contextDraftSchema, type ContextDraft, type CompleteContext, type PrimaryTarget } from './production-context-shapes.js';
import { scopedRulePackSchema, validateScopedContext, type ScopedRulePack } from './production-rules.js';
export { productBriefSchema, primaryTargetSchema, canvasProfileSchema, rulePackRefSchema, contextDraftSchema, completeContextSchema } from './production-context-shapes.js';
export type { ProductBrief, PrimaryTarget, CanvasProfile, RulePackRef, ContextDraft, CompleteContext } from './production-context-shapes.js';
export type { ScopedRulePack } from './production-rules.js';

/** Legacy canvas allowlists are preserved exactly; they cannot encode scoped platform constraints. */
export const rulePackSchema = rulePackRefSchema.extend({
  officialUrl: z.string().url().refine(value => new URL(value).protocol === 'https:', 'HTTPS source required'),
  verifiedAt: z.string().datetime().refine(value => Date.parse(value) <= Date.now(), 'Verification cannot be in the future'),
  verifiedBy: label,
  target: legacyPrimaryTargetSchema,
  allowedWidthsPx: z.array(z.number().int().min(1).max(20000)).min(1),
  allowedFormats: z.array(canvasProfileSchema.shape.format).min(1),
  requiredFacts: z.array(requiredFactSchema),
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
export const storedRulePackSchema = z.union([rulePackSchema, scopedRulePackSchema]);
export const productionCatalogSchema = z.object({ rulePacks: z.array(rulePackSchema), scopedRulePacks: z.array(scopedRulePackSchema).optional() }).strict().superRefine((catalog, ctx) => {
  const keys = [...catalog.rulePacks, ...(catalog.scopedRulePacks ?? [])].map(rule => JSON.stringify([rule.id, rule.version]));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'Duplicate rule pack identity' });
});
export type LegacyRulePack = z.infer<typeof rulePackSchema>;
export type RulePack = LegacyRulePack;
export type StoredRulePack = z.infer<typeof storedRulePackSchema>;
export type ProductionCatalog = z.infer<typeof productionCatalogSchema>;
export interface ProjectContextVersion {
  version: number; label: string; context: CompleteContext;
  rulePack: StoredRulePack; rulePackSha256: string; activatedBy: string; activatedAt: string;
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
export function hashRulePack(rulePack: StoredRulePack): string {
  return createHash('sha256').update(canonical(rulePack)).digest('hex');
}
/** Called in the same transaction as activation, or while backfilling historical bindings. */
export async function bindRulePackVersion(tx: Connection, snapshot: Pick<ProjectContextVersion, 'rulePack' | 'rulePackSha256' | 'activatedBy'>): Promise<void> {
  const rule = storedRulePackSchema.parse(snapshot.rulePack);
  if (hashRulePack(rule) !== snapshot.rulePackSha256) throw new AppError('RULE_PACK_SNAPSHOT_INVALID', 409);
  await tx.query(`INSERT INTO production_rule_packs(id, version, sha256, rule_pack, registered_by)
    VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT(id,version) DO NOTHING`,
    [rule.id, rule.version, snapshot.rulePackSha256, JSON.stringify(rule), snapshot.activatedBy]);
  const { rows } = await tx.query<{ sha256: string }>('SELECT sha256 FROM production_rule_packs WHERE id=$1 AND version=$2', [rule.id, rule.version]);
  if (rows[0]?.sha256 !== snapshot.rulePackSha256) throw new AppError('RULE_PACK_VERSION_CHANGED', 409, { fields: ['rulePackRef'] });
}
export function activateContext(production: Production, catalog: ProductionCatalog, actor: string): ProjectContextVersion {
  const parsed = completeContextSchema.safeParse(production.context?.draft);
  if (!parsed.success) throw new AppError('PRODUCTION_CONTEXT_INCOMPLETE', 409,
    { fields: parsed.error.issues.map(issue => issue.path.join('.') || 'context') });
  const context = parsed.data;
  const rulePack = [...catalog.rulePacks, ...(catalog.scopedRulePacks ?? [])].find(rule => rule.id === context.rulePackRef.id && rule.version === context.rulePackRef.version);
  if (!rulePack) throw new AppError('RULE_PACK_UNAVAILABLE', 409, { fields: ['rulePackRef'] });
  const scoped = isScopedRulePack(rulePack);
  if (!scoped && (context.primaryTarget.contentType !== undefined || context.canvasProfile.selectionBasis !== undefined))
    throw new AppError('SCOPED_RULE_PACK_REQUIRED', 409, { fields: ['rulePackRef'], recovery: '明确内容类型的目标必须选择 scoped-rules.1，不能使用 legacy 画布列表。' });
  if (scoped && context.primaryTarget.contentType === undefined)
    throw new AppError('SCOPED_CONTENT_TYPE_REQUIRED', 409, { fields: ['primaryTarget.contentType'] });
  const expectedTarget: PrimaryTarget = rulePack.target;
  const targetFields = (Object.keys(expectedTarget) as (keyof PrimaryTarget)[])
    .filter(key => expectedTarget[key] !== context.primaryTarget[key]).map(key => `primaryTarget.${key}`);
  if (targetFields.length) throw new AppError('RULE_PACK_TARGET_MISMATCH', 409, { fields: targetFields });
  if (scoped) validateScopedContext(context, rulePack);
  else {
    const canvasFields = [
      ...(!rulePack.allowedWidthsPx.includes(context.canvasProfile.widthPx) ? ['canvasProfile.widthPx'] : []),
      ...(!rulePack.allowedFormats.includes(context.canvasProfile.format) ? ['canvasProfile.format'] : []),
    ];
    if (canvasFields.length) throw new AppError('CANVAS_OUTSIDE_RULE_PACK', 409, { fields: canvasFields });
  }
  const rulePackSha256 = hashRulePack(rulePack);
  const state = production.context!;
  if (state.versions.some(v => v.rulePack.id === rulePack.id && v.rulePack.version === rulePack.version && v.rulePackSha256 !== rulePackSha256))
    throw new AppError('RULE_PACK_VERSION_CHANGED', 409, { fields: ['rulePackRef'] });
  const version = (state.versions.at(-1)?.version ?? 0) + 1;
  const snapshot = { version, label: `P${version}`, context: structuredClone(context), rulePack: structuredClone(rulePack),
    rulePackSha256, activatedBy: actor, activatedAt: new Date().toISOString() };
  state.versions.push(snapshot);
  state.activeVersion = version;
  delete state.draft;
  return snapshot;
}
export function isScopedRulePack(rulePack: StoredRulePack): rulePack is ScopedRulePack {
  return 'schemaVersion' in rulePack && rulePack.schemaVersion === 'scoped-rules.1';
}
