import { useState } from 'react'
import type { ProjectContextVersion } from '../../../backend/src/production-context.js'
import type { Project } from './stage-a-api.js'
import type { ProjectSession } from './useProjectSession.js'
import { sameJsonValue, useReviewedDraft } from './project-drafts.js'
import { compileContextForm, contextDifferences, contextForm, contextReadiness, projectContextBase, selectedRule, type ContextForm } from './project-context.js'

export type ContextSession = Pick<ProjectSession, 'project' | 'getLatestProject' | 'canWrite' | 'catalog' | 'write'>
export function useProjectContext(s: ContextSession) {
  const state = s.project?.production?.context
  const activeVersion = state?.versions.find(version => version.version === state.activeVersion)
  const serverDraft = state?.draft
  const initialized = s.project?.production?.contractVersion === 'production.1'
  const serverForm = contextForm(serverDraft ?? activeVersion?.context)
  const local = useReviewedDraft(s.project?.id, 'productionContext', serverForm, () => projectContextBase(s.project))
  const [copyVersion, setCopyVersion] = useState('')
  const [pendingCopy, setPendingCopy] = useState<{ label: string; prepared: ReturnType<typeof local.prepareReplacement> } | null>(null)
  // An untouched form follows the current server snapshot. Active versions remain read-only.
  const form = local.active ? local.value : serverForm
  const readOnly = !!activeVersion && !serverDraft && !local.active
  const canEdit = s.canWrite && initialized && !readOnly
  const compiled = compileContextForm(form)
  const issues = [...compiled.errors, ...contextReadiness(compiled.context, s.catalog)]
  const savedIssues = serverDraft ? contextReadiness(serverDraft, s.catalog) : []
  const rule = readOnly ? activeVersion?.rulePack : selectedRule(compiled.context, s.catalog)
  const canSave = s.canWrite && initialized && !local.needsReview && !compiled.errors.length && (local.active || (!serverDraft && !activeVersion))
  const canActivate = s.canWrite && initialized && !!serverDraft && !local.active && !local.needsReview && !savedIssues.length
  const setField = (key: keyof ContextForm, value: string) => {
    if (canEdit) local.setValue({ ...form, [key]: value })
  }
  const setRule = (id: string, version: string) => {
    if (canEdit) local.setValue({ ...form, rulePackId: id, rulePackVersion: version })
  }
  const applyRuleTarget = () => {
    if (canEdit && rule) local.setValue({ ...form, ...rule.target })
  }
  const requestCopy = (version: ProjectContextVersion) => {
    if (!s.canWrite || !initialized) return
    const prepared = local.prepareReplacement(contextForm(version.context))
    if (local.active || serverDraft) setPendingCopy({ label: version.label, prepared })
    else local.replace(prepared)
  }
  const confirmCopy = () => {
    if (!s.canWrite || !pendingCopy) return
    local.replace(pendingCopy.prepared); setPendingCopy(null)
  }
  const discard = () => { if (s.canWrite) { local.discard(); setPendingCopy(null) } }
  const afterSave = (next: Project) => {
    const latest = s.getLatestProject()
    // A successful idempotent replay may be older than a snapshot already received through SSE.
    // Keep the local input for comparison when another context has superseded that saved result.
    if (latest?.id === next.id && latest.revision > next.revision && !sameJsonValue(projectContextBase(latest), projectContextBase(next))) return
    local.discard(); setPendingCopy(null)
  }
  const save = () => {
    if (!canSave) return
    void s.write('production/context/draft', { context: compiled.context }, '制作配置草稿已保存。信息完整且规则匹配后，可明确启用新版本。', afterSave)
  }
  const activate = () => {
    if (!canActivate) return
    void s.write('production/context/activate', {}, '制作配置新版本已启用，历史版本保持不变。')
  }
  const initialize = () => {
    if (!s.canWrite || s.project?.production) return
    void s.write('production/initialize', {}, '已开启制作配置，请填写并明确保存。')
  }
  return { initialized, state, activeVersion, serverDraft, form, readOnly, canEdit, local, compiled, issues, rule,
    canSave, canActivate, setField, setRule, applyRuleTarget, save, activate, initialize, discard, requestCopy, pendingCopy, confirmCopy,
    cancelCopy: () => setPendingCopy(null), copyVersion, setCopyVersion,
    selectedCopyVersion: state?.versions.find(version => String(version.version) === copyVersion) ?? activeVersion,
    changes: contextDifferences(local.originalBase, local.currentBase),
  }
}

export type ProjectContextController = ReturnType<typeof useProjectContext>
