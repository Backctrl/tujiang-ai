import { config } from './config.js';
import { postgres } from './database.js';
import { Store } from './store.js';
import { LocalObjects } from './objects.js';
import { OpenRouter } from './openrouter.js';
import { Worker } from './worker.js';
import { buildApp } from './app.js';
import { loadProductionCatalog } from './production-context.js';
import { IngestionWorker } from './ingestion-worker.js';

async function main() {
  const env = config();
  const productionCatalog = await loadProductionCatalog(env.PRODUCTION_CATALOG_PATH);
  const db = postgres(env.DATABASE_URL, () => console.error('Database idle connection closed; the next operation will reconnect.'));
  const store = new Store(db);
  const objects = new LocalObjects(env.OBJECT_DIR);
  const modelConfig = { apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL,
    factModel: env.OPENROUTER_FACT_MODEL, planModel: env.OPENROUTER_PLAN_MODEL, timeoutMs: env.OPENROUTER_TIMEOUT_MS,
    provider: env.OPENROUTER_PROVIDER, maxInputTokens: env.OPENROUTER_MAX_INPUT_TOKENS,
    maxOutputTokens: env.OPENROUTER_MAX_OUTPUT_TOKENS, maxCostUsd: env.OPENROUTER_MAX_COST_USD,
    acceptEstimatedBudget: env.OPENROUTER_ACCEPT_ESTIMATED_BUDGET === 'true' };
  const app = buildApp(store, objects, { token: env.BACKEND_API_TOKEN, actor: env.BACKEND_ACTOR_ID,
    productionCatalog, startupExecution: { mode: 'openrouter', workerEnabled: true, modelConfig } });
  const worker = new Worker(store, new OpenRouter(modelConfig));
  await db.query('SELECT id FROM projects LIMIT 1');
  await app.listen({ host: '127.0.0.1', port: env.PORT });
  console.info(`Tujiang backend listening on http://127.0.0.1:${env.PORT}`);
  const running = worker.start(() => console.error('Worker tick failed; check database availability.'));
  const ingestionWorker = new IngestionWorker(store, objects);
  const ingesting = ingestionWorker.start(() => console.error('Material parser tick failed; check database and file availability.'));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true; worker.stop(); ingestionWorker.stop();
    await app.close(); await Promise.all([running, ingesting]); await db.close();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
}
main().catch(() => { console.error('Backend startup failed. Check environment configuration, production catalog, PostgreSQL and npm run migrate.'); process.exit(1); });
