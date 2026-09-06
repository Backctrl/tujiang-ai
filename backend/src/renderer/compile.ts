import { base64, canonicalJson, escapeHtml as e, fontHasGlyphs, hashBase64, sha256 } from './encoding.js';
import { blockText, issue, rendererInputSchema, REVIEW_PURPOSE, validateStructure, type ContentBlock, type RejectedRender, type RendererInput, type RendererIssue, type ResourceBundle } from './model.js';

export interface CompiledReviewHtml {
  ok: true;
  purpose: typeof REVIEW_PURPOSE;
  status: 'compiled-unmeasured';
  input: RendererInput;
  inputHash: string;
  htmlHash: string;
  html: string;
}

function checkImageSignature(bytes: Uint8Array, mime: string): string | undefined {
  if (mime === 'image/png') {
    if (bytes.length < 33 || base64(bytes.subarray(0, 8)) !== 'iVBORw0KGgo=') return 'Invalid PNG signature';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = 8; at + 12 <= bytes.length;) {
      const length = view.getUint32(at);
      if (at + 12 + length > bytes.length) return 'Truncated PNG chunk';
      if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'acTL') return 'Animated images are not supported';
      at += length + 12;
    }
  } else if (mime === 'image/jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return 'Invalid JPEG signature';
  } else {
    if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return 'Invalid WebP signature';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let at = 12; at + 8 <= bytes.length;) {
      const kind = String.fromCharCode(...bytes.subarray(at, at + 4));
      const length = view.getUint32(at + 4, true);
      if (at + 8 + length > bytes.length) return 'Truncated WebP chunk';
      if (kind === 'ANIM' || kind === 'ANMF') return 'Animated images are not supported';
      at += 8 + length + (length % 2);
    }
  }
  return undefined;
}

const paragraph = (text: string, cls = 'body') => `<p class="${cls}">${e(text)}</p>`;

function blockHtml(block: ContentBlock, resources: Map<string, string>): string {
  switch (block.kind) {
    case 'Heading': return `<h2 class="heading">${e(block.text)}</h2>`;
    case 'Copy': return paragraph(block.text);
    case 'Disclaimer': return paragraph(block.text, 'caption muted');
    case 'Media': return `<img class="media fit-${block.fit}" src="${resources.get(block.assetId)!}" alt="${e(block.alt)}" decoding="sync">`;
    case 'Callout': return `<h3 class="body accent">${e(block.title)}</h3>${paragraph(block.text)}`;
    case 'Metric': return `${paragraph(block.value, 'heading accent')}${paragraph(block.label)}`;
    case 'ParameterTable': return `<table class="body"><tbody>${block.rows.map((row) => `<tr><th scope="row">${e(row.label)}</th><td>${e(row.value)}</td></tr>`).join('')}</tbody></table>`;
    case 'Proof': return `<h3 class="body">${e(block.title)}</h3>${paragraph(block.text)}${paragraph(block.sourceLabel, 'caption muted')}`;
    case 'Comparison': return `<table class="body comparison"><thead><tr><td></td><th scope="col">${e(block.columns[0])}</th><th scope="col">${e(block.columns[1])}</th></tr></thead><tbody>${block.rows.map((row) => `<tr><th scope="row">${e(row.label)}</th><td>${e(row.left)}</td><td>${e(row.right)}</td></tr>`).join('')}</tbody></table>`;
    // No browser-generated list markers: every visible glyph is included in coverage checks.
    case 'FeatureList': return `<ul class="body">${block.items.map((item) => `<li>${e(item)}</li>`).join('')}</ul>`;
    case 'Process': return `<ol class="body">${block.steps.map((step) => `<li><p>${e(step.title)}</p><p>${e(step.text)}</p></li>`).join('')}</ol>`;
  }
}

