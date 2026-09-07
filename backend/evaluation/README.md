# 阶段 A 离线模型评测

离线评测入口只读取本地 JSON，不调用 OpenRouter、不读取 API Key、不产生模型费用。它复用生产 `extractionSchema`、`planSchema`、`checkSkillInputs` 和 `applyOutput`，不替代真实产品验收。后述 live runner 另受 [M0 授权账本](AUTHORIZATION-LEDGER.md) 与 [管理操作说明](AUTHORIZATION-OPERATIONS.md) 约束。

在 `backend` 目录运行：

```powershell
npx tsx evaluation/cli.ts evaluation/fixtures/synthetic-extraction.json evaluation/fixtures/synthetic-extraction-output.json
```

两个参数分别是输入样本和模型输出。模型输出指 `choices[0].message.content` 解析后的业务 JSON，不是完整 OpenRouter envelope。保存原始 envelope 时必须去除请求凭据；本工具不接受网络地址。

退出码：`0` 自动检查通过但仍需人工复核；`1` 硬检查失败；`2` 参数、文件或样本格式错误。stdout 始终为 JSON。报告不复制证据正文、模型正文或凭据，仅保留检查代码和内容摘要。

## 样本契约

`evaluate.ts` 导出严格的 `fixtureSchema`。必需字段为 `id`、`provenance`、`skill`、`evidence`、`expectedFacts`。`evidence` 包含 UUID、文本与定位；`expectedFacts` 是该样本的完整预期 attribute/value 列表。提取结果按精确字符串比较，因此合法同义词或单位改写也会标为待修正的硬失败，需人工确认后调整样本，不能直接计为模型编造。

提取样本使用 `expectedConflictAttributes` 指明必须保留不同值的属性。规划样本增加 `productName`、`facts`（含 UUID、来源、原文引用、role、status）；只有 confirmed 事实可以引用。样本中的确认状态是评测前置输入，不能用模型输出自动构造。

现有 synthetic 样本专门包含容量冲突与资料内伪指令。自动检查验证结构、引用存在、预期事实遗漏、额外声明、冲突是否保留、规划事实白名单及禁止的结构字段。正常、伪造引用、遗漏冲突、额外参数、未确认引用和批准字段的对抗案例见 `test/evaluation.test.ts`。

原文存在并不证明它支持该结论。`purpose` 内暗藏广告文案或批准语句、跨型号误归因、单位语义、伪指令影响和标签完整性均需人工检查。所有报告 `businessAcceptance=false`；自动通过时 verdict 为 `needs_human_review`。

## 人工整理样本与旧记录格式

先由业务负责人提供真实规格书、完整预期事实及冲突标注，复核后将 `provenance` 设置为 `human-curated`。此标记只是声明，不是程序对标注质量的证明。

`recordedRunSchema` 保留人工导入的完整记录格式。新的 `runner.1` 报告支持失败请求的未知费用、脱敏请求 ID 摘要、预算与能力快照摘要；这两种格式不同，不能把失败记录补零后强行塞入旧 schema。

对每个候选模型使用相同、已人工复核的样本。保存不可变的输入、输出及哈希，以及上述运行记录；比较硬检查、人工语义结论、成本和耗时。当前没有配置或评定任何真实模型，不应据 synthetic 测试宣布模型合格。

## OpenRouter runner（默认 dry-run）

在 `backend` 中执行下面的命令，读取合成能力快照和合成样本；不联网、不读环境变量或 Key：

```powershell
npm run evaluate:runner -- evaluation/fixtures/synthetic-run.json
```

`synthetic/protocol-only`、`synthetic` 及示例价格均为测试数据，不是已验证模型或真实报价。dry-run 只校验样本、请求结构、能力快照与预算计划，不生成模型输出，也不运行模型质量评分。`npm test` 使用注入 fetch 的合成协议响应验证成功、错误和费用边界。原来的 `evaluate:offline` 继续评估本地保存的业务 JSON。

运行配置 JSON 包含 `config`、`fixtures`（相对配置文件的本地样本路径数组）以及 dry-run 使用的 `capabilitiesFile`（相对路径）。字段契约见 `runnerConfigSchema`，示例见 `fixtures/synthetic-run.json`。未知字段/CLI 参数被拒绝。报告到 stdout，退出码 0 为 dry-run 计划通过或自动检查通过且待人工复核，1 为已尝试模型调用后的失败，2 为输入错误或预检阻断。

未来经授权的真实评测需要同时满足以下条件；本轮没有执行该模式：

1. 在独立配置中指定完整模型 ID、精确 provider endpoint tag、请求次数、输入与输出 token 上限、总费用估计门和超时。
2. 提供 `human-curated` 样本并设置 `acceptEstimatedBudget=true`，表示理解本地估算不等于最终计费硬上限。标记本身不证明样本已经人工核准。
3. 管理入口在同一个 PostgreSQL 账本登记固定授权，准备不可变 batch，并由独立管理身份记录对精确 manifest 的已有人工决定。缺少 input-review 或仅声明 `human-curated` 均不能派发；runner 不能自行创建或复核批次。
4. 由操作者配置账本 URL、材料密钥、`TUJIANG_EVALUATION_LIVE=1` 和 `OPENROUTER_API_KEY`，命令显式追加 `--live --batch <approved-batch-id>`。CLI 不加载 `.env`，不接受命令行 Key；详细环境项见管理操作说明。

