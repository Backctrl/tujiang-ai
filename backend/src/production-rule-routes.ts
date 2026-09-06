import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from './errors.js';
import { hashRulePack, isScopedRulePack, storedRulePackSchema } from './production-context.js';
import { checkScopedRuleInputs, ruleCheckSchema } from './production-rules.js';
import { requireProduction } from './production.js';
import type { Store } from './store.js';

export function registerProductionRuleRoutes(app: FastifyInstance, store: Store) {
  app.post('/api/projects/:id/production/rules/check', async request => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = ruleCheckSchema.parse(request.body);
    const project = await store.get(id);
    const snapshot = requireProduction(project).context?.versions.find(version => version.version === body.contextVersion);
    if (!snapshot) throw new AppError('CONTEXT_VERSION_NOT_FOUND', 404);
    const pack = storedRulePackSchema.parse(snapshot.rulePack);
    if (hashRulePack(pack) !== snapshot.rulePackSha256) throw new AppError('RULE_PACK_SNAPSHOT_INVALID', 409);
    if (!isScopedRulePack(pack)) throw new AppError('SCOPED_RULE_PACK_REQUIRED', 409, { fields: ['contextVersion'] });
    const findings = checkScopedRuleInputs(pack, snapshot.context, body);
    return { kind: 'rule_input_check', projectId: id, contextVersion: snapshot.version,
      rulePackRef: { id: pack.id, version: pack.version }, rulePackSha256: snapshot.rulePackSha256,
      issueSeverity: findings.some(f => f.severity === 'blocker') ? 'blocker' : findings.length ? 'warning' : 'none',
      findings, notChecked: ['module_structure', 'confirmed_facts', 'language', 'actual_files', 'local_export_files', 'formal_approval', 'platform_publication'],
    };
  });
}