/** One compiler for both browser preview and server review samples. No file/network/AI IO. */
export async function compileReviewHtml(rawInput: unknown, bundle: ResourceBundle): Promise<CompiledReviewHtml | RejectedRender> {
  const parsed = rendererInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, purpose: REVIEW_PURPOSE, issues: parsed.error.issues.map((problem) => issue('INVALID_INPUT', problem.message, problem.path.join('.'))) };
  const input = parsed.data;
  const issues: RendererIssue[] = validateStructure(input);
  if (issues.length) return { ok: false, purpose: REVIEW_PURPOSE, issues };
  const declarations = [...input.fonts, ...input.assets];
  const resourceBytes = new Map<string, Uint8Array>();
  const resources = new Map<string, string>();
  let byteCount = 0;
  // Copy before the first await, so mutation by the caller cannot race hash checking.
  for (const resource of declarations) {
    const bytes = bundle[resource.id];
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      issues.push(issue(resource.mime === 'font/ttf' ? 'FONT_MISSING' : 'ASSET_MISSING', `Missing resource bytes: ${resource.id}`, `resources.${resource.id}`));
    } else if (bytes.length > 24_000_000) {
      issues.push(issue('RESOURCE_LIMIT_EXCEEDED', 'Each resource is limited to 24MB', `resources.${resource.id}`));
    } else {
      resourceBytes.set(resource.id, Uint8Array.from(bytes));
      byteCount += bytes.length;
    }
  }
  if (byteCount > 48_000_000) issues.push(issue('RESOURCE_LIMIT_EXCEEDED', 'Resource bundle is limited to 48MB', 'resources'));
  for (const key of Object.keys(bundle)) {
    if (!declarations.some((resource) => resource.id === key)) issues.push(issue('UNDECLARED_RESOURCE', `Resource has no hash declaration: ${key}`, `resources.${key}`));
  }
  if (issues.length) return { ok: false, purpose: REVIEW_PURPOSE, issues };
  for (const resource of declarations) {
    const bytes = resourceBytes.get(resource.id)!;
    if (await sha256(bytes) !== resource.sha256) {
      issues.push(issue('RESOURCE_HASH_MISMATCH', `Resource hash mismatch: ${resource.id}`, `resources.${resource.id}`));
      continue;
    }
    if (resource.mime !== 'font/ttf') {
      const error = checkImageSignature(bytes, resource.mime);
      if (error) issues.push(issue('ASSET_INVALID', error, `resources.${resource.id}`));
    }
    resources.set(resource.id, `data:${resource.mime};base64,${base64(bytes)}`);
  }
  if (issues.length) return { ok: false, purpose: REVIEW_PURPOSE, issues };
  const allText = input.sections.flatMap((s) => s.frames.flatMap((f) => f.blocks.flatMap(blockText))).join('');
  try {
    const missing = fontHasGlyphs(resourceBytes.get(input.styleSnapshot.fontId)!, allText);
    if (missing.length) issues.push(issue('FONT_GLYPH_MISSING', `Font lacks glyphs: ${missing.slice(0, 16).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(', ')}`, 'styleSnapshot.fontId'));
  } catch (error) {
    issues.push(issue('FONT_INVALID', error instanceof Error ? error.message : 'Invalid font', 'styleSnapshot.fontId'));
  }
  if (issues.length) return { ok: false, purpose: REVIEW_PURPOSE, issues };

  const inputHash = await sha256(canonicalJson(input));
  const style = input.styleSnapshot;
  const css = [
    `@font-face{font-family:"render-${style.fontId}";src:url("${resources.get(style.fontId)}") format("truetype");font-style:normal;font-weight:400;font-display:block;}`,
    `*{box-sizing:border-box;}html,body{margin:0;padding:0;}body{font-family:"render-${style.fontId}";font-weight:400;font-style:normal;font-synthesis:none;font-kerning:normal;color:${style.colors.foreground};background:${style.colors.background};}`,
    `[data-render-root]{width:${input.canvas.width}px;}[data-section-id]{position:relative;}[data-frame-id]{position:relative;width:${input.canvas.width}px;isolation:isolate;background:${style.colors.background};}`,
    `[data-block-id]{position:absolute;overflow:visible;}[data-content]{width:100%;min-width:0;}[data-layer="background"]{z-index:0;}[data-layer="foreground"]{z-index:1;}`,
    `p,h2,h3,ul,ol{margin:0;padding:0;font-weight:400;}p,h2,h3,li,td,th{white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;}ul,ol{list-style:none;}li+li{margin-top:8px;}`,
    `table{width:100%;border-collapse:collapse;table-layout:fixed;}th,td{font-weight:400;text-align:left;vertical-align:top;border-bottom:1px solid ${style.colors.border};padding:12px 8px;}th{width:32%;}.comparison th{width:33.333333%;}`,
    `.media{display:block;width:100%;height:100%;object-position:50% 50%;}.fit-contain{object-fit:contain;}.fit-cover{object-fit:cover;}.muted{color:${style.colors.muted};}.accent{color:${style.colors.accent};}`,
    ...(['heading', 'body', 'caption'] as const).map((key) => `.${key}{font-size:${style[key].fontSize}px;line-height:${style[key].lineHeight}px;letter-spacing:${style[key].letterSpacing}px;}`),
  ];
  const sections = input.sections.map((section, si) => {
    const frames = section.frames.map((frame, fi) => {
      css.push(`#f-${si}-${fi}{height:${frame.height}px;}`);
      const blocks = frame.blocks.map((block, bi) => {
        const p = frame.layout.find((slot) => slot.blockId === block.id)!;
        const blockElementId = `b-${si}-${fi}-${bi}`;
        css.push(`#${blockElementId}{left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;padding:${p.padding}px;}`);
        if (block.kind === 'Media') css.push(`#${blockElementId}>[data-content]{height:100%;}`);
        return `<div id="${blockElementId}" data-block-id="${block.id}" data-kind="${block.kind}" data-layer="${p.layer}" data-padding="${p.padding}"><div data-content>${blockHtml(block, resources)}</div></div>`;
      }).join('');
      return `<section id="f-${si}-${fi}" data-frame-id="${frame.id}" aria-label="${frame.id}">${blocks}</section>`;
    }).join('');
    return `<section data-section-id="${section.id}" aria-label="${section.id}">${frames}</section>`;
  }).join('');
  const stylesheet = css.join('\n');
  const styleHash = hashBase64(await sha256(stylesheet));
  // No inline styles, scripts, URLs, event handlers, or raw HTML are accepted from the input.
  const html = `<!doctype html>\n<html lang="und"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'sha256-${styleHash}'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><meta name="renderer-purpose" content="${REVIEW_PURPOSE}"><meta name="renderer-input-hash" content="${inputHash}"><meta name="renderer-version" content="${input.rendererVersion}"><title>Renderer review sample</title><style>${stylesheet}</style></head><body><main data-render-root data-input-hash="${inputHash}">${sections}</main></body></html>\n`;
  return { ok: true, purpose: REVIEW_PURPOSE, status: 'compiled-unmeasured', input, inputHash, htmlHash: await sha256(html), html };
}
