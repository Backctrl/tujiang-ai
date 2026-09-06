import { CheckCircle2, Circle, Info, RefreshCw } from 'lucide-react'
import type { ProjectSession } from './useProjectSession'
import type { ProjectContextController } from './useProjectContext'
import { briefFields, targetFields, ruleKey, type ContextForm } from './project-context'
import { Button, Chip, PanelTitle } from './WorkbenchUI'

type Props = { context: ProjectContextController; session: ProjectSession }
function TextField({ context: c, field, label, maxLength = 200, placeholder, wide = false, multiline = false }: {
  context: ProjectContextController; field: keyof ContextForm; label: string; maxLength?: number; placeholder?: string; wide?: boolean; multiline?: boolean
}) {
  const props = { value: c.form[field], disabled: !c.canEdit, maxLength, placeholder,
    onChange: (event: { target: { value: string } }) => c.setField(field, field === 'country' || field === 'currency' ? event.target.value.toUpperCase() : event.target.value) }
  return <label className={wide ? 'wide' : undefined}>{label}{multiline ? <textarea {...props} rows={3} /> : <input {...props} />}</label>
}

export function ContextControls({ context: c, session: s }: Props) {
  return <>
    {!s.project ? <p className="integration-note wide">打开项目后开始填写制作配置。</p> : !s.project.production ? <div className="wide inspector-block"><p>开启制作配置后，可保存产品、目标市场与图片尺寸。已有文字资料与事实审核继续保留。</p><Button tone="violet" disabled={!s.canWrite} onClick={c.initialize}>开始填写制作配置</Button></div> : !c.initialized ? <p className="integration-note wide" role="alert">当前制作配置版本与客户端不兼容，请更新后再编辑。</p> : c.compatibilityBlocked ? <p className="integration-note wide" role="status">当前页面暂不能编辑此类目标。已保存的配置和历史版本可继续查看。</p> : <p className="integration-note wide">{c.activeVersion ? `${c.activeVersion.label} 已启用，版本内容已固定。` : '尚未启用制作配置。'}{c.readOnly ? ' 修改前先复制为本地草稿，再保存并启用新版本。' : ' 可以先保存未完成的草稿；启用前需要补齐全部信息与核验规则。'}</p>}
    {!!c.state?.versions.length && <>
      <label>复制已有配置<select value={String(c.selectedCopyVersion?.version ?? '')} disabled={!s.canWrite || c.compatibilityBlocked} onChange={e => c.setCopyVersion(e.target.value)}>{c.state.versions.map(version => <option key={version.version} value={version.version}>{version.label} · {version.context.productBrief.productName}{version.version === c.state?.activeVersion ? ' · 当前启用' : ''}{'schemaVersion' in version.rulePack ? ' · 当前页面暂不支持复制' : ''}</option>)}</select></label>
      <Button disabled={!c.canCopyVersion(c.selectedCopyVersion)} onClick={() => c.selectedCopyVersion && c.requestCopy(c.selectedCopyVersion)}>复制 {c.selectedCopyVersion?.label} 为本地草稿</Button>
    </>}
    {c.pendingCopy && <div className="wide inspector-block" role="alert"><b>替换正在编辑的配置</b><p>将用 {c.pendingCopy.label} 替换当前本地输入；服务端草稿只在下一次明确保存时替换。</p><Button disabled={!s.canWrite || c.compatibilityBlocked} onClick={c.confirmCopy}>放弃本地输入并复制</Button><Button onClick={c.cancelCopy}>保留当前输入</Button></div>}
    {c.local.needsReview && <div className="wide inspector-block" role="alert"><b>制作配置草稿需要复核</b>{c.changes.map((change, index) => <p key={index}>{change}</p>)}<p>下方仍是你的本地输入。比较后可保留继续编辑，或放弃本地输入并使用当前服务端配置。</p><Button disabled={!s.canWrite} onClick={c.local.acknowledge}>已比较配置，保留本地草稿</Button><Button disabled={!s.canWrite} onClick={c.discard}>放弃本地草稿，读取当前配置</Button></div>}
    {c.local.active && !c.local.needsReview && <p className="integration-note wide">本地修改尚未保存。<Button disabled={!s.canWrite} onClick={c.discard}>放弃本地修改</Button></p>}
  </>
}

