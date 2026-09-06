import { useState } from 'react'

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
    value: legacy === undefined ? fallback : legacy, base: null, active: legacy !== undefined && JSON.stringify(legacy) !== JSON.stringify(fallback),
  })
  const currentBase = baseFor(stored.value)
  // A legacy draft has no dependency snapshot. Never silently bind it to the latest project.
  const needsReview = stored.active && (stored.base === null || JSON.stringify(stored.base) !== JSON.stringify(currentBase))
  // Further edits keep the original dependency until the user reviews or replaces the draft.
  const setValue = (value: T) => store(previous => ({ value, base: previous.active ? previous.base : baseFor(value), active: true }))
  // Capture before opening a replacement confirmation; accepting later must not rebase silently.
  const prepareReplacement = (value: T) => ({ value, base: baseFor(value) })
  const replace = (prepared: ReturnType<typeof prepareReplacement>) => store({ ...prepared, active: true })
  const discard = () => store({ value: fallback, base: null, active: false })
  const acknowledge = () => store(previous => ({ ...previous, base: baseFor(previous.value) }))
  return { value: stored.value, setValue, prepareReplacement, replace, discard, acknowledge, needsReview, originalBase: stored.base, currentBase }
}
