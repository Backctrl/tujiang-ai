import { useEffect, useState } from 'react'
import type { MaterialReviewCenter, MaterialReviewTask } from '../../../backend/src/production-material-usage.js'
import type { ProjectSession } from './useProjectSession.js'
import { errorMessage } from './stage-a-api.js'
import { reviewCenterMatches, reviewTypes } from './material-review.js'

type Session = Pick<ProjectSession, 'project' | 'getLatestProject' | 'token' | 'authExpired' | 'readMaterialReviews'>
export function useMaterialReviews(session: Session) {
  const { project, token, authExpired, readMaterialReviews, getLatestProject } = session
  const [result, setResult] = useState<{ center: MaterialReviewCenter | null; loading: boolean; error: string }>({ center: null, loading: false, error: '' })
  const [request, setRequest] = useState(0)
  const initialized = !!project?.production
  useEffect(() => {
    if (!project?.id || !initialized || !token.trim() || authExpired) { setResult({ center: null, loading: false, error: '' }); return }
    let disposed = false
    setResult(previous => ({ ...previous, loading: true, error: '' }))
    void readMaterialReviews().then(center => {
      if (disposed) return
      if (reviewCenterMatches(getLatestProject(), center)) setResult({ center, loading: false, error: '' })
      else setResult(previous => ({ ...previous, loading: false, error: '任务依据已更新，正在等待对应项目快照；可重新读取。' }))
    }).catch(error => { if (!disposed) setResult(previous => ({ ...previous, loading: false, error: errorMessage(error) })) })
    return () => { disposed = true }
  }, [project?.id, project?.version, project?.revision, initialized, token, authExpired, request, readMaterialReviews, getLatestProject])
  const current = !result.loading && !result.error && reviewCenterMatches(project, result.center)
  const tasks = current ? result.center!.tasks : []
  const counts = Object.fromEntries(reviewTypes.map(type => [type, tasks.filter(task => task.type === type).length])) as Record<MaterialReviewTask['type'], number>
  const isCurrent = () => current && reviewCenterMatches(getLatestProject(), result.center)
  return { center: result.center, tasks, counts, current, isCurrent, initialized,
    loading: result.loading, error: result.error, reload: () => setRequest(value => value + 1) }
}
export type MaterialReviewsController = ReturnType<typeof useMaterialReviews>
