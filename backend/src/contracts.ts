import { z } from 'zod';

export const CONTRACT_VERSION = 'stage-a.1';
export const writeSchema = z.object({
  expectedProjectVersion: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(128),
});
export const createSchema = writeSchema.extend({ name: z.string().trim().min(1).max(150) }).strict();
export const identitySchema = writeSchema.extend({ productName: z.string().trim().min(1).max(150) }).strict();
export const evidenceSchema = writeSchema.extend({
  documentName: z.string().trim().min(1).max(200),
  locator: z.string().trim().min(1).max(300),
  usage: z.literal('product_evidence'),
  text: z.string().min(1).max(80_000),
}).strict();
export const skillSchema = z.enum(['extract-facts', 'plan-section']);
export type Skill = z.infer<typeof skillSchema>;
export const runSchema = writeSchema.extend({ skill: skillSchema }).strict();
export const reasonSchema = writeSchema.extend({ reason: z.string().trim().min(1).max(1000) }).strict();
export const identityCorrectionSchema = reasonSchema.extend({ productName: z.string().trim().min(1).max(150) }).strict();

export const extractionSchema = z.object({
  facts: z.array(z.object({
    attribute: z.string().trim().min(1).max(100),
    role: z.enum(['core', 'supporting']),
    value: z.string().trim().min(1).max(1000),
    evidenceId: z.string().uuid(),
    quote: z.string().min(1).max(2000),
  }).strict()).max(30),
}).strict();
export const planSchema = z.object({
  chapters: z.array(z.object({
    role: z.enum(['identity', 'feature', 'evidence', 'usage']),
    purpose: z.string().trim().min(1).max(300),
    factIds: z.array(z.string().uuid()).min(1).max(20),
  }).strict()).min(1),
  section: z.object({
    purpose: z.string().trim().min(1).max(300),
    factIds: z.array(z.string().uuid()).min(1).max(20),
    missingInputs: z.array(z.string().max(300)).max(20),
  }).strict(),
}).strict();
export type Extraction = z.infer<typeof extractionSchema>;
export type Plan = z.infer<typeof planSchema>;
export const candidateSchema = reasonSchema.extend({ ...extractionSchema.shape.facts.element.shape,
  correctsFactId: z.string().uuid().optional() }).strict();
export const storyboardEditSchema = reasonSchema.extend({ chapters: planSchema.shape.chapters.max(50) }).strict();
export const sectionEditSchema = reasonSchema.extend(planSchema.shape.section.shape).strict();

// Contract rev57 §11.1: queue lifecycle is separate from the four business state axes.
export interface StateAxes {
  issueSeverity: 'none' | 'warning' | 'blocker';
  runStatus: 'idle' | 'running' | 'succeeded' | 'failed';
  freshness: 'current' | 'stale';
  approvalStatus: 'draft' | 'in_review' | 'approved';
}
export const draftState = (): StateAxes => ({ issueSeverity: 'none', runStatus: 'idle', freshness: 'current', approvalStatus: 'draft' });
export interface Evidence {
  id: string; documentName: string; locator: string; usage: 'product_evidence';
  text: string; sha256: string; objectKey: string; createdBy: string;
}
export interface Fact {
  id: string; attribute: string; role: 'core' | 'supporting'; value: string; evidenceId: string; quote: string;
  start: number; end: number; sourceRunId: string;
  status: 'candidate' | 'confirmed' | 'rejected' | 'retracted';
  locked: boolean; issueSeverity: StateAxes['issueSeverity'];
  confirmedBy?: string; confirmedAt?: string;
  correctsFactId?: string; createdBy?: string; reason?: string;
}
export interface Section extends StateAxes {
  id: string; kind: 'diagnostic_draft'; sourceRunId: string; factIds: string[];
  purpose: string; missingInputs: string[];
  storyboardId?: string; identityRevision?: number; editedBy?: string; reason?: string; replacesSectionId?: string;
}
export interface ModelObservation {
  attempt: number; requestedModel: string | null; requestedProvider: string | null;
  actualModel: string | null; actualProvider: string | null; requestIdSha256: string | null;
  requestSha256: string | null; capabilitiesSha256: string | null; dispatched: boolean;
  latencyMs: number; inputTokens: number | null; outputTokens: number | null; costUsd: number | null;
  estimatedCostUsd: number | null; finishReason: string; errorCode?: string;
}
export interface Storyboard {
  id?: string; chapters: Plan['chapters']; sourceRunId: string; freshness: 'current' | 'stale'; approvalStatus: 'draft';
  identityRevision?: number; editedBy?: string; reason?: string;
}
export interface AgentRun extends StateAxes {
  id: string; skill: Skill; queueStatus: 'queued' | 'claimed' | 'done';
  attempt: number; requestedBy: string; contextVersion?: number; contextRevision?: number; contextInputRevision?: number; leaseUntil?: string;
  output?: unknown; errorCode?: string;
  modelId?: string;
  observations?: ModelObservation[];
}
export interface Audit {
  id: string; projectVersion: number; revision: number; type: string; actor: string; at: string;
  data: Record<string, unknown>;
}
export interface Project {
  id: string; name: string; version: number; revision: number; contractVersion: string;
  inputRevision?: number;
  identity?: { productName: string; confirmedBy: string; confirmedAt: string };
  evidence: Evidence[]; facts: Fact[]; runs: AgentRun[]; sections: Section[];
  storyboard?: Storyboard;
  storyboardCandidates?: Storyboard[]; currentSectionId?: string | null; identityRevision?: number;
  qa?: { kind: 'preflight'; sectionId?: string; checkedVersion: number; checkedRevision: number; issueSeverity: StateAxes['issueSeverity'];
    notChecked: string[];
    issues: string[]; exportAllowed: false; at: string };
  audit: Audit[];
}
