# 图匠AI - 电商详情页AI生成平台 需求拆解文档

## 产品概述

- **产品类型**: AI生图SaaS工具平台（电商主图/详情图生成）
- **场景类型**: <scene_type>prototype-app</scene_type>
- **目标用户**: 电商运营、设计师、商家，需要快速生成商品主图和详情页
- **核心价值**: 通过AI快速生成高质量电商主图和详情图，降低设计成本，提升上新效率
- **界面语言**: 中文
- **主题偏好**: 浅色（现代简洁，蓝紫渐变主色调）
- **导航模式**: 路径导航
- **导航布局**: Sidebar（左侧固定导航栏）

---

## 页面结构总览

> **说明**：所有页面共享左侧 Sidebar 导航 + 中间主内容区 +（主图全案页时）右侧案例展示区的三栏布局

| 页面名称 | 文件名 | 路由 | 页面类型 | 入口来源 |
|---------|-------|------|---------|---------|
| AI主图详情全案 | `MasterPlanPage.tsx` | `/` | 一级 | 导航 |
| AI克隆大师 | `CloneMasterPage.tsx` | `/clone` | 一级 | 导航 |
| AI创图工坊 | `CreateWorkshopPage.tsx` | `/create` | 一级 | 导航 |
| AI工具箱 | `ToolboxPage.tsx` | `/tools` | 一级 | 导航 |
| 历史记录 | `HistoryPage.tsx` | `/history` | 一级 | 导航 |
| 钱包 | `WalletPage.tsx` | `/wallet` | 一级 | 导航 |

> **布局特殊说明**：AI主图详情全案页为三栏布局（Sidebar + 主内容区 + 右侧案例展示区），其余页面为两栏布局（Sidebar + 主内容区）。

---

## 页面布局建议

### AI主图详情全案页（5步向导）
- **布局模式**: 三栏布局（左侧导航 + 中间向导主区 + 右侧案例展示区）—— 中间为5步流程向导，右侧提供风格/案例参考
- **视觉重心**: 中间向导内容区 —— 用户按步骤完成配置和生成
- **结果承载区**: 第5步结果面板（任务概览 + 进度条 + 生成结果网格）；初始态为第1步选择图片类型

### AI克隆大师页
- **布局模式**: 左右分栏 —— 左侧为配置区（模式选择 + 素材上传 + 参数设置），右侧为任务面板（概览 + 进度 + 结果）
- **视觉重心**: 左侧配置区 + 右侧结果区并重，用户配置后实时查看任务状态
- **结果承载区**: 右侧任务面板（任务概览卡片 + 进度状态 + 生成结果网格）；初始态为待配置空状态

### 其余页面
- **布局模式**: 单栏居中内容区
- **视觉重心**: 页面内容主体
- **结果承载区**: 对应内容（工具卡片/历史列表/充值套餐）

---

## 插件规划

> **说明**：用户明确要求"AI生图能力用模拟数据展示流程即可，不需要真实调用AI模型"，因此本原型不涉及真实插件调用，所有AI能力均为 demo-mock 模拟。无插件规划章节。

---

## 导航配置

- **导航布局**: Sidebar（左侧固定）
- **导航结构**: 顶部Logo区 → 功能菜单区 → 底部用户信息区
- **导航项**:

| 导航文字 | 路由 | 图标 |
|---------|------|------|
| AI主图详情全案 | `/` | Image |
| AI克隆大师 | `/clone` | Copy |
| AI创图工坊 | `/create` | Sparkles |
| AI工具箱 | `/tools` | Wrench |
| 历史记录 | `/history` | History |
| 钱包 | `/wallet` | Wallet |

---

## 数据来源声明

