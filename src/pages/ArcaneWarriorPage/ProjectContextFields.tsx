import { Info, RefreshCw } from 'lucide-react'
import type { StoredRulePack } from '../../../backend/src/production-context'
import type { ProjectSession } from './useProjectSession'
import type { ProjectContextController } from './useProjectContext'
import { type ContextForm } from './project-context'
import { constraintLabel, describeBounds, isScopedRule, modelLabel, ruleKey, ruleModel, scopeLabel, type RuleModel } from './rule-catalog'
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
    {!s.project?.production ? <p className="integration-note wide">先填写配置并选择原件，输入保留在本地。首次上传或点击下方创建按钮时，保存到同一个服务端项目。</p> : !c.initialized ? <p className="integration-note wide" role="alert">当前制作配置版本与客户端不兼容，请更新后再编辑。</p> : <p className="integration-note wide">{c.activeVersion ? `${c.activeVersion.label} 已启用，版本内容已固定。` : '尚未启用制作配置。'}{c.readOnly ? ' 修改前先复制为本地草稿，再保存并启用新版本。' : ' 可以先保存未完成的草稿；创建并提取前需要补齐信息与核验规则。'}</p>}
    {!!c.state?.versions.length && <>
      <label>复制已有配置<select value={String(c.selectedCopyVersion?.version ?? '')} disabled={!s.canWrite} onChange={e => c.setCopyVersion(e.target.value)}>{c.state.versions.map(version => <option key={version.version} value={version.version}>{version.label} · {version.context.productBrief.productName}{version.version === c.state?.activeVersion ? ' · 当前启用' : ''} · {modelLabel(ruleModel(version.rulePack))}</option>)}</select></label>
      <Button disabled={!c.canCopyVersion(c.selectedCopyVersion)} onClick={() => c.selectedCopyVersion && c.requestCopy(c.selectedCopyVersion)}>复制 {c.selectedCopyVersion?.label} 为本地草稿</Button>
    </>}
    {c.pendingCopy && <div className="wide inspector-block" role="alert"><b>{c.pendingCopy.kind === 'model' ? '切换规则类型前比较配置' : '替换正在编辑的配置'}</b><p>将载入 {c.pendingCopy.label}。当前输入按规则类型保留在本项目的本地备份中；服务端配置在明确保存前保持原样。</p>
      {c.pendingCopy.changes.length ? c.pendingCopy.changes.map((change, index) => <p key={index}>{change}</p>) : <p>字段内容相同。</p>}
      <Button disabled={!(s.canEditSetup ?? s.canWrite)} onClick={c.confirmCopy}>确认差异并载入</Button><Button onClick={c.cancelCopy}>保留当前输入</Button></div>}
    {(c.migrationRequired || c.unsupported.length > 0) && <div className="wide inspector-block" role="alert"><b>旧版本地草稿需要转换</b><p>原输入完整保留。新增字段只取自这份草稿记录的原配置依据，不从当前服务端版本补入。</p>
      <details><summary>查看保留的旧草稿</summary><pre className="context-raw-draft">{c.migrationRaw}</pre></details>
      {c.unsupported.length ? <p>有当前表单无法表示的字段：{c.unsupported.join('、')}。请先保留原输入，再选择放弃旧草稿或使用已有版本。</p> : <Button disabled={!s.canWrite} onClick={c.migrateLocal}>已检查原输入，转换为当前表单</Button>}
      <Button disabled={!s.canWrite} onClick={c.discard}>放弃本地草稿，读取当前配置</Button></div>}
    {c.local.needsReview && !c.migrationRequired && !c.unsupported.length && <div className="wide inspector-block" role="alert"><b>制作配置草稿需要复核</b>{c.changes.map((change, index) => <p key={index}>{change}</p>)}<p>下方仍是你的本地输入。比较后可保留继续编辑，或放弃本地输入并使用当前服务端配置。</p><Button disabled={!s.canWrite} onClick={c.local.acknowledge}>已比较配置，保留本地草稿</Button><Button disabled={!s.canWrite} onClick={c.discard}>放弃本地草稿，读取当前配置</Button></div>}
    {c.local.active && !c.local.needsReview && <p className="integration-note wide">本地修改尚未保存。<Button disabled={!s.canWrite} onClick={c.discard}>放弃本地修改</Button></p>}
  </>
}

