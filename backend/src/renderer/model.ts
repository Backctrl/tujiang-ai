import { z } from 'zod';

export const RENDERER_INPUT_VERSION = '1.0.0' as const;
export const RENDERER_VERSION = 'controlled-html/1.0.0' as const;
export const REVIEW_PURPOSE = 'review-sample' as const;

const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(8000).refine(
  (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value),
  'Text contains an unsupported control character or unpaired surrogate',
);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const px = z.number().int().min(0).max(8192);
const positivePx = z.number().int().min(1).max(8192);

export const versionedRefSchema = z.strictObject({
  id,
  version: z.string().min(1).max(80),
  sha256: hash,
});
export type VersionedRef = z.infer<typeof versionedRefSchema>;

const common = { id, sourceRefs: z.array(versionedRefSchema).max(64) };
const row = z.strictObject({ label: text, value: text });
export const contentBlockSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('Heading'), text }),
  z.strictObject({ ...common, kind: z.literal('Copy'), text }),
  z.strictObject({ ...common, kind: z.literal('Disclaimer'), text }),
  z.strictObject({ ...common, kind: z.literal('Media'), assetId: id, alt: text, fit: z.enum(['contain', 'cover']) }),
  z.strictObject({ ...common, kind: z.literal('Callout'), title: text, text }),
  z.strictObject({ ...common, kind: z.literal('Metric'), value: text, label: text }),
  z.strictObject({ ...common, kind: z.literal('ParameterTable'), rows: z.array(row).min(1).max(32) }),
  z.strictObject({ ...common, kind: z.literal('Proof'), title: text, text, sourceLabel: text }),
  z.strictObject({ ...common, kind: z.literal('Comparison'), columns: z.tuple([text, text]), rows: z.array(z.strictObject({ label: text, left: text, right: text })).min(1).max(32) }),
  z.strictObject({ ...common, kind: z.literal('FeatureList'), items: z.array(text).min(1).max(32) }),
  z.strictObject({ ...common, kind: z.literal('Process'), steps: z.array(z.strictObject({ title: text, text })).min(1).max(32) }),
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const placementSchema = z.strictObject({
  blockId: id,
  layer: z.enum(['background', 'foreground']),
  x: px,
  y: px,
  width: positivePx,
  height: positivePx,
  padding: z.number().int().min(0).max(128),
});
export type Placement = z.infer<typeof placementSchema>;

const typography = z.strictObject({
  fontSize: z.number().int().min(10).max(120),
  lineHeight: z.number().int().min(10).max(180),
  letterSpacing: z.number().min(0).max(8),
});

export const rendererInputSchema = z.strictObject({
  rendererInputVersion: z.literal(RENDERER_INPUT_VERSION),
  rendererVersion: z.literal(RENDERER_VERSION),
  snapshotRef: versionedRefSchema,
  projectRef: versionedRefSchema,
  contentRef: versionedRefSchema,
  layoutRef: versionedRefSchema,
  ruleRef: versionedRefSchema,
  canvas: z.strictObject({ width: z.number().int().min(240).max(4096) }),
  styleSnapshot: z.strictObject({
    ref: versionedRefSchema,
    fontId: id,
    heading: typography,
    body: typography,
    caption: typography,
    colors: z.strictObject({ background: color, foreground: color, muted: color, accent: color, border: color }),
  }),
  assets: z.array(z.strictObject({ id, sha256: hash, mime: z.enum(['image/png', 'image/jpeg', 'image/webp']) })).max(64),
  // v1 uses exactly one static, regular TTF. No local() or unpinned fallback fonts.
  fonts: z.array(z.strictObject({ id, sha256: hash, mime: z.literal('font/ttf'), weight: z.literal(400) })).length(1),
  sections: z.array(z.strictObject({
    id,
    frames: z.array(z.strictObject({
      id,
      height: z.number().int().min(120).max(8192),
      blocks: z.array(contentBlockSchema).min(1).max(80),
      layout: z.array(placementSchema).min(1).max(80),
    })).min(1).max(16),
  })).min(1).max(32),
});
export type RendererInput = z.infer<typeof rendererInputSchema>;
export type RendererFrame = RendererInput['sections'][number]['frames'][number];
export type ResourceBundle = Readonly<Record<string, Uint8Array>>;

export interface RendererIssue {
  code: string;
  severity: 'blocked';
  message: string;
  path: string;
  sectionId?: string;
  frameId?: string;
  blockId?: string;
}
export type RejectedRender = { ok: false; purpose: typeof REVIEW_PURPOSE; issues: RendererIssue[] };

export function issue(code: string, message: string, path: string, context: Partial<Pick<RendererIssue, 'sectionId' | 'frameId' | 'blockId'>> = {}): RendererIssue {
  return { code, severity: 'blocked', message, path, ...context };
}

