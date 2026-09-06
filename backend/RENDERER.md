# 4C1 受控 HTML Renderer 基础

本叶子提供独立的审核样稿 Renderer，没有接入业务批准、生产页面或正式 Export。`compileReviewHtml` 只得到 `compiled-unmeasured` HTML；真实浏览器资源与布局检查通过之后，`renderReviewSample` 才会产生 `measured-review-sample` PNG。两种结果的 `purpose` 恒为 `review-sample`。

当前检查点：共享编译器、浏览器测量模块、服务端截图模块、合成样本及测试已实现；纯编译测试通过。固定 Chromium 下载较慢，真实浏览器测试、连续三次像素一致性与 PNG 视觉检查仍待执行，**本检查点不是 4C1 验收通过**。恢复命令见下文。

## 冻结输入

`src/renderer/model.ts` 是此适配边界的完整 TypeScript/Zod 定义，版本为 `rendererInputVersion = 1.0.0`、`rendererVersion = controlled-html/1.0.0`。这不是正式业务 Schema 的替代品；A 后续负责领域对象到此输入的适配。

```ts
type VersionedRef = { id: string; version: string; sha256: string };
type RendererInput = {
  rendererInputVersion: '1.0.0';
  rendererVersion: 'controlled-html/1.0.0';
  snapshotRef: VersionedRef;
  projectRef: VersionedRef;
  contentRef: VersionedRef;
  layoutRef: VersionedRef;
  ruleRef: VersionedRef;
  canvas: { width: number };
  styleSnapshot: {
    ref: VersionedRef;
    fontId: string;
    heading: Typography;
    body: Typography;
    caption: Typography;
    colors: { background: Hex; foreground: Hex; muted: Hex; accent: Hex; border: Hex };
  };
  assets: Array<{ id: string; sha256: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' }>;
  fonts: [{ id: string; sha256: string; mime: 'font/ttf'; weight: 400 }];
  sections: Array<{
    id: string;
    frames: Array<{
      id: string;
      height: number;
      blocks: ContentBlock[];
      layout: Array<{
        blockId: string;
        layer: 'background' | 'foreground';
        x: number; y: number; width: number; height: number; padding: number;
      }>;
    }>;
  }>;
};
type Typography = { fontSize: number; lineHeight: number; letterSpacing: number };
```

`ContentBlock` 覆盖 Heading、Copy、Disclaimer、Media、Callout、Metric、ParameterTable、Proof、Comparison、FeatureList、Process。每个块有稳定 `id` 与 `sourceRefs`；正文、参数行、比较列、流程步骤都是结构化数据。Renderer 保留这些引用，不解析或批准事实、证据、竞品对比和安全操作。上游负责确认事实状态、依赖版本与 SHA-256 对应关系、布局已确认状态、锁定和平台 RulePack 预检。Renderer 不访问上游存储、不验证 ref 对应业务对象的真实性，也不将 sourceRefs 存在视为批准。

Section 数量动态，一个 Section 可以包含多个 Frame；本层 Section 高度为它的 Frame 高度之和。Frame 和 Section 不接受 width，宽度只来自 `canvas.width`。v1 使用已确认的整数像素矩形布局，每个内容块必须恰好有一个槽位，边界与 padding 不能越框。一个 Frame 最多有一个明确声明的背景 Media；它可与前景重叠，普通前景块重叠会阻断。没有随机布局、自动删字、自动缩字或六章模板。

输入及所有嵌套对象使用 strict schema，拒绝 raw HTML/CSS、URL、脚本、事件处理器、未知字段、非法颜色和非有限数字。文字逐项转义。CSS 由有限的属性生成，CSP 只放行生成 stylesheet 的 SHA-256 与 data 图片/字体，不允许脚本或外网资源。

## 共享与服务端边界

`compile.ts`、`model.ts` 和 `encoding.ts` 可以打包进入浏览器，只依赖 Zod、标准 JavaScript 与 WebCrypto，不使用 Node、文件、网络、时间或随机 API。第二参数为 `Record<resourceId, Uint8Array>`，调用方必须事先取回全部资产。编译器复制字节再计算 SHA-256；缺文件、哈希不符、非法资源格式、字体缺字直接返回 blocked issues。

