import { useId, useRef, useState } from 'react'
import { Download, FileText, Image, RefreshCw, Upload } from 'lucide-react'
import type { Material, MaterialBlock, MaterialSource } from '../../../backend/src/production-materials.js'
import { Button, Chip, StatusDot } from './WorkbenchUI'
import { compileMaterialSource, emptyMaterialSource, materialBlockLocation, materialFileAccept, materialStatus, safeSourceUrl, type MaterialSourceForm } from './material-intake'
import { errorMessage } from './stage-a-api'
import type { ProjectSession } from './useProjectSession'
import type { MaterialIntakeController } from './useMaterialIntake'
import { useProjectDraft } from './project-drafts'

type Props = { intake: MaterialIntakeController; session: ProjectSession }
const hintLabel = { unknown: '未分类', product_evidence: '产品证据线索', asset: '素材线索', reference: '参考线索', mixed: '混合线索' }
const blockLabel: Record<MaterialBlock['kind'], string> = { unclassified_block: '未分类候选', evidence_block: '证据候选', reference_block: '参考候选', asset: '素材候选' }
function fileSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB` }

export function MaterialUploadFields({ intake, session, surface }: Props & { surface: 'setup' | 'facts' }) {
  const input = useRef<HTMLInputElement>(null)
  const urlInput = useRef<HTMLInputElement>(null)
  const id = useId()
  const [source, setSource] = useProjectDraft(session.project?.id, `materialSource:${surface}`, emptyMaterialSource)
  const [errors, setErrors] = useState<Partial<Record<keyof MaterialSourceForm, string>>>({})
  const select = () => {
    const compiled = compileMaterialSource(source)
    setErrors(compiled.errors)
    if (Object.keys(compiled.errors).length) { urlInput.current?.focus(); return }
    input.current?.click()
  }
  const add = (files: File[]) => {
    const compiled = compileMaterialSource(source)
    setErrors(compiled.errors)
    if (Object.keys(compiled.errors).length) { urlInput.current?.focus(); return }
    void intake.addFiles(files, compiled.source)
  }
  return <div>
    {!intake.initialized && <p className="integration-note">请先在产品基础信息区开启制作配置，再上传原件。</p>}
    <details className="inspector-block"><summary>来源记录（用于接下来选择的文件）</summary><div className="form-grid">
      <label className="wide">资料来源<select value={source.kind} disabled={!intake.canSelect} onChange={e => setSource({ ...source, kind: e.target.value as MaterialSourceForm['kind'] })}><option value="local_upload">本地原件</option><option value="feishu_export">飞书导出</option></select></label>
      <label className="wide">原文链接{source.kind === 'feishu_export' ? '（必填）' : '（可选）'}<input ref={urlInput} type="url" maxLength={2000} value={source.url} disabled={!intake.canSelect} aria-invalid={!!errors.url} aria-describedby={errors.url ? `${id}-url-error` : undefined} onChange={e => setSource({ ...source, url: e.target.value })} placeholder="https://…" /></label>
      {errors.url && <p id={`${id}-url-error`} className="wide" role="alert">{errors.url}</p>}
      <label className="wide">原文标题（可选）<input maxLength={300} value={source.title} disabled={!intake.canSelect} aria-invalid={!!errors.title} onChange={e => setSource({ ...source, title: e.target.value })} /></label>
      <label>原文版本（可选）<input maxLength={100} value={source.revision} disabled={!intake.canSelect} aria-invalid={!!errors.revision} onChange={e => setSource({ ...source, revision: e.target.value })} placeholder="例如：revision 33" /></label>
      <label>原文位置（可选）<input maxLength={500} value={source.locator} disabled={!intake.canSelect} aria-invalid={!!errors.locator} onChange={e => setSource({ ...source, locator: e.target.value })} placeholder="例如：产品规格表 / 第 2 页" /></label>
      {(['title', 'revision', 'locator'] as const).filter(key => errors[key]).map(key => <p className="wide" role="alert" key={key}>{errors[key]}</p>)}
      <p className="integration-note wide">来源信息会与原件一起保存；原文链接只用于定位，不会自动读取网页。</p>
    </div></details>
    <button type="button" className="button full upload-zone" disabled={!intake.canSelect} onClick={select} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (intake.canSelect) add(Array.from(e.dataTransfer.files)) }}>
      <Upload size={26} aria-hidden="true" /><b>{intake.adding ? '正在保存本地文件队列…' : surface === 'facts' ? '增量添加资料原件' : '拖入多份原件，或选择文件'}</b>
      <span>TXT / Markdown / CSV / JSON / PNG / JPEG / WebP · 单份最多 10 MiB</span><span className="button violet">选择资料文件</span>
    </button>
    <input ref={input} type="file" multiple accept={materialFileAccept} hidden aria-label="选择资料文件" disabled={!intake.canSelect} onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    <p className="integration-note">选择后先保留在此浏览器，点击开始上传后才保存到服务端。上传与解析不确认用途，也不形成已确认事实。</p>
    <p className="hint" role="status">{intake.loading ? '正在读取此项目的本地队列…' : `${intake.entries.filter(entry => entry.status === 'waiting').length} 份等待上传 · ${intake.materials.length} 份服务端原件`}</p>
    {intake.selectionErrors.map((message, index) => <p role="alert" key={index}>{message}</p>)}
    {intake.error && <div role="alert"><p>{intake.error}</p><Button disabled={session.busy || intake.loading} onClick={intake.reload}>重新读取本地队列</Button></div>}
    {!!intake.entries.length && <>
      <div className="connection-actions"><Button tone="violet" disabled={!session.canWrite || intake.loading || intake.running || !intake.entries.some(entry => entry.status === 'waiting')} onClick={intake.start}>开始上传等待的文件</Button>{intake.running && <Button onClick={intake.pause}>暂停后续文件</Button>}</div>
      <p className="hint">文件依次提交；格式拒绝只影响该份。版本冲突或结果未确认会暂停，已接收文件不会重新加入队列。</p>
      <div className={surface === 'setup' ? 'setup-source-list' : 'rail-list'}>{intake.entries.map(entry => {
        const active = session.materialActivity?.entryId === entry.id
        const pending = session.pending?.kind === 'material' && session.pending.operation.entryId === entry.id
        const label = active ? session.materialActivity?.phase === 'reading' ? '读取原件' : '上传中' : pending || ['uploading', 'uncertain'].includes(entry.status) ? '结果待核对' : entry.status === 'waiting' ? '等待上传' : entry.status === 'conflict' ? '版本冲突，等待复核' : '上传失败'
        const canRetry = !pending && !active && !['uploading', 'uncertain'].includes(entry.status)
        return <div className="source-card" key={entry.id}><FileText size={18} aria-hidden="true" /><div><b title={entry.fileName}>{entry.fileName}</b><span>{fileSize(entry.sizeBytes)} · 本地文件</span><span>{label}</span><details><summary>查看本次来源</summary><SourceLocation source={entry.source} /></details>{entry.message && <p role="alert">{entry.message}</p>}</div><div className="source-status"><StatusDot tone={entry.status === 'rejected' || entry.status === 'conflict' ? 'red' : 'muted'} />{entry.status === 'waiting' ? '保存在此浏览器，尚未上传' : label}</div>{canRetry && <div className="source-status"><Button disabled={!session.canWrite || intake.running} onClick={() => void intake.retryLocal(entry)}>{entry.status === 'waiting' ? '上传此文件' : '重试此文件'}</Button><Button disabled={!session.canWrite || intake.running} onClick={() => void intake.remove(entry)}>移除本地文件</Button></div>}</div>
      })}</div>
    </>}
  </div>
}

function SourceLocation({ source }: { source: MaterialSource }) {
  const url = safeSourceUrl(source.url)
  return <div><p>{source.kind === 'feishu_export' ? '飞书导出' : '本地原件'}{source.title ? ` · ${source.title}` : ''}</p>{url && <p><a href={url} target="_blank" rel="noopener noreferrer">打开记录的原文链接</a></p>}{source.revision && <p>原文版本：{source.revision}</p>}{source.locator && <p>原文位置：{source.locator}</p>}</div>
}

function CandidateContent({ block }: { block: MaterialBlock }) {
  return <div className="inspector-block"><b>{blockLabel[block.kind]} · 待审核</b><p>{materialBlockLocation(block)}</p>{block.text !== undefined && <p>{block.text}</p>}{block.cells && <details><summary>查看 {block.cells.length} 个单元格</summary><ol>{block.cells.map((cell, index) => <li key={index}><p>{cell || '（空单元格）'}</p></li>)}</ol></details>}{block.image && <><p>{block.image.widthPx} × {block.image.heightPx} px · {block.image.format.toUpperCase()}{block.image.hasAlpha ? ' · 含透明通道' : ''}{block.image.orientation ? ` · 方向 ${block.image.orientation}` : ''}</p><p>仅验证图片并读取尺寸等信息，未执行 OCR 或图片语义识别。</p></>}<details><summary>追溯此候选</summary><p>候选 ID：{block.id}</p><p>原件 ID：{block.materialId}</p><p>原件 SHA-256：{block.sourceSha256}</p><p>解析版本：{block.parserVersion}</p></details></div>
}

export function MaterialCard({ material, intake, session }: Props & { material: Material }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 20
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(material.blocks.length / pageSize) - 1))
  const status = materialStatus(material)
  const failed = material.parse.queueStatus === 'done' && material.parse.runStatus === 'failed'
  const icon = ['png', 'jpeg', 'webp'].includes(material.format) ? <Image size={19} aria-hidden="true" /> : <FileText size={19} aria-hidden="true" />
  const download = async () => {
    if (downloading) return
    setDownloading(true); setDownloadError('')
    try { await intake.download(material) } catch (err) { setDownloadError(errorMessage(err)) } finally { setDownloading(false) }
  }
  return <article className="source-card">{icon}<div><b title={material.fileName}>{material.fileName}</b><span>{material.format.toUpperCase()} · {fileSize(material.sizeBytes)}</span><span>{status} · {material.blocks.length} 个候选</span><Chip tone="muted">用途待审核 · {hintLabel[material.usage.hint]}</Chip>
    <details><summary>查看来源与原件信息</summary>{material.origins.map((origin, index) => <div className="inspector-block" key={index}><b>{origin.fileName}</b><SourceLocation source={origin.source} /><p>导入时间：{new Date(origin.uploadedAt).toLocaleString('zh-CN')}</p></div>)}<p>原件 ID：{material.id}</p><p>SHA-256：{material.sha256}</p></details>
    <details><summary>查看解析记录</summary>{material.parse.notes.map((note, index) => <p key={index}>{note}</p>)}{material.parse.errorCode && <p>{material.parse.errorCode}</p>}<p>当前尝试：{material.parse.attempt} 次</p>{material.parse.attempts.map(attempt => <p key={attempt.attempt}>第 {attempt.attempt} 次 · {attempt.status === 'succeeded' ? '成功' : attempt.status === 'failed' ? '失败' : '执行中'}{attempt.errorCode ? ` · ${attempt.errorCode}` : ''}</p>)}</details>
    {!!material.blocks.length && <details><summary>查看候选与原文位置（{material.blocks.length}）</summary><p>以下内容保留为待审核候选。</p>{material.blocks.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map(block => <CandidateContent key={block.id} block={block} />)}{material.blocks.length > pageSize && <div className="connection-actions"><Button disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>上一页候选</Button><span>第 {pageIndex + 1} / {Math.ceil(material.blocks.length / pageSize)} 页</span><Button disabled={(pageIndex + 1) * pageSize >= material.blocks.length} onClick={() => setPage(pageIndex + 1)}>下一页候选</Button></div>}</details>}
    {failed && <p role="status">{material.parse.notes[0] ?? '解析未完成。可重试此文件，或修复内容后上传新原件。'}</p>}{downloadError && <p role="alert">{downloadError}</p>}
  </div><div className="source-status"><StatusDot tone={failed ? 'red' : material.parse.runStatus === 'succeeded' ? 'green' : 'muted'} />{status}</div><div className="source-status"><Button disabled={!session.token.trim() || downloading} onClick={() => void download()}><Download size={14} aria-hidden="true" />{downloading ? '下载原件中…' : '下载原件'}</Button>{failed && <Button disabled={!session.canWrite} onClick={() => void session.retryMaterialParse(material.id)}><RefreshCw size={14} aria-hidden="true" />重试解析</Button>}</div></article>
}

export function MaterialList({ intake, session }: Props) {
  return <>{intake.materials.map(material => <MaterialCard key={material.id} material={material} intake={intake} session={session} />)}{!intake.materials.length && <p className="hint">尚无服务端原件。等待上传的本地文件会单独列出。</p>}</>
}
