import { useState } from 'react'
import type { Project, Section } from './stage-a-api'

type Draft = Pick<Section, 'purpose' | 'factIds' | 'missingInputs'>
type Edit = Draft & { sourceId: string; currentId: string | null; storyboardId?: string; identityRevision: number }
type Props = { project: Project | null; canWrite: boolean; busy: boolean; reasonValid: boolean; onStory: () => void; write: (path: string, body: Record<string, unknown>, label: string, onSaved?: (next: Project) => void) => Promise<Project | undefined> | undefined; reason: string }
const same = (a: Draft, b: Draft) => a.purpose === b.purpose && JSON.stringify(a.factIds) === JSON.stringify(b.factIds) && JSON.stringify(a.missingInputs) === JSON.stringify(b.missingInputs)

export default function SectionDraftEditor({ project, canWrite, busy, reasonValid, onStory, write, reason }: Props) {
  const [viewId, setViewId] = useState('')
  const [edit, setEdit] = useState<Edit | null>(null)
  const current = project?.sections.find(s => s.id === project.currentSectionId)
  const viewed = project?.sections.find(s => s.id === viewId) ?? current
  const source = project?.sections.find(s => s.id === edit?.sourceId)
  const dirty = !!edit && !!source && !same(edit, source)
  const story = project?.storyboard
  const storyFacts = new Set(story?.chapters.flatMap(c => c.factIds) ?? [])
  const available = project?.facts.filter(f => f.status === 'confirmed' && f.issueSeverity === 'none' && storyFacts.has(f.id)) ?? []
  const invalidRefs = edit?.factIds.filter(id => !available.some(f => f.id === id)) ?? []
  const contextChanged = !!edit && (edit.currentId !== (project?.currentSectionId ?? null) || edit.storyboardId !== story?.id || edit.identityRevision !== (project?.identityRevision ?? 1))
  const canPlan = !!project?.identity && story?.freshness === 'current' && project.facts.some(f => f.status === 'confirmed' && f.role === 'core') && !project.facts.some(f => f.issueSeverity === 'blocker')
  const belongs = !!viewed && !!story && viewed.factIds.every(id => storyFacts.has(id)) && (story.id !== undefined || viewed.storyboardId !== undefined ? story.id !== undefined && viewed.storyboardId === story.id : viewed.sourceRunId !== 'human' && viewed.sourceRunId === story.sourceRunId)
  const restorable = !!viewed && belongs && viewed.freshness === 'current' && (viewed.identityRevision ?? 1) === (project?.identityRevision ?? 1) && viewed.factIds.every(id => available.some(f => f.id === id))
  const needsRebind = !!source && (source.freshness === 'stale' || source.storyboardId !== story?.id || (source.identityRevision ?? 1) !== (project?.identityRevision ?? 1))
  const canSave = canWrite && reasonValid && canPlan && (dirty || needsRebind) && !contextChanged && !!edit?.purpose.trim() && !!edit.factIds.length && edit.factIds.length <= 20 && !invalidRefs.length && edit.missingInputs.length <= 20 && edit.missingInputs.every(s => s.length <= 300)
  const factText = (ids: string[]) => ids.map(id => { const f = project?.facts.find(f => f.id === id); return f ? `${f.attribute}：${f.value}` : `引用已缺失：${id}` }).join('；') || '无'
  const load = () => {
    if (!viewed) return
    setEdit({ sourceId: viewed.id, currentId: project?.currentSectionId ?? null, storyboardId: story?.id, identityRevision: project?.identityRevision ?? 1, purpose: viewed.purpose, factIds: [...viewed.factIds], missingInputs: [...viewed.missingInputs] })
  }
  return <>
    <p>诊断草稿用于复核章节目的、事实引用和缺口。保存会创建新稿并保留历史；尚不包含成稿文案、HTML画布或设计批准。</p>
    {!project && <p>先在项目设置连接或创建项目。</p>}
    {project && !current && <div className="sa-record"><p>尚未选择当前诊断稿。请在故事线生成并显式应用候选，或从下方选择与当前故事顺序一致的历史稿。</p><button className="button" onClick={onStory}>前往故事线</button></div>}
    {current && <section aria-label="当前诊断稿"><h2>当前稿 · {current.freshness === 'current' ? '依赖有效' : '需要更新'} · 未批准</h2><p>{current.purpose}</p><small>稿件 ID：{current.id}</small><p>引用事实：{factText(current.factIds)}</p><p>待补充：{current.missingInputs.join('；') || '未记录缺口'}</p></section>}
    <h2>稿件历史（{project?.sections.length ?? 0}）</h2>
    <p>点选历史只查看差异，不改变当前稿。</p>
    <div className="sa-draft-history">{project?.sections.map((s, index) => <button key={s.id} className={`sa-list-item ${viewed?.id === s.id ? 'selected' : ''}`} aria-pressed={viewed?.id === s.id} onClick={() => setViewId(s.id)}><b>稿件 {index + 1}{s.id === current?.id ? ' · 当前稿' : ''}</b><span>{s.purpose}</span><small>{s.sourceRunId === 'human' ? '人工编辑' : '运行候选'} · {s.freshness === 'current' ? '依赖有效' : '需要更新'}</small></button>)}</div>
    {viewed && <>
      <h2>所选稿与当前稿比较</h2>
      <Compare before={current} after={viewed} factText={factText} afterLabel="所选稿" />
      <small>所选稿 ID：{viewed.id}{viewed.replacesSectionId ? ` · 基于 ${viewed.replacesSectionId}` : ''}</small>
      {viewed.reason && <p>保存原因：{viewed.reason}</p>}
      {!restorable && <p>此稿不能直接恢复：需要核对当前故事顺序、产品身份和事实依赖。可以载入后修正，另存为新稿。</p>}
      <button className="button" disabled={!canWrite || !reasonValid || !canPlan || !restorable || viewed.id === current?.id || dirty} onClick={() => write(`sections/${viewed.id}/select`, { reason }, '已选择历史诊断稿作为当前稿；内容未改写，尚未批准。')}>将所选历史设为当前稿</button>
      <button className="button" disabled={busy || !canWrite} onClick={load}>{dirty ? '放弃未保存修改，载入所选稿' : '载入所选稿供编辑'}</button>
    </>}
    {edit && <section aria-label="诊断稿编辑"><h2>编辑诊断草稿{dirty ? ' · 未保存' : ''}</h2>
      <small>编辑基于：{edit.sourceId}。查看其他历史不会替换此表单。</small>
      {contextChanged && <p role="alert">当前稿或上游依赖已变化，本地修改保留。请先比较差异，再载入所选稿重新编辑。</p>}
      {!canPlan && <p>保存前需要有效的故事顺序、已确认产品身份与核心事实，并处理事实冲突。</p>}
      <fieldset disabled={busy || !canWrite}>
        <legend>诊断内容</legend>
        <label className="sa-field"><span>章节表达目的（非最终文案）</span><textarea maxLength={300} rows={3} value={edit.purpose} onChange={e => setEdit({ ...edit, purpose: e.target.value })} /></label>
        <fieldset><legend>引用当前故事线中的已确认事实（1–20 条）</legend>{available.map(f => <label className="sa-check" key={f.id}><input type="checkbox" checked={edit.factIds.includes(f.id)} onChange={e => setEdit({ ...edit, factIds: e.target.checked ? [...edit.factIds, f.id] : edit.factIds.filter(id => id !== f.id) })} />{f.attribute}：{f.value}</label>)}</fieldset>
        {!!invalidRefs.length && <div><p role="alert">以下引用已失效或不属于当前故事线：{factText(invalidRefs)}</p><button className="button" onClick={() => setEdit({ ...edit, factIds: edit.factIds.filter(id => !invalidRefs.includes(id)) })}>移除失效引用</button></div>}
        <label className="sa-field"><span>待补充资料（每行一项，最多20项，每项300字）</span><textarea rows={4} value={edit.missingInputs.join('\n')} onChange={e => setEdit({ ...edit, missingInputs: e.target.value ? e.target.value.split('\n') : [] })} /></label>
      </fieldset>
      {(edit.missingInputs.length > 20 || edit.missingInputs.some(s => s.length > 300)) && <p role="alert">待补充资料超出限制，请缩短后保存。</p>}
      {!reasonValid && <p>请在右侧填写本次人工操作原因后保存或恢复历史稿。</p>}
      <Compare before={source} after={edit} factText={factText} afterLabel="本地修改" />
      <button className="button" disabled={!canSave} onClick={() => {
        void write(`sections/${edit.sourceId}/draft`, { purpose: edit.purpose, factIds: edit.factIds, missingInputs: edit.missingInputs, reason }, '新的诊断稿已保存并设为当前稿，原稿仍在历史中。', saved => { setEdit(null); setViewId(saved.currentSectionId ?? '') })
      }}>保存为新的诊断稿</button>
    </section>}
    <button className="button" disabled>确认本章设计（尚未实现）</button>
  </>
}

function Compare({ before, after, factText, afterLabel }: { before?: Draft; after: Draft; factText: (ids: string[]) => string; afterLabel: string }) {
  const rows = [ ['表达目的', before?.purpose ?? '尚无', after.purpose], ['事实引用', factText(before?.factIds ?? []), factText(after.factIds)], ['待补充资料', before?.missingInputs.join('；') || '无', after.missingInputs.join('；') || '无'] ]
  return <div className="sa-draft-comparison"><table><caption>内容差异</caption><thead><tr><th scope="col">字段</th><th scope="col">原稿</th><th scope="col">{afterLabel}</th></tr></thead><tbody>{rows.map(([label, oldValue, newValue]) => <tr key={label}><th scope="row">{label}{oldValue !== newValue ? ' · 有变化' : ''}</th><td>{oldValue}</td><td>{newValue}</td></tr>)}</tbody></table></div>
}
