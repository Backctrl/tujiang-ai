# 阶段 A 前端接入交接

packet_id: TUJIANG-FRONTEND-INTEGRATION-20260906-01

本轮结论：六阶段 PR 审阅、前后端映射及前三阶段受限真实 API 接入已完成。独立代码/API QA PASS；主 Agent 浏览器链路 PASS。不是六阶段产品完成、正式业务批准或真实模型质量验收。

## 基线与位置

- PR1：https://github.com/Backctrl/tujiang-ai/pull/1，head `222a232d9deff460c7451d734fe1775366a7f1fa`。
- 契约：飞书 `EQzNdi9Szo7T1DxsIEMc2ku4nie` rev61，第3–10节本轮重新读取，保存于 `contract-rev61-six-stages.json`。
- Worktree：`F:/Project/tujiang-stage-a-integration`，分支 `codex/stage-a-frontend-integration`，基于本地主分支 `a7ded87`；Git fetch 连接失败，PR 七文件通过 GitHub API 精确读取指定 head 后落盘。没有将其冒充为已 fetch 的 PR commit。
- 后端：从原工作区复制既有43文件阶段 A 基线，排除 `.env`、`.data`、`node_modules`、`dist`；原工作区未改动。只新增本地合成启动脚本和前端 API 测试。
- 实现：主 Agent `/root`；独立审阅及 QA：`/root/contract_review`（explorer，继承主任务模型，无覆盖；选择理由为独立只读契约与API验收）。
- 未提交、未推送、未合并、未部署、未付费调用。交付可检查的文件和相对 PR+后端基线的补丁。

## 已接通范围

真实入口 `/arcane-warrior/stage-a`，沿用 ARCANE WARRIOR 工作台视觉；原 `/arcane-warrior` 明确标注模拟交互并链接到真实入口。

| 页面 | 本轮真实操作 | 仍未接入 |
| --- | --- | --- |
| 项目设置 | 创建/读取项目、确认/纠正同一产品身份、提交文字证据、项目ID刷新恢复 | 完整ProductBrief、文件上传解析、资料用途分类、RulePack、CanvasProfile |
| 产品事实 | 请求提取、展示候选与原文、逐条确认/拒绝/撤回、保存补充与纠错候选 | 完整待处理队列、用途确认、多来源归并、问题对话与批次进度 |
| 故事线 | 人工增删/排序、角色/目的/事实绑定、保存初步顺序、请求候选、明确应用候选及关联诊断稿 | 父子分组、合并拆分、正式Facts冻结、SectionSpec、模块/素材/FramePlan及批准 |
| 章节制作 | 只读当前诊断Section，严格按currentSectionId选择 | 后端已有Section draft/select，但本轮UI未接；HTML编辑器、Layout、正式批准和Renderer未实现 |
| 市场适配 | 明确显示未实现 | 市场版本、规则/术语、画布覆盖与批准 |
| QA与导出 | 诊断preflight及notChecked/版本原样展示 | 文件生成、文件级QA、RenderSnapshot、正式批准及下载 |

保存后采用服务端快照，不制造业务状态。所有写入包含 version/revision/idempotencyKey；人工审核与修改包含reason。旧版本冲突暂停写入，保留本地草稿，需读取差异并手动复核。网络结果不确定时仅允许显式重试同一请求；没有自动重试/换模型/轮询。后台进度通过手动刷新取得。

凭据仅在内存；本机只保存projectId。连接后锁定项目/凭据，重新打开页面才能切换。创建结果不确定时不允许读取本机旧ID。未保存表单和未完成请求不承诺跨页面关闭恢复；页面内应先完成原请求核对。

## 复现

在独立目录准备前端依赖：本轮 `npm install --ignore-scripts --package-lock=false` 成功，没有修改已有不一致的根锁文件。后端本轮复用原工作区依赖 Junction；其他机器在 backend 执行 `npm ci --ignore-scripts`。不要复制真实 `.env` 到合成环境。

终端一（工作目录 `backend`）：

```powershell
npx tsx scripts/frontend-local.ts
```

终端二（项目根目录）：

```powershell
npx vite --host 127.0.0.1 --port 5178
```

打开 `http://127.0.0.1:5178/arcane-warrior/stage-a`，输入终端一显示的临时测试凭据。合成服务只绑定127.0.0.1:4311，使用临时PGlite与本地对象，退出即清理；不加载.env、不构造OpenRouter。提取fixture只在第一份资料包含`10 kg`时返回一条合成承重事实，其他输入可返回空候选；不是通用解析器。

示例资料：`Capacity: 10 kg. Alternate: 20 kg.`。确认产品身份→保存文字证据→勾选本项目显式运行→请求提取→刷新→填写原因→逐条确认→故事线新增章节、填写目的并绑定事实→保存人工顺序→请求候选→刷新比较→手工应用。未来接真实后端需另行提供同源代理配置；本轮Vite代理仅指向本机4311。

## 验证

- 根目录 `npm run typecheck`：PASS。
- 根目录 `npm run lint:eslint`：PASS，0 errors；保留ProfilePage/authService两条既有unused-disable警告。
- 根目录 `npx vite build`：PASS；有既有大包/preset警告。未声称执行依赖bash/rsync的完整平台打包脚本。
- backend `npm run typecheck`：PASS；`npm test`：55/55 PASS，独立Agent执行复验。
- 新HTTP测试实际启动Fastify端口，生产StageAApi通过fetch访问，验证身份、证据、提取、确认、人工顺序、候选不覆盖、显式应用、纠错、撤回、stale、幂等及禁止导出。
- 浏览器实测和截图见 `frontend-browser-qa.md`、`stage-a-story.png`。

为恢复应用启动，`src/components/ui/image.tsx` 的中文SVG文本改为ASCII数字实体，消除模块初始化的btoa异常，视觉仍显示“加载失败”。这是README勿修改内置UI目录约定下的最小必要修复，未升级组件或改变其接口。原PR的全局模拟业务缺陷仍见审阅清单，不能因新增入口而标记原页面全部修复。

## 岳凯跟进

逐项执行 `frontend-review.md` 的FR问题清单（页面、位置、预期、验收标准已列）。优先将现有六阶段UI接到这套真实状态/命令协议；保持真实/模拟模式明显区分。已有代理与StageAApi可复用，后端类型在编译期共享。不要把前端Fact布尔值直接替代后端status，也不要把storyboardCandidates最后一项自动设成当前稿。

本轮已完成前三阶段核心联调，后续真实生产界面仍需岳凯完善呈现与缺口。阶段B能力按实际后端范围另行排期。
