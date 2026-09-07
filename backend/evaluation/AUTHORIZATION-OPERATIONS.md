# M0 授权账本操作

本入口对应 `m0-model-trial-2026-09-07` 已有的 12 次文本与 2 次图片授权。实现和合成测试没有执行真实模型 POST、真实元数据请求或真实输入批准。图片、正式故事、文案、布局和英文适配仍返回 `PURPOSE_ADAPTER_NOT_READY`；当前只有事实提取适配器可在全部门通过后运行。

## 配置与入口分离

所有实际运行进程连接同一个 `TUJIANG_EVALUATION_DATABASE_URL`（PostgreSQL）。不要用新库初始化替代既有累计记录。`TUJIANG_EVALUATION_ARTIFACT_KEY` 是单独的 32 字节 base64 AES 密钥；失去它就不能读取材料或继续派发，改 Key 不会重新初始化旧授权。

管理进程额外配置 `TUJIANG_EVALUATION_REVIEWER_ID` 与独立的 `TUJIANG_EVALUATION_REVIEWER_CREDENTIAL`（32 字节 base64，不能与材料密钥相同）。它们表示预配置的本地复核操作者身份；不是 OpenRouter Key，也不是远程账号认证系统。身份/凭据不能从批次或命令 JSON 指定。管理实例才可初始化、准备、复核、对账、解除 hold 和导出。runner 实例即使被直接调用管理方法也会拒绝，构造器权限与 live 实例标记在运行时校验。

CLI 不自动加载 `.env`，不接受命令行密钥。仅在实际执行已批准批次时，运行进程另需 `TUJIANG_EVALUATION_LIVE=1`、`OPENROUTER_API_KEY` 与显式 `--live --batch`。dry-run 不读取任何上述环境变量、Key 或账本。

## 准备与输入复核

在 `backend` 下，先用以下只读命令查看固定政策及其 SHA：

```powershell
npx tsx evaluation/authorization-cli.ts policy
```

`initialize <policy-sha>` 是唯一允许建 evaluation 表并登记已有授权的命令；没有授权记录的 live/status 不会建表或充值。相同 ID 与精确相同政策只返回现状，任何政策或 SHA 变化都会冲突。

```powershell
npx tsx evaluation/authorization-cli.ts initialize <policy-sha>
npx tsx evaluation/authorization-cli.ts prepare <run.json> <new-batch-uuid>
npx tsx evaluation/authorization-cli.ts export-input <batch-uuid>
```

`run.json` 格式沿用 runner：`config`、相对路径 `fixtures`、`capabilitiesFile`。准备阶段离线保存原始 run/fixture/能力文件字节、输入、人工预期、实际编译请求及 adapter 版本，并形成 manifest SHA。来源文件即使只改排版也需要新批次和新复核。实时预检的相关路由、能力和价格字段必须与已审阅快照一致。

`human-curated` 只是样本来源声明，不能签署批准。管理操作者先取得对精确 manifest 的独立人工决定，再用本地 JSON 记录已有决定：

```json
{
  "batchId": "<batch-uuid>",
  "manifestSha256": "<64-hex-manifest-sha>",
  "commandId": "<unique-command-id>",
  "decision": "approved",
  "reason": "<实际复核原因>",
  "decisionReference": "<已有人工决定的精确引用>",
  "decisionReceiptSha256": "<64-hex-decision-receipt-sha>"
}
```

```powershell
npx tsx evaluation/authorization-cli.ts review-input <decision.json>
npx tsx evaluation/authorization-cli.ts status
npm run evaluate:runner -- <unchanged-run.json> --live --batch <approved-batch-uuid>
```

`decision` 也可为 `rejected`，一批只接受一份决定。命令与内容相同可幂等重放；不能覆写决定。runner 没有 review 命令，不能从 `approved`、`reviewer` 或其他 fixture 字段创建复核。

## 查看材料

普通报告只含摘要、固定错误、金额与引用。`preflightArtifactId` 可定位实时预检原文；每项 `responseArtifactId`、`parsedArtifactId` 指向响应与解析。原始来源、输入、预期和请求均有独立类型的加密材料。

```powershell
npx tsx evaluation/authorization-cli.ts list-artifacts <batch-uuid>
npx tsx evaluation/authorization-cli.ts export-artifact <artifact-uuid>
```

