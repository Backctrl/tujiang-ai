# 六阶段前端契约审阅与接入验收清单

packet_id: `TUJIANG-FRONTEND-INTEGRATION-20260906-01`  
审阅者：独立只读子 Agent `/root/contract_review`；仅维护本报告。  
日期：2026-09-06。结论：原 PR 是六阶段交互原型，尚不能作为阶段 A 的真实事实、顺序、诊断草稿工作台验收。第 1–3 阶段可以接入现有 API 的受限子集；第 4–6 阶段的正式制作、市场适配、批准与交付没有后端支持。阶段 A 的成功预检始终不允许导出。

## 审阅基线与证据范围

- 隔离工作区：`F:/Project/tujiang-stage-a-integration`，读取时 HEAD 为 `a7ded87fbd4725a083893b3ef360840ed78bc5eb`。前端及后端文件当时是导入工作树中的未跟踪文件；该 HEAD 不是这些文件的已提交版本。下文 `Page` 指原 PR 导入版 `src/pages/ArcaneWarriorPage/ArcaneWarriorPage.tsx`（402 行）；实现 Agent 后续修复会移动行号，复验须按函数和控件名称重新定位。
- 产品依据：飞书文档 `EQzNdi9Szo7T1DxsIEMc2ku4nie`，固定 `revision_id=61`。第 6、7.2、11 节来自 `F:/Agent-Team-Control/tasks/TUJIANG-FLEX-A-20260905-01/input/contract-rev61-{facts,preliminary-story,state-version}.json`；第 5、7、8、9、10 节本轮通过 `lark-cli docs +fetch --revision-id 61 --scope section --as user` 只读核对，未使用最新版本代替 rev61。
- 实现依据：`backend/src/app.ts`、`backend/src/contracts.ts`、`backend/src/domain.ts`、`backend/STAGE_A_API_HANDOFF.md`。未运行模型、未调用付费 API、未修改业务实现。
- 本报告是原 PR 发现及修复验收要求，不代表接入修复已完成，也不替代浏览器独立 QA。必须在最终提交/工作树上重跑下列检查才能关闭问题。
- 协调任务已提供 `docs/contract-rev61-six-stages.json`（第 3–10 节，本轮复核 revision 为 61），可作为随工作树交付的完整六阶段依据。
- 本轮实现采用独立真实入口 `/arcane-warrior/stage-a`；原 `/arcane-warrior` 保留演示。已静态核对 `src/app.tsx:55` 的新路由及原 Page 207 的“模拟交互演示 / 进入阶段 A 真实联调”标识。以下原 PR 缺陷不能因此写为已修复；真实入口须单独通过验收，演示入口的保留行为须明确隔离，不承担真实数据或正式交付承诺。

## 六阶段覆盖、缺口与后端范围

