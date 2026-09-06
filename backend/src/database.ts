import pg from 'pg';
import { bindRulePackVersion, type ProjectContextVersion } from './production-context.js';

export interface Connection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database extends Connection {
  transaction<T>(action: (connection: Connection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(url: string, onIdleError: () => void = () => {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000 });
  // pg removes the failed idle client itself; handle the event so restarts do not kill the process.
  // Do not forward Error/client objects: they can contain connection credentials.
  pool.on('error', () => onIdleError());
  return {
    query: (sql, params) => pool.query(sql, params),
    async transaction(action) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    // Serializes bootstrap migrations across API/Worker processes.
    await tx.query('SELECT pg_advisory_xact_lock(730105)');
    await tx.query(`CREATE TABLE IF NOT EXISTS projects (
      id uuid PRIMARY KEY, version integer NOT NULL CHECK (version > 0), state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await tx.query(`CREATE TABLE IF NOT EXISTS command_receipts (
      key text PRIMARY KEY, fingerprint text NOT NULL, response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await tx.query(`CREATE TABLE IF NOT EXISTS project_revisions (
      project_id uuid NOT NULL REFERENCES projects(id), revision integer NOT NULL,
      state jsonb NOT NULL, PRIMARY KEY(project_id, revision)
    )`);
    await tx.query(`CREATE TABLE IF NOT EXISTS production_rule_packs (
      id text NOT NULL, version text NOT NULL, sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
      rule_pack jsonb NOT NULL, registered_by text NOT NULL, registered_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(id,version)
    )`);
    // Backfill bindings without rewriting approved contexts, revisions or command receipts.
    const prior = await tx.query<{ versions: ProjectContextVersion[] }>(`SELECT state #> '{production,context,versions}' AS versions
      FROM projects WHERE jsonb_typeof(state #> '{production,context,versions}')='array'`);
    for (const project of prior.rows) for (const snapshot of project.versions) await bindRulePackVersion(tx, snapshot);
  });
}