export function ProductBriefFields({ context }: { context: ProjectContextController }) {
  return <><TextField context={context} field="productName" label="产品名称" /><TextField context={context} field="internalCode" label="内部代号（选填）" />
    <TextField context={context} field="category" label="产品品类" /><TextField context={context} field="stage" label="产品阶段" placeholder="例如：研发、上市前、在售" />
    <TextField context={context} field="introduction" label="产品介绍" maxLength={10000} wide multiline />
    <TextField context={context} field="commercialIntent" label="商业目标（选填）" maxLength={2000} wide multiline placeholder="说明本次页面需要完成的销售或沟通目标" /></>
}

function RuleDetails({ rule, title, category }: { rule: StoredRulePack; title: string; category: string }) {
  return <div className="inspector-block"><b>{title}</b><p>{rule.target.platform} / {rule.target.site} / {rule.target.country} / {rule.target.language} / {rule.target.currency} / {rule.target.unitSystem === 'metric' ? '公制' : '英制'}</p>
    {isScopedRule(rule) ? <><p>{rule.name} · {rule.version}<br />内容类型：{rule.target.contentType}</p><p>{rule.description}</p>
      <p>管理员核验记录引用：{rule.publication.recordId} · {rule.publication.actor} · {new Date(rule.publication.at).toLocaleDateString('zh-CN')}</p>
      <details><summary>平台上传与内容规则 · {rule.constraints.length} 项</summary><p className="integration-note">各项要求只适用于标出的内容、模块、图片槽或文字字段。画布与本地交付格式在页面尺寸中单独选择。</p>
        {rule.constraints.map(item => <div className="context-rule-item" key={item.ruleId}><b>{item.name}</b><p>{scopeLabel(item.scope)}{item.scope.contentType !== rule.target.contentType || (item.scope.category && item.scope.category !== category) ? ' · 不适用于当前目标或品类' : rule.activationRequirements.includes(item.ruleId) ? ' · 启用前必须核验' : ' · 具体内容制作时检查'}</p><p>{constraintLabel(item)}</p>
          {item.status === 'unknown' ? <p>恢复方式：{item.recovery}</p> : <p>依据：{item.sourceIds.map(id => rule.sources.find(source => source.id === id)?.title ?? id).join('、')}</p>}</div>)}
      </details><details><summary>查看核验来源 · {rule.sources.length} 项</summary>{rule.sources.map(source => <p key={source.id}><a className="source-link" href={source.url.startsWith('https://') ? source.url : undefined} target="_blank" rel="noreferrer">{source.title}</a> · {source.kind === 'official_example' ? '官方示例' : '官方要求'} · {source.locator}<br />核验人：{source.verifiedBy} · {new Date(source.verifiedAt).toLocaleDateString('zh-CN')}</p>)}</details>
    </> : <><p>旧版规则保留精确宽度与格式列表。</p><p>核验人：{rule.verifiedBy} · {new Date(rule.verifiedAt).toLocaleDateString('zh-CN')}</p><a className="source-link" href={rule.officialUrl.startsWith('https://') ? rule.officialUrl : undefined} target="_blank" rel="noreferrer">查看规则来源</a></>}
  </div>
}

function targetMatches(form: ContextForm, rule: StoredRulePack) {
  return Object.entries(rule.target).every(([field, value]) => form[field as keyof ContextForm] === value)
}

