import { createHash } from 'node:crypto';
import type { Evidence, Fact, Project, Skill } from './contracts.js';
import type { MaterialAsset, MaterialProvenance, MaterialReferenceBlock, MaterialUse } from './production-material-usage.js';
import type { MaterialLocator } from './production-materials.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function materialLocatorText(locator: MaterialLocator): string {
  if (locator.type === 'text') return `lines ${locator.startLine}-${locator.endLine}`;
  if (locator.type === 'csv') return `row ${locator.row}; lines ${locator.startLine}-${locator.endLine}`;
  if (locator.type === 'json') return `JSON ${locator.pointer || '/'}; offsets ${locator.startOffset}-${locator.endOffset}`;
  return `image frame ${locator.frame}`;
}
export function currentMaterialSource(p: Project, source: MaterialProvenance, usage: MaterialUse, projectionId: string) {
  const material = p.production?.materials?.find(item => item.id === source.materialId);
  const block = material?.blocks.find(item => item.id === source.blockId);
  const current = material?.usageReview?.current[source.blockId];
  const decision = material?.usageReview?.history.find(item => item.id === source.usageDecisionId && item.version === source.usageVersion);
  if (!material || !block || !current || !decision || material.parse.runStatus !== 'succeeded' || material.parse.queueStatus !== 'done'
    || material.sha256 !== source.sourceSha256 || material.parse.sourceSha256 !== material.sha256
    || block.materialId !== material.id || block.sourceSha256 !== material.sha256 || block.status !== 'candidate'
    || material.parse.parserVersion !== source.parserVersion || block.parserVersion !== source.parserVersion
    || source.fileName !== material.fileName || canonical(source.source) !== canonical(material.source)
    || canonical(source.locator) !== canonical(block.locator)
    || current.usage !== usage || current.projectionId !== projectionId || current.decisionId !== source.usageDecisionId
    || current.version !== source.usageVersion || decision.materialId !== material.id || decision.sourceSha256 !== material.sha256
    || decision.parserVersion !== source.parserVersion || decision.fileName !== material.fileName || canonical(decision.source) !== canonical(material.source)
    || !decision.changes.some(change => change.blockId === block.id && change.usage === usage && change.projectionId === projectionId
      && canonical(change.locator) === canonical(block.locator))) return;
  return { material, block, current };
}
export function evidenceIsAvailable(p: Project, evidence: Evidence): boolean {
  if (evidence.usage !== 'product_evidence' || evidence.availability === 'withdrawn') return false;
  if (!evidence.materialSource) return evidence.origin !== 'material'; // Historical independent human entries remain valid.
  if (evidence.origin !== 'material' || evidence.availability !== 'available') return false;
  const source = currentMaterialSource(p, evidence.materialSource, 'product_evidence', evidence.id);
  if (!source || source.block.image || !source.block.text || evidence.text !== source.block.text) return false;
  const sha256 = createHash('sha256').update(evidence.text, 'utf8').digest('hex');
  return evidence.sha256 === sha256 && evidence.objectKey === `${sha256}.txt`;
}
export function factSourceIsCurrent(p: Project, fact: Fact): boolean {
  if (fact.sourceReview) return false;
  const evidence = p.evidence.find(item => item.id === fact.evidenceId);
  return !!evidence && evidenceIsAvailable(p, evidence) && fact.start >= 0
    && fact.end === fact.start + fact.quote.length && evidence.text.slice(fact.start, fact.end) === fact.quote;
}
export function availableEvidence(p: Project): Evidence[] { return p.evidence.filter(item => evidenceIsAvailable(p, item)); }
export function availableConfirmedFacts(p: Project): Fact[] {
  return p.facts.filter(fact => fact.status === 'confirmed' && fact.locked && fact.issueSeverity === 'none' && factSourceIsCurrent(p, fact));
}
export function materialAssetIsAvailable(p: Project, asset: MaterialAsset): boolean {
  const source = currentMaterialSource(p, asset.materialSource, 'asset', asset.id);
  return asset.availability === 'available' && !!source?.block.image
    && source.material.objectKey === asset.objectKey && source.material.sha256 === asset.sha256
    && source.material.sizeBytes === asset.sizeBytes && canonical(source.block.image) === canonical(asset.image);
}
export function materialReferenceIsAvailable(p: Project, reference: MaterialReferenceBlock): boolean {
  const source = currentMaterialSource(p, reference.materialSource, 'reference', reference.id);
  return reference.availability === 'available' && !!source && reference.text === source.block.text
    && canonical(reference.cells) === canonical(source.block.cells) && canonical(reference.image) === canonical(source.block.image)
    && reference.objectKey === (source.block.image ? source.material.objectKey : undefined);
}
/** This is also the exact source selection used by the structured model request builder. */
export function skillInput(p: Project, skill: Skill) {
  return skill === 'extract-facts'
    ? { evidence: availableEvidence(p).map(({ id, text, locator }) => ({ id, text, locator })) }
    : { identity: p.identity, confirmedFacts: availableConfirmedFacts(p) };
}
export function materialModelInputHash(p: Project): string {
  return createHash('sha256').update(canonical([skillInput(p, 'extract-facts'), skillInput(p, 'plan-section')])).digest('hex');
}
export function recordMaterialExtraction(p: Project, evidenceIds: string[], actor: string, sourceRunId?: string) {
  for (const evidenceId of evidenceIds) {
    const evidence = p.evidence.find(item => item.id === evidenceId);
    if (!evidence?.materialSource || !evidenceIsAvailable(p, evidence)) continue;
    const source = currentMaterialSource(p, evidence.materialSource, 'product_evidence', evidenceId)!;
    const extraction = source.current.extraction;
    if (!extraction || (!sourceRunId && extraction.status === 'extracted')) continue;
    extraction.status = sourceRunId ? 'extracted' : 'candidate_created';
    extraction.candidateIds = p.facts.filter(fact => fact.evidenceId === evidenceId && factSourceIsCurrent(p, fact)).map(fact => fact.id);
    extraction.completedAt = new Date().toISOString(); extraction.completedBy = actor;
    if (sourceRunId) extraction.sourceRunId = sourceRunId;
  }
}
