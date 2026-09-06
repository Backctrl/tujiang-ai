import { useProjectDraft } from './project-drafts'
import { Button } from './WorkbenchUI'
import type { ProjectSession } from './useProjectSession'
import { evidenceAvailable } from './material-review'

export function ManualEvidenceFields({ session: s, surface = 'setup' }: { session: ProjectSession; surface?: 'setup' | 'facts' }) {
  const field = (name: string) => surface === 'setup' ? name : `manualEvidence:facts:${name}`
  const [documentName, setDocumentName] = useProjectDraft(s.project?.id, field('documentName'), '')
  const [locator, setLocator] = useProjectDraft(s.project?.id, field('locator'), '')
  const [text, setText] = useProjectDraft(s.project?.id, field('evidenceText'), '')
  const count = s.project?.evidence.filter(source => !source.materialSource).length ?? 0
  const valid = !!documentName.trim() && !!locator.trim() && !!text.trim() && !text.includes('\0')
  const matchingSaved = (project: ProjectSession['project']) => project?.evidence.find(evidence => !evidence.materialSource && evidenceAvailable(project, evidence)
    && evidence.documentName === documentName.trim() && evidence.locator === locator.trim() && evidence.text === text)
  const existing = matchingSaved(s.project)
  const clear = () => { setDocumentName(''); setLocator(''); setText('') }
  const save = () => {
    const latest = s.getLatestProject()
    if (!s.canWrite || !latest || latest.id !== s.project?.id || !valid || matchingSaved(latest) || latest.evidence.filter(source => !source.materialSource).length >= 10) return
    const submitted = { documentName: documentName.trim(), locator: locator.trim(), text, usage: 'product_evidence' }
    void s.reviewWrite('manual-evidence', 'evidence', submitted, '文字证据已保存。', next => {
      const received = next.evidence.findLast(evidence => !evidence.materialSource && evidence.documentName === submitted.documentName && evidence.locator === submitted.locator && evidence.text === submitted.text)
      if (received && s.getLatestProject()?.evidence.some(evidence => evidence.id === received.id)) clear()
    })
  }
  return <><div className="form-grid">
    <label>资料名称<input maxLength={200} value={documentName} disabled={!s.canWrite} onChange={e => setDocumentName(e.target.value)} /></label>
    <label>原文位置<input maxLength={300} value={locator} disabled={!s.canWrite} onChange={e => setLocator(e.target.value)} placeholder="例如：规格说明第 2 段" /></label>
    <label className="wide">资料原文<textarea rows={5} maxLength={80000} value={text} disabled={!s.canWrite} onChange={e => setText(e.target.value)} placeholder="粘贴产品资料原文" /></label>
  </div>{existing && <div className="inspector-block" role="status"><b>这份文字证据已保存</b><p>{existing.documentName} · {existing.locator}<br />证据编号：{existing.id}</p><p>当前草稿与已保存原文相同，不会重复创建。若有未决请求，仍需先核对并使用原操作重试。</p><Button disabled={!s.canWrite} onClick={() => {
    const latest = s.getLatestProject()
    if (s.canWrite && latest?.id === s.project?.id && matchingSaved(latest)?.id === existing.id) clear()
  }}>清空这份已保存草稿</Button></div>}
  <Button tone="violet" disabled={!s.canWrite || !valid || count >= 10 || !!existing} onClick={save}>保存文字证据</Button>
    <p className="hint">手工文字证据 {count}/10 份。作为独立人工录入保存，不附加原件派生字段。</p></>
}
