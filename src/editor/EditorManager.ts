import { BlockStore } from '../core/BlockStore';
import { MarkdownParser } from '../core/MarkdownParser';
import { TextMeasurer } from '../core/TextMeasurer';
import { LayoutEngine } from '../core/LayoutEngine';
import { StaticCanvasRenderer } from '../core/StaticCanvasRenderer';
import { SelectionCanvasRenderer } from '../core/SelectionCanvasRenderer';
import { KeyboardHandler } from '../core/KeyboardHandler';
import { HitTester } from '../core/HitTester';
import { EventDispatcher, type RenderRequest } from '../core/EventDispatcher';
import { InputManager } from '../core/InputManager';
import { blocksToMarkdown } from '../core/BlockSerializer';
import { parseInlineMarkdown } from '../core/InlineParser';
import type { CursorPosition } from '../core/types';

// ─── 核心模块单例（模块作用域创建，保证只实例化一次） ───

const blockStore = new BlockStore();
const parser = new MarkdownParser();
const textMeasurer = new TextMeasurer();
const layoutEngine = new LayoutEngine(textMeasurer);
const staticRenderer = new StaticCanvasRenderer(textMeasurer);
const selectionRenderer = new SelectionCanvasRenderer(textMeasurer, blockStore);

const keyboardHandler = new KeyboardHandler(blockStore);
const hitTester = new HitTester(textMeasurer, blockStore);
const dispatcher = new EventDispatcher(blockStore, hitTester, keyboardHandler, layoutEngine);

// ─── EditorManager ───

export interface ScrollState {
  scrollY: number;
  contentHeight: number;
  viewportHeight: number;
}

interface EditorCallbacks {
  onRawMarkdownChange: (md: string) => void;
  onScrollStateChange: (state: ScrollState) => void;
}

/**
 * 画布管理类。
 * 持有 Canvas DOM 引用，负责渲染、DPR 适配、事件注册和生命周期管理。
 * 由 App 组件在 mount 时调用 init()，传入 DOM 引用、初始 Markdown 和 React 状态回调。
 */
export class EditorManager {
  private staticCanvas: HTMLCanvasElement | null = null;
  private selectionCanvas: HTMLCanvasElement | null = null;
  private container: HTMLDivElement | null = null;
  private inputManager: InputManager | null = null;
  private callbacks: EditorCallbacks | null = null;
  private isUpdatingFromRaw = false;
  private compositionActive = false;

  /**
   * 初始化编辑器：解析初始内容、注入 DOM、注册事件、首次渲染。
   * 返回 cleanup 函数，在 React unmount 时调用。
   */
  init(
    container: HTMLDivElement,
    staticCanvas: HTMLCanvasElement,
    selectionCanvas: HTMLCanvasElement,
    initialMarkdown: string,
    callbacks: EditorCallbacks,
  ): () => void {
    this.container = container;
    this.staticCanvas = staticCanvas;
    this.selectionCanvas = selectionCanvas;
    this.callbacks = callbacks;

    // 解析初始文档内容
    blockStore.setBlocks(parser.parse(initialMarkdown));

    // 注入 dispatcher 回调
    dispatcher.setCallbacks({
      getContainerWidth: () => this.getContainerSize().width,
      getViewportHeight: () => this.getContainerSize().height,
      focusInput: () => this.inputManager?.focus(),
      resetBlink: () => selectionRenderer.resetBlink(),
    });

    // InputManager（隐藏 textarea）
    const inputManager = new InputManager(container);
    this.inputManager = inputManager;

    inputManager.setHandler({
      onTextInput: (text) => dispatcher.handleTextInput(text),
      onCompositionStart: () => dispatcher.handleCompositionStart(),
      onCompositionUpdate: (text) => dispatcher.handleCompositionUpdate(text),
      onCompositionEnd: (text) => dispatcher.handleCompositionEnd(text),
      onCopy: (e) => {
        e.preventDefault();
        const text = dispatcher.getSelectedText();
        if (text) e.clipboardData?.setData('text/plain', text);
      },
      onPaste: (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain');
        if (text) dispatcher.handlePaste(text);
      },
    });

    // 订阅渲染通知
    const unsubRender = dispatcher.onRender((req: RenderRequest) => {
      const cleanup = this.applyCompositionForRendering();

      switch (req.type) {
        case 'selectionOnly':
          this.renderSelection();
          break;
        case 'full':
          this.renderStatic();
          this.renderSelection();
          break;
        case 'scroll':
          this.callbacks?.onScrollStateChange({
            scrollY: dispatcher.getState().scrollY,
            contentHeight: this.getContentHeight(),
            viewportHeight: container.clientHeight,
          });
          this.renderStaticScroll(req.oldScrollY);
          this.renderSelection();
          break;
      }

      cleanup();

      if (req.type === 'full') {
        this.syncReactState();
        this.updateTextareaPosition();
      } else if (req.type === 'scroll') {
        this.updateTextareaPosition();
      }
    });

    // 注册 pointer 事件（原生方式，非 React）
    selectionCanvas.addEventListener('pointerdown', this.onPointerDown);
    selectionCanvas.addEventListener('pointermove', this.onPointerMove);
    selectionCanvas.addEventListener('pointerup', this.onPointerUp);

    // 首次渲染
    this.setCanvasDimensions();
    layoutEngine.computeLayout(blockStore.getBlocks(), this.getContainerSize().width);
    this.renderStatic();
    this.renderSelection();
    requestAnimationFrame(() => {
      this.callbacks?.onScrollStateChange({
        scrollY: 0,
        contentHeight: this.getContentHeight(),
        viewportHeight: container.clientHeight,
      });
    });

    selectionRenderer.startBlink(() => {
      const cleanup = this.applyCompositionForRendering();
      this.renderSelection();
      cleanup();
    });

    // 全局事件
    const handleResize = () => {
      this.setCanvasDimensions();
      dispatcher.handleResize();
    };
    window.addEventListener('resize', handleResize);

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      dispatcher.handleWheel(e.deltaY);
    };
    selectionCanvas.addEventListener('wheel', handleWheel, { passive: false });

