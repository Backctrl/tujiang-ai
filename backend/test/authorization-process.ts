import { randomUUID } from 'node:crypto';
import { postgres } from '../src/database.js';
import { RunnerError } from '../src/model-policy.js';
import { ArtifactCipher } from '../evaluation/authorization-artifacts.js';
import { AuthorizationLedger } from '../evaluation/authorization-ledger.js';
import { itemFixture } from '../evaluation/authorization-input.js';
import { runEvaluation } from '../evaluation/runner.js';
import { artifactKey, authorizedCapabilities, capture, corePlan, goodResponse, managementLedger } from './authorization-helpers.js';

interface Input { mode: 'initialize' | 'reserve' | 'dispatch' | 'capture' | 'finish' | 'runner'; batchId?: string; itemId?: string }
const input = await new Promise<Input>(resolve => process.once('message', message => resolve(message as Input)));
const configured = process.env.TEST_DATABASE_URL; if (!configured) throw new Error('TEST_DATABASE_URL_REQUIRED');
const db = postgres(configured); const runner = AuthorizationLedger.forRunner(db, new ArtifactCipher(artifactKey));
const send = (value: unknown) => new Promise<void>((resolve, reject) => process.send?.(value, error => error ? reject(new Error('CHILD_IPC_FAILED')) : resolve()));
const pause = async (stage: string, value: object) => { await send({ event: 'checkpoint', stage, ...value }); await new Promise<void>(() => {}); };
try {
  if (input.mode === 'initialize') {
    const state = await managementLedger(db).initialize(); await send({ event: 'result', code: null, state });
  } else {
    const batchId = input.batchId!; const saved = await runner.reviewedBatch(batchId);
    if (input.mode === 'runner') {
      const report = await runEvaluation(saved.payload.config, saved.payload.items.map(itemFixture), {
        live: true, authorization: { ledger: runner, batchId, sources: saved.payload.sources },
        environmentEnabled: () => true, getApiKey: () => 'SYNTHETIC_SUBPROCESS_KEY', request: async (_url, init) => {
          if (init?.method === 'POST') {
            await send({ event: 'synthetic-post' }); return Response.json(goodResponse(saved.payload.config.modelId));
          }
          return Response.json(authorizedCapabilities);
        } });
      await send({ event: 'result', code: report.code ?? null, report });
    } else {
      const attempt = await runner.reserve(batchId, input.itemId ?? 'item-1', corePlan(saved.payload));
      const owner = randomUUID(); const checkpoint = { attemptId: attempt.id, owner, batchId };
      if (input.mode === 'reserve') await pause('reserved', checkpoint);
      const dispatch = await runner.beginDispatch(attempt.id, owner);
      if (!dispatch.claimed) { await send({ event: 'result', code: dispatch.code ?? 'NOT_CLAIMED' }); }
      else {
        if (input.mode === 'dispatch') await pause('dispatch_started', checkpoint);
        await send({ event: 'synthetic-post' });
        await runner.recordCapture(attempt.id, owner, capture(goodResponse(saved.payload.config.modelId)));
        if (input.mode === 'capture') await pause('response_captured', checkpoint);
        const result = await runner.finish(attempt.id, owner, { automaticChecksPassed: true, evaluation: { syntheticProcess: true } },
          { commandId: `finish-${attempt.id}` });
        await pause('finished', { ...checkpoint, result });
      }
    }
  }
} catch (error) { await send({ event: 'result', code: error instanceof RunnerError ? error.code : 'CHILD_FAILED' }); }
finally { await db.close(); process.disconnect?.(); }
