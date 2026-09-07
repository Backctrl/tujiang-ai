import { randomUUID } from 'node:crypto';
import type { Evidence, Project } from './contracts.js';
import { AppError } from './errors.js';
import { LocalObjects } from './objects.js';
import { requireProduction } from './production.js';
import type { MaterialUsageInput, MaterialSourceImpact, MaterialProvenance, MaterialUsageDecision, MaterialReviewCenter } from './production-material-usage.js';
import { currentFactConflict, evidenceIsAvailable, factIntegrityIsValid, factSourceIsCurrent,
  materialLocatorText } from './material-source-gates.js';
import { audit } from './store.js';
import { invalidateStructuredFactSources, replacementEvidenceForStructuredSource, structuredSourceImpact,
  structuredSourceReconfirmationBlockReason } from './fact-sources.js';
import { createLegacyFactBinding, structuredRiskSeverity } from './production-fact-sources.js';

/** Shared impact calculation; a future formal-baseline adapter can consume the same source set. */
export function materialSourceImpact(p: Project, materialId: string, blockIds: string[]): MaterialSourceImpact {
  return evidenceSourceImpact(p, p.evidence.filter(e => e.materialSource?.materialId === materialId
    && blockIds.includes(e.materialSource.blockId)).map(e => e.id));
}
function evidenceSourceImpact(p: Project, evidenceIds: string[]): MaterialSourceImpact {
  const structured = structuredSourceImpact(p, evidenceIds);
  const structuredFactIds = new Set(structured.map(item => item.factId));
  const facts = p.facts.filter(f => evidenceIds.includes(f.evidenceId) || structuredFactIds.has(f.id));
  const affectedFactIds = facts.map(f => f.id);
  const storyboards = [...(p.storyboard ? [p.storyboard] : []), ...(p.storyboardCandidates ?? [])];
  return { affectedEvidenceIds: evidenceIds, affectedFactIds,
    affectedCandidateIds: facts.filter(f => f.status === 'candidate').map(f => f.id),
    reconfirmationRequiredFactIds: facts.filter(f => f.status === 'confirmed' && f.locked).map(f => f.id),
    affectedSectionIds: p.sections.filter(s => s.factIds.some(id => affectedFactIds.includes(id))).map(s => s.id),
    affectedStoryboardIds: [...new Set(storyboards.filter(b => b.chapters.some(c => c.factIds.some(id => affectedFactIds.includes(id))))
      .flatMap(b => b.id ? [b.id] : []))], ...(structured.length ? { affectedStructuredSources: structured } : {}) };
}
function selection(p: Project, materialId: string, input: MaterialUsageInput) {
  const material = requireProduction(p).materials?.find(item => item.id === materialId);
  if (!material) throw new AppError('MATERIAL_NOT_FOUND', 404);
  if (material.parse.queueStatus !== 'done' || material.parse.runStatus !== 'succeeded') throw new AppError('MATERIAL_PARSE_REQUIRED', 409);
  if (material.objectKey !== `${material.sha256}.bin` || material.parse.sourceSha256 !== material.sha256)
    throw new AppError('MATERIAL_SOURCE_INVALID', 409);
  const decisions = input.decisions.map(decision => {
    const block = material.blocks.find(item => item.id === decision.blockId);
    if (!block) throw new AppError('MATERIAL_BLOCK_NOT_FOUND', 404);
    if (block.materialId !== material.id || block.sourceSha256 !== material.sha256
      || block.parserVersion !== material.parse.parserVersion || block.status !== 'candidate') throw new AppError('MATERIAL_SOURCE_INVALID', 409);
    const isImage = !!block.image && block.locator.type === 'image' && block.image.format === material.format
      && ['png', 'jpeg', 'webp'].includes(material.format) && block.image.widthPx > 0 && block.image.heightPx > 0;
    if (decision.usage === 'asset' && !isImage) throw new AppError('DECODED_IMAGE_REQUIRED', 409);
    if (decision.usage === 'product_evidence' && (block.image || !block.text)) throw new AppError('TEXT_EVIDENCE_REQUIRED', 409);
    if (decision.usage === 'reference' && !isImage && !block.text) throw new AppError('MATERIAL_SOURCE_INVALID', 409);
    return { ...decision, block, previous: material.usageReview?.current[block.id] };
  });
  return { material, decisions, changed: decisions.filter(item => item.previous?.usage !== item.usage) };
}
export function materialUsageIsUnchanged(p: Project, materialId: string, input: MaterialUsageInput): boolean {
  return selection(p, materialId, input).changed.length === 0;
}
export async function reviewMaterialUsage(p: Project, materialId: string, input: MaterialUsageInput, actor: string, objects: LocalObjects) {
  const { material, changed } = selection(p, materialId, input);
  if (!changed.length) return;
  // All choices are validated before writes. Original integrity is checked before deriving any new projection.
  await objects.readBinary(material.objectKey, material.sizeBytes);
  const projections = await Promise.all(changed.map(async item => ({ ...item, id: randomUUID(),
    artifact: item.usage === 'product_evidence' ? await objects.put(item.block.text!) : undefined })));
  const review = material.usageReview ??= { version: 0, history: [], current: {} };
  const decisionId = randomUUID(); const at = new Date().toISOString(); const version = review.version + 1;
  const withdrawn = { decisionId, usageVersion: version, actor, at, reason: input.reason };
  const impact = evidenceSourceImpact(p, changed.filter(item => item.previous?.usage === 'product_evidence')
    .map(item => item.previous!.projectionId));
  const decision: MaterialUsageDecision = { id: decisionId, version, actor, at, reason: input.reason,
    materialId: material.id, sourceSha256: material.sha256, parserVersion: material.parse.parserVersion,
    fileName: material.fileName, source: structuredClone(material.source), impact, changes: [] };
  for (const item of projections) {
    const { block, previous } = item;
    if (previous) {
      const old = previous.usage === 'product_evidence' ? p.evidence.find(e => e.id === previous.projectionId)
        : previous.usage === 'asset' ? p.production!.assets?.find(a => a.id === previous.projectionId)
          : p.production!.references?.find(r => r.id === previous.projectionId);
      if (old) { old.availability = 'withdrawn'; old.withdrawn = { ...withdrawn }; }
    }
    const materialSource: MaterialProvenance = { materialId: material.id, blockId: block.id, sourceSha256: material.sha256,
      parserVersion: material.parse.parserVersion, fileName: material.fileName, source: structuredClone(material.source),
      locator: structuredClone(block.locator), usageDecisionId: decisionId, usageVersion: version };
    const common = { id: item.id, availability: 'available' as const, materialSource, createdAt: at, createdBy: actor };
    if (item.usage === 'product_evidence') p.evidence.push({ ...common, origin: 'material', usage: 'product_evidence',
      documentName: material.fileName, locator: materialLocatorText(block.locator), text: block.text!, ...item.artifact! });
    else if (item.usage === 'asset') (p.production!.assets ??= []).push({ ...common, objectKey: material.objectKey,
      sha256: material.sha256, sizeBytes: material.sizeBytes, image: structuredClone(block.image!) });
    else (p.production!.references ??= []).push({ ...common, text: block.text, cells: structuredClone(block.cells),
      image: structuredClone(block.image), ...(block.image ? { objectKey: material.objectKey } : {}) });
    review.current[block.id] = { usage: item.usage, decisionId, version, projectionId: item.id,
      ...(item.usage === 'product_evidence' ? { extraction: { status: 'extraction_needed' as const, evidenceId: item.id, candidateIds: [] } } : {}) };
    decision.changes.push({ blockId: block.id, locator: structuredClone(block.locator), previousUsage: previous?.usage ?? null,
      ...(previous ? { previousProjectionId: previous.projectionId } : {}), usage: item.usage, projectionId: item.id });
  }
  invalidateStructuredFactSources(p, impact.affectedEvidenceIds, withdrawn);
  for (const fact of p.facts) {
    if (fact.structured) continue;
    if (!impact.affectedFactIds.includes(fact.id) || !['candidate', 'confirmed'].includes(fact.status)) continue;
    fact.sourceReview = { ...withdrawn, evidenceId: fact.evidenceId,
      status: fact.status === 'confirmed' ? 'reconfirmation_required' : 'invalidated' };
  }
  for (const section of p.sections) if (impact.affectedSectionIds.includes(section.id)) section.freshness = 'stale';
  // Legacy storyboards can have no id; still mark their actual dependencies stale.
  for (const storyboard of [...(p.storyboard ? [p.storyboard] : []), ...(p.storyboardCandidates ?? [])])
    if (storyboard.chapters.some(chapter => chapter.factIds.some(id => impact.affectedFactIds.includes(id)))) storyboard.freshness = 'stale';
  review.version = version; review.history.push(decision);
  material.usage.status = material.blocks.every(block => !!review.current[block.id]) ? 'reviewed' : 'partially_reviewed';
  audit(p, 'material.usage.decided', actor, { materialId, decisionId, usageVersion: version, reason: input.reason, impact });
}
export function replacementEvidence(p: Project, evidence: Evidence, quote: string): Evidence | undefined {
  const source = evidence.materialSource;
  if (!source) return;
  return p.evidence.find(item => item.id !== evidence.id && item.materialSource?.materialId === source.materialId
    && item.materialSource.blockId === source.blockId && evidenceIsAvailable(p, item) && item.text.includes(quote));
}
export function materialReviewCenter(p: Project): MaterialReviewCenter {
  const production = requireProduction(p);
  const tasks: MaterialReviewCenter['tasks'] = [];
  for (const material of production.materials ?? []) {
    if (material.parse.runStatus !== 'succeeded' || material.parse.queueStatus !== 'done') continue;
    const blockIds = material.blocks.filter(block => !material.usageReview?.current[block.id]).map(block => block.id);
    if (blockIds.length) tasks.push({ id: `material-usage:${material.id}`, type: 'material_usage', status: 'pending', materialId: material.id, blockIds });
    for (const [blockId, current] of Object.entries(material.usageReview?.current ?? {})) {
      const evidence = p.evidence.find(item => item.id === current.projectionId);
      if (current.extraction?.status === 'extraction_needed' && evidence && evidenceIsAvailable(p, evidence))
        tasks.push({ id: `fact-extraction:${current.projectionId}`, type: 'fact_extraction', status: 'extraction_needed',
          materialId: material.id, blockId, evidenceId: current.projectionId, usageDecisionId: current.decisionId, usageVersion: current.version });
    }
  }
  for (const fact of p.facts) {
    if (fact.supersededByFactId) continue;
    const evidence = p.evidence.find(item => item.id === fact.evidenceId);
    if (fact.structured) {
      if (fact.status === 'candidate' && factIntegrityIsValid(p, fact)) {
        const conflict = factSourceIsCurrent(p, fact) && currentFactConflict(p, fact);
        const blockedReason = conflict ? 'UNRESOLVED_FACT_CONFLICT' as const
          : structuredRiskSeverity(fact.structured) === 'blocker' ? 'BLOCKING_FACT_RISK' as const : undefined;
        if (factSourceIsCurrent(p, fact)) tasks.push({ id: `fact-review:${fact.id}`,
          type: 'fact_review', status: blockedReason ? 'blocked' : 'pending', factId: fact.id, evidenceId: fact.evidenceId,
          sourceIds: fact.structured.sources.map(source => source.id),
          ...(blockedReason ? { blockedReason } : {}),
          ...(evidence?.materialSource ? { materialId: evidence.materialSource.materialId } : {}) });
      }
      if (fact.status !== 'confirmed' || !fact.locked) continue;
      for (const source of fact.structured.sources) {
        if (source.review?.status !== 'reconfirmation_required') continue;
        const oldEvidence = p.evidence.find(item => item.id === source.evidenceId);
        if (!oldEvidence?.materialSource) continue;
        const replacement = replacementEvidenceForStructuredSource(p, source);
        const blockedReason = !replacement ? 'REPLACEMENT_EVIDENCE_REQUIRED' as const
          : structuredSourceReconfirmationBlockReason(p, fact, source, replacement);
        const affected = evidenceSourceImpact(p, [source.evidenceId]);
        tasks.push({ id: `fact-source-reconfirmation:${fact.id}:${source.id}`, type: 'fact_source_reconfirmation',
          status: blockedReason ? 'blocked' : 'ready', factId: fact.id, sourceId: source.id,
          evidenceId: source.evidenceId, materialId: oldEvidence.materialSource.materialId,
          blockId: oldEvidence.materialSource.blockId, ...(replacement ? { replacementEvidenceId: replacement.id } : {}),
          ...(blockedReason ? { blockedReason } : {}),
          affectedSectionIds: affected.affectedSectionIds.filter(id => p.sections.find(s => s.id === id)?.factIds.includes(fact.id)),
          affectedStoryboardIds: affected.affectedStoryboardIds.filter(id => [...(p.storyboard ? [p.storyboard] : []), ...(p.storyboardCandidates ?? [])]
            .some(b => b.id === id && b.chapters.some(c => c.factIds.includes(fact.id)))) });
      }
      continue;
    }
    if (fact.status === 'candidate' && factSourceIsCurrent(p, fact)) {
      const conflict = currentFactConflict(p, fact);
      tasks.push({ id: `fact-review:${fact.id}`,
      type: 'fact_review', status: conflict ? 'blocked' : 'pending', factId: fact.id, evidenceId: fact.evidenceId,
      ...(conflict ? { blockedReason: 'UNRESOLVED_FACT_CONFLICT' as const } : {}),
      ...(evidence?.materialSource ? { materialId: evidence.materialSource.materialId } : {}) });
    }
    if (fact.status !== 'confirmed' || !fact.locked || fact.sourceReview?.status !== 'reconfirmation_required' || !evidence?.materialSource) continue;
    const replacement = replacementEvidence(p, evidence, fact.quote);
    let blockedReason: 'REPLACEMENT_EVIDENCE_REQUIRED' | 'INVALID_FACT_BINDING' | 'UNRESOLVED_FACT_CONFLICT' | undefined;
    if (!replacement) blockedReason = 'REPLACEMENT_EVIDENCE_REQUIRED';
    else {
      const candidate = structuredClone(fact);
      const start = replacement.text.indexOf(fact.quote);
      candidate.evidenceId = replacement.id; candidate.start = start; candidate.end = start + candidate.quote.length;
      delete candidate.sourceReview;
      try { candidate.legacyBinding = createLegacyFactBinding(candidate, replacement); }
      catch { blockedReason = 'INVALID_FACT_BINDING'; }
      if (!blockedReason && (!factIntegrityIsValid(p, candidate) || start < 0)) blockedReason = 'INVALID_FACT_BINDING';
      if (!blockedReason && currentFactConflict(p, candidate)) blockedReason = 'UNRESOLVED_FACT_CONFLICT';
    }
    const affected = evidenceSourceImpact(p, [evidence.id]);
    tasks.push({ id: `fact-source-reconfirmation:${fact.id}`, type: 'fact_source_reconfirmation', status: blockedReason ? 'blocked' : 'ready',
      factId: fact.id, evidenceId: evidence.id, materialId: evidence.materialSource.materialId, blockId: evidence.materialSource.blockId,
      ...(replacement ? { replacementEvidenceId: replacement.id } : {}),
      ...(blockedReason ? { blockedReason } : {}),
      affectedSectionIds: affected.affectedSectionIds.filter(id => p.sections.find(s => s.id === id)?.factIds.includes(fact.id)),
      affectedStoryboardIds: affected.affectedStoryboardIds.filter(id => [...(p.storyboard ? [p.storyboard] : []), ...(p.storyboardCandidates ?? [])]
        .some(b => b.id === id && b.chapters.some(c => c.factIds.includes(fact.id)))) });
  }
  return { projectId: p.id, projectVersion: p.version, revision: p.revision, tasks };
}