export function ProductBriefFields({ context }: { context: ProjectContextController }) {
  return <><TextField context={context} field="productName" label="产品名称" /><TextField context={context} field="internalCode" label="内部代号" />
    <TextField context={context} field="category" label="产品品类" /><TextField context={context} field="stage" label="产品阶段" placeholder="例如：研发、上市前、在售" />
    <TextField context={context} field="introduction" label="产品介绍" maxLength={10000} wide multiline />
    <TextField context={context} field="commercialIntent" label="商业目标" maxLength={2000} wide multiline placeholder="说明本次页面需要完成的销售或沟通目标" /></>
}

export function TargetFields({ context: c, session: s }: Props) {
  const ref = c.compiled.context.rulePackRef
  const selected = ruleKey(ref)
  const currentAvailable = s.catalog?.some(rule => ruleKey(rule) === selected)
  const rule = c.rule
  return <><div className="form-grid"><TextField context={c} field="platform" label="首发平台" /><TextField context={c} field="site" label="站点" />
    <TextField context={c} field="country" label="国家 / 地区代码" maxLength={2} placeholder="例如 CN" />
    <label className="wide">已核验的平台规则<select value={selected} disabled={!c.canEdit || s.catalogLoading || s.catalog === null} onChange={e => {
      const rule = s.catalog?.find(item => ruleKey(item) === e.target.value)
      c.setRule(rule?.id ?? '', rule?.version ?? '')
    }}><option value="">选择规则版本</option>{selected && !currentAvailable && <option value={selected}>{ref?.id} · {ref?.version}（当前目录中不可用）</option>}{s.catalog?.map(rule => <option key={ruleKey(rule)} value={ruleKey(rule)}>{rule.target.platform} / {rule.target.site} · {rule.id} · {rule.version}</option>)}</select></label></div>
    <Button disabled={!s.project || !s.token.trim() || s.authExpired || s.catalogLoading} onClick={s.reloadCatalog}><RefreshCw size={14} />{s.catalogLoading ? '正在读取规则' : '重新读取平台规则'}</Button>
    {s.catalogError && <p role="alert" className="hint">{s.catalogError}</p>}
    {s.catalog?.length === 0 && !c.compatibilityBlocked && <p className="hint">暂无已核验的平台规则。可先保存草稿，补齐规则后再启用。</p>}
    {rule && <div className="inspector-block"><b>{c.readOnly ? '当前版本冻结的规则' : '所选规则'}</b><p>{rule.target.platform} / {rule.target.site} / {rule.target.country} / {rule.target.language} / {rule.target.currency} / {rule.target.unitSystem === 'metric' ? '公制' : '英制'}</p>
      {'schemaVersion' in rule ? <><p>内容类型：{rule.target.contentType}</p><p>管理员核验记录：{rule.publication.recordId} · {rule.publication.actor} · {new Date(rule.publication.at).toLocaleDateString('zh-CN')}</p>{rule.sources.map(source => <p key={source.id}><a className="source-link" href={source.url.startsWith('https://') ? source.url : undefined} target="_blank" rel="noreferrer">{source.title}</a> · {source.locator}<br />核验人：{source.verifiedBy} · {new Date(source.verifiedAt).toLocaleDateString('zh-CN')}</p>)}</> : <><p>核验人：{rule.verifiedBy} · {new Date(rule.verifiedAt).toLocaleDateString('zh-CN')}</p><a className="source-link" href={rule.officialUrl.startsWith('https://') ? rule.officialUrl : undefined} target="_blank" rel="noreferrer">查看规则来源</a></>}
      <Button disabled={!c.canEdit} onClick={c.applyRuleTarget}>按规则填写目标市场</Button></div>}
  </>
}

export function LocaleFields({ context: c }: { context: ProjectContextController }) {
  return <div className="form-grid"><TextField context={c} field="language" label="目标语言" placeholder="例如 zh-CN" /><TextField context={c} field="currency" label="货币" maxLength={3} placeholder="例如 CNY" /><label className="wide">计量单位<select value={c.form.unitSystem} disabled={!c.canEdit} onChange={e => c.setField('unitSystem', e.target.value)}><option value="">选择单位体系</option><option value="metric">公制</option><option value="imperial">英制</option></select></label></div>
}

