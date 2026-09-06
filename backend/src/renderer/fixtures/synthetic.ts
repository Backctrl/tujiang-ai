import { readFile } from 'node:fs/promises';
import { canonicalJson, sha256 } from '../encoding.js';
import { RENDERER_INPUT_VERSION, RENDERER_VERSION, type RendererInput, type ResourceBundle, type VersionedRef } from '../model.js';

export const FIXTURE_FONT_HASH = '84366fc4ae40fc5cad8e51ed43a567ae8c7ebef9d30096ceec1b024d2ea08939';
export const FIXTURE_IMAGE_HASH = '4a9571a85aef2652e5feb20096731a29192f8a3e03cc1a91ef06160e182246e4';

async function fixtureRef(id: string, content: unknown): Promise<VersionedRef> {
  return { id, version: 'fixture-1', sha256: await sha256(canonicalJson(content)) };
}

/** Entirely synthetic; no AW product claims, production facts, approvals, or assets. */
export async function syntheticInput(): Promise<RendererInput> {
  const sourceRefs = [await fixtureRef('synthetic-source', 'Synthetic typography and layout test. No product evidence.')];
  const sections: RendererInput['sections'] = [{
    id: 'section-product-overview',
    frames: [{
      id: 'frame-carry', height: 880,
      blocks: [
        { id: 'block-title', kind: 'Heading', text: '轻量随行\nDAILY CARRY', sourceRefs },
        { id: 'block-photo', kind: 'Media', assetId: 'synthetic-bottle', alt: '合成产品图片 / Synthetic bottle', fit: 'contain', sourceRefs },
        { id: 'block-copy', kind: 'Copy', text: '这是一件用于 Renderer 验证的合成产品。保留中英文原文、数值和单位，不添加产品功效。\nA fixed image, exact copy, and a repeatable layout.', sourceRefs },
        { id: 'block-note', kind: 'Disclaimer', text: '审核样稿 · Synthetic fixture · 不代表真实产品', sourceRefs },
      ],
      layout: [
        { blockId: 'block-title', layer: 'foreground', x: 48, y: 36, width: 624, height: 136, padding: 0 },
        { blockId: 'block-photo', layer: 'foreground', x: 48, y: 188, width: 624, height: 416, padding: 0 },
        { blockId: 'block-copy', layer: 'foreground', x: 48, y: 632, width: 624, height: 170, padding: 0 },
        { blockId: 'block-note', layer: 'foreground', x: 48, y: 828, width: 624, height: 30, padding: 0 },
      ],
    }, {
      id: 'frame-specification', height: 680,
      blocks: [
        { id: 'block-spec-title', kind: 'Heading', text: '产品参数\nSPECIFICATION', sourceRefs },
        { id: 'block-table', kind: 'ParameterTable', rows: [{ label: '容量', value: '600 mL' }, { label: '材质', value: '合成测试素材' }, { label: '用途', value: '验证排版与图片绑定' }], sourceRefs },
        { id: 'block-spec-copy', kind: 'Copy', text: 'Every value above belongs to a synthetic fixture.\nKeep text and units unchanged during rendering.', sourceRefs },
        { id: 'block-spec-note', kind: 'Disclaimer', text: '审核样稿 · Synthetic fixture · 不代表真实产品', sourceRefs },
      ],
      layout: [
        { blockId: 'block-spec-title', layer: 'foreground', x: 48, y: 44, width: 624, height: 136, padding: 0 },
        { blockId: 'block-table', layer: 'foreground', x: 40, y: 204, width: 640, height: 216, padding: 0 },
        { blockId: 'block-spec-copy', layer: 'foreground', x: 48, y: 456, width: 624, height: 150, padding: 0 },
        { blockId: 'block-spec-note', layer: 'foreground', x: 48, y: 628, width: 624, height: 30, padding: 0 },
      ],
    }],
  }];
  const tokens = {
    fontId: 'fixture-sans',
    heading: { fontSize: 42, lineHeight: 64, letterSpacing: 0 },
    body: { fontSize: 24, lineHeight: 38, letterSpacing: 0 },
    caption: { fontSize: 16, lineHeight: 26, letterSpacing: 0 },
    colors: { background: '#fcfbf7', foreground: '#26382f', muted: '#657368', accent: '#526d5c', border: '#d7ddd4' },
  };
  const contentRef = await fixtureRef('synthetic-content', sections.map((s) => ({ id: s.id, frames: s.frames.map((f) => ({ id: f.id, blocks: f.blocks })) })));
  const layoutRef = await fixtureRef('synthetic-layout', sections.map((s) => ({ id: s.id, frames: s.frames.map((f) => ({ id: f.id, height: f.height, layout: f.layout })) })));
  const styleRef = await fixtureRef('synthetic-style', tokens);
  const ruleRef = await fixtureRef('synthetic-rule', 'Structure test only; no platform approval.');
  return {
    rendererInputVersion: RENDERER_INPUT_VERSION, rendererVersion: RENDERER_VERSION,
    snapshotRef: await fixtureRef('synthetic-snapshot', { contentRef, layoutRef, styleRef, ruleRef }),
    projectRef: await fixtureRef('synthetic-project', 'Renderer 4C1 fixture'),
    contentRef, layoutRef, ruleRef, canvas: { width: 720 },
    styleSnapshot: { ref: styleRef, ...tokens },
    assets: [{ id: 'synthetic-bottle', mime: 'image/png', sha256: FIXTURE_IMAGE_HASH }],
    fonts: [{ id: 'fixture-sans', mime: 'font/ttf', weight: 400, sha256: FIXTURE_FONT_HASH }],
    sections,
  };
}

export async function syntheticResources(): Promise<ResourceBundle> {
  return {
    'fixture-sans': await readFile(new URL('./fixture-sans-regular.ttf', import.meta.url)),
    'synthetic-bottle': await readFile(new URL('./synthetic-bottle.png', import.meta.url)),
  };
}
