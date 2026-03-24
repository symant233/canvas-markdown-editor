# Canvas Markdown Editor

基于纯 Canvas 渲染的所见即所得 (WYSIWYG) Markdown 编辑器。所有文本、光标、选区、IME 组合文本均在 Canvas 上绘制，不使用任何可见 DOM 元素参与内容渲染。

## 架构概览

```mermaid
graph TB
  subgraph AppLayer ["应用层"]
    App["App.tsx<br/>React 组件 / refs + state"]
    EditorMgr["EditorManager<br/>画布管理 / 事件注册 / 生命周期"]
    Scrollbar["Scrollbar<br/>自定义滚动条组件"]
  end

  subgraph InputLayer ["输入与交互层"]
    EventDispatcher["EventDispatcher<br/>事件中心 / 状态管理"]
    InputManager["InputManager<br/>隐藏 textarea"]
    KeyboardHandler["KeyboardHandler<br/>快捷键 / 方向键"]
    HitTester["HitTester<br/>点击定位"]
  end

  subgraph DataLayer ["数据层"]
    BlockStore["BlockStore<br/>块管理器 / 单一数据源"]
    InlineParser["InlineParser<br/>实时内联 Markdown 解析"]
    MarkdownParser["MarkdownParser<br/>块级解析"]
  end

  subgraph LayoutLayer ["布局层"]
    TextMeasurer["TextMeasurer<br/>离屏 Canvas 文本测量"]
    LayoutEngine["LayoutEngine<br/>文档流布局 / 自动换行"]
  end

  subgraph RenderLayer ["渲染层 - 双层 Canvas"]
    StaticCanvas["StaticCanvas<br/>内容渲染"]
    SelectionCanvas["SelectionCanvas<br/>光标 / 选区 / IME"]
  end

  App -->|"init()"| EditorMgr
  App --> Scrollbar
  EditorMgr -->|"创建 + 管理"| InputManager
  EditorMgr -->|"pointer/wheel/resize"| EventDispatcher
  EditorMgr -->|"渲染"| StaticCanvas
  EditorMgr -->|"渲染"| SelectionCanvas
  EditorMgr -->|"React 状态回调"| App
  InputManager -->|"textarea 事件"| EventDispatcher
  EventDispatcher -->|"键盘处理"| KeyboardHandler
  EventDispatcher -->|"点击定位"| HitTester
  EventDispatcher -->|"数据修改"| BlockStore
  EventDispatcher -->|"重排布局"| LayoutEngine
  EventDispatcher -->|"渲染通知"| EditorMgr
  MarkdownParser --> BlockStore
  InlineParser --> BlockStore
  BlockStore --> LayoutEngine
  TextMeasurer --> LayoutEngine
  LayoutEngine --> StaticCanvas
  LayoutEngine --> SelectionCanvas
```

## 核心设计理念

- **纯 Canvas 渲染**：全部内容通过 Canvas 2D API 绘制，包括光标闪烁、选区高亮、IME 组合文本
- **隐藏 textarea 输入**：一个不可见的 `<textarea>` 仅用于接收键盘事件、IME 组合和剪贴板操作
- **数据驱动**：所有编辑操作修改数据模型 (Block)，Canvas 根据数据重渲染
- **Source/Visual 双坐标空间**：光标和编辑操作在 Source 空间（含 Markdown 标记符），渲染和布局在 Visual 空间（不含标记符）

## 项目结构

