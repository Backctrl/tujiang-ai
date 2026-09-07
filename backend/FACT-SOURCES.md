# M3 多来源事实与适用范围（3A1）

本实现依据产品契约 revision 61 第 6 节和第 11 节，范围是单条事实的来源、规范化值、型号/条件、风险、人工审核与局部失效。缺口问答、unknown/n-a 业务决策和安全降级属于后续 3A1B；Facts F 基线冻结属于 3A2；本包不生成正式 Storyboard、不运行真实 AI。

## 兼容边界

根项目保持 stage-a.1；现有 Fact 的 value、evidenceId、quote、start/end 和状态字段继续可读。新建结构化事实增加 structured（fact-sources.2），其兼容字段由服务端根据规范化值和第一条来源生成，不接受两份互相矛盾的客户端正文。服务端在候选创建时保存候选语义摘要，在确认时另存包含风险复核和当前来源状态的确认摘要。

旧单来源事实在详情读取时得到一个只读来源视图，不回填或修改项目、历史修订、确认人/时间或幂等回执，也不声称旧 value 已通过新增的单位校验。普通 GET 和重复 migrate 不将旧对象自动升级或批准。fact-sources.2 上线前已经持久化、且没有服务端 legacy-fact-binding.1 摘要的旧 confirmed fact 从全局当前可用集合中排除；需要员工重新创建候选并确认，不能由读取或迁移静默放行。上线后通过旧入口确认或按原 2B2 规则重确认的单来源事实会取得 legacy binding；事实和 binding 都必须保留非空确认人及 ISO 时间，任一缺失或不一致都会从所有消费路径闭锁，读取和 preflight 不会静默修复历史。有效 legacy fact 可继续用于 stage-a.1 下游，但 `formalFreezeEligible` 始终为 false，并返回 `LEGACY_FACT_NOT_STRUCTURED`。现有旧模型提取 Schema 保持不变；本包通过结构化人工候选接口组合多个来源。

旧 confirm 和 source/reconfirm 命令只处理旧事实。新结构化事实的确认、替换和逐来源重确认使用新命令，避免旧 Inspector 只展示一条来源便确认完整的新语义。拒绝候选和显式撤回仍保留既有人工入口；不存在批量确认。每条新事实另有 `fact-lifecycle-binding.1`，绑定当前 status/locked、确认归属、来源撤回与重确认链、纠错和替换关系。缺少或不匹配该绑定的 active 记录不会进入任何消费路径，也不能确认；员工仍可通过单条 reject/retract 显式隔离旧记录，该动作只改变为非 active 状态并留下新生命周期绑定，不补签原确认或静默迁移。

## 最小接口

所有读取与写入沿用 Bearer 认证。写入必须带 expectedProjectVersion、expectedRevision、idempotencyKey；操作者和时间由服务端确定，所有写入返回完整 Project。

| 方法 / 路径 | 输入与结果 |
| --- | --- |
| GET /api/projects/:id/facts/:factId/details | 返回单条事实、全部来源定位与可用性、规范化依据、范围、风险、动态冲突、`integrityValid`、带稳定 reason code 的 `eligibility` 与当前可执行命令；不写状态；完整性失败时所有确认/重确认命令 fail-closed |
| POST /api/projects/:id/facts/structured/candidates | 写入信封 + attribute、role、normalizedValue、sources、applicability、risks、reason，可选 correctsFactId；risks 只作为调用方提案，产生一个未确认候选 |
| POST /api/projects/:id/facts/:factId/structured/confirm | 写入信封 + reason、acknowledgedRiskIds、独立 riskReview，可选 replaceFactId；单条明确确认或替换 |
| POST /api/projects/:id/facts/:factId/sources/:sourceId/reconfirm | 写入信封 + evidenceId、reason；只恢复用途循环后同原件/同块/同内容的来源绑定，不改值、范围或原确认记录 |
| 既有 /facts/:factId/reject 和 /retract | 保留单条拒绝与明确撤回行为，不隐式创建替代事实 |

资料用途更正继续走 2B2 的既有接口；待处理中心为每一条失效的结构化来源提供来源 ID 和重确认入口。现有旧任务字段保持兼容；多源任务不退回单来源恢复路径。

## 候选输入

