# M0 模型试验授权账本与受控留存契约

状态：**契约已冻结，实现待独立验收**。现状审计起点为 `c112d72`，实现前已同步主线 `153c42f`。本包验证只使用合成响应；真实模型 POST 与真实元数据请求为 0，不登记真实输入批准、不启用 live。

授权来源为 `docs/mvp/model-evaluation-proposal.md` 中 2026-09-07 的用户确认。本账本只服务该次 M0 试验；不扩大模型、调用量、用途或费用边界，也不代替输入、事实、故事或最终业务签收。

## 1. 实现前审计与缺口

| 当前证据 | 已有能力 | 本包要补齐的边界 |
| --- | --- | --- |
| `evaluation/runner.ts`，`RunnerReport` 初始化与循环 | 单次进程的请求数、观测费用、当前批次失败停止 | 重新运行从 0 开始；没有跨进程、跨阶段授权余额 |
| `evaluation/runner-cli.ts`，`runFileSchema` | 默认 dry-run；显式 live 参数、环境开关与惰性读 Key | 缺少持久授权 ID、不可变 batch、独立 input-review 回执 |
| `evaluation/evaluate.ts`，`fixtureSchema` | 严格的提取/旧诊断规划样本；expectedFacts 不进请求 | `human-curated` 只是声明，不能视作输入已被业务负责人批准 |
| `src/model-policy.ts`，`preflight/requestJson` | 精确单端点、无 fallback、无重试、费用未知停止；有限正文与超时 | 传输仅返回已解析 JSON，丢弃 HTTP 错误正文；图片预检不成立 |
| `evaluation/runner.ts`，输出报告 | 摘要、哈希、白名单错误与 usage；默认报告脱敏 | 无可供人工语义复核的原始 envelope、解析输出或错误原文留存 |
| `src/database.ts`，`Database` | PostgreSQL 事务及连接池；默认测试可用 PGlite | 可复用连接接口，在 evaluation 内单独建表，不改 Project/Startup/Renderer |

当前正式网关 `src/openrouter.ts` 的生产请求没有本次累计授权账本。这个包只接管 M0 evaluation 入口，不把生产网关宣称为已受该授权保护。真实试验只允许通过新 evaluation 入口；后续生产接入须另行明确任务范围。

## 2. 固定授权，不提供自动补额

固定授权标识为 `m0-model-trial-2026-09-07`。初始化是单独的管理操作，记录既有用户授权的来源和 policy SHA；runner 只读取已存在的授权，数据库缺失或为空时拒绝 live，绝不自动新建另一份余额。改变目录、batch ID、进程或输入文件不能重置已记录的授权。所有进程必须连接同一个已配置的 PostgreSQL 账本；本地账本不是 OpenRouter 整个账户的消费控制器。

初始化必须 create-once：同一 ID 与完全相同 policy/SHA 幂等返回已有授权；同一 ID 的任何政策字段或 SHA 改变均硬冲突，不覆盖、不补额。重新初始化已用过的授权也必须返回原累计记录。

| 模态 | 唯一模型 / 精确 provider tag | 请求上限 | 单次 token / 时间上限 | 累计本地估算门 |
| --- | --- | --- | --- | --- |
| text | `google/gemini-2.5-flash` / `google-vertex/eu` | 12 | 输入 64,000，输出 6,000，90 秒 | 750,000 micro-USD，即 0.75 USD |
| image | `google/gemini-2.5-flash-image` / `google-vertex/global` | 2 | 输入 16,000，输出 2,048，90 秒；每次 1 张 | 250,000 micro-USD，即 0.25 USD |

| purpose | 模态 | 最多模型 POST |
| --- | --- | --- |
| `fact_extraction` | text | 3 |
| `formal_story` | text | 3 |
| `copy` | text | 2 |
| `layout` | text | 2 |
| `english_adaptation` | text | 2 |
| `representative_image` | image | 2 |

用途之间、图文之间不能挪用额度。请求配置可以更小，不能高于已批准上限。模型和 provider 必须完全相等。不存在余额重置、退款后自动重试、自动扩大授权或由配置文件设置 `approved=true` 的快捷路径。

金额以向上取整的整数 micro-USD 记账，避免浮点累加越过边界。分别记录累计派发估算、尚未派发的预留估算、已知观测费用以及未知费用次数。每次预留/派发同时检查：累计估算与预留不超过对应估算门；已知费用加未结算预留仍有空间。已经派发的请求不退回次数，也不退回累计估算；明确从未派发的预留可通过受控取消释放。

