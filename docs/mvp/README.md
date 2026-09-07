# 完整 MVP 执行台账

启动：2026-09-06；D1 为首个实施工作日。产品基线为飞书[功能与交互契约 revision 61](https://oriniture.feishu.cn/docx/EQzNdi9Szo7T1DxsIEMc2ku4nie)与[端到端流程 revision 15](https://oriniture.feishu.cn/docx/XHktdDPkKoTPbvxytjKcEfCanPg)。代码起点 `930086ddfc85629f36cdba60bd87ad29d050e14c`。

用户批准的终点是本地完整生产闭环：真实资料、人工事实基线、正式故事线、章节制作、不同语言市场适配、QA、批准与下载。六阶段界面继续使用岳凯工作台。62 个工作日为初始估算，另预留 12 日缓冲，不以日历等待代替当前可完成的工作。D10、D29、D44 根据已验收工作重估。

## 状态与完成口径

任务状态：待开始 → 进行中 → 待集成 → 待验收 → 已完成；依赖材料缺失记为受阻。代码检查、合成业务联调、真实 PostgreSQL 验证、真实业务签收分别记录。任何一种证据不能代替其他证据。

| 包 | 负责人 | 状态 | 输出与验收 | 计划窗口 |
| --- | --- | --- | --- | --- |
| 0A/0B | 主 Agent、A、B | 进行中 | 契约决策、业务输入清单、页面状态与接口映射 | D1–D3 |
| 0Q | Q | 进行中 | 工程验收矩阵已建立；AW FLEX 真实样本已读，预期事实与质量签收待补 | D1–D3 |
| 1A | A | 已完成 | [PR #7](https://github.com/Backctrl/tujiang-ai/pull/7)；正式对象空底座、显式初始化、兼容与项目列表 | D4–D10 |
| 1B | B | 已完成 | [PR #8](https://github.com/Backctrl/tujiang-ai/pull/8)；项目切换、SSE、草稿隔离和恢复；[M1 验收记录](verification/m1.md) | D4–D10 |
| 2A1 | A | 已完成 | [PR #9](https://github.com/Backctrl/tujiang-ai/pull/9)；部分配置草稿、不可变上下文及跨项目规则版本；完整启动链仍依赖 2A3 | D11–D20 |
| 2B1 | A | 已完成 | [PR #11](https://github.com/Backctrl/tujiang-ai/pull/11)；原件、确定性解析、定位与单文件恢复；[M2 分包记录](verification/m2.md) | D11–D20 |
| 2B2 | A | 已完成 | [PR #14](https://github.com/Backctrl/tujiang-ai/pull/14)；用途纠正、来源追溯与重确认，114 项后端／13 项真实 PostgreSQL 及独立审查通过 | D11–D20 |
| 2C | B | 已完成 | [PR #12](https://github.com/Backctrl/tujiang-ai/pull/12)、[#21](https://github.com/Backctrl/tujiang-ai/pull/21)、[#25](https://github.com/Backctrl/tujiang-ai/pull/25)；配置版本、连续五区、支持组合、真实上传与原子启动的整页恢复链通过独立审查、真实 PostgreSQL 与浏览器 | D11–D20 |
| 2D1 | B | 已完成 | [PR #15](https://github.com/Backctrl/tujiang-ai/pull/15)、[窄栏修复 #16](https://github.com/Backctrl/tujiang-ai/pull/16)；真实上传、持久恢复、AW 原件与 Facts 窄栏操作均通过独立验收 | D11–D20 |
| 2D2 | B | 已完成 | [PR #20](https://github.com/Backctrl/tujiang-ai/pull/20)；四类用途／提取／事实／来源重确认任务、局部影响、草稿隔离及重开／409 恢复通过 Q；完整 Facts 页仍待 3A/3C | D11–D20 |
| 2A2 | A | 已完成 | [PR #18](https://github.com/Backctrl/tujiang-ai/pull/18)；范围化规则、历史兼容和只读检查通过独立审查、真实 PostgreSQL 与浏览器；完整目标编辑归 2C2 | D11–D20 |
| 2A3 | A | 已完成 | [PR #22](https://github.com/Backctrl/tujiang-ai/pull/22)；服务端检查、原子启动、冻结输入、范围刷新与显式恢复；195 项默认／19 项真实 PostgreSQL 及三平台 CI 通过 | D11–D20 |
| 2C2/2C3 | B | 已完成 | [PR #21](https://github.com/Backctrl/tujiang-ai/pull/21) 修复完整支持组合，[PR #25](https://github.com/Backctrl/tujiang-ai/pull/25) 接通首次上传、真实启动、刷新重绑与冲突恢复；297 项默认／19 项真实 PostgreSQL 及真实浏览器通过 | D11–D20 |
| 3A1 | A | 进行中 | 多来源、规范值、适用范围与风险复核实现正在按独立对抗审查补强；合并前仍需真实 PostgreSQL 和下游 fail-closed 复验 | D21–D29 |
| 3A2/3B | A | 待开始 | Facts 基线、正式动态故事结构与批准 | D21–D29 |
| 3C/3D | B | 待开始 | 缺口闭环、章节规格、事实与素材绑定 | D21–D29 |
| 4A/4B | A | 待开始 | 章节命令、锁、布局候选与母版批准 | D30–D44 |
| 4C1 | C | 已完成 | [PR #19](https://github.com/Backctrl/tujiang-ai/pull/19)；固定浏览器下两帧合成样本连续三次 HTML／布局／像素／PNG 一致，缺图、字体与溢出检查通过 Q；正式章节、导出和真实视觉质量尚未验收 | 可提前并行；原 D30–D44 |
| 4C2 | C | 待开始 | 接正式章节、完整样本与预览流程 | D30–D44 |
| 4D | B | 待开始 | 原画布接编辑、锁定、布局差异和确认 | D30–D44 |
| 5A/5B | A、B | 待开始 | 一个不同语言市场的派生版本与批准 | D45–D52 |
| 6A/6B/6C | A、B、C | 待开始 | 正式 QA、文件、Manifest、批准与下载 | D53–D62 |
| 6Q | Q、业务负责人 | 待开始 | 全链路、真实语义、恢复、确定性及局部失效验收 | D53–D62 |

## 当前派发

| 任务 | 分支与独立目录 | 允许修改 | 验证与合并 |
| --- | --- | --- | --- |
| 集成／台账 | `codex/mvp-m2-integration`，`F:/Project/tujiang-ai/03-runtime/tujiang-mvp-integration` | 执行资料、集成、CI | 主 Agent 集成；Q 验收 |
| 1A | `codex/mvp-1a-domain-foundation`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-backend` | 后端源码、测试及后端说明 | 类型、旧回归、新兼容／版本测试；独立 PR |
| 1B | `codex/mvp-1b-project-session`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-frontend` | 原工作台、客户端及相关客户端测试 | 前端检查、真实 HTTP、浏览器会话测试；独立 PR |
| 2A | `codex/mvp-2a-project-context`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-context` | 后端上下文、规则注册表和迁移 | 已合并 PR #9；独立审查及真实 PostgreSQL 通过 |
| 2B1 | `codex/mvp-2b1-file-ingest`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-ingest` | 后端文件、解析队列、定位及相关测试 | 原件哈希、失败隔离、Worker 恢复及真实 HTTP；独立 PR |
| 2C | `codex/mvp-2c-project-setup`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-setup` | 原设置区、客户端会话与相关测试 | 真实后端浏览器、冲突恢复、历史只读；独立 PR |
| 2B2 | `codex/mvp-2b2-material-usage`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-usage` | 后端用途审核、来源状态与相关影响 | 合同 `backend/MATERIAL-USAGE.md`；独立 PR |
| 2D1 | `codex/mvp-2d1-material-upload`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-materialsui` | 原资料区域、上传队列与持久恢复 | 真实原件、断连／重开／401／409；独立 PR |
| 2D1 窄栏修复 | `codex/mvp-2d1-facts-material-layout`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-materialsui-fix` | Facts 资料列表局部排版 | 多卡、展开来源／候选、下载／分页；独立修复 PR |
| 2D2 | `codex/mvp-2d2-material-review`，`F:/Project/tujiang-ai/02-development/tujiang-mvp-usageui` | 原待处理中心、用途与来源审核、有限持久请求 | 真实后端、来源约束、409／重开恢复；独立 PR |
| 2A2 | `codex/mvp-2a2-scoped-rules`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-rules` | ScopedRulePack、兼容快照、只读范围检查 | min/max/exact、范围隔离、版本不可变与真实 PostgreSQL；独立 PR |
| 2A3 | `codex/mvp-2a3-project-startup`，`F:/Project/tujiang-ai/02-development/tujiang-mvp-startup` | 后端启动检查、输入冻结、显式继续及相关契约 | 默认不配置模型仍给出真实阻断／建议；原子性、幂等与输入范围验证；独立 PR |
| 2C2 | `codex/mvp-2c2-scoped-setup`，`F:/Project/tujiang-ai/02-development/tujiang-mvp-scoped-setup` | 原 Setup 连续五区、完整目标选择及局部集成 CSS | 对照用户功能与分布参考，真实后端组合与草稿恢复；独立 PR |
| 2C3 | `codex/mvp-2c3-startup-ui`，`F:/Project/tujiang-ai/02-development/tujiang-mvp-startup-ui` | 原 Setup 首次上传、启动、恢复和客户端会话 | 已合并 PR #25；真实 HTTP／PostgreSQL／IndexedDB／浏览器与刷新凭据重绑通过 |
| 3A1 | `codex/mvp-3a1-fact-sources`，`F:/Project/tujiang-ai/02-development/tujiang-mvp-fact-sources` | 结构化事实来源、规范值、适用范围、风险复核与下游闸门 | 独立攻击复现必须成为回归；旧入口与持久化篡改一律 fail-closed；独立 PR |
| 4C1 | `codex/mvp-4c1-renderer-foundation`，`F:/Project/tujiang-ai/04-archive/tujiang-mvp-renderer` | 独立 Renderer 与测量；不改业务批准和原工作台 | 合成章节、固定字体／素材、连续三次渲染；独立 PR |

所有 Agent 不回退其他人的修改，不修改其他目录。公共契约由 A 维护、前端 API 与会话由 B 维护、共享 Renderer 由 C 维护。Q 不实现后再自审；C/Q 轮换第三个执行席位。每次合并前记录最终提交、审查结论和对应验证；不强制覆盖未提交文件。

2026-09-07 用户指出 Setup 的实际功能分布与已确定参考不一致。此前验证覆盖了配置保存和恢复，却没有覆盖中间连续表单及最终启动交互；据此重新打开 2C 和 Setup 整页验收，不以此前局部截图或接口通过替代。补齐标准见 [D005](decisions.md#d005setup-功能与分布重验)。PR #21、#22、#25 随后补齐连续表单、支持组合、服务端原子启动及刷新重绑，整页工程验收记录见 [M2](verification/m2.md#2a32c22c3-整页收尾)。

同日用户补充产品事实页的功能分布参考。2D2 仅验收资料用途与事实来源处理；完整 Facts 页仍依赖 3A1/3A2 与 3C1 的多来源对照、缺口、Agent 解释和正式事实版本放行。提取记录归左栏，统一队列与来源对照归中区，右栏绑定当前事实展示解释、影响和确认动作，见 [D006](decisions.md#d006产品事实页功能分布与正式放行)。

本地工作目录已按用户要求统一放入 `F:/Project/tujiang-ai`：主仓库在 `01-main`，开发分支在 `02-development`，集成／运行／验收在 `03-runtime`，已结束阶段在 `04-archive`。迁移前后 8,174 个纳入清单的文件 SHA-256 与 26 个 Git 目录状态一致，30 个 worktree 关系及 42 个依赖目录联接完成核验；业务原件、未提交文件和历史提交均保留。现行目录规则见 [代码协作与本地运行](../repository-workflow.md)，本地维护回执位于总目录 `99-maintenance/organization`。

## 交付边界

本轮使用真实 PostgreSQL、本地文件存储和单操作者认证，提供可重复启动与恢复。公网部署、多用户成员授权、自动发布和完整品牌治理不属于本轮。真实模型和图片调用需先形成具体配置、调用量及预算方案，取得授权后执行。

AW FLEX 的四份上游原件、两份逐字 CSV 导出及父子哈希清单已在真实本地后端完成接收与哈希核对；其中原始画板 JSON 明确超出解析块上限，原件保留，逐字 CSV 的 475 个文字节点完整解析。已确定淘宝中国中文母版及 Amazon 美国站英文 A+ 商品详情内容，初期采用 Basic A+ 制作范围。用户选择先验收一个 SKU，待补具体型号、预期事实、部分平台规则及人工签收，详见 [业务输入清单](business-inputs.md)。[规则核对记录](platform-rules.md)已整理；[模型试验方案](model-evaluation-proposal.md)已获最多 12 次文本、2 次图片及 1 USD 本地估算门授权，当前仍为 0 次模型 POST。M1、M2 工程验收已完成；M0 与最终业务验收仍保持开放。不依赖缺失输入的开发继续推进。
