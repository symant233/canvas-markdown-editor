import type { Block, CursorPosition, SelectionRange } from './types';
import { BlockStore } from './BlockStore';
import { HitTester } from './HitTester';
import { KeyboardHandler } from './KeyboardHandler';
import { LayoutEngine } from './LayoutEngine';
import { checkBlockShortcut, applyBlockShortcut } from './MarkdownShortcuts';

/**
 * 编辑器核心状态。
 * cursor/selection 在 source 空间，compositionText 为 IME 临时文本。
 */
export interface EditorState {
  cursor: CursorPosition | null;
  selection: SelectionRange | null;
  compositionText: string;
  isDragging: boolean;
  scrollY: number;
}

/**
 * 渲染通知事件：
 * - selectionOnly: 仅重绘选区层（光标移动、选区变化）
 * - full: 重绘两层 Canvas + 同步 Markdown + 更新滚动条
 * - scroll: 滚动位置变化，需重绘两层
 */
export type RenderRequest =
  | { type: 'selectionOnly' }
  | { type: 'full' }
  | { type: 'scroll' };

type RenderHandler = (request: RenderRequest) => void;

/**
 * 编辑器事件派发中心。
 * 接管所有编辑逻辑（文本输入、键盘、指针、滚动），App.tsx 仅做 DOM 搭建和渲染。
 */
export class EventDispatcher {
  private state: EditorState = {
    cursor: null,
    selection: null,
    compositionText: '',
    isDragging: false,
    scrollY: 0,
  };

  private renderHandlers: Set<RenderHandler> = new Set();
  private getContainerWidth: () => number = () => 800;
  private getViewportHeight: () => number = () => 600;
  private focusInput: () => void = () => {};
  private resetBlink: () => void = () => {};

  private blockStore: BlockStore;
  private hitTester: HitTester;
  private keyboardHandler: KeyboardHandler;
  private layoutEngine: LayoutEngine;

  constructor(
    blockStore: BlockStore,
    hitTester: HitTester,
    keyboardHandler: KeyboardHandler,
    layoutEngine: LayoutEngine,
  ) {
    this.blockStore = blockStore;
    this.hitTester = hitTester;
    this.keyboardHandler = keyboardHandler;
    this.layoutEngine = layoutEngine;
  }

  /** 注入外部依赖：容器尺寸查询、输入框聚焦、光标闪烁重置 */
  setCallbacks(opts: {
    getContainerWidth: () => number;
    getViewportHeight: () => number;
    focusInput: () => void;
    resetBlink: () => void;
  }) {
    this.getContainerWidth = opts.getContainerWidth;
    this.getViewportHeight = opts.getViewportHeight;
    this.focusInput = opts.focusInput;
    this.resetBlink = opts.resetBlink;
  }

  getState(): Readonly<EditorState> {
    return this.state;
  }

  onRender(handler: RenderHandler): () => void {
    this.renderHandlers.add(handler);
    return () => this.renderHandlers.delete(handler);
  }

  // ─── 指针事件 ───

  handlePointerDown(sceneX: number, sceneY: number) {
    const pos = this.hitTester.hitPosition(sceneX, sceneY, this.blockStore.getBlocks());
    if (pos) {
      this.state.cursor = pos;
      this.state.selection = null;
      this.state.isDragging = true;
      this.resetBlink();
      this.emit({ type: 'selectionOnly' });
    }
    this.focusInput();
  }

  handlePointerMove(sceneX: number, sceneY: number) {
    if (!this.state.isDragging || !this.state.cursor) return;

    const pos = this.hitTester.hitPosition(sceneX, sceneY, this.blockStore.getBlocks());
    if (pos) {
      const anchor = this.state.selection?.anchor ?? this.state.cursor;
      if (pos.blockId !== anchor.blockId || pos.offset !== anchor.offset) {
        this.state.selection = { anchor, focus: pos };
        this.state.cursor = pos;
        this.emit({ type: 'selectionOnly' });
      }
    }
  }

  handlePointerUp() {
    this.state.isDragging = false;
  }

  // ─── 文本输入 ───

  /** 普通文本输入：删选区 → 插入 → 检查块级快捷键 → 增量重排 → 通知渲染 */
  handleTextInput(text: string) {
    if (this.state.selection) {
      this.deleteSelectedRange();
    }
    if (!this.state.cursor) return;

    const newCursor = this.blockStore.insertTextAtCursor(this.state.cursor, text);
    this.state.cursor = newCursor;

    this.checkAndApplyShortcut(newCursor.blockId);
    this.reflowFrom(this.state.cursor.blockId);
    this.resetBlink();
    this.emit({ type: 'full' });
  }