```ts
type NormalizedValue =
  | { kind: 'text'; value: string }
  | { kind: 'decimal'; value: string; unit: string };

interface SourceInput {
  id: string; // 客户端生成 UUID，在同一事实内唯一
  evidenceId: string;
  quote: string;
  start: number;
  end: number;
  valueSpan: { start: number; end: number };
}

type ModelScope =
  | { kind: 'unspecified' }
  | { kind: 'all' }
  | { kind: 'specified'; models: {
      id: string;
      sourceId: string;
      start: number;
      end: number;
    }[] };

interface Applicability {
  models: ModelScope;
  conditions: { description: string; sourceIds: string[] }[];
}

interface FactRisk {
  id: string;
  kind: 'numeric_claim' | 'certification' | 'efficacy' | 'safety' | 'scope' | 'other';
  severity: 'warning' | 'blocker';
  description: string;
  sourceIds: string[];
}

interface RiskAssessment {
  kind: FactRisk['kind'];
  assessment: 'present' | 'not_found' | 'not_applicable';
  reason: string;
  reviewedRiskIds: string[];
}

interface RiskReviewInput {
  categories: RiskAssessment[]; // 六类各且仅一次
}
```

候选输入中的 risks 是待人工核验的提案，不是服务端安全结论。服务端为每个 decimal 候选另外派生一条不可由调用方删除或覆盖的 `numeric_claim` 风险，并分别保存 `proposedRisks` 与 `derivedRisks`。调用方伪造同名风险、提交空数组或完全省略 risks，都不能取消服务端派生风险。文字候选不会因此被宣称为“无风险”；它仍需完成下述固定类别复核。

服务端不会声称已自动识别 certification、efficacy、safety、scope 或 other 的语义风险。每个结构化候选都明确显示这些类别属于人工评估责任，自动语义风险识别状态为 `not_performed`。确认请求必须提交独立的结构化 `riskReview`，对 `numeric_claim`、`certification`、`efficacy`、`safety`、`scope`、`other` 六个固定类别各且仅各填写一次 assessment 与非空 reason。`assessment=present` 必须至少引用一条该类别当前风险；`not_found` 和 `not_applicable` 不得伪造风险引用。reviewer 与 reviewedAt 只取认证上下文和服务端时钟，不接受客户端提供。

`riskReview` 是与候选风险提案分开持久化的人工审核记录，不等于要求两名不同员工四眼复核。单操作者 MVP 允许同一名已认证员工创建候选并完成复核；其身份和时间仍完全由服务端记录。Worker/Agent 和任何未来模型输出只能产生 candidate，不能调用确认语义自行锁定或批准结果；confirm 输入严格拒绝 actor、reviewer、reviewedAt 等客户端身份或时间字段。

`acknowledgedRiskIds` 继续作为“已查看具体风险”的显式清单，但不能替代全类别 `riskReview`。缺少类别（包括 other）、重复类别、理由为空、漏掉服务端派生风险或 proposed other 风险、引用其他类别/其他候选的风险、试图伪造 reviewer/time，或 blocker 尚未解决时，整次确认原子失败。任何历史 JSONB 中缺少完整服务端记录风险复核的 structured fact，即使 status/locked 看似已确认，也不得进入当前可用事实集合。

sources 为 1–10 项。quote、valueSpan、型号范围的 start/end 均为 Evidence 原文的 UTF-16 偏移，end 不包含末位。quote 必须逐字匹配原文，valueSpan 和型号锚点必须位于该条 quote 内；服务端提取并保存原始值文本、原文单位和来源内容哈希。相同 evidenceId/start/end 不可重复；多个定位不代表多份独立原始资料。

每条来源必须是当前可用的 product_evidence：独立人工 Evidence 或用途已确认的资料派生 Evidence。待用途、参考、素材、撤回投影、哈希/定位不一致或另一项目的来源均拒绝整条候选；不会丢弃不合格来源后假装其余来源已全部核验。人工引用的语义支持关系仍须由员工查看原文确认。

## 规范化边界

文字规范化只允许 Unicode NFKC、首尾和重复空白处理，不做释义、翻译或事实改写；每条原始值应得到同一个规范化值。

