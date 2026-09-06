import { z } from 'zod';

export const label = z.string().trim().min(1).max(200);
export const productBriefSchema = z.object({ productName: label, internalCode: label, category: label, stage: label,
  introduction: z.string().trim().min(1).max(10000), commercialIntent: z.string().trim().min(1).max(2000) }).strict();
// Keep the legacy rule shape byte-for-byte compatible with its registered JSON/hash.
export const legacyPrimaryTargetSchema = z.object({ platform: label, site: label,
  country: z.string().regex(/^[A-Z]{2}$/), language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  currency: z.string().regex(/^[A-Z]{3}$/), unitSystem: z.enum(['metric', 'imperial']) }).strict();
export const primaryTargetSchema = legacyPrimaryTargetSchema.extend({ contentType: label.optional() }).strict();
export const legacyCanvasProfileSchema = z.object({ widthPx: z.number().int().min(1).max(20000), format: z.enum(['png', 'jpeg', 'webp']) }).strict();
export const canvasProfileSchema = legacyCanvasProfileSchema.extend({ selectionBasis: z.literal('local_production_policy').optional() }).strict();
export const rulePackRefSchema = z.object({ id: label, version: label }).strict();
export const requiredFactSchema = z.object({ key: label, description: z.string().trim().min(1).max(1000),
  allowUnknown: z.boolean(), allowNotApplicable: z.boolean() }).strict();
export const contextDraftSchema = z.object({ productBrief: productBriefSchema.partial().optional(),
  primaryTarget: primaryTargetSchema.partial().optional(), canvasProfile: canvasProfileSchema.partial().optional(),
  rulePackRef: rulePackRefSchema.optional() }).strict();
export const completeContextSchema = z.object({ productBrief: productBriefSchema, primaryTarget: primaryTargetSchema,
  canvasProfile: canvasProfileSchema, rulePackRef: rulePackRefSchema }).strict();
export type ProductBrief = z.infer<typeof productBriefSchema>;
export type PrimaryTarget = z.infer<typeof primaryTargetSchema>;
export type CanvasProfile = z.infer<typeof canvasProfileSchema>;
export type RulePackRef = z.infer<typeof rulePackRefSchema>;
export type ContextDraft = z.infer<typeof contextDraftSchema>;
export type CompleteContext = z.infer<typeof completeContextSchema>;
