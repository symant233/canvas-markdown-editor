import type { Block, CursorPosition, SelectionRange } from './types';
import { BlockStore } from './BlockStore';
import { isRenderedMermaid } from './MermaidRenderer';

/** moveCursor: 仅移动光标；dataChanged: 单块编辑；dataChangedWithSelection: 编辑后保留选区；delete: 删选区；splitBlock: 换行分块；mergeWithPrev: 退格合并前块；none: 不处理 */
export type KeyboardAction =
  | { type: 'moveCursor'; cursor: CursorPosition; selection: SelectionRange | null }
  | { type: 'dataChanged'; cursor: CursorPosition }
  | { type: 'dataChangedWithSelection'; cursor: CursorPosition; selection: SelectionRange }
  | { type: 'delete' }
  | { type: 'splitBlock'; newCursor: CursorPosition }
  | { type: 'mergeWithPrev'; newCursor: CursorPosition }
  | { type: 'none' };

/** 处理键盘事件并返回 KeyboardAction，由上层根据 action 类型执行对应操作 */
export class KeyboardHandler {
  private blockStore: BlockStore;
  constructor(blockStore: BlockStore) {
    this.blockStore = blockStore;
  }

  /**
   * Ctrl+A 全选；Ctrl+B/I/U、Ctrl+Shift+S 切换 **、*、++、~~ 等行内标记；
   * 方向键、Home/End、Backspace/Delete/Enter/Tab 分发到对应处理。
   */
  handleKeyDown(
    e: KeyboardEvent,
    cursor: CursorPosition,
    selection: SelectionRange | null,
  ): KeyboardAction {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'a') {
        e.preventDefault();
        return this.selectAll();
      }
      if (e.key === 'b') {
        e.preventDefault();
        return this.toggleInlineFormat(cursor, selection, '**');
      }
      if (e.key === 'i') {
        e.preventDefault();
        return this.toggleInlineFormat(cursor, selection, '*');
      }
      if (e.key === 'u') {
        e.preventDefault();
        return this.toggleInlineFormat(cursor, selection, '++');
      }
      if (e.key === 'S' && e.shiftKey) {
        e.preventDefault();
        return this.toggleInlineFormat(cursor, selection, '~~');
      }
      return { type: 'none' };
    }

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        return this.moveCursor(cursor, -1, e.shiftKey, selection);
      case 'ArrowRight':
        e.preventDefault();
        return this.moveCursor(cursor, 1, e.shiftKey, selection);
      case 'ArrowUp':
        e.preventDefault();
        return this.moveCursorVertical(cursor, -1, e.shiftKey, selection);
      case 'ArrowDown':
        e.preventDefault();
        return this.moveCursorVertical(cursor, 1, e.shiftKey, selection);
      case 'Home':
        e.preventDefault();
        return this.moveCursorToLineEdge(cursor, 'start', e.shiftKey, selection);
      case 'End':
        e.preventDefault();
        return this.moveCursorToLineEdge(cursor, 'end', e.shiftKey, selection);
      case 'Backspace':
        e.preventDefault();
        return this.handleBackspace(cursor, selection);
      case 'Delete':
        e.preventDefault();
        return this.handleDelete(cursor, selection);
      case 'Enter':
        e.preventDefault();
        return this.handleEnter(cursor, selection);
      case 'Tab':
        e.preventDefault();
        return this.handleTab(cursor, e.shiftKey);
      default:
        return { type: 'none' };
    }
  }

  /**
   * 有选区且非 Shift：折叠到选区起点或终点；
   * hr 块：直接跳到相邻块；
   * 标记符跳过：source 偏移变化后检查 visual 是否变化，未变则继续移动（跳过 **、* 等不可见标记）
   */
  private moveCursor(
    cursor: CursorPosition,
    direction: -1 | 1,
    extendSelection: boolean,
    currentSelection: SelectionRange | null,
  ): KeyboardAction {
    const blocks = this.blockStore.getBlocks();
    const block = this.blockStore.getBlock(cursor.blockId);
    if (!block) return { type: 'none' };

    const rawLen = this.blockStore.getRawTextLength(block);
    let newCursor: CursorPosition;

    if (!extendSelection && currentSelection) {
      const { anchor, focus } = this.normalizeSelection(currentSelection, blocks);
      newCursor = direction === -1 ? anchor : focus;
      return { type: 'moveCursor', cursor: newCursor, selection: null };
    }

    /**
     * 表格单元格内左右键：offset 越界时交给 handleTabInTable 切换邻格；格内则按单元格 visual 映射跳过不可见的 Markdown 标记。
     */
    if (cursor.tableCell && block.tableData) {
      const cellLen = this.blockStore.getTableCellRawTextLength(block, cursor.tableCell.row, cursor.tableCell.col);
      let newOff = cursor.offset + direction;

      if (newOff < 0 || newOff > cellLen) {
        const result = this.handleTabInTable(cursor, block, direction === -1);
        return result;
      }

      const oldVis = this.blockStore.tableCellSourceToVisual(block, cursor.tableCell.row, cursor.tableCell.col, cursor.offset);
      if (direction === 1) {
        while (newOff <= cellLen && this.blockStore.tableCellSourceToVisual(block, cursor.tableCell.row, cursor.tableCell.col, newOff) === oldVis) newOff++;
        if (newOff > cellLen) newOff = cellLen;
      } else {
        while (newOff >= 0 && this.blockStore.tableCellSourceToVisual(block, cursor.tableCell.row, cursor.tableCell.col, newOff) === oldVis) newOff--;
        if (newOff < 0) newOff = 0;
      }

      newCursor = { blockId: cursor.blockId, offset: newOff, tableCell: cursor.tableCell };
      const newSelection = extendSelection
        ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
        : null;
      return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
    }

    // 原子块（hr / 已渲染 mermaid）：左右方向键直接跳到相邻块
    if (block.type === 'hr' || isRenderedMermaid(block)) {
      const target = direction === 1
        ? this.blockStore.getNextBlock(cursor.blockId)
        : this.blockStore.getPrevBlock(cursor.blockId);
      if (!target) return { type: 'none' };
      newCursor = direction === 1
        ? { blockId: target.id, offset: 0 }
        : { blockId: target.id, offset: this.blockStore.getRawTextLength(target) };
      const newSelection = extendSelection
        ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
        : null;
      return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
    }

    let newOffset = cursor.offset + direction;

    if (newOffset < 0) {
      const prev = this.blockStore.getPrevBlock(cursor.blockId);
      if (!prev) return { type: 'none' };
      newCursor = { blockId: prev.id, offset: this.blockStore.getRawTextLength(prev) };
    } else if (newOffset > rawLen) {
      const next = this.blockStore.getNextBlock(cursor.blockId);
      if (!next) return { type: 'none' };
      newCursor = { blockId: next.id, offset: 0 };
    } else {
      const oldVisual = this.blockStore.sourceToVisual(block, cursor.offset);
      if (direction === 1) {
        while (newOffset <= rawLen && this.blockStore.sourceToVisual(block, newOffset) === oldVisual) {
          newOffset++;
        }
        if (newOffset > rawLen) {
          const next = this.blockStore.getNextBlock(cursor.blockId);
          if (!next) {
            newOffset = rawLen;
          } else {
            newCursor = { blockId: next.id, offset: 0 };
            const newSelection = extendSelection
              ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
              : null;
            return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
          }
        }
      } else {
        while (newOffset >= 0 && this.blockStore.sourceToVisual(block, newOffset) === oldVisual) {
          newOffset--;
        }
        if (newOffset < 0) {
          const prev = this.blockStore.getPrevBlock(cursor.blockId);
          if (!prev) {
            newOffset = 0;
          } else {
            newCursor = { blockId: prev.id, offset: this.blockStore.getRawTextLength(prev) };
            const newSelection = extendSelection
              ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
              : null;
            return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
          }
        }
      }
      newCursor = { blockId: cursor.blockId, offset: newOffset };
    }

    const newSelection = extendSelection
      ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
      : null;

    return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
  }

  /**
   * 先将 source 转 visual，用 getLineInfo 得到当前行和行内偏移；
   * 目标行上用同样行内偏移计算新 visual 再转回 source；
   * hr 块直接跳到相邻块
   */
  private moveCursorVertical(
    cursor: CursorPosition,
    direction: -1 | 1,
    extendSelection: boolean,
    currentSelection: SelectionRange | null,
  ): KeyboardAction {
    const block = this.blockStore.getBlock(cursor.blockId);
    if (!block?.layout) return { type: 'none' };

    /**
     * 表格内上下键：按列在行间移动；目标格较短时将 offset 钳到该格长度，避免越界。
     */
    if (cursor.tableCell && block.tableData) {
      const { row, col } = cursor.tableCell;
      const newRow = row + direction;
      if (newRow < -1 || newRow >= block.tableData.rows.length) {
        return { type: 'none' };
      }
      const cellLen = this.blockStore.getTableCellRawTextLength(block, newRow, col);
      const newOffset = Math.min(cursor.offset, cellLen);
      const newCursor: CursorPosition = { blockId: block.id, offset: newOffset, tableCell: { row: newRow, col } };
      const newSelection = extendSelection
        ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
        : null;
      return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
    }

    if (block.type === 'hr' || isRenderedMermaid(block)) {
      const target = direction === -1
        ? this.blockStore.getPrevBlock(cursor.blockId)
        : this.blockStore.getNextBlock(cursor.blockId);
      if (!target?.layout) return { type: 'none' };
      const targetOffset = (target.type === 'hr' || isRenderedMermaid(target)) ? 0 : this.blockStore.getRawTextLength(target);
      const newCursor: CursorPosition = { blockId: target.id, offset: direction === -1 ? targetOffset : 0 };
      const newSelection = extendSelection
        ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
        : null;
      return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
    }

    const visualOffset = this.blockStore.sourceToVisual(block, cursor.offset);
    const { lineIndex, offsetInLine } = this.getLineInfo(block, visualOffset);

    let newCursor: CursorPosition;

    if (direction === -1) {
      if (lineIndex > 0) {
        const targetLine = block.layout.lines[lineIndex - 1];
        const lineTextLen = targetLine.segments.reduce((s, seg) => s + seg.text.length, 0);
        const targetOffset = Math.min(offsetInLine, lineTextLen);
        const prevLinesOffset = this.getVisualOffsetAtLineStart(block, lineIndex - 1);
        const newSourceOffset = this.blockStore.visualToSource(block, prevLinesOffset + targetOffset);
        newCursor = { blockId: block.id, offset: newSourceOffset };
      } else {
        const prev = this.blockStore.getPrevBlock(cursor.blockId);
        if (!prev?.layout) return { type: 'none' };
        if (prev.type === 'hr') {
          newCursor = { blockId: prev.id, offset: 0 };
        } else {
          const lastLineIdx = prev.layout.lines.length - 1;
          const lastLine = prev.layout.lines[lastLineIdx];
          const lineTextLen = lastLine.segments.reduce((s, seg) => s + seg.text.length, 0);
          const targetOffset = Math.min(offsetInLine, lineTextLen);
          const prevLinesOffset = this.getVisualOffsetAtLineStart(prev, lastLineIdx);
          const newSourceOffset = this.blockStore.visualToSource(prev, prevLinesOffset + targetOffset);
          newCursor = { blockId: prev.id, offset: newSourceOffset };
        }
      }
    } else {
      if (lineIndex < block.layout.lines.length - 1) {
        const targetLine = block.layout.lines[lineIndex + 1];
        const lineTextLen = targetLine.segments.reduce((s, seg) => s + seg.text.length, 0);
        const targetOffset = Math.min(offsetInLine, lineTextLen);
        const nextLinesOffset = this.getVisualOffsetAtLineStart(block, lineIndex + 1);
        const newSourceOffset = this.blockStore.visualToSource(block, nextLinesOffset + targetOffset);
        newCursor = { blockId: block.id, offset: newSourceOffset };
      } else {
        const next = this.blockStore.getNextBlock(cursor.blockId);
        if (!next?.layout) return { type: 'none' };
        if (next.type === 'hr') {
          newCursor = { blockId: next.id, offset: 0 };
        } else {
          const firstLine = next.layout.lines[0];
          const lineTextLen = firstLine.segments.reduce((s, seg) => s + seg.text.length, 0);
          const targetOffset = Math.min(offsetInLine, lineTextLen);
          const newSourceOffset = this.blockStore.visualToSource(next, targetOffset);
          newCursor = { blockId: next.id, offset: newSourceOffset };
        }
      }
    }

    const newSelection = extendSelection
      ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
      : null;

    return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
  }

  /**
   * Home/End：按 layout 将光标移到当前逻辑行首/行尾（source↔visual 转换）。
   * 表内则跳到当前单元格 raw 的首/尾，不按单元格内软换行再切分。
   */
  private moveCursorToLineEdge(
    cursor: CursorPosition,
    edge: 'start' | 'end',
    extendSelection: boolean,
    currentSelection: SelectionRange | null,
  ): KeyboardAction {
    const block = this.blockStore.getBlock(cursor.blockId);
    if (!block?.layout) return { type: 'none' };

    /**
     * 表格内 Home/End：跳到当前单元格 raw 首尾，不按单元格内软换行再切分。
     */
    if (cursor.tableCell && block.tableData) {
      const cellLen = this.blockStore.getTableCellRawTextLength(block, cursor.tableCell.row, cursor.tableCell.col);
      const newOffset = edge === 'start' ? 0 : cellLen;
      const newCursor: CursorPosition = { blockId: cursor.blockId, offset: newOffset, tableCell: cursor.tableCell };
      const newSelection = extendSelection
        ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
        : null;
      return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
    }

    const visualOffset = this.blockStore.sourceToVisual(block, cursor.offset);
    const { lineIndex } = this.getLineInfo(block, visualOffset);
    const lineStartVisual = this.getVisualOffsetAtLineStart(block, lineIndex);
    const lineTextLen = block.layout.lines[lineIndex].segments.reduce((s, seg) => s + seg.text.length, 0);

    const targetVisual = edge === 'start' ? lineStartVisual : lineStartVisual + lineTextLen;
    const newSourceOffset = this.blockStore.visualToSource(block, targetVisual);
    const newCursor: CursorPosition = { blockId: cursor.blockId, offset: newSourceOffset };

    const newSelection = extendSelection
      ? { anchor: currentSelection?.anchor ?? cursor, focus: newCursor }
      : null;

    return { type: 'moveCursor', cursor: newCursor, selection: newSelection };
  }

  /**
   * 有选区时交由上层 delete；否则：
   * 表内仅删格内字符，offset 为 0 时不合并块；
   * hr 块：删整块并将光标落到前块末尾（无前块则留在原位 offset 0）；
   * 块首非 paragraph：降级为 paragraph；块首 paragraph：前块为 hr 则删 hr，否则 mergeWithPrev。
   */
  private handleBackspace(
    cursor: CursorPosition,
    selection: SelectionRange | null,
  ): KeyboardAction {
    // 选中了已渲染的 mermaid 块 → 整块删除
    if (selection) {
      if (selection.anchor.blockId === selection.focus.blockId) {
        const selBlock = this.blockStore.getBlock(selection.anchor.blockId);
        if (selBlock && isRenderedMermaid(selBlock)) {
          return this.removeMermaidBlock(selBlock, 'backward');
        }
      }
      return { type: 'delete' };
    }

    const block = this.blockStore.getBlock(cursor.blockId);
    if (!block) return { type: 'none' };

    if (cursor.tableCell && block.tableData) {
      if (cursor.offset === 0) return { type: 'none' };
      this.blockStore.deleteCharAt(cursor.blockId, cursor.offset - 1, cursor.tableCell);
      return { type: 'dataChanged', cursor: { blockId: cursor.blockId, offset: cursor.offset - 1, tableCell: cursor.tableCell } };
    }

    // 光标在原子块上：直接删整块
    if (block.type === 'hr' || isRenderedMermaid(block)) {
      const prev = this.blockStore.getPrevBlock(cursor.blockId);
      const newCursor: CursorPosition = prev
        ? { blockId: prev.id, offset: this.blockStore.getRawTextLength(prev) }
        : { blockId: cursor.blockId, offset: 0 };
      this.blockStore.removeBlock(cursor.blockId);
      return { type: 'dataChanged', cursor: newCursor };
    }

    if (cursor.offset === 0) {
      if (block.type !== 'paragraph') {
        block.type = 'paragraph';
        this.blockStore.reparseBlock(block);
        return { type: 'dataChanged', cursor };
      }

      // 前方是 mermaid 块：删除它，光标留在当前块
      const prev = this.blockStore.getPrevBlock(cursor.blockId);
      if (prev && isRenderedMermaid(prev)) {
        this.blockStore.removeBlock(prev.id);
        return { type: 'dataChanged', cursor };
      }
      if (prev?.type === 'hr') {
        const prevPrev = this.blockStore.getPrevBlock(prev.id);
        this.blockStore.removeBlock(prev.id);
        const newCursor: CursorPosition = prevPrev
          ? { blockId: prevPrev.id, offset: this.blockStore.getRawTextLength(prevPrev) }
          : cursor;
        return { type: 'dataChanged', cursor: newCursor };
      }

      const result = this.blockStore.mergeWithPrevBlock(cursor.blockId);
      if (result) {
        return { type: 'mergeWithPrev', newCursor: result };
      }
      return { type: 'none' };
    }

    this.blockStore.deleteCharAt(cursor.blockId, cursor.offset - 1);
    return {
      type: 'dataChanged',
      cursor: { blockId: cursor.blockId, offset: cursor.offset - 1 },
    };
  }

  /**
   * 有选区时交由上层 delete；否则：
   * 表内只删当前格，已在格尾则 noop；
   * hr / 已渲染 mermaid 块：删整块，光标移到下一块开头（无则 offset 0）；
   * 块末：下一块为 hr / mermaid 则删之；否则将下块 raw 拼入当前块并移除下块。
   */
  private handleDelete(
    cursor: CursorPosition,
    selection: SelectionRange | null,
  ): KeyboardAction {
    // 选中了已渲染的 mermaid 块 → 整块删除
    if (selection) {
      if (selection.anchor.blockId === selection.focus.blockId) {
        const selBlock = this.blockStore.getBlock(selection.anchor.blockId);
        if (selBlock && isRenderedMermaid(selBlock)) {
          return this.removeMermaidBlock(selBlock, 'forward');
        }
      }
      return { type: 'delete' };
    }

    const block = this.blockStore.getBlock(cursor.blockId);
    if (!block) return { type: 'none' };

    if (cursor.tableCell && block.tableData) {
      const cellLen = this.blockStore.getTableCellRawTextLength(block, cursor.tableCell.row, cursor.tableCell.col);
      if (cursor.offset >= cellLen) return { type: 'none' };
      this.blockStore.deleteCharAt(cursor.blockId, cursor.offset, cursor.tableCell);
      return { type: 'dataChanged', cursor };
    }

    // 光标在原子块上：直接删整块
    if (block.type === 'hr' || isRenderedMermaid(block)) {
      const next = this.blockStore.getNextBlock(cursor.blockId);
      const newCursor: CursorPosition = next
        ? { blockId: next.id, offset: 0 }
        : { blockId: cursor.blockId, offset: 0 };
      this.blockStore.removeBlock(cursor.blockId);
      return { type: 'dataChanged', cursor: newCursor };
    }

    const rawLen = this.blockStore.getRawTextLength(block);

    if (cursor.offset >= rawLen) {
      const next = this.blockStore.getNextBlock(cursor.blockId);
      if (!next) return { type: 'none' };

      // 后方是原子块：直接删除后方块
      if (next.type === 'hr' || isRenderedMermaid(next)) {
        this.blockStore.removeBlock(next.id);
        return { type: 'dataChanged', cursor };
      }

      block.rawText = block.rawText + next.rawText;
      this.blockStore.reparseBlock(block);
      const newBlocks = this.blockStore.getBlocks().filter(b => b.id !== next.id);
      this.blockStore.setBlocks(newBlocks);
      return { type: 'dataChanged', cursor };
    }

    this.blockStore.deleteCharAt(cursor.blockId, cursor.offset);
    return { type: 'dataChanged', cursor };
  }

  /**
   * 委托 blockStore.splitBlock 在光标处分块；有选区时先删选区。
   * 光标在表单元格内时不 split，避免拆散表格块。
   */
  private handleEnter(
    cursor: CursorPosition,
    selection: SelectionRange | null,
  ): KeyboardAction {
    const curBlock = this.blockStore.getBlock(cursor.blockId);
    if (curBlock && isRenderedMermaid(curBlock)) return { type: 'none' };

    if (selection) {
      return { type: 'delete' };
    }

    if (cursor.tableCell) return { type: 'none' };

    const newCursor = this.blockStore.splitBlock(cursor);
    return { type: 'splitBlock', newCursor };
  }

  private selectAll(): KeyboardAction {
    const blocks = this.blockStore.getBlocks();
    if (blocks.length === 0) return { type: 'none' };

    const firstBlock = blocks[0];
    const lastBlock = blocks[blocks.length - 1];
    const lastBlockLen = this.blockStore.getRawTextLength(lastBlock);

    return {
      type: 'moveCursor',
      cursor: { blockId: lastBlock.id, offset: lastBlockLen },
      selection: {
        anchor: { blockId: firstBlock.id, offset: 0 },
        focus: { blockId: lastBlock.id, offset: lastBlockLen },
      },
    };
  }

  /**
   * 表内：Tab/Shift+Tab 在单元格间移动光标；
   * 代码块：见 handleTabInCodeBlock，只缩进/反缩进光标所在行；
   * 普通块：行首加/减两空格（或一个制表符）。
   */
  private handleTab(cursor: CursorPosition, shiftKey: boolean): KeyboardAction {
    const block = this.blockStore.getBlock(cursor.blockId);
    if (!block) return { type: 'none' };

    if (cursor.tableCell && block.tableData) {
      return this.handleTabInTable(cursor, block, shiftKey);
    }

    if (block.type === 'code-block') {
      return this.handleTabInCodeBlock(cursor, block, shiftKey);
    }

    if (shiftKey) {
      if (block.rawText.startsWith('  ')) {
        block.rawText = block.rawText.substring(2);
        this.blockStore.reparseBlock(block);
        return { type: 'dataChanged', cursor: { blockId: cursor.blockId, offset: Math.max(0, cursor.offset - 2) } };
      }
      if (block.rawText.startsWith('\t')) {
        block.rawText = block.rawText.substring(1);
        this.blockStore.reparseBlock(block);
        return { type: 'dataChanged', cursor: { blockId: cursor.blockId, offset: Math.max(0, cursor.offset - 1) } };
      }
    } else {
      block.rawText = '  ' + block.rawText;
      this.blockStore.reparseBlock(block);
      return { type: 'dataChanged', cursor: { blockId: cursor.blockId, offset: cursor.offset + 2 } };
    }

    return { type: 'none' };
  }

  /** 用 \n 切分 rawText 定位光标所在行，只改该行缩进，其他行不变，再 join 更新 rawText */
  private handleTabInCodeBlock(cursor: CursorPosition, block: Block, shiftKey: boolean): KeyboardAction {
    const rawLines = block.rawText.split('\n');
    let charCount = 0;
    let targetLineIdx = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const lineEnd = charCount + rawLines[i].length;
      if (cursor.offset <= lineEnd) {
        targetLineIdx = i;
        break;
      }
      charCount = lineEnd + 1;
    }

    if (shiftKey) {
      const line = rawLines[targetLineIdx];
      if (line.startsWith('  ')) {
        rawLines[targetLineIdx] = line.substring(2);
        block.rawText = rawLines.join('\n');
        this.blockStore.reparseBlock(block);
        return { type: 'dataChanged', cursor: { blockId: cursor.blockId, offset: Math.max(charCount, cursor.offset - 2) } };
      }
      if (line.startsWith('\t')) {
        rawLines[targetLineIdx] = line.substring(1);
        block.rawText = rawLines.join('\n');
        this.blockStore.reparseBlock(block);
        return { type: 'dataChanged', cursor: { blockId: cursor.blockId, offset: Math.max(charCount, cursor.offset - 1) } };
      }
    } else {
      rawLines[targetLineIdx] = '  ' + rawLines[targetLineIdx];
      block.rawText = rawLines.join('\n');
      this.blockStore.reparseBlock(block);
      return { type: 'dataChanged', cursor: { blockId: cursor.blockId, offset: cursor.offset + 2 } };
    }

    return { type: 'none' };
  }

  /**
   * 行内标记切换：检查选区前后是否已有同一 marker（**、*、++、~~ 等），
   * 有则成对移除，无则成对包裹；仅支持单块内选区。
   */
  private toggleInlineFormat(
    _cursor: CursorPosition,
    selection: SelectionRange | null,
    marker: string,
  ): KeyboardAction {
    if (!selection) return { type: 'none' };

    const block = this.blockStore.getBlock(selection.anchor.blockId);
    if (!block) return { type: 'none' };
    if (selection.anchor.blockId !== selection.focus.blockId) return { type: 'none' };

    let start = Math.min(selection.anchor.offset, selection.focus.offset);
    let end = Math.max(selection.anchor.offset, selection.focus.offset);

    const raw = block.rawText;
    const markerLen = marker.length;
    const hasBefore = raw.substring(start - markerLen, start) === marker;
    const hasAfter = raw.substring(end, end + markerLen) === marker;

    if (hasBefore && hasAfter) {
      block.rawText = raw.substring(0, start - markerLen) + raw.substring(start, end) + raw.substring(end + markerLen);
      start -= markerLen;
      end -= markerLen;
    } else {
      block.rawText = raw.substring(0, start) + marker + raw.substring(start, end) + marker + raw.substring(end);
      start += markerLen;
      end += markerLen;
    }

    this.blockStore.reparseBlock(block);
    const newCursor: CursorPosition = { blockId: block.id, offset: end };
    const newSelection: SelectionRange = {
      anchor: { blockId: block.id, offset: start },
      focus: { blockId: block.id, offset: end },
    };
    return { type: 'dataChangedWithSelection', cursor: newCursor, selection: newSelection };
  }

  /** 整块删除已渲染的 mermaid 块，光标移动到相邻块 */
  private removeMermaidBlock(block: Block, direction: 'backward' | 'forward'): KeyboardAction {
    const prev = this.blockStore.getPrevBlock(block.id);
    const next = this.blockStore.getNextBlock(block.id);
    let newCursor: CursorPosition;
    if (direction === 'backward') {
      newCursor = prev
        ? { blockId: prev.id, offset: this.blockStore.getRawTextLength(prev) }
        : next
          ? { blockId: next.id, offset: 0 }
          : { blockId: block.id, offset: 0 };
    } else {
      newCursor = next
        ? { blockId: next.id, offset: 0 }
        : prev
          ? { blockId: prev.id, offset: this.blockStore.getRawTextLength(prev) }
          : { blockId: block.id, offset: 0 };
    }
    this.blockStore.removeBlock(block.id);
    return { type: 'dataChanged', cursor: newCursor };
  }

  /** 将 visual 偏移定位到行号和行内偏移（含 newlineBefore 的计数） */
  private getLineInfo(block: Block, visualOffset: number): { lineIndex: number; offsetInLine: number } {
    let charCount = 0;

    for (let lineIdx = 0; lineIdx < block.layout!.lines.length; lineIdx++) {
      const line = block.layout!.lines[lineIdx];
      if (line.newlineBefore) charCount++;
      let lineLen = 0;
      for (const seg of line.segments) {
        lineLen += seg.text.length;
      }

      if (visualOffset <= charCount + lineLen) {
        return { lineIndex: lineIdx, offsetInLine: visualOffset - charCount };
      }
      charCount += lineLen;
    }

    const lastIdx = block.layout!.lines.length - 1;
    const lastLineLen = block.layout!.lines[lastIdx].segments.reduce((s, seg) => s + seg.text.length, 0);
    return { lineIndex: lastIdx, offsetInLine: lastLineLen };
  }

  /** 指定行之前所有行的累计视觉字符数，含该行 newlineBefore */
  private getVisualOffsetAtLineStart(block: Block, lineIndex: number): number {
    let offset = 0;
    for (let i = 0; i < lineIndex; i++) {
      if (block.layout!.lines[i].newlineBefore) offset++;
      for (const seg of block.layout!.lines[i].segments) {
        offset += seg.text.length;
      }
    }
    if (lineIndex < block.layout!.lines.length && block.layout!.lines[lineIndex].newlineBefore) {
      offset++;
    }
    return offset;
  }

  /**
   * 表格内 Tab / Shift+Tab：在行内前进/后退列，到行尾则折到下一行首列（反向同理）；越出表范围则返回 none。
   */
  private handleTabInTable(cursor: CursorPosition, block: Block, shiftKey: boolean): KeyboardAction {
    const data = block.tableData!;
    const { row, col } = cursor.tableCell!;
    const colCount = data.headers.length;
    const totalRows = data.rows.length;

    let newRow = row;
    let newCol = col;

    if (shiftKey) {
      newCol--;
      if (newCol < 0) {
        newCol = colCount - 1;
        newRow--;
        if (newRow < -1) return { type: 'none' };
      }
    } else {
      newCol++;
      if (newCol >= colCount) {
        newCol = 0;
        newRow++;
        if (newRow >= totalRows) return { type: 'none' };
      }
    }

    const cell = this.blockStore.getTableCell(block, newRow, newCol);
    const offset = cell ? cell.rawText.length : 0;

    return {
      type: 'moveCursor',
      cursor: { blockId: block.id, offset, tableCell: { row: newRow, col: newCol } },
      selection: null,
    };
  }

  /** 确保 anchor 在 focus 之前（按块顺序与 offset 比较） */
  private normalizeSelection(
    sel: SelectionRange,
    blocks: readonly Block[],
  ): { anchor: CursorPosition; focus: CursorPosition } {
    const anchorIdx = blocks.findIndex(b => b.id === sel.anchor.blockId);
    const focusIdx = blocks.findIndex(b => b.id === sel.focus.blockId);

    if (anchorIdx < focusIdx) return { anchor: sel.anchor, focus: sel.focus };
    if (anchorIdx > focusIdx) return { anchor: sel.focus, focus: sel.anchor };

    if (sel.anchor.offset <= sel.focus.offset) return sel;
    return { anchor: sel.focus, focus: sel.anchor };
  }
}
