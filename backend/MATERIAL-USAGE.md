# M2 资料用途审核与纠正接口（2B2）

本接口以产品契约 rev61 §5.2、§6.3 为边界。设置页接收原件，产品事实待处理中心承担用途审核；用途任务与事实任务分开。没有可核验的分类置信度时，候选保持待人工审核。本包不执行模型、OCR 或 PDF/Office 解析。

## 冻结接口

所有接口使用既有 Bearer 认证。写入仍要求 `expectedProjectVersion`、`expectedRevision`、`idempotencyKey`，完整请求 Schema 由 `GET /api/contracts` 的 `materialUsage`、`factSourceReconfirm` 发布。写接口返回完整 Project；前端继续按项目 revision 接收回执与 SSE，旧幂等回执不得覆盖较新的状态。

| 接口 | 用途 |
| --- | --- |
| `GET /api/projects/:id/production/material-reviews` | 读取用途、提取、事实审核和来源重确认任务，附当前项目 version/revision |
| `POST /api/projects/:id/production/materials/:materialId/usage` | 按已存在的块 ID 明确用途，首次审核与后续纠正使用同一接口 |
| `POST /api/projects/:id/facts/:factId/source/reconfirm` | 恢复同一原件同一块的证据用途后，人工明确重确认已锁定事实的来源 |

用途写入示例（ID、版本由当前 Project 获取）：

```json
{
  "expectedProjectVersion": 3,
  "expectedRevision": 12,
  "idempotencyKey": "material-usage-review-001",
  "reason": "已核对原文，这一块描述本产品参数",
  "decisions": [
    { "blockId": "<64位块ID>", "usage": "product_evidence" }
  ]
}
```

`decisions` 为 1–2000 项；每块只能出现一次，所有块必须属于路径中的 Material。`usage` 仅允许 `product_evidence`、`asset`、`reference`；混合资料逐块选择，可在一次请求中提交不同用途。尚未明确的块不提交，继续 pending。理由必填且最长 1000 字符。

请求不接收原文、文件路径、SHA、parserVersion、actor、时间、asset 指针或外部 block 元数据。服务端从当前 Material/MaterialBlock 派生，严格拒绝额外字段。图片必须已有完整解码结果；文本不能变成 asset，未执行 OCR 的图片不能直接变成文本 Evidence，图片可审核为 asset 或 reference。

对当前用途完全相同的重复提交，即使用新幂等键或不同理由，也不新增用途版本、投影、项目 revision 或审计事件；保存新的命令回执即可。同键同正文返回原回执；同键不同正文、过期项目 revision、并发冲突沿用既有 409 契约。部分块变化时只记录变化的块。

## Project 中的状态

`production.materials[].usage.status` 扩展为 `pending | partially_reviewed | reviewed`，只表示用途审核覆盖情况，不表示事实或素材质量批准。原来的 `hint` 保留为导入线索。`blocks[]` 的原文、位置和 `status=candidate` 不改写。

用途状态保存在 `material.usageReview`：

```ts
{
  version: number;
  history: MaterialUsageDecision[];
  current: Record<string, {
    usage: 'product_evidence' | 'asset' | 'reference';
    decisionId: string;
    version: number;
    projectionId: string;
    extraction?: {
      status: 'extraction_needed' | 'candidate_created' | 'extracted';
      evidenceId: string;
      candidateIds: string[];
      completedAt?: string;
      completedBy?: string;
      sourceRunId?: string;
    };
  }>;
}
```

一次决定产生一个递增用途版本，history 永久保留 actor、时间、理由、原件 SHA、parserVersion、来源、每块位置、前后用途和派生对象 ID。`current` 按 blockId 索引；修改其他块不会改变未修改块的决定版本。客户端必须使用对应块的版本，不能用 Material 的最新总版本代替。

派生结果位置：

| 用途 | 返回位置 | 内容 |
| --- | --- | --- |
| product_evidence | `Project.evidence[]` | 精确保留块原文，服务端保存文本对象；`origin=material`、`availability=available`、完整 materialSource |
| asset | `production.assets[]` | 服务端确定原件 objectKey、大小、SHA、完整解码的图片元数据与 materialSource |
| reference | `production.references[]` | 独立参考记录，保留文本/单元格或图片元数据/指针与 materialSource；不进入事实提取输入 |

