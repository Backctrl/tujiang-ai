import type { RendererIssue } from './model.js';

export interface Box { x: number; y: number; width: number; height: number }
export interface BrowserInspectionPlan {
  inputHash: string;
  width: number;
  fontFamily: string;
  text: string;
  timeoutMs: number;
  frames: Array<{ id: string; sectionId: string; height: number; blocks: Array<{ id: string; x: number; y: number; width: number; height: number }> }>;
}
export interface BrowserInspection {
  issues: RendererIssue[];
  fonts: Array<{ family: string; status: string }>;
  images: Array<{ blockId: string; width: number; height: number }>;
  frames: Array<{ id: string; sectionId: string; box: Box; blocks: Array<{ id: string; box: Box; contentBox: Box; scrollWidth: number; scrollHeight: number }> }>;
}

/**
 * Runs in a browser (or Playwright evaluate) against the exact compiled HTML.
 * Self-contained: no imported runtime helpers, network, content mutations, or approvals.
 * A preview host may run this after setting an iframe's srcdoc; never label compile alone as measured.
 */
export async function inspectReviewDocument(plan: BrowserInspectionPlan): Promise<BrowserInspection> {
  const result: BrowserInspection = { issues: [], fonts: [], images: [], frames: [] };
  const util = {
    box(element: Element): Box {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x * 64) / 64, y: Math.round(rect.y * 64) / 64, width: Math.round(rect.width * 64) / 64, height: Math.round(rect.height * 64) / 64 };
    },
    issue(code: string, message: string, path: string, context: Partial<RendererIssue> = {}) {
      result.issues.push({ code, severity: 'blocked', message, path, ...context });
    },
  };
  if (document.querySelector('[data-render-root]')?.getAttribute('data-input-hash') !== plan.inputHash) {
    util.issue('DOCUMENT_MISMATCH', 'Preview document does not match inputHash', 'document');
    return result;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const loaded = await document.fonts.load(`400 16px "${plan.fontFamily}"`, plan.text || 'A');
        await document.fonts.ready;
        if (!loaded.length || !document.fonts.check(`400 16px "${plan.fontFamily}"`, plan.text || 'A')) {
          util.issue('FONT_LOAD_FAILED', 'Pinned font did not load', 'fonts');
        }
        result.fonts = Array.from(document.fonts).map((font) => ({ family: font.family, status: font.status }));
        if (result.fonts.length !== 1 || result.fonts.some((font) => font.status !== 'loaded')) util.issue('FONT_LOAD_FAILED', 'Expected one loaded pinned font face', 'fonts');
        await Promise.all(Array.from(document.images).map(async (img) => {
          const blockId = img.closest('[data-block-id]')?.getAttribute('data-block-id') || '';
          try {
            await img.decode();
            if (!img.naturalWidth || !img.naturalHeight) throw new Error('Empty image');
            if (img.naturalWidth * img.naturalHeight > 24_000_000) throw new Error('Decoded image exceeds 24M pixels');
            result.images.push({ blockId, width: img.naturalWidth, height: img.naturalHeight });
          } catch {
            util.issue('IMAGE_DECODE_FAILED', 'Pinned image could not be decoded within image limits', 'images', { blockId });
          }
        }));
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Resource timeout')), plan.timeoutMs); }),
    ]);
  } catch (error) {
    util.issue(error instanceof Error && error.message === 'Resource timeout' ? 'RESOURCE_LOAD_TIMEOUT' : 'FONT_LOAD_FAILED', 'Pinned resources failed to load; no fallback is accepted', 'resources');
  } finally {
    clearTimeout(timer);
  }
  // Image promises may settle in a different order. Normalize by stable block ID.
  result.images.sort((a, b) => a.blockId.localeCompare(b.blockId, 'en'));
  if (result.issues.length) return result;
  for (const expected of plan.frames) {
    const element = document.querySelector(`[data-frame-id="${expected.id}"]`);
    const context = { frameId: expected.id, sectionId: expected.sectionId };
    if (!element) { util.issue('DOCUMENT_MISMATCH', 'Frame is missing', 'frames', context); continue; }
    const frameBox = util.box(element);
    if (frameBox.width !== plan.width || frameBox.height !== expected.height) util.issue('LAYOUT_MISMATCH', 'Frame dimensions differ from frozen Canvas/Frame', 'frames', context);
    const measured: BrowserInspection['frames'][number] = { id: expected.id, sectionId: expected.sectionId, box: frameBox, blocks: [] };
    for (const blockPlan of expected.blocks) {
      const block = element.querySelector<HTMLElement>(`[data-block-id="${blockPlan.id}"]`);
      const content = block?.querySelector<HTMLElement>('[data-content]');
      const ctx = { ...context, blockId: blockPlan.id };
      if (!block || !content) { util.issue('DOCUMENT_MISMATCH', 'Block is missing', 'blocks', ctx); continue; }
      const box = util.box(block);
      const contentBox = util.box(content);
      measured.blocks.push({ id: blockPlan.id, box, contentBox, scrollWidth: block.scrollWidth, scrollHeight: block.scrollHeight });
      if (box.x - frameBox.x !== blockPlan.x || box.y - frameBox.y !== blockPlan.y || box.width !== blockPlan.width || box.height !== blockPlan.height) {
        util.issue('LAYOUT_MISMATCH', 'Block dimensions differ from the frozen layout', 'blocks', ctx);
      }
      const padding = Number(block.getAttribute('data-padding'));
      const left = box.x + padding;
      const top = box.y + padding;
      const right = box.x + box.width - padding;
      const bottom = box.y + box.height - padding;
      let overflow = contentBox.x < left - 0.01 || contentBox.y < top - 0.01 || contentBox.x + contentBox.width > right + 0.01 || contentBox.y + contentBox.height > bottom + 0.01;
      // Inspect every text line, including nested table cells/list entries, so no hidden/clipped text passes.
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.left < left - 0.01 || rect.top < top - 0.01 || rect.right > right + 0.01 || rect.bottom > bottom + 0.01) overflow = true;
        }
        range.detach();
      }
      if (block.scrollWidth > block.clientWidth || block.scrollHeight > block.clientHeight) overflow = true;
      if (overflow) util.issue('CONTENT_OVERFLOW', 'Content exceeds its frozen slot; resize, reflow, or review copy before rendering', 'blocks', ctx);
    }
    result.frames.push(measured);
  }
  return result;
}
