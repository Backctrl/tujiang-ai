# 章节诊断稿编辑验收

2026-09-06，基于 main a5d7a47，分支 codex/chapter-draft-editor。

第四步从只读 JSON 改为当前稿、历史比较和编辑表单，使用既有 /sections/:id/draft 与 /select 接口。当前对象严格由 currentSectionId 指定；一次保存创建新诊断稿并保留前稿。此功能不构成正式SectionSpec、逐章设计批准、HTML渲染或导出。

## 验证结果

- 前端类型与ESLint通过（2条既有warning），Vite构建通过。
- 后端56项测试通过；新增真实HTTP测试覆盖新稿/旧稿/历史快照、旧revision409、拒绝自报批准、历史选择及撤回事实后的失效阻断。
- Chromium真实HTTP合成服务：载入稿件、修改目的/缺口、原因门槛、跨阶段保留未保存内容、保存后选中新稿并清理表单、查看历史与显式恢复均通过。
- 人为中断一次保存请求：pending期间编辑禁用，人工重试的两次请求idempotencyKey一致，成功后表单清理并选中新稿。
- 故事线原样另存使旧稿stale后，用户复核可原内容另存新稿，不必制造无意义文字变化。
- 正式设计批准按钮始终禁用。截图chapter-draft.png已查看。
- 独立审查发现的stale原样保存与重试成功状态两项P2已修复，复核PASS，无新增P1/P2。

浏览器项目54ca0aa2-b073-4957-a917-8c80f8ec7bae使用临时PGlite及合成Worker，没有外部模型调用。既有本地preset发布元信息JSON错误及人为断网console错误未计为业务成功；未宣称console零错误或完成全量可访问性验收。