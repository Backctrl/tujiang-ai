import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runEvaluation, runnerConfigSchema } from './runner.js';

const usage = 'npm run evaluate:runner -- <run.json> [--live]';
const runFileSchema = z.object({ config: runnerConfigSchema,
  fixtures: z.array(z.string().min(1)).min(1).max(100), capabilitiesFile: z.string().min(1).optional(),
}).strict();

export async function runCli(args: string[]): Promise<{ exitCode: number; report: unknown }> {
  try {
    if (args.length < 1 || args.length > 2 || args[0]!.startsWith('--') || (args[1] !== undefined && args[1] !== '--live')) throw new Error();
    const runPath = resolve(args[0]!);
    const readJson = async (path: string) => {
      const text = await readFile(path, 'utf8');
      if (Buffer.byteLength(text) > 2_000_000) throw new Error();
      return JSON.parse(text) as unknown;
    };
    const file = runFileSchema.parse(await readJson(runPath));
    const fixtures = await Promise.all(file.fixtures.map(path => readJson(resolve(dirname(runPath), path))));
    const live = args[1] === '--live';
    const capabilities = !live && file.capabilitiesFile ? await readJson(resolve(dirname(runPath), file.capabilitiesFile)) : undefined;
    const report = await runEvaluation(file.config, fixtures, { live, capabilities,
      environmentEnabled: () => process.env.TUJIANG_EVALUATION_LIVE === '1',
      getApiKey: () => process.env.OPENROUTER_API_KEY,
    });
    return { exitCode: ['dry_run', 'needs_human_review'].includes(report.status) ? 0 : report.status === 'blocked' ? 2 : 1, report };
  } catch {
    return { exitCode: 2, report: { status: 'input_error', code: 'INVALID_RUN_INPUT', businessAcceptance: false, usage } };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}
