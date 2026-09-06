import assert from 'node:assert/strict';
import test from 'node:test';
import { compileReviewHtml } from '../src/renderer/compile.js';
import { canonicalJson, sha256 } from '../src/renderer/encoding.js';
import { syntheticInput, syntheticResources } from '../src/renderer/fixtures/synthetic.js';
import type { ContentBlock, RendererInput, ResourceBundle } from '../src/renderer/model.js';

async function rejection(input: unknown, expected: string, bundle?: ResourceBundle) {
  const result = await compileReviewHtml(input, bundle ?? await syntheticResources());
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((i) => i.code === expected), JSON.stringify(result.issues));
}

test('same normalized input and reordered object keys produce identical escaped HTML and hashes', async () => {
  const input = await syntheticInput();
  const bytes = await syntheticResources();
  const first = await compileReviewHtml(input, bytes);
  assert.ok(first.ok);
  const reordered = JSON.parse(canonicalJson(input));
  for (let i = 0; i < 2; i++) {
    const next = await compileReviewHtml(reordered, bytes);
    assert.deepEqual(next, first);
  }
  assert.equal(first.purpose, 'review-sample');
  assert.equal(first.status, 'compiled-unmeasured');
  assert.match(first.html, /script-src 'none'/);
  assert.doesNotMatch(first.html, /<script|style="|https?:\/\/|local\(/);
  assert.equal(first.inputHash, await sha256(canonicalJson(input)));
  assert.equal('approved' in first, false);
});

test('all 11 block kinds escape product text instead of executing raw HTML', async () => {
  const dangerous = `<script>globalThis.owned=1</script> & " ' <img src=x onerror=alert(1)>`;
  const common = { id: 'block-escape', sourceRefs: [] };
  const blocks: ContentBlock[] = [
    { ...common, kind: 'Heading', text: dangerous },
    { ...common, kind: 'Copy', text: dangerous },
    { ...common, kind: 'Disclaimer', text: dangerous },
    { ...common, kind: 'Media', assetId: 'synthetic-bottle', alt: dangerous, fit: 'contain' },
    { ...common, kind: 'Callout', title: dangerous, text: dangerous },
    { ...common, kind: 'Metric', value: dangerous, label: dangerous },
    { ...common, kind: 'ParameterTable', rows: [{ label: dangerous, value: dangerous }] },
    { ...common, kind: 'Proof', title: dangerous, text: dangerous, sourceLabel: dangerous },
    { ...common, kind: 'Comparison', columns: [dangerous, dangerous], rows: [{ label: dangerous, left: dangerous, right: dangerous }] },
    { ...common, kind: 'FeatureList', items: [dangerous] },
    { ...common, kind: 'Process', steps: [{ title: dangerous, text: dangerous }] },
  ];
  for (const block of blocks) {
    const input = await syntheticInput();
    input.sections = [{ id: 'section-escape', frames: [{ id: 'frame-escape', height: 600, blocks: [block], layout: [{ blockId: block.id, layer: 'foreground', x: 20, y: 20, width: 680, height: 550, padding: 8 }] }] }];
    const result = await compileReviewHtml(input, await syntheticResources());
    assert.ok(result.ok, block.kind);
    assert.match(result.html, /&lt;script&gt;globalThis.owned=1&lt;\/script&gt;/);
    assert.doesNotMatch(result.html, /<script>|<img src=x|alt="<|onerror="/);
  }
});

test('missing images, missing fonts, undeclared resources and hash mismatches are explicit', async () => {
  const input = await syntheticInput();
  const resources = await syntheticResources();
  await rejection(input, 'ASSET_MISSING', { 'fixture-sans': resources['fixture-sans']! });
  await rejection(input, 'FONT_MISSING', { 'synthetic-bottle': resources['synthetic-bottle']! });
  await rejection(input, 'UNDECLARED_RESOURCE', { ...resources, surprise: new Uint8Array([1]) });
  const changed = { ...resources, 'synthetic-bottle': Uint8Array.from(resources['synthetic-bottle']!) };
  changed['synthetic-bottle'][30] = changed['synthetic-bottle'][30]! ^ 1;
  await rejection(input, 'RESOURCE_HASH_MISMATCH', changed);
  input.assets = [];
  await rejection(input, 'ASSET_MISSING', resources);
});

test('bad fonts and missing glyphs cannot silently use a system font', async () => {
  const input = await syntheticInput();
  const resources = await syntheticResources();
  const brokenFont = new Uint8Array([0, 1, 2, 3]);
  input.fonts[0]!.sha256 = await sha256(brokenFont);
  await rejection(input, 'FONT_INVALID', { ...resources, 'fixture-sans': brokenFont });
  const missingGlyph = await syntheticInput();
  const block = missingGlyph.sections[0]!.frames[0]!.blocks[0]!;
  assert.equal(block.kind, 'Heading');
  if (block.kind === 'Heading') block.text = 'Robot 🤖';
  await rejection(missingGlyph, 'FONT_GLYPH_MISSING');
});

test('strict structured input rejects raw CSS/HTML, unknown fields, invalid numbers and local widths', async () => {
  const mutations: Array<(i: RendererInput) => void> = [
    (i) => Object.assign(i, { html: '<script>alert(1)</script>' }),
    (i) => Object.assign(i.styleSnapshot, { css: 'background:url(https://example.test)' }),
    (i) => { i.styleSnapshot.colors.foreground = 'red;display:none'; },
    (i) => Object.assign(i.sections[0]!, { width: 1 }),
    (i) => Object.assign(i.sections[0]!.frames[0]!, { width: 1 }),
    (i) => { i.sections[0]!.frames[0]!.layout[0]!.x = -1; },
    (i) => { i.sections[0]!.frames[0]!.layout[0]!.x = Number.NaN; },
    (i) => { i.sections[0]!.frames[0]!.layout[0]!.height = Infinity; },
    (i) => { i.contentRef.sha256 = 'unfrozen'; },
  ];
  for (const mutate of mutations) { const input = await syntheticInput(); mutate(input); await rejection(input, 'INVALID_INPUT'); }
});

test('layout rejects missing slots, duplicate IDs, excessive padding, foreground overlap and out-of-frame positions', async () => {
  for (const [code, mutate] of [
    ['INVALID_LAYOUT', (i: RendererInput) => { i.sections[0]!.frames[0]!.layout.pop(); }],
    ['DUPLICATE_ID', (i: RendererInput) => { i.sections[0]!.frames[1]!.id = i.sections[0]!.frames[0]!.id; }],
    ['INVALID_LAYOUT', (i: RendererInput) => { i.sections[0]!.frames[0]!.layout[0]!.padding = 80; }],
    ['LAYOUT_OVERLAP', (i: RendererInput) => { i.sections[0]!.frames[0]!.layout[1]!.y = 48; }],
    ['INVALID_LAYOUT', (i: RendererInput) => { i.sections[0]!.frames[0]!.layout[0]!.x = 700; }],
    ['INVALID_BACKGROUND', (i: RendererInput) => { i.sections[0]!.frames[0]!.layout[0]!.layer = 'background'; }],
  ] as const) { const input = await syntheticInput(); mutate(input); await rejection(input, code); }
});

test('one explicit background Media layer may overlap foreground text; Section count stays dynamic', async () => {
  const input = await syntheticInput();
  const frame = input.sections[0]!.frames[0]!;
  const photo = frame.layout[1]!;
  Object.assign(photo, { layer: 'background', x: 0, y: 0, width: 720, height: 880 });
  const compiled = await compileReviewHtml(input, await syntheticResources());
  assert.ok(compiled.ok);
  assert.match(compiled.html, /data-kind="Media" data-layer="background"/);
  const split = await syntheticInput();
  const secondFrame = split.sections[0]!.frames.pop()!;
  split.sections.push({ id: 'section-second-dynamic', frames: [secondFrame] });
  const dynamic = await compileReviewHtml(split, await syntheticResources());
  assert.ok(dynamic.ok);
  assert.notEqual(dynamic.inputHash, compiled.inputHash);
  assert.equal(dynamic.html.match(/<section data-section-id=/g)?.length, 2);
});