| 阶段 | 原 PR 覆盖与位置 | rev61 预期及具体缺口 | 本轮可接后端 / 范围边界 | 可验收结果 |
| --- | --- | --- | --- | --- |
| 1 项目设置 | Page 248–274：连续表单、资料区、平台/语言/尺寸、右侧检查 | §5 要求 ProductBrief、首批资料、PrimaryTarget、CanvasProfile、草稿与创建解析；当前字段只用 defaultValue，创建按钮无动作，所有资料自动标为事实证据，5/5 与 RulePack 加载固定宣称 | `POST /api/projects` 仅 name；身份单独确认；`/evidence` 仅已明确用途的 product_evidence 文本、文档名和定位。无 PDF/DOCX 原生解析、分类待确认、ProductBrief/目标/规则/尺寸保存 | 空项目不显示已保存/已加载。真实创建返回 ID，刷新恢复相同项目。产品名称输入不自动确认身份。明确区分本地设置与服务器字段；不支持的文件/规则不能伪报解析成功 |
| 2 产品事实 | Page 283–322：三栏、摘录、单条确认；149–160 模拟资料解析 | §6 要求用途任务、冲突/核心/缺口队列、逐条确认/拒绝、修改创建候选、增量资料与失败恢复；当前缺证据也能确认，修订原地覆写锁定值，缺拒绝/撤回/纠错与真实引用；Agent 营销建议混入事实页 | 已有证据文本、候选提取 run、候选补充/纠错、confirm/reject/retract 与原文校验；无混合用途识别、多来源规范化字段、完整追问/对话、按文件子任务 | 每条事实显示真实 status、role、evidenceId 对应原文和定位；纠错保留旧值/旧证据；逐条记录 reason。冲突候选不能确认；拒绝不复活；撤回只使真实依赖 stale。失败显示错误码并由人重试 |
| 3 故事线 | Page 326–337：树、顺序、总览/编辑器；默认 V1 已批准 | §7.2 初步顺序必须无广告文案、未定稿；仅身份+部分核心事实已确认后规划。§7.1/7.3–7.6 的动态层级、模块/素材/FramePlan、正式 Facts/Storyboard 版本与审批尚未实现。原 PR 固定六章、固定素材/内容模块，无 factIds | plan-section 输出 `chapters[{role,purpose,factIds}]` + 单个 diagnostic_draft；支持人工顺序、候选显式应用、诊断稿人工编辑/历史选择。无父子层级、必须讲/不要讲字段、正式 SectionSpec/批准 | 展示“无文案·未定稿”，动态章数及真实事实引用/缺口。人工保存顺序后旧 Section stale；新模型结果先列候选，用户明确应用后才切换。不能出现“V1 已批准”或启用正式章节制作 |
| 4 章节制作 | Page 342–367：模拟手机画布、文字编辑、Patch、章节锁定 | §8 要求批准 SectionSpec→受控 HTML，内容/视觉编辑、撤销重做、事实证明绑定、Layout 差异提案、审核样稿。当前全章节共用一个 copy/draft/patchOpen；硬编码指标、比较和 F-001/F-005；锁定将 stale 直接转 current/approved | 仅诊断 Section 的 purpose/factIds/missingInputs 编辑，不是正式制作；无 Renderer/CustomLayoutSpec/正式锁定批准/HTML 样稿 API | 原型需明确标识演示；真实模式禁止把诊断稿映射为已批准设计。切换章节不能串文案。没有产物不得显示真实保存、证据已绑定或已生成审核文件 |
| 5 市场适配 | Page 372–381：三市场、语言预览、五类 Inspector | §9 要求已批准母版、按市场/平台/语言独立内容及 CanvasProfile、逐章确认后整套批准、锁定后仅差异提案。当前一个市场百分比代替逐章状态；固定母版批准、规则已加载；点击生成直接100%，再次生成覆盖批准状态 | 阶段 A 无市场版本、母版批准、RulePack、CanvasProfile 或适配 API；不能通过前端自造业务批准 | 显式未接入；不能写成“市场版本已批准”。未来按目标独立保存内容；A 市场尺寸/文案不影响 B 市场和母版；已批准版本修改产生下一版，全部章节满足门槛才可确认整套 |
| 6 QA 与导出 | Page 386–397：问题列表、预览、手动解决、批准/模拟导出 | §10 要求内容预检→导出预览→文件 QA→批准下载；blocker 不允许忽略，多市场只选已批准/current，实际文件与 Manifest。原 PR 可手动勾掉事实错误，仅任一市场 approved 就批准；没有真实文件 | 仅 `/qa/preflight` 检查当前诊断稿和事实依赖；响应 `notChecked=[market_rules, rendered_file, asset_quality, formal_approval]`、`exportAllowed=false`。无正式批准、文件生成或下载 API | UI 展示预检实际 issues、检查范围、未检查项及过期结果。即使 issues 清零也禁止正式批准/导出；“标记解决”不得修改服务端判断。未生成文件不得显示可下载 |

## 原 PR 问题与修复后复核项

