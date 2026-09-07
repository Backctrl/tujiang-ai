import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addStructuredFactCandidate,
  confirmStructuredFact,
  factSourceDetails,
  reconfirmStructuredFactSource,
  structuredSourceReconfirmIsUnchanged,
} from './fact-sources.js';
import {
  structuredFactCandidateSchema,
  structuredFactConfirmSchema,
  structuredFactSourceReconfirmSchema,
} from './production-fact-sources.js';
import type { Store } from './store.js';

const projectParams = z.object({ id: z.string().uuid() });
const factParams = projectParams.extend({ factId: z.string().uuid() });
const sourceParams = factParams.extend({ sourceId: z.string().uuid() });

export function registerFactSourceRoutes(app: FastifyInstance, store: Store, actor: string) {
  app.get('/api/projects/:id/facts/:factId/details', async request => {
    const { id, factId } = factParams.parse(request.params);
    return factSourceDetails(await store.get(id), factId);
  });
  app.post('/api/projects/:id/facts/structured/candidates', async request => {
    const { id } = projectParams.parse(request.params);
    const body = structuredFactCandidateSchema.parse(request.body);
    return store.command(id, body, 'fact.structured.candidate', actor, p => {
      addStructuredFactCandidate(p!, body, actor); return p!;
    });
  });
  app.post('/api/projects/:id/facts/:factId/structured/confirm', async request => {
    const { id, factId } = factParams.parse(request.params);
    const body = structuredFactConfirmSchema.parse(request.body);
    return store.command(id, body, `fact.${factId}.structured.confirm`, actor, p => {
      confirmStructuredFact(p!, factId, body, actor); return p!;
    });
  });
  app.post('/api/projects/:id/facts/:factId/sources/:sourceId/reconfirm', async request => {
    const { id, factId, sourceId } = sourceParams.parse(request.params);
    const body = structuredFactSourceReconfirmSchema.parse(request.body);
    return store.command(id, body, `fact.${factId}.source.${sourceId}.reconfirm`, actor, p => {
      reconfirmStructuredFactSource(p!, factId, sourceId, body, actor); return p!;
    }, { noChange: p => structuredSourceReconfirmIsUnchanged(p, factId, sourceId, body.evidenceId) });
  });
}
