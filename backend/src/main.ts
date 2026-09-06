import { config } from './config.js';
import { postgres } from './database.js';
import { Store } from './store.js';
import { LocalObjects } from './objects.js';
import { OpenRouter } from './openrouter.js';
import { Worker } from './worker.js';
import { buildApp } from './app.js';

async function main() {
  const env = config();
  const db = postgres(env.DATABASE_URL, () => console.error('Database idle connection closed; the next operation will reconnect.'));
  const store = new Store(db);
  const app = buildApp(store, new LocalObjects(env.OBJECT_DIR), { token: env.BACKEND_API_TOKEN, actor: env.BACKEND_ACTOR_ID });
  const worker = new Worker(store, new OpenRouter({ apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL,
    factModel: env.OPENROUTER_FACT_MODEL, planModel: env.OPENROUTER_PLAN_MODEL, timeoutMs: env.OPENROUTER_TIMEOUT_MS,
    provider: env.OPENROUTER_PROVIDER, maxInputTokens: env.OPENROUTER_MAX_INPUT_TOKENS,
    maxOutputTokens: env.OPENROUTER_MAX_OUTPUT_TOKENS, maxCostUsd: env.OPENROUTER_MAX_COST_USD,
    acceptEstimatedBudget: env.OPENROUTER_ACCEPT_ESTIMATED_BUDGET === 'true' }));
  await db.query('SELECT id FROM projects LIMIT 1');
  await app.listen({ host: '127.0.0.1', port: env.PORT });
  console.info(`Tujiang backend listening on http://127.0.0.1:${env.PORT}`);
  const running = worker.start(() => console.error('Worker tick failed; check database availability.'));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true; worker.stop();
    await app.close(); await running; await db.close();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
}
main().catch(() => { console.error('Backend startup failed. Check environment configuration, PostgreSQL and npm run migrate.'); process.exit(1); });