| ID / 级别 | 页面 / 原位置 | 触发及影响 | 修复预期与验收标准 |
| --- | --- | --- | --- |
| F-01 / P1 | 全局 Page 92–113、203–208、236；设置 257–274 | 刷新即恢复 mock，仍显示已同步/已保存；用户输入和确认不持久化，创建按钮不工作 | 首次为空或显式演示；真实模式根据 API 响应更新保存状态。创建→填写→刷新→重开同项目，内容/状态可追溯。网络失败不得显示成功；本地草稿须明确标注 |
| F-02 / P1 | 事实 Page 134–146、313；domain.ts 16–27 | 缺证据 F-004 仅为 warning，按钮可确认；修订直接修改 confirmed/locked 值，固定 CH-03/04 stale | 确认必须由服务端校验 quote 与证据。修改走新 candidate + correctsFactId，不覆写旧事实；测试保留旧值、拒绝新候选、撤回旧值后确认新值三条路径，核对 audit 与历史快照 |
| F-03 / P1 | 故事线 Page 100–102、121–124、224–226、319–337 | 默认 storyApproved=true；两个 confirmed 不等于身份/核心事实门槛；存在 F-003 blocker 仍可规划/制作；初步顺序包含广告标题和成稿模块 | 未确认身份→服务端拒绝规划；仅 supporting 已确认→拒绝；冲突存在→拒绝；身份+无冲突 core 可生成初步顺序。生成后仍 draft，不能进入正式制作。purpose 人工复核不得混入广告内容 |
| F-04 / P1 | 章节 Page 141–146、173–176、342–367 | 锁定动作直接把 stale 标 current/approved；多章共享 copy，事实引用和比较数字固定 | 阶段 A 不提供正式锁定。诊断稿修复必须重新提交当前事实和目的、验证归属；历史 stale 不能重选放行；章 A 编辑不能改章 B。未有事实支持的比较/指标必须标为演示并隔离真实模式 |
| F-05 / P1 | QA Page 124、188–191、228、396–397 | 不修正事实即可标记 blocker 已解决；任一市场批准就放行；一旦 approved，导出不再校验新 blocker/freshness | 真实模式只能读取后端预检并重新检查；阶段 A 始终禁止正式批准/导出。测试预检成功→撤回引用事实→刷新/再检，应显示 stale/invalid evidence，旧成功结果不能继续当有效 |
| F-06 / P1 | 模型动作 Page 155–159、224–228 | 计时器或本地布尔量伪造解析/生成成功；没有失败/并发/重复提交恢复 | API run 返回的 queued/claimed/done 与 runStatus 分开呈现；轮询/SSE 更新；手动重试同 runId 新 attempt。409 必须刷新并保留用户草稿供复核，不自动覆盖/重试；幂等重复提交不得新增两份对象 |
| F-07 / P2 | 设置 Page 265–273；Source domain.ts 8–13 | 任意资料都称事实证据，无用途/格式失败状态；声称 RulePack 已加载但无规则来源 | 阶段 A 明确“人工提供证据文本”限制，文件格式不支持直接报明原因。不得编造原文件解析数量、规则版次或平台限制。后续用途工作流单独列为未实现 |
| F-08 / P2 | 故事线 Page 163–170、330–336 | 排序不持久化；添加/保存/建议按钮无动作；Section 没 factIds、缺口、候选/当前区分 | 支持现有平面 chapters 增删排序及人工保存；父子/Frame 需明确未支持。候选完成不改变 currentSectionId；显式应用更新当前顺序及关联 Section，历史保留 |
| F-09 / P2 | 市场 Page 227、378–381 | “确认本章”实际批准整市场；更新会原地覆盖 approved；目标文本 defaultValue 不随市场可靠隔离 | 真实模式禁用未实现批准；演示表明语义。后续按市场章节对象和版本实现，不用 progress=100 推断批准 |
| F-10 / P2 | 全局 Page 205、217；domain.ts 1–4、30–45 | R-013 假版本；导航经过即打完成勾；只声明四维类型，没有统一对象状态，story/market 缺 severity/run/freshness | 导航访问不等于阶段完成；服务器 version 是 stage-a.1 聚合兼容值，不能展示为独立 Facts/Storyboard/Market Version。四维状态分开；缺失字段不推导成功 |

## 字段、状态与操作映射

API 路径除创建项目外以下均简写为 `/api/projects/:id` 后缀。真实状态以完整 Project 快照为准，UI 不维护第二份业务批准事实。