`observedTotalUsd` 在存在未知费用时为 null，并另报 `knownObservedUsd` 和 `unknownUsageAttempts`。真实返回的数值 0 与未知严格区分。估算门始终标记 `local-estimate-not-billing-cap`，不承诺服务商最终账单硬封顶。

## 3. 每批输入与人工复核

`BatchManifest` 是不可变对象，至少绑定：授权 ID、batch UUID、purpose、adapter ID/version、配置 SHA、原始来源文件及其字节 SHA、全部标准化 fixture SHA、人工预期 SHA、实际编译请求 SHA、相关上游人工复核引用。所有摘要采用明确版本的 canonical JSON/原始字节 SHA-256；键序变化不能改变结构摘要。

输入快照、预期答案和请求正文单独受控留存。人工预期保留完整内容供复核，永不拼入模型请求。人工复核对象是完整 manifest 和可查看的输入；仅给一个 SHA、仅写 `human-curated` 或仅通过 dry-run 都不足以批准。

`InputReview` 记录 review ID、精确 manifest SHA、reviewer、独立管理凭据指纹、外部 decisionReference/receipt SHA、时间、决定和原因。身份与凭据只从管理进程环境读取，不能来自 batch、fixture 或 runner 参数；runner 实例在运行时拒绝所有管理写操作。显式批准才能启用该 batch；拒绝保留记录。批准后任何输入、预期、配置、来源、请求或 adapter 变化都必须形成新的 batch 与新复核，不能覆盖原记录。执行时重新编译并比较请求 SHA，防止代码或原件在复核后变化。

本包提供准备/检查与记录既有人工决定的管理入口，但不会替用户签署真实输入复核。费用授权与 input-review 是两个不同的既有边界；本包不会再次请求已经完成的费用授权。

## 4. 持久层与并发

复用 `Database` 接口，新增 evaluation 自有迁移与表：

- `evaluation_authorizations`：固定 policy、policy SHA、运行状态与版本。
- `evaluation_batches` / `evaluation_input_reviews`：不可变 manifest、输入快照引用、复核决定与批次状态。
- `evaluation_attempts`：每个 batch item 的唯一预留/派发/结算记录；唯一键为授权 + batch + item。
- `evaluation_artifacts`：受控输入、请求、能力快照、响应、解析、usage 与错误材料。
- `evaluation_events` / `evaluation_command_receipts`：追加的状态事件与带 fingerprint 的幂等回执。

所有额度相关操作先锁定同一个授权行，再读写批次和请求。初始化迁移有独立事务锁。默认测试使用同一 SQL 契约的 PGlite；并发和崩溃语义必须另用真实 PostgreSQL、独立连接池及独立子进程验证。

本次最多 14 个 POST，没有并行派发需求：**一个授权全局最多一个模型 POST 正在执行**。另一个进程可检查状态，但不能同时取得派发许可。这样一旦费用未知或失败停止，不会继续放行下一次请求；不会用进程内 mutex 代替数据库约束。

任意已 `dispatch_started` 且尚未完成/人工核账的 attempt 都形成跨进程 effective hold。所有 reserve、beginDispatch 和解除 held 的检查都从持久层派发记录计算这个条件；不能只相信授权行的 status，也不能按 age/lease 自动释放。

## 5. reserve / dispatch / capture / finish

| 操作 | 原子保证与结果 |
| --- | --- |
| `preflightAvailability` | runner-only，绑定本实例成功取得的精确 approved snapshot。在读取模型 Key 或发出 metadata GET 前，锁内检查本批次全部尚未预留项目对应的全局次数、用途额度、估算与本地费用；已有预留不重复计算。此门只检查可用性，最终 reserve 仍锁内重验并发变化 |
| `reserve` | 在授权行锁内重验 policy、input-review、manifest、purpose、模态、模型路由、计数与费用；按 batch item 唯一预留。可运行批次的重复输入返回已有状态；stopped/completed 批次禁止新预留/派发，完成批次由 runner 直接读取已保存状态 |
| `beginDispatch` | 重新检查全部门与全局在途状态，提交 `dispatch_started` 后才允许调用 fetch。只有本次从 reserved 转移成功的调用获得一次性许可 |
| `recordCapture` | 加密、脱敏并持久化已收到的原文与元数据；相同材料摘要幂等，冲突内容不覆盖原件 |
| `finish` | 读取已持久化材料，原子记录 usage、结构化解析、规则结果、错误、终态和审计。相同 fingerprint 重放；不同结算内容冲突，不重复计数 |

