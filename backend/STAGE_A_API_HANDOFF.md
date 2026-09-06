# 阶段 A API 交接（FLEX 扩展，产品契约 rev61）

本轮以真实 API 与用户逐条人工确认验收后端链路。新前端未就绪；没有接旧五步向导，没有阶段 B 批准、SectionSpec、Renderer 或导出。结构正确不等于商品声明已核实，purpose 文本仍由人复核是否混入广告内容。

## 公共协议

所有路径前缀 `/api/projects/:id`；除 health 外需 Bearer，单操作者由服务端 BACKEND_ACTOR_ID 配置。任何自报 actor/approved/locked 等额外字段均返回 400 INVALID_REQUEST。所有新增 POST 返回 200 完整 Project 快照，携带当前 version/revision、audit 和对象历史引用。GET /api/contracts 的 requests 提供全部 JSON Schema。

每个写请求都有 expectedProjectVersion（非负整数）、expectedRevision（非负整数）、idempotencyKey（8–128字符），新增人工操作均需 reason（1–1000字符）。引用 ID 为 UUID。幂等重放返回原响应；换内容复用 key 409 IDEMPOTENCY_CONFLICT；旧版本返回 409 VERSION_CONFLICT / REVISION_CONFLICT，details包含当前值。遇到冲突先 GET 复核，不能自动用最新版本覆盖。

例：以下是事实纠错请求体，其公共字段也适用于其余新入口。示例 ID/版本必须换成实际 GET 值。

```json
{
  "expectedProjectVersion": 3,
  "expectedRevision": 8,
  "idempotencyKey": "human-correction-0001",
  "reason": "逐条复核原文，补充另一候选值",
  "attribute": "capacity",
  "role": "core",
  "value": "20 kg",
  "evidenceId": "00000000-0000-4000-8000-000000000001",
  "quote": "20 kg",
  "correctsFactId": "00000000-0000-4000-8000-000000000002"
}
```

## 新入口

| POST 后缀 | 公共字段外的请求字段 | 前置条件与结果 |
| --- | --- | --- |
| `/facts/candidates` | attribute、role=core/supporting、value、evidenceId、quote、可选correctsFactId | quote必须是本项目product_evidence中的精确连续原文；保存新的candidate及createdBy/reason；不锁定、不改旧值。纠错关联本身会产生显式冲突，即使属性名称改变。 |
| `/identity/correct` | productName | 已首次确认身份；仅用于同一商品身份文字修正。保留旧revision及审计reason；identityRevision增加，所有依赖身份的顺序/Section变stale。不得作为换商品接口。 |
| `/storyboard/draft` | chapters=[{role,purpose,factIds}] | 1–50章，数组顺序就是章节顺序；role为identity/feature/evidence/usage。所有事实confirmed且无冲突。保存人工当前顺序，旧顺序保留于历史；原当前Section变stale，需人工编辑适配或选择新的模型候选。 |
| `/sections/:sectionId/draft` | purpose、factIds、missingInputs | 被编辑Section存在；当前顺序current，事实confirmed且属于当前顺序。创建新的人工Section并选为currentSectionId；replacesSectionId关联旧稿，旧稿内容保留。可以修复旧stale稿，但必须重新提交目的/引用/缺口并复核当前依赖。 |
| `/storyboard/candidates/:candidateId/apply` | 无 | 显式选取模型候选顺序及其关联Section；重新检查当前身份revision、全部事实及freshness。两者原子应用，保留之前人工稿历史。candidateId来自storyboardCandidates数组。 |
| `/sections/:sectionId/select` | 无 | 选择历史Section；必须current、依赖仍有效且storyboardId属于当前顺序。预检随currentSectionId改变。不能用旧stale稿绕过撤回或身份纠正。 |

候选事实值限1000字符，quote限2000字符；attribute限100。章节purpose/Section purpose限300字符，factIds 1–20，missingInputs最多20项且每项300字符。保存事实补充与纠错不等于确认，后续仍逐条走既有 `/facts/:factId/retract|reject|confirm`；没有批量入口。保留原已确认值可拒绝新候选；替换原值需明确逐条撤回旧事实，再逐条确认新候选。

## 当前稿、失效与历史