| 前端对象/字段 | 真实后端字段 / 请求 | 处理方式与边界 |
| --- | --- | --- |
| 项目名称 | `Project.name`；创建 `{name}` | 项目名称与商品身份是不同对象；创建不表示确认产品 |
| 商品身份 | `identity.productName/confirmedBy/confirmedAt`、`identityRevision`；`/identity/confirm`、`/identity/correct` | 首次人工确认；后续 correction 需 reason，同商品文字纠正，不能用来换商品 |
| 产品品类/阶段/简介/平台/语言/尺寸 | 当前 createSchema 没有这些字段 | 可作为明确的本地配置草稿合成展示，不得发送额外字段或伪称服务器已固化 ProductBrief/Target/CanvasProfile |
| Source.name/meta | `Evidence.documentName/locator` | 文档名和定位来自用户/服务器，不从 mock 文件名拼接；Source.facts 从关联 facts 数量推导；没有原文件页数则不显示假页数 |
| Source.status | `AgentRun.queueStatus` + `runStatus` | 当前是项目级提取运行，无每文件独立解析状态；不能伪装八阶段文件进度 |
| Fact.claim | `Fact.attribute/value/role` | 展示可合成，但请求必须使用结构字段；role 为 core/supporting，不能以列表数量推断核心事实 |
| Fact.kind / confirmed | `Fact.status=candidate/confirmed/rejected/retracted` 与 `issueSeverity` | kind“确认”不能代替 confirmed；状态分别展示。conflict 是风险维度，不是第五种事实 status |
| Fact.evidence/source/excerpt | `evidenceId/quote/start/end` → `Evidence.text/locator` | 展示完整引用链；每 Fact 当前单 evidenceId。不得编造多来源数量或证据有效度 |
| Fact.confidence | 后端未提供 | 显示“未提供”或省略，不能保留 mock 百分比；事实是否可用不由置信度判断 |
| Fact.locked | 后端 locked、status、confirmedBy/At | 确认后锁定由响应驱动；reject 只适用于 candidate，retract 只适用于 confirmed |
| 事实补充/纠错 | `/facts/candidates` `{attribute,role,value,evidenceId,quote,correctsFactId?}` | quote 为证据连续原文；保存不等于确认；纠错关系也可触发冲突，不得静默替换 |
| StorySection[] | `storyboard.chapters[{role,purpose,factIds}]` | 每行是顺序章节；后端诊断 Section 是另一种对象，不可将两者一一伪映射为正式制作章节 |
| storyApproved | `Storyboard.approvalStatus` 固定 draft | 移除客户端批准映射；当前 API 没有正式批准入口 |
| 当前顺序 / 模型候选 | `storyboard` / `storyboardCandidates`；`/storyboard/draft`、`/storyboard/candidates/:candidateId/apply` | 人工保存和候选选择不同；已有当前稿时生成只追加候选；apply 原子选择顺序和 Section |
| 诊断草稿 | `sections[]`，`kind=diagnostic_draft`、purpose/factIds/missingInputs | `POST /sections/:sectionId/draft` 创建替代稿，保留 replacesSectionId；不得展示成可渲染 SectionSpec |
| 当前诊断稿 | `currentSectionId`；`/sections/:sectionId/select` | null 表示尚未选择，不默认使用数组最后一项；旧快照缺字段的兼容逻辑留服务端处理 |
| 审计/保存 | `audit[].actor/at/type/data`、revision | 使用服务端返回值；本地操作记录不冒充后端审计。历史读取 `/revisions/:revision` 只读，不直接覆写历史 |
| QaIssue[] | `qa.issues[]/issueSeverity/checkedVersion/checkedRevision/sectionId/notChecked/exportAllowed` | 页面可翻译错误码但保留原码；未检查项必须可见。checkedRevision 标识检查输入，不能用“qa 对象存在”判断仍有效 |
| Market / 正式 export | 无对应 API | 在真实模式显示待实现或明确演示，不生成假的 approved、download URL、Manifest |

| 状态维度 | 服务端值 | UI 应表达 | 不得替代为 |
| --- | --- | --- | --- |
| issueSeverity | none / warning / blocker | 业务问题与放行原因 | runStatus=failed |
| runStatus | idle / running / succeeded / failed | 技术执行结果 | approved 或 current |
| freshness | current / stale | 依赖是否仍有效 | 草稿被编辑就自动 current |
| approvalStatus | draft / in_review / approved；阶段 A 顺序仅 draft | 业务批准状态，以对象返回为准 | 已保存/生成成功 |
| queueStatus | queued / claimed / done | 队列/worker 生命周期 | 新业务状态枚举 |
| errorCode | 如 VERSION_CONFLICT、STALE_INPUT | 解释失败原因及人工恢复动作 | 以上状态枚举的新成员 |

