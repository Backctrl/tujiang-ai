import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const exec = promisify(execFile);
const composeArgs = ['compose', '-p', 'tujiang-stage-a', '-f', 'compose.yaml'];
const schema = `tujiang_restart_${randomUUID().replaceAll('-', '')}`;
const marker = randomUUID();
let db;
let created = false;

async function ready() {
  const response = await fetch('http://127.0.0.1:3100/ready', {
    headers: { Authorization: `Bearer ${process.env.BACKEND_API_TOKEN}` },
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ready');
}
async function eventually(check) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { return await check(); } catch { await delay(500); }
  }
  throw new Error('LOCAL_RUNTIME_RECOVERY_FAILED');
}

try {
  if (!process.argv.includes('--restart')) throw new Error('EXPLICIT_RESTART_FLAG_REQUIRED');
  const address = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['127.0.0.1', 'localhost'].includes(address.hostname));
  assert.equal(address.port, '55432');
  assert.equal(address.pathname, '/tujiang');
  assert.ok(process.env.BACKEND_API_TOKEN);
  assert.match(schema, /^tujiang_restart_[a-f0-9]{32}$/);
  const { stdout } = await exec('docker', [...composeArgs, 'ps', '--format', 'json', 'postgres']);
  const container = JSON.parse(stdout.trim());
  assert.equal(container.Project, 'tujiang-stage-a');
  assert.equal(container.Service, 'postgres');
  assert.equal(container.State, 'running');
  assert.ok(container.Publishers.some(p => p.URL === '127.0.0.1' && p.PublishedPort === 55432 && p.TargetPort === 5432));
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
  // A restart can close idle probe connections; subsequent checks create fresh connections.
  db.on('error', () => {});
  await db.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  await db.query(`CREATE TABLE "${schema}".probe (marker text NOT NULL)`);
  await db.query(`INSERT INTO "${schema}".probe(marker) VALUES ($1)`, [marker]);
  await ready();
  console.info(JSON.stringify({ check: 'before_restart', passed: true }));
  await exec('docker', [...composeArgs, 'restart', 'postgres']);
  await eventually(async () => {
    const result = await db.query(`SELECT marker FROM "${schema}".probe`);
    assert.equal(result.rows[0]?.marker, marker);
  });
  console.info(JSON.stringify({ check: 'committed_data_after_database_restart', passed: true }));
  await eventually(ready);
  console.info(JSON.stringify({ check: 'backend_ready_after_database_restart', passed: true }));
} catch {
  console.error(JSON.stringify({ passed: false, error: 'LOCAL_RUNTIME_PROBE_FAILED',
    hint: 'Use the dedicated tujiang-stage-a Compose database and start the local backend on port 3100. Pass --restart explicitly.' }));
  process.exitCode = 1;
} finally {
  if (db) {
    if (created) {
      try { await db.query(`DROP SCHEMA "${schema}" CASCADE`); }
      catch { console.error(JSON.stringify({ cleanup: false, schema })); process.exitCode = 1; }
    }
    await db.end();
  }
}
