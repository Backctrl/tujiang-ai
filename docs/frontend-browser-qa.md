# 阶段 A 浏览器验收记录

日期：2026-09-06，主 Agent，Playwright CLI，Chromium，1440×1000。

入口：http://127.0.0.1:5178/arcane-warrior/stage-a。Vite同源代理→127.0.0.1:4311真实Fastify→PGlite测试库→合成Worker，无付费请求。

测试项目 `8469bcf8-83b1-4ae2-92ba-a92ee8406f7d`，名称“浏览器合成联调项目”，产品“测试支架”，文字证据“Capacity: 10 kg. Alternate: 20 kg.”。临时凭据不写入交接文件。

| 检查 | 实际结果 |
| --- | --- |
| 创建项目、确认身份、保存证据 | 页面收到真实V1/R1→V2/R3快照，资料列表1份 |
| 未允许运行 | 请求提取按钮disabled=true；没有自动运行 |
| 提取与刷新 | 明确勾选后请求提取，刷新显示done/succeeded、候选10 kg，R6 |
| 人工原因门槛 | 未填原因时确认按钮disabled=true；填写后单条确认，V3/R7 |
| 人工顺序 | 新增1章、填写员工目的、绑定确认事实后保存，R8；保存后未保存标记消失 |
| 候选不覆盖 | 合成规划完成R11后当前目的仍“员工顺序：说明承重证据”；模型候选独立列出 |
| 明确应用 | 点击候选应用后当前顺序和诊断稿变更，R12；本地编辑不会被静默抹掉 |
| 诊断预检 | R13 issues=[]、issueSeverity=none，但exportAllowed=false；批准下载disabled=true |
| 并发冲突 | 另一HTTP客户端推进到R14，页面旧R13再写返回REVISION_CONFLICT；写按钮disabled=true；读取最新差异、点击已复核后恢复=true |
| 刷新恢复 | reload后token为空，projectId保持原值；重新输入凭据读取后项目身份和资料恢复 |
| 网络中断 | Playwright仅中断一次qa/preflight请求；页面暂停新写入；人工点击重试后2次请求idempotencyKey相同，成功R15 |
| 当前稿读取 | 刷新后进入故事线并明确载入当前顺序供编辑，显示“说明产品承重参数”；截图stage-a-story.png |

浏览器首次加载触发原仓库image.tsx中文btoa异常，应用全局崩溃。修复为数字实体后页面正常。开发preset仍输出“Error fetching published app info”（本地返回HTML非发布元信息），未阻断实际页面/API；预期409和人为断网也记录浏览器console错误，没有将console错误数量当成零。

开发期文档/源文件热刷新曾重载页面导致一次自动化定位超时；重新读取原项目后继续，后端数据保留。未将失败步骤冒充业务通过。

截图已人工查看：品牌、六阶段导航、三栏表单、当前版本、候选/人工顺序和底栏可读。未完成200%缩放、完整多语言和窄屏专项，因此不宣称全量可访问性通过。