所有写请求携带 expectedProjectVersion、expectedRevision、idempotencyKey；新增人工编辑/选择/事实审核携带 reason。公共 Schema 严格拒绝 actor、approved、locked 等自报字段。遇到 VERSION_CONFLICT/REVISION_CONFLICT/IDEMPOTENCY_CONFLICT 后展示冲突，先 GET 复核，不自动换版本覆盖。客户端仅持有必要连接信息，不在源码或报告中保存真实 Bearer。

## 项目设置 → 事实 → 顺序的合成展示规则

1. 项目设置表单可以包含产品语境、目标和尺寸，但需要区分服务器 Project/identity/evidence 与尚无 API 的本地配置草稿。UI 合成模型只用于显示，不能扩大服务端契约。
2. 人工提供证据文本并启动 extract-facts，候选事实列表只采用服务端完整快照。确认身份与逐条事实审核独立；拒绝、撤回、纠错均显示理由与结果，不自动批准。
3. plan-section 的输入只来自已确认且无冲突事实，不能直接采用 ProductBrief 或未确认的本地值。显示平面顺序章节、对应事实与单个诊断稿，明确当前版本尚不支持正式脚本/制作。
4. 保存人工顺序、编辑诊断稿、应用模型候选、选择历史稿分别对应不同命令。用户本地未保存输入在 API 冲突后保留，已保存业务状态仍以服务端为准。

## 接入后独立 QA 最小验收

下列项目在本只读审阅中均为“待接入后复验”，不能勾选通过。运行环境应使用本地合成模型/离线 fixture，真实 HTTP API 与数据库链路；不调用付费模型。

| 检查 | 操作与预期 | 必需证据 |
| --- | --- | --- |
| A1 创建及恢复 | 新建项目、身份确认、证据保存；刷新重开相同 ID，状态仍在 | 实际 projectId、请求/响应摘要、页面截图 |
| A2 真实候选 | extract-facts 经 worker 完成，列表与 API facts ID、quote 一致 | runId、attempt、queueStatus/runStatus、零外部生成请求证据 |
| A3 门槛反例 | 无身份、只有 supporting、存在冲突各尝试规划均拒绝；满足身份/core 才可规划 | 对应 HTTP 错误码及界面原因 |
| A4 逐条审核 | 确认/拒绝/撤回/纠错；旧事实/证据不丢失；拒绝候选后增量提取不复活 | 前后快照及审计；引用/未引用 Section 的 freshness 对照 |
| A5 无文案顺序 | 初步顺序只有角色、目的、事实、缺口；无广告标题/最终画面；不是 approved | API 输出及页面内容比对；purpose 人工复核记录 |
| A6 人工当前稿保护 | 保存顺序→旧诊断稿 stale→人工适配新稿；新模型完成不静默切当前；用户明确 apply 后切换 | storyboardId/currentSectionId 前后值及历史 |
| A7 并发及错误恢复 | 旧 revision 写入报409、UI保留草稿；相同幂等键同请求不重复；失败仅人工重试 | HTTP状态/错误码、对象数量、attempt 前后值 |
| A8 预检范围 | 合法当前稿可预检；null选中/stale/缺口分别阻断；成功仍 exportAllowed=false | qa.issues/notChecked/exportAllowed 与按钮状态 |
| A9 第4–6阶段边界 | 可导航查看清楚标识的未接入/演示内容；没有正式批准/交付成功宣称 | 各阶段截图及按钮点击结果 |
| A10 构建及交互 | 前端构建、类型检查；空列表/加载/断网不崩溃；按适配宽度无关键按钮遮挡 | 命令结果及浏览器独立验收记录 |

## 交付判定

在真实入口 `/arcane-warrior/stage-a` 证明 F-01 至 F-06 所列风险已消除、完成 A1–A10 并留下证据后，可以称为“阶段 A 的前三阶段受限能力已接入”。原演示入口可保留明确标注的模拟行为，但不能与真实入口共享伪造的批准或导出状态。仍不能称六阶段完整产品或正式交付系统；层级/模块/素材/Frame、正式业务版本、Renderer、市场规则和文件 QA 需要后续后端契约与实现。该边界来自现有 Stage A 交接及 rev61 差额，不能仅靠改按钮文案宣告完成。
