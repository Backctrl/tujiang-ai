import { useState } from 'react'

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
export function readDraft<T>(projectId: string | undefined, field: string, fallback: T): T {
  if (!projectId) return fallback
  try { const value = localStorage.getItem(draftKey(projectId, field)); return value === null ? fallback : JSON.parse(value) as T } catch { return fallback }
}
// The stage subtree is keyed by project ID. Persist synchronously before it can unmount.
export function useProjectDraft<T>(projectId: string | undefined, field: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readDraft(projectId, field, fallback))
  const update = (next: T | ((previous: T) => T)) => setValue(previous => {
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
    if (projectId) {
      try { localStorage.setItem(draftKey(projectId, field), JSON.stringify(resolved)) } catch { /* Editing remains available when storage is unavailable. */ }
    }
    return resolved
  })
  return [value, update] as const
}

export function useReviewedDraft<T, B>(projectId: string | undefined, field: string, fallback: T, baseFor: (value: T) => B) {
  const legacy = readDraft<T | undefined>(projectId, field, undefined)
  const [stored, store] = useProjectDraft<{ value: T; base: B | null; active: boolean }>(projectId, `${field}:reviewed`, {
    value: legacy === undefined ? fallback : legacy, base: null, active: legacy !== undefined && !sameJsonValue(legacy, fallback),
  })
  const currentBase = baseFor(stored.value)
  // A legacy draft has no dependency snapshot. Never silently bind it to the latest project.
  const needsReview = stored.active && (stored.base === null || !sameJsonValue(stored.base, currentBase))
  // Further edits keep the original dependency until the user reviews or replaces the draft.
  const setValue = (value: T) => store(previous => ({ value, base: previous.active ? previous.base : baseFor(value), active: true }))
  // Capture before opening a replacement confirmation; accepting later must not rebase silently.
  const prepareReplacement = (value: T) => ({ value, base: baseFor(value) })
  const replace = (prepared: ReturnType<typeof prepareReplacement>) => store({ ...prepared, active: true })
  const discard = () => store({ value: fallback, base: null, active: false })
  const acknowledge = () => store(previous => ({ ...previous, base: baseFor(previous.value) }))
  return { value: stored.value, active: stored.active, setValue, prepareReplacement, replace, discard, acknowledge, needsReview, originalBase: stored.base, currentBase }
}
