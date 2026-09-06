import { audit, Store } from './store.js';
import type { Material } from './production-materials.js';
import type { MaterialParseResult } from './material-parser.js';

export const MATERIAL_PARSE_LEASE_MS = 120_000;
export const PARSE_ERROR_HINTS: Record<string, string> = {
  PARSE_WORKER_INTERRUPTED: '解析过程已中断，原件仍保留；可以重试此文件。',
  SOURCE_FILE_MISSING: '保存的原件不可用；重新上传同一原件后重试。',
  SOURCE_FILE_INTEGRITY_FAILED: '原件与保存时的内容不一致；请恢复保存时的原件后重试。',
  INVALID_SOURCE_OBJECT_KEY: '原件记录无效，请检查资料记录后重试。',
  SOURCE_READ_FAILED: '暂时无法读取原件；恢复文件存储后重试。',
  INVALID_TEXT_ENCODING: '文本不是可读取的 UTF-8 文件；请导出 UTF-8 文本后作为新资料上传。',
  EMPTY_TEXT: '没有可读取的文字，请提供包含内容的原件。',
  TEXT_SIZE_LIMIT: '文本超过 2 MiB；请拆分为更小的原件后上传。',
  PARSE_OUTPUT_LIMIT: '资料的行、内容块或单行长度超过本轮处理范围；请按内容拆分后上传。',
  INVALID_CSV: 'CSV 引号或分隔结构无效；请从原表格重新导出 CSV 后上传。',
  INVALID_JSON: 'JSON 语法无效；请核对原件后重新上传。',
  INVALID_JSON_UNICODE: 'JSON 包含空字符或不成对的 Unicode 代理项；请改为有效文字后上传。',
  DUPLICATE_JSON_KEY: 'JSON 同一对象包含重复字段，无法确定应保留哪个值；请在原件中保留明确且不重复的字段。',
  JSON_TOO_DEEP: 'JSON 层级超过 64 层；请导出需要的子对象后上传。',
  INVALID_IMAGE: '图片无法完整解码；请确认能正常打开，重新导出 PNG、JPEG 或 WebP 后上传。',
  IMAGE_DIMENSIONS_LIMIT: '图片超过 4000 万像素；请缩小图片后上传。',
  ANIMATED_IMAGE_UNSUPPORTED: '本轮不解析动态图；请选择需要的一帧并导出静态图片后上传。',
  STALE_MATERIAL_INPUT: '原件依赖已经变化，旧解析结果未写入；请核对当前资料后重试。',
  PARSE_FAILED: '解析未完成，原件仍保留；可以重试或重新导出原件。',
};
export interface MaterialClaim { projectId: string; material: Material }
export class MaterialQueue {
  constructor(readonly store: Store) {}
  async claim(): Promise<MaterialClaim | undefined> {
    return this.store.db.transaction(async tx => {
      const { rows } = await tx.query<{ id: string }>(`SELECT id FROM projects WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(state #> '{production,materials}', '[]'::jsonb)) material
        WHERE material #>> '{parse,queueStatus}'='queued' OR
          (material #>> '{parse,queueStatus}'='claimed' AND (material #>> '{parse,leaseUntil}')::timestamptz < now())
        ) ORDER BY updated_at, id FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!rows[0]) return;
      const project = await this.store.get(rows[0].id, tx);
      const material = project.production?.materials?.find(item => item.parse.queueStatus === 'queued'
        || (item.parse.queueStatus === 'claimed' && Date.parse(item.parse.leaseUntil ?? '') < Date.now()));
      if (!material) return;
      const run = material.parse;
      project.revision++;
      if (run.queueStatus === 'claimed') {
        finishAttempt(material, 'PARSE_WORKER_INTERRUPTED');
        audit(project, 'material.parse.interrupted', 'material-parser', { materialId: material.id, parseId: run.id, attempt: run.attempt });
        await this.store.save(project, tx);
        return;
      }
      run.queueStatus = 'claimed'; run.runStatus = 'running'; run.attempt++;
      run.leaseUntil = new Date(Date.now() + MATERIAL_PARSE_LEASE_MS).toISOString();
      delete run.errorCode;
      run.attempts.push({ attempt: run.attempt, startedAt: new Date().toISOString(), status: 'running' });
      audit(project, 'material.parse.started', 'material-parser', { materialId: material.id, parseId: run.id, attempt: run.attempt });
      await this.store.save(project, tx);
      return { projectId: project.id, material };
    });
  }
  async finish(claim: MaterialClaim, outcome: { output: MaterialParseResult } | { errorCode: string }): Promise<boolean> {
    return this.store.db.transaction(async tx => {
      const project = await this.store.get(claim.projectId, tx, true);
      const material = project.production?.materials?.find(item => item.id === claim.material.id);
      if (!material || material.parse.id !== claim.material.parse.id || material.parse.attempt !== claim.material.parse.attempt
        || material.parse.queueStatus !== 'claimed') return false;
      let errorCode = 'errorCode' in outcome ? outcome.errorCode : undefined;
      if (!material.parse.leaseUntil || Date.parse(material.parse.leaseUntil) <= Date.now()) errorCode = 'PARSE_WORKER_INTERRUPTED';
      else if (material.sha256 !== claim.material.sha256 || material.parse.sourceSha256 !== claim.material.parse.sourceSha256) errorCode = 'STALE_MATERIAL_INPUT';
      if (!errorCode && 'output' in outcome) {
        material.blocks = outcome.output.blocks;
        material.detectedMimeType = outcome.output.detectedMimeType;
        material.parse.notes = outcome.output.notes;
      }
      finishAttempt(material, errorCode);
      project.revision++;
      audit(project, `material.parse.${material.parse.runStatus}`, 'material-parser', {
        materialId: material.id, parseId: material.parse.id, attempt: material.parse.attempt, errorCode: errorCode ?? null,
      });
      await this.store.save(project, tx);
      return true;
    });
  }
}
function finishAttempt(material: Material, errorCode?: string) {
  const run = material.parse;
  run.queueStatus = 'done'; run.runStatus = errorCode ? 'failed' : 'succeeded'; delete run.leaseUntil;
  if (errorCode) { run.errorCode = errorCode; run.notes = [PARSE_ERROR_HINTS[errorCode] ?? PARSE_ERROR_HINTS.PARSE_FAILED!]; }
  else delete run.errorCode;
  const attempt = run.attempts.find(item => item.attempt === run.attempt);
  if (attempt) {
    attempt.status = run.runStatus; attempt.finishedAt = new Date().toISOString();
    if (errorCode) attempt.errorCode = errorCode;
  }
}
