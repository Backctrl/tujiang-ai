import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createScanner, parseTree, SyntaxKind, type Node, type ParseError } from 'jsonc-parser';
import { AppError } from './errors.js';
import { imageFormat, isStorageText, MATERIAL_MIMES, MATERIAL_PARSER_VERSION, MAX_TEXT_BYTES, type Material, type MaterialBlock, type MaterialLocator } from './production-materials.js';

export const MAX_MATERIAL_BLOCKS = 2000;
export const MAX_BLOCK_CHARACTERS = 32_000;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_PARSED_OUTPUT_BYTES = 4 * 1024 * 1024;
export interface MaterialParseResult { blocks: MaterialBlock[]; detectedMimeType: string; notes: string[] }
function failure(code: string): never { throw new AppError(code, 422); }
function candidateKind(material: Material): MaterialBlock['kind'] {
  if (material.usage.hint === 'product_evidence') return 'evidence_block';
  if (material.usage.hint === 'reference') return 'reference_block';
  return 'unclassified_block';
}
function block(material: Material, locator: MaterialLocator, content: Pick<MaterialBlock, 'text' | 'cells' | 'image'>): MaterialBlock {
  if (content.text && content.text.length > MAX_BLOCK_CHARACTERS) failure('PARSE_OUTPUT_LIMIT');
  if (locator.type === 'json' && locator.pointer.length > 2000) failure('PARSE_OUTPUT_LIMIT');
  return { id: createHash('sha256').update(JSON.stringify([material.id, MATERIAL_PARSER_VERSION, locator])).digest('hex'),
    materialId: material.id, sourceSha256: material.sha256, parserVersion: MATERIAL_PARSER_VERSION,
    kind: content.image ? 'asset' : candidateKind(material), status: 'candidate', locator, ...content };
}
function checkedOutput(result: MaterialParseResult): MaterialParseResult {
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_PARSED_OUTPUT_BYTES) failure('PARSE_OUTPUT_LIMIT');
  return result;
}
function push(blocks: MaterialBlock[], next: MaterialBlock) {
  if (blocks.length >= MAX_MATERIAL_BLOCKS) failure('PARSE_OUTPUT_LIMIT');
  blocks.push(next);
}
function textBlocks(material: Material, text: string): MaterialBlock[] {
  const blocks: MaterialBlock[] = [];
  let start = 0; let line = 1;
  while (start < text.length) {
    let end = start;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++;
    const value = text.slice(start, end);
    if (value.trim()) push(blocks, block(material, { type: 'text', startLine: line, endLine: line, startOffset: start, endOffset: end }, { text: value }));
    start = end + (text[end] === '\r' && text[end + 1] === '\n' ? 2 : 1);
    line++;
  }
  return blocks;
}
function csvBlocks(material: Material, text: string): MaterialBlock[] {
  const blocks: MaterialBlock[] = [];
  let fields: string[] = []; let field = ''; let mode: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let rowStart = 0; let rowLine = 1; let line = 1;
  const finishRow = (end: number) => {
    fields.push(field);
    if (fields.length > 500) failure('PARSE_OUTPUT_LIMIT');
    push(blocks, block(material, { type: 'csv', row: blocks.length + 1, startLine: rowLine, endLine: line,
      startOffset: rowStart, endOffset: end }, { text: text.slice(rowStart, end), cells: fields }));
    fields = []; field = ''; mode = 'start';
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (mode === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else mode = 'closed';
      } else {
        field += char;
        if (char === '\r') { if (text[i + 1] === '\n') { field += '\n'; i++; } line++; }
        else if (char === '\n') line++;
      }
    } else if (char === ',') {
      fields.push(field); field = ''; mode = 'start';
      if (fields.length >= 500) failure('PARSE_OUTPUT_LIMIT');
    } else if (char === '\r' || char === '\n') {
      finishRow(i);
      if (char === '\r' && text[i + 1] === '\n') i++;
      line++; rowStart = i + 1; rowLine = line;
    } else if (char === '"' && mode === 'start') mode = 'quoted';
    else {
      if (mode === 'closed' || char === '"') failure('INVALID_CSV');
      mode = 'plain'; field += char;
    }
    if (i - rowStart > MAX_BLOCK_CHARACTERS) failure('PARSE_OUTPUT_LIMIT');
  }
  if (mode === 'quoted') failure('INVALID_CSV');
  if (rowStart < text.length) finishRow(text.length);
  return blocks;
}
function jsonBlocks(material: Material, text: string): MaterialBlock[] {
  const scanner = createScanner(text, true);
  let depth = 0; let tokens = 0;
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (++tokens > 20_000) failure('PARSE_OUTPUT_LIMIT');
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) {
      if (++depth > 64) failure('JSON_TOO_DEEP');
    } else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) depth--;
  }
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  if (!root || errors.length) failure('INVALID_JSON');
  const blocks: MaterialBlock[] = [];
  const visit = (node: Node, pointer: string) => {
    if (node.type === 'string' && !isStorageText(node.value as string)) failure('INVALID_JSON_UNICODE');
    if (node.type === 'object' && node.children?.length) {
      const keys = new Set<string>();
      for (const property of node.children) {
        const key = property.children![0]!.value as string;
        if (!isStorageText(key)) failure('INVALID_JSON_UNICODE');
        if (keys.has(key)) failure('DUPLICATE_JSON_KEY');
        keys.add(key);
        visit(property.children![1]!, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
      }
    } else if (node.type === 'array' && node.children?.length) node.children.forEach((child, index) => visit(child, `${pointer}/${index}`));
    else push(blocks, block(material, { type: 'json', pointer, startOffset: node.offset, endOffset: node.offset + node.length },
      { text: text.slice(node.offset, node.offset + node.length) }));
  };
  visit(root, '');
  return blocks;
}
export async function parseMaterial(material: Material, bytes: Buffer): Promise<MaterialParseResult> {
  if (bytes.length !== material.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== material.sha256) failure('SOURCE_FILE_INTEGRITY_FAILED');
  if (['png', 'jpeg', 'webp'].includes(material.format)) {
    const format = imageFormat(bytes);
    if (!format || format !== material.format) failure('INVALID_IMAGE');
    try {
      const metadata = await sharp(bytes, { failOn: 'warning', limitInputPixels: false }).metadata();
      if (!metadata.width || !metadata.height || metadata.format !== format) failure('INVALID_IMAGE');
      if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) failure('IMAGE_DIMENSIONS_LIMIT');
      if ((metadata.pages ?? 1) > 1) failure('ANIMATED_IMAGE_UNSUPPORTED');
      // Metadata alone does not validate pixel data. Decode every pixel without changing the stored original.
      await sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS }).timeout({ seconds: 10 }).stats();
      return checkedOutput({ blocks: [block(material, { type: 'image', frame: 1 }, { image: {
        widthPx: metadata.width, heightPx: metadata.height, format, hasAlpha: metadata.hasAlpha,
        ...(metadata.orientation ? { orientation: metadata.orientation } : {}),
        textRecognition: 'not_performed', semanticAnalysis: 'not_performed',
      } })], detectedMimeType: MATERIAL_MIMES[format], notes: ['已验证图片解码并读取尺寸；未执行 OCR 或语义识别，未生成图片中的文字或产品事实。'] });
    } catch (error) {
      if (error instanceof AppError) throw error;
      failure('INVALID_IMAGE');
    }
  }
  if (bytes.length > MAX_TEXT_BYTES) failure('TEXT_SIZE_LIMIT');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return failure('INVALID_TEXT_ENCODING'); }
  if (text.includes('\0')) failure('INVALID_TEXT_ENCODING');
  if (!text.trim()) failure('EMPTY_TEXT');
  const blocks = material.format === 'csv' ? csvBlocks(material, text) : material.format === 'json' ? jsonBlocks(material, text) : textBlocks(material, text);
  const notes: string[] = ['内容仅为待审核候选，尚未作为产品事实使用。'];
  if (material.format === 'md') notes.push('Markdown 按原文行保留，未执行其中的 HTML、脚本或链接。');
  if (material.format === 'csv' && new Set(blocks.map(item => item.cells!.length)).size > 1) notes.push('CSV 各行列数不同，请人工核对表格结构。');
  return checkedOutput({ blocks, detectedMimeType: MATERIAL_MIMES[material.format], notes });
}
