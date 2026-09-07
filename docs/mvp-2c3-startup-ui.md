# M2 2C3 项目启动与事实提取入口

本包在原岳凯工作台的连续五区 Setup 中消费 `backend/STARTUP.md` 与 `startup.1` 契约。底部主按钮为“创建项目并开始事实提取”，右侧使用真实服务端检查；首次成功启动回执对齐后进入产品事实页。后端 startup 业务域由 2A3 提供，本包未修改后端写入、规则或提取任务契约。

## 连续表单与启动路径

产品基础信息、产品资料、平台与站点、本地化配置、页面尺寸始终同时渲染；左侧锚点只滚动。项目尚无服务端 ID 时使用稳定本地 namespace，允许填写表单和选择原件。连接凭据仅在当前页面内存保存，选择文件不触发 HTTP。

| 用户动作 | 请求与结果 |
|---|---|
| 第一次明确上传原件 | 串行 create → initialize → upload；创建回执确认 ID 后原子绑定本地 File。已有未初始化项目复用原 ID。初始化不确认身份、不启用 P、不创建 startup 或提取 run |
| 点击底部主按钮 | 复用已确认 ID，必要时 create / initialize；使用点击时的当前输入重新执行只读 check。不会隐式上传本地排队文件 |
| check 有 blockers | 展示完整服务端具体原因，定位对应配置或 Facts；没有 start、P、startup 或 run 写入 |
| check 可以启动 | 按该次 R、输入 fingerprint 和当前完整 context 提交 start；成功回执与当前项目、namespace、凭据和输入对齐后消费一次，进入 Facts |
| 解析中或待用途审核 | Facts 展示持久化等待状态、固定原件范围和前置事项；解析、用途决策、GET 和恢复页面均不隐式排提取任务 |
| 已具备提取条件 | 明确点击“继续本次事实提取”，只继续原 startup 固定范围 |
| 任务失败 | 只有服务端返回已有 `retryRunId` 时显示原任务重试，复用既有 run 重试入口 |
| 新增资料不在本次范围 | 显示具体新增和保留来源，要求填写原因、核对当前 proposal fingerprint 后明确 scope-refresh；原失败来源与历史保留，完成后仍需明确继续提取 |

右侧将 blockers、suggestions 和 extraction prerequisites 分组；必填项、已接收原件、可用产品证据、图片素材、待解析、待审核与解析失败均取服务端统计。保留规则 ID / scope 对应的具体提示，不以百分比代替来源可用性。`configured`、`synthetic` 和 Worker 实际预检状态分别显示；不会把配置存在称为真实模型已就绪。

## 持久化与请求恢复

`setup-recovery.ts` 与现有原件队列共用 `tujiang_material_intake_v1` IndexedDB 的 `entries` / `pending` 存储。有限 setup action、当前 namespace、原 before 快照、表单及模式备份和冻结请求正文在 HTTP 前保存。共用 active slot 阻止 setup / 原件写入互相跨越；正文只接受该动作的白名单字段，不保存凭据。

create 回执确认、namespace 到服务端 ID 的 File 绑定、flow 快照与 pending 清除在一个本地事务内完成。create 回执丢失时未知 ID 保持未知，读取只查询项目列表；不会按名称认领项目或猜测 GET ID。手动重放原请求由原 idempotency key 获取结果；重放单个步骤不会继续后续步骤。

401、请求或回执丢失、无效响应、回执本地落盘失败均暂停并保留原 body/key。重开不自动写入；重新提供凭据、只读核对后才允许明确重放。明确 4xx 拒绝标记与原请求一起持久化，重开后仍禁止重试原请求；只读核对并点击“已复核失败原因”释放后，才能用最新快照和新 key 明确重新提交。HTTP 前存储失败则 0 HTTP，当前页面保留冻结请求，恢复存储后重试原 key。

制作配置与规则类型备份各自保存单调递增的输入修订，冻结请求同时记录这两个修订。恢复时采用较新的记录，因此 localStorage 旧值可读但新输入写入失败时，IndexedDB 中较新的请求捕获仍能恢复原输入；完成流程后继续编辑的较新本地草稿也不会被旧 flow 覆盖。旧格式按修订 0 处理；相同修订但内容不同会同时展示两份内容，要求明确选择，选择不会修改未决请求的正文与 key。

