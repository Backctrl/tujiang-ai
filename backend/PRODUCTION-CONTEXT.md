# M2 项目上下文接入契约

本包在 `production.1` 中增加显式配置草稿与不可变的 P1/P2 上下文版本。沿用 [M1 兼容底座](PRODUCTION-FOUNDATION.md) 的可选生产域：旧项目 GET 不触发初始化，诊断稿不升级为正式章节。新配置不是已确认产品事实，也不批准故事线、章节或交付。

## 接口与状态

以下接口除目录读取外都是人工操作入口；全部需要既有 Bearer 认证。写请求携带 `expectedProjectVersion`、`expectedRevision` 和 `idempotencyKey`，返回完整最新 Project。实际操作者与时间由服务端写入，不接受客户端自报批准信息。

| 方法与路径 | 输入及行为 |
| --- | --- |
| `GET /api/production/catalog` | 返回 `{ contractVersion: 'production.1', rulePacks: [...] }`，不写项目 |
| `POST /api/projects/:id/production/initialize` | 既有初始化命令；用户明确选择开始配置生产项目后调用 |
| `POST /api/projects/:id/production/context/draft` | 写入信封加 `{ context: ContextDraft }`；必须已初始化 |
| `POST /api/projects/:id/production/context/activate` | 只接收写入信封；验证当前服务端草稿，生成下一个 P 版本并消耗该草稿 |
| `GET /api/projects/:id` | 从 `production.context` 读取草稿、版本历史及当前激活版本 |

`GET /api/contracts` 的 `requests.productionContextDraft` 和 `requests.productionContextActivate` 给出请求 JSON Schema。所有新增类型从 `src/production-context.ts` 导出，根 Project 的 `contractVersion` 仍为 `stage-a.1`。

```ts
interface ProjectContext {
  draft?: ContextDraft;
  versions: ProjectContextVersion[];
  activeVersion?: number;
}
interface ProjectContextVersion {
  version: number;                 // 1、2……，单独的业务版本
  label: string;                   // P1、P2……
  context: CompleteContext;
  rulePack: RulePack;               // 激活时的完整规则快照
  rulePackSha256: string;           // 排序键后的 JSON SHA-256
  activatedBy: string;
  activatedAt: string;
}
```

草稿是整体替换，允许空对象；省略的字段被清除，不与旧草稿或已激活版本自动合并。ProductBrief、PrimaryTarget、CanvasProfile 内的字段在草稿中可以逐个省略，`rulePackRef` 要么省略，要么同时提供 id/version。已提供的字段仍须有效，清空 UI 文本时应省略字段而非发送空字符串。改动已激活版本时，前端显式把选定版本复制为本地草稿，保存后再次激活为 P2，P1 不变。

| 对象 | 完整激活所需字段 |
| --- | --- |
| `productBrief` | `productName`、`internalCode`、`category`、`stage`（非空文字，各最多 200 字符）；`introduction`（最多 10000 字符）；`commercialIntent`（最多 2000 字符） |
| `primaryTarget` | `platform`、`site`；`country`（2 位大写）；`language`（语言标签）；`currency`（3 位大写）；`unitSystem`（`metric` 或 `imperial`） |
| `canvasProfile` | `widthPx`（1—20000 的整数）；`format`（`png`、`jpeg` 或 `webp`） |
| `rulePackRef` | `id`、`version`（非空文字，各最多 200 字符） |

激活要求精确匹配 RulePack 的全部六个目标字段；画布宽度与图片格式必须在该规则允许列表内。这里的 `format` 是画布目标图片编码，不限定 M6 的 HTML/PDF 等交付容器。规则的 `requiredFacts` 会随 P 版本冻结，事实是否满足它们由后续 M3 Facts 基线功能验证，本包的激活不表示事实放行。

## 人工核验规则目录

默认不配置 `PRODUCTION_CATALOG_PATH`，目录为 `{ "rulePacks": [] }`。因此可以保存待补齐草稿，但没有已核验规则时无法激活。没有内置平台规则，也没有合成规则回退。

管理员完成来源核对后，在本地 JSON 文件中填写规则，并用 `PRODUCTION_CATALOG_PATH` 指向它；相对路径以服务启动目录为准，重启服务后加载。目录顶层只允许 `rulePacks`。显式配置文件丢失、JSON 无效或 Schema 校验失败时服务启动失败，不静默改用空目录。

每个 RulePack 必须包含：

