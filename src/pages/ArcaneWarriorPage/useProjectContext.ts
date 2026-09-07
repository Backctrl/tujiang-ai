import { useEffect, useRef, useState } from 'react'
import type { ProjectContextVersion } from '../../../backend/src/production-context.js'
import type { Project } from './stage-a-api.js'
import { ApiError } from './stage-a-api.js'
import type { ProjectSession } from './useProjectSession.js'
import { readDraft, sameJsonValue, useProjectDraft, useReviewedDraft } from './project-drafts.js'
import { compileContextForm, contextDifferences, contextForm, contextFormDifferences, contextReadiness, normalizeContextForm, projectContextBase, scopedTargetFields, selectedRule, type ContextBase, type ContextForm } from './project-context.js'
import { isScopedRule, modelLabel, ruleKey, ruleModel, type RuleModel } from './rule-catalog.js'
import type { SetupCapture } from './setup-recovery.js'

export type ContextSession = Pick<ProjectSession, 'project' | 'getLatestProject' | 'canWrite' | 'catalog' | 'write'>
  & Partial<Pick<ProjectSession, 'scopedCatalog' | 'getLatestCatalog' | 'draftScope' | 'getCurrentScope' | 'canEditSetup' | 'setupRestoredDraft' | 'registerSetupDraft'>>
type SavedMode = { form: ContextForm; base: ContextBase | null }