上传沿用已验收的单次 parser-only revision rebase 例外；create / initialize / start 不继承该例外。业务字段变化的上传 409 将原 before、body/key 与冲突原因一起持久化，并保留原 File。重开、只读 GET 或点击重试都不会释放写入；明确复核后，清除冲突与将 File 置为待上传状态在同一个 IndexedDB 事务完成。释放落盘失败则继续保留阻断。

Setup 明确拒绝的请求展示失败 code、动作、原 P/R、操作编号、冻结输入和修订、完整请求正文；读回后同时展示原快照与当前快照的实际业务差异。创建尚无 ID 时显示冻结名称并仅读取项目列表，不按名称认领结果。

回执、GET startup 和 check 中的 existingStartup 除核对 envelope 的项目 ID / P / R，还关联 `project.production.startup` 的 ID、contextVersion、inputFingerprint、提交信息、run / retry ID、run 状态、固定来源、run evidence 及追加资料范围。合法形状但关联不符的状态不会标为 current，并显示无效响应。切换项目在 GET、读取 flow 和持久化选择各个异步边界核对凭据、原 scope 与卸载状态；取消会中止尚未完成的选择事务，保留原项目及草稿。晚到 create、File、GET、check、旧 namespace 回调和较晚输入均不会推进当前错误项目；成功启动回执在 Session 中消费，恢复子树重挂载不会二次导航。

## 已执行验证与交接边界

`startup-client.test.ts` 使用真实 loopback HTTP / PGlite 校验 API 形状、响应关联、有限动作白名单和恢复执行器。`startup-hooks-client.test.ts` 使用实际挂载的 Session / Context / Intake / Startup / Status hooks、真实 API、实际 IndexedDB 存储类和 fake-indexeddb；scope-refresh 用实际 `StartupFactsPanel` 的输入及按钮回调，恢复比较使用实际 `ContextControls` 与 `SetupRequestReview`。两组共 86 项用例，纳入完整后端测试，其中挂载组为 63 项。

已通过：

- 根目录 `npm run lint`：前端 typecheck 与 ESLint 通过；仅两个既有无效 eslint-disable warning。
- 根目录 `npx vite build`：生产构建通过；保留既有 chunk-size / inlineDynamicImports warning。
- `backend` 的 `npm run typecheck`、`npm run build`、`npm test`：通过，完整测试 292/292。
- create / initialize / upload / start 的 401、409、回执丢失、无效响应、本地 settlement 失败；原 body/key 保留、重开 0 自动业务 POST 和显式恢复。
- 首次本地输入与 File、首次上传唯一 create / initialize、主按钮不上传队列文件、无来源阻断、旧项目 ID 复用、IndexedDB 失败与 localStorage 不可用恢复。
- startup 成功前后一次导航、合法形状但不匹配的回执拒绝、迟到 create / File / GET、凭据与输入变化、scope proposal 变化后的旧回调阻断、只明确补充范围且 0 隐式排队。
- GET / check 内层状态的 19 种形状合法篡改均不能成为 current 或触发 start；项目切换在 GET / readFlow / selectScope / unmount 边界取消后保留原项目、草稿和持久化选择。
- localStorage 旧值可读但写入失败时恢复较新的 form 与模式备份；普通后续编辑优于旧 completed flow；相同 revision 与旧格式歧义展示双份内容并分别确认，不改变冻结请求。
- Setup 409 的复核依据与真实 before/current 差异可见；上传 409 重开后需先 GET 再实际复核，释放落盘失败及再次重开仍阻止上传，成功释放后才允许使用新 key 明确提交。

这些是客户端挂载与服务端回归测试，fake-indexeddb 不替代真实浏览器存储、布局或真实 PostgreSQL 验收。主任务继续以隔离 PostgreSQL 和合成规则完成浏览器验收，并汇总 Q 审查。本包没有真实模型调用、费用消耗、AW 资料用途或 SKU / Facts 放行决定，也不代表后续 Facts 整页布局与正式放行门已交付。