| 数据/操作 | 来源类型 | 实现要求 | mock 兜底 |
|---|---|---|---|
| 主图详情全案5步向导状态 | local-persist | localStorage key=`__app_tujiang_masterplan_state`，保存当前步骤和表单数据，支持刷新后恢复 | 初始为 step=1 + 默认选项 |
| 上传的产品图片（主图全案） | real-file | FileReader 读取本地文件，生成缩略图 DataURL 存入 state | 无（用户不上传则为空） |
| 上传的产品/竞品图片（克隆大师） | real-file | FileReader 读取本地文件，生成缩略图 DataURL 存入 state | 无（用户不上传则为空） |
| 风格模板数据 | demo-mock | `src/data/styles.ts` 定义 12+ 风格卡片数据（名称、描述、分类、预览图URL） | ✅ 本身就是 mock |
| 生成结果图片（主图全案） | demo-mock | 用 picsum.photos 随机图模拟生成结果，setTimeout 模拟3秒生成进度 | ✅ 本身就是 mock |
| 生成结果图片（克隆大师） | demo-mock | 用 picsum.photos 随机图模拟克隆结果 | ✅ 本身就是 mock |
| 历史生成记录 | demo-mock | `src/data/history.ts` 定义模拟历史记录列表（时间、类型、缩略图、积分消耗） | ✅ 本身就是 mock |
| 钱包积分余额 | local-persist | localStorage key=`__app_tujiang_credits`，初始值500 | 初始 500 积分 |
| 充值套餐列表 | demo-mock | `src/data/packages.ts` 定义4档套餐 | ✅ 本身就是 mock |
| 工具箱工具列表 | demo-mock | `src/data/tools.ts` 定义4个工具卡片 | ✅ 本身就是 mock |
| 结果图片下载 | import-export | 单张下载用 a.download + picsum 图；打包下载用 JSZip 批量打包触发下载 | 无 |

---

## 功能列表

### 全局布局（Sidebar + 主内容区）

- **页面目标**: 提供统一的导航框架和页面切换能力
- **功能点**:
  - **侧边栏导航切换**: 点击左侧菜单项切换路由，高亮当前选中项，主内容区对应渲染
  - **用户信息区展示**: 侧边栏底部显示用户头像、昵称、积分余额
  - **响应式布局适配**: 桌面端三栏/两栏布局，宽度自适应

### 页面：AI主图详情全案（5步向导）

- **页面目标**: 引导用户通过5步流程生成电商主图和详情图
- **功能点**:
  - **步骤指示器**: 顶部显示1-2-3-4-5步骤条，当前步骤高亮，已完成步骤打勾
  - **第1步 - 图片类型选择**: 商品主图/详情图两个可勾选卡片，各带数量选择（单选组）和无文案模式复选框；主图尺寸、详情图尺寸各一组单选按钮
  - **第2步 - 产品图上传**: 大尺寸拖拽上传区（支持点击选文件+拖拽上传），上传后缩略图网格展示，每张图带删除按钮，限制1-5张
  - **第3步 - 风格模板选择**: 顶部分类标签切换（全部/家居家具/3C数码/服装服饰/美妆护肤/食品生鲜），下方风格卡片网格（12个），点击选中高亮边框
  - **第4步 - 产品信息填写**: 表单含产品名称输入框、核心卖点多行文本域（每行一个）、产品参数键值对动态表（可添加/删除行）、目标平台多选框组；无文案模式开关控制文案字段显隐
  - **第5步 - 生成结果展示**: 顶部任务概览卡片（图片类型/数量/风格/预计积分），中间生成进度条（模拟3秒从0到100%），完成后主图+详情图结果网格，每张图支持点击放大预览和单独下载，底部一键打包下载+重新生成按钮
  - **步骤导航按钮**: 底部固定上一步/下一步按钮，第1步上一步禁用，第4步下一步变为"开始生成"，第5步变为重新生成

### 页面：AI主图详情全案 - 右侧案例展示区

- **页面目标**: 在用户配置过程中提供参考案例，辅助风格选择
- **功能点**:
  - **案例展示**: 垂直滚动的案例图片流，展示不同风格的电商主图效果示例
  - **与步骤联动**: 根据当前步骤展示对应阶段的参考案例

### 页面：AI克隆大师

- **页面目标**: 让用户通过参考竞品图快速生成自家产品的营销图
- **功能点**:
  - **克隆模式选择**: 三种模式卡片横向排列（一键克隆/自定义克隆/无文案克隆），点击选中高亮
  - **双素材上传区**: 左侧"自己产品图"上传区（1-5张）+ 右侧"竞品营销图"上传区（1-20张），并排布局，各支持拖拽+点击上传+缩略图展示+删除
  - **克隆参数配置**: 图片比例下拉选择（10种比例）、高仿模式开关
  - **任务概览面板**: 实时显示产品图数、竞品图数、预计生图积分、当前模式
  - **生成进度与结果**: 进度状态（克隆词→成图两步），完成后显示成功计数和结果缩略图网格，支持一键打包下载
  - **开始克隆按钮**: 底部主操作按钮，点击后触发生成流程（模拟）

