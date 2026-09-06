# 阶段 A 前端独立代码/API QA

packet_id: `TUJIANG-FRONTEND-INTEGRATION-20260906-01`  
日期：2026-09-06。执行者：独立审阅 Agent `/root/contract_review`。仅修改本报告；实现修复由主 Agent 执行。

## 当前结论

**最终 PASS（独立代码/API 验收范围）。** 首轮发现三项缺陷，主 Agent 修复后已复验关闭。后端类型检查通过，自动测试 55/55 通过；项目/凭据及创建不确定结果的恢复入口已静态复核。本结论针对独立真实入口 `/arcane-warrior/stage-a`，不以未实现阶段 B 判定阶段 A 失败。原 `/arcane-warrior` 演示入口不作为真实业务证据。浏览器端到端结果由主 Agent 单独报告。

## 执行与环境

在 `F:/Project/tujiang-stage-a-integration/backend` 实际运行：

| 命令 | 首轮结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | FAIL，退出 1 | `stage-a-api.ts:1,2` TS2835（NodeNext 类型导入缺 `.js`）；`test/frontend.integration.test.ts:48` TS7006（关联类型失效导致参数隐式 any） |
| `npm test` | PASS，退出 0 | tests 55 / pass 55 / fail 0 / skipped 0；总耗时约 4.43 秒 |

新增两个测试真实启动本机 HTTP 服务，以生产 `StageAApi` 客户端访问 `buildApp`。数据库使用测试 PGlite，证据对象位于测试临时目录，结束后关闭服务和删除目录；Worker 注入合成 `generate`。因此证明真实 HTTP/API/领域/数据库流程，不是商业模型质量或生产 PostgreSQL 部署验收。未调用付费模型、未发送外部消息、未合并或部署。

本次审阅文件：`src/pages/ArcaneWarriorPage/StageAWorkbench.tsx`、`stage-a-api.ts`、`backend/test/frontend.integration.test.ts`、测试 fixture，并复用 `docs/frontend-review.md` 的 Stage A 边界。浏览器截图、布局、点击链路由主 Agent 单独实测，本报告不冒充浏览器 QA。

## 首轮发现（已即时报告实现任务）

| ID | 级别 | 位置及复现 | 预期 |
| --- | --- | --- | --- |
| QA-01 | P1 | `stage-a-api.ts:1–2` 类型导入没有 NodeNext 要求的 `.js`；后端 typecheck 必现失败 | 兼容前端 bundler 与后端 NodeNext；独立重跑 typecheck 通过 |
| QA-02 | P1 | `StageAWorkbench.tsx` 的 refresh 使用可编辑 projectId；常规读取按钮限制已加载项目ID变化，但 pending/conflict 恢复区调用 refresh 绕过该限制。A 写入不确定/409 后将输入改 B，再点恢复读取，accept 会载入 B，A 的 chapters/纠错 ID 留在表单；pending.run 仍可能回放 A 请求 | 所有恢复读取固定原操作所属项目；页面会话禁止切换，或完整清理草稿/待处理/权限且忽略迟到旧响应。不能仅限制一个按钮 |
| QA-03 | P2 | token 输入可在 busy/pending 时更改；pending.run 闭包捕获旧 StageAApi，重试使用旧 token；runConsent 仅随 project.id 重置 | 会话内锁定凭据或实现显式会话切换；未完成请求不能跨凭据恢复，模型同意不能无提示继承到不同凭据 |

## 能力与边界验收（首轮结果，修复关闭状态见末尾）

