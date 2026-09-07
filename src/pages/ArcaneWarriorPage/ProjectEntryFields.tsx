import { useState } from 'react'
import { useReviewedDraft } from './project-drafts'
import type { ProjectSession } from './useProjectSession'
import { Button } from './WorkbenchUI'

/** Connection and legacy project controls stay outside the five business sections. */
export function ProjectEntryFields({ session: s }: { session: ProjectSession }) {
  const [name, setName] = useState('')
  const identityDraft = useReviewedDraft<string | null, { revision: number; name: string }>(s.project?.id, 'productName', null, () => ({ revision: s.project?.identityRevision ?? 0, name: s.project?.identity?.productName ?? '未确认' }))
  const identityValue = identityDraft.value ?? s.project?.identity?.productName ?? ''
  return <details className="form-panel setup-project-entry" open={!s.project}><summary><b>项目入口</b> · {s.project?.name ?? '连接后新建或打开项目'}</summary>
    <div className="form-grid setup-form-grid"><label className="wide">连接凭据<input type="password" autoComplete="off" disabled={s.busy || ((!!s.project || !!s.pending) && !s.authExpired && !s.recoveryNeedsCheck)} value={s.token} onChange={e => s.setToken(e.target.value)} placeholder="仅保存在当前页面内存" /></label>
      <Button disabled={!s.token.trim() || s.busy || !!s.pending} onClick={() => void s.listProjects()}>连接并读取项目列表</Button>
      <label className="wide">已有项目<select value={s.projects.some(p => p.id === s.project?.id) ? s.project?.id : ''} disabled={!s.canSwitch || !s.token.trim()} onChange={e => void s.selectProject(e.target.value)}><option value="">选择项目</option>{s.projects.map(p => <option key={p.id} value={p.id}>{p.name} · R{p.revision}</option>)}</select></label>
      <label>新项目名称<input maxLength={150} value={name} disabled={!s.canSwitch} onChange={e => setName(e.target.value)} /></label><Button disabled={!s.token.trim() || !name.trim() || !s.canSwitch} onClick={() => void s.create(name)}>新建项目草稿</Button>
      <p className="integration-note wide">新建后填写下方五项配置。切换项目保留各项目的本地草稿；未决请求或待复核冲突处理完成后才能切换。</p>
      <details className="wide"><summary>按项目 ID 打开（兼容入口）</summary><label>项目 ID<input value={s.projectId} disabled={!s.canSwitch} onChange={e => s.setProjectId(e.target.value)} /></label><Button disabled={!s.token.trim() || !s.projectId.trim() || !s.canSwitch} onClick={() => void s.selectProject(s.projectId.trim())}>打开项目</Button></details>
      <details className="wide"><summary>兼容身份设置 · {s.project?.identity?.productName ?? '待确认'}</summary><p className="integration-note">已有项目的文字事实提取身份在这里查看或明确纠正。产品基础信息不会自动覆盖已确认身份。</p><div className="form-grid">
        <label className="wide">事实提取用产品名称<input maxLength={150} disabled={!s.canWrite} value={identityValue} onChange={e => identityDraft.setValue(e.target.value)} /></label>
        {s.project?.identity && <label className="wide">修改原因<textarea maxLength={1000} value={s.reason} onChange={e => s.setReason(e.target.value)} disabled={!s.canWrite} /></label>}
        {identityDraft.needsReview && <div className="wide inspector-block" role="alert"><b>身份草稿需要复核</b><p>草稿依据：{identityDraft.originalBase?.name ?? '旧草稿未记录身份版本'}；当前产品：{identityDraft.currentBase.name}。保留的输入为：{identityDraft.value}</p><Button disabled={!s.canWrite} onClick={identityDraft.acknowledge}>已比较身份，保留草稿继续</Button><Button disabled={!s.canWrite} onClick={identityDraft.discard}>放弃身份草稿，使用当前身份</Button></div>}
        <Button tone="primary" disabled={!s.canWrite || identityDraft.needsReview || !identityValue.trim() || (!!s.project?.identity && (!s.reasonValid || identityValue.trim() === s.project.identity.productName))} onClick={() => {
          if (identityDraft.needsReview) return
          void s.write(s.project?.identity ? 'identity/correct' : 'identity/confirm', { productName: identityValue, ...(s.project?.identity ? { reason: s.reason } : {}) }, '产品身份已保存。', () => identityDraft.discard())
        }}>{s.project?.identity ? '保存身份纠正' : '确认产品身份'}</Button>
      </div></details>
    </div>
  </details>
}