```
src/
├── App.tsx                          # 主组件（~60 行），refs + init() + JSX
├── App.css                          # 布局与滚动条样式
├── editor/
│   ├── EditorManager.ts             # 画布管理类 + 核心模块单例
├── components/
│   └── Scrollbar.tsx                # 自定义滚动条组件
├── core/
│   ├── types.ts                     # 核心类型定义
│   ├── BlockStore.ts                # 块数据管理器
│   ├── InlineParser.ts              # 实时内联 Markdown 解析
│   ├── MarkdownParser.ts            # 块级 Markdown 解析
│   ├── MarkdownShortcuts.ts         # 块级快捷键检测与应用
│   ├── BlockSerializer.ts           # Block -> Markdown 序列化
│   ├── TextMeasurer.ts              # 文本宽度测量（离屏 Canvas）
│   ├── LayoutEngine.ts              # 文档流布局引擎
│   ├── StaticCanvasRenderer.ts      # 静态内容渲染器
│   ├── SelectionCanvasRenderer.ts   # 光标 / 选区渲染器
│   ├── InputManager.ts              # 隐藏 textarea 管理
│   ├── KeyboardHandler.ts           # 键盘事件处理
│   ├── HitTester.ts                 # 点击位置 -> 光标定位
│   ├── CoordTransformer.ts          # 坐标系转换
│   ├── ScrollHelper.ts              # 滚动截屏几何拆分算法
│   ├── SyntaxHighlighter.ts         # 代码块语法高亮（highlight.js）
│   └── EventDispatcher.ts           # 事件派发与状态管理
```

## 数据模型

### Block 体系

编辑器以 **Block（块）** 为基本单位管理文档内容：

```typescript
interface Block {
  id: string;
  type: BlockType;         // 'paragraph' | 'heading-1' | ... | 'code-block' | 'hr'
  rawText: string;         // Markdown 源文本（含标记符），单一数据源
  inlines: InlineSegment[];// 解析后的内联样式片段（用于渲染）
  layout: BlockLayout | null;
  sourceToVisual: number[];// rawText 偏移 -> 渲染文本偏移
  visualToSource: number[];// 渲染文本偏移 -> rawText 偏移
}
```

支持的块类型：`paragraph`、`heading-1/2/3`、`bullet-list`、`ordered-list`、`code-block`、`blockquote`、`hr`

### Source/Visual 双坐标空间

这是编辑器最核心的设计之一。`rawText` 保留 Markdown 标记符作为数据源，渲染时解析为不含标记符的视觉文本。

```mermaid
flowchart LR
  subgraph Source ["Source 空间 rawText"]
    S["hello **world** = 15 字符"]
  end
  subgraph Visual ["Visual 空间 渲染文本"]
    V["hello world = 11 字符<br/>world 加粗"]
  end
  Source -- "sourceToVisual[]" --> Visual
  Visual -- "visualToSource[]" --> Source
```

| 操作 | 转换方向 | 说明 |
|------|----------|------|
| 渲染光标/选区 | source -> visual | 将光标 source 偏移转为像素位置 |
| 点击定位 | visual -> source | HitTester 从像素位置转回 source 偏移 |
| 上下键/行首行尾 | source -> visual -> 计算 -> source | 双向转换 |
| 左右键 | source 空间内跳过标记符 | 防止光标卡在不可见字符上 |

## 渲染架构

### 双层 Canvas

```
┌─────────────────────────────────────┐
│  editor-container                   │
│  ┌───────────────────────────────┐  │
│  │  StaticCanvas (z-index: 1)    │  │
│  │  渲染所有 Markdown 内容          │  │
│  ├───────────────────────────────┤  │
│  │  SelectionCanvas (z-index: 2) │  │
│  │  渲染光标、选区、IME 组合文本      │  │
│  │  接收所有指针事件               │  │
│  ├───────────────────────────────┤  │
│  │  Scrollbar (z-index: 10)      │  │
│  │  自定义滚动条                   │  │
│  └───────────────────────────────┘  │
│  <textarea style="opacity:0" />     │
│  隐藏输入接收器（IME / 剪贴板）       │
└─────────────────────────────────────┘
```

- **StaticCanvas**：渲染文档内容（标题、段落、列表、代码块等），仅在数据变化时重绘
- **SelectionCanvas**：渲染光标（530ms 闪烁）、选区高亮、IME 组合文本下划线，高频更新不影响内容层

### 渲染流程

