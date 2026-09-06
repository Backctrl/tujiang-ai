import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { writeSchema } from './contracts.js';
import { AppError } from './errors.js';

export const MATERIAL_PARSER_VERSION = 'ingest.1';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_PROJECT_MATERIALS = 50;
export const MATERIAL_UPLOAD_BODY_LIMIT = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 32_768;
export const SUPPORTED_MATERIAL_FORMATS = ['txt', 'md', 'csv', 'json', 'png', 'jpeg', 'webp'] as const;
export type MaterialFormat = typeof SUPPORTED_MATERIAL_FORMATS[number];
export const usageHintSchema = z.enum(['product_evidence', 'asset', 'reference', 'mixed', 'unknown']);
export type MaterialUsageHint = z.infer<typeof usageHintSchema>;
export function isStorageText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
export const materialSourceSchema = z.object({
  kind: z.enum(['local_upload', 'feishu_export']),
  url: z.string().url().max(2000).refine(isStorageText, 'Valid Unicode required').refine(value => ['https:', 'http:'].includes(new URL(value).protocol), 'HTTP source URL required').optional(),
  title: z.string().trim().min(1).max(300).refine(isStorageText, 'Valid Unicode required').optional(),
  revision: z.string().trim().min(1).max(100).refine(isStorageText, 'Valid Unicode required').optional(),
  locator: z.string().trim().min(1).max(500).refine(isStorageText, 'Valid Unicode required').optional(),
}).strict().superRefine((source, ctx) => {
  if (source.kind === 'feishu_export' && !source.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Export source URL required' });
});
export const materialUploadSchema = writeSchema.extend({
  fileName: z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/).refine(isStorageText, 'Valid Unicode required'),
  mimeType: z.string().max(100).regex(/^[^\x00-\x1f\x7f]*$/).refine(isStorageText, 'Valid Unicode required'),
  contentBase64: z.string(),
  source: materialSourceSchema,
  usageHint: usageHintSchema.default('unknown'),
}).strict();
export type MaterialUpload = z.infer<typeof materialUploadSchema>;
export type MaterialSource = z.infer<typeof materialSourceSchema>;
export interface MaterialOrigin {
  fileName: string; mimeType: string; source: MaterialSource; usageHint: MaterialUsageHint; uploadedAt: string; uploadedBy: string;
}
export type MaterialLocator =
  | { type: 'text'; startLine: number; endLine: number; startOffset: number; endOffset: number }
  | { type: 'csv'; row: number; startLine: number; endLine: number; startOffset: number; endOffset: number }
  | { type: 'json'; pointer: string; startOffset: number; endOffset: number }
  | { type: 'image'; frame: 1 };
