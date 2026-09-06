# MVP 实现决定

所有决定服务于已批准文档语义，不能覆盖其业务规则。

## D001：兼容和正式对象

`stage-a.1` 与现有诊断语义保留。正式数据使用可选 `Project.production`、独立 `production.1` 契约。初始化通过显式写命令进行，读取不静默迁移。旧 `sections` 的 `diagnostic_draft` 不自动成为制作章节，也不产生批准记录。旧项目、历史快照和幂等回执保留原值。

正式业务对象独立保存 ID、修订、批准快照和依赖；当前数组位置不得成为章节 ID。批准版本固定其输入，后续变动创建新版本或候选。

## D002：M1 接口

- `GET /api/projects` 返回 `{ projects: [{ id, name, version, revision, contractVersion, updatedAt }] }`，按更新时间降序、ID 稳定排序；使用现有 Bearer 身份。
- `GET /api/projects/:id` 保持原响应结构，允许新增可选 `production`。
- `POST /api/projects/:id/production/initialize` 使用现有预期版本与幂等参数，初始化空正式域；重复初始化不新建业务版本。
- `GET /api/contracts` 保留原契约并公布新增命令及正式契约版本。

## D003：会话、事件与草稿

SSE 使用带 Authorization 的 fetch 流。事件 ID 是审计游标，不是项目 revision；收到事件后读取项目快照，不把事件正文当作 Project。重连有退避，只重试读取，不能重放业务 POST。旧快照不能覆盖新快照。

凭据仅驻留内存；草稿按项目与对象隔离，恢复时校验上游依赖并要求复核。未决写入禁止切项目；已确定失败、冲突和身份过期有独立恢复路径。保留原操作编号显式重试。

## D004：真实结果与验收

确定性测试固定浏览器、字体、素材和 Renderer 版本。合成输入仅验证工程协议，真实语义需人工复核。原诊断 QA 与正式 QA／文件检查分离。未通过正式 QA、未批准、stale 或缺少文件时禁止交付。