### 页面：AI创图工坊（占位页）

- **页面目标**: 预告未来功能
- **功能点**:
  - **占位展示**: 居中显示"通用AI绘图，敬请期待"文案 + 装饰图标

### 页面：AI工具箱

- **页面目标**: 展示可用的AI图片工具
- **功能点**:
  - **工具卡片网格**: 4个工具卡片（智能抠图、图片放大、背景替换、图片修复），含图标+名称+简短描述，点击弹出"敬请期待"提示（toast）

### 页面：历史记录

- **页面目标**: 展示用户过往生成记录
- **功能点**:
  - **历史记录列表**: 卡片式列表，每条记录含生成时间、任务类型、缩略图、积分消耗、状态标签
  - **记录操作**: 每条记录带"查看详情"和"重新生成"操作（toast 提示）

### 页面：钱包

- **页面目标**: 展示积分余额和充值选项
- **功能点**:
  - **积分余额展示**: 顶部大卡片显示当前积分余额（500）
  - **充值套餐列表**: 4档套餐卡片（49元=3300积分 / 99元=8300积分 / 199元=20000积分 / 499元=68000积分），点击弹出确认充值弹窗（模拟，toast 提示）

---

## 数据共享配置

| 存储键名 | 数据说明 | 使用页面 |
|---------|---------|---------|
| `__app_tujiang_credits` | 积分余额，类型为 `number` | Sidebar用户信息区、主图全案第5步、克隆大师、钱包页 |
| `__app_tujiang_masterplan_state` | 主图全案向导状态，类型为 `IMasterPlanState` | 主图全案页 |
| `__app_tujiang_history` | 历史生成记录，类型为 `IHistoryRecord[]` | 历史记录页、主图全案生成后追加、克隆大师生成后追加 |