派发许可不保存为可以重放使用的 `mayDispatch=true` 回执。同一命令重放只能查看状态，不能再次 POST。finish 可以安全重放；模型请求不能重放。所有网络调用都发生在事务之外，账本不宣称数据库和外部服务拥有分布式 exactly-once 事务。

批次内串行执行。已取得精确 approved snapshot 后，存储的 adapter 不支持、输入/预期/来源/请求变化、敏感输入、metadata 传输或解析失败、能力/端点/价格/token/参数/隐式缓存/估算无效、能力相对复核内容变化，按固定错误码白名单幂等写入 `stopped` 和 `batch.review_invalidated` 事件。外层 stop 只接受本 runner 实例签发的 snapshot，不能用任意 batch ID 或自行拼装的对象触发。首次读取已批准 payload 或 reserve/beginDispatch 复核失败时，先在事务内确认 review、policy、key，再提交停止状态，最后向调用者抛原错误；不能因事务回滚丢失 stop。后续进程在读取 Key、GET、POST 前拒绝旧批次。重新运行需要新的输入复核批次，旧批次不能恢复为 approved。

调用前的 schema/enable/auth/instance 失败、未批准/已停止/已完成批次、缺 Key、数据库或加密密钥不可用、持久化失败、全局 hold/policy 失败不触发该 stop。已知次数/用途/全局估算或本地预算不足时保持 approved，并由 availability 门保证 0 metadata/0 POST；门通过之后若另一进程抢占额度，最终 reserve 可以在一次 GET 后拒绝，但仍不会 POST。已派发响应的协议或规则失败停止批次；未知 usage、传输中断、无法确认的派发、错误路由或费用越界同时使授权进入 held，后续批次的 reserve/dispatch 也拒绝。不自动重试、换模型、换 provider、fallback 或追加 generation 查询。

## 6. 崩溃与显式恢复

| 可观察状态 | 保留的事实 | 允许的恢复 |
| --- | --- | --- |
| reserved，尚无 dispatch_started | 存在预留，但按照本契约尚无 POST 许可 | 操作者检查精确状态版本并明确取消；与 beginDispatch 争抢同一行锁，只有一个结果成立 |
| dispatch_started，缺少原始响应 | 请求可能已被服务商执行；次数已占用，费用未知 | 保留原 attempt 并 hold 授权；人工核账材料可追加，不释放次数、不重发模型 |
| 原始响应已留存，finish 未提交 | 响应及 SHA 可审查 | 显式从同一材料完成本地解析/结算；不触发网络 |
| finish 已提交，但调用者没收到结果 | 结算和材料已有完整记录 | 按同一 fingerprint 读取/重放结算，不产生新 attempt |

不采用租约超时后自动重新派发。未知费用的核账必须绑定受控的服务商回执/已保存响应、人工核账人、原因和材料 SHA；缺失或无效费用不能补 0。核账追加历史，不擦除原未知状态；解除 held 需要单独显式动作，并重验所有未知项、在途项和累计额度。即使确认未计费，已取得派发许可的次数仍不补回。

响应在进程崩溃前尚未完成持久化时，不能承诺恢复未落盘的原文；此时明确显示 `response_unavailable`，保持未知费用和派发记录，等待人工核账。

## 7. 原始输出受控留存

输入、人工预期、请求、能力快照、响应原文、结构化解析、usage 和错误材料分别有 artifact ID、类型、SHA、完整/部分/不可取得状态及来源 attempt。部分正文的 SHA 只表示已取得前缀，不伪装为完整响应 SHA。文本响应维持最多 2,000,000 bytes 的有限读取。

原文采用数据库内 AES-256-GCM 加密保存，密钥只由本地进程环境读取，不进入数据库、仓库或报告；AAD 绑定授权、batch、attempt、材料类型、来源摘要与 metadata 摘要，HTTP 状态和完整性标记不能被单独替换。请求 Authorization/header 从不保存；管理和运行入口在构造账本前登记当前环境中已知的 API Key、token、secret、password、credential、材料密钥及数据库 URL/解码后的密码，加密器也自动保护自身密钥。输入含已知凭据时拒绝创建批次；输出回显凭据时先脱敏再留存，并记录发生脱敏和原文摘要，不能仍声称保存的是未变动的原始字节。

普通 runner/stdout 报告只含状态、固定错误码、计数、费用、SHA 和材料 ID，不含输入正文、预期、原始输出、Key 或数据库 URL。原文通过显式本地审阅导出到受控目录，默认不打印，导出动作有审计；新管理进程也按当前已知敏感值检查旧材料，导出发生新的脱敏时更新副本摘要与 `redacted` 标记。创建导出目录前检查全部现有父目录，创建后复查并使用实际路径写入，拒绝 symlink/junction 跳转，同时允许 Windows 原生路径别名规范化。留存初始化或密钥不可用时，live 在 POST 前拒绝。

