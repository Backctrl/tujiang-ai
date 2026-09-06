import { useCallback, useRef, useState } from 'react'
import type { Project } from './stage-a-api.js'

export function useProjectSnapshot(initial: Project | null = null) {
  const [project, setProject] = useState<Project | null>(initial)
  const latestProject = useRef(initial)
  const getLatestProject = useCallback(() => latestProject.current, [])
  const receiveSnapshot = useCallback((next: Project, expectedProjectId?: string) => {
    const current = latestProject.current
    if (expectedProjectId && (current?.id !== expectedProjectId || next.id !== expectedProjectId)) return current
    if (current?.id === next.id && current.revision > next.revision) return current
    // Update before scheduling a render so callbacks in this same batch see the newest snapshot.
    latestProject.current = next
    setProject(next)
    return next
  }, [])
  return { project, getLatestProject, receiveSnapshot }
}
