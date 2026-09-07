# 图匠后端 · 阶段 A

当前仓库内的独立 TypeScript 后端工程。交付目标是可运行、可测试的阶段 A 基础：文本证据 → 候选事实 → 人工逐条确认 → 初步顺序和未批准 Section 验证草稿 → QA 预检。岳凯六阶段工作台已接入现有受限能力，旧五步向导不在本轮范围。当前接入与验收见 [前端合并记录](../docs/yuekai-integration/README.md)。

完整 MVP 正在以可选 `production.1` 生产域扩展。M1 提供显式初始化与项目列表；M2 提供项目上下文草稿、经人工核验的本地规则目录及不可变 P 版本，接口与边界见 [项目上下文契约](PRODUCTION-CONTEXT.md)。这些扩展不把旧诊断稿变为正式章节。

M2 范围规则扩展区分官方内容/模块/图片槽/文本字段约束与员工本地画布策略，保留旧快照和哈希。新模型、只读规则输入检查及未知规则恢复见 [范围规则契约](SCOPED-RULES.md)。默认规则目录仍空；淘宝缺已核验规则时不能正式启用目标。

M2 资料底座支持 TXT/Markdown/CSV/JSON/PNG/JPEG/WebP 原件接收、认证下载、持久解析任务及待审核候选。员工在事实待处理中心逐块确认用途，服务端派生可追溯的 Evidence、Asset 或 Reference。用途纠正保留旧来源和锁定事实，并要求受影响事实明确重确认；图片未执行 OCR。原件接口、限制与恢复见 [资料接收契约](MATERIAL-INGESTION.md)，用途接口与来源闸门见 [资料用途契约](MATERIAL-USAGE.md)。

M2 项目启动在现有项目草稿上完成提交：只读检查未保存表单、原子建立或复用 P、登记首批资料范围，并在来源与服务端执行配置满足条件时排队提取。待解析、待用途审核或执行服务未配置时可以进入事实页，并显示实际等待状态；员工随后明确继续，已派发任务不重复创建。解析失败后的重新上传通过有差异、指纹和原因的范围更新纳入。接口、状态与恢复边界见 [项目启动契约](STARTUP.md)。

## 基线与工程选择

