import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { syntheticInput, syntheticResources } from './fixtures/synthetic.js';
import { renderReviewSample } from './server.js';

// Development CLI: fixed synthetic input only. No domain integration, approvals, or formal Export.
const destination = resolve(process.argv[2] ?? '.data/renderer-review-samples');
await mkdir(destination, { recursive: true });
const input = await syntheticInput();
const bundle = await syntheticResources();
await writeFile(resolve(destination, 'input.json'), `${JSON.stringify(input, null, 2)}\n`);
const runs = [];
for (let i = 1; i <= 3; i++) {
  const result = await renderReviewSample(input, bundle);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  if (!result.ok) throw new Error('Render failed');
  const { html, frames, ...report } = result;
  await writeFile(resolve(destination, `review-${i}.html`), html);
  for (const frame of frames) await writeFile(resolve(destination, `review-${i}-${frame.frameId}.png`), frame.png);
  const summary = { ...report, frames: frames.map(({ png: _png, ...frame }) => frame) };
  await writeFile(resolve(destination, `review-${i}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  runs.push(summary);
}
for (const run of runs.slice(1)) {
  assert.equal(run.inputHash, runs[0]!.inputHash);
  assert.equal(run.htmlHash, runs[0]!.htmlHash);
  assert.equal(run.layoutHash, runs[0]!.layoutHash);
  assert.deepEqual(run.frames, runs[0]!.frames);
}
await writeFile(resolve(destination, 'consistency.json'), `${JSON.stringify({
  purpose: 'review-sample', passes: 3, inputHash: runs[0]!.inputHash,
  htmlHash: runs[0]!.htmlHash, layoutHash: runs[0]!.layoutHash,
  decodedPixelsEqual: true, pngBytesEqual: true, engine: runs[0]!.engine,
  frames: runs[0]!.frames, dependencies: runs[0]!.dependencies,
  unverified: ['cross-OS pixel equality', 'PDF', 'JPG', 'WebP output', 'formal Export', 'business approval'],
}, null, 2)}\n`);
console.log(JSON.stringify({ purpose: 'review-sample', passes: 3, destination, inputHash: runs[0]!.inputHash, htmlHash: runs[0]!.htmlHash, layoutHash: runs[0]!.layoutHash, frames: runs[0]!.frames }, null, 2));