export function blockText(block: ContentBlock): string[] {
  switch (block.kind) {
    case 'Heading': case 'Copy': case 'Disclaimer': return [block.text];
    case 'Media': return [block.alt];
    case 'Callout': return [block.title, block.text];
    case 'Metric': return [block.value, block.label];
    case 'ParameterTable': return block.rows.flatMap((r) => [r.label, r.value]);
    case 'Proof': return [block.title, block.text, block.sourceLabel];
    case 'Comparison': return [...block.columns, ...block.rows.flatMap((r) => [r.label, r.left, r.right])];
    case 'FeatureList': return block.items;
    case 'Process': return block.steps.flatMap((s) => [s.title, s.text]);
  }
}

export function validateStructure(input: RendererInput): RendererIssue[] {
  const issues: RendererIssue[] = [];
  const ids = new Set<string>();
  const addId = (value: string, path: string) => {
    if (ids.has(value)) issues.push(issue('DUPLICATE_ID', `ID must be unique: ${value}`, path));
    ids.add(value);
  };
  input.fonts.forEach((font, index) => addId(font.id, `fonts.${index}.id`));
  input.assets.forEach((asset, index) => addId(asset.id, `assets.${index}.id`));
  if (!input.fonts.some((font) => font.id === input.styleSnapshot.fontId)) {
    issues.push(issue('FONT_MISSING', 'Style font is not declared in fonts', 'styleSnapshot.fontId'));
  }
  for (const key of ['heading', 'body', 'caption'] as const) {
    const token = input.styleSnapshot[key];
    if (token.lineHeight < token.fontSize) issues.push(issue('INVALID_TYPOGRAPHY', 'Line height must be at least font size', `styleSnapshot.${key}`));
  }
  let totalHeight = 0;
  let totalFrames = 0;
  let totalCharacters = 0;
  input.sections.forEach((section, si) => {
    addId(section.id, `sections.${si}.id`);
    section.frames.forEach((frame, fi) => {
      const path = `sections.${si}.frames.${fi}`;
      const context = { sectionId: section.id, frameId: frame.id };
      addId(frame.id, `${path}.id`);
      totalHeight += frame.height;
      totalFrames += 1;
      const blocks = new Map(frame.blocks.map((block) => [block.id, block]));
      frame.blocks.forEach((block, bi) => {
        addId(block.id, `${path}.blocks.${bi}.id`);
        totalCharacters += blockText(block).join('').length;
        if (block.kind === 'Media' && !input.assets.some((asset) => asset.id === block.assetId)) {
          issues.push(issue('ASSET_MISSING', `Asset is not declared: ${block.assetId}`, `${path}.blocks.${bi}.assetId`, { ...context, blockId: block.id }));
        }
      });
      const placed = new Set<string>();
      let backgrounds = 0;
      frame.layout.forEach((placement, pi) => {
        const p = `${path}.layout.${pi}`;
        const ctx = { ...context, blockId: placement.blockId };
        if (!blocks.has(placement.blockId) || placed.has(placement.blockId)) {
          issues.push(issue('INVALID_LAYOUT', 'Each layout slot must refer to one unique block in this Frame', p, ctx));
        }
        placed.add(placement.blockId);
        if (placement.x + placement.width > input.canvas.width || placement.y + placement.height > frame.height
          || placement.padding * 2 >= placement.width || placement.padding * 2 >= placement.height) {
          issues.push(issue('INVALID_LAYOUT', 'Slot or padding exceeds its Frame or content bounds', p, ctx));
        }
        if (placement.layer === 'background') {
          backgrounds += 1;
          if (blocks.get(placement.blockId)?.kind !== 'Media') issues.push(issue('INVALID_BACKGROUND', 'Background layer only accepts Media', p, ctx));
        }
      });
      if (backgrounds > 1) issues.push(issue('INVALID_BACKGROUND', 'v1 allows at most one explicit background Media layer per Frame', `${path}.layout`, context));
      frame.blocks.forEach((block) => {
        if (!placed.has(block.id)) issues.push(issue('INVALID_LAYOUT', 'Block has no layout slot', `${path}.layout`, { ...context, blockId: block.id }));
      });
      const foreground = frame.layout.filter((p) => p.layer === 'foreground');
      foreground.forEach((a, ai) => foreground.slice(ai + 1).forEach((b) => {
        if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) {
          issues.push(issue('LAYOUT_OVERLAP', `Foreground blocks overlap: ${a.blockId}, ${b.blockId}`, `${path}.layout`, { ...context, blockId: a.blockId }));
        }
      }));
    });
  });
  if (totalFrames > 32 || totalHeight > 32000 || totalHeight * input.canvas.width > 24_000_000 || totalCharacters > 100_000) {
    issues.push(issue('RENDER_LIMIT_EXCEEDED', 'Review batch exceeds 32 Frames, 32000px height, 24M canvas pixels, or 100000 characters', 'sections'));
  }
  return issues;
}
