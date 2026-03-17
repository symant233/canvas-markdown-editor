import { useRef, useEffect, useCallback, useState } from 'react';
import { BlockStore } from './core/BlockStore';
import { MarkdownParser } from './core/MarkdownParser';
import { TextMeasurer } from './core/TextMeasurer';
import { LayoutEngine } from './core/LayoutEngine';
import { StaticCanvasRenderer } from './core/StaticCanvasRenderer';
import { SelectionCanvasRenderer } from './core/SelectionCanvasRenderer';
import { InputManager } from './core/InputManager';
import { KeyboardHandler } from './core/KeyboardHandler';
import { HitTester } from './core/HitTester';
import type { CursorPosition, SelectionRange } from './core/types';
import { checkBlockShortcut, applyBlockShortcut } from './core/MarkdownShortcuts';
import { blocksToMarkdown } from './core/BlockSerializer';
import './App.css';

/**
 * 自定义滚动条，内容高度超出视口时显示。
 * ratio = viewport/content，thumbHeight 至少 30px；拖拽通过 setPointerCapture 实现平滑拖动；点击轨道跳转到对应位置
 */
function Scrollbar({
  scrollY,
  contentHeight,
  viewportHeight,
  onScroll,
}: {
  scrollY: number;
  contentHeight: number;
  viewportHeight: number;
  onScroll: (scrollY: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ mouseY: 0, scrollY: 0 });

  if (contentHeight <= viewportHeight) return null;

  const ratio = viewportHeight / contentHeight; // 视口占比
  const thumbHeight = Math.max(30, viewportHeight * ratio);
  const maxThumbTop = viewportHeight - thumbHeight;
  const maxScroll = contentHeight - viewportHeight;
  const thumbTop = maxScroll > 0 ? (scrollY / maxScroll) * maxThumbTop : 0; // 滑块位置

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = true;
    dragStartRef.current = { mouseY: e.clientY, scrollY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId); // Pointer Capture 保证拖出轨道仍能接收 move/up
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const deltaY = e.clientY - dragStartRef.current.mouseY;
    const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
    const newScroll = Math.max(0, Math.min(maxScroll, dragStartRef.current.scrollY + scrollDelta));
    onScroll(newScroll);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (e.target !== trackRef.current) return;
    const rect = trackRef.current!.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const targetScroll = (clickY / viewportHeight) * maxScroll; // 点击轨道跳转到对应文档位置
    onScroll(Math.max(0, Math.min(maxScroll, targetScroll)));
  };

  return (
    <div
      className="scrollbar-track"
      ref={trackRef}
      onClick={handleTrackClick}
    >
      <div
        className="scrollbar-thumb"
        style={{ top: thumbTop, height: thumbHeight }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}

const SAMPLE_MARKDOWN = `# Canvas Markdown 编辑器
## 这是一个纯 Canvas 渲染的编辑器
### 支持多级标题

这是一段普通文本。你可以在这里输入内容。

支持**加粗**和*斜体*以及\`行内代码\`等内联样式。

> 这是一段引用文本，左侧有竖线标记。

- 无序列表项 1
- 无序列表项 2
- 无序列表项 3

1. 有序列表项 1
2. 有序列表项 2
3. 有序列表项 3

\`\`\`
function hello() {
  console.log("Hello, World!");
  return 42;
}
\`\`\`

---

尝试点击任意位置开始编辑，使用方向键移动光标。

按 Enter 创建新段落，按 Backspace 删除字符或合并段落。

## 更多功能

支持 Ctrl+B **加粗** 和 Ctrl+I *斜体* 快捷键。

在代码块内按 Tab 可以缩进当前行，Shift+Tab 反缩进。

### 注意事项

1. 输入 \`# \` 加空格可以快速创建标题
2. 输入 \`- \` 创建无序列表
3. 输入 \`1. \` 创建有序列表
4. 输入 \`> \` 创建引用
5. 输入 \`---\` 创建分割线
6. 输入三个反引号创建代码块

这是最后一段文字，用于测试滚动功能是否正常工作。`;

/** 核心模块在组件外创建，避免每次渲染重建 */
const blockStore = new BlockStore();
const parser = new MarkdownParser();
const textMeasurer = new TextMeasurer();
const layoutEngine = new LayoutEngine(textMeasurer);
const staticRenderer = new StaticCanvasRenderer(textMeasurer);
const selectionRenderer = new SelectionCanvasRenderer(textMeasurer, blockStore);
const keyboardHandler = new KeyboardHandler(blockStore);
const hitTester = new HitTester(textMeasurer, blockStore);

const initialBlocks = parser.parse(SAMPLE_MARKDOWN);
blockStore.setBlocks(initialBlocks);

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputManagerRef = useRef<InputManager | null>(null);

  // 频繁变化用 ref（cursor、selection、scrollY），驱动 UI 的用 state（rawMarkdown、scrollContentHeight）
  const cursorRef = useRef<CursorPosition | null>(null);
  const selectionRef = useRef<SelectionRange | null>(null);
  const compositionTextRef = useRef<string>('');
  const isDraggingRef = useRef(false);
  const isUpdatingFromRaw = useRef(false);
  const scrollYRef = useRef(0);

  const [rawMarkdown, setRawMarkdown] = useState(SAMPLE_MARKDOWN);
  const [scrollContentHeight, setScrollContentHeight] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const getCanvasSize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return { width: 800, height: 600 };
    return { width: container.clientWidth, height: container.clientHeight };
  }, []);

  const renderStatic = useCallback(() => {
    // 静态内容层
    const canvas = staticCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { height } = getCanvasSize();
    staticRenderer.render(ctx, blockStore.getBlocks(), 0, height, window.devicePixelRatio, scrollYRef.current);
  }, [getCanvasSize]);

  const renderSelection = useCallback(() => {
    // 选区/光标层，单独重绘避免静态内容重复绘制
    const canvas = selectionCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    selectionRenderer.render(
      ctx,
      blockStore.getBlocks(),
      cursorRef.current,
      selectionRef.current,
      window.devicePixelRatio,
      compositionTextRef.current || undefined,
      scrollYRef.current,
    );
  }, []);

  const syncRawMarkdown = useCallback(() => {
    // 同步到右侧调试面板，isUpdatingFromRaw 防止从 textarea 编辑时产生循环更新
    if (!isUpdatingFromRaw.current) {
      setRawMarkdown(blocksToMarkdown(blockStore.getBlocks()));
    }
  }, []);

  const updateScrollSpacer = useCallback(() => {
    // 文档总高度，供滚动条和滚动范围计算；同时更新视口高度供 Scrollbar 使用
    const blocks = blockStore.getBlocks();
    const lastBlock = blocks[blocks.length - 1];
    const totalHeight = lastBlock?.layout
      ? lastBlock.layout.y + lastBlock.layout.height + 40
      : 0;
    setScrollContentHeight(totalHeight);
    const container = containerRef.current;
    if (container) {
      setViewportHeight(container.clientHeight);
    }
  }, []);

  const renderAll = useCallback(() => {
    renderStatic();
    renderSelection();
    syncRawMarkdown();
    updateScrollSpacer();
  }, [renderStatic, renderSelection, syncRawMarkdown, updateScrollSpacer]);

  const resizeCanvases = useCallback(() => {
    // 窗口 resize 时重设 canvas 尺寸并全量重排
    const { width, height } = getCanvasSize();
    const dpr = window.devicePixelRatio;

    [staticCanvasRef, selectionCanvasRef].forEach(ref => {
      const canvas = ref.current;
      if (!canvas) return;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    });

    layoutEngine.computeLayout([...blockStore.getBlocks()], width);
    renderAll();
  }, [getCanvasSize, renderAll]);

  const deleteSelectedRange = useCallback(() => {
    // 单块内：直接 substring 删除；跨块：合并首尾块内容并移除中间块
    const sel = selectionRef.current;
    if (!sel) return;

    const blocks = [...blockStore.getBlocks()];
    const anchorIdx = blocks.findIndex(b => b.id === sel.anchor.blockId);
    const focusIdx = blocks.findIndex(b => b.id === sel.focus.blockId);

    let startPos: CursorPosition;
    let endPos: CursorPosition;

    if (anchorIdx < focusIdx || (anchorIdx === focusIdx && sel.anchor.offset <= sel.focus.offset)) {
      startPos = sel.anchor;
      endPos = sel.focus;
    } else {
      startPos = sel.focus;
      endPos = sel.anchor;
    }

    if (startPos.blockId === endPos.blockId) {
      const block = blockStore.getBlock(startPos.blockId);
      if (block) {
        block.rawText = block.rawText.substring(0, startPos.offset) + block.rawText.substring(endPos.offset);
        blockStore.reparseBlock(block);
      }
    } else {
      const startBlock = blockStore.getBlock(startPos.blockId);
      const endBlock = blockStore.getBlock(endPos.blockId);
      if (startBlock && endBlock) {
        const beforeText = startBlock.rawText.substring(0, startPos.offset);
        const afterText = endBlock.rawText.substring(endPos.offset);

        startBlock.rawText = beforeText + afterText;
        blockStore.reparseBlock(startBlock);

        const startIdx = blocks.findIndex(b => b.id === startPos.blockId);
        const endIdx = blocks.findIndex(b => b.id === endPos.blockId);

        const newBlocks = blocks.filter((_, i) => i <= startIdx || i > endIdx);
        blockStore.setBlocks(newBlocks);
      }
    }

    cursorRef.current = startPos;
    selectionRef.current = null;
  }, []);

  useEffect(() => {
    // 初始化：InputManager、事件绑定、首次渲染；onTextInput：删选区→插入→块级快捷键→增量重排→全量渲染
    const container = containerRef.current;
    if (!container) return;

    const inputManager = new InputManager(container);
    inputManagerRef.current = inputManager;

    inputManager.setHandler({
      onTextInput: (text: string) => {
        if (selectionRef.current) {
          deleteSelectedRange();
        }
        if (cursorRef.current) {
          const newCursor = blockStore.insertTextAtCursor(cursorRef.current, text);
          cursorRef.current = newCursor;

          const block = blockStore.getBlock(newCursor.blockId);
          if (block) {
            const shortcut = checkBlockShortcut(block);
            if (shortcut.matched && shortcut.prefixLength !== undefined) {
              applyBlockShortcut(block, shortcut);
              blockStore.reparseBlock(block);
              cursorRef.current = {
                blockId: block.id,
                offset: Math.max(0, newCursor.offset - shortcut.prefixLength),
              };
            }
          }

          const { width } = getCanvasSize();
          const idx = blockStore.getBlockIndex(cursorRef.current.blockId);
          layoutEngine.reflowFrom([...blockStore.getBlocks()], idx, width);
          selectionRenderer.resetBlink();
          renderAll();
        }
      },
      onCompositionStart: () => {
        compositionTextRef.current = '';
      },
      onCompositionUpdate: (text: string) => {
        compositionTextRef.current = text;
        renderSelection();
      },
      onCompositionEnd: (text: string) => {
        compositionTextRef.current = '';
        if (selectionRef.current) {
          deleteSelectedRange();
        }
        if (cursorRef.current) {
          const newCursor = blockStore.insertTextAtCursor(cursorRef.current, text);
          cursorRef.current = newCursor;

          const block = blockStore.getBlock(newCursor.blockId);
          if (block) {
            const shortcut = checkBlockShortcut(block);
            if (shortcut.matched && shortcut.prefixLength !== undefined) {
              applyBlockShortcut(block, shortcut);
              blockStore.reparseBlock(block);
              cursorRef.current = {
                blockId: block.id,
                offset: Math.max(0, newCursor.offset - shortcut.prefixLength),
              };
            }
          }

          const { width } = getCanvasSize();
          const idx = blockStore.getBlockIndex(cursorRef.current.blockId);
          layoutEngine.reflowFrom([...blockStore.getBlocks()], idx, width);
          selectionRenderer.resetBlink();
          renderAll();
        }
      },
      onCopy: (e: ClipboardEvent) => {
        const sel = selectionRef.current;
        if (!sel) return;
        e.preventDefault();
        const text = getSelectedText(sel);
        e.clipboardData?.setData('text/plain', text);
      },
      onPaste: (e: ClipboardEvent) => {
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain');
        if (text && cursorRef.current) {
          if (selectionRef.current) {
            deleteSelectedRange();
          }
          const newCursor = blockStore.insertTextAtCursor(cursorRef.current, text);
          cursorRef.current = newCursor;
          const { width } = getCanvasSize();
          const idx = blockStore.getBlockIndex(newCursor.blockId);
          layoutEngine.reflowFrom([...blockStore.getBlocks()], idx, width);
          selectionRenderer.resetBlink();
          renderAll();
        }
      },
    });

    function getVisualText(block: ReturnType<typeof blockStore.getBlocks>[number]): string {
      return block.inlines.map(s => s.text).join('');
    }

    function getSelectedText(sel: SelectionRange): string {
      const blocks = blockStore.getBlocks();
      const anchorIdx = blocks.findIndex(b => b.id === sel.anchor.blockId);
      const focusIdx = blocks.findIndex(b => b.id === sel.focus.blockId);
      let start: CursorPosition, end: CursorPosition;

      if (anchorIdx < focusIdx || (anchorIdx === focusIdx && sel.anchor.offset <= sel.focus.offset)) {
        start = sel.anchor; end = sel.focus;
      } else {
        start = sel.focus; end = sel.anchor;
      }

      if (start.blockId === end.blockId) {
        const block = blockStore.getBlock(start.blockId);
        if (!block) return '';
        const visualText = getVisualText(block);
        const startVisual = blockStore.sourceToVisual(block, start.offset);
        const endVisual = blockStore.sourceToVisual(block, end.offset);
        return visualText.substring(startVisual, endVisual);
      }

      const parts: string[] = [];
      let inRange = false;
      for (const block of blocks) {
        if (block.id === start.blockId) {
          inRange = true;
          const visualText = getVisualText(block);
          const startVisual = blockStore.sourceToVisual(block, start.offset);
          parts.push(visualText.substring(startVisual));
          continue;
        }
        if (block.id === end.blockId) {
          const visualText = getVisualText(block);
          const endVisual = blockStore.sourceToVisual(block, end.offset);
          parts.push(visualText.substring(0, endVisual));
          break;
        }
        if (inRange) {
          parts.push(getVisualText(block));
        }
      }
      return parts.join('\n');
    }

    {
      const { width, height } = getCanvasSize();
      const dpr = window.devicePixelRatio;
      [staticCanvasRef, selectionCanvasRef].forEach(ref => {
        const canvas = ref.current;
        if (!canvas) return;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      });
      layoutEngine.computeLayout([...blockStore.getBlocks()], width);
      renderStatic();
      renderSelection();
      // 延迟到下一帧更新滚动条状态，避免在 effect 中同步调用 setState
      requestAnimationFrame(() => updateScrollSpacer());
    }

    selectionRenderer.startBlink(() => renderSelection());

    const handleResize = () => resizeCanvases();
    window.addEventListener('resize', handleResize);

    const handleWheel = (e: WheelEvent) => {
      // 更新 scrollY 后手动触发 canvas 重绘（无原生 scroll 事件）
      e.preventDefault();
      const blocks = blockStore.getBlocks();
      const lastBlock = blocks[blocks.length - 1];
      const maxScroll = lastBlock?.layout
        ? Math.max(0, lastBlock.layout.y + lastBlock.layout.height - getCanvasSize().height + 40)
        : 0;
      const newScrollY = Math.max(0, Math.min(maxScroll, scrollYRef.current + e.deltaY));
      scrollYRef.current = newScrollY;
      setScrollY(newScrollY);
      renderStatic();
      renderSelection();
      updateScrollSpacer();
    };

    const selCanvas = selectionCanvasRef.current;
    selCanvas?.addEventListener('wheel', handleWheel, { passive: false });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!cursorRef.current) return;
      if (inputManager.composing) return;

      const action = keyboardHandler.handleKeyDown(e, cursorRef.current, selectionRef.current);

      // 各 action 类型对应：moveCursor 更新光标选区；dataChanged 增量重排；delete 全量重排；splitBlock/mergeWithPrev 全量重排；dataChangedWithSelection 增量重排并保留选区
      switch (action.type) {
        case 'moveCursor':
          cursorRef.current = action.cursor;
          selectionRef.current = action.selection;
          selectionRenderer.resetBlink();
          renderSelection();
          break;
        case 'dataChanged':
          cursorRef.current = action.cursor;
          selectionRef.current = null;
          {
            const { width } = getCanvasSize();
            const idx = blockStore.getBlockIndex(action.cursor.blockId);
            layoutEngine.reflowFrom([...blockStore.getBlocks()], Math.max(0, idx), width);
          }
          selectionRenderer.resetBlink();
          renderAll();
          break;
        case 'delete':
          deleteSelectedRange();
          {
            const { width } = getCanvasSize();
            layoutEngine.computeLayout([...blockStore.getBlocks()], width);
          }
          selectionRenderer.resetBlink();
          renderAll();
          break;
        case 'splitBlock':
          cursorRef.current = action.newCursor;
          selectionRef.current = null;
          {
            const { width } = getCanvasSize();
            layoutEngine.computeLayout([...blockStore.getBlocks()], width);
          }
          selectionRenderer.resetBlink();
          renderAll();
          break;
        case 'mergeWithPrev':
          cursorRef.current = action.newCursor;
          selectionRef.current = null;
          {
            const { width } = getCanvasSize();
            layoutEngine.computeLayout([...blockStore.getBlocks()], width);
          }
          selectionRenderer.resetBlink();
          renderAll();
          break;
        case 'dataChangedWithSelection':
          cursorRef.current = action.cursor;
          selectionRef.current = action.selection;
          {
            const { width } = getCanvasSize();
            const idx = blockStore.getBlockIndex(action.cursor.blockId);
            layoutEngine.reflowFrom([...blockStore.getBlocks()], Math.max(0, idx), width);
          }
          selectionRenderer.resetBlink();
          renderAll();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      selCanvas?.removeEventListener('wheel', handleWheel);
      selectionRenderer.stopBlink();
      inputManager.destroy();
    };
  }, [getCanvasSize, renderAll, renderStatic, renderSelection, resizeCanvases, updateScrollSpacer, deleteSelectedRange]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // 点击：hitTest 定位光标、清空选区、开启拖选；setPointerCapture 保证在 canvas 外松开仍能收到 up
    e.preventDefault();

    const canvas = selectionCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const sceneX = e.clientX - rect.left;
    const sceneY = e.clientY - rect.top + scrollYRef.current;

    const pos = hitTester.hitPosition(sceneX, sceneY, blockStore.getBlocks());
    if (pos) {
      cursorRef.current = pos;
      selectionRef.current = null;
      isDraggingRef.current = true;
      selectionRenderer.resetBlink();
      renderSelection();
    }

    canvas.setPointerCapture(e.pointerId);
    inputManagerRef.current?.focus();
  }, [renderSelection]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // 拖选：以首次点击为 anchor，持续 hitTest 更新 focus
    if (!isDraggingRef.current || !cursorRef.current) return;

    const canvas = selectionCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const sceneX = e.clientX - rect.left;
    const sceneY = e.clientY - rect.top + scrollYRef.current;

    const pos = hitTester.hitPosition(sceneX, sceneY, blockStore.getBlocks());
    if (pos) {
      const anchor = selectionRef.current?.anchor ?? cursorRef.current;
      if (pos.blockId !== anchor.blockId || pos.offset !== anchor.offset) {
        selectionRef.current = { anchor, focus: pos };
        cursorRef.current = pos;
      }
      renderSelection();
    }
  }, [renderSelection]);

  const handlePointerUp = useCallback(() => {
    // 结束拖选
    isDraggingRef.current = false;
  }, []);

  const handleRawMarkdownChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newMarkdown = e.target.value;
    setRawMarkdown(newMarkdown);

    isUpdatingFromRaw.current = true;
    const newBlocks = parser.parse(newMarkdown);
    blockStore.setBlocks(newBlocks);
    cursorRef.current = null;
    selectionRef.current = null;

    const { width } = getCanvasSize();
    layoutEngine.computeLayout([...blockStore.getBlocks()], width);
    renderStatic();
    renderSelection();
    isUpdatingFromRaw.current = false;
  }, [getCanvasSize, renderStatic, renderSelection]);

  const handleScrollbarScroll = useCallback((newScrollY: number) => {
    scrollYRef.current = newScrollY;
    setScrollY(newScrollY);
    renderStatic();
    renderSelection();
  }, [renderStatic, renderSelection]);

  return (
    <div className="app-layout">
      <div className="editor-wrapper">
        <div className="editor-container" ref={containerRef}>
          <canvas ref={staticCanvasRef} className="editor-canvas static-canvas" />
          <canvas
            ref={selectionCanvasRef}
            className="editor-canvas selection-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
          <Scrollbar
            scrollY={scrollY}
            contentHeight={scrollContentHeight}
            viewportHeight={viewportHeight}
            onScroll={handleScrollbarScroll}
          />
        </div>
      </div>
      <div className="raw-editor-container">
        <div className="raw-editor-header">Markdown 源码</div>
        <textarea
          className="raw-editor"
          value={rawMarkdown}
          onChange={handleRawMarkdownChange}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export default App;
