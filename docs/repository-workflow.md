# 图匠代码协作与本地运行

GitHub `Backctrl/tujiang-ai` 是共享代码源。`main` 保存已审阅的组合版本；正式部署与真实模型试用是另外的动作。

## 任务归属

每项任务记录一个负责人、一个分支、一个实际工作目录、修改范围、验收条件和 PR。岳凯负责前端演示页面修订，开发指挥负责后端与阶段 A 联调；本轮整体联调补丁只由开发指挥提交一次。不要再将交接 ZIP 作为另一份代码重复应用。

`src/app.tsx`、接口契约、依赖与配置是公共文件；修改前在同一任务/话题确定负责人。同一工作目录不要同时交给多个实现任务。历史验收目录保留，不在其中开发或切换到新 main。

## 日常步骤

1. 在干净的 main 点击 Fetch origin，发现更新后 Pull origin。
2. 从最新 main 建任务分支，例如 `codex/task-description`；一个任务使用一个独立目录。
3. 开发后检查 Changes，只提交本任务文件。Commit 保存到本地，Push 上传 GitHub。
4. 创建 PR，说明行为变化、接口影响和验证结果。后续修订继续推送同一分支。
5. 审阅最终提交，自动检查通过后合并。相互依赖的 PR 由开发指挥按依赖顺序合并，核对前一合并对后一差异的影响。
6. 回到 main 同步；保留未提交文件，有分叉时先核对，不强制 reset 或覆盖。

GitHub Desktop 的 Repository → Show in Explorer 可以确认实际目录。同名仓库可能是不同 clone；Fetch 不会合并另一个分支。Codex 正在工作的目录不要在 Desktop 中随意切分支。

本地目录于 2026-09-07 统一整理到 `F:/Project/tujiang-ai`：`01-main` 是主仓库，`02-development` 保存开发 worktree，`03-runtime` 保存集成、运行与验收 worktree，`04-archive` 保存已结束阶段与旧副本。原 Desktop 检出位于 `04-archive/tujiang-ai-legacy-checkout`；旧 `F:/Project/tujiang-ai-source` 仅是指向 `01-main` 的当前任务兼容目录联接。

新任务目录建在 `02-development/<task-name>`，运行和验收目录建在 `03-runtime/<task-name>`，不再散放在 `F:/Project` 顶层。移动已有 worktree 时使用 Git worktree 命令，核对分支、未提交内容及依赖目录联接。具体分支/HEAD 与同步回执由当前执行台账保存，不把旧文档中的路径或提交当作当前状态。

## 从干净安装验证

使用 Node.js 22。在根目录运行 `npm ci --ignore-scripts`，在 backend 运行 `npm ci --ignore-scripts`。根目录 `npm run lint`、`npx vite build`；backend 下 `npm run typecheck`、`npm test`、`npm run build`。

`.github/workflows/verify.yml` 在 PR 和 main 更新时执行以上检查，不读取模型凭据，不部署。前端浏览器验收仍需对实际改动执行，自动类型/单元测试不代替人工页面检查。

## 阶段 A 本地合成联调

终端一在 backend 运行 `npx tsx scripts/frontend-local.ts`，终端二在根目录先设置 `$env:TUJIANG_API_TARGET='http://127.0.0.1:4311'`，再运行 `npx vite --host 127.0.0.1 --port 5178`。打开 `/arcane-warrior`，输入终端一显示的临时测试凭据。

服务使用临时 PGlite 和合成 Worker，不加载 .env；关闭后不作为持久项目库。样例证据 `Capacity: 10 kg. Alternate: 20 kg.` 会产生待确认事实。真实数据库及网关配置见 backend/README.md，真实模型请求需单独授权。

当前唯一入口为岳凯的 `/arcane-warrior` 工作台，覆盖项目、身份、文字证据、事实逐条审核、初步故事顺序和项目诊断预检。额外Stage A页面和诊断编辑器已删除，旧地址仅跳转。正式章节制作、市场批准和文件导出尚未实现。默认Vite代理连接真实后端3100，合成联调需显式设置上述覆盖变量。

## 历史验收资料

`frontend-integration-handoff.md`、`frontend-review.md`、`frontend-independent-qa.md`、`frontend-browser-qa.md` 与其截图/合成快照是上一轮隔离候选的验收记录。其中“未提交”等描述是当时状态，不替代本轮 PR 的最终提交与检查结果。合并依据必须包含本轮最终组合验收。

当前接入和验收见 [岳凯前端合并记录](yuekai-integration/README.md)。此前历史验收中的双入口和诊断编辑器说明已被本轮取代。