export function useProjectContext(s: ContextSession) {
  const state = s.project?.production?.context
  const activeVersion = state?.versions.find(version => version.version === state.activeVersion)
  const serverDraft = state?.draft
  const initialized = s.project?.production?.contractVersion === 'production.1'
  const rules = s.catalog === null || s.scopedCatalog === null ? null : [...s.catalog, ...(s.scopedCatalog ?? [])]
  const serverContext = serverDraft ?? activeVersion?.context
  const serverRule = serverDraft ? selectedRule(serverDraft, rules) : activeVersion?.rulePack
  const serverForm = contextForm(serverContext, serverRule ? ruleModel(serverRule) : undefined)
  const scope = s.draftScope ?? s.project?.id
  const stored = useReviewedDraft(scope, 'productionContext', serverForm, () => projectContextBase(s.project), s.setupRestoredDraft?.reviewed, s.setupRestoredDraft?.reviewedRevision)
  const normalized = normalizeContextForm(stored.value, stored.originalBase)
  const migrationRequired = stored.active && normalized.migration
  const unsupported = stored.active ? normalized.unsupported : []
  const [backups, setBackups, getBackups, getBackupsRevision, backupsRecovery] = useProjectDraft<Partial<Record<RuleModel, SavedMode>>>(scope, 'productionContextModels', {}, s.setupRestoredDraft ? { value: s.setupRestoredDraft.models, revision: s.setupRestoredDraft.modelsRevision } : undefined)
  const recoveryConflict = !!stored.recovery.conflict || !!backupsRecovery.conflict
  const [copyVersion, setCopyVersion] = useState('')
  type Replacement = { label: string; prepared: { value: ContextForm; base: ContextBase | null }; from: SavedMode; changes: string[]; kind: 'copy' | 'model' }
  const [pendingCopy, updatePendingCopy] = useState<Replacement | null>(null)
  const pendingCopyRef = useRef<Replacement | null>(null)
  const setPendingCopy = (value: Replacement | null) => { pendingCopyRef.current = value; updatePendingCopy(value) }
  const form = stored.active ? normalized.form : serverForm
  const model = form.ruleModel as RuleModel
  const readOnly = !!activeVersion && !serverDraft && !stored.active
  const currentBase = projectContextBase(s.project)
  const currentNow = () => {
    const latest = s.getLatestProject()
    return (!s.getCurrentScope || s.getCurrentScope() === scope) && latest?.id === s.project?.id && sameJsonValue(projectContextBase(latest), currentBase)
  }
  const catalogNow = () => !s.getLatestCatalog || sameJsonValue(s.getLatestCatalog(), { contractVersion: 'production.1', rulePacks: s.catalog, scopedRulePacks: s.scopedCatalog ?? [] })
  const canEditLocal = s.canEditSetup ?? s.canWrite
  const canEdit = canEditLocal && !recoveryConflict && (initialized || !s.project?.production) && !readOnly && !pendingCopy && !migrationRequired && !unsupported.length
  const compiled = compileContextForm(form)
  const versionIssues = (draft: typeof compiled.context) => {
    const selected = selectedRule(draft, rules), frozen = state?.versions.find(version => ruleKey(version.rulePack) === ruleKey(draft.rulePackRef))
    return selected && frozen && !sameJsonValue(selected, frozen.rulePack) ? [{ field: 'rulePackRef', message: '当前目录同一规则版本与历史冻结内容不一致，请补齐正确版本或选择新的已核验版本' }] : []
  }
  const issues = [...compiled.errors, ...contextReadiness(compiled.context, rules), ...versionIssues(compiled.context)]
  const savedIssues = serverDraft ? [...contextReadiness(serverDraft, rules), ...versionIssues(serverDraft)] : []
  const rule = readOnly ? activeVersion?.rulePack : selectedRule(compiled.context, rules)
  const frozenReference = !rule && compiled.context.rulePackRef ? state?.versions.find(version => ruleKey(version.rulePack) === ruleKey(compiled.context.rulePackRef))?.rulePack : undefined
  const canSave = s.canWrite && !recoveryConflict && initialized && !pendingCopy && !migrationRequired && !unsupported.length && !stored.needsReview && !compiled.errors.length && (stored.active || (!serverDraft && !activeVersion))
  const canActivate = s.canWrite && !recoveryConflict && initialized && !pendingCopy && !!serverDraft && !stored.active && !stored.needsReview && !savedIssues.length
  const setField = (key: keyof ContextForm, value: string) => {
    if (!canEdit || !currentNow() || key === 'ruleModel') return
    const live = stored.getStored(), latestForm = live.active ? normalizeContextForm(live.value, live.base).form : form
    const next = { ...latestForm, [key]: value }
    if (scopedTargetFields.includes(key as typeof scopedTargetFields[number]) && latestForm[key] !== value) { next.rulePackId = ''; next.rulePackVersion = '' }
    if (key === 'platform' && latestForm.platform !== value) { next.site = ''; next.contentType = '' }
    if (key === 'site' && latestForm.site !== value && model === 'scoped-rules.1') next.contentType = ''
    stored.setValue(next)
  }
  const setRule = (id: string, version: string) => {
    if (!canEdit || !currentNow() || !catalogNow()) return
    const selected = rules?.find(item => item.id === id && item.version === version)
    if ((id || version) && (!selected || ruleModel(selected) !== model)) return
    const live = stored.getStored(), latestForm = live.active ? normalizeContextForm(live.value, live.base).form : form
    stored.setValue(selected ? { ...latestForm, ...selected.target, contentType: isScopedRule(selected) ? selected.target.contentType : '', selectionBasis: isScopedRule(selected) ? 'local_production_policy' : '', rulePackId: id, rulePackVersion: version }
      : { ...latestForm, rulePackId: '', rulePackVersion: '' })
  }
  const applyRuleTarget = () => { if (canEdit && rule && currentNow() && catalogNow() && ruleModel(rule) === model) setRule(rule.id, rule.version) }
  const sameChannel = (target: ContextForm) => target.platform === form.platform && target.site === form.site && target.contentType === form.contentType && target.ruleModel === model
  const localeRules = rules?.filter(item => ruleModel(item) === model && !!form.platform && !!form.site && item.target.platform === form.platform && item.target.site === form.site
    && (model !== 'scoped-rules.1' || (isScopedRule(item) && !!form.contentType && item.target.contentType === form.contentType))) ?? []
  const setLocaleRule = (id: string, version: string) => {
    const live = stored.getStored()
    const persisted = readDraft<typeof live | undefined>(scope, 'productionContext:reviewed', undefined)
    if (!localeRules.some(item => item.id === id && item.version === version) || (live.active && !sameChannel(normalizeContextForm(live.value, live.base).form))
      || persisted?.active && !sameChannel(normalizeContextForm(persisted.value, persisted.base).form)) return
    setRule(id, version)
  }
  const archive = (value: SavedMode) => setBackups(previous => ({ ...previous, [value.form.ruleModel]: value }))
  const canCopyVersion = (version?: ProjectContextVersion) => !!version && s.canWrite && !recoveryConflict && initialized && currentNow()
    && !!state?.versions.some(item => item.version === version.version && sameJsonValue(item, version))
  const requestCopy = (version: ProjectContextVersion) => {
    if (!canCopyVersion(version)) return
    const next = contextForm(version.context, ruleModel(version.rulePack))
    const prepared = stored.prepareReplacement(next), from = { form, base: stored.active ? stored.originalBase : currentBase }
    if (stored.active || serverDraft) setPendingCopy({ label: version.label, prepared, from, changes: contextFormDifferences(form, next), kind: 'copy' })
    else { archive(from); stored.replace(prepared) }
  }
  const requestModel = (nextModel: RuleModel) => {
    if (!canEdit || !currentNow() || !['legacy-canvas.1', 'scoped-rules.1'].includes(nextModel) || nextModel === model) return
    const retained = backups[nextModel]
    const next = retained ? normalizeContextForm(retained.form, retained.base).form : { ...form, ruleModel: nextModel, contentType: '', selectionBasis: nextModel === 'scoped-rules.1' ? 'local_production_policy' : '', rulePackId: '', rulePackVersion: '' }
    setPendingCopy({ label: modelLabel(nextModel), kind: 'model', prepared: retained ? { value: next, base: retained.base } : stored.prepareReplacement(next),
      from: { form, base: stored.active ? stored.originalBase : currentBase }, changes: contextFormDifferences(form, next) })
  }
  const confirmCopy = () => {
    if (!canEditLocal || !pendingCopy || pendingCopyRef.current !== pendingCopy || s.getLatestProject()?.id !== s.project?.id
      || s.getCurrentScope && s.getCurrentScope() !== scope) return
    // A prepared copy keeps its original base when another context arrived during comparison.
    archive(pendingCopy.from); stored.replace(pendingCopy.prepared); setPendingCopy(null)
  }
  const discard = () => { if (canEditLocal && currentNow()) { archive({ form, base: stored.originalBase }); stored.discard(); setPendingCopy(null) } }
  const migrateLocal = () => {
    if (!canEditLocal || !currentNow() || !migrationRequired || unsupported.length) return
    stored.replace({ value: normalized.form, base: stored.originalBase }); setPendingCopy(null)
  }
  const acknowledge = () => { if (!recoveryConflict && !migrationRequired && !unsupported.length && canEditLocal && currentNow()) stored.acknowledge() }
  const save = () => {
    if (!canSave || !currentNow()) return
    const submitted = form
    const afterSave = (next: Project) => {
      const latest = s.getLatestProject()
      if (!latest || latest.id !== next.id || next.id !== s.project?.id || pendingCopyRef.current || !sameJsonValue(projectContextBase(latest), projectContextBase(next))) return
      const live = stored.getStored()
      if (live?.active && !sameJsonValue(normalizeContextForm(live.value, live.base).form, submitted)) return
      stored.discard(); setPendingCopy(null)
    }
    void s.write('production/context/draft', { context: compiled.context }, '制作配置草稿已保存。信息完整且规则匹配后，可明确启用新版本。', afterSave)
  }
  const activate = () => {
    if (!canActivate || !currentNow() || !catalogNow()) return
    void s.write('production/context/activate', {}, '制作配置新版本已启用，历史版本保持不变。')
  }
  const initialize = () => {
    if (!s.canWrite || s.project?.production || !currentNow()) return
    void s.write('production/initialize', {}, '已开启制作配置，请填写并明确保存。')
  }
  const local = { ...stored, acknowledge, needsReview: stored.needsReview || !!backupsRecovery.conflict || migrationRequired || !!unsupported.length }
  const capture = (): SetupCapture => {
    if (stored.recovery.getConflict() || backupsRecovery.getConflict()) throw new ApiError('LOCAL_DRAFT_RECOVERY_CONFLICT', 0)
    return { reviewed: { ...stored.getStored(), value: normalizeContextForm(stored.getStored().value, stored.getStored().base).form }, models: getBackups(), reviewedRevision: stored.getRevision(), modelsRevision: getBackupsRevision() }
  }
  const getCurrentInput = () => {
    if (s.getCurrentScope && s.getCurrentScope() !== scope || pendingCopyRef.current || stored.recovery.getConflict() || backupsRecovery.getConflict()) return undefined
    const latest = s.getLatestProject(), live = stored.getStored()
    if (live.active && !sameJsonValue(live.base, projectContextBase(latest))) return undefined
    const normalizedLive = normalizeContextForm(live.active ? live.value : form, live.base)
    if (normalizedLive.migration || normalizedLive.unsupported.length) return undefined
    const result = compileContextForm(normalizedLive.form)
    return result.errors.length ? undefined : { ...result, form: normalizedLive.form }
  }
  useEffect(() => {
    if (!scope || !s.registerSetupDraft) return
    s.registerSetupDraft({ scopeId: scope, capture, initialized: (before, next) => {
      const live = stored.getStored(), afterBase = projectContextBase(next)
      if (!before?.production && afterBase.initialized && !afterBase.draft && !afterBase.activeContext && afterBase.activeVersion === null
        && sameJsonValue(projectContextBase(s.getLatestProject()), afterBase) && live.active && sameJsonValue(live.base, projectContextBase(before))) stored.replace({ value: live.value, base: afterBase })
    } })
    return () => s.registerSetupDraft?.(null)
  })
  const afterStartup = (next: Project, submitted: ContextForm) => {
    const live = stored.getStored()
    if (s.getCurrentScope && s.getCurrentScope() !== scope || s.getLatestProject()?.id !== next.id || pendingCopyRef.current
      || !sameJsonValue(projectContextBase(s.getLatestProject()), projectContextBase(next))) return false
    if (live.active && !sameJsonValue(normalizeContextForm(live.value, live.base).form, submitted)) return false
    stored.discard()
    return true
  }
  const chooseRecovery = (kind: 'reviewed' | 'models', source: 'local' | 'restored') => {
    if (!currentNow()) return
    if (kind === 'reviewed') stored.recovery.choose(source); else backupsRecovery.choose(source)
  }
  return { initialized, state, activeVersion, serverDraft, form, model, readOnly, compatibilityBlocked: false, canEdit, canCopyVersion, local, compiled, issues, rule, rules, localeRules, setLocaleRule, frozenReference,
    canSave, canActivate, setField, setRule, applyRuleTarget, save, activate, initialize, discard, requestCopy, pendingCopy, confirmCopy, requestModel, backups,
    migrationRequired, unsupported, migrateLocal, migrationRaw: migrationRequired || unsupported.length ? JSON.stringify(stored.value, null, 2) : '',
    cancelCopy: () => setPendingCopy(null), copyVersion, setCopyVersion,
    selectedCopyVersion: state?.versions.find(version => String(version.version) === copyVersion) ?? activeVersion, getCurrentInput, afterStartup, recoveryConflict, backupsRecovery, chooseRecovery,
    changes: contextDifferences(stored.originalBase, stored.currentBase),
  }
}

export type ProjectContextController = ReturnType<typeof useProjectContext>