字体 v1 限定一份随资源包提供的静态 TrueType regular 400。代码从固定字体的 cmap 4/12 验证所有输出字符，拒绝不支持或冲突的 coverage；没有 `local()`、系统字体名、备用字库或合成字重。`document.fonts.load` 与 `document.fonts.ready` 再确认浏览器真正接受字体。400 与单字体限制仅是 4C1 基础，不代表完整 4C 视觉属性能力完成。

`browser.ts` 提供自包含的 `inspectReviewDocument`，可在预览 iframe 的文档环境中运行。它确认 `inputHash`、字体加载、图片 decode、Frame/块 bbox、文本行 rect 和 scroll extent。内容保持可见，不通过 `overflow:hidden` 遮盖失败。测量结果按 1/64 CSS px 规范化，图片测量按稳定 blockId 排序。预览宿主应隔离 iframe 并显示返回的 issues；只有编译完成不能称为测量通过。

`server.ts` 复用同一个 HTML 和测量函数，使用 Playwright 自带的固定 Chromium headless shell，阻断全部网络请求，关闭页面脚本。它先检查图片解码尺寸上限，再加载字体、图片，完成测量后逐 Frame 截 PNG。任何 blocked issue 都返回失败且不返回 PNG。每个结果带 `inputHash`、`htmlHash`、`layoutHash`、字体/图片 SHA-256 与引擎环境；这些只是审核样稿追溯信息，不是正式 Manifest。

## 固定环境与验证命令

- Node：本地 `v22.23.2`，后端契约要求 `>=22`。
- Playwright：精确 `1.58.2`。
- Chromium headless shell：`145.0.7632.6`，revision `1208`。引擎版本不匹配直接拒绝，不借用系统 Chrome。
- 固定选项：DPR 1、`en-US`、UTC、light、reduced motion、禁用 GPU、font render hinting none、sRGB。
- `sharp`：已有精确 `0.35.4`，用于尺寸检查与解码 PNG 的 RGBA 像素。
- 浏览器打包测试：精确 devDependency `esbuild 0.28.2`；证明同一纯模块在真实浏览器内执行后与 Node 返回完全相同的 HTML、输入和哈希。
- 字体与图片的固定 hash、来源和再生成方法见 `src/renderer/fixtures/README.md`。

在 backend 目录执行：

```powershell
npm ci
npx playwright install chromium --only-shell
npm run typecheck
npm run build
npx tsx --test test/renderer.test.ts test/renderer.browser.test.ts
npx tsx src/renderer/review-samples.ts
```

根目录若通过 junction 复用前端 node_modules，禁止对该 junction 执行 npm ci；backend 有独立 node_modules。安装浏览器是开发/部署准备，正式渲染时不下载任何资源。

`review-samples.ts` 固定使用合成输入，连续启动三次独立浏览器并输出到 `backend/.data/renderer-review-samples/`：`input.json`、每轮 HTML/JSON、每轮两个 Frame PNG、`consistency.json`。它断言 HTML/hash、布局/hash、每帧解码 RGBA 像素与 PNG 字节一致。像素 hash 包含宽、高、通道数和 raw RGBA hash，避免把 PNG 元数据或压缩方式当作像素一致性的证据。

负面覆盖：缺图、缺字体、字节 hash 不符、坏字体、缺字、浏览器拒绝字体、图片 decode 失败、非法布局、前景遮挡、越框、文字溢出、raw CSS/HTML 注入与局部 width 覆盖。失败码及定位存于 `issues`，包含稳定 Section/Frame/blockId。

## 本叶子尚未覆盖

PDF/JPG/WebP 编码、长图拼接、切片策略、正式文件 QA、ExportPackage/Manifest、生产批准、API/前端集成、RulePack 业务预检、事实/布局变更传播不属于本叶子。不同 OS、GPU/驱动、Chromium 或字体版本间的像素一致性尚未证明。首个代表章节之外的全部产品章节和高级排版属性仍需后续工作包验证。
