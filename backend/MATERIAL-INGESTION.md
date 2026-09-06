# M2 资料接收与解析接口（2B1）

本包接收原件、自动解析并保存待审核候选。候选不会自动写入阶段 A `evidence`、确认事实或批准用途。初期支持 TXT、Markdown、CSV、JSON、PNG、JPEG、WebP；PDF/Office 的解析属于后续子包，当前返回 415 和可操作提示。

## 前端对接

全部接口使用既有 Bearer 认证，项目须先由用户明确初始化 `production.1`。设置页只需选择/拖入文件并显示进度；不要求用户预先判断用途。`usageHint` 是导入线索，省略时为 `unknown`；事实页的正式用途审核在 2B2 接入。

| 接口 | 输入与返回 |
| --- | --- |
| `POST /api/projects/:id/production/materials` | 写入信封加下列文件字段，一次一文件；返回 200 完整 Project |
| `POST /api/projects/:id/production/materials/:materialId/parse/retry` | 只写入信封；仅允许重试失败文件，返回完整 Project |
| `GET /api/projects/:id/production/materials/:materialId/original` | 认证后下载原始字节，不接受自报存储路径 |
| `GET /api/projects/:id` 和既有 SSE | 读取 `production.materials`，接收上传/解析开始/成功/失败审计事件 |

上传字段（全部位于写入信封同层）：

```ts
{
  fileName: string;
  mimeType: string;                // 浏览器 File.type，可为空；会与扩展名/图片魔数核对
  contentBase64: string;           // 原始字节的标准 Base64，无 data: 前缀
  source: {
    kind: 'local_upload' | 'feishu_export';
    url?: string;                 // feishu_export 必需；只记录来源，不自动抓取网页
    title?: string;
    revision?: string;
    locator?: string;
  };
  usageHint?: 'product_evidence' | 'asset' | 'reference' | 'mixed' | 'unknown';
}
```

`GET /api/contracts` 在 `requests.materialUpload` / `materialParseRetry` 发布严格请求 Schema。完整导出类型为 `src/production-materials.ts` 中的 `Material`、`MaterialSource`、`MaterialOrigin`、`MaterialParse`、`ParseAttempt`、`MaterialBlock`、`MaterialLocator`、`ImageMetadata`。

每个 `Material` 包含：

- `id`、`fileName`、`format`、`declaredMimeType`、已识别时的 `detectedMimeType`；`sha256`、`objectKey`、`sizeBytes`；来源、上传者与时间。
- `origins[]` 保留导入来源。同项目相同 SHA-256 与解析格式复用一个 Material、任务与候选；相同来源按字段值去重，不受 JSONB 属性排序影响；不同来源导入追加来源记录，不再次解析。同字节不同格式可形成不同解析记录，底层只保存一个内容文件。
- `usage: { status: 'pending', hint }`：上传/解析不会改变 pending。未知或混合文本产生 `unclassified_block`，只有来源线索明确时产生相应的 evidence/reference 候选；图片产生资产候选。
- `parse` 的持久状态，以及 `blocks[]` 候选内容。新文件返回时 `blocks=[]`，由后台解析任务写入。

解析状态沿用 `queueStatus` 与 `runStatus`，不把运行与人工审核混为一个状态：

| 状态 | 字段 |
| --- | --- |
| 等待解析 | `queueStatus=queued`、`runStatus=idle` |
| 解析中 | `queueStatus=claimed`、`runStatus=running`；有 attempt、leaseUntil |
| 成功 | `queueStatus=done`、`runStatus=succeeded`；blocks 和 notes 可读 |
| 失败 | `queueStatus=done`、`runStatus=failed`；errorCode、notes 给出原因与处理入口 |

`parse.id` 在失败重试时保持不变，`attempt` 在 Worker 领取时增加；`attempts[]` 保留每次开始、结束和失败码。SSE/写入回执可能晚到，继续使用 M1 的项目 revision 排序与草稿恢复规则，不能用旧回执倒退当前解析状态。

## 来源与候选

所有 `MaterialBlock` 都是 `status='candidate'`，包含 materialId、sourceSha256、parserVersion 和来源 locator。块 ID 由原件记录、解析版本和位置确定，失败恢复或迟到提交不会产生第二套重复块。

| 类型 | 原文与定位 |
| --- | --- |
| TXT / Markdown | 保留非空原文行，不执行 Markdown/HTML；`locator.type=text`，1 起算行号与原文字符起止位置 |
| CSV | 保留原文行片段和解析后的 `cells`，不假定首行为表头；`locator.type=csv`，逻辑 row 和跨引号换行的 startLine/endLine |
| JSON | 保留标量或空容器的原始字面量；`locator.type=json`，JSON Pointer 与原文字符起止位置；重复字段、注释、尾逗号或非法语法会失败 |
| PNG / JPEG / WebP | 完整验证静态图片解码后，只记录真实宽高、透明通道、方向等选定元数据；`locator.type=image, frame=1` |