export interface ImageMetadata {
  widthPx: number; heightPx: number; format: 'png' | 'jpeg' | 'webp'; hasAlpha: boolean; orientation?: number;
  textRecognition: 'not_performed'; semanticAnalysis: 'not_performed';
}
export interface MaterialBlock {
  id: string; materialId: string; sourceSha256: string; parserVersion: typeof MATERIAL_PARSER_VERSION;
  kind: 'evidence_block' | 'reference_block' | 'asset' | 'unclassified_block'; status: 'candidate';
  locator: MaterialLocator; text?: string; cells?: string[]; image?: ImageMetadata;
}
export interface ParseAttempt {
  attempt: number; startedAt: string; finishedAt?: string; status: 'running' | 'succeeded' | 'failed'; errorCode?: string;
}
export interface MaterialParse {
  id: string; parserVersion: typeof MATERIAL_PARSER_VERSION; sourceSha256: string;
  queueStatus: 'queued' | 'claimed' | 'done'; runStatus: 'idle' | 'running' | 'succeeded' | 'failed';
  attempt: number; attempts: ParseAttempt[]; leaseUntil?: string; errorCode?: string; notes: string[];
}
export interface Material {
  id: string; fileName: string; format: MaterialFormat; declaredMimeType: string; detectedMimeType?: string;
  sha256: string; objectKey: string; sizeBytes: number; source: MaterialSource; uploadedAt: string; uploadedBy: string;
  origins: MaterialOrigin[]; usage: { status: 'pending'; hint: MaterialUsageHint };
  parse: MaterialParse; blocks: MaterialBlock[];
}
export const MATERIAL_MIMES: Record<MaterialFormat, string> = {
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp',
};
export function uploadLimitDetails() {
  return { maxFileBytes: MAX_FILE_BYTES, supportedFormats: [...SUPPORTED_MATERIAL_FORMATS], hint: '请把单个原件控制在 10 MiB 以内后重新上传。' };
}
export function decodeMaterialUpload(input: MaterialUpload): { bytes: Buffer; sha256: string; format: MaterialFormat; detectedMimeType?: string } {
  if (input.contentBase64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw new AppError('FILE_TOO_LARGE', 413, uploadLimitDetails());
  const bytes = Buffer.from(input.contentBase64, 'base64');
  if (!bytes.length) throw new AppError('EMPTY_FILE', 400, { hint: '请选择有内容的原件。' });
  if (bytes.length > MAX_FILE_BYTES) throw new AppError('FILE_TOO_LARGE', 413, uploadLimitDetails());
  if (bytes.toString('base64') !== input.contentBase64) throw new AppError('INVALID_FILE_ENCODING', 400, { hint: '请重新选择文件，使用标准 Base64 传输原始字节。' });
  const mime = input.mimeType.split(';')[0]!.trim().toLowerCase();
  const ext = input.fileName.split('.').at(-1)!.toLowerCase();
  const extension = ext === 'jpg' ? 'jpeg' : ext;
  const byExtension = SUPPORTED_MATERIAL_FORMATS.find(format => format === extension);
  const byMime = SUPPORTED_MATERIAL_FORMATS.find(format => MATERIAL_MIMES[format] === mime)
    ?? (mime === 'image/jpg' ? 'jpeg' : mime === 'application/csv' ? 'csv' : undefined);
  const detectedImage = imageFormat(bytes);
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-' || (!byExtension && !byMime && !detectedImage)) {
    throw unsupportedMaterial();
  }
  if (detectedImage && ((byExtension && byExtension !== detectedImage) || (byMime && byMime !== detectedImage))) {
    throw new AppError('FILE_TYPE_MISMATCH', 415, { supportedFormats: [...SUPPORTED_MATERIAL_FORMATS], hint: '文件扩展名或 MIME 与实际图片格式不一致，请保留真实格式后重新上传。' });
  }
  if (byExtension && byMime && byExtension !== byMime && !(mime === 'text/plain' && ['md', 'csv', 'json'].includes(byExtension))) {
    throw new AppError('FILE_TYPE_MISMATCH', 415, { supportedFormats: [...SUPPORTED_MATERIAL_FORMATS], hint: '文件扩展名和 MIME 不一致，请核对文件格式。' });
  }
  const format = detectedImage ?? byExtension ?? byMime;
  if (!format) throw unsupportedMaterial();
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), format,
    ...(detectedImage ? { detectedMimeType: MATERIAL_MIMES[detectedImage] } : {}) };
}
function unsupportedMaterial() {
  return new AppError('UNSUPPORTED_FILE_TYPE', 415, { supportedFormats: [...SUPPORTED_MATERIAL_FORMATS],
    hint: '本轮支持 TXT、Markdown、CSV、JSON、PNG、JPEG、WebP；PDF/Office 请先导出 UTF-8 文本、CSV 或图片后上传，并保留来源说明。' });
}
export function imageFormat(bytes: Buffer): 'png' | 'jpeg' | 'webp' | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return undefined;
}
export function materialOrigin(input: MaterialUpload, actor: string): MaterialOrigin {
  return { fileName: input.fileName, mimeType: input.mimeType, source: structuredClone(input.source), usageHint: input.usageHint,
    uploadedAt: new Date().toISOString(), uploadedBy: actor };
}
export function createMaterial(input: MaterialUpload, decoded: ReturnType<typeof decodeMaterialUpload>, objectKey: string, actor: string): Material {
  const origin = materialOrigin(input, actor);
  return { id: randomUUID(), fileName: input.fileName, format: decoded.format, declaredMimeType: input.mimeType,
    detectedMimeType: decoded.detectedMimeType, sha256: decoded.sha256, objectKey, sizeBytes: decoded.bytes.length,
    source: structuredClone(input.source), uploadedAt: origin.uploadedAt, uploadedBy: actor, origins: [origin],
    usage: { status: 'pending', hint: input.usageHint }, blocks: [],
    parse: { id: randomUUID(), parserVersion: MATERIAL_PARSER_VERSION, sourceSha256: decoded.sha256,
      queueStatus: 'queued', runStatus: 'idle', attempt: 0, attempts: [], notes: [] } };
}
export function retryMaterialParse(material: Material) {
  if (material.parse.queueStatus !== 'done' || material.parse.runStatus !== 'failed') throw new AppError('PARSE_RETRY_NOT_ALLOWED', 409);
  material.parse.queueStatus = 'queued'; material.parse.runStatus = 'idle';
  delete material.parse.errorCode; delete material.parse.leaseUntil;
}
