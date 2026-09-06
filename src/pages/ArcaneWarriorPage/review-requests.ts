import { ApiError, prepareProjectWrite, type Project } from './stage-a-api.js'
import type { MaterialOperation } from './material-storage.js'

const uuid = '[a-f\\d]{8}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{12}'
const reviewTargets = {
  'material-usage': { path: new RegExp(`^production/materials/${uuid}/usage$`, 'i'), fields: ['reason', 'decisions'] },
  'source-reconfirm': { path: new RegExp(`^facts/${uuid}/source/reconfirm$`, 'i'), fields: ['reason', 'evidenceId'] },
  'manual-evidence': { path: /^evidence$/, fields: ['documentName', 'locator', 'text', 'usage'] },
  'fact-candidate': { path: /^facts\/candidates$/, fields: ['attribute', 'value', 'role', 'evidenceId', 'quote', 'correctsFactId', 'reason'] },
  'fact-confirm': { path: new RegExp(`^facts/${uuid}/confirm$`, 'i'), fields: ['reason'] },
  'fact-reject': { path: new RegExp(`^facts/${uuid}/reject$`, 'i'), fields: ['reason'] },
  'fact-retract': { path: new RegExp(`^facts/${uuid}/retract$`, 'i'), fields: ['reason'] },
}
export type ReviewKind = keyof typeof reviewTargets
export function isReviewTarget(kind: unknown, path: unknown): kind is ReviewKind {
  return typeof kind === 'string' && Object.hasOwn(reviewTargets, kind) && typeof path === 'string'
    && reviewTargets[kind as ReviewKind].path.test(path)
}
export function reviewFieldsAllowed(kind: ReviewKind, fields: Record<string, unknown>, envelope = false) {
  const allowed = [...reviewTargets[kind].fields, ...(envelope ? ['expectedProjectVersion', 'expectedRevision', 'idempotencyKey'] : [])]
  return Object.keys(fields).every(key => allowed.includes(key))
}
export function prepareReviewWrite(before: Project, kind: ReviewKind, path: string, fields: Record<string, unknown>, label: string): MaterialOperation {
  if (!isReviewTarget(kind, path) || !reviewFieldsAllowed(kind, fields)) throw new ApiError('INVALID_REVIEW_REQUEST', 400)
  return { id: 'active', kind: 'review', reviewKind: kind, before: structuredClone(before), label,
    prepared: prepareProjectWrite(before, path, fields) }
}