```mermaid
sequenceDiagram
  participant User as 用户
  participant Input as 隐藏 textarea
  participant Store as BlockStore
  participant Parser as InlineParser
  participant Layout as LayoutEngine
  participant Static as StaticCanvas
  participant Selection as SelectionCanvas

  User->>Selection: 点击 Canvas
  Selection->>Selection: HitTester 定位光标
  Selection->>Input: focus 隐藏 textarea

  User->>Input: 键入字符
  Input->>Store: insertTextAtCursor
  Store->>Store: 修改 rawText
  Store->>Parser: reparseBlock
  Parser-->>Store: 生成 inlines + 偏移映射
  Store->>Layout: 增量 reflowFrom
  Layout-->>Static: 重绘内容
  Layout-->>Selection: 更新光标位置
```

## 布局引擎

`LayoutEngine` 将 Block 数据转换为可渲染的空间信息：

- **文档流布局**：Block 按顺序纵向排列，每个 Block 的 y 坐标由前一个 Block 的底部决定
- **自动换行**：根据容器宽度和 `TextMeasurer` 的字符宽度数据，将文本拆分为多行
- **增量重排**：仅从修改的 Block 开始向下重新计算，未修改的 Block 保持缓存
- **块类型特殊处理**：列表缩进、代码块内边距、引用缩进、HR 固定高度等
- **换行标记**：`LineLayout.newlineBefore` 标志区分代码块内的 `\n` 换行和自动换行

### 各块类型渲染策略

| 块类型 | 字体 | 特殊绘制 |
|--------|------|----------|
| heading-1 | 32px bold | 大号加粗标题 |
| heading-2 | 24px bold | 中号加粗标题 |
| heading-3 | 20px bold | 小号加粗标题 |
| paragraph | 16px normal | 内联样式混排 |
| code-block | 14px monospace | 圆角背景矩形 + 等宽字体 |
| bullet-list | 16px normal | 圆点前缀 + 缩进 |
| ordered-list | 16px normal | 递增数字前缀 + 缩进 |
| blockquote | 16px normal | 左侧 3px 竖线 + 灰色文字 |
| hr | 无文字 | 居中水平线 |

## 编辑交互

### 输入处理链路

```mermaid
flowchart TD
  PointerDown["鼠标点击"] --> HitTest["HitTester.hitPosition"]
  HitTest --> SetCursor["设置光标位置<br/>Source 空间"]
  SetCursor --> FocusTA["focus 隐藏 textarea"]

  Typing["键盘输入"] --> InputEvent["input 事件"]
  InputEvent --> InsertText["BlockStore.insertTextAtCursor"]
  InsertText --> Reparse["reparseBlock<br/>InlineParser 重新解析"]
  Reparse --> Reflow["LayoutEngine.reflowFrom<br/>增量重排"]
  Reflow --> Render["Canvas 重绘"]

  IME["IME 组合输入"] --> CompStart["compositionstart"]
  CompStart --> CompUpdate["compositionupdate<br/>临时注入 block 重新布局渲染"]
  CompUpdate --> CompEnd["compositionend<br/>提交最终文本"]
  CompEnd --> InsertText

  KeyDown["键盘事件"] --> KBHandler["KeyboardHandler"]
  KBHandler --> |"方向键"| MoveCursor["移动光标<br/>跳过标记符"]
  KBHandler --> |"Backspace/Delete"| DeleteChar["删除字符/合并块"]
  KBHandler --> |"Enter"| SplitBlock["拆分块/列表续行"]
  KBHandler --> |"Tab"| Indent["缩进/反缩进"]
  KBHandler --> |"Ctrl+B/I/U, Ctrl+Shift+S"| Format["切换加粗/斜体/下划线/删除线"]
```

### 块级快捷键

实时检测输入的 Markdown 语法并转换块类型：

| 输入 | 转换为 |
|------|--------|
| `# ` | heading-1 |
| `## ` | heading-2 |
| `### ` | heading-3 |
| `- ` 或 `* ` | bullet-list |
| `1. ` | ordered-list |
| `> ` | blockquote |
| `---` | hr |
| ` ``` ` | code-block |

### 内联格式化

| 快捷键 | Markdown 语法 | 效果 |
|--------|---------------|------|
| `Ctrl+B` | `**text**` | **加粗** |
| `Ctrl+I` | `*text*` | *斜体* |
| `Ctrl+U` | `++text++` | 下划线 |
| `Ctrl+Shift+S` | `~~text~~` | ~~删除线~~ |

### 代码块特殊行为

- **语言标记**：`` ```javascript `` 快捷键创建带语言的代码块，序列化时保留语言标记
- **语法高亮**：使用 `highlight.js` 对代码块进行语法着色渲染
- **Enter**：在代码块内插入 `\n`（而非创建新块），继续在代码块内编辑
- **双次 Enter 退出**：末尾连续两次回车（`\n\n`）退出代码块，创建新段落
- **Tab 缩进**：只影响光标所在行，不影响其他行