export function CanvasFields({ context: c }: { context: ProjectContextController }) {
  const rule = c.rule
  const legacy = rule && !('schemaVersion' in rule) ? rule : undefined
  const policy = rule && 'schemaVersion' in rule ? rule.localProductionPolicy : undefined
  const bounds = policy?.canvasWidthPx
  const widthDescription = bounds?.exact !== undefined ? `${bounds.exact} px` : [bounds?.min !== undefined ? `至少 ${bounds.min} px` : '', bounds?.max !== undefined ? `至多 ${bounds.max} px` : ''].filter(Boolean).join('，')
  return <><div className="form-grid"><label>图片宽度（px）<input inputMode="numeric" value={c.form.widthPx} disabled={!c.canEdit} maxLength={5} list="context-allowed-widths" onChange={e => c.setField('widthPx', e.target.value)} placeholder="填写整数像素" /><datalist id="context-allowed-widths">{legacy?.allowedWidthsPx.map(width => <option key={width} value={width} />)}</datalist></label><label>图片格式<select value={c.form.format} disabled={!c.canEdit} onChange={e => c.setField('format', e.target.value)}><option value="">选择格式</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label></div>{policy ? <p className="hint">本地画布策略：{widthDescription}；{policy.canvasFormats.map(format => format.toUpperCase()).join('、')}。<br />本地交付格式：{policy.exportFormats.map(format => format.toUpperCase()).join('、')}。平台图片槽的尺寸与上传格式需另行检查。</p> : legacy ? <p className="hint">规则允许：{legacy.allowedWidthsPx.join('、')} px；{legacy.allowedFormats.map(format => format.toUpperCase()).join('、')}。</p> : !c.compatibilityBlocked && <p className="hint">选择核验规则后可查看允许的宽度与格式。未选择规则时仍可保存草稿。</p>}</>
}

export function ContextReadiness({ context: c, session: s }: Props) {
  const checks: [string, boolean][] = [
    ['产品基础信息', briefFields.every(key => !!c.compiled.context.productBrief?.[key])],
    ['目标市场', targetFields.every(key => !!c.compiled.context.primaryTarget?.[key])],
    ['图片尺寸与格式', !!c.compiled.context.canvasProfile?.widthPx && !!c.compiled.context.canvasProfile.format],
    ['平台规则', !!c.rule], ['事实提取身份', !!s.project?.identity],
    [`文字证据 · ${s.project?.evidence.length ?? 0} 份`, !!s.project?.evidence.length],
  ]
  const nextVersion = (c.state?.versions.at(-1)?.version ?? 0) + 1
  const issues = c.issues.filter((issue, index, all) => all.findIndex(item => item.field === issue.field) === index)
  return <><PanelTitle eyebrow="LAUNCH CHECK" title="准备状态" action={<Chip tone={c.activeVersion ? 'green' : 'muted'}>{c.activeVersion?.label ?? '未启用'}</Chip>} />
    <p className="check-lead">{!s.project ? '请先打开项目' : !c.initialized ? '制作配置尚未开启' : c.local.active ? '本地修改待保存' : c.serverDraft ? '配置草稿已保存' : c.activeVersion ? `${c.activeVersion.label} 已启用 · 只读` : '请填写制作配置'}</p>
    {checks.map(([label, ready]) => <div className="check-row" key={label}>{ready ? <CheckCircle2 size={14} /> : <Circle size={14} />}<span>{label} · {ready ? '已有数据' : '未就绪'}</span></div>)}
    {c.initialized && !c.readOnly && !c.compatibilityBlocked && <div className="check-result"><b>启用前待处理</b>{issues.length ? issues.map(issue => <span key={issue.field}>{issue.message}</span>) : <span>字段完整，目标与当前规则匹配。</span>}{c.local.active && <span>还有本地修改，请先保存草稿。</span>}{c.local.needsReview && <span>服务端配置已变化，请先复核差异。</span>}</div>}
    {c.readOnly && !c.compatibilityBlocked && <div className="check-result"><b>配置内容已固定</b><span>修改前从已有版本复制为本地草稿。</span><span>再次保存并启用会生成 P{nextVersion}，当前版本保持不变。</span></div>}
    <Button tone="violet" className="full" disabled={!c.canSave} onClick={c.save}>保存配置草稿</Button>
    <Button tone="primary" className="full" disabled={!c.canActivate} onClick={c.activate}>启用 P{nextVersion}</Button>
    <p className="setup-tip"><Info size={15} />启用会固定本次制作配置和平台规则。事实仍需在产品事实中逐条审核。</p>
  </>
}
