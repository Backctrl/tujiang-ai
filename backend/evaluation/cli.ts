import { readFile } from 'node:fs/promises';
import { evaluate } from './evaluate.js';

try {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw new Error('USAGE');
  const [fixture, output] = await Promise.all(args.map(async path => JSON.parse(await readFile(path!, 'utf8')) as unknown));
  const report = evaluate(fixture, output);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.automaticChecksPassed ? 0 : 1;
} catch {
  // Do not echo model contents, file contents, or provider error bodies.
  process.stdout.write(`${JSON.stringify({ verdict: 'input_error', code: 'INVALID_EVALUATION_INPUT', usage: 'tsx evaluation/cli.ts <fixture.json> <model-output.json>' })}\n`);
  process.exitCode = 2;
}