数值使用有界十进制字符串和精确有理数运算，明确原始单位及目标单位；不使用浮点近似或未声明容差。只支持文档列出的有限单位与精确换算，不接受客户端声明“已核验”替代校验。目标值/单位必须与所有来源在允许换算下相等；量纲不一致、单位遗漏、数值裁切或单位矛盾均拒绝。例如原文 10 kg 不能规范化成 10 lb；原文数值片段故意漏掉相邻单位也不能绕过检查。完整数值边界先对数值前后有限上下文做 NFKC，再覆盖正负号、整数/小数/分数的前后数字、ASCII/全角/Unicode 分组或小数分隔符、范围/容差/比较符、货币与温度前后缀、Unicode 上标、Unicode 单位、复合单位连接符，以及 `10 (kg)`、`(10) kg`、`10）kg`、`10（千克）` 形式的括号单位。保存的 quote/valueSpan 仍严格使用原 Evidence 的 UTF-16 偏移和原文，不被归一化改写。当前未声明支持的分组、范围或复合单位整段不会被推断为安全单值；调用方可改用逐字文字候选。

首批单位限定质量 mg/g/kg/oz/lb、长度 mm/cm/m/in/ft、体积 mL/L、时间 ms/s/min/h，以及 V/A/mA/W/kW、百分数和无单位计数；同时接受文档所列量纲的常用中文单位别名。精确系数随 normalizationVersion 固定。超出支持范围的内容可保留为逐字文字候选，不获得数值换算已验证的标记；转换词义或处理测量四舍五入留给后续显式能力。

## 适用范围与冲突

冲突沿用 attribute 匹配；规范化值相异且范围可能重叠时形成 blocker。来源不再可用或事实已明确被替换时不参与当前可用事实集合，但原内容与历史仍可查看。下游、详情页和待处理中心每次都基于当前严格验证后的 applicability 与来源动态重算冲突；持久化的 `issueSeverity` 仅是显示缓存，不能单独放行 skill input、人工编辑、QA 或交付。

明确型号只接受有来源锚点的精确型号 ID；锚点在原文中的文本经约定的大小写/空白归一后须与 ID 一致。两边都有明确型号集合、且集合不相交时，才允许判定型号互斥。未指定、旧记录没有范围或任意一方为 all 时，都按可能重叠处理。系统不编造真实产品的 SKU，也不自动建立型号别名。

本叶子保存并展示来源明确的适用条件，但不同的自由文本条件不会自动证明互斥。例如“室内”和“办公室”不能因文字不同便消除冲突。温度区间、互斥条件词表等条件推理暂不扩展；本包可证明互斥的维度仅为精确、有来源的型号集合。这是保守兼容取舍，避免把缺失或未知条件默认成互斥。

## 锁定、修正与来源恢复

修改来源集合、规范化值、型号/条件或风险时，创建含完整新结构的候选，并用 correctsFactId 关联原事实。保存候选只增加内部 Revision，原已确认事实保持值、锁定状态、确认人/时间和来源历史。

确认新候选可以明确提供 replaceFactId（必须对应 correctsFactId）。替换只允许相同 attribute、role 和等价 applicability（型号 kind/规范化型号集合及条件文本均相同）的同一业务槽，不能用 broad→specified 或条件变化整体隐藏旧事实。事务在确认新事实的同时写入一条项目内唯一的 replacement transition；旧、新事实各保存且只保存一份逐字段一致的副本，并与旧事实的 superseded 字段、新事实的 correctsFactId、确认操作者和时间互相校验。旧事实必须继续保持 status=confirmed、locked=true 和原确认人/时间；任一单边、重复、断链、循环或任意 supersededByFactId 都会让关系双方及项目治理 fail-closed。有效关系才会从当前集合排除旧事实，并将引用旧事实的 Section/Storyboard 标记为 stale；其他重叠冲突仍阻断确认。若用户要并存两种型号，则不提供替换指令，并须通过范围互斥检查。

有 blocker 风险的候选不可确认；warning 风险需在单条确认卡中逐项声明已查看并给理由，同时仍须完成六个固定类别的风险复核。风险声明不能覆盖服务端计算的来源不可用、单位矛盾或冲突 blocker。客户端 risks 为空、遗漏或内容错误都不会删除服务端派生风险，也不会把语义风险人工责任变成“系统已检查”。