新 evaluation 传输器保留 HTTP 非 2xx 与非法 JSON 的有界原文，不改生产 `src/model-policy.ts` 的公开行为。HTTP 错误、截断、拒答、超时、路由不符、解析/规则失败均保存可取得材料；未知或无效 usage 继续为 null。

## 8. 本包的适配器边界与 dry-run 兼容

| purpose | 本包 live 行为 |
| --- | --- |
| fact_extraction | 复用既有请求 builder、schema、证据过滤和 evaluator；只有持久授权、完整 input-review、留存、当前端点能力及剩余额度全部通过才可取得许可 |
| formal_story / copy / layout / english_adaptation | 账本保留独立额度与材料契约；缺少经审查的正式适配器时返回 `PURPOSE_ADAPTER_NOT_READY` |
| representative_image | 同样拒绝 live，直到独立图片请求、视觉 token/价格预检、响应与素材校验适配器完成；不套用文本估算公式 |

旧 `plan-section` 是诊断草稿，不算正式故事，不消耗 formal_story 配额。未来适配器必须在自己的输入合同中实现真实上游签收门，并把合同版本和依赖引用绑定 manifest；本包不发明尚未冻结的业务阶段接口。

现有 `evaluate:offline` 和不带 `--live` 的 runner 输入、报告与零网络行为保持兼容。旧 live 调用缺少持久授权/batch/input-review 时明确阻断；不会从调用者布尔字段或已有环境开关推导批准。试验的 live 入口只有一个，不能另留无账本的内部 live 快捷路径。

生产 Startup、Worker、OpenRouter、Renderer 和 UI 均不在本包实现范围；不新增它们的调用能力或改变已合并业务行为。

## 9. 实现范围与完成判据

冻结后修改范围：`backend/evaluation/**`、相关后端测试与说明。复用已有 PostgreSQL/PGlite 和 Node crypto，不引入新依赖。真实 PostgreSQL 新用例由既有测试入口加载，使 CI 持久层检查实际执行。

| 验收 | 必须证明的结果 |
| --- | --- |
| dry-run / offline 兼容 | 旧样本与 CLI 通过，网络/凭据/账本写入为 0 |
| input-review | 缺授权、缺复核、拒绝复核、摘要或 adapter 改变都在 POST 前拒绝；预期答案不进请求 |
| 配额与费用边界 | text 12 / image 2；用途 3/3/2/2/2/2；route、token、超时及整数费用边界，不能跨用途借额或在新进程恢复余额 |
| 并发与幂等 | 两个真实 PG 连接/子进程竞争，唯一预留、最多一个派发许可；重放不再 POST；重复 finish 不重复计费 |
| create-once 与 effective hold | 同 ID 同政策幂等且不恢复余额；任一政策字段/SHA变化冲突；任一未结算派发在所有 reserve/beginDispatch/解除hold入口中都生效，经过任意时长也不自动释放 |
| 崩溃恢复 | 子进程在 reserve、dispatch、capture、finish 提交边界中断后，独立进程能审查/恢复本地状态；不能自动重试或补零 |
| 事务故障 | 结算/事件/回执任一持久化故障时没有部分计数；已记录派发不丢失 |
| 留存 | 成功、HTTP 错误、非法 JSON、部分正文、超时与 usage 未知可审计；原文加密与 AAD 校验；Key 不出现在材料、导出或普通报告中 |
| 默认与真实存储 | 默认合成测试、真实 PG 并发/重连/崩溃/预算边界；后端 types/build；独立 PR 给 Q |

所有模型协议验证使用注入的合成 fetch 与独立测试数据库，不调用真实模型。真实授权、AW 输入复核和图片质量验收仍由主工作流分别推进。

## 10. 冻结记录

主 Agent 已冻结以上全部边界，并明确追加 create-once 与跨进程 effective hold 两项验收。实现范围保持 evaluation 及必要的迁移/测试/说明，不修改生产 Startup/Worker/OpenRouter/Renderer/UI，不做 live/model call。

后续早审补充已进入实现与测试：管理身份和独立凭据、外部决定回执、runner 的不可伪造运行时实例标记、已停止批次关闭预留和派发，以及已取得原文的显式无网络恢复。命令与环境配置见 `AUTHORIZATION-OPERATIONS.md`。