| 检查 | 判定 | 证据与限制 |
| --- | --- | --- |
| 未确认事实不能进入规划 | PASS（API） | 既有 planning/Stage A 测试覆盖无身份、无确认核心事实、未确认引用。UI canPlan 检查身份、confirmed core 与冲突；人工顺序绑定列表仅 confirmed。服务端继续校验引用，前端不是唯一门槛 |
| 事实纠错不改锁定原值 | PASS | 新 HTTP 测试保存 `correctsFactId` 候选后断言原值仍为 10 kg、新候选未确认；既有测试覆盖冲突、原文校验、拒绝、撤回与精准 stale |
| 冲突请求暂停并复核 | PASS（API）/待修复会话边界 | 新 HTTP 测试旧版本写入返回 VERSION_CONFLICT，GET 恢复最新快照；UI 清 pending、暂停写入、保留表单、展示前后快照，差异复核后才恢复。QA-02 影响恢复所属项目 |
| 显式候选应用 | PASS | 人工顺序后模型完成，断言 storyboard ID 不变、currentSectionId 仍 null；显式 apply 后才有当前诊断稿。UI 独立候选按钮需 reason 与 current 候选/关联稿 |
| 无后台自动模型调用 | PASS（静态 + 传输测试） | UI useEffect 仅清 runConsent；没有自动提取/规划/轮询。提取、规划、人工运行重试需显式按钮及勾选；StageAApi 不自动重试。新测试传输失败只调用一次 fetch，redirect=error |
| 不正式批准/导出 | PASS | UI 第4–6阶段说明范围并禁用设计确认、市场适配、批准下载；真实 API 无对应入口。HTTP 测试预检后 exportAllowed=false；后端 preflight 列明 notChecked |
| 幂等回放 | PASS（API） | 新 HTTP 测试同 key 回放 identity/correct 返回完全相同快照；既有测试覆盖换内容复用 key 冲突与并发单赢家。UI 不确定请求保留原 key/请求闭包，仅人工回放；QA-03 限制凭据变化场景 |
| 凭据存储及发送 | 部分 PASS | token 仅 React 内存；localStorage 仅 projectId；同源 `/api`，禁止跟随重定向，没有任意远端地址输入。但旧闭包会话边界见 QA-03 |
| 项目切换 | FAIL（首轮） | 常规按钮有限制但恢复入口绕过，见 QA-02 |
| 动态顺序与人工草稿 | PASS（静态/API） | 章节增删排序、1–50章、每章1–20事实；服务端最多50；刷新 accept 不替换 chapters，人工 loadStory 明确载入；模型结果无静默覆盖 |

## 未纳入已完成范围

- 当前 UI 只读显示诊断 Section；后端 `/sections/:id/draft` 和 `/sections/:id/select` 已测试，但页面暂未提供编辑/历史选择控件。只能称前三阶段核心接入，不称所有阶段 A API 都已有可操作 UI。
- ProductBrief、PDF/图片解析、RulePack、CanvasProfile、父子章节、正式 SectionSpec、Renderer、市场版本和文件级 QA 未实现，页面已明确列出；这些不作为本次阶段 A 接入缺陷。
- 预检结果原样展示含 checkedVersion/checkedRevision；没有正式导出路径。未来展示摘要时仍需防止旧预检被误称为当前全部通过。
- 新增传输测试标题虽含“显式回放”，测试体仅验证单次失败及 redirect；真正幂等回放证据来自第一个新增 HTTP 测试及既有服务端测试，不夸大单测覆盖。

## 复验记录

第二轮已实际运行 `npm run typecheck`，退出 0；`npm test` 再次退出 0，55/55 通过、无跳过（约 3.76 秒）。`.js` 类型导入修复，QA-01 关闭。

最终静态复查确认：refresh 优先使用已加载 `project.id`；token 和 projectId 在 busy/pending/已加载项目时禁用；更新凭据或切项目必须重开页面。因此旧请求闭包无法在同页跨凭据恢复，QA-03 关闭。`StageAWorkbench.tsx:73` 的 refresh 还在 pending 且无 project 时直接返回；第98行恢复读取、第107行普通读取均禁用此情形。已移除可直接结束未知写入结果的按钮，创建结果不确定时需以同幂等键重试，不能改读本机旧项目后切换回来。QA-02 关闭。这些最终 UI 条件属于静态复核，未声称已由组件自动测试或浏览器复現覆盖。

最终状态：QA-01 CLOSED / QA-02 CLOSED / QA-03 CLOSED；本轮独立代码/API 范围无未关闭 P1/P2。新增浏览器修复若改变上述状态路径，应重新进行对应检查；无需仅因阶段 B 未实现重复扩展测试。

另记录主 Agent 的必要启动修复：`src/components/ui/image.tsx:6–17` 将 fallback SVG 文本改为 ASCII 数字实体，避免模块初始化时 `btoa` 对中文抛错，同时保留“加载失败”的渲染文字。README 第50–55行将内置 UI 目录列为勿修改；此处是主 Agent 为本任务页面可启动执行的最小例外，不是独立 QA 擅自编辑，也没有扩展 UI 设计。浏览器异常复现与修复后的页面验收由主 Agent记录，本报告仅静态核对修订。
