# M2 按范围核验平台规则（2A2）

本扩展把官方约束和本地制作策略分开。A+ 图片槽的最低宽度只约束该槽中的图片，不是详情页画布宽度；Basic A+ 每 ASIN 模块数量也不约束产品内部的 Section 或 Frame 数量。旧 P 版本、规则快照、哈希和命令回执不改写。本包不发布真实规则目录、不向平台发布内容，也不代替管理员核验或员工业务确认。

## 冻结接口

现有初始化、上下文草稿、启用、项目 GET/SSE 和写入信封保持原路径。新增规则输入检查是只读操作，不创建 QA、批准或导出记录。

| 接口 | 扩展 |
| --- | --- |
| GET /api/production/catalog | 保留 `rulePacks: LegacyRulePack[]`；新增可选 `scopedRulePacks: ScopedRulePack[]`，新目标使用此模型 |
| POST /api/projects/:id/production/context/draft | `primaryTarget.contentType`、`canvasProfile.selectionBasis` 可选保存；新规则模型启用时必须分别明确内容类型和 `local_production_policy` |
| POST /api/projects/:id/production/context/activate | 仍仅写入信封；按所选规则模型验证并冻结完整快照 |
| POST /api/projects/:id/production/rules/check | `{ contextVersion, subjects[] }`，按指定已冻结 P 版本检查调用者提供的输入，返回规则/来源/范围/具体失败位置 |

旧 `RulePack` 导出名保留为旧类型；另导出 `LegacyRulePack`、`ScopedRulePack`、`StoredRulePack`。`ProjectContextVersion.rulePack` 可为两种冻结形状。没有 `schemaVersion` 的规则明确属于 `legacy-canvas.1` 语义：原 `allowedWidthsPx`/`allowedFormats` 仍是原精确允许列表，不转译成官方 minimum，不加字段或改历史哈希。

目录默认仍为 `{ "rulePacks": [] }`。旧客户端只读取旧数组；支持新模型的客户端显式消费 `scopedRulePacks`，不得把图片槽 min 展示为全页可选宽。

现有上下文页面补充了新快照的只读展示：来源、管理员核验记录引用与本地画布策略分别呈现。该页面暂不提供新目标选择和编辑；当前启用版本或服务端草稿使用新模型时，编辑、保存、启用和复制在 Hook 层被禁止，避免旧表单丢失 contentType/selectionBasis。新模型草稿仍按草稿展示，不借用另一条旧启用快照；旧模型编辑流程保持兼容。

## 新规则模型

```ts
interface ScopedRulePack {
  schemaVersion: 'scoped-rules.1';
  id: string;
  version: string;
  name: string;
  description: string;
  target: PrimaryTarget & { contentType: string };
  publication: { status: 'admin_verified'; recordId: string; actor: string; at: string };
  sources: RuleSource[];
  constraints: ScopedConstraint[];
  activationRequirements: string[]; // 必须有至少一个当前目标/品类适用且已核验的 ruleId
  localProductionPolicy: {
    description: string;
    canvasWidthPx: { min?: number; max?: number; exact?: number };
    canvasFormats: ('png' | 'jpeg' | 'webp')[];
    exportFormats: ('html' | 'png' | 'jpeg' | 'webp' | 'pdf')[];
    maxExportImageBytes?: number; // 本地交付图片策略，不是平台上传硬规则
  };
  requiredFacts: RequiredFact[];
}
```

`target` 使用现有六个精确目标字段并增加 `contentType`，例如 `amazon_basic_aplus` 或 `detail_page`；不按其他平台、站点或内容类型回退。规则可用 `scope.category` 限定一个精确品类；省略表示所有品类，检查以冻结 ProductBrief.category 为准，调用者不能另报品类绕过规则。