### 引用块特殊行为

- **Enter**：在引用块内插入 `\n`，继续在同一引用块内编辑
- **双次 Enter 退出**：末尾连续两次回车退出引用块，创建新段落

### 列表续行

- 在列表项上按 Enter 自动创建同类型的新列表项
- 在空列表项上按 Enter 退出列表，转为普通段落

### 块首键盘行为

- **Backspace**：非 paragraph 块在行首按 Backspace 降级为 paragraph，paragraph 块则合并到上一块
- **Enter**：在块首按 Enter 在上方插入空块（列表/引用继承同类型，其他为 paragraph）

### HR (分割线) 交互

- 方向键可以跳过 HR 到达上下方的块
- Delete/Backspace 可以删除相邻的 HR

## 组件与管理架构

### EditorManager

`EditorManager` 是画布管理类，负责 Canvas 渲染、事件注册和生命周期管理。核心模块（BlockStore、LayoutEngine 等）作为模块级单例在 `EditorManager.ts` 中创建，保证只实例化一次。

- **`init(container, staticCanvas, selectionCanvas, initialMarkdown, callbacks)`**：一次调用完成所有初始化
  - 解析初始 Markdown 内容
  - 注入 dispatcher 回调
  - 创建 InputManager
  - 注册 pointer/wheel/resize/keydown 事件（原生方式）
  - 执行首次布局和渲染
  - 返回 cleanup 函数

- **React 状态回调**：通过 `callbacks` 参数注入 `onRawMarkdownChange` 和 `onScrollStateChange`，供 Markdown 源码面板和滚动条同步状态

### EventDispatcher

`EventDispatcher` 是编辑器的事件中心和状态管理器：

- **集中管理 `EditorState`**：`cursor`、`selection`、`compositionText`、`isDragging`、`scrollY`
- **统一事件入口**：`handleTextInput`、`handleKeyDown`、`handlePointerDown/Move/Up`、`handleWheel` 等
- **渲染通知**：通过 `onRender` 发出三种渲染请求：
  - `selectionOnly`：仅重绘光标/选区层
  - `full`：重绘两层 Canvas + 同步 Markdown + 更新滚动条
  - `scroll`：滚动位置变化
- **内部协调**：自动调用 BlockStore 修改数据、LayoutEngine 重排布局、MarkdownShortcuts 检查快捷键

```mermaid
flowchart TD
  Click["用户点击 Canvas"] --> EM["EditorManager"]
  EM -->|"pointer 事件"| ED["EventDispatcher"]
  InputMgr["InputManager textarea"] -->|"input/IME/clipboard"| ED
  WindowKey["window keydown"] -->|"via EditorManager"| ED
  Wheel["鼠标滚轮"] -->|"via EditorManager"| ED
  ED -->|"hitTest"| HT["HitTester"]
  ED -->|"键盘处理"| KH["KeyboardHandler"]
  ED -->|"数据修改"| BS["BlockStore"]
  ED -->|"重排布局"| LE["LayoutEngine"]
  ED -->|"渲染通知"| EM
  EM -->|"React 状态回调"| App["App.tsx"]
```

### CoordTransformer

`CoordTransformer` 负责浏览器视口坐标与编辑器场景坐标之间的转换：

- **`browserToScene`**：浏览器坐标 − 容器偏移 + 滚动量 = 场景坐标
- **`sceneToBrowser`**：反向转换，用于需要将场景元素映射回屏幕位置的场景
- **`clampScroll`**：将滚动量钳制到合法范围 `[0, maxContentHeight - viewportHeight + 40]`
- **`isInViewport`**：判断场景中的元素是否在当前视口内可见（视口裁剪优化）

