import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { factSourceReconfirmIsUnchanged, reconfirmFactSource, refreshConflicts } from './domain.js';
import { materialModelInputHash } from './material-source-gates.js';
import { materialReviewCenter, materialUsageIsUnchanged, reviewMaterialUsage } from './material-usage.js';
import { factSourceReconfirmSchema, materialUsageSchema } from './production-material-usage.js';
import type { LocalObjects } from './objects.js';
import type { Store } from './store.js';

const projectParams = z.object({ id: z.string().uuid() });
export function registerMaterialUsageRoutes(app: FastifyInstance, store: Store, objects: LocalObjects, actor: string) {
  app.get('/api/projects/:id/production/material-reviews', async request => {
    const { id } = projectParams.parse(request.params);
    return materialReviewCenter(await store.get(id));
  });
  app.post('/api/projects/:id/production/materials/:materialId/usage', async request => {
    const { id, materialId } = projectParams.extend({ materialId: z.string().uuid() }).parse(request.params);
    const body = materialUsageSchema.parse(request.body);
    return store.command(id, body, `material.${materialId}.usage`, actor, async p => {
      const before = materialModelInputHash(p!);
      await reviewMaterialUsage(p!, materialId, body, actor, objects);
      refreshConflicts(p!);
      if (before !== materialModelInputHash(p!)) { p!.inputRevision = p!.revision; delete p!.qa; }
      return p!;
    }, { preserveStageAInput: true, noChange: p => materialUsageIsUnchanged(p, materialId, body) });
  });
  app.post('/api/projects/:id/facts/:factId/source/reconfirm', async request => {
    const { id, factId } = projectParams.extend({ factId: z.string().uuid() }).parse(request.params);
    const body = factSourceReconfirmSchema.parse(request.body);
    return store.command(id, body, `fact.${factId}.source.reconfirm`, actor, p => {
      reconfirmFactSource(p!, factId, body.evidenceId, body.reason, actor); return p!;
    }, { noChange: p => factSourceReconfirmIsUnchanged(p, factId, body.evidenceId) });
  });
}