```ts
type RuleScope = (
  | { kind: 'content'; contentType: string }
  | { kind: 'module'; contentType: string; moduleType: string }
  | { kind: 'image_slot'; contentType: string; moduleType: string; slotId: string }
  | { kind: 'text_field'; contentType: string; moduleType: string; fieldId: string }
) & { category?: string };

interface RuleSource {
  id: string;
  title: string;
  url: string; // HTTPS
  locator: string;
  kind: 'official_requirement' | 'official_example';
  verifiedBy: string;
  verifiedAt: string;
}

type ScopedConstraint = {
  ruleId: string; name: string; description: string; scope: RuleScope;
  severity: 'warning' | 'blocker';
  measure: 'moduleCount' | 'imageCount' | 'widthPx' | 'heightPx' | 'bytes' | 'textLength' | 'format';
} & (
  | { status: 'verified'; sourceIds: string[];
      constraint: { kind: 'numeric'; min?: number; max?: number; exact?: number }
        | { kind: 'formats'; allowed: string[]; exhaustive: boolean } }
  | { status: 'unknown'; reason: string; recovery: string }
);
```

`min/max` 可并存，`exact` 不可与它们混用。minimum 用 `actual >= min`，maximum 用 `actual <= max`；min 不等于 exact。数字单位由 measure 明确：像素、字节、Unicode 字符或数量。允许的 measure 按 kind 限定：content 仅 moduleCount、module 仅 imageCount、image_slot 为尺寸/字节/格式、text_field 为 textLength。

官方示例只证明某些格式有使用依据。`exhaustive=false` 表示已知可用子集，子集以外返回“格式支持未核验”，不能宣布平台禁止；基于 `official_example` 来源的格式约束不能声明完整白名单。unknown 产生 blocker，并携带具体恢复入口。

`activationRequirements` 必须引用现存规则。当前内容类型/品类没有适用且已核验的启用要求、或适用要求中有 unknown 时，禁止启用。尚未选择模块的上下文启用不声称图片、文本或平台发布全部合规；具体输入仍需按范围检查。

管理员只通过受信任的服务器目录配置提供规则，没有浏览器写目录或模型发布接口。publication 是线下管理员核验记录的引用；URL、verifiedBy 和此声明的字符串本身都不是身份认证、电子签章或人工审批凭证。管理员必须先完成真实核验再配置目录，工具不会自动生成有效业务核验记录。

## 本地画布选择

```json
{
  "primaryTarget": { "platform": "amazon", "site": "amazon.com", "country": "US", "language": "en-US", "currency": "USD", "unitSystem": "imperial", "contentType": "amazon_basic_aplus" },
  "canvasProfile": { "widthPx": 1200, "format": "webp", "selectionBasis": "local_production_policy" }
}
```

上例只展示字段，1200 和 WebP 是员工本地制作选择，是否可选取决于管理员配置的 localProductionPolicy。不得据此推断 Amazon 上传支持 WebP。平台图片槽规则单独检查；本地 HTML/PDF/WebP 交付能力不会加入官方上传格式集合。不同市场保留独立 P/CanvasProfile，不修改其他目标已有版本。

## 只读输入检查

```json
{
  "contextVersion": 1,
  "subjects": [
    { "id": "asin-basic-content", "scope": { "kind": "content", "contentType": "amazon_basic_aplus" }, "values": { "moduleCount": 5 } },
    { "id": "module-1-image", "scope": { "kind": "image_slot", "contentType": "amazon_basic_aplus", "moduleType": "StandardHeaderImageText", "slotId": "block.image" }, "values": { "widthPx": 1200, "heightPx": 700, "format": "png" } },
    { "id": "module-1-headline", "scope": { "kind": "text_field", "contentType": "amazon_basic_aplus", "moduleType": "StandardHeaderImageText", "fieldId": "headline" }, "values": { "text": "Product overview" } }
  ]
}
```

subjects 1–100 项且 id 唯一；scope 不接受调用者自报 category，values 只接受该 kind 的属性。textLength 在服务端按 Unicode 字符数量计算，不接收调用者自报长度。

响应包含 `kind=rule_input_check`、`projectId`、`contextVersion`、`rulePackRef`、`rulePackSha256`、`issueSeverity`、`findings[]` 与 `notChecked[]`。finding 包含 subjectId、scope、measure、ruleId（有则提供）、severity、code、sourceIds、恢复说明；不返回用户文本正文。缺测量值、缺匹配规则、unknown、超出官方已知格式子集都明确 blocker。非匹配图片槽/模块的限制不参与当前输入判断。

