import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvaluation } from './runner.js';
import { readRunInputs } from './authorization-input.js';
import { openEvaluationLedger } from './authorization-environment.js';
import { RunnerError } from '../src/model-policy.js';
import { z } from 'zod';

const usage = 'npm run evaluate:runner -- <run.json> [--live --batch <approved-batch-id>]';

export async function runCli(args: string[]): Promise<{ exitCode: number; report: unknown }> {
  let connection: ReturnType<typeof openEvaluationLedger> | undefined;
  try {
    if (!args[0] || args[0].startsWith('--') || ![1, 2, 4].includes(args.length) ||
        args.length > 1 && args[1] !== '--live' || args.length === 4 && args[2] !== '--batch') throw new Error();
    const inputs = await readRunInputs(args[0]); const live = args[1] === '--live';
    if (live && args.length !== 4) throw new RunnerError('AUTHORIZATION_REQUIRED');
    const batchId = live ? z.string().uuid().parse(args[3]) : undefined;
    if (live) connection = openEvaluationLedger('runner');
    const report = await runEvaluation(inputs.config, inputs.fixtures, { live, capabilities: inputs.capabilities,
      ...(connection && batchId ? { authorization: { ledger: connection.ledger, batchId, sources: inputs.sources } } : {}),
      environmentEnabled: () => process.env.TUJIANG_EVALUATION_LIVE === '1',
      getApiKey: () => process.env.OPENROUTER_API_KEY,
    });
    return { exitCode: ['dry_run', 'needs_human_review'].includes(report.status) ? 0 : report.status === 'blocked' ? 2 : 1, report };
  } catch (error) {
    return { exitCode: 2, report: { status: 'input_error', code: error instanceof RunnerError ? error.code : 'INVALID_RUN_INPUT', businessAcceptance: false, usage } };
  } finally { await connection?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}