- 第一版模型顺序/Section可以初始化当前稿；已有当前稿后，模型完成只向storyboardCandidates/sections追加，绝不静默选中。storyboard是当前顺序的快照，sections是可查看的草稿集合，不按最后一项隐式决定当前对象。
- 手工顺序保存后，其原当前Section变stale。人工提交适配当前顺序的新Section即可修复；后续模型候选要用明确apply入口才替换当前顺序/Section。
- 事实撤回只标记引用该事实的Section和候选顺序stale；未引用的Section内容和状态不变。冲突仍为独立issueSeverity；新增未解决冲突会阻断预检及规划，不能自动替换锁定事实。
- `/qa/preflight`检查currentSectionId、当前顺序freshness、缺口、引用证据和冲突。旧stale草稿仍可看；选中新有效草稿后可恢复预检。永远exportAllowed=false；不执行正式批准、市场规则、渲染文件或素材质量验收。
- 新状态以currentSectionId=null明确表示尚无选择，候选Section即使存在也不能被预检自动采用；此时返回SECTION_SELECTION_REQUIRED。只有字段完全缺失的stage-a.1旧快照才按旧行为读取最后一个已有Section，下一次规划追加或人工顺序保存前固化旧选择（没有旧Section则写null）。旧storyboard/Section双方缺少ID时，还必须同sourceRunId且全部事实引用属于当前顺序；两个缺失ID本身不证明归属。首次人工编辑旧Section会为当前顺序补上ID，同时仅给同sourceRunId、事实引用匹配且尚无归属ID的旧Section补同一ID，保留原内容和freshness，使合法历史可重选；不同生成不获得归属。此次元数据补齐记入storyboard.legacy_ids_assigned审计，旧revision仍不可变，后续新稿使用明确归属。无需SQL迁移。
- GET `/revisions/:revision`恢复任意历史只读快照；恢复内容需通过新的人工保存/选择命令，不能改写历史行。所有保存包含编辑者、reason，状态保存与业务批准分开。

## Revision / Version

revision在每次命令、Worker领取/完成及观测追加时增加，用于API并发、幂等和不可变快照。Worker另外记录inputRevision/contextInputRevision作为输入并发标识：API命令和业务提交仍推进inputRevision，迟到usage观测只推进revision，不会使已启动的新attempt假报STALE_INPUT。真实身份、事实、证据或人工草稿变化仍失败；旧运行没有contextInputRevision时保留原严格contextRevision检查。该内部标识不是新增业务Version。保存候选、人工顺序/Section、选择或预检不改变version。拒绝候选改为仅推进revision。确认/撤回已确认事实推进version；首次身份确认与身份文字纠正也推进兼容聚合version。stage-a.1 version仍为聚合兼容标识，本轮没有完整实现Project/Facts/Storyboard/Section等独立业务Version，不能如此展示。

## 常见业务错误

400 INVALID_REQUEST；404 FACT_NOT_FOUND / SECTION_NOT_FOUND / CANDIDATE_NOT_FOUND；409 INVALID_EVIDENCE_REFERENCE、UNRESOLVED_FACT_CONFLICT、UNCONFIRMED_FACT_REFERENCE、CONFIRMED_PRODUCT_IDENTITY_REQUIRED、CONFIRMED_CORE_FACT_REQUIRED、CURRENT_STORYBOARD_REQUIRED、SECTION_OUTSIDE_STORYBOARD、STALE_STORYBOARD、STALE_SECTION。预检issues另包含SECTION_SELECTION_REQUIRED和SECTION_OUTSIDE_STORYBOARD:sectionId，未选择或归属不符不能放行。run使用既有queueStatus与四维状态，失败码不会混入业务状态枚举。

## 正式运行配置与观测

.env.example只含示例，无Key或启动授权。必须明确OPENROUTER_MODEL（或Skill专用模型）、OPENROUTER_PROVIDER、MAX_INPUT_TOKENS/MAX_OUTPUT_TOKENS/MAX_COST_USD（均OPENROUTER_前缀）和OPENROUTER_ACCEPT_ESTIMATED_BUDGET=true。网关不读取额外凭据；进程配置由启动环境提供。OPENROUTER_TIMEOUT_MS覆盖整个元数据查询、生成及正文读取，最大90秒；body最大2MB。每attempt最多一次生成，无fallback、redirect和自动重试。

AgentRun.observations数组每attempt保留requestedModel/requestedProvider、actualModel/actualProvider、请求ID哈希、输入请求哈希、能力快照哈希、dispatched、latencyMs、inputTokens/outputTokens/costUsd、estimatedCostUsd、finishReason、可选errorCode。缺失值为null，真实零费用为0；失败HTTP/网络不存服务商正文。业务JSON非法或Domain并发提交失败，也保留已有usage；模型生成成功但提交失败时保留业务output供复核，绝不应用。迟到结果只补观测，不改变业务状态。人工重试同runId增加attempt，旧观测与旧输出revision保留。

网关失败码包括MODEL_NOT_CONFIGURED / MODEL_POLICY_NOT_CONFIGURED、MODEL_TIMEOUT、MODEL_RATE_LIMITED、MODEL_HTTP_ERROR、MODEL_NETWORK_ERROR、RESPONSE_TOO_LARGE、INVALID_MODEL_OUTPUT、RESPONSE_ROUTE_MISMATCH、MODEL_OUTPUT_TRUNCATED、MODEL_REFUSAL、USAGE_UNKNOWN、INPUT_ESTIMATE_EXCEEDS_LIMIT、ESTIMATED_COST_EXCEEDS_BUDGET、OBSERVED_TOKEN_LIMIT_EXCEEDED、OBSERVED_COST_EXCEEDED及能力预检码。失败后需人工决定，不能自动换模型或重试。实际账单可能发生，未知usage不能当免费；总试用次数/总费用由控制中心运行计划另外累计。

公开端点纯文本定价规则和Gemini EU快照说明见MODEL_CAPABILITIES.md。runner默认离线零请求、human-curated人工来源边界保留；本扩展没有真实模型质量成绩或业务确认。