这是对调用者提供参数的检查，不读取真实导出文件，也不授予正式批准或下载资格。后续正式 QA 必须从已冻结业务对象及真实文件取得输入，并另验模块结构、事实、语言、像素文件和平台发布要求。本接口不会修改项目 revision、QA、历史版本、其他目标或任何批准状态。

## 错误与恢复

激活错误沿用 [上下文契约](PRODUCTION-CONTEXT.md) 的 HTTP 状态和事务回滚。范围检查请求不写状态，发现规则问题时返回 HTTP 200 与 findings，客户端按 issueSeverity 展示输入结果，不把它作为正式 QA 批准。

| 位置 / code | 处理 |
| --- | --- |
| HTTP 400 `INVALID_REQUEST` | 提交声明范围内的字段，id 不重复；文本提供正文，长度由服务端计算 |
| HTTP 401 `UNAUTHORIZED` | 恢复连接凭据 |
| HTTP 404 `CONTEXT_VERSION_NOT_FOUND` | 读取该项目已有 P 版本，显式选择一个版本 |
| HTTP 409 `RULE_PACK_SNAPSHOT_INVALID` | 停止使用损坏快照并核查数据来源；不得覆盖历史规则或重算哈希掩盖问题 |
| HTTP 409 `SCOPED_RULE_PACK_REQUIRED` | 旧 P 版本没有范围检查语义；保存采用新目录的草稿并显式启用新 P 版本 |
| finding `RULE_SCOPE_OUTSIDE_TARGET` | 使用该 P 版本的内容类型；不同平台、站点或内容类型单独绑定规则 |
| finding `RULE_COVERAGE_MISSING` / `RULE_CONSTRAINT_UNKNOWN` | 管理员核验具体范围并以新版本发布，缺少依据时继续阻断 |
| finding `RULE_INPUT_MISSING` | 补齐匹配规则要求的实际测量值 |
| finding `BELOW_MINIMUM` / `ABOVE_MAXIMUM` / `NOT_EXACT` | 按 expected 数值边界调整此 subject，保留对应范围和严重度 |
| finding `FORMAT_SUPPORT_UNKNOWN` | 所选格式超出已知子集；换用已有依据的格式，或补充官方核验 |
| finding `FORMAT_NOT_ALLOWED` | 当前范围的已核验完整允许列表不含所选格式；使用该列表中的格式 |

## 工程验证

`test/scoped-rules.test.ts` 覆盖 strict Schema、真实 loopback HTTP、范围/品类隔离、缺值与未知规则、min/max/exact、只读状态和旧哈希兼容。`test/scoped-context-compatibility.test.ts` 调用实际 React Hook，验证新快照/草稿/历史复制/上游切换被禁止写入，且旧模型仍可复制、保存和启用。`test/postgres.integration.ts` 补充两个服务的同版本异内容并发冲突、旧/新规则共同回填、重启后使用冻结快照且不改修订或回执。测试规则与核验记录是合成夹具，未进入运行目录，不代表真实业务验收。

运行 backend `npm run typecheck`、`npm test`、`npm run build`；真实 PostgreSQL 使用 `TEST_DATABASE_URL` 执行 `npm run test:postgres`，每项仅操作本次生成的独立 schema。此扩展未增加依赖，也不发起付费模型请求。

## 官方范围依据与首发边界

Basic A+ 的五模块限制按 ASIN 生效；A+ 模块图片最低尺寸与文本 maxLength 按具体槽/字段解释。来源为 [Amazon 设计说明](https://sell.amazon.com/blog/a-plus-content-design-guide?mons_sel_locale=en_US)、[模块字段说明](https://developer-docs.amazon/sp-api/lang-en_US/docs/a-plus-content-examples) 和 [上传流程示例](https://developer-docs.amazon/sp-api/lang-en_US/docs/create-edit-publish-aplus-content)，本轮仅用于结构建模与测试依据。

淘宝中国中文缺少已核验的官方数值时继续允许保存草稿，禁止正式目标启用；不录入未经核验的 750/790 px 或 3 MB。Amazon 不采用未证实的“全模块 2 MB”官方硬规则；工程选择体积策略必须保留在 localProductionPolicy。真实发布与业务签收仍由用户完成。
