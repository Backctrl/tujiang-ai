import { randomUUID } from 'node:crypto';
import type { Project } from '../../src/contracts.js';
import type { CompleteContext, ContextDraft } from '../../src/production-context.js';
import { fixture, command } from '../helpers.js';
import { context, rule } from './production-context.js';
import { scopedContext, scopedRule, headerScope } from './scoped-rules.js';

// Manual browser fixture only: no production configuration, model worker, or persistent database.
const smoke = process.argv.slice(2).includes('--smoke');
if (process.argv.slice(2).some(arg => arg !== '--smoke')) throw new Error('Only --smoke is supported');
const port = Number(process.env.SCOPED_FIXTURE_PORT ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('SCOPED_FIXTURE_PORT must be 0-65535');
const f = await fixture({ rulePacks: [rule], scopedRulePacks: [scopedRule] });
try {
  const baseUrl = await f.app.listen({ host: '127.0.0.1', port });
  async function request<T>(path: string, payload?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, { method: payload === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { ...f.headers, 'content-type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    if (!response.ok) throw new Error(`Synthetic browser fixture HTTP ${response.status}: ${path}`);
    return response.json() as Promise<T>;
  }
  async function write(project: Project, route: string, body: Record<string, unknown> = {}) {
    return request<Project>(`/api/projects/${project.id}/${route}`, command(project, body));
  }
  async function create(name: string, versions: CompleteContext[], draft?: ContextDraft) {
    let project = await request<Project>('/api/projects', { name: `SYNTHETIC UI — ${name}`,
      expectedProjectVersion: 0, expectedRevision: 0, idempotencyKey: randomUUID() });
    project = await write(project, 'production/initialize');
    for (const value of versions) {
      project = await write(project, 'production/context/draft', { context: value });
      project = await write(project, 'production/context/activate');
    }
    if (draft) project = await write(project, 'production/context/draft', { context: draft });
    return request<Project>(`/api/projects/${project.id}`);
  }
  const scenarios = [
    { case: 'scoped_active', project: await create('scoped active', [scopedContext]) },
    { case: 'scoped_draft_over_legacy', project: await create('scoped draft over legacy', [context],
      { ...scopedContext, productBrief: { ...scopedContext.productBrief, productName: 'Scoped saved draft, not the legacy active product' } }) },
    { case: 'partial_scoped_draft', project: await create('partial scoped draft', [],
      { productBrief: { productName: 'Partial scoped draft without active context' }, primaryTarget: { contentType: 'amazon_basic_aplus' } }) },
    { case: 'scoped_history_legacy_active', project: await create('legacy active with scoped history', [scopedContext, context]) },
  ];
  const active = scenarios[0]!.project;
  const checkRequest = { contextVersion: 1, subjects: [{ id: 'header-preview', scope: headerScope, values: { widthPx: 1200, heightPx: 700, format: 'png' } }] };
  const check = await request<{ issueSeverity: string }>(`/api/projects/${active.id}/production/rules/check`, checkRequest);
  if (check.issueSeverity !== 'none') throw new Error('Synthetic scoped input should satisfy the scoped fixture');
  console.log(JSON.stringify({ kind: 'synthetic_browser_fixture', temporaryDatabase: 'PGlite in memory', baseUrl,
    token: f.headers.authorization.slice(7), projects: scenarios.map(({ case: name, project }) => ({ case: name,
      id: project.id, name: project.name, version: project.version, revision: project.revision,
      activeContextVersion: project.production!.context?.activeVersion ?? null })),
    checkPath: `/api/projects/${active.id}/production/rules/check`, checkRequest }, null, 2));
  if (!smoke) {
    console.log('Synthetic fixture ready. Use the printed temporary token in the workbench. Ctrl+C closes it and removes temporary files.');
    await new Promise<void>(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally { await f.close(); }