- [端到端流程 v1，revision 15](https://oriniture.feishu.cn/docx/XHktdDPkKoTPbvxytjKcEfCanPg)
- [功能与交互契约 v1，revision 61](https://oriniture.feishu.cn/docx/EQzNdi9Szo7T1DxsIEMc2ku4nie)，特别是 §7.2、§11.1、§12、§19.3。
- 2026-09-05 李硕确认：在此仓库建立后端；A 验证后端／Agent 链路，B 完成市场适配与正式交付；模型统一 OpenRouter。

Fastify、直接使用 OpenRouter HTTP API、PostgreSQL 内队列是本次最小工程选择。没有引入额外 Agent SDK；Orchestrator/Skills/校验/业务写入的边界已落在代码中。本文与 `stage-a.1` Schema 是待前后端评审的实现契约，不代表飞书接口冻结话题已由所有成员确认。

| 模块 | 文件与职责 |
| --- | --- |
| HTTP / 人工入口 | `src/app.ts`：Bearer 校验、请求 Schema、人工确认、SSE |
| 契约 | `src/contracts.ts`：请求和模型输出 Schema、对象与四维状态 |
| 业务规则 / Typed 操作 | `src/domain.ts`：证据锚点、冲突、逐条确认、草稿追加、QA；模型无法调用数据库 |
| Orchestrator / Worker | `src/worker.ts`：领取一个运行、调用指定 Skill、受控提交、失败记录 |
| Model Gateway | `src/openrouter.ts`：固定 OpenRouter 地址、严格 JSON Schema、超时、脱敏错误 |
| 事务与运行记录 | `src/store.ts`：版本校验、幂等回执、租约、审计、历史快照 |
| 数据库与文件 | `src/database.ts`、`src/objects.ts`：PostgreSQL、开发用本地内容寻址文件存储 |

生产进程只使用 PostgreSQL。为了减少第一轮服务数量，任务保存在项目聚合中，领取时使用 `FOR UPDATE SKIP LOCKED`；模型调用不占用数据库事务。一项目同时只允许一个活动运行。暂不引入 Redis 或独立队列服务。原文以 SHA-256 为键写入本地文件，证据文本和定位也持久化在数据库；云对象存储尚未接入。

## 本地启动（PowerShell）

需要 Node.js 22+、PostgreSQL。根前端工程无需先安装依赖。

```powershell
Set-Location F:\Project\tujiang-ai-source\backend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

编辑 `.env`：填写 `DATABASE_URL`、至少 24 字符的 `BACKEND_API_TOKEN`；真实模型调用还需要 `OPENROUTER_API_KEY`、`OPENROUTER_MODEL`（完整 provider/model ID）。可分别用 `OPENROUTER_FACT_MODEL`、`OPENROUTER_PLAN_MODEL` 覆盖事实提取与规划模型，未配置时使用默认模型。不要将密钥放入 `VITE_*` 或提交到 Git。服务仅绑定 `127.0.0.1`，`BACKEND_ACTOR_ID` 默认 `lishuo`。

若使用提供的本地 PostgreSQL 容器，先启动 Docker Desktop，再执行：

```powershell
docker compose -p tujiang-stage-a up -d postgres
npm run migrate
npm run dev
```

Compose 的数据库密码仅用于本机开发，端口只映射到回环地址。已有 PostgreSQL 时直接填写连接地址并执行迁移，不必使用 Docker。迁移是可重复执行的建表操作，不删除现有数据。

```powershell
# 无需凭据的存活检查
Invoke-RestMethod http://127.0.0.1:3100/health
# 构建及运行编译后的服务
npm run build
npm start
```

API 与 Worker 在同一进程启动；任务持久化在数据库，重启后队列继续执行。已领取但进程中断的任务在 120 秒租约到期后记为 `WORKER_INTERRUPTED`，由人工发起重试，不自动重复付费模型请求。模型超时上限 90 秒，小于任务租约。

数据库重启造成的空闲连接断开由连接池错误处理器接住；失效连接被移除，后续请求重新连接，不输出连接对象。服务运行中可用下面的探针检查本机专用容器重启恢复。该命令会重启 `tujiang-stage-a` 的数据库，请在其他数据库测试结束后单独执行：

```powershell
npm run verify:local-runtime -- --restart
```

探针限定本机 55432 端口及 `tujiang-stage-a` Compose 服务，创建独立临时 schema，检查提交数据和 `/ready` 恢复，结束后清理自己的 schema。

没有配置 OpenRouter 时健康检查和业务 API 仍可运行，模型任务明确失败为 `MODEL_NOT_CONFIGURED`，不会返回模拟成功。当前只使用文本接口，PDF/OCR/图片理解、真实产品样本质量验收尚待接入。

## 接口契约

除 `/health` 外均需 `Authorization: Bearer <BACKEND_API_TOKEN>`。这是**单操作者本地开发边界**：操作者由服务端配置指定，不接受客户端自报 `actorType`/用户 ID；尚未提供多用户身份、项目成员授权或生产认证。模型仅收到脱离数据库和 HTTP 凭据的输入，不拥有人工接口令牌。

`GET /api/contracts` 返回请求及 Skill 输出的 JSON Schema，前端可先据此独立对接。暂不开放跨域；前端联调时使用同源代理，不能把本地 token 硬编码入源码。SSE 使用支持 Authorization 的 fetch 流客户端。

| 方法与路径 | 说明 |
| --- | --- |
| `GET /ready` | 数据库连通性；不证明模型已配置 |
| `POST /api/projects` | 创建项目 |
| `GET /api/projects` | 已认证的项目摘要列表 |
| `GET /api/production/catalog` | 本地人工核验规则目录；默认空 |
| `POST /api/projects/:id/production/initialize` | 用户显式初始化可选生产域，重复调用无额外迁移 |
| `POST /api/projects/:id/production/context/draft` | 已初始化项目整体保存部分配置草稿 |
| `POST /api/projects/:id/production/context/activate` | 验证完整草稿、目标和规则，追加不可变 P 版本 |
| `POST /api/projects/:id/production/startup/check` | 只读检查未保存 ContextDraft，返回阻断、建议、提取前置与资料统计 |
| `POST /api/projects/:id/production/startup/start` | 校验检查指纹，在已有草稿上原子建立启动并按真实条件排队 |
| `GET /api/projects/:id/production/startup` | 当前启动状态、原任务 ID、范围新增差异；读取不写状态 |
| `POST /api/projects/:id/production/startup/continue-extraction` | 资料审核或配置恢复后显式继续初始提取 |
| `POST /api/projects/:id/production/startup/scope-refresh` | 未派发前明确复核新增原件/独立证据，更新初始范围但不排队 |
| `GET /api/projects/:id` | 最新项目快照，含事实、运行、草稿、QA 与审计 |
| `GET /api/projects/:id/revisions/:revision` | 不可变历史快照 |
| `POST /api/projects/:id/identity/confirm` | 员工明确确认产品身份，仅允许首次确认 |
| `POST /api/projects/:id/evidence` | 明确用途为 `product_evidence` 的文本证据及原文定位 |
| `POST /api/projects/:id/runs` | `extract-facts` 或 `plan-section`，返回 202 |
| `POST /api/projects/:id/facts/:factId/confirm` | 逐条人工确认并锁定，需 reason |
| `POST /api/projects/:id/facts/:factId/reject` | 拒绝候选，需 reason |
| `POST /api/projects/:id/facts/:factId/retract` | 人工撤回已确认事实，保留历史并标记依赖 stale |
| `POST /api/projects/:id/runs/:runId/retry` | 重试同一个失败 Run，attempt 增加，旧尝试仍保留于历史 |
| `POST /api/projects/:id/qa/preflight` | 内容预检，不批准、不生成 ExportPackage |
| `GET /api/projects/:id/events` | 持久化审计驱动的 SSE；Last-Event-ID 或 after 支持续读 |

所有写入携带：

```json
{
  "expectedProjectVersion": 1,
  "expectedRevision": 1,
  "idempotencyKey": "a-new-unique-key-per-intent"
}
```

创建项目时两个预期值均为 0，并附加 `name`。后续从最新 GET 获取两者：`version` 是 stage-a.1 聚合兼容版本，创建项目、身份确认／纠正、事实确认／撤回推进，拒绝候选不再推进；本轮没有实现产品契约中全部独立对象业务 Version；`revision` 是内部状态修订，模型排队、开始、结束等也会推进。运行快照记录 `contextVersion`、`contextRevision`，可用历史接口还原输入；新增 `inputRevision/contextInputRevision` 区分真实输入变更与迟到usage观测，后者不使新attempt误报STALE_INPUT。

同一操作者同 key、同请求重放返回**原始响应快照**，不会创建新对象或重复模型调用；同 key 换内容返回 409 `IDEMPOTENCY_CONFLICT`。旧业务版本或内部修订返回 409 `VERSION_CONFLICT` / `REVISION_CONFLICT`，响应含当前版本号。先 GET 查看差异，再决定是否使用新 key 提交；不要自动覆盖。幂等回执和项目提交处于同一事务。

错误统一形状：`{ "error": { "code": "...", "requestId": "...", "details": {} } }`，details 仅在有信息时出现。验证失败另有 fields，不回显原始请求值、服务商响应或密钥。

### 阶段 A 操作顺序

1. 创建项目；项目名称属于背景，不自动成为产品事实。
2. 员工独立补充原文时填写 documentName、locator 和 usage；locator 是人工给出的位置，不代表系统已验证 PDF 页码。原件上传使用 M2 资料接口，解析后按块明确用途；只有当前用途为产品证据的文本块能进入下游。
3. 创建 `extract-facts` 运行。候选包含 core/supporting 分类、原文引用及字符区间；模型不能自动确认。空结果不会放行下一步。
4. 人工核对候选值与证据，逐条 confirm；遇到同属性不同值，先明确 reject 错误候选或 retract 原事实，再确认正确值。自动冲突检查基于规范化属性文本，不承诺识别所有语义同义项。
5. 人工执行 identity/confirm。产品身份来自员工明确回答，记录操作者与时间。
6. 人工发起 `plan-section`：必须已有身份及一条已确认核心事实，且无未解决冲突。仅产出初步顺序／目的／事实绑定／缺口及一个 `diagnostic_draft`。每次追加 Section，不覆盖原草稿；首个模型草稿初始化当前选择，后续结果只追加候选；人工编辑和候选选择见 [STAGE_A_API_HANDOFF.md](STAGE_A_API_HANDOFF.md)。
7. 执行 qa/preflight：检查 currentSectionId 选中 Section 草稿的事实证据、缺口与 stale，以及当前未解决事实冲突；响应 sectionId 标识被检草稿。旧草稿保留历史，不因旧稿 stale 永久阻断新稿。即使 issueSeverity=none，`exportAllowed` 始终 false；`notChecked` 明确列出市场规则、文件质量、素材质量和正式批准。

首次证据写入示例（版本号需按真实响应替换）：

```json
{
  "expectedProjectVersion": 1,
  "expectedRevision": 1,
  "idempotencyKey": "source-import-example-001",
  "documentName": "产品规格书.txt",
  "locator": "第1页，承重参数",
  "usage": "product_evidence",
  "text": "产品额定承重：10 kg。"
}
```

### 状态与硬门

严格采用正式契约 §11.1 的四维字段：

```ts
issueSeverity: 'none' | 'warning' | 'blocker'
runStatus: 'idle' | 'running' | 'succeeded' | 'failed'
freshness: 'current' | 'stale'
approvalStatus: 'draft' | 'in_review' | 'approved'
```

排队另用 `queueStatus: queued | claimed | done`，不会把 waiting/blocked 混入上述枚举。本轮没有批准入口。JSON Schema 拒绝广告正文／HTML／批准状态等额外字段，但 purpose 自由文本的语义仍须人工核验，不能将结构校验称为语义正确性保证。

非法 JSON、引用不在项目内、原文不包含 quote、未确认事实引用或运行期间上游变化，均只使当前 Run 失败，原业务对象保持有效。历史记录保留失败码、尝试号、输入修订、模型 ID 与有效输出。没有承诺所有 provider 对 strict JSON Schema 的遵循相同；按 [OpenRouter 官方结构化输出说明](https://openrouter.ai/docs/guides/features/structured-outputs)启用 `require_parameters`，并在本地再次验证。

## 验证与已知边界

```powershell
npm run typecheck
npm test
npm run build
```

默认测试使用 PGlite（PostgreSQL 的 WASM 运行时）执行迁移与事务，并使用可控模型替身验证 HTTP、人工门、幂等、版本冲突、证据引用、局部失效和 Worker 恢复；另有真实 HTTP SSE、落盘重启与离线评测测试。它们不调用 OpenRouter。

另设真实 PostgreSQL 集成测试。在 `.env` 的 `TEST_DATABASE_URL` 中显式指定测试数据库后运行：

```powershell
npm run test:postgres
npm run evaluate:offline -- evaluation/fixtures/synthetic-extraction.json evaluation/fixtures/synthetic-extraction-output.json
```

真实 PG 测试使用独立连接与随机隔离 schema，覆盖并发版本与幂等、双 Worker 领取、租约恢复和连接故障；无 `TEST_DATABASE_URL` 时明确失败，不能用跳过测试冒充通过。实测记录见 [POSTGRES_VALIDATION.md](POSTGRES_VALIDATION.md)。离线评测的自动通过仍需人工语义复核，详见 [evaluation/README.md](evaluation/README.md)。

上一轮基线报告已在 PostgreSQL 17.11 容器验证启动与恢复；本 FLEX 扩展仅运行 PGlite 和模拟 fetch，真实 PG 集成与模型试用由控制中心后续执行。Agent 分工和独立验收记录见 [TEAM_PROGRESS.md](TEAM_PROGRESS.md)。

当前工程刻意限于本地阶段 A 基础，仍需后续完成：

- 实际 OpenRouter 模型及真实黄金样本的集成验证（PostgreSQL 本地集成已验证）。
- PDF/Office 扩展与 OCR、完整 FactCandidate 元数据、父子章节与必须讲／不要讲偏好。
- 云对象存储、独立 Worker 部署、生产鉴权、备份与容量治理。当前 JSONB 聚合、完整快照及回执未设归档，适合小规模验证。
- 阶段 B 的 SectionSpec 人工批准、HTML Renderer、一个市场的适配、文件级 QA 与正式导出。

岳凯前端版本未确认不会阻塞以上后端契约和接口测试；真实前端联调前，需共同确认源码 commit、字段／状态映射、人工入口、异常回流和阶段验收口径。

## FLEX 阶段 A 扩展

人工候选补充／纠错、身份文字纠正、初步顺序和诊断 Section 保存、明确候选应用与当前草稿选择均已提供。所有操作带 reason、服务端单操作者身份及双版本／幂等保护。完整新增接口、请求示例、历史恢复和错误码见 [STAGE_A_API_HANDOFF.md](STAGE_A_API_HANDOFF.md)。

正式 Worker 与 runner 共用 src/model-policy.ts。生产 build 不依赖 evaluation 源文件；能力查询与生成／正文共用一个最多 90 秒的总期限。真实配置除 Key／模型外还要求 OPENROUTER_PROVIDER、OPENROUTER_MAX_INPUT_TOKENS、OPENROUTER_MAX_OUTPUT_TOKENS、OPENROUTER_MAX_COST_USD、OPENROUTER_ACCEPT_ESTIMATED_BUDGET=true；缺失会报 MODEL_POLICY_NOT_CONFIGURED，不做默认付费调用。每 attempt 最多一次生成，费用未知记录 null。全试用总次数／总费用须由试用计划累计控制，单请求估算门不是账单硬封顶。

独立QA修复：新项目currentSectionId=null表示明确未选择，预检不回退新候选；只有缺字段的旧快照保留兼容读取。旧无归属ID的Section必须匹配当前顺序的sourceRunId并满足事实引用子集，选择和预检均验证。