文本只接受 UTF-8；可去除开头 UTF-8 BOM。字符位置按 BOM 去除后的 JavaScript UTF-16 字符索引计算，`startOffset` 包含、`endOffset` 不包含。CSV 行号同时包含表头和空行；JSON Pointer 对 `/`、`~` 转义。原始文件字节始终保留，可以下载核对。

图片候选明确标记 `textRecognition='not_performed'` 和 `semanticAnalysis='not_performed'`，没有 OCR、图片文案或产品事实。动态图不会静默取第一帧，而是要求用户提供所需静态帧。PNG 按 [PNG 规范的 acTL 动画控制块](https://www.w3.org/TR/png-3/#acTL-chunk) 独立识别 APNG，不依赖图片解码器是否报告帧数；普通文本块中的 `acTL` 字样不会被当作动画。

## 限制与恢复

单个原件上限 10 MiB，只有上传路由提高 JSON bodyLimit，其他接口保持原限制。文本解析上限 2 MiB；单项目最多 50 个解析原件；单文件最多 2000 个块、单块最多 32000 字符，CSV 最多 500 列；JSON 最多 64 层、Pointer 最多 2000 字符；候选结果总量最多 4 MiB，避免长路径重复展开；图片最多 4000 万像素。超过范围明确失败，不截断内容。

HTTP 拒绝：`FILE_TOO_LARGE`（413，含 maxFileBytes/supportedFormats/hint）；`UNSUPPORTED_FILE_TYPE` / `FILE_TYPE_MISMATCH`（415，含支持类型和提示）；`EMPTY_FILE` / `INVALID_FILE_ENCODING`（400）；未初始化、版本和幂等冲突沿用既有契约。原件过大、格式不支持或无效信封不会创建资料。

已接收文件的解析失败保存在该 Material 中，不影响其他文件。主要错误包括 `INVALID_TEXT_ENCODING`、`INVALID_CSV`、`INVALID_JSON`、`INVALID_JSON_UNICODE`、`DUPLICATE_JSON_KEY`、`JSON_TOO_DEEP`、`INVALID_IMAGE`、`IMAGE_DIMENSIONS_LIMIT`、`ANIMATED_IMAGE_UNSUPPORTED`、`PARSE_OUTPUT_LIMIT`、`TEXT_SIZE_LIMIT`。`parse.notes` 提供中文处理提示；用户修复内容后应作为新原件上传。来源元信息和 JSON 字段不得包含空字符或不成对的 Unicode 代理项，避免写入不可持久化内容。

`PARSE_WORKER_INTERRUPTED` 表示 120 秒租约到期，需显式重试；`SOURCE_FILE_MISSING` 可以重新上传相同原件补回，再点击重试；完整性校验失败须先恢复正确原件。重试使用新幂等键，未决请求只使用原键和原正文重放。成功文件不能重试，返回 `PARSE_RETRY_NOT_ALLOWED`；本包没有重新解析已成功文件或覆盖候选的接口。

## 存储与运行

原件写入既有 OBJECT_DIR，以 SHA-256 `.bin` 内容寻址；不把用户文件名用于磁盘路径。先写独立临时文件，再用硬链接原子发布，重复文件校验已有内容，最后删除本次临时链接。下载始终 attachment、no-store、nosniff，并校验原件大小和哈希；路径由服务器资料记录解析，跨资料/项目猜测 ID 不会直接读取任意文件。

解析队列保存在项目 JSONB 中，领取和完成使用 PostgreSQL 事务、行锁、租约和审计，不占用模型 Worker 的任务类型。服务启动时并行启动独立的确定性解析 Worker；解析不调用模型，也不修改阶段 A inputRevision、事实或 QA。内容文件写入与数据库不具备跨系统事务：数据库提交失败后可能留下不可经 API 访问的内容文件，不会留下已确认资料或被引用的候选；本包不主动删除可能被其他项目共享的内容文件。

新增运行依赖固定为 [sharp 0.35.4](https://sharp.pixelplumbing.com/api-constructor/) 和 [jsonc-parser 3.3.1](https://github.com/microsoft/node-jsonc-parser)。sharp 的 metadata 本身不等于像素有效，因此另执行完整解码验证；JSON 解析读取原文节点位置并拒绝重复 key。没有在线模型、OCR 或付费调用。

本地执行 `npm ci` 安装本工作目录独立依赖，随后 `npm run typecheck`、`npm test`、`npm run build`；本机共享 node_modules 的工作目录应先按协作约定隔离依赖。API 正常启动后解析 Worker 自动消费任务，测试中可显式调用 `IngestionWorker.tick()`。
