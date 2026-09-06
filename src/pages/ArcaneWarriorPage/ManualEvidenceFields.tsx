import { useProjectDraft } from './project-drafts'
import { Button } from './WorkbenchUI'
import type { ProjectSession } from './useProjectSession'

export function ManualEvidenceFields({ session: s, surface = 'setup' }: { session: ProjectSession; surface?: 'setup' | 'facts' }) {
  const field = (name: string) => surface === 'setup' ? name : `manualEvidence:facts:${name}`
  const [documentName, setDocumentName] = useProjectDraft(s.project?.id, field('documentName'), '')
  const [locator, setLocator] = useProjectDraft(s.project?.id, field('locator'), '')
  const [text, setText] = useProjectDraft(s.project?.id, field('evidenceText'), '')
  const count = s.project?.evidence.filter(source => !source.materialSource).length ?? 0
  const valid = !!documentName.trim() && !!locator.trim() && !!text.trim() && !text.includes('\0')
  const save = () => {
    const latest = s.getLatestProject()
    if (!latest || latest.id !== s.project?.id || !valid || latest.evidence.filter(source => !source.materialSource).length >= 10) return
    void s.reviewWrite('manual-evidence', 'evidence', { documentName, locator, text, usage: 'product_evidence' }, '文字证据已保存。', next => {
      const received = next.evidence.findLast(evidence => !evidence.materialSource && evidence.documentName === documentName && evidence.locator === locator && evidence.text === text)
      if (received && s.getLatestProject()?.evidence.some(evidence => evidence.id === received.id)) { setDocumentName(''); setLocator(''); setText('') }
    })
  }
  return <><div className="form-grid">
    <label>资料名称<input maxLength={200} value={documentName} disabled={!s.canWrite} onChange={e => setDocumentName(e.target.value)} /></label>
    <label>原文位置<input maxLength={300} value={locator} disabled={!s.canWrite} onChange={e => setLocator(e.target.value)} placeholder="例如：规格说明第 2 段" /></label>
    <label className="wide">资料原文<textarea rows={5} maxLength={80000} value={text} disabled={!s.canWrite} onChange={e => setText(e.target.value)} placeholder="粘贴产品资料原文" /></label>
  </div><Button tone="violet" disabled={!s.canWrite || !valid || count >= 10} onClick={save}>保存文字证据</Button>
    <p className="hint">手工文字证据 {count}/10 份。作为独立人工录入保存，不附加原件派生字段。</p></>
}