所有派生对象的 `materialSource` 包含 `materialId`、`blockId`、`sourceSha256`、`parserVersion`、`fileName`、原件 `source`、块 `locator`、`usageDecisionId`、`usageVersion`。原件 SHA 与派生文本 Evidence 的 SHA 各自保留，不混用。具体导出类型见 `src/production-material-usage.ts`。

首次审核为 product_evidence 后的响应片段：

```json
{
  "evidence": [{
    "id": "<服务端Evidence UUID>",
    "origin": "material",
    "availability": "available",
    "usage": "product_evidence",
    "text": "<块原文>",
    "materialSource": {
      "materialId": "<Material UUID>",
      "blockId": "<64位块ID>",
      "sourceSha256": "<原件SHA>",
      "parserVersion": "ingest.1",
      "fileName": "产品参数.csv",
      "source": { "kind": "local_upload" },
      "locator": { "type": "csv", "row": 2, "startLine": 2, "endLine": 2, "startOffset": 6, "endOffset": 15 },
      "usageDecisionId": "<用途决定UUID>",
      "usageVersion": 1
    }
  }],
  "facts": []
}
```

这是 Evidence 接入完成，尚无事实提取或事实确认。新证据对应的提取状态为 `extraction_needed`。员工通过既有手工候选接口提供新候选后标记为 `candidate_created`；实际提取任务经现有校验提交后才标记 `extracted`，包括实际提取没有候选的情况。状态不会触发模型调用，也不被当作模型已执行的证明。

## 用途纠正与影响

每次真实用途改变都创建新的派生对象，旧对象转为 `availability=withdrawn` 并记录撤回决定，不覆盖旧原文和来源；恢复某个用途也不会重新激活旧对象。

- reference → product_evidence：创建新 Evidence、保留新用途版本，产生新的 `extraction_needed` 任务；不能沿用旧事实批准。
- product_evidence → reference 或 asset：旧 Evidence 停止进入提取、手工候选、确认和规划；相关未审核候选保留但标记 `sourceReview.status=invalidated`。已确认事实保持 `status=confirmed`、`locked=true` 和原值，标记 `sourceReview.status=reconfirmation_required`。
- 受影响的诊断 Section、当前故事线及故事线候选标记 stale，其他章节状态保留。决定 history 的 `impact` 返回 affectedEvidenceIds、affectedFactIds、affectedCandidateIds、reconfirmationRequiredFactIds、affectedSectionIds、affectedStoryboardIds。

影响计算导出为后续 M3 正式基线接入的共同入口；本包只覆盖当前已有的事实、故事线和诊断 Section，不伪造尚未实现的正式生产对象影响。

恢复为证据后，旧候选仍不可确认，旧锁定事实仍需人工重确认或提供新候选；既有 stale 章节不会自动恢复 current。若选择重确认，提交：

```json
{
  "expectedProjectVersion": 3,
  "expectedRevision": 20,
  "idempotencyKey": "fact-source-reconfirm-001",
  "reason": "重新核对本原件中的同一块，原事实仍成立",
  "evidenceId": "<恢复用途后新建的Evidence UUID>"
}
```

重确认仅适用于已确认并锁定、且确有来源重确认要求的事实；目标必须是同 materialId/blockId 的当前可用 Evidence，原 quote 必须仍成立。它不能改变 attribute、value、role 或删除历史。保留原确认信息，追加 `sourceReconfirmations[]`，明确切换当前 evidenceId 并清除本次待重确认状态；已有 stale 章节仍需重做或编辑后重新检查。对已完成的同一来源重确认重复提交无新增。

## 待处理中心

GET 返回 `projectId`、`projectVersion`、`revision`、`tasks[]`。任务 ID 随对应材料块、用途决定或事实保持稳定：

```json
{
  "projectId": "<Project UUID>",
  "projectVersion": 3,
  "revision": 13,
  "tasks": [{
    "id": "<稳定任务ID>",
    "type": "fact_extraction",
    "status": "extraction_needed",
    "materialId": "<Material UUID>",
    "blockId": "<64位块ID>",
    "evidenceId": "<Evidence UUID>",
    "usageDecisionId": "<用途决定UUID>",
    "usageVersion": 1
  }]
}
```

