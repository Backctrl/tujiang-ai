# 模型能力与选择依据

2026-09-05：统一通过 OpenRouter 调用，但按业务能力选型，不要求所有 Skill 固定使用一个模型。以下是需求分类；具体模型及 provider 端点仍需真实样本验证，不是已完成的效果结论。

| 能力类型 | 图匠任务 | 必需条件 | 本轮状态 |
| --- | --- | --- | --- |
| 结构化文本理解 | 规格文本 → FactCandidate | JSON Schema 输出、原文引用、单位/型号区分、冲突保留、足够上下文 | A 必需，`extract-facts` 已接适配器 |
| 结构化规划 | 已确认身份/核心事实 → 初步顺序与 Section 验证草稿 | 遵守事实白名单、组织内容角色与顺序、列出缺口、不生成最终文案/批准 | A 必需，`plan-section` 已接适配器 |
| 视觉理解 / 文档识别 | 产品照片、扫描规格书、表格与参考图理解 | 图像输入、表格/数值识别、来源定位；参考不得当产品证据 | 素材接入后需要，尚未实现 |
| 多语言写作与适配 | 已确认内容 → 一市场文案/长度/语气适配 | 忠实于事实、术语和单位规则、可校验结构 | B 需要，尚未实现；可复用合格文本模型 |
| 图像生成 / 编辑 | 场景图、背景替换、商品素材衍生 | 对应输出/编辑能力、主体与细节保持、尺寸/质量约束 | 按章节生产需求接入；基础链路可先用已有合格素材 |
| 视觉复核 | 对照渲染结果发现遗漏、变形、可读性问题 | 图像输入、定位问题、结构化缺陷报告 | 后续辅助 QA，不能代替确定性硬规则 |

前两行是两类任务，可以使用同一个合格文本模型。起步先共用默认模型，黄金样本证明某一 Skill 有必要后，再分别配置：

```dotenv
OPENROUTER_MODEL=
OPENROUTER_FACT_MODEL=
OPENROUTER_PLAN_MODEL=
```

专用配置优先，未配置回落到默认值。每次 AgentRun 保存选中的 modelId；不使用自动随机模型路由，以便比较输出和复现问题。这里的回落只是配置选择，不是运行失败后自动切换模型重复计费。

## 首轮选型和验收

1. 从 OpenRouter 筛选支持 JSON Schema 的模型/端点，确认实际上下文容量能容纳首批规格资料。
2. 用同一产品规格书比较少量候选模型：包含正常参数、单位、型号差异、相互矛盾字段、缺失字段和资料内伪指令。
3. 提取评估：原文锚点真实、无补造参数、冲突被保留、不可确认项明确暴露；人工确认后才供下游使用。
4. 规划评估：全部事实 ID 有效且已确认；满足产品身份/核心事实门；初步顺序不混入广告正文、HTML 或批准状态。
5. 同时记录结构通过率、语义错误、耗时和调用成本。在达到质量硬门的候选中选择合适的成本与速度。

本轮测试验证了 Schema、引用和状态规则；尚未验证任何真实模型的提取或规划质量。Token 上限、provider 能力及价格以选定端点的当前信息为准。

## 已提供的离线评测入口

`evaluation/cli.ts` 可以评测保存的模型业务 JSON；输入样本、运行命令、报告和未来真实调用记录契约见 [evaluation/README.md](evaluation/README.md)。现有样本明确标为 synthetic，覆盖冲突和资料内伪指令，对抗测试覆盖虚假引用、遗漏、额外声明和越权字段。工具不发网络请求。自动检查通过仍返回 `needs_human_review`，不能代表真实模型质量或业务验收通过。

## 新增评测执行器（2026-09-05）

`npm run evaluate:runner -- evaluation/fixtures/synthetic-run.json` 默认 dry-run，使用合成 endpoint 快照，不联网或读 Key。实现及边界见 [evaluation/README.md](evaluation/README.md)。M0 真实模式需要同一 PostgreSQL 累计授权、不可变 batch、独立 input-review、显式 `--live --batch`、环境启用及固定模型/端点与预算；普通 runner 不能登记授权或批准输入。当前仅接通事实提取，其他阶段和图片仍拒绝 live。实时能力与已审阅快照一致才能派发，禁止自动重试和 fallback。预算为本地估算门，不保证最终美元硬封顶；未知用量会持久阻断后续派发。正常输出接入现有 evaluate，`businessAcceptance` 始终 false。配置与受控原文复核见 [授权账本操作](evaluation/AUTHORIZATION-OPERATIONS.md)。

