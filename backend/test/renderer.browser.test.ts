import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { compileReviewHtml } from '../src/renderer/compile.js';
import { sha256 } from '../src/renderer/encoding.js';
import { syntheticInput, syntheticResources } from '../src/renderer/fixtures/synthetic.js';
import { ENGINE_PROFILE, renderReviewSample } from '../src/renderer/server.js';

test('the shared compiler executes in a real browser and emits byte-identical HTML and inputHash to Node', { timeout: 30000 }, async () => {
  const input = await syntheticInput();
  const resources = await syntheticResources();
  const expected = await compileReviewHtml(input, resources);
  assert.ok(expected.ok);
  const script = await build({ entryPoints: [fileURLToPath(new URL('../src/renderer/compile.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'iife', globalName: 'RendererCompile', target: 'es2023', write: false });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    // Virtual localhost is a secure WebCrypto origin. Route fulfills from memory; no server/network IO.
    await context.route('**/*', async (route) => {
      if (route.request().url() === 'http://localhost/renderer-compile-fixture') await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Compiler fixture</title>' });
      else await route.abort();
    });
    const page = await context.newPage();
    await page.goto('http://localhost/renderer-compile-fixture');
    await page.addScriptTag({ content: script.outputFiles[0]!.text });
    const actual = await page.evaluate(async ({ frozenInput, bytes }) => {
      const bundle = Object.fromEntries(Object.entries(bytes).map(([id, value]) => [id, Uint8Array.from(value)]));
      return (globalThis as unknown as { RendererCompile: { compileReviewHtml: typeof compileReviewHtml } }).RendererCompile.compileReviewHtml(frozenInput, bundle);
    }, { frozenInput: input, bytes: Object.fromEntries(Object.entries(resources).map(([id, bytes]) => [id, Array.from(bytes)])) });
    assert.deepEqual(actual, expected);
  } finally {
    await browser.close();
  }
});

test('fixed Chromium renders 1 bilingual Section and 2 Frames three times with identical HTML, layout and decoded pixels', { timeout: 90000 }, async () => {
  const input = await syntheticInput();
  const resources = await syntheticResources();
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const result = await renderReviewSample(input, resources);
    assert.ok(result.ok, JSON.stringify(result.ok ? null : result.issues));
    assert.equal(result.frames.length, 2);
    assert.equal(result.inspection.issues.length, 0);
    assert.equal(result.inspection.fonts[0]!.status, 'loaded');
    assert.equal(result.inspection.images[0]!.width, 600);
    assert.equal(result.engine.browserVersion, ENGINE_PROFILE.browserVersion);
    assert.equal(result.purpose, 'review-sample');
    assert.equal('approved' in result, false);
    runs.push(result);
  }
  for (const result of runs.slice(1)) {
    assert.equal(result.inputHash, runs[0]!.inputHash);
    assert.equal(result.html, runs[0]!.html);
    assert.equal(result.htmlHash, runs[0]!.htmlHash);
    assert.equal(result.layoutHash, runs[0]!.layoutHash);
    assert.deepEqual(result.inspection, runs[0]!.inspection);
    assert.deepEqual(result.frames, runs[0]!.frames);
  }
});

test('real browser text measurement rejects overflow rather than silently clipping or shrinking', { timeout: 30000 }, async () => {
  const input = await syntheticInput();
  input.sections[0]!.frames[0]!.layout[2]!.height = 30;
  const result = await renderReviewSample(input, await syntheticResources());
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'CONTENT_OVERFLOW' && i.blockId === 'block-copy'), JSON.stringify(result.issues));
  assert.equal('frames' in result, false);
});

test('browser refuses a font with valid cmap but corrupted TrueType head table', { timeout: 30000 }, async () => {
  const input = await syntheticInput();
  const original = await syntheticResources();
  const font = Uint8Array.from(original['fixture-sans']!);
  const view = new DataView(font.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(...font.subarray(at, at + 4)) === 'head') view.setUint32(view.getUint32(at + 8) + 12, 0);
  }
  input.fonts[0]!.sha256 = await sha256(font);
  const resources = { ...original, 'fixture-sans': font };
  const compiled = await compileReviewHtml(input, resources);
  assert.ok(compiled.ok, 'cmap check alone must not be treated as successful font loading');
  const result = await renderReviewSample(input, resources);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'FONT_LOAD_FAILED'), JSON.stringify(result.issues));
  assert.equal('frames' in result, false);
});

test('truncated image with an updated hash fails decoding and produces no review PNG', { timeout: 30000 }, async () => {
  const input = await syntheticInput();
  const original = await syntheticResources();
  const image = original['synthetic-bottle']!.subarray(0, 33);
  input.assets[0]!.sha256 = await sha256(image);
  const result = await renderReviewSample(input, { ...original, 'synthetic-bottle': image });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((i) => i.code === 'IMAGE_DECODE_FAILED'), JSON.stringify(result.issues));
});