| type | 显示与操作 |
| --- | --- |
| material_usage | 待审核 Material 的 blockIds；选择用途后调用 usage |
| fact_extraction | 新用途版本还没有提取或手工新候选；提示待提取，不自动调用模型 |
| fact_review | 当前来源可用的事实候选；使用既有事实确认/拒绝接口 |
| fact_source_reconfirmation | 已锁定事实的来源需要重确认；`ready` 时含 replacementEvidenceId，可提交重确认；`blocked` 时先修正来源用途。附受影响 Section/Storyboard IDs |

用途未审、解析失败或已失效来源不会产生可确认的事实任务。已失效候选和旧用途对象仍可从 Project 查看历史，不重新列为可确认任务。

## 服务器校验与兼容

资料派生证据在手工候选、事实确认、模型输入筛选、Worker 执行前、模型输出提交、故事线/诊断 Section 编辑与选择、QA preflight 使用相同的当前用途/来源校验。仅 `usage=product_evidence` 或 `status=confirmed` 不足以绕过校验。

旧 `POST /api/projects/:id/evidence` 保留员工独立补充原文与回答的能力。服务端将新记录标为 `origin=manual_entry` 并记录 createdBy/createdAt；请求仍为 strict Schema，不能自报 materialId/blockId/hash/parser/objectKey 或 origin 冒充资料派生记录。已有无 origin 的历史 Evidence 继续按旧人工来源兼容。相同文字的人工补证是新来源、新审核责任，不继承原资料用途版本或任何事实确认。

用途命令只在实际提取/规划输入变化时更新 inputRevision 并作废当前 QA。无关 asset/reference 用途变化、重复决定和解析状态不会使在途诊断任务失效；证据增减及来源重确认造成的输入变化会阻止旧任务输出提交。历史 Project revisions、命令回执、原件字节与旧事实内容保持可追溯。

本包没有产品业务签收，也不包含官方规则目录更新；规则目录继续由既有人工核验流程维护。

## 失败响应与验证

错误沿用 `{ error: { code, requestId, details? } }`，不回显原文或请求正文。Schema 错误返回 400 `INVALID_REQUEST`，版本/幂等冲突沿用既有 409。用途特有错误如下：

| code | HTTP | 恢复方式 |
| --- | --- | --- |
| MATERIAL_NOT_FOUND / MATERIAL_BLOCK_NOT_FOUND | 404 | 刷新当前项目；不能把其他原件的块提交到本原件 |
| MATERIAL_PARSE_REQUIRED | 409 | 等待解析完成，或先解决该原件的解析失败 |
| DECODED_IMAGE_REQUIRED / TEXT_EVIDENCE_REQUIRED | 409 | 选择符合块类型的用途；没有 OCR 的图片不能成为文本证据 |
| MATERIAL_SOURCE_INVALID | 409 | 当前原件/块来源绑定不一致，停止该资料下游使用并检查原件 |
| SOURCE_FILE_MISSING / SOURCE_FILE_INTEGRITY_FAILED | 409 | 恢复正确的原件；系统不以不完整原件派生新来源 |
| SOURCE_RECONFIRMATION_NOT_REQUIRED | 409 | 当前事实不处于已锁定且待来源重确认状态 |
| INVALID_RECONFIRMATION_SOURCE | 409 | 选择同原件同块的当前可用新 Evidence，并核对原 quote |

来源不满足条件时，既有手工候选/确认和诊断接口沿用 `INVALID_EVIDENCE_REFERENCE`、`INVALID_EVIDENCE`、`UNCONFIRMED_FACT_REFERENCE`、`EVIDENCE_REQUIRED`、`CONFIRMED_CORE_FACT_REQUIRED` 等错误；在途任务仍以 `STALE_INPUT` 拒绝旧输入的输出。

专测为 `test/material-usage.test.ts`，包括真实 loopback HTTP、混合逐块审核、精确 CSV/JSON 定位、PNG/JPEG/WebP 素材、原件完整性、回执与并发、锁定事实/旧候选保护、独立人工来源、模型入口和输入修订。`test/postgres.integration.ts` 另覆盖两个服务的真实 HTTP 并发审核、重连后来源/回执保留、批次回滚和并发来源重确认。全部使用合成原件与可控模型替身，不访问模型服务，也不表示完成真实产品语义验收。
