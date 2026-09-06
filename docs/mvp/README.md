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
| 2A | A | 已完成 | [PR #9](https://github.com/Backctrl/tujiang-ai/pull/9)；部分配置草稿、不可变上下文及跨项目规则版本；M2 整体尚未验收 | D11–D20 |
| 2B1 | A | 已完成 | [PR #11](https://github.com/Backctrl/tujiang-ai/pull/11)；原件、确定性解析、定位与单文件恢复；[M2 分包记录](verification/m2.md) | D11–D20 |
| 2B2 | A | 已完成 | [PR #14](https://github.com/Backctrl/tujiang-ai/pull/14)；用途纠正、来源追溯与重确认，114 项后端／13 项真实 PostgreSQL 及独立审查通过 | D11–D20 |
| 2C | B | 已完成 | [PR #12](https://github.com/Backctrl/tujiang-ai/pull/12)；原设置五区、P 版本、草稿恢复与目标页头，独立审查和真实 PostgreSQL 浏览器通过 | D11–D20 |
| 2D1 | B | 已完成 | [PR #15](https://github.com/Backctrl/tujiang-ai/pull/15)、[窄栏修复 #16](https://github.com/Backctrl/tujiang-ai/pull/16)；真实上传、持久恢复、AW 原件与 Facts 窄栏操作均通过独立验收 | D11–D20 |
| 2D2 | B | 进行中 | 原待处理中心接四类用途／提取／事实／来源重确认任务；接口与布局已映射 | D11–D20 |
| 2A2 | A | 进行中 | 范围化规则与本地制作选择已冻结接口，领域／只读检查与真实 PostgreSQL 验证中 | D11–D20 |
| 3A/3B | A | 待开始 | Facts 基线、正式动态故事结构与批准 | D21–D29 |
| 3C/3D | B | 待开始 | 缺口闭环、章节规格、事实与素材绑定 | D21–D29 |
| 4A/4B | A | 待开始 | 章节命令、锁、布局候选与母版批准 | D30–D44 |
| 4C1 | C | 进行中 | 共享编译器和合成资源已提交检查点；固定 Chromium 已安装，正在执行真实浏览器渲染与确定性验证 | 可提前并行；原 D30–D44 |
| 4C2 | C | 待开始 | 接正式章节、完整样本与预览流程 | D30–D44 |
| 4D | B | 待开始 | 原画布接编辑、锁定、布局差异和确认 | D30–D44 |
| 5A/5B | A、B | 待开始 | 一个不同语言市场的派生版本与批准 | D45–D52 |
| 6A/6B/6C | A、B、C | 待开始 | 正式 QA、文件、Manifest、批准与下载 | D53–D62 |
| 6Q | Q、业务负责人 | 待开始 | 全链路、真实语义、恢复、确定性及局部失效验收 | D53–D62 |

## 当前派发

| 任务 | 分支与独立目录 | 允许修改 | 验证与合并 |
| --- | --- | --- | --- |
| 集成／台账 | `codex/mvp-m2-integration`，`F:/Project/tujiang-mvp-integration` | 执行资料、集成、CI | 主 Agent 集成；Q 验收 |
| 1A | `codex/mvp-1a-domain-foundation`，`F:/Project/tujiang-mvp-backend` | 后端源码、测试及后端说明 | 类型、旧回归、新兼容／版本测试；独立 PR |
| 1B | `codex/mvp-1b-project-session`，`F:/Project/tujiang-mvp-frontend` | 原工作台、客户端及相关客户端测试 | 前端检查、真实 HTTP、浏览器会话测试；独立 PR |
| 2A | `codex/mvp-2a-project-context`，`F:/Project/tujiang-mvp-context` | 后端上下文、规则注册表和迁移 | 已合并 PR #9；独立审查及真实 PostgreSQL 通过 |
| 2B1 | `codex/mvp-2b1-file-ingest`，`F:/Project/tujiang-mvp-ingest` | 后端文件、解析队列、定位及相关测试 | 原件哈希、失败隔离、Worker 恢复及真实 HTTP；独立 PR |
| 2C | `codex/mvp-2c-project-setup`，`F:/Project/tujiang-mvp-setup` | 原设置区、客户端会话与相关测试 | 真实后端浏览器、冲突恢复、历史只读；独立 PR |
| 2B2 | `codex/mvp-2b2-material-usage`，`F:/Project/tujiang-mvp-usage` | 后端用途审核、来源状态与相关影响 | 合同 `backend/MATERIAL-USAGE.md`；独立 PR |
| 2D1 | `codex/mvp-2d1-material-upload`，`F:/Project/tujiang-mvp-materialsui` | 原资料区域、上传队列与持久恢复 | 真实原件、断连／重开／401／409；独立 PR |
| 2D1 窄栏修复 | `codex/mvp-2d1-facts-material-layout`，`F:/Project/tujiang-mvp-materialsui-fix` | Facts 资料列表局部排版 | 多卡、展开来源／候选、下载／分页；独立修复 PR |
| 2D2 | `codex/mvp-2d2-material-review`，`F:/Project/tujiang-mvp-usageui` | 原待处理中心、用途与来源审核、有限持久请求 | 真实后端、来源约束、409／重开恢复；独立 PR |
| 2A2 | `codex/mvp-2a2-scoped-rules`，`F:/Project/tujiang-mvp-rules` | ScopedRulePack、兼容快照、只读范围检查 | min/max/exact、范围隔离、版本不可变与真实 PostgreSQL；独立 PR |
| 4C1 | `codex/mvp-4c1-renderer-foundation`，`F:/Project/tujiang-mvp-renderer` | 独立 Renderer 与测量；不改业务批准和原工作台 | 合成章节、固定字体／素材、连续三次渲染；独立 PR |

所有 Agent 不回退其他人的修改，不修改其他目录。公共契约由 A 维护、前端 API 与会话由 B 维护、共享 Renderer 由 C 维护。Q 不实现后再自审；C/Q 轮换第三个执行席位。每次合并前记录最终提交、审查结论和对应验证；不强制覆盖未提交文件。

## 交付边界

本轮使用真实 PostgreSQL、本地文件存储和单操作者认证，提供可重复启动与恢复。公网部署、多用户成员授权、自动发布和完整品牌治理不属于本轮。真实模型和图片调用需先形成具体配置、调用量及预算方案，取得授权后执行。

AW FLEX 的四份上游原件、两份逐字 CSV 导出及父子哈希清单已在真实本地后端完成接收与哈希核对；其中原始画板 JSON 明确超出解析块上限，原件保留，逐字 CSV 的 475 个文字节点完整解析。已确定淘宝中国中文母版及 Amazon 美国站英文 A+ 商品详情内容，初期采用 Basic A+ 制作范围。用户选择先验收一个 SKU，待补具体型号、预期事实、部分平台规则及人工签收，详见 [业务输入清单](business-inputs.md)。[规则核对记录](platform-rules.md)已整理；[模型试验方案](model-evaluation-proposal.md)已获最多 12 次文本、2 次图片及 1 USD 本地估算门授权，当前仍为 0 次模型 POST。M1 工程验收已完成；M0、M2 及最终业务验收仍保持开放。不依赖缺失输入的开发继续推进。