```ts
// 主图全案向导状态
interface IMasterPlanState {
  currentStep: number; // 1-5
  imageTypes: {
    mainImage: {
      enabled: boolean;
      count: 1 | 6 | 9;
      noCopy: boolean;
      size: '2k-1-1' | '2k-3-4' | 'banana-2k-1-1';
    };
    detailImage: {
      enabled: boolean;
      count: 6 | 8 | 10;
      noCopy: boolean;
      size: '2k-3-4' | '1k-9-16' | '2k-9-16';
    };
  };
  productImages: string[]; // DataURL 数组
  selectedStyleId: string;
  productInfo: {
    name: string;
    sellingPoints: string[];
    params: { key: string; value: string }[];
    platforms: string[];
    noCopyMode: boolean;
  };
}

// 历史记录
interface IHistoryRecord {
  id: string;
  type: 'masterplan' | 'clone';
  typeLabel: string;
  thumbnail: string;
  creditsCost: number;
  status: 'success' | 'failed' | 'processing';
  createdAt: string;
  imageCount: number;
}

-------

<scene_type>prototype-app</scene_type>

# UI 设计指南

## 1. 设计推导依据

- **参考意图**: Mood Reference —— 参考无量 AI 的产品气质与功能结构，迁移其"AI 生图工作台"的清爽科技感，不做像素级复刻。
- **核心情绪 / 应用类型**: 电商 AI 创作工具，用户在向导式任务流中快速生成商品视觉，情绪是"专业、高效、有创造力的期待"。
- **独特记忆点**: 左侧导航 + 中间任务流 + 右侧案例预览的三栏布局，配合蓝紫渐变主按钮与柔和玻璃感卡片，强化"AI 创作工作台"的专业印象。

## 2. Art Direction

- **方向名**: 柔光科技工作台
- **Design Style**: Soft Glass + Gradient Accent —— 卡片柔和半透明质感 + 蓝紫渐变主交互，适合 AI 创意工具，既有科技感又不压迫。
- **DNA 参数**: 圆角 `rounded-xl`（卡片）/ `rounded-full`（按钮、徽章）；阴影 `shadow-sm` ~ `shadow-md`（柔和扩散，低不透明度）；间距标准 `gap-4 / p-6`；字体方向无衬线现代清晰；装饰手法为渐变按钮、细发光边框（选中态）、微光背景。
- **应用类型**: Workflow —— 三栏壳 + 步骤向导，强调任务推进与结果预览。

## 3. Color System

**色彩关系**: 蓝紫渐变主色（靛蓝→紫）+ 极浅冷灰背景 + 纯白卡片 + 柔和蓝紫 accent 反馈底，整体冷调科技感但不刺眼。
**配色设计理由**: 蓝紫渐变是 AI 创作产品的经典识别色，传达"智能、创意、未来感"；背景用极浅冷灰降低眼疲劳，卡片纯白保证表单与图片内容清晰；accent 用低饱和蓝紫承接 hover / 选中浅底，避免 primary 滥用。
**主色推导**: 从电商 AI 生图的"智能创作"语义出发，取靛蓝 hsl(230 85% 60%) 为起点，向紫色 hsl(265 85% 65%) 渐变，形成品牌识别梯度；中性色从冷灰推导，保持整体色温一致。
**使用比例**: 60% 中性（bg/card/text/border）/ 30% 辅助（accent 及浅底）/ 10% primary（渐变主按钮、激活态、品牌锚点）；主按钮与步骤激活用渐变，tab/选中边框用单色 primary，icon/链接用 textMuted 或 accentForeground。

| 角色 | CSS 变量 | Tailwind Class | HSL 值 | 设计说明 |
|---|---|---|---|---|
| bg | `--background` | `bg-background` | hsl(230 30% 97%) | 页面背景，极浅冷灰带微蓝调 |
| card | `--card` | `bg-card` | hsl(0 0% 100%) | 卡片、表单、弹层承载面 |
| text | `--foreground` | `text-foreground` | hsl(225 25% 14%) | 标题和正文，深灰近黑 |
| textMuted | `--muted-foreground` | `text-muted-foreground` | hsl(225 10% 48%) | 占位符、辅助说明、元信息 |
| primary | `--primary` | `bg-primary` / `text-primary` | hsl(245 80% 58%) | 主交互、CTA、激活态（按钮用蓝→紫渐变） |
| primaryForeground | `--primary-foreground` | `text-primary-foreground` | hsl(0 0% 100%) | primary 上的文字图标 |
| accent | `--accent` | `bg-accent` | hsl(240 25% 95%) | hover/focus 浅底、菜单项选中浅底 |
| accentForeground | `--accent-foreground` | `text-accent-foreground` | hsl(245 40% 35%) | accent 上的文字和图标 |
| border | `--border` | `border-border` | hsl(230 15% 90%) | 输入框、卡片、菜单边界 |

**语义色提示**: 成功 hsl(150 55% 45%)，三态：bg hsl(150 60% 95%) / border hsl(150 50% 80%) / text hsl(150 55% 35%)；警告 hsl(38 90% 55%)，三态：bg hsl(45 90% 95%) / border hsl(40 85% 80%) / text hsl(30 85% 35%)；错误 hsl(0 75% 55%)，三态：bg hsl(0 70% 96%) / border hsl(0 65% 85%) / text hsl(0 70% 45%)；所有语义色饱和度控制在 55-90%，与 primary 的 80% 饱和度对齐，不出现过艳跳色。

## 4. 字体与节奏

- **font-display**: Noto Sans SC / Inter —— 现代无衬线，清晰中性，适合工具产品标题与品牌字。
- **font-body**: Noto Sans SC / Inter —— 正文长时间阅读舒适，表单标签与说明文字层级清晰。
- **字号**: H1 text-2xl ~ text-3xl（页面标题）；H2 text-lg ~ text-xl（区块标题）；body text-sm ~ text-base；muted text-xs ~ text-sm。
- **圆角**: 大 —— 卡片 `rounded-xl`、按钮 `rounded-full`、输入框 `rounded-lg`，呼应柔和科技气质。

## 5. 全局布局契约

- **Reference Layout Use**: 参考无量 AI 的三栏工作台结构（左侧导航 + 中间任务流 + 右侧案例），视觉语言自主定义。
- **Page / Section Order**: 左侧菜单 6 项与需求一一对应；AI 主图详情全案为 5 步向导纵向推进；AI 克隆大师为单页分区配置。
- **Standard Content Zone**: 中间主内容区 `max-w-3xl` + `mx-auto`，适合向导式表单与结果展示；右侧案例区独立宽度约 320px。
- **Shell / Frame Alignment**: 左栏固定宽 240px，右栏固定宽 320px（仅主图详情页显示），中间内容区自适应；三栏同高独立滚动。
- **Padding & Rhythm**: `px-6 py-8`，卡片内 `p-6`，步骤间 `space-y-6`，保持 8px 倍数。
- **Full-bleed Zones**: 无全宽 Hero；上传区、结果网格在卡片容器内全宽。
- **Local Narrowing**: 第 4 步表单控制在 `max-w-xl` 内居中，避免输入框过宽。
- **Overflow Strategy**: 风格卡片网格、结果图片网格用自动换行；步骤指示器窄屏下 `overflow-x-auto`。
- **Flexibility Boundary**: 允许移动端折叠左侧导航为图标栏、隐藏右侧案例区；不允许改变主色、圆角、阴影语言。

## 6. 视觉与动效

- **装饰**: 渐变光晕（主按钮 hover 时微光扩散）、细发光边框（选中卡片）、极淡网格背景（可选）。
- **阴影/边界**: 轻 —— 默认 `shadow-sm`，hover / 选中态 `shadow-md` + 1px 发光边框；卡片以白底 + 细边为主，不靠重阴影分层。
- **动效**: 精致克制 —— hover 提升 2px + 阴影加深 150ms；步骤切换用淡入 + 轻微位移 200ms；进度条用平滑 ease-out 3s 填充；生成结果用 stagger 淡入。

## 7. 组件原则

- 按钮主操作用蓝紫渐变（from-indigo-500 to-purple-500），次操作用 outline + border，ghost 操作用 accent 底。
- 风格卡片、克隆模式卡片选中态：2px primary 边框 + 极淡 primary 底色 + 角标对勾，不依赖纯颜色。
- 上传区：虚线边框 + hover 实化 + accent 底色，拖拽时高亮边框。
- 步骤指示器：未完成态用灰色圆圈 + textMuted，当前态用渐变填充圆圈 + 加粗文字，完成态用对勾图标 + primary 色。
- 所有交互元素必须有 `focus-visible` 环（2px primary 外发光）。

## 8. Image Direction

- **Image Role**: 风格模板预览图 / 生成结果占位图 / 右侧案例展示图 —— 是产品核心内容与决策依据，权重高。
- **Image Art Direction**: 电商商品摄影级质感，构图以产品为绝对中心，背景简洁有氛围；不同风格卡片有明确视觉区分（北欧=浅木+柔光；赛博朋克=霓虹+深色；国潮=红金+宣纸纹理）；光线自然柔和，材质表达真实；整体调性是"专业电商主图"而非通用 AI 插画。
- **Image Prompt Keywords**: commercial product photography, studio lighting, clean composition, e-commerce main image, minimalist background, soft shadow, premium texture, lifestyle context, category-specific set design
- **Image Avoidance**: 避免无主体的抽象渐变图、廉价素材图库感摆拍、过度夸张的 AI 怪诞细节、低分辨率模糊图、与风格名称不符的混搭画面。

## 9. Anti-patterns

- **Gradient everywhere**: 把蓝紫渐变铺到背景、卡片、边框、icon 各处；渐变只留给主按钮、步骤激活态、少量品牌锚点。
- **Card bloat**: 每个小组件都套卡片加阴影，导致页面层层叠叠；表单内字段用分隔线或间距分层，不嵌套卡片。
- **Wizard drift**: 5 步向导每步布局、按钮位置、进度条位置不一致；底部操作栏固定模式，上一步左对齐、下一步右对齐。
- **Muted too faint**: 辅助文字对比度低于 3:1，老人或强光下看不见；textMuted 始终保持 ≥ 3:1。
- **Upload dead zone**: 上传区只有点击按钮能触发，大面积区域不可点；整个虚线框均可点击 + 支持拖拽。
- **Result gallery chaos**: 生成结果图大小不一、间距乱、无分类标题；主图与详情图分区展示，统一网格尺寸。