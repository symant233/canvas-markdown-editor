import type { Block, CursorPosition, SelectionRange } from './types';
import { BlockStore } from './BlockStore';
import { HitTester } from './HitTester';
import { KeyboardHandler } from './KeyboardHandler';
import { LayoutEngine } from './LayoutEngine';
import { checkBlockShortcut, applyBlockShortcut } from './MarkdownShortcuts';
import { isRenderedMermaid } from './MermaidRenderer';

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
  | { type: 'scroll'; oldScrollY: number };

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
    const checkboxBlock = this.hitTester.hitCheckbox(sceneX, sceneY, this.blockStore.getBlocks());
    if (checkboxBlock) {
      checkboxBlock.checked = !checkboxBlock.checked;
      this.blockStore.reparseBlock(checkboxBlock);
      this.emit({ type: 'full' });
      this.focusInput();
      return;
    }

    const pos = this.hitTester.hitPosition(sceneX, sceneY, this.blockStore.getBlocks());
    if (pos) {
      // 已渲染的 mermaid 块为原子块：点击时选中整个块，不放置文本光标，不启动拖选
      const hitBlock = this.blockStore.getBlock(pos.blockId);
      if (hitBlock && isRenderedMermaid(hitBlock)) {
        const rawLen = this.blockStore.getRawTextLength(hitBlock);
        this.state.cursor = { blockId: hitBlock.id, offset: rawLen };
        this.state.selection = {
          anchor: { blockId: hitBlock.id, offset: 0 },
          focus: { blockId: hitBlock.id, offset: rawLen },
        };
        this.state.isDragging = false;
        this.resetBlink();
        this.emit({ type: 'selectionOnly' });
        this.focusInput();
        return;
      }

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

    let pos = this.hitTester.hitPosition(sceneX, sceneY, this.blockStore.getBlocks());
    if (pos) {
      const anchor = this.state.selection?.anchor ?? this.state.cursor;

      /**
       * 锚点在表单元格内时，若命中落到其他格或表外，将 focus 钳到锚点格首/尾（按指针在格上边或下边），禁止跨格拖选。
       */
      if (anchor.tableCell) {
        if (!pos.tableCell || pos.blockId !== anchor.blockId ||
            pos.tableCell.row !== anchor.tableCell.row || pos.tableCell.col !== anchor.tableCell.col) {
          const block = this.blockStore.getBlock(anchor.blockId);
          if (block) {
            const cellLen = this.blockStore.getTableCellRawTextLength(block, anchor.tableCell.row, anchor.tableCell.col);
            const cellLayout = block.layout?.tableCells;
            if (cellLayout) {
              const layoutRow = anchor.tableCell.row === -1 ? 0 : anchor.tableCell.row + 1;
              const cl = cellLayout[layoutRow]?.[anchor.tableCell.col];
              if (cl) {
                const isAbove = sceneY < cl.y;
                pos = { blockId: anchor.blockId, offset: isAbove ? 0 : cellLen, tableCell: anchor.tableCell };
              }
            }
          }
        }
      }

      if (pos.blockId !== anchor.blockId || pos.offset !== anchor.offset ||
          pos.tableCell?.row !== anchor.tableCell?.row || pos.tableCell?.col !== anchor.tableCell?.col) {
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

  /**
   * 普通文本输入：若有选区则先删选区 → insertTextAtCursor → 非表内则检查块级快捷键 →
   * 从当前块增量重排 → 确保光标可见 → 通知全量渲染。
   */
  handleTextInput(text: string) {
    if (this.state.selection) {
      if (this.isSelectionOnRenderedMermaid()) return;
      this.deleteSelectedRange();
    }
    if (!this.state.cursor) return;

    const newCursor = this.blockStore.insertTextAtCursor(this.state.cursor, text);
    this.state.cursor = newCursor;

    if (!newCursor.tableCell) {
      this.checkAndApplyShortcut(newCursor.blockId);
    }
    this.reflowFrom(this.state.cursor.blockId);
    this.resetBlink();
    this.ensureCursorVisible();
    this.emit({ type: 'full' });
  }

  // ─── IME 组合输入 ───

  handleCompositionStart() {
    this.state.compositionText = '';
  }

  handleCompositionUpdate(text: string) {
    this.state.compositionText = text;
    this.resetBlink();
    this.emit({ type: 'full' });
  }

  /**
   * 组合输入结束：清空 composition 临时串，若有选区则先删选区，再插入最终文本；
   * 流程与 handleTextInput 相同（快捷键、重排、滚动、full 渲染）。
   */
  handleCompositionEnd(text: string) {
    this.state.compositionText = '';
    if (this.state.selection) {
      if (this.isSelectionOnRenderedMermaid()) return;
      this.deleteSelectedRange();
    }
    if (!this.state.cursor) return;

    const newCursor = this.blockStore.insertTextAtCursor(this.state.cursor, text);
    this.state.cursor = newCursor;

    if (!newCursor.tableCell) {
      this.checkAndApplyShortcut(newCursor.blockId);
    }
    this.reflowFrom(this.state.cursor.blockId);
    this.resetBlink();
    this.ensureCursorVisible();
    this.emit({ type: 'full' });
  }

  // ─── 复制粘贴 ───

  /**
   * 获取选区内的视觉文本（不含 Markdown 标记符）。
   * 同一块同一表单元格时从该格拼接串按 source→visual 切片；跨块仍按块级 visual 文本拼接。
   */
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

      if (start.tableCell && end.tableCell &&
          start.tableCell.row === end.tableCell.row && start.tableCell.col === end.tableCell.col) {
        const cell = this.blockStore.getTableCell(block, start.tableCell.row, start.tableCell.col);
        if (!cell) return '';
        const cellVisualText = cell.inlines.map(s => s.text).join('');
        const sv = this.blockStore.tableCellSourceToVisual(block, start.tableCell.row, start.tableCell.col, start.offset);
        const ev = this.blockStore.tableCellSourceToVisual(block, end.tableCell.row, end.tableCell.col, end.offset);
        return cellVisualText.substring(sv, ev);
      }

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

  /**
   * 处理 keydown：IME 组合中忽略；否则交给 KeyboardHandler，按 KeyboardAction
   * 更新 cursor/selection、删选区、分块/合并、重排，并发出 selectionOnly 或 full。
   */
  handleKeyDown(e: KeyboardEvent, isComposing: boolean) {
    if (!this.state.cursor) return;
    if (isComposing) return;

    const action = this.keyboardHandler.handleKeyDown(e, this.state.cursor, this.state.selection);
    if (action.type === 'none') return;

    switch (action.type) {
      case 'moveCursor':
        this.state.cursor = action.cursor;
        this.state.selection = action.selection;
        break;
      case 'dataChanged':
        this.state.cursor = action.cursor;
        this.state.selection = null;
        this.reflowFrom(action.cursor.blockId);
        break;
      case 'delete':
        this.deleteSelectedRange();
        this.fullLayout();
        break;
      case 'splitBlock':
        this.state.cursor = action.newCursor;
        this.state.selection = null;
        this.fullLayout();
        break;
      case 'mergeWithPrev':
        this.state.cursor = action.newCursor;
        this.state.selection = null;
        this.fullLayout();
        break;
      case 'dataChangedWithSelection':
        this.state.cursor = action.cursor;
        this.state.selection = action.selection;
        this.reflowFrom(action.cursor.blockId);
        break;
    }

    this.resetBlink();
    this.ensureCursorVisible();
    this.emit({ type: action.type === 'moveCursor' ? 'selectionOnly' : 'full' });
  }

  // ─── 滚动 ───

  handleWheel(deltaY: number) {
    const maxScroll = this.getMaxScroll();
    const oldScrollY = this.state.scrollY;
    const newScrollY = Math.max(0, Math.min(maxScroll, oldScrollY + deltaY));
    if (newScrollY === oldScrollY) return;
    this.state.scrollY = newScrollY;
    this.emit({ type: 'scroll', oldScrollY });
  }

  handleScrollbarScroll(newScrollY: number) {
    const oldScrollY = this.state.scrollY;
    this.state.scrollY = newScrollY;
    this.emit({ type: 'scroll', oldScrollY });
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

  /**
   * 删除选区内的文本。
   * 同块同表单元格只改 cell.rawText 并 reparseTableCell + rebuildTableRawText；否则单块改 rawText 或跨块合并删除中间块。
   */
  private deleteSelectedRange() {
    const sel = this.state.selection;
    if (!sel) return;

    const blocks = this.blockStore.getBlocks();
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
        if (startPos.tableCell && endPos.tableCell && block.tableData &&
            startPos.tableCell.row === endPos.tableCell.row && startPos.tableCell.col === endPos.tableCell.col) {
          const cell = this.blockStore.getTableCell(block, startPos.tableCell.row, startPos.tableCell.col);
          if (cell) {
            cell.rawText = cell.rawText.substring(0, startPos.offset) + cell.rawText.substring(endPos.offset);
            this.blockStore.reparseTableCellPublic(cell);
            this.blockStore.rebuildTableRawTextPublic(block);
          }
        } else {
          block.rawText = block.rawText.substring(0, startPos.offset) + block.rawText.substring(endPos.offset);
          this.blockStore.reparseBlock(block);
        }
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

  /** 检查当前选区是否覆盖了一个已渲染的 mermaid 块 */
  private isSelectionOnRenderedMermaid(): boolean {
    const sel = this.state.selection;
    if (!sel || sel.anchor.blockId !== sel.focus.blockId) return false;
    const block = this.blockStore.getBlock(sel.anchor.blockId);
    return !!block && isRenderedMermaid(block);
  }

  /** 从指定块开始增量重排 */
  private reflowFrom(blockId: string) {
    const width = this.getContainerWidth();
    const idx = this.blockStore.getBlockIndex(blockId);
    this.layoutEngine.reflowFrom(this.blockStore.getBlocks(), Math.max(0, idx), width);
  }

  /** 全量重排所有块 */
  private fullLayout() {
    const width = this.getContainerWidth();
    this.layoutEngine.computeLayout(this.blockStore.getBlocks(), width);
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

  /**
   * 检测指针是否悬停在任务列表 checkbox 上；为 true 时 UI 可显示手型光标。
   */
  checkHoverCheckbox(sceneX: number, sceneY: number): boolean {
    return this.hitTester.hitCheckbox(sceneX, sceneY, this.blockStore.getBlocks()) !== null;
  }

  /**
   * 光标所在行若超出视口则调整 scrollY；表内用单元格子 layout 与 tableCellSourceToVisual 定位行盒，逻辑与正文块平行。
   */
  private ensureCursorVisible() {
    const cursor = this.state.cursor;
    if (!cursor) return;

    const block = this.blockStore.getBlock(cursor.blockId);
    if (!block?.layout) return;

    const viewportH = this.getViewportHeight();
    const scrollY = this.state.scrollY;
    let cursorY: number;
    let cursorH: number;

    if (cursor.tableCell && block.layout.tableCells) {
      const { row, col } = cursor.tableCell;
      const layoutRow = row === -1 ? 0 : row + 1;
      const cellLayout = block.layout.tableCells[layoutRow]?.[col];
      if (cellLayout && cellLayout.lines.length > 0) {
        const targetLine = this.findCursorLine(cellLayout.lines,
          this.blockStore.tableCellSourceToVisual(block, row, col, cursor.offset));
        cursorY = targetLine.y;
        cursorH = targetLine.height;
      } else {
        cursorY = block.layout.y;
        cursorH = block.layout.height;
      }
    } else if (block.layout.lines.length > 0) {
      const visualOffset = this.blockStore.sourceToVisual(block, cursor.offset);
      const targetLine = this.findCursorLine(block.layout.lines, visualOffset);
      cursorY = targetLine.y;
      cursorH = targetLine.height;
    } else {
      cursorY = block.layout.y;
      cursorH = block.layout.height;
    }

    if (cursorY < scrollY) {
      const oldScrollY = this.state.scrollY;
      this.state.scrollY = cursorY;
      this.emit({ type: 'scroll', oldScrollY });
    } else if (cursorY + cursorH > scrollY + viewportH) {
      const oldScrollY = this.state.scrollY;
      this.state.scrollY = Math.min(this.getMaxScroll(), cursorY + cursorH - viewportH + 10);
      this.emit({ type: 'scroll', oldScrollY });
    }
  }

  /**
   * 按累计 visual 字符（含 newlineBefore）判断 visualOffset 落在哪一行，供 ensureCursorVisible 与表单元格多行共用。
   */
  private findCursorLine(
    lines: readonly { y: number; height: number; segments: readonly { text: string }[]; newlineBefore?: boolean }[],
    visualOffset: number,
  ) {
    let charCount = 0;
    for (const line of lines) {
      if (line.newlineBefore) charCount++;
      let lineLen = 0;
      for (const seg of line.segments) lineLen += seg.text.length;
      if (visualOffset <= charCount + lineLen) return line;
      charCount += lineLen;
    }
    return lines[lines.length - 1];
  }

  private emit(request: RenderRequest) {
    this.renderHandlers.forEach(h => h(request));
  }
}
