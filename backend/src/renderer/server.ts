import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform, release, arch } from 'node:os';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { inspectReviewDocument, type BrowserInspection, type BrowserInspectionPlan } from './browser.js';
import { compileReviewHtml } from './compile.js';
import { canonicalJson, sha256 } from './encoding.js';
import { blockText, issue, REVIEW_PURPOSE, type RejectedRender, type RendererInput, type ResourceBundle } from './model.js';

export const ENGINE_PROFILE = Object.freeze({
  playwrightVersion: '1.58.2',
  browserVersion: '145.0.7632.6',
  browserRevision: '1208',
  browserName: 'chromium-headless-shell',
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
} as const);

export interface ReviewPng {
  frameId: string;
  sectionId: string;
  width: number;
  height: number;
  sha256: string;
  decodedPixelHash: string;
  png: Uint8Array;
}
export interface RenderedReviewSample {
  ok: true;
  purpose: typeof REVIEW_PURPOSE;
  status: 'measured-review-sample';
  inputHash: string;
  htmlHash: string;
  layoutHash: string;
  html: string;
  inspection: BrowserInspection;
  engine: typeof ENGINE_PROFILE & { os: string; architecture: string; node: string; sharp: string };
  dependencies: { fonts: RendererInput['fonts']; assets: RendererInput['assets'] };
  frames: ReviewPng[];
}

export function inspectionPlan(input: RendererInput, inputHash: string): BrowserInspectionPlan {
  return {
    inputHash,
    width: input.canvas.width,
    fontFamily: `render-${input.styleSnapshot.fontId}`,
    text: input.sections.flatMap((s) => s.frames.flatMap((f) => f.blocks.flatMap(blockText))).join(''),
    timeoutMs: 10000,
    frames: input.sections.flatMap((s) => s.frames.map((f) => ({
      id: f.id, sectionId: s.id, height: f.height,
      blocks: f.blocks.map((b) => { const p = f.layout.find((slot) => slot.blockId === b.id)!; return { id: b.id, x: p.x, y: p.y, width: p.width, height: p.height }; }),
    }))),
  };
}

/** Renders only review samples. Caller retains business prechecks, approval and Export ownership. */
export async function renderReviewSample(rawInput: unknown, bundle: ResourceBundle): Promise<RenderedReviewSample | RejectedRender> {
  const compiled = await compileReviewHtml(rawInput, bundle);
  if (!compiled.ok) return compiled;
  const require = createRequire(import.meta.url);
  const actualPlaywright = (require('playwright/package.json') as { version: string }).version;
  const registry = JSON.parse(readFileSync(join(dirname(require.resolve('playwright-core/package.json')), 'browsers.json'), 'utf8')) as { browsers: Array<{ name: string; revision: string; browserVersion: string }> };
  const registered = registry.browsers.find((b) => b.name === ENGINE_PROFILE.browserName);
  if (actualPlaywright !== ENGINE_PROFILE.playwrightVersion || registered?.revision !== ENGINE_PROFILE.browserRevision || registered.browserVersion !== ENGINE_PROFILE.browserVersion) {
    return { ok: false, purpose: REVIEW_PURPOSE, issues: [issue('ENGINE_MISMATCH', 'Installed Playwright/Chromium does not match the fixed engine profile', 'engine')] };
  }
  // Decode headers before launching Chromium. No remote lookup or image replacement is performed.
  for (const asset of compiled.input.assets) {
    try {
      const meta = await sharp(bundle[asset.id]!, { limitInputPixels: 24_000_000 }).metadata();
      if (!meta.width || !meta.height || meta.width * meta.height > 24_000_000 || (meta.pages ?? 1) !== 1) throw new Error('Image limits');
    } catch {
      return { ok: false, purpose: REVIEW_PURPOSE, issues: [issue('IMAGE_DECODE_FAILED', 'Pinned image could not be decoded within image limits', `resources.${asset.id}`)] };
    }
  }
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, timeout: 15000, args: ['--disable-gpu', '--font-render-hinting=none', '--force-color-profile=srgb'] });
    if (browser.version() !== ENGINE_PROFILE.browserVersion) return { ok: false, purpose: REVIEW_PURPOSE, issues: [issue('ENGINE_MISMATCH', 'Chromium binary version differs from engine profile', 'engine')] };
    const context = await browser.newContext({
      viewport: { width: compiled.input.canvas.width, height: 900 },
      deviceScaleFactor: ENGINE_PROFILE.deviceScaleFactor,
      locale: ENGINE_PROFILE.locale,
      timezoneId: ENGINE_PROFILE.timezoneId,
      colorScheme: ENGINE_PROFILE.colorScheme,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      javaScriptEnabled: false,
      acceptDownloads: false,
    });
    const networkAttempts: string[] = [];
    await context.route('**/*', async (route) => { networkAttempts.push(route.request().url()); await route.abort(); });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.setContent(compiled.html, { waitUntil: 'load', timeout: 15000 });
    const inspection = await page.evaluate(inspectReviewDocument, inspectionPlan(compiled.input, compiled.inputHash));
    if (networkAttempts.length) inspection.issues.push(issue('NETWORK_RESOURCE_BLOCKED', 'Render attempted an external resource request', 'resources'));
    if (inspection.issues.length) return { ok: false, purpose: REVIEW_PURPOSE, issues: inspection.issues };
    const frames: ReviewPng[] = [];
    for (const frame of inspection.frames) {
      const png = await page.locator(`[data-frame-id="${frame.id}"]`).screenshot({ type: 'png', animations: 'disabled', caret: 'hide', scale: 'css', timeout: 15000 });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width !== compiled.input.canvas.width || info.height !== frame.box.height) {
        return { ok: false, purpose: REVIEW_PURPOSE, issues: [issue('SCREENSHOT_DIMENSION_MISMATCH', 'PNG dimensions differ from the frozen Frame', 'frames', { frameId: frame.id })] };
      }
      // Width/height/channels are part of the pixel hash, independent of PNG compression/metadata.
      const decodedPixelHash = await sha256(`${info.width}x${info.height}x${info.channels}:${await sha256(data)}`);
      frames.push({ frameId: frame.id, sectionId: frame.sectionId, width: info.width, height: info.height, sha256: await sha256(png), decodedPixelHash, png });
    }
    return {
      ok: true, purpose: REVIEW_PURPOSE, status: 'measured-review-sample',
      inputHash: compiled.inputHash, htmlHash: compiled.htmlHash, layoutHash: await sha256(canonicalJson(inspection)), html: compiled.html,
      inspection, engine: { ...ENGINE_PROFILE, os: `${platform()} ${release()}`, architecture: arch(), node: process.version, sharp: sharp.versions.sharp },
      dependencies: { fonts: compiled.input.fonts, assets: compiled.input.assets }, frames,
    };
  } catch (error) {
    return { ok: false, purpose: REVIEW_PURPOSE, issues: [issue('BROWSER_RENDER_FAILED', error instanceof Error ? error.message : 'Browser rendering failed', 'engine')] };
  } finally {
    await browser?.close();
  }
}
