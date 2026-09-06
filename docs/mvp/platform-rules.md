# 首发与适配规则核对

核对日期：2026-09-07。用户明确淘宝中国中文母版 → Amazon 美国站英文 A+ 商品详情内容。本文件是来源与建模依据，尚未写入运行时正式规则目录。

## Amazon Basic A+

初期采用 Basic A+ 制作范围。Amazon 官方设计说明写明每个 ASIN 最多使用 5 个 Basic A+ 模块；这不是任意 A+、Premium、卖家 API 或 Section 数量的通用限制。[官方设计说明](https://sell.amazon.com/blog/a-plus-content-design-guide?mons_sel_locale=en_US)

官方 API 示例给的是**模块中图片槽的最低像素尺寸**，不能改写为整套详情页的固定宽度：

| API 模块／图片槽 | 最低宽×高（px） |
| --- | --- |
| StandardCompanyLogo | 600×180 |
| StandardImageTextOverlay | 970×300 |
| StandardHeaderImageText | 970×600 |
| StandardSingleSideImage | 300×300 |
| StandardThreeImageText，每张 | 300×300 |
| StandardImageSidebar，main／sidebar | 300×400／300×175 |
| StandardFourImageText，每张 | 220×200 |
| StandardComparisonTable，product column | 150×300 |
| StandardFourImageTextQuadrant，每张 | 135×135 |

这些字段还各有标题、正文和 alt text 长度约束，具体模块需逐字段录入，不能把所有正文统一成一个字符数。[官方模块字段与尺寸](https://developer-docs.amazon/sp-api/lang-en_US/docs/a-plus-content-examples)

PNG 与 JPEG 在官方上传示例中有使用依据，首期可选择这两个格式子集；示例不能证明完整格式白名单。2 MB 暂不作为已证实的全模块硬阈值；若工程选择更保守的输出体积，应标为本地制作策略。HTML、PDF、WebP 的本地交付能力不代表 A+ 图片上传允许这些格式。[官方创建与上传流程](https://developer-docs.amazon/sp-api/lang-en_US/docs/create-edit-publish-aplus-content)

## 淘宝中国

本轮未获得可核验的淘宝官方详情图片尺寸、格式与体积规则。公开搜索中的 750／790 px、500 KB／1 MB／3 MB 说法来自不同场景及第三方，不据此创建正式规则值。后续由真实商家编辑器中的规则、官方文档或带位置／日期的官方材料补齐。已确定平台和语言，可继续保存草稿与制作模型；缺规则仍阻止正式目标启用。

## 2A2 建模约束

现有 `allowedWidthsPx` 不能单独表达 A+。后续 RulePack 应分开记录官方约束来源与本地生产选择：规则按内容类型／模块／图片槽保存 min/max/exact、格式或文本限制及出处；CanvasProfile 保存员工明确选择的制作尺寸与交付格式。值是 minimum 时验证 `actual >= minimum`，不能用相等比较。

A+ 模块数量、Section 章节数量和 Frame 文件数量分别验证。不同目标保留独立 CanvasProfile，适配不得反写母版宽度。未核验项保持未知并返回具体阻断入口；规则版本启用后保留当前不可变快照与哈希机制。
