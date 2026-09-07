import { useRef, useState } from 'react'

function comparableJson(value: unknown) {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    }
    return nested
  })
}
// Storage and HTTP responses may order object keys differently. Array order remains meaningful.
export function sameJsonValue(left: unknown, right: unknown) { return comparableJson(left) === comparableJson(right) }

export function draftKey(projectId: string, field: string) { return `tujiang_draft_v1:${projectId}:${field}` }
type DraftRecord<T> = { value: T; revision: number }
type DraftRecovery<T> = { local: DraftRecord<T>; restored: DraftRecord<T> }
function readDraftRecord<T>(projectId: string | undefined, field: string): DraftRecord<T> | undefined {
  if (!projectId) return undefined
  try {
    const raw = localStorage.getItem(draftKey(projectId, field))
    if (raw === null) return undefined
    const value = JSON.parse(raw) as T | { draftFormat: string; value: T; revision: number }
    if (value && typeof value === 'object' && 'draftFormat' in value && value.draftFormat === 'tujiang-local-draft.2') {
      if (!('revision' in value) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !('value' in value)) return undefined
      return { value: value.value, revision: value.revision }
    }
    return { value: value as T, revision: 0 }
  } catch { return undefined }
}
export function readDraft<T>(projectId: string | undefined, field: string, fallback: T): T {
  const record = readDraftRecord<T>(projectId, field)
  return record === undefined ? fallback : record.value
}
// The stage subtree is keyed by project ID. Persist synchronously before it can unmount.
export function useProjectDraft<T>(projectId: string | undefined, field: string, fallback: T, restored?: { value: T; revision?: number }) {
  const [record, setRecord] = useState<DraftRecord<T> & { conflict: DraftRecovery<T> | null }>(() => {
    const local = readDraftRecord<T>(projectId, field), saved = restored ? { value: restored.value, revision: restored.revision ?? 0 } : undefined
    if (!local) return { ...(saved ?? { value: fallback, revision: 0 }), conflict: null }
    if (!saved || local.revision > saved.revision) return { ...local, conflict: null }
    if (saved.revision > local.revision || sameJsonValue(local.value, saved.value)) return { ...saved, conflict: null }
    return { ...saved, conflict: { local, restored: saved } }
  })
  const latest = useRef(record)
  const update = (next: T | ((previous: T) => T)) => {
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(latest.current.value) : next
    const revision = Math.max(Date.now(), latest.current.revision + 1)
    if (projectId) {
      const versioned = field === 'productionContext:reviewed' || field === 'productionContextModels' || restored !== undefined
      try { localStorage.setItem(draftKey(projectId, field), JSON.stringify(versioned ? { draftFormat: 'tujiang-local-draft.2', value: resolved, revision } : resolved)) } catch { /* The monotonic revision remains available to durable request capture. */ }
    }
    latest.current = { value: resolved, revision, conflict: null }
    setRecord(latest.current)
  }
  const chooseRecovery = (source: 'local' | 'restored') => { const conflict = latest.current.conflict; if (conflict) update(conflict[source].value) }
  return [record.value, update, () => latest.current.value, () => latest.current.revision, { conflict: record.conflict, choose: chooseRecovery, getConflict: () => latest.current.conflict }] as const
}

export function useReviewedDraft<T, B>(projectId: string | undefined, field: string, fallback: T, baseFor: (value: T) => B, restored?: { value: T; base: B | null; active: boolean }, restoredRevision?: number) {
  const legacy = readDraft<T | undefined>(projectId, field, undefined)
  const [stored, store, getStored, getRevision, recovery] = useProjectDraft<{ value: T; base: B | null; active: boolean }>(projectId, `${field}:reviewed`, {
    value: legacy === undefined ? fallback : legacy, base: null, active: legacy !== undefined && !sameJsonValue(legacy, fallback),
  }, restored ? { value: restored, revision: restoredRevision } : undefined)
  const currentBase = baseFor(stored.value)
  // A legacy draft has no dependency snapshot. Never silently bind it to the latest project.
  const needsReview = !!recovery.conflict || stored.active && (stored.base === null || !sameJsonValue(stored.base, currentBase))
  // Further edits keep the original dependency until the user reviews or replaces the draft.
  const setValue = (value: T) => store(previous => ({ value, base: previous.active ? previous.base : baseFor(value), active: true }))
  // Capture before opening a replacement confirmation; accepting later must not rebase silently.
  const prepareReplacement = (value: T) => ({ value, base: baseFor(value) })
  const replace = (prepared: { value: T; base: B | null }) => store({ ...prepared, active: true })
  const discard = () => store({ value: fallback, base: null, active: false })
  const acknowledge = () => store(previous => ({ ...previous, base: baseFor(previous.value) }))
  return { value: stored.value, active: stored.active, setValue, prepareReplacement, replace, discard, acknowledge, needsReview, originalBase: stored.base, currentBase, getStored, getRevision, recovery }
}