  // ─── IME 组合输入 ───

  handleCompositionStart() {
    this.state.compositionText = '';
  }

  handleCompositionUpdate(text: string) {
    this.state.compositionText = text;
    this.emit({ type: 'selectionOnly' });
  }

  /** 组合结束：提交最终文本，流程与 handleTextInput 相同 */
  handleCompositionEnd(text: string) {
    this.state.compositionText = '';
    if (this.state.selection) {
      this.deleteSelectedRange();
    }
    if (!this.state.cursor) return;

    const newCursor = this.blockStore.insertTextAtCursor(this.state.cursor, text);
    this.state.cursor = newCursor;

    this.checkAndApplyShortcut(newCursor.blockId);
    this.reflowFrom(this.state.cursor.blockId);
    this.resetBlink();
    this.emit({ type: 'full' });
  }

  // ─── 复制粘贴 ───

  /** 获取选区内的视觉文本（不含 Markdown 标记符） */
  getSelectedText(): string {
    const sel = this.state.selection;
    if (!sel) return '';

    const blocks = this.blockStore.getBlocks();
    const anchorIdx = blocks.findIndex(b => b.id === sel.anchor.blockId);
    const focusIdx = blocks.findIndex(b => b.id === sel.focus.blockId);
    let start: CursorPosition, end: CursorPosition;

    if (anchorIdx < focusIdx || (anchorIdx === focusIdx && sel.anchor.offset <= sel.focus.offset)) {
      start = sel.anchor; end = sel.focus;
    } else {
      start = sel.focus; end = sel.anchor;
    }

    if (start.blockId === end.blockId) {
      const block = this.blockStore.getBlock(start.blockId);
      if (!block) return '';
      const visualText = this.getVisualText(block);
      const startVisual = this.blockStore.sourceToVisual(block, start.offset);
      const endVisual = this.blockStore.sourceToVisual(block, end.offset);
      return visualText.substring(startVisual, endVisual);
    }

    const parts: string[] = [];
    let inRange = false;
    for (const block of blocks) {
      if (block.id === start.blockId) {
        inRange = true;
        const visualText = this.getVisualText(block);
        const startVisual = this.blockStore.sourceToVisual(block, start.offset);
        parts.push(visualText.substring(startVisual));
        continue;
      }
      if (block.id === end.blockId) {
        const visualText = this.getVisualText(block);
        const endVisual = this.blockStore.sourceToVisual(block, end.offset);
        parts.push(visualText.substring(0, endVisual));
        break;
      }
      if (inRange) {
        parts.push(this.getVisualText(block));
      }
    }
    return parts.join('\n');
  }

  handlePaste(text: string) {
    if (!this.state.cursor) return;
    if (this.state.selection) {
      this.deleteSelectedRange();
    }
    const newCursor = this.blockStore.insertTextAtCursor(this.state.cursor!, text);
    this.state.cursor = newCursor;
    this.reflowFrom(newCursor.blockId);
    this.resetBlink();
    this.emit({ type: 'full' });
  }

  // ─── 键盘事件 ───

  /** 处理 keydown 事件，根据 KeyboardAction 类型执行对应操作 */
  handleKeyDown(e: KeyboardEvent, isComposing: boolean) {
    if (!this.state.cursor) return;
    if (isComposing) return;

    const action = this.keyboardHandler.handleKeyDown(e, this.state.cursor, this.state.selection);

    switch (action.type) {
      case 'moveCursor':
        this.state.cursor = action.cursor;
        this.state.selection = action.selection;
        this.resetBlink();
        this.emit({ type: 'selectionOnly' });
        break;

      case 'dataChanged':
        this.state.cursor = action.cursor;
        this.state.selection = null;
        this.reflowFrom(action.cursor.blockId);
        this.resetBlink();
        this.emit({ type: 'full' });
        break;

      case 'delete':
        this.deleteSelectedRange();
        this.fullLayout();
        this.resetBlink();
        this.emit({ type: 'full' });
        break;

      case 'splitBlock':
        this.state.cursor = action.newCursor;
        this.state.selection = null;
        this.fullLayout();
        this.resetBlink();
        this.emit({ type: 'full' });
        break;

      case 'mergeWithPrev':
        this.state.cursor = action.newCursor;
        this.state.selection = null;
        this.fullLayout();
        this.resetBlink();
        this.emit({ type: 'full' });
        break;

      case 'dataChangedWithSelection':
        this.state.cursor = action.cursor;
        this.state.selection = action.selection;
        this.reflowFrom(action.cursor.blockId);
        this.resetBlink();
        this.emit({ type: 'full' });
        break;
    }
  }

