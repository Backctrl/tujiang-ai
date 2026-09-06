// Isolated synthetic runtime: ephemeral PGlite, no .env, no network model gateway.
import { fixture, extraction, plan } from '../test/helpers.js';
import { Worker } from '../src/worker.js';

const f = await fixture();
const worker = new Worker(f.store, { generate: async (skill, project) => {
  if (skill === 'extract-facts') {
    if (!project.evidence[0]?.text.includes('10 kg')) return { facts: [] };
    return extraction(project);
  }
  return plan(project);
} });
await f.app.listen({ port: 4311, host: '127.0.0.1' });
console.log('SYNTHETIC ONLY | http://127.0.0.1:4311 | ephemeral database; no paid calls');
console.log(`Test connection token: ${f.headers.authorization.slice(7)}`);
void worker.start(() => console.error('Synthetic worker error'));
let closing = false;
async function close() { if (closing) return; closing = true; worker.stop(); await f.close(); }
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