    const handleKeyDown = (e: KeyboardEvent) => {
      dispatcher.handleKeyDown(e, inputManager.composing);
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      selectionCanvas.removeEventListener('wheel', handleWheel);
      selectionCanvas.removeEventListener('pointerdown', this.onPointerDown);
      selectionCanvas.removeEventListener('pointermove', this.onPointerMove);
      selectionCanvas.removeEventListener('pointerup', this.onPointerUp);
      selectionRenderer.stopBlink();
      inputManager.destroy();
      unsubRender();
    };
  }

  // ─── 指针事件（箭头函数绑定 this） ───

  private onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    const rect = this.selectionCanvas!.getBoundingClientRect();
    const { scrollY } = dispatcher.getState();
    dispatcher.handlePointerDown(e.clientX - rect.left, e.clientY - rect.top + scrollY);
    this.selectionCanvas!.setPointerCapture(e.pointerId);
    this.updateTextareaPosition();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!dispatcher.getState().isDragging) return;
    const rect = this.selectionCanvas!.getBoundingClientRect();
    const { scrollY } = dispatcher.getState();
    dispatcher.handlePointerMove(e.clientX - rect.left, e.clientY - rect.top + scrollY);
  };

  private onPointerUp = () => {
    dispatcher.handlePointerUp();
  };

  // ─── 外部调用接口 ───

  /** 源码面板内容变更时调用 */
  updateFromRawMarkdown(markdown: string) {
    this.callbacks?.onRawMarkdownChange(markdown);
    this.isUpdatingFromRaw = true;
    dispatcher.handleRawMarkdownUpdate(parser.parse(markdown));
    this.renderStatic();
    this.renderSelection();
    this.isUpdatingFromRaw = false;
  }

  /** 滚动条拖动时调用 */
  handleScrollbarScroll(scrollY: number) {
    dispatcher.handleScrollbarScroll(scrollY);
  }

  // ─── 内部方法 ───

  private getContainerSize(): { width: number; height: number } {
    if (!this.container) return { width: 800, height: 600 };
    return { width: this.container.clientWidth, height: this.container.clientHeight };
  }

  private setCanvasDimensions() {
    const { width, height } = this.getContainerSize();
    const dpr = window.devicePixelRatio;
    [this.staticCanvas, this.selectionCanvas].forEach(canvas => {
      if (!canvas) return;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    });
  }

  private renderStatic() {
    if (!this.staticCanvas) return;
    const ctx = this.staticCanvas.getContext('2d');
    if (!ctx) return;
    const { height } = this.getContainerSize();
    const { scrollY } = dispatcher.getState();
    staticRenderer.render(ctx, blockStore.getBlocks(), 0, height, window.devicePixelRatio, scrollY);
  }

  /** 滚动专用渲染：blit 复用像素 + 补画新露出条带 */
  private renderStaticScroll(oldScrollY: number) {
    if (!this.staticCanvas) return;
    const ctx = this.staticCanvas.getContext('2d');
    if (!ctx) return;
    const { height } = this.getContainerSize();
    const { scrollY } = dispatcher.getState();
    staticRenderer.renderScroll(ctx, blockStore.getBlocks(), height, window.devicePixelRatio, oldScrollY, scrollY);
  }

  private renderSelection() {
    if (!this.selectionCanvas) return;
    const ctx = this.selectionCanvas.getContext('2d');
    if (!ctx) return;
    const { cursor, selection, compositionText, scrollY } = dispatcher.getState();

    if (this.compositionActive && compositionText && cursor) {
      const adjustedCursor: CursorPosition = {
        blockId: cursor.blockId,
        offset: cursor.offset + compositionText.length,
      };
      selectionRenderer.render(ctx, blockStore.getBlocks(), adjustedCursor, null, window.devicePixelRatio, scrollY);
      selectionRenderer.renderCompositionUnderline(ctx, blockStore.getBlocks(), cursor, compositionText.length, window.devicePixelRatio, scrollY);
    } else {
      selectionRenderer.render(ctx, blockStore.getBlocks(), cursor, selection, window.devicePixelRatio, scrollY);
    }
  }

  private getContentHeight(): number {
    const blocks = blockStore.getBlocks();
    const lastBlock = blocks[blocks.length - 1];
    return lastBlock?.layout ? lastBlock.layout.y + lastBlock.layout.height + 40 : 0;
  }

  /** 同步 React 状态：Markdown 源码 + 滚动条数据 */
  private syncReactState() {
    if (!this.isUpdatingFromRaw) {
      this.callbacks?.onRawMarkdownChange(blocksToMarkdown(blockStore.getBlocks()));
    }
    this.callbacks?.onScrollStateChange({
      scrollY: dispatcher.getState().scrollY,
      contentHeight: this.getContentHeight(),
      viewportHeight: this.container?.clientHeight ?? 600,
    });
  }

  /**
   * 组合输入期间临时将 compositionText 注入 block 的 rawText，
   * 重新解析和布局以获得正确的换行和文字位移效果。
   * 返回的 cleanup 函数恢复原始状态。
   */
  private applyCompositionForRendering(): () => void {
    const { compositionText, cursor } = dispatcher.getState();
    if (!compositionText || !cursor) return () => {};

    const block = blockStore.getBlock(cursor.blockId);
    if (!block) return () => {};

    const savedRawText = block.rawText;
    const savedInlines = block.inlines;
    const savedSTV = block.sourceToVisual;
    const savedVTS = block.visualToSource;

    const blocks = blockStore.getBlocks();
    const blockIdx = blocks.indexOf(block);
    if (blockIdx < 0) return () => {};

    const savedLayouts = blocks.slice(blockIdx).map(b => b.layout);

    block.rawText = savedRawText.substring(0, cursor.offset) + compositionText + savedRawText.substring(cursor.offset);
    const parseResult = parseInlineMarkdown(block.rawText);
    block.inlines = parseResult.segments;
    block.sourceToVisual = parseResult.sourceToVisual;
    block.visualToSource = parseResult.visualToSource;

    layoutEngine.reflowFrom(blocks, Math.max(0, blockIdx), this.getContainerSize().width);

    this.compositionActive = true;

    return () => {
      block.rawText = savedRawText;
      block.inlines = savedInlines;
      block.sourceToVisual = savedSTV;
      block.visualToSource = savedVTS;

      for (let i = 0; i < savedLayouts.length; i++) {
        blocks[blockIdx + i].layout = savedLayouts[i];
      }

      this.compositionActive = false;
    };
  }

  /**
   * 将隐藏 textarea 移动到光标像素位置，使 IME 候选窗紧贴光标所在行。
   * 组合输入期间跳过更新，避免候选窗跳动。
   */
  private updateTextareaPosition() {
    if (this.inputManager?.composing) return;
    const { cursor, scrollY } = dispatcher.getState();
    if (!cursor) return;
    const pos = selectionRenderer.getCursorPixelPosition(blockStore.getBlocks(), cursor);
    if (pos) {
      this.inputManager?.updatePosition(pos.x, pos.y - scrollY, pos.height);
    }
  }
}

export const editorManager = new EditorManager();
