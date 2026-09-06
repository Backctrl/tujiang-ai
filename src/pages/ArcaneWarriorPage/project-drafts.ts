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
