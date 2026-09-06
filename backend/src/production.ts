import { AppError } from './errors.js';
import type { ProjectContext } from './production-context.js';
import type { Material } from './production-materials.js';
import type { MaterialAsset, MaterialReferenceBlock } from './production-material-usage.js';
import type { ProjectStartup } from './production-startup.js';
export const PRODUCTION_CONTRACT_VERSION = 'production.1';
export interface ProductionObject {
  id: string; kind: 'facts' | 'storyboard' | 'section' | 'market' | 'export'; revision: number;
  dependencies: { id: string; revision: number }[];
  freshness: 'current' | 'stale'; approvalStatus: 'draft' | 'in_review' | 'approved';
}
export interface Production {
  contractVersion: typeof PRODUCTION_CONTRACT_VERSION; objects: ProductionObject[]; context?: ProjectContext;
  materials?: Material[]; assets?: MaterialAsset[]; references?: MaterialReferenceBlock[];
  startup?: ProjectStartup;
}
export function initializeProduction(project: { production?: Production }): boolean {
  if (project.production) {
    if (project.production.contractVersion !== PRODUCTION_CONTRACT_VERSION) throw new AppError('UNSUPPORTED_PRODUCTION_CONTRACT', 409);
    return false;
  }
  project.production = { contractVersion: PRODUCTION_CONTRACT_VERSION, objects: [] };
  return true;
}
export function requireProduction(project: { production?: Production }): Production {
  if (!project.production) throw new AppError('PRODUCTION_NOT_INITIALIZED', 409);
  if (project.production.contractVersion !== PRODUCTION_CONTRACT_VERSION) throw new AppError('UNSUPPORTED_PRODUCTION_CONTRACT', 409);
  return project.production;
}
/** Future typed business commands invoke this; audit and queue changes do not. */
export function reviseProductionObject(production: Production, id: string, expectedRevision: number): void {
  const object = production.objects.find(item => item.id === id);
  if (!object) throw new AppError('PRODUCTION_OBJECT_NOT_FOUND', 404);
  if (object.revision !== expectedRevision) throw new AppError('PRODUCTION_REVISION_CONFLICT', 409);
  if (object.approvalStatus === 'approved') throw new AppError('APPROVED_PRODUCTION_OBJECT_IMMUTABLE', 409);
  object.revision++;
  object.approvalStatus = 'draft';
  refreshProductionDependencies(production);
}
export function refreshProductionDependencies(production: Production): void {
  let changed: boolean;
  do {
    changed = false;
    for (const object of production.objects) {
      if (object.freshness === 'stale') continue;
      if (object.dependencies.some(ref => {
        const upstream = production.objects.find(item => item.id === ref.id);
        return !upstream || upstream.revision !== ref.revision || upstream.freshness === 'stale';
      })) { object.freshness = 'stale'; changed = true; }
    }
  } while (changed);
}