## 滚动管理

- **鼠标滚轮**：通过 `wheel` 事件更新 `scrollY`，Canvas 重绘时应用 `ctx.translate(0, -scrollY)`
- **自定义滚动条**：React `Scrollbar` 组件，支持拖拽滑块和点击轨道跳转
- **滚动条同步**：`scrollY`、`contentHeight`、`viewportHeight` 通过 React state 驱动滚动条更新

## 性能优化

| 策略 | 说明 |
|------|------|
| 双层 Canvas | 内容与交互分离，光标闪烁不重绘内容 |
| 增量 reflow | 仅从修改点开始重算布局 |
| **滚动截屏贴图** | 滚动时复用已绘制像素（blit），仅补画新露出条带，大幅减少渲染开销 |
| 文本测量缓存 | `TextMeasurer` 缓存相同 font+text 的测量结果 |
| DPR 处理 | `ctx.scale(dpr, dpr)` 保证高分屏清晰 |
| 偏移映射数组 | `sourceToVisual[]` / `visualToSource[]` O(1) 坐标转换 |
| IME 虚拟注入 | 组合输入期间临时注入文本参与布局，渲染后恢复，实现正确换行 |

### 滚动截屏贴图优化

滚动时不再全量重绘可视区，而是通过 `drawImage` 复用上一帧已绘制的像素，仅对新露出的条带执行 collect + render。

**核心流程：**

```
用户滚轮 → EventDispatcher.handleWheel(deltaY)
  → emit({ type: 'scroll', oldScrollY })
  → EditorManager.renderStaticScroll(oldScrollY)
    → StaticCanvasRenderer.renderScroll(ctx, blocks, vpH, dpr, oldScrollY, newScrollY)
      1. ScrollHelper.computeVerticalScrollBlit(old, new, vpH)
         → { blit: { srcY, dstY, height }, stripY, stripHeight }
      2. ctx.drawImage(canvas, srcRect, dstRect)  ← 像素搬运（'copy' 混合模式）
      3. clip(strip) → clearRect → translate(-newScrollY) → 仅绘制条带内的 block
```

**几何示意（向下滚动 deltaY）：**

```
   旧视口:  [oldScrollY ─────────── oldScrollY + vpH]
   新视口:       [newScrollY ─────────── newScrollY + vpH]
                 ↑ 交集区域可 blit 复用 ↑    ↑ 新条带需补画 ↑
```

**降级策略：**
- 滚动距离超过视口高度时自动退化为全量重绘
- 可通过 `staticRenderer.setScrollBlitEnabled(false)` 关闭该优化
- Selection 层（光标/选区）始终全量重绘（绘制极轻量，不值得优化）

**相关文件：**
- `src/core/ScrollHelper.ts` — 几何拆分算法（计算可复用区域与补画条带）
- `src/core/StaticCanvasRenderer.ts` — `renderScroll()` 方法实现 blit + 条带补画
- `src/core/EventDispatcher.ts` — scroll 事件携带 `oldScrollY`
- `src/editor/EditorManager.ts` — `renderStaticScroll()` 调度入口

## 焦点管理

编辑器支持焦点感知：当用户点击画布外部（如源码编辑面板）时，画布自动失焦，键盘事件不再影响画布内容。

- **失焦行为**：光标和选区立即隐藏，闪烁定时器跳过渲染
- **恢复焦点**：点击画布时调用 `InputManager.focus()` 重新聚焦隐藏 textarea，光标立即恢复
- **焦点检测**：`InputManager.focused` getter 检查 `document.activeElement === textarea`

## 技术栈

| 技术 | 用途 |
|------|------|
| React 19 | UI 框架（App 组件、滚动条、原始源码面板） |
| TypeScript | 类型安全 |
| Vite | 构建与 HMR |
| Canvas 2D API | 全部内容渲染 |

## 开发

```bash
npm install
npm run dev
```

编辑器运行在 `http://localhost:5173`（或下一个可用端口）。左侧为 Canvas 编辑区，右侧为 Markdown 源码调试面板。