任一已绑定来源被用途撤回，结构化候选失效；已锁定事实保留并要求逐来源重确认，即使其他来源仍可用也不会自动删除被撤回的来源来放行。资料撤回只刷新原本有效的 lifecycle binding；缺少或不匹配绑定的历史 active 记录继续保持无效，不能借用途变更获得新绑定。每次恢复须指向同原件、同块、同内容的新 product_evidence 投影，验证所有原始定位、值和范围锚点，追加不可删改的来源恢复记录后才清除该来源的待处理项。重确认不会重写最初的 candidate binding、structured confirmation 或 legacy binding；这些 proof 对同内容的等价 projection ID 稳定，当前 projection 与完整恢复链由 lifecycle binding 另行绑定。其他失效来源或项目内任一无效 active 事实仍阻断恢复，原确认人/时间和锁定值始终保留。待处理中心只过滤经完整验证的 superseded 历史事实；任一无效 active 候选都保留为 `INVALID_FACT_BINDING` blocked 任务，受影响的来源恢复任务也以该原因阻断。候选有重叠冲突或当前 blocker 风险时分别返回 `UNRESOLVED_FACT_CONFLICT` 或 `BLOCKING_FACT_RISK`（完整性失败优先），来源恢复缺少替代来源、绑定不完整或恢复后会冲突时也返回 `blocked` 和稳定 `blockedReason`，不会产生永远返回 409 的 pending/ready 任务。旧单来源恢复行为保持 2B2 语义。

如果原始内容、值或适用范围已改变，来源重确认不能处理，必须创建新候选并重新审核。恢复来源或确认新候选不会自动让旧 Section、QA 或交付重新变为 current/approved。

## 版本、重复与历史

本包沿用 Project.version 记录现有单条事实确认/撤回，以及明确替换、来源重确认产生的业务变化；候选保存和拒绝只增加内部 Revision。这里不创建 Facts F，不把诊断稿批准为正式业务对象。

同幂等键按原正文返回原回执，后续已发生替换或来源恢复也不修改旧响应。并发同 Revision 只允许一个写入成功；失败事务不残留候选、来源、替换关系、Revision 或 command receipt。无需重写历史 JSONB 或建立新 DDL；重复迁移应逐字保留历史聚合、修订和回执。

## 持久完整性与可用性

`evaluateFactEligibility(project, fact)` 是下游共享的纯函数，返回当前 `eligible/reasons` 和供 3A2 使用的 `formalFreezeEligible/formalFreezeReasons`。reason code 包括事实状态、来源不可用、结构化契约/值/来源/适用范围/风险/候选摘要/确认摘要错误、项目内其它事实完整性失败、当前动态治理 blocker、事实冲突、被替换，以及 legacy 未结构化边界。详情读取直接返回同一结果；`availableConfirmedFacts`、模型输入、人工 Storyboard/Section 编辑与 QA 使用相同判定。

结构化事实每次进入当前可用集合时都会从持久 JSON 重新验证：兼容字段和不可重签的候选摘要；显示值、normalized 与 canonical 值；每个 raw value/unit、quote/valueSpan 和当前 Evidence ID/内容哈希；型号与条件来源锚点；风险来源锚点和服务端派生风险；全类别人工复核；确认人、确认时间和不可重签的确认摘要；当前 lifecycle binding；双向替换事件。同文但不同 Evidence ID 不能直接替换已绑定来源，只能经同原件/同块/同内容的显式重确认追加到来源链。候选确认前还会检查项目内所有其他 active 事实的完整性，不能借伪造 superseded 指针隐藏 blocker。候选确认、来源重确认和其无变化快捷路径也先执行完整性校验，不能用一次新命令覆盖或合法化数据库篡改。

重复模型提取在相同属性/值且范围可能重叠时，不能因 Evidence 换 ID、用途循环或原来源撤回而绕过已拒绝或已撤回事实。旧 rejected/retracted 记录保持原状态；重新考虑须通过明确关联原记录、给出理由的人工候选入口，不自动由增量提取完成。

## 验证计划

领域与真实 loopback HTTP 覆盖逐来源真实性和位置、单位等价/矛盾与裁切、跨型号互斥、未知范围冲突、风险省略/伪造与全类别人工复核、锁定修正、明确替换、逐来源用途撤回/恢复和拒绝不复活。只影响引用变化事实的章节，其他章节保持内容与状态。

真实 PostgreSQL 验证多源命令并发、回执、原子失败、断开重连后的来源与锁定历史、旧/新项目重复迁移不变。运行 backend typecheck/test/build 和跨端类型验证；遇到确需前端兼容的问题先交协调者分配，不自行修改前端。