- `id`、`version`；目录内二者组合唯一。规则内容修改必须使用新版本。
- `officialUrl`（HTTPS 来源地址）、`verifiedBy`（实际核验者）、`verifiedAt`（非未来的 UTC ISO 时间）。这些是人工核验声明，Schema 不能代替业务人员确认来源权威性或规则准确性。
- `target`（上述完整 PrimaryTarget），不使用通配目标或按其他站点兜底。
- `allowedWidthsPx` 和 `allowedFormats`（非空、无重复）。
- `requiredFacts`：显式数组，每项含唯一 `key`、`description`、`allowUnknown`、`allowNotApplicable`；后两项必须明确为布尔值。若核验结果确实没有额外必需事实，可显式提供空数组。

目录由服务启动配置提供，不开放浏览器写规则或伪造核验者的接口。激活快照保留规则本体和内容哈希；数据库 `production_rule_packs` 以 id/version 为唯一键绑定完整规则及哈希，所有项目共享。不同服务实例使用不同本地目录并发激活时，只允许一个内容首次注册；同内容可以复用，不同内容返回 `RULE_PACK_VERSION_CHANGED`。注册、上下文版本、审计和回执在同一事务中提交，重启后约束仍然有效。

## 错误与恢复

| HTTP / code | 含义与处理 |
| --- | --- |
| 400 `INVALID_REQUEST` | 未声明字段或格式错误；检查 `error.fields`，不提交非法字段 |
| 401 `UNAUTHORIZED` | 恢复连接凭据；保留当前本地草稿 |
| 409 `PRODUCTION_NOT_INITIALIZED` | 用户先显式初始化；失败命令不自动初始化 |
| 409 `UNSUPPORTED_PRODUCTION_CONTRACT` | 客户端与服务端生产契约不兼容 |
| 409 `PRODUCTION_CONTEXT_INCOMPLETE` | 当前草稿不完整或不存在；`error.details.fields` 给出所缺路径 |
| 409 `RULE_PACK_UNAVAILABLE` | 草稿绑定规则不在当前目录中；补齐经核验目录或更换绑定 |
| 409 `RULE_PACK_TARGET_MISMATCH` | 精确目标不一致；`error.details.fields` 给出不同目标字段 |
| 409 `CANVAS_OUTSIDE_RULE_PACK` | 宽度或格式不允许；`error.details.fields` 给出对应画布字段 |
| 409 `RULE_PACK_VERSION_CHANGED` | 同一数据库已绑定相同 id/version 的其他内容；恢复规则或以新版本核验 |
| 409 `VERSION_CONFLICT` / `REVISION_CONFLICT` | 读取最新项目，保留并比较本地草稿后显式重提，不自动覆盖 |
| 409 `IDEMPOTENCY_CONFLICT` | 同 key 被用于不同意图；未决请求先按原内容查询/重试，不用该 key 发送修改后的正文 |

成功重放同 key 返回原始响应快照，即使此后已经激活 P2，也可能返回只含 P1 的旧响应。前端不能据此倒退最新状态，继续遵循 M1 的修订排序与未决请求恢复规则。

## 兼容与验证

上下文保存在既有 PostgreSQL JSONB 项目聚合中。升级前运行 `npm run migrate`，幂等创建全局规则版本注册表，并从旧项目的历史 P 版本回填规则绑定，不重写项目、已激活上下文、修订快照或回执。若旧数据已出现相同规则版本异内容，或规则快照内容与哈希不一致，迁移原子拒绝并保留原数据，不能自动选择一个版本覆盖已批准内容。

写入、审计、完整修订快照、幂等回执仍在同一事务；失败不留下新版本或孤立规则注册。草稿保存只改草稿，激活只追加快照及更新 activeVersion，没有编辑/删除历史 P 版本接口。

本包不把上下文加入旧 `extract-facts` / `plan-section` 的输入，因此这些配置操作保留阶段 A `version`、`inputRevision` 和 QA，不让不相关的在途事实任务失效。未来正式 Skills 和对象必须显式引用 P 版本及依赖，再处理上下文变更带来的失效；本包没有宣称已完成该后续关联。

`test/production-context.test.ts` 覆盖空目录与配置失败、规则 Schema、鉴权、显式初始化、部分草稿、整体替换、目标与画布阻断、P1/P2 不变性、历史读取、幂等重放、并发写入、全局规则绑定、旧数据回填和旧事实任务并行。`test/postgres.integration.ts` 另覆盖独立连接的跨项目复用、同版本异内容并发竞争及连接池重启。测试 RulePack 与产品均明确为合成数据，只存在于测试目录中。

运行 `npm run typecheck`、`npm test`、`npm run build`。默认测试是 PGlite 与模型替身；真实 PostgreSQL 组合验收和业务黄金样本签收由主 Agent 记录，不由合成测试代替。