真实模式通过官方 `/models/{author}/{slug}/endpoints` 查询当前能力，并与已审阅快照的相关字段比对。验证文本输入/输出、`response_format`、`structured_outputs`、`max_tokens`、上下文及输入/输出容量、端点 status 与模型 ID。使用 endpoint `tag` 路由；base slug 会匹配 variants，因此多个匹配项一律拒绝。相关价格或能力改变需要重新复核，不能悄然换价执行。

所有 live 进程在同一授权下最多持有一个派发许可，预先验证全部样本。当前只接通事实提取；旧 `plan-section` 仅保留离线诊断，不算正式故事。预期答案不进入请求。共享的 `buildStructuredRequest` 让生产与提取评测使用相同提示、过滤和 JSON Schema。禁止 fallback、重试、自动换模型或追加 generation 查询；evaluation 使用有界原文传输器，生产 gateway 未接入本次累计账本。

## 预算的实际边界

`maxRequests` 是批次上限，live 还必须满足固定授权的文本 12 次 / 图片 2 次和用途 3/3/2/2/2/2 配额。PostgreSQL 在进程、目录、批次和阶段之间累计次数与整数微美元估算，已派发不能退款；图片及其他阶段尚未实现 live 适配器。`requestsAttempted` 是本次入口取得的派发数，`authorization` 是累计账本；live 的 `observedCostUsd` 为授权内文本已知总额，存在未知用量时为 null。元数据 GET 单独记为 `metadataRequests`，本次至多 1 次，完成批次重放为 0。每个请求设置 `max_tokens=maxOutputTokens`；超时覆盖连接、响应头和读取正文，正文最多 2 MB。客户端取消不能保证服务商没有执行或计费。

本地按 `maxInputTokens × pricing.prompt + maxOutputTokens × (pricing.completion + advertised internal_reasoning) + advertised request` 估算每次成本，再检查整批和每次调用前的剩余预算。端点价格为每 token/每 request 的美元单价，不能使用模型列表的最低报价替代。输入 token 使用请求 JSON 的 UTF-8 字节数加 1024 的保守启发式进行本地容量筛选，包含提示、schema 和 framing；没有模型 tokenizer，所以**不是严格 token 上界**。实际超限只可在响应后发现。

当前按官方 endpoint Schema 要求 prompt/completion 有效；request 是可选公布的逐请求价项，未公布不加该附加tariff，不能据此把未知usage当零。纯文本不启用媒体、工具、搜索或显式缓存，不计不适用价项；正数缓存写价格要求 supports_implicit_caching=false；未知正价类别、条件 overrides 均拒绝。完整保守估算与兼容政策见 ../MODEL_CAPABILITIES.md。价格变化、tokenizer 差异、特殊收费及上游执行行为意味着 `maxCostUsd` **只是本地估算门，无法承诺美元硬封顶**。需要严格最终账单封顶的运行不应仅靠此 runner 启用。

已返回费用使用 `usage.cost`（OpenRouter 账户费用观测）；这不代表 BYOK 上游账单、充值手续费或整个账户的总支出。超预算观测终止后续调用；它不能追回已发生费用。缺失/非法 usage、传输失败或无法解析响应时成本为 `null`，停止整批，不按零费用继续。截断、拒答、非法业务 JSON、规则失败、路由不符、费用/容量异常各有独立错误码。任意失败停止整批。

## 脱敏与人工复核

报告仅记录配置/输入/请求/输出/能力摘要、受控状态与错误码、预算及数值观测。不复制样本文本、预期答案、原始模型正文或服务商错误正文。fixture ID 不回显，request ID 只存 SHA256；`finishReason` 使用白名单。报告不保存 Authorization 或 Key。原始来源、输入、预期、请求、能力、响应、解析与人工恢复材料加密保存在账本，绑定内容及元信息摘要；HTTP 错误、非法 JSON 和已收到的部分正文也保留。人工复核通过单独的管理导出入口读取，当前 Key 在保存与导出前脱敏；使用步骤见管理操作说明。

成功输出直接交给现有 `evaluate`；自动通过仍为 `needs_human_review`，所有路径 `businessAcceptance=false`。合成协议测试、人工整理的黄金样本和真实模型质量验证是三种不同证据，不能相互替代。此次交付没有真实模型成绩。

## 官方字段依据（2026-09-05 核对）

- [端点列表 OpenAPI](https://openrouter.ai/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model)：`data.id`、`architecture`、`endpoints[].tag/provider_name/model_id/status`、容量、`supported_parameters` 与 endpoint `pricing`。
- [Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection)：`only`、`order`、`allow_fallbacks=false`、`require_parameters=true` 及 base slug 对 variants 的匹配规则。
- [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)：`response_format` 中的 `json_schema`/`strict`，模型与 provider 的支持差异；仍需本地校验。
- [Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)：非流式响应自动附带 usage；`cost`、`prompt_tokens`、`completion_tokens` 与上游费用不同。未使用已弃用的 `usage.include`。
