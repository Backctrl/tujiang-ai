import { z } from 'zod';
import { writeSchema } from './contracts.js';
import { isStorageText, type ImageMetadata, type MaterialLocator, type MaterialSource } from './production-materials.js';

export const materialUseSchema = z.enum(['product_evidence', 'asset', 'reference']);
const reviewReason = z.string().trim().min(1).max(1000).refine(isStorageText, 'Valid Unicode required');
export const materialUsageSchema = writeSchema.extend({
  reason: reviewReason,
  decisions: z.array(z.object({ blockId: z.string().regex(/^[a-f0-9]{64}$/), usage: materialUseSchema }).strict()).min(1).max(2000),
}).strict().superRefine((body, ctx) => {
  if (new Set(body.decisions.map(item => item.blockId)).size !== body.decisions.length)
    ctx.addIssue({ code: 'custom', path: ['decisions'], message: 'Each block must have exactly one decision' });
});
export const factSourceReconfirmSchema = writeSchema.extend({ reason: reviewReason, evidenceId: z.string().uuid() }).strict();
export type MaterialUse = z.infer<typeof materialUseSchema>;
export type MaterialUsageInput = z.infer<typeof materialUsageSchema>;

export interface MaterialProvenance {
  materialId: string; blockId: string; sourceSha256: string; parserVersion: string;
  fileName: string; source: MaterialSource; locator: MaterialLocator;
  usageDecisionId: string; usageVersion: number;
}
export interface MaterialWithdrawal {
  decisionId: string; usageVersion: number; actor: string; at: string; reason: string;
}
export interface MaterialSourceImpact {
  affectedEvidenceIds: string[]; affectedFactIds: string[]; affectedCandidateIds: string[];
  reconfirmationRequiredFactIds: string[]; affectedSectionIds: string[]; affectedStoryboardIds: string[];
  affectedStructuredSources?: { factId: string; sourceId: string; evidenceId: string }[];
}
export interface MaterialUsageDecision {
  id: string; version: number; actor: string; at: string; reason: string;
  materialId: string; sourceSha256: string; parserVersion: string; fileName: string; source: MaterialSource;
  changes: { blockId: string; locator: MaterialLocator; previousUsage: MaterialUse | null;
    previousProjectionId?: string; usage: MaterialUse; projectionId: string }[];
  impact: MaterialSourceImpact;
}
export interface MaterialExtractionState {
  status: 'extraction_needed' | 'candidate_created' | 'extracted'; evidenceId: string;
  candidateIds: string[]; completedAt?: string; completedBy?: string; sourceRunId?: string;
}
export interface CurrentMaterialUsage {
  usage: MaterialUse; decisionId: string; version: number; projectionId: string;
  extraction?: MaterialExtractionState;
}
export interface MaterialUsageReview {
  version: number; history: MaterialUsageDecision[]; current: Record<string, CurrentMaterialUsage>;
}
export interface MaterialAsset {
  id: string; availability: 'available' | 'withdrawn'; materialSource: MaterialProvenance;
  objectKey: string; sha256: string; sizeBytes: number; image: ImageMetadata;
  createdAt: string; createdBy: string; withdrawn?: MaterialWithdrawal;
}
export interface MaterialReferenceBlock {
  id: string; availability: 'available' | 'withdrawn'; materialSource: MaterialProvenance;
  text?: string; cells?: string[]; image?: ImageMetadata; objectKey?: string;
  createdAt: string; createdBy: string; withdrawn?: MaterialWithdrawal;
}
export interface FactSourceReview {
  status: 'invalidated' | 'reconfirmation_required'; evidenceId: string;
  decisionId: string; usageVersion: number; actor: string; at: string; reason: string;
}
export interface FactSourceReconfirmation {
  previousEvidenceId: string; evidenceId: string; decisionId: string; usageVersion: number;
  actor: string; at: string; reason: string;
}
export type MaterialReviewTask =
  | { id: string; type: 'material_usage'; status: 'pending'; materialId: string; blockIds: string[] }
  | { id: string; type: 'fact_extraction'; status: 'extraction_needed'; materialId: string; blockId: string;
      evidenceId: string; usageDecisionId: string; usageVersion: number }
  | { id: string; type: 'fact_review'; status: 'pending' | 'blocked'; factId: string; evidenceId: string;
      materialId?: string; sourceIds?: string[];
      blockedReason?: 'INVALID_FACT_BINDING' | 'UNRESOLVED_FACT_CONFLICT' | 'BLOCKING_FACT_RISK' }
  | { id: string; type: 'fact_source_reconfirmation'; status: 'ready' | 'blocked'; factId: string;
      evidenceId: string; materialId: string; blockId: string; replacementEvidenceId?: string;
      sourceId?: string;
      blockedReason?: 'REPLACEMENT_EVIDENCE_REQUIRED' | 'INVALID_FACT_BINDING' | 'UNRESOLVED_FACT_CONFLICT';
      affectedSectionIds: string[]; affectedStoryboardIds: string[] };
export interface MaterialReviewCenter {
  projectId: string; projectVersion: number; revision: number; tasks: MaterialReviewTask[];
}