  // ─── 滚动 ───

  handleWheel(deltaY: number) {
    const maxScroll = this.getMaxScroll();
    const newScrollY = Math.max(0, Math.min(maxScroll, this.state.scrollY + deltaY));
    if (newScrollY === this.state.scrollY) return;
    this.state.scrollY = newScrollY;
    this.emit({ type: 'scroll' });
  }

  handleScrollbarScroll(newScrollY: number) {
    this.state.scrollY = newScrollY;
    this.emit({ type: 'scroll' });
  }

  // ─── 调试面板 ───

  /** 从右侧源码面板更新数据，重置光标和选区 */
  handleRawMarkdownUpdate(blocks: Block[]) {
    this.blockStore.setBlocks(blocks);
    this.state.cursor = null;
    this.state.selection = null;
    this.fullLayout();
    this.emit({ type: 'full' });
  }

  /** 窗口 resize 后全量重排 */
  handleResize() {
    this.fullLayout();
    this.emit({ type: 'full' });
  }

  // ─── 内部辅助 ───

  /** 检查并应用块级快捷键（如 # → heading、- → list） */
  private checkAndApplyShortcut(blockId: string) {
    const block = this.blockStore.getBlock(blockId);
    if (!block) return;
    const shortcut = checkBlockShortcut(block);
    if (shortcut.matched && shortcut.prefixLength !== undefined) {
      applyBlockShortcut(block, shortcut);
      this.blockStore.reparseBlock(block);
      this.state.cursor = {
        blockId: block.id,
        offset: Math.max(0, (this.state.cursor?.offset ?? 0) - shortcut.prefixLength),
      };
    }
  }

  /** 删除选区内的文本。单块内 substring，跨块合并首尾。 */
  private deleteSelectedRange() {
    const sel = this.state.selection;
    if (!sel) return;

    const blocks = [...this.blockStore.getBlocks()];
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
      const block = this.blockStore.getBlock(startPos.blockId);
      if (block) {
        block.rawText = block.rawText.substring(0, startPos.offset) + block.rawText.substring(endPos.offset);
        this.blockStore.reparseBlock(block);
      }
    } else {
      const startBlock = this.blockStore.getBlock(startPos.blockId);
      const endBlock = this.blockStore.getBlock(endPos.blockId);
      if (startBlock && endBlock) {
        startBlock.rawText = startBlock.rawText.substring(0, startPos.offset) + endBlock.rawText.substring(endPos.offset);
        this.blockStore.reparseBlock(startBlock);

        const startIdx = blocks.findIndex(b => b.id === startPos.blockId);
        const endIdx = blocks.findIndex(b => b.id === endPos.blockId);
        this.blockStore.setBlocks(blocks.filter((_, i) => i <= startIdx || i > endIdx));
      }
    }

    this.state.cursor = startPos;
    this.state.selection = null;
  }

  /** 从指定块开始增量重排 */
  private reflowFrom(blockId: string) {
    const width = this.getContainerWidth();
    const idx = this.blockStore.getBlockIndex(blockId);
    this.layoutEngine.reflowFrom([...this.blockStore.getBlocks()], Math.max(0, idx), width);
  }

  /** 全量重排所有块 */
  private fullLayout() {
    const width = this.getContainerWidth();
    this.layoutEngine.computeLayout([...this.blockStore.getBlocks()], width);
  }

  /** 获取块的视觉文本（不含标记符） */
  private getVisualText(block: Block): string {
    return block.inlines.map(s => s.text).join('');
  }

  /** 计算最大滚动量 */
  private getMaxScroll(): number {
    const blocks = this.blockStore.getBlocks();
    const lastBlock = blocks[blocks.length - 1];
    if (!lastBlock?.layout) return 0;
    return Math.max(0, lastBlock.layout.y + lastBlock.layout.height - this.getViewportHeight() + 40);
  }

  private emit(request: RenderRequest) {
    this.renderHandlers.forEach(h => h(request));
  }
}
