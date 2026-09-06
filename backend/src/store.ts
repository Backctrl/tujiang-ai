import { createHash, randomUUID } from 'node:crypto';
import type { Database, Connection } from './database.js';
import type { Project, AgentRun, ModelObservation } from './contracts.js';
import { AppError } from './errors.js';

export function audit(p: Project, type: string, actor: string, data: Record<string, unknown> = {}) {
  p.audit.push({ id: randomUUID(), projectVersion: p.version, revision: p.revision, type, actor, at: new Date().toISOString(), data });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export class Store {
  constructor(readonly db: Database) {}
  async list() {
    const { rows } = await this.db.query(`SELECT id, state->>'name' AS name, version,
      (state->>'revision')::integer AS revision, state->>'contractVersion' AS "contractVersion",
      updated_at AS "updatedAt" FROM projects ORDER BY updated_at DESC, id ASC`);
    return rows;
  }
  async get(id: string, tx: Connection = this.db, lock = false): Promise<Project> {
    const { rows } = await tx.query<{ state: Project }>(`SELECT state FROM projects WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
    if (!rows[0]) throw new AppError('PROJECT_NOT_FOUND', 404);
    return rows[0].state;
  }
  async save(p: Project, tx: Connection) {
    await tx.query(`INSERT INTO projects(id, version, state) VALUES ($1,$2,$3::jsonb)
      ON CONFLICT(id) DO UPDATE SET version=$2, state=$3::jsonb, updated_at=now()`, [p.id, p.version, JSON.stringify(p)]);
    await tx.query('INSERT INTO project_revisions(project_id,revision,state) VALUES ($1,$2,$3::jsonb)', [p.id, p.revision, JSON.stringify(p)]);
  }
  async command<Response = Project>(id: string | undefined, body: { expectedProjectVersion: number; expectedRevision: number; idempotencyKey: string }, operation: string, actor: string, change: (p: Project | undefined, tx: Connection) => Promise<Project> | Project, options: { preserveStageAInput?: boolean; noChange?: (p: Project, tx: Connection) => boolean | Promise<boolean>; response?: (p: Project) => Response } = {}): Promise<Response> {
    const key = `${actor}:${body.idempotencyKey}`;
    const fingerprint = createHash('sha256').update(canonical({ id, operation, body })).digest('hex');
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const prior = await tx.query<{ fingerprint: string; response: Response }>('SELECT fingerprint,response FROM command_receipts WHERE key=$1', [key]);
      if (prior.rows[0]) {
        if (prior.rows[0].fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT', 409);
        return prior.rows[0].response;
      }
      const current = id ? await this.get(id, tx, true) : undefined;
      const latest = { currentProjectVersion: current?.version ?? 0, currentRevision: current?.revision ?? 0 };
      if ((current?.version ?? 0) !== body.expectedProjectVersion) throw new AppError('VERSION_CONFLICT', 409, latest);
      if ((current?.revision ?? 0) !== body.expectedRevision) throw new AppError('REVISION_CONFLICT', 409, latest);
      if (current && await options.noChange?.(current, tx)) {
        const response = options.response ? options.response(current) : current as Response;
        await tx.query('INSERT INTO command_receipts(key,fingerprint,response) VALUES ($1,$2,$3::jsonb)', [key, fingerprint, JSON.stringify(response)]);
        return response;
      }
      if (current) { current.revision++; if (!options.preserveStageAInput) { current.inputRevision = current.revision; delete current.qa; } }
      const next = await change(current, tx);
      audit(next, operation, actor);
      await this.save(next, tx);
      const response = options.response ? options.response(next) : next as Response;
      await tx.query('INSERT INTO command_receipts(key,fingerprint,response) VALUES ($1,$2,$3::jsonb)', [key, fingerprint, JSON.stringify(response)]);
      return response;
    });
  }
  async claim(modelFor?: (skill: AgentRun['skill']) => string | undefined): Promise<{ project: Project; run: AgentRun } | undefined> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ state: Project }>(`SELECT state FROM projects
        WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(state->'runs') r
          WHERE r->>'queueStatus'='queued' OR
          (r->>'queueStatus'='claimed' AND (r->>'leaseUntil')::timestamptz < now()))
        ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      const p = rows[0]?.state;
      if (!p) return;
      const run = p.runs.find(r => r.queueStatus === 'queued' || (r.queueStatus === 'claimed' && Date.parse(r.leaseUntil ?? '') < Date.now()));
      if (!run) return;
      p.inputRevision ??= p.revision;
      p.revision++;
      delete p.qa;
      if (run.queueStatus === 'claimed') {
        run.queueStatus = 'done'; run.runStatus = 'failed'; run.errorCode = 'WORKER_INTERRUPTED';
        audit(p, 'run.interrupted', 'worker', { runId: run.id });
        await this.save(p, tx);
        return;
      }
      run.queueStatus = 'claimed'; run.runStatus = 'running'; run.contextVersion = p.version;
      run.contextRevision = p.revision;
      run.contextInputRevision = p.inputRevision;
      run.modelId = modelFor?.(run.skill);
      run.attempt++;
      run.leaseUntil = new Date(Date.now() + 120_000).toISOString();
      audit(p, 'run.started', 'worker', { runId: run.id, attempt: run.attempt });
      await this.save(p, tx);
      return { project: p, run };
    });
  }
  async finish(projectId: string, runId: string, attempt: number, apply: (p: Project, run: AgentRun) => void, observation?: ModelObservation) {
    await this.db.transaction(async tx => {
      const p = await this.get(projectId, tx, true);
      const run = p.runs.find(r => r.id === runId);
      if (!run) return;
      if (run.queueStatus !== 'claimed' || run.attempt !== attempt) {
        // A late charged response cannot change business output, but its cost must remain traceable.
        if (observation && !run.observations?.some(o => o.attempt === attempt)) {
          (run.observations ??= []).push({ ...observation, attempt });
          p.revision++;
          audit(p, 'run.late_observation', 'worker', { runId, attempt });
          await this.save(p, tx);
        }
        return;
      }
      apply(p, run);
      p.revision++; p.inputRevision = p.revision; delete p.qa;
      run.queueStatus = 'done'; delete run.leaseUntil;
      audit(p, `run.${run.runStatus}`, 'worker', { runId, attempt, errorCode: run.errorCode ?? null });
      await this.save(p, tx);
    });
  }
}