省略 `list-artifacts` 的 batch 参数可查看授权的全部材料索引，包括人工恢复决定。显式导出只写入已忽略的 `backend/.data/evaluation-review/`，生成 `<artifact-uuid>.bin` 与 `.metadata.json`，拒绝覆盖和目录跳转；创建目录前检查现有父目录，创建后复查并写入实际路径，Windows 原生路径别名可以正常规范化。不向 stdout 输出原文。管理与运行入口都会登记当前已知凭据；敏感输入拒绝创建批次，输出先脱敏再加密。新管理进程导出旧材料时会再次脱敏，`redacted=true` 与副本摘要反映本次实际导出的内容。`originalSha256` 指收到的原文摘要，`contentSha256` 指可复核副本。`partial` 的摘要只覆盖已收到前缀；`unavailable` 表示没有响应正文。

当前材料格式为 `artifact.2`，材料 ID、归属、类型、脱敏状态、长度和摘要均受 AES-GCM 认证。list/inspect/export 以及 finish/recover 重放都验证材料；任意引用互换、密文或标记损坏返回 `ARTIFACT_INTEGRITY_FAILED`。旧 `artifact.1` 或缺少认证能力引用的旧 attempt 不自动升级，不能据此继续执行；保留原记录与累计额度，按主工作流形成新的可复核输入批次。status 有材料 Key 时验证 attempt 材料后输出引用；没有 Key 时标记 `artifactVerification=key-unavailable`，只提供未认证汇总并省略 response/parsed 引用。

## 中断与人工恢复

输入复核失效、材料完整性失败或 metadata/能力预检失败会持久停止旧批次；审批记录删除、决定或 receipt 与认证材料不一致也算复核失效。换 Key、换进程或还原文件都不能让旧批次重新发请求，需要准备并独立复核新批次。已停止批次不能通过补写 review 重新批准。调用前已经确定额度或预算不足时不会读取模型 Key 或发 metadata GET，批次保留 approved；这类可恢复额度问题与输入复核失效分开处理。网络前可用性检查通过后若另一个进程抢占额度，最终 reserve 仍会拒绝 POST。

所有下列命令只处理本地记录，不发起模型或 generation 查询。它们需要包含 `commandId`、当前 `expectedRevision` 和实际 `reason` 的 JSON；旧 revision 冲突后应重新查看状态。

| 命令 | 额外输入 | 行为 |
| --- | --- | --- |
| `cancel-reservation <command.json>` | `attemptId` | 仅取消从未派发的预留，并停止原批次；已派发不能退款 |
| `recover-capture <command.json>` | `attemptId`、`captureSha256`（索引里的 response `sourceSha256`） | 重新解析已加密落库响应，使用本地 evaluator 原子结算，不再 POST |
| `reconcile <command.json>` | `attemptId`、下述 `proof` | 记录人工核实的服务商费用回执，保留已消耗次数和已承诺估算，授权仍 held |
| `release-hold <command.json>` | 无 | 重新检查所有未结算派发、未知 usage 和预算，满足条件才解除授权 hold；不重启 stopped 批次 |

`proof` 包含实际请求 `requestSha256`、人工决定 `decisionReference`、`providerReceipt` 和该回执 canonical JSON 的 `providerReceiptSha256`。回执结构是 `{id, model, provider, prompt_tokens, completion_tokens, cost}`，字段均不可缺失；必须匹配请求/模型/精确服务商，已有请求 ID 必须匹配，不能降低已知费用。费用由回执字段派生；空对象或只提供“费用为 0”的声明不被接受。真实零费用也不能退还已派发次数或估算额度。

任意 `dispatch_started` 在任何经过时长后仍构成全局 effective hold，即使授权行仍写着 ready。崩溃时还没保存原文，就保留未知用量并等待凭据复核；已保存原文，可显式本地恢复；已完成请求的重放只返回已有记录。

## 验证

`npm test` 包含离线、权限、材料、CLI 与模拟传输用例；`npm run test:postgres` 额外加载独立真实 PostgreSQL 子进程的预算竞争、重复派发与 reserve/dispatch/capture/finish 四个中断点测试。共享的完整性矩阵在 PGlite 与真实 PostgreSQL 各执行一次，包含标记/密文/ID 篡改、跨 item/batch/type 引用、attempt 语义列迁移、审批缺失与恢复后的跨进程零请求检查。缺少 `TEST_DATABASE_URL` 时后者报错，不跳过。测试仅在本次随机生成且校验过的 schema 内写入；模拟旧库缺少外键时也只在该测试 schema 删除指定约束，所有模型响应由合成 fetch 提供。
