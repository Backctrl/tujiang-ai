import { useRef, useState } from 'react'
import type { ProjectContextVersion } from '../../../backend/src/production-context.js'
import type { Project } from './stage-a-api.js'
import type { ProjectSession } from './useProjectSession.js'
import { readDraft, sameJsonValue, useProjectDraft, useReviewedDraft } from './project-drafts.js'
import { compileContextForm, contextDifferences, contextForm, contextFormDifferences, contextReadiness, normalizeContextForm, projectContextBase, selectedRule, type ContextBase, type ContextForm } from './project-context.js'
import { isScopedRule, modelLabel, ruleKey, ruleModel, type RuleModel } from './rule-catalog.js'

export type ContextSession = Pick<ProjectSession, 'project' | 'getLatestProject' | 'canWrite' | 'catalog' | 'write'>
  & Partial<Pick<ProjectSession, 'scopedCatalog' | 'getLatestCatalog'>>
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
  const stored = useReviewedDraft(s.project?.id, 'productionContext', serverForm, () => projectContextBase(s.project))
  const normalized = normalizeContextForm(stored.value, stored.originalBase)
  const migrationRequired = stored.active && normalized.migration
  const unsupported = stored.active ? normalized.unsupported : []
  const [backups, setBackups] = useProjectDraft<Partial<Record<RuleModel, SavedMode>>>(s.project?.id, 'productionContextModels', {})
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
    return !!latest && latest.id === s.project?.id && sameJsonValue(projectContextBase(latest), currentBase)
  }
  const catalogNow = () => !s.getLatestCatalog || sameJsonValue(s.getLatestCatalog(), { contractVersion: 'production.1', rulePacks: s.catalog, scopedRulePacks: s.scopedCatalog ?? [] })
  const canEdit = s.canWrite && initialized && !readOnly && !pendingCopy && !migrationRequired && !unsupported.length
  const compiled = compileContextForm(form)
  const versionIssues = (draft: typeof compiled.context) => {
    const selected = selectedRule(draft, rules), frozen = state?.versions.find(version => ruleKey(version.rulePack) === ruleKey(draft.rulePackRef))
    return selected && frozen && !sameJsonValue(selected, frozen.rulePack) ? [{ field: 'rulePackRef', message: '当前目录同一规则版本与历史冻结内容不一致，请补齐正确版本或选择新的已核验版本' }] : []
  }
  const issues = [...compiled.errors, ...contextReadiness(compiled.context, rules), ...versionIssues(compiled.context)]
  const savedIssues = serverDraft ? [...contextReadiness(serverDraft, rules), ...versionIssues(serverDraft)] : []
  const rule = readOnly ? activeVersion?.rulePack : selectedRule(compiled.context, rules)
  const frozenReference = !rule && compiled.context.rulePackRef ? state?.versions.find(version => ruleKey(version.rulePack) === ruleKey(compiled.context.rulePackRef))?.rulePack : undefined
  const canSave = s.canWrite && initialized && !pendingCopy && !migrationRequired && !unsupported.length && !stored.needsReview && !compiled.errors.length && (stored.active || (!serverDraft && !activeVersion))
  const canActivate = s.canWrite && initialized && !pendingCopy && !!serverDraft && !stored.active && !stored.needsReview && !savedIssues.length
  const setField = (key: keyof ContextForm, value: string) => {
    if (!canEdit || !currentNow() || key === 'ruleModel') return
    const next = { ...form, [key]: value }
    if (['platform', 'site', 'contentType'].includes(key) && form[key] !== value) { next.rulePackId = ''; next.rulePackVersion = '' }
    if (key === 'platform' && form.platform !== value) { next.site = ''; next.contentType = '' }
    if (key === 'site' && form.site !== value && model === 'scoped-rules.1') next.contentType = ''
    stored.setValue(next)
  }
  const setRule = (id: string, version: string) => {
    if (!canEdit || !currentNow() || !catalogNow()) return
    const selected = rules?.find(item => item.id === id && item.version === version)
    if ((id || version) && (!selected || ruleModel(selected) !== model)) return
    stored.setValue(selected ? { ...form, ...selected.target, contentType: isScopedRule(selected) ? selected.target.contentType : '', selectionBasis: isScopedRule(selected) ? 'local_production_policy' : '', rulePackId: id, rulePackVersion: version }
      : { ...form, rulePackId: '', rulePackVersion: '' })
  }
  const applyRuleTarget = () => { if (canEdit && rule && currentNow() && catalogNow() && ruleModel(rule) === model) setRule(rule.id, rule.version) }
  const archive = (value: SavedMode) => setBackups(previous => ({ ...previous, [value.form.ruleModel]: value }))
  const canCopyVersion = (version?: ProjectContextVersion) => !!version && s.canWrite && initialized && currentNow()
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
    if (!s.canWrite || !pendingCopy || pendingCopyRef.current !== pendingCopy || s.getLatestProject()?.id !== s.project?.id) return
    // A prepared copy keeps its original base when another context arrived during comparison.
    archive(pendingCopy.from); stored.replace(pendingCopy.prepared); setPendingCopy(null)
  }
  const discard = () => { if (s.canWrite && currentNow()) { archive({ form, base: stored.originalBase }); stored.discard(); setPendingCopy(null) } }
  const migrateLocal = () => {
    if (!s.canWrite || !currentNow() || !migrationRequired || unsupported.length) return
    stored.replace({ value: normalized.form, base: stored.originalBase }); setPendingCopy(null)
  }
  const acknowledge = () => { if (!migrationRequired && !unsupported.length && s.canWrite && currentNow()) stored.acknowledge() }
  const save = () => {
    if (!canSave || !currentNow()) return
    const submitted = form
    const afterSave = (next: Project) => {
      const latest = s.getLatestProject()
      if (!latest || latest.id !== next.id || next.id !== s.project?.id || pendingCopyRef.current || !sameJsonValue(projectContextBase(latest), projectContextBase(next))) return
      const live = readDraft<{ value: ContextForm; active: boolean; base: ContextBase | null } | undefined>(next.id, 'productionContext:reviewed', undefined)
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
  const local = { ...stored, acknowledge, needsReview: stored.needsReview || migrationRequired || !!unsupported.length }
  return { initialized, state, activeVersion, serverDraft, form, model, readOnly, compatibilityBlocked: false, canEdit, canCopyVersion, local, compiled, issues, rule, rules, frozenReference,
    canSave, canActivate, setField, setRule, applyRuleTarget, save, activate, initialize, discard, requestCopy, pendingCopy, confirmCopy, requestModel, backups,
    migrationRequired, unsupported, migrateLocal, migrationRaw: migrationRequired || unsupported.length ? JSON.stringify(stored.value, null, 2) : '',
    cancelCopy: () => setPendingCopy(null), copyVersion, setCopyVersion,
    selectedCopyVersion: state?.versions.find(version => String(version.version) === copyVersion) ?? activeVersion,
    changes: contextDifferences(stored.originalBase, stored.currentBase),
  }
}

export type ProjectContextController = ReturnType<typeof useProjectContext>
