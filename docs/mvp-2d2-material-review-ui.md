# M2 2D2 素材用途审核界面

本包把 `backend/MATERIAL-USAGE.md` 的真实接口接入 `/arcane-warrior` 产品事实页。保留原有三栏布局、上传能力、独立手工文字证据和事实历史，新增逐块用途审核及事实来源重确认。

## 入口与接口

| 用户操作 | 接口 | 结果来源 |
|---|---|---|
| 待处理中心四类数量与任务 | `GET /api/projects/:id/production/material-reviews` | 服务端 tasks，按 projectId、projectVersion、revision 校准 |
| 原件逐块审核或纠正用途 | `POST /api/projects/:id/production/materials/:materialId/usage` | 明确的 blockId/usage 列表和 reason；不会确认事实 |
| 人工补充候选 | `POST /api/projects/:id/facts/candidates` | 只可选择当前有效产品证据，连续引用原文 |
| 逐条确认、拒绝或撤回事实 | `POST /api/projects/:id/facts/:factId/{confirm,reject,retract}` | 原状态与后端来源门控 |
| 已锁事实来源重确认 | `POST /api/projects/:id/facts/:factId/source/reconfirm` | 服务端 ready task 对应的同原件、同块有效新 evidence |
| 人工独立补证 | `POST /api/projects/:id/evidence` | 独立文字输入，不允许自报 materialSource 等派生字段 |

文字块可选产品证据或参考，已解码图片可选素材或参考。没有默认勾选，也没有批量确认事实操作；未选择的块不进入提交。多页选择按明确 blockId 保存。

用途纠正提交前，根据旧 projectionId 列出将撤回的产品证据、将失效的候选、需要来源重确认的已锁事实，以及受影响的章节和故事顺序。提交后展示 `usageReview.history` 的真实 changes 和 impact。恢复产品证据用途会创建新 evidence；旧候选不恢复。重确认保留 locked 值、原确认时间/人员和来源历史，也不恢复下游 freshness/approval。

## 会话与草稿边界

- `reviewWrite(kind, path, body, label, onSaved?)` 只允许 `review-requests.ts` 中的业务 kind 和完整正则路径；只迁移本包列出的人工审核操作。设置、模型运行和其他阶段沿用原 write。
- 复用 `tujiang_material_intake_v1` 的单 pending 槽，扩展 `MaterialOperation.kind = review`，保存冻结正文、版本、操作编号及请求前快照，不保存凭据或 callback。HTTP 前必须先成功持久化。
- 401、连接不确定、成功响应丢失或本地结算失败都保留原正文/编号。重开后只恢复记录；需输入凭据、GET 核对，再显式原编号重试。不会自动 POST。
- review 的 409 一律进入人工复核，不走上传的 parser-only rebase。业务 409 即使当前 revision 没变化，也要显式 GET 核对错误后才能恢复提交。
- 任务读取迟到、旧项目或旧 revision 均不能成为可写依据；提交 handler 再检查同步的最新项目 ref 与任务版本。
- 用途草稿按项目/原件、候选按项目/任务或纠错对象、事实原因与重确认按项目/事实分键。项目设置和 Facts 的手工补证表单分别保留本地草稿；原设置字段键兼容保留。
- 手工补证准备请求时按服务端语义去除资料名称、原文位置的首尾空白，正文逐字保留。即时成功回执据此清空当前入口的已提交草稿。
- 刷新后的恢复请求不含组件回调。若本项目当前可用的独立人工证据已经与表单的规范化名称、位置及完整正文一致，显示证据编号并禁止再次保存；handler 也检查最新快照。草稿保留供复核，只有明确点击才清空当前入口，另一入口的草稿保留。资料派生证据和已撤回证据不触发此提示。
- “已保存”提示不结算未决请求，也不改写旧 pending 正文。旧请求即使含首尾空白，仍须 GET 核对后显式使用原正文、原编号重放。
- SSE/GET 不覆盖本地输入。相关来源/身份/事实/依赖发生变化后需要明确复核；JSONB 对象键序变化不触发复核。成功旧回执在同一批次遇到更晚变更时，也不会清空新依据下需复核的草稿。

## 本地验证与剩余验收

`backend/test/material-review-client.test.ts` 使用真实 HTTP + PostgreSQL 语义兼容测试库检查用途、回执影响、四类任务、撤回/重确认、401/响应丢失/存储故障、白名单与恢复。实际 React 组件和 hooks 还覆盖首屏、按钮门控、草稿隔离与同批次快照竞态。此处 SSR 检查不等于真实浏览器验收，存储故障用可控内存实现注入。

交付前运行前端类型/ESLint、后端类型、相关客户端测试和 Vite 生产构建。主任务另在隔离 PostgreSQL 运行时检查真实浏览器的用途操作、展开布局、项目/任务切换、IndexedDB 重开恢复和错误操作。真实 AW 资料仍待用户审阅，不由本包选择 SKU、事实或材料用途；验收使用 synthetic 项目。
