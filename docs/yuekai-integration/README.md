# 岳凯前端与现有后端合并验收

日期：2026-09-06。最终提交和远端 CI 以本 PR 为准。

## 基准与范围

- 前端基准：岳凯 PR #1 合并提交 `25e6b38c3dc12c1e3f8c9f9115640563b28a993a`；工作台 TSX/CSS 与本轮开始的 main 相同。
- 后端基准：`0bd11db8e6b023ca5fc21e1372813dcf34917f94`，已通过 GitHub API 确认为开始时远端 main。
- 本轮工作目录：`F:/Project/tujiang-yuekai-integration`，分支 `codex/yuekai-backend-integration`。
- 先前未提交的重组页面留在 `F:/Project/tujiang-unified-workbench`，不合入。仅复用已经验证过的非界面请求/会话逻辑。
- 唯一工作台入口 `/arcane-warrior`。旧 `/arcane-warrior/stage-a` 仅 replace 跳转。其他旧应用路由不在本轮范围内。

删除额外 StageAWorkbench、SectionDraftEditor 与专用 stage-a.css；删除该工作台 mockData 和未使用的假业务类型。没有整体回退历史 PR。后端源码、数据库结构、现有测试和 CI 保留；`arcane-warrior.css` 与基准逐字一致。新增局部 CSS 仅承接连接/审核输入、空状态和滚动，不重设原主网格。

## 组件与接口对应

| 原区域 | 真实接入 | 保留缺口 |
| --- | --- | --- |
| 项目设置：五区块、左步骤、右准备状态、底操作 | 项目创建/读取，identity confirm/correct，文字 evidence；TXT 读取后明确保存 | 品类等完整产品字段、PDF/图片/表格解析、平台/语言/尺寸 |
| 产品事实：来源/待处理中心/Inspector/底部 | 实际来源、候选、精确引用；手工候选/纠错；逐条确认拒绝撤回；显式提取与重试 | 置信度、正式事实基线批准 |
| 故事线：树/手机预览/script或spec/Agent四栏 | storyboard.chapters；人工角色/目的/事实/顺序；保存draft；规划候选显式应用 | 正式模块、素材、Layout和批准 |
| 章节制作：树/画布/Inspector/底操作 | 左树与属性只读展示真实故事结构 | 正式逐章内容、画布、Patch与锁定；不使用项目诊断稿冒充章节 |
| 市场适配：版本/画布/Inspector/底操作 | 真实空状态，无模拟版本 | 市场规则、语言适配、市场生成与批准 |
| QA：问题/预览/交付门/底操作 | qa/preflight实际问题、版本、未检查范围；missingInputs按诊断稿ID只读显示 | 正式页面、文件QA、批准与导出 |

接口沿用现有 contracts。项目级诊断稿仅参与后端规划/预检，不新增诊断编辑界面。新增后端需求留待后续：逐章对象ID与内容/资产/Layout/状态、市场版本及规则、可追溯渲染文件和交付验收；本轮不创造这些字段或迁移数据库。

## Agent 归属与独立审查

主 Agent 负责唯一入口、公共组件、请求/状态、章节/市场/QA、局部 CSS 和最终集成。Agent A 仅负责 ProjectFactsStages；Agent B 仅负责 StoryStage；Agent C 只读核对原布局、数据语义和异常恢复，不修改代码、不操作共享测试项目。子 Agent 没有各自创建 PR。

独立审查发现并关闭两项P2：新增原因输入未继承原表单样式；QA缺口只有错误码没有具体内容。已补局部样式及只读missingInputs。未发现未关闭P1/P2。

## 浏览器验证

环境：浏览器→Vite同源代理→真实Fastify业务API→隔离临时PGlite，模型使用明确的合成fixture。不读取.env、不调用OpenRouter、无付费请求。这证明接口与页面行为，不证明真实模型质量或生产部署。

| 场景 | 结果 |
| --- | --- |
| 旧地址及空状态 | 自动跳唯一入口；六阶段无固定产品/市场/指标，无模拟成功 |
| 项目/身份/资料 | 手工输入，真实HTTP保存后显示；读取文件不自动保存 |
| 候选提取 | 用户允许本项目模型请求后明确点击；实际返回候选，未自动确认 |
| 人工事实 | 错误原文摘录禁止保存；正确引用保存候选、确认、撤回真实成功 |
| 候选草稿 | 跨阶段、收起后继续编辑均保留；替换草稿需要明确放弃 |
| 故事草稿 | 角色、目的、引用和顺序真实保存；跨阶段未保存输入保留 |
| 规划候选 | 不覆盖人工顺序；明确应用后才切换服务器顺序 |
| 创建401 | 更新凭据后以原操作编号重试成功，不要求先知道项目ID |
| 未决写入 | 证据POST已提交后中断响应，新写入暂停；随后GET503仍保留pending |
| 幂等恢复 | 显式GET核对后同key回放，两次key相同，最终只有一份证据 |
| 并发409与401 | 外部HTTP更新revision使旧提交被拒；读新版本/人工复核以及重新认证后仍保留故事草稿 |
| QA | 零诊断问题仍禁导出；受检稿缺口显示实际missingInputs和处理路径 |
| 刷新页面 | token清空、仅项目ID记住；明确重连后恢复服务端项目 |
| 布局 | 1440×1000六阶段对照；1180×820 QA检查，原分栏与操作区保留 |

前端 `npm run lint`、`npx vite build` 通过；后端 `npm run typecheck`、56项测试和build通过。保留两条原有unused eslint-disable警告和构建分包提示。浏览器仍有原妙搭预设本地发布元信息/postMessage提示；故障注入401/503/网络错误为预期，未发现新增React运行错误。

截图目录：`baseline-1..6.png` 是原界面；`empty-1..6.png` 是清空业务数据后的原布局；`connected-1..6.png` 是真实接口合成验收状态。`connected-story.png` 展示规格编辑，`connected-facts.png` 展示人工事实审核，`connected-qa.png` 与 `qa-1180.png` 展示预检。所有有数据的新截图均标明合成验收项目，不作为内置数据。

## 本地连接真实后端

按 [backend/README.md](../../backend/README.md) 配置PostgreSQL、迁移并启动后端。在根目录运行 `npx vite --host 127.0.0.1 --port 5178`，打开 `/arcane-warrior`。默认 `/api` 代理目标为 `http://127.0.0.1:3100`。后端不在线时显示真实错误，不回退模拟数据。不同本地地址可在启动Vite进程设置 `TUJIANG_API_TARGET`，凭据不放进该变量或VITE变量。

隔离测试才使用 backend的 `npx tsx scripts/frontend-local.ts`，并在前端PowerShell进程设置 `$env:TUJIANG_API_TARGET='http://127.0.0.1:4311'`。测试进程关闭后临时数据不保留，不能作为真实工作项目库。真实模型运行按后端配置且由用户明确点击。正式部署的同源API代理另行配置，本PR不部署。

已知边界：载入项目后固定当前项目，切换项目需重新加载页面；未保存输入不跨页面重新加载恢复。当前仍是后端单操作者认证边界，不宣称多用户生产权限系统。
