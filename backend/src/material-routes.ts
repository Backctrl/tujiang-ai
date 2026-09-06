import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeSchema } from './contracts.js';
import { AppError } from './errors.js';
import { LocalObjects } from './objects.js';
import { requireProduction } from './production.js';
import { audit, Store } from './store.js';
import { createMaterial, decodeMaterialUpload, materialOrigin, materialUploadSchema, MATERIAL_UPLOAD_BODY_LIMIT, MAX_PROJECT_MATERIALS, retryMaterialParse } from './production-materials.js';

export const MATERIAL_UPLOAD_PATH = '/api/projects/:id/production/materials';
const projectParams = z.object({ id: z.string().uuid() });
const materialParams = projectParams.extend({ materialId: z.string().uuid() });
export function registerMaterialRoutes(app: FastifyInstance, store: Store, objects: LocalObjects, actor: string) {
  app.post(MATERIAL_UPLOAD_PATH, { bodyLimit: MATERIAL_UPLOAD_BODY_LIMIT }, async request => {
    const { id } = projectParams.parse(request.params);
    const body = materialUploadSchema.parse(request.body);
    const decoded = decodeMaterialUpload(body);
    return store.command(id, body, 'material.uploaded', actor, async project => {
      const production = requireProduction(project!);
      const materials = production.materials ??= [];
      const existing = materials.find(item => item.sha256 === decoded.sha256 && item.format === decoded.format);
      if (!existing && materials.length >= MAX_PROJECT_MATERIALS) throw new AppError('MATERIAL_LIMIT', 409, { maxMaterials: MAX_PROJECT_MATERIALS });
      const saved = await objects.putBinary(decoded.bytes);
      if (existing) {
        const origin = materialOrigin(body, actor);
        const comparable = (value: typeof origin) => JSON.stringify([value.fileName, value.mimeType, value.source, value.usageHint, value.uploadedBy]);
        if (!existing.origins.some(item => comparable(item) === comparable(origin))) existing.origins.push(origin);
        audit(project!, 'material.original.deduplicated', actor, { materialId: existing.id, sha256: existing.sha256 });
      } else {
        const material = createMaterial(body, decoded, saved.objectKey, actor);
        materials.push(material);
        audit(project!, 'material.original.received', actor, { materialId: material.id, sha256: material.sha256, sizeBytes: material.sizeBytes });
      }
      return project!;
    }, { preserveStageAInput: true });
  });
  app.post(`${MATERIAL_UPLOAD_PATH}/:materialId/parse/retry`, async request => {
    const { id, materialId } = materialParams.parse(request.params);
    const body = writeSchema.strict().parse(request.body);
    return store.command(id, body, `material.${materialId}.parse.retry`, actor, project => {
      const material = requireProduction(project!).materials?.find(item => item.id === materialId);
      if (!material) throw new AppError('MATERIAL_NOT_FOUND', 404);
      retryMaterialParse(material); return project!;
    }, { preserveStageAInput: true });
  });
  app.get(`${MATERIAL_UPLOAD_PATH}/:materialId/original`, async (request, reply) => {
    const { id, materialId } = materialParams.parse(request.params);
    const project = await store.get(id);
    const material = requireProduction(project).materials?.find(item => item.id === materialId);
    if (!material) throw new AppError('MATERIAL_NOT_FOUND', 404);
    const bytes = await objects.readBinary(material.objectKey, material.sizeBytes);
    const baseName = material.fileName.split(/[\\/]/).filter(Boolean).at(-1) ?? `${material.id}.${material.format}`;
    const encodedName = encodeURIComponent(Buffer.from(baseName, 'utf8').toString('utf8'))
      .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return reply.type('application/octet-stream').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="source.${material.format}"; filename*=UTF-8''${encodedName}`)
      .header('Content-Length', bytes.length).send(bytes);
  });
}
