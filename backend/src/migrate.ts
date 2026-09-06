import { postgres, migrate } from './database.js';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = postgres(process.env.DATABASE_URL);
  try { await migrate(db); console.info('Backend schema ready.'); }
  finally { await db.close(); }
}
main().catch(() => { console.error('Migration failed. Check DATABASE_URL and PostgreSQL availability.'); process.exitCode = 1; });