export function TargetFields({ context: c, session: s }: Props) {
  const ref = c.compiled.context.rulePackRef
  const available = c.rules?.filter(rule => ruleModel(rule) === c.model) ?? []
  const scoped = c.model === 'scoped-rules.1'
  const platforms = [...new Set(available.map(rule => rule.target.platform))]
  const sites = [...new Set(available.filter(rule => rule.target.platform === c.form.platform).map(rule => rule.target.site))]
  const contentTypes = [...new Set(available.filter(isScopedRule).filter(rule => rule.target.platform === c.form.platform && rule.target.site === c.form.site).map(rule => rule.target.contentType))]
  const matching = available.filter(rule => (!c.form.platform || rule.target.platform === c.form.platform) && (!c.form.site || rule.target.site === c.form.site) && (!scoped || !c.form.contentType || (isScopedRule(rule) && rule.target.contentType === c.form.contentType)))
  const selected = matching.some(rule => ruleKey(rule) === ruleKey(ref) && targetMatches(c.form, rule)) ? ruleKey(ref) : ''
  const choose = (field: 'platform' | 'site' | 'contentType', label: string, options: string[]) => <label>{label}<select value={options.includes(c.form[field]) ? c.form[field] : ''} disabled={!c.canEdit || s.catalogLoading || !options.length} onChange={e => c.setField(field, e.target.value)}><option value="">请选择{label}</option>{options.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
  return <><div className="form-grid"><label className="wide">规则类型<select value={c.model} disabled={!c.canEdit} onChange={e => c.requestModel(e.target.value as RuleModel)}><option value="scoped-rules.1">按范围核验的目标规则</option><option value="legacy-canvas.1">旧版画布规则</option></select></label>
    {choose('platform', '首发平台', platforms)}{choose('site', '站点', sites)}{scoped && choose('contentType', '内容类型', contentTypes)}
    <label className="wide">已配置的平台规则<select value={selected} disabled={!c.canEdit || s.catalogLoading || c.rules === null} onChange={e => {
      const rule = matching.find(item => ruleKey(item) === e.target.value); c.setRule(rule?.id ?? '', rule?.version ?? '')
    }}><option value="">选择规则并带入目标与本地化配置</option>{matching.map(rule => <option key={ruleKey(rule)} value={ruleKey(rule)}>{isScopedRule(rule) ? rule.name : rule.id} · {rule.version} · {rule.target.country} / {rule.target.language} / {rule.target.currency} / {rule.target.unitSystem === 'metric' ? '公制' : '英制'}</option>)}</select></label></div>
    <p className="hint">选择规则后带入该目标的语言、货币和计量单位。平台、站点或内容类型变化后需要重新选择规则。</p>
    <Button disabled={!s.token.trim() || s.authExpired || s.catalogLoading} onClick={s.reloadCatalog}><RefreshCw size={14} />{s.catalogLoading ? '正在读取规则' : '重新读取平台规则'}</Button>
    {s.catalogError && <p role="alert" className="hint">{s.catalogError}</p>}
    {c.rules !== null && !available.length && <p className="hint">暂无此类已配置规则。可先保存草稿，补齐已核验规则后再启用。</p>}
    <details className="inspector-block" open={!!c.form.platform && !platforms.includes(c.form.platform)}><summary>未配置目标与原输入（仅作草稿）</summary><p className="integration-note">这里保留目录以外的目标和旧输入，不代表平台已支持。启用前必须明确选择相容的已核验组合。</p><div className="form-grid"><TextField context={c} field="platform" label="首发平台" /><TextField context={c} field="site" label="站点" />{scoped && <TextField context={c} field="contentType" label="内容类型" />}</div>{ref && !selected && <p>保留的规则引用：{ref.id} · {ref.version}，不在当前可选组合中。</p>}</details>
    {c.rule && <><RuleDetails rule={c.rule} title={c.readOnly ? '当前版本冻结的规则' : '所选规则'} category={c.form.category} /><Button disabled={!c.canEdit} onClick={c.applyRuleTarget}>按规则重新填写目标与本地化</Button></>}
    {c.frozenReference && <><p role="status" className="hint">当前目录缺少此版本。下面仅供核对历史冻结规则，不能据此启用草稿。</p><RuleDetails rule={c.frozenReference} title="历史冻结规则参考" category={c.form.category} /></>}
  </>
}

export function LocaleFields({ context: c }: { context: ProjectContextController }) {
  const current = c.localeRules.find(rule => ruleKey(rule) === ruleKey(c.compiled.context.rulePackRef) && targetMatches(c.form, rule))
  const fields = [['country', '国家 / 地区'], ['language', '目标语言'], ['currency', '货币'], ['unitSystem', '计量单位']] as const
  const value = (field: typeof fields[number][0], text: string) => field === 'unitSystem' ? text === 'metric' ? '公制' : text === 'imperial' ? '英制' : text : text
  return <><div className="form-grid context-supported-locale"><label className="wide">已支持的本地化与规则组合<select aria-label="已支持的本地化与规则组合" value={current ? ruleKey(current) : ''} disabled={!c.canEdit || !c.localeRules.length} onChange={e => {
      const rule = c.localeRules.find(item => ruleKey(item) === e.target.value); if (rule) c.setLocaleRule(rule.id, rule.version)
    }}><option value="">选择当前平台、站点与内容类型的完整组合</option>{c.localeRules.map(rule => <option key={ruleKey(rule)} value={ruleKey(rule)}>{rule.target.country} / {rule.target.language} / {rule.target.currency} / {value('unitSystem', rule.target.unitSystem)} · {isScopedRule(rule) ? rule.name : rule.id} · {rule.version}</option>)}</select></label>
    {fields.map(([field, label]) => <label key={field}>{label}<input readOnly value={current ? value(field, current.target[field]) : ''} placeholder="选择已支持组合后显示" /></label>)}</div>
    <p className="hint">选择一个完整组合会同时更新国家、语言、货币、计量单位与精确规则版本。</p>
    {!c.localeRules.length && <p className="hint">当前平台、站点与内容类型没有可选的本地化组合；现有输入和历史规则仍保留。</p>}
    {!current && c.readOnly && c.rule && <div className="inspector-block"><b>历史版本本地化 · 仅供查看</b><p>{fields.map(([field, label]) => `${label}：${value(field, c.form[field]) || '未填写'}`).join(' · ')}</p><p>当前目录未提供此完整组合，下面保留原值。</p></div>}
    <details className="inspector-block context-locale-draft" open={!current && fields.some(([field]) => !!c.form[field])}><summary>未配置本地化与原输入（仅作草稿）</summary><p className="integration-note">这里的自由输入用于保留未配置目标和旧草稿，不会加入上方已支持的组合。修改后需重新选择已核验组合才能启用。</p><div className="form-grid"><TextField context={c} field="country" label="国家 / 地区代码" maxLength={2} /><TextField context={c} field="language" label="目标语言" /><TextField context={c} field="currency" label="货币" maxLength={3} /><TextField context={c} field="unitSystem" label="计量单位" placeholder="metric 或 imperial" /></div></details>
  </>
}

export function CanvasFields({ context: c }: { context: ProjectContextController }) {
  const rule = c.rule ?? (c.readOnly ? undefined : c.frozenReference)
  const legacy = rule && !isScopedRule(rule) ? rule : undefined
  const policy = rule && isScopedRule(rule) ? rule.localProductionPolicy : undefined
  const bounds = policy?.canvasWidthPx
  return <><div className="form-grid"><label>本地画布宽度（px）<input inputMode="numeric" value={c.form.widthPx} disabled={!c.canEdit} maxLength={5} list={legacy ? 'context-allowed-widths' : undefined} onChange={e => c.setField('widthPx', e.target.value)} placeholder={bounds ? describeBounds(bounds) : '填写整数像素'} />{legacy && <datalist id="context-allowed-widths">{legacy.allowedWidthsPx.map(width => <option key={width} value={width} />)}</datalist>}</label>
    <label>本地画布格式<select value={c.form.format} disabled={!c.canEdit} onChange={e => c.setField('format', e.target.value)}><option value="">选择格式</option><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label>
    {c.model === 'scoped-rules.1' && <label className="wide">画布选择依据<select value={c.form.selectionBasis} disabled={!c.canEdit} onChange={e => c.setField('selectionBasis', e.target.value)}><option value="">请选择</option><option value="local_production_policy">本地制作策略</option></select></label>}</div>
    {policy ? <div className="inspector-block"><b>{c.frozenReference && !c.rule ? '历史本地制作策略参考' : '本地制作策略'}</b><p>{policy.description}</p><p>画布宽度：{describeBounds(policy.canvasWidthPx)}<br />画布格式：{policy.canvasFormats.map(format => format.toUpperCase()).join('、')}</p><p>本地交付格式：{policy.exportFormats.map(format => format.toUpperCase()).join('、')}{policy.maxExportImageBytes ? <><br />本地交付单图体积上限：{policy.maxExportImageBytes.toLocaleString()} 字节</> : null}</p><p>平台图片槽的尺寸与上传格式在平台与站点中按具体范围查看；这些本地交付选项不代表平台上传支持。</p></div>
      : legacy ? <p className="hint">旧版规则允许的精确宽度：{legacy.allowedWidthsPx.join('、')} px；格式：{legacy.allowedFormats.map(format => format.toUpperCase()).join('、')}。</p>
        : <p className="hint">选择核验规则后查看本地画布策略。未选择规则时仍可保存草稿。</p>}
  </>
}

export function ContextReadiness({ context: c }: Props) {
  const nextVersion = (c.state?.versions.at(-1)?.version ?? 0) + 1
  const issues = c.issues.filter((issue, index, all) => all.findIndex(item => item.field === issue.field && item.message === issue.message) === index)
  return <><PanelTitle eyebrow="CONTEXT REVIEW" title="配置草稿检查" action={<Chip tone={c.activeVersion ? 'green' : 'muted'}>{c.activeVersion?.label ?? '未启用'}</Chip>} />
    <p className="check-lead">{!c.initialized ? '制作配置尚未开启' : c.local.active ? '本地修改待保存' : c.serverDraft ? '配置草稿已保存' : c.activeVersion ? `${c.activeVersion.label} 已启用 · 只读` : '请填写制作配置'}</p>
    {c.initialized && !c.readOnly && <div className="check-result"><b>保存 / 启用前待处理</b>{issues.length ? issues.map((issue, index) => <span key={index}>{issue.message}</span>) : <span>配置字段与当前规则匹配。启动仍需检查产品资料与事实提取条件。</span>}{c.local.active && <span>还有本地修改，请先保存草稿。</span>}{c.local.needsReview && <span>本地草稿需要复核。</span>}</div>}
    {c.readOnly && <div className="check-result"><b>配置内容已固定</b><span>修改前从已有版本复制为本地草稿。</span><span>再次保存并启用会生成 P{nextVersion}，当前版本保持不变。</span></div>}
    <div className="check-result"><b>资料用途说明</b><span>系统解析出的文字或图片仅为候选。每份资料的用途在产品事实中明确审核，产品介绍不作为事实证据。</span></div>
    <Button tone="violet" className="full" disabled={!c.canSave} onClick={c.save}>保存配置草稿</Button>
    <Button tone="primary" className="full" disabled={!c.canActivate} onClick={c.activate}>启用 P{nextVersion}</Button>
    <p className="setup-tip"><Info size={15} />启用固定制作配置和规则，图片槽、文字字段及事实仍需各自检查。</p>
  </>
}
