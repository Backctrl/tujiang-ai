import { createHash } from 'node:crypto';
import type { AgentRun, Evidence, Project } from './contracts.js';
import { AppError } from './errors.js';
import { hashRulePack } from './production-context.js';
import { availableEvidence, evidenceIsAvailable } from './material-source-gates.js';
import type { Material } from './production-materials.js';
import type { ProjectStartup, StartupEvidenceRef, StartupMaterialRef, StartupSourceScope } from './production-startup.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const startupHash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const sorted = <T extends { id: string }>(items: T[]): T[] => items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function startupEvidenceRef(evidence: Evidence): StartupEvidenceRef {
  return { id: evidence.id, sha256: startupHash({ id: evidence.id, documentName: evidence.documentName, locator: evidence.locator,
    text: evidence.text, sha256: evidence.sha256, objectKey: evidence.objectKey, origin: evidence.origin,
    materialSource: evidence.materialSource }) };
}
export function startupMaterialRef(material: Material): StartupMaterialRef {
  return { id: material.id, sha256: material.sha256, parserVersion: material.parse.parserVersion,
    metadataSha256: startupHash({ fileName: material.fileName, source: material.source, format: material.format,
      objectKey: material.objectKey, sizeBytes: material.sizeBytes }) };
}
export function currentStartupScope(p: Project): StartupSourceScope {
  return { version: 1, materials: sorted((p.production?.materials ?? []).map(startupMaterialRef)),
    manualEvidence: sorted(availableEvidence(p).filter(e => !e.materialSource).map(startupEvidenceRef)) };
}
export function startupScopeAdditions(p: Project, previous: StartupSourceScope) {
  const current = currentStartupScope(p);
  return { materials: current.materials.filter(ref => !previous.materials.some(item => item.id === ref.id)),
    manualEvidence: current.manualEvidence.filter(ref => !previous.manualEvidence.some(item => item.id === ref.id)) };
}
export function scopeRefreshFingerprint(startup: ProjectStartup, additions: ReturnType<typeof startupScopeAdditions>) {
  return startupHash({ startupId: startup.id, contextSha256: startup.contextSha256, previous: startup.scope, additions });
}
export function scopeSourceError(p: Project, scope: StartupSourceScope): string | undefined {
  for (const ref of scope.materials) {
    const material = p.production?.materials?.find(item => item.id === ref.id);
    if (!material || startupHash(startupMaterialRef(material)) !== startupHash(ref)) return 'STARTUP_SOURCE_CHANGED';
  }
  for (const ref of scope.manualEvidence) {
    const evidence = availableEvidence(p).find(item => item.id === ref.id);
    if (!evidence || evidence.materialSource || startupHash(startupEvidenceRef(evidence)) !== startupHash(ref)) return 'STARTUP_SOURCE_CHANGED';
  }
}
export function startupBindingError(p: Project, startup: ProjectStartup): string | undefined {
  const state = p.production?.context;
  const frozen = state?.versions.find(item => item.version === startup.contextVersion);
  const active = state?.versions.find(item => item.version === state.activeVersion);
  if (!frozen || !active || frozen.rulePackSha256 !== startup.rulePackSha256 || hashRulePack(frozen.rulePack) !== startup.rulePackSha256
    || startupHash(frozen.context) !== startup.contextSha256 || startupHash(startup.context) !== startup.contextSha256
    || active.rulePackSha256 !== startup.rulePackSha256 || hashRulePack(active.rulePack) !== startup.rulePackSha256
    || startupHash(active.context) !== startup.contextSha256) return 'STARTUP_CONTEXT_CHANGED';
  if (p.identity?.productName !== startup.identity.productName || (p.identityRevision ?? 1) !== startup.identity.revision)
    return 'STARTUP_IDENTITY_CHANGED';
  return scopeSourceError(p, startup.scope);
}
export function scopedStartupEvidence(p: Project, scope: StartupSourceScope): Evidence[] {
  return availableEvidence(p).filter(evidence => evidence.materialSource
    ? scope.materials.some(ref => ref.id === evidence.materialSource!.materialId && ref.sha256 === evidence.materialSource!.sourceSha256
      && ref.parserVersion === evidence.materialSource!.parserVersion)
    : scope.manualEvidence.some(ref => ref.id === evidence.id && ref.sha256 === startupEvidenceRef(evidence).sha256));
}
/** Called before dispatch, on explicit retry and again before accepting model output. */
export function validateStartupRun(p: Project, run: AgentRun): Evidence[] | undefined {
  if (!run.startupInput) return;
  const input = run.startupInput;
  const startup = p.production?.startup;
  if (run.skill !== 'extract-facts' || !startup || startup.id !== input.startupId || startup.runId !== run.id
    || startupHash(startup.scope) !== input.scopeSha256 || startup.contextVersion !== input.contextVersion
    || startup.contextSha256 !== input.contextSha256 || startup.rulePackSha256 !== input.rulePackSha256
    || startupHash(startup.identity) !== startupHash(input.identity)) throw new AppError('STARTUP_INPUT_CHANGED', 409);
  const error = startupBindingError(p, startup);
  if (error) throw new AppError(error, 409);
  if (!input.evidence.length || new Set(input.evidence.map(ref => ref.id)).size !== input.evidence.length)
    throw new AppError('STARTUP_INPUT_CHANGED', 409);
  const eligible = scopedStartupEvidence(p, startup.scope);
  return input.evidence.map(ref => {
    const evidence = eligible.find(item => item.id === ref.id);
    if (!evidence || !evidenceIsAvailable(p, evidence) || startupEvidenceRef(evidence).sha256 !== ref.sha256)
      throw new AppError('STARTUP_EVIDENCE_CHANGED', 409);
    return evidence;
  });
}