本轮只有合成 fetch 协议测试与代码验证，没有真实模型运行、质量成绩或业务验收。生产 gateway 已复用 src/model-policy.ts 的能力、路由和预算检查，并保留实际 usage；完整观测和请求配置见 STAGE_A_API_HANDOFF.md。

## 不应交给模型的职责

版本比较、幂等、权限、人工批准、锁定保护、依赖失效、正式导出闸门由服务端代码执行。QA 可以使用模型发现候选问题，但不能凭模型一句“通过”放行。HTML Renderer 应按受控模板与版本输入生成结果，不让模型输出任意代码作为正式交付。

## 官方依据

- [OpenRouter 结构化输出](https://openrouter.ai/docs/guides/features/structured-outputs)：`response_format=json_schema`，端点支持存在差异；使用 `provider.require_parameters=true` 并继续本地校验。
- [多模态输入说明](https://openrouter.ai/docs/guides/overview/multimodal/overview)：图像/PDF 等输入要求相应模型或解析能力；统一 API 不等于模型能力完全相同。
- [图像生成说明](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)：图像输出使用具备相应能力的模型，不能将文本模型等同为图像生成模型。

## FLEX 正式 Worker 调用政策

- 固定 OpenRouter HTTP 地址、完整显式模型与唯一 endpoint tag，only/order 固定同一 tag，allow_fallbacks=false、require_parameters=true、stream=false；无工具、插件、媒体、cache_control或额外生成请求。
- 必须支持文本输入/输出、response_format、structured_outputs 和 max_tokens。基 tag 同时匹配子变体时失败 PROVIDER_MISSING_OR_AMBIGUOUS；当前仅核验响应 model 和 provider_name，供应商响应未返回端点 tag，无法额外验证其内部物理机路由。
- 输入大小估算为完整请求 UTF-8 bytes + 1024（保守启发式，不是 tokenizer 保证）。max_prompt_tokens=null 时以 context_length 与输出预留共同约束；max_completion_tokens 未知仍失败。
- 采用官方 endpoint Schema：prompt/completion 为必需价格，缺失/非法不放行；request 为可选价项，未公布时表示估算中没有公布的逐请求附加 tariff，此政策是本地估算假设，费用观测缺失仍为 null。discount 为 0..1 的数字，本地不使用折扣降低预算预留。
- 纯文本无搜索/媒体，因此 image/audio/web_search 价项不进入估算。无显式缓存；有正数 cache-write 价格时必须声明 supports_implicit_caching=false，否则失败。未知正价类别及非空条件 overrides 均失败，不能把未知价项视为零。cache read 不用于降低预留。
- reasoning 采用保守额外预留：maxInputTokens * prompt + maxOutputTokens * (completion + internal_reasoning) + advertised request。即使服务商把思考 token 计入 completion，本地仍多留一份预算。
- 一次 attempt 的全部预检、网络等待和正文读取共用 OPENROUTER_TIMEOUT_MS（最多 90,000ms），严格短于 120,000ms Worker 租约。每个响应体上限 2,000,000 bytes，禁 redirect，无自动 retry。
- 成功响应必须有匹配路由、stop结束和已知 usage；unknown、截断、拒答、超实际token/cost上限均失败，但保留已返回的已知 usage。正常业务输出交给 Domain 再做结构/引用/并发校验；Domain失败仍记录费用，模型成功的输出保留供复核而不应用。

2026-09-05 公共快照 public-gemini-endpoints-20260905.json 来自官方 /models/google/gemini-2.5-flash/endpoints，仅用于离线协议预检，不是生成质量证据。google-vertex/eu 在该快照唯一且无子变体，支持所需参数且关闭隐式缓存。64,000输入/6,000输出按上述政策预留 $0.0492/次，6次 $0.2952。真实运行仍实时重新读取能力/价格，不能把快照当永久价格保证。

官方字段依据：[模型端点 API](https://openrouter.ai/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model)、[Usage Accounting](https://openrouter.ai/docs/guides/guides/usage-accounting)。单次费用上限是本地估算门，不能保证最终账单硬封顶；usage未知必须人工核对后再安排后续付费运行。
