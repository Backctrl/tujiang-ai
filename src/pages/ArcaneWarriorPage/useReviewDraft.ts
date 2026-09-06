import { useReviewedDraft, sameJsonValue } from './project-drafts.js'
import type { Project } from './stage-a-api.js'
import type { ProjectSession } from './useProjectSession.js'

type Session = Pick<ProjectSession, 'project' | 'getLatestProject'>
// Editing a selection explicitly changes that selection's dependencies. External changes never rebind an active draft.
export function useReviewDraft<T, B>(session: Session, field: string, fallback: T, baseFor: (project: Project | null, value: T) => B) {
  const local = useReviewedDraft(session.project?.id, field, fallback, value => baseFor(session.project, value))
  const currentForSave = () => {
    const latest = session.getLatestProject()
    return !!latest && latest.id === session.project?.id && (!local.active || sameJsonValue(local.originalBase, baseFor(latest, local.value)))
  }
  const update = (value: T) => {
    const latest = session.getLatestProject()
    if (latest && latest.id === session.project?.id && (!local.active || currentForSave())) local.replace({ value, base: baseFor(latest, value) })
    else local.setValue(value)
  }
  const afterSave = (response: Project) => {
    const latest = session.getLatestProject()
    if (latest?.id === response.id && sameJsonValue(baseFor(response, local.value), baseFor(latest, local.value))) { local.discard(); return true }
    return false
  }
  return { ...local, update, currentForSave, afterSave }
}
