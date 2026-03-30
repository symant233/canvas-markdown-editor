import type { Block, CursorPosition, TableCell } from '../types';
import { createBlock, DEFAULT_INLINE_STYLE } from '../types';
import { parseInlineMarkdown } from '../parser/InlineParser';
import { highlightCode } from '../parser/SyntaxHighlighter';

type Listener = () => void;

/** 块数据管理器，作为编辑器的单一数据源（Single Source of Truth） */
export class BlockStore {
  private blocks: Block[] = [];
  private listeners: Set<Listener> = new Set();

  getBlocks(): readonly Block[] {
    return this.blocks;
  }

  getBlock(id: string): Block | undefined {
    return this.blocks.find(b => b.id === id);
  }

  getBlockIndex(id: string): number {
    return this.blocks.findIndex(b => b.id === id);
  }

  getPrevBlock(id: string): Block | undefined {
    const idx = this.getBlockIndex(id);
    return idx > 0 ? this.blocks[idx - 1] : undefined;
  }

  getNextBlock(id: string): Block | undefined {
    const idx = this.getBlockIndex(id);
    return idx >= 0 && idx < this.blocks.length - 1 ? this.blocks[idx + 1] : undefined;
  }

  setBlocks(blocks: Block[]) {
    this.blocks = blocks;
    this.notify();
  }

  removeBlock(id: string) {
    this.blocks = this.blocks.filter(b => b.id !== id);
    if (this.blocks.length === 0) {
      this.blocks = [createBlock('paragraph', '', [{ text: '', style: { ...DEFAULT_INLINE_STYLE } }])];
    }
    this.notify();
  }

  getRawTextLength(block: Block): number {
    return block.rawText.length;
  }

  getVisualTextLength(block: Block): number {
    return block.inlines.reduce((sum, seg) => sum + seg.text.length, 0);
  }

  /** 在光标 source 位置插入文本后重解析 */
  insertTextAtCursor(cursor: CursorPosition, text: string): CursorPosition {
    const block = this.getBlock(cursor.blockId);
    if (!block) return cursor;

    if (cursor.tableCell && block.tableData) {
      const cell = this.getTableCell(block, cursor.tableCell.row, cursor.tableCell.col);
      if (cell) {
        cell.rawText = cell.rawText.substring(0, cursor.offset) + text + cell.rawText.substring(cursor.offset);
        this.reparseTableCell(cell);
        this.rebuildTableRawText(block);
        this.notify();
        return { blockId: cursor.blockId, offset: cursor.offset + text.length, tableCell: cursor.tableCell };
      }
    }

    const before = block.rawText.substring(0, cursor.offset);
    const after = block.rawText.substring(cursor.offset);
    block.rawText = before + text + after;

    this.reparseBlock(block);
    this.notify();

    return { blockId: cursor.blockId, offset: cursor.offset + text.length };
  }

  /** 删除 rawText 指定位置字符 */
  deleteCharAt(blockId: string, offset: number, tableCell?: { row: number; col: number }) {
    const block = this.getBlock(blockId);
    if (!block) return;

    if (tableCell && block.tableData) {
      const cell = this.getTableCell(block, tableCell.row, tableCell.col);
      if (cell && offset >= 0 && offset < cell.rawText.length) {
        cell.rawText = cell.rawText.substring(0, offset) + cell.rawText.substring(offset + 1);
        this.reparseTableCell(cell);
        this.rebuildTableRawText(block);
        this.notify();
      }
      return;
    }

    if (offset < 0 || offset >= block.rawText.length) return;
    block.rawText = block.rawText.substring(0, offset) + block.rawText.substring(offset + 1);
    this.reparseBlock(block);
    this.notify();
  }

  /** 合并到上一个块，返回合并后的光标位置（offset = 前块原长度） */
  mergeWithPrevBlock(blockId: string): CursorPosition | null {
    const idx = this.getBlockIndex(blockId);
    if (idx <= 0) return null;

    const prevBlock = this.blocks[idx - 1];
    const curBlock = this.blocks[idx];
    const mergeOffset = prevBlock.rawText.length;

    prevBlock.rawText = prevBlock.rawText + curBlock.rawText;
    this.reparseBlock(prevBlock);

    this.blocks.splice(idx, 1);
    this.notify();

    return { blockId: prevBlock.id, offset: mergeOffset };
  }

  /**
   * 拆分块逻辑：
   * - multilineTypes（code-block / blockquote）：回车插入 \n 而非拆分块；末尾连续两次回车退出
   * - 块首（offset=0）：在上方插入空块，列表/引用继承同类型，其他为 paragraph
   * - continuableTypes（无序列表/有序列表）：回车自动续行同类型；空列表项回车退出为段落
   */
  splitBlock(cursor: CursorPosition): CursorPosition {
    const block = this.getBlock(cursor.blockId);
    if (!block) return cursor;

    const idx = this.getBlockIndex(cursor.blockId);
    const beforeRaw = block.rawText.substring(0, cursor.offset);
    const afterRaw = block.rawText.substring(cursor.offset);

    const multilineTypes = new Set(['code-block', 'blockquote']);
    if (multilineTypes.has(block.type)) {
      if (beforeRaw.endsWith('\n') && afterRaw.length === 0) {
        block.rawText = beforeRaw.slice(0, -1);
        this.reparseBlock(block);

        const newBlock = createBlock('paragraph', '', [{ text: '', style: { ...DEFAULT_INLINE_STYLE } }]);
        this.blocks.splice(idx + 1, 0, newBlock);
        this.notify();
        return { blockId: newBlock.id, offset: 0 };
      }

      block.rawText = beforeRaw + '\n' + afterRaw;
      this.reparseBlock(block);
      this.notify();
      return { blockId: block.id, offset: cursor.offset + 1 };
    }

    const continuableTypes = new Set(['bullet-list', 'ordered-list', 'task-list']);
    const continueType = continuableTypes.has(block.type) ? block.type : 'paragraph';

    if (continuableTypes.has(block.type) && beforeRaw.length === 0 && afterRaw.length === 0) {
      block.type = 'paragraph';
      this.notify();
      return { blockId: block.id, offset: 0 };
    }

    if (cursor.offset === 0) {
      const emptyType = continuableTypes.has(block.type) ? block.type : 'paragraph';
      const emptyBlock = createBlock(emptyType, '', [{ text: '', style: { ...DEFAULT_INLINE_STYLE } }]);
      this.blocks.splice(idx, 0, emptyBlock);
      this.notify();
      return { blockId: block.id, offset: 0 };
    }

    block.rawText = beforeRaw;
    this.reparseBlock(block);

    const newBlock = createBlock(continueType, afterRaw, [{ text: '', style: { ...DEFAULT_INLINE_STYLE } }]);
    if (continueType === 'task-list') {
      newBlock.checked = block.checked ?? false;
    }
    this.reparseBlock(newBlock);

    this.blocks.splice(idx + 1, 0, newBlock);
    this.notify();

    return { blockId: newBlock.id, offset: 0 };
  }

  /** 重新解析块的内联数据：代码块走语法高亮，其他块走 InlineParser */
  reparseBlock(block: Block) {
    if (block.type === 'code-block') {
      block.inlines = highlightCode(block.rawText, block.language);
      block.sourceToVisual = [];
      block.visualToSource = [];
      return;
    }
    const result = parseInlineMarkdown(block.rawText);
    block.inlines = result.segments;
    block.sourceToVisual = result.sourceToVisual;
    block.visualToSource = result.visualToSource;
  }

  /** 安全的偏移转换（source → visual），带边界保护 */
  sourceToVisual(block: Block, sourceOffset: number): number {
    if (block.sourceToVisual.length === 0) return sourceOffset;
    return block.sourceToVisual[Math.min(sourceOffset, block.sourceToVisual.length - 1)] ?? sourceOffset;
  }

  /** 安全的偏移转换（visual → source），带边界保护 */
  visualToSource(block: Block, visualOffset: number): number {
    if (block.visualToSource.length === 0) return visualOffset;
    return block.visualToSource[Math.min(visualOffset, block.visualToSource.length - 1)] ?? visualOffset;
  }

  /** 简单的发布-订阅模式：订阅变更，返回取消订阅函数 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getTableCell(block: Block, row: number, col: number): TableCell | undefined {
    if (!block.tableData) return undefined;
    if (row === -1) return block.tableData.headers[col];
    return block.tableData.rows[row]?.[col];
  }

  getTableCellRawTextLength(block: Block, row: number, col: number): number {
    return this.getTableCell(block, row, col)?.rawText.length ?? 0;
  }

  tableCellSourceToVisual(block: Block, row: number, col: number, sourceOffset: number): number {
    const cell = this.getTableCell(block, row, col);
    if (!cell || cell.sourceToVisual.length === 0) return sourceOffset;
    return cell.sourceToVisual[Math.min(sourceOffset, cell.sourceToVisual.length - 1)] ?? sourceOffset;
  }

  /** 外部在直接修改 cell.rawText 后调用，重算该格 inlines 与 source/visual 映射。 */
  reparseTableCellPublic(cell: TableCell) { this.reparseTableCell(cell); }

  /** 任一单元格变更后同步整块的 Markdown 表 rawText（保留原管道行模板）。 */
  rebuildTableRawTextPublic(block: Block) { this.rebuildTableRawText(block); }

  private reparseTableCell(cell: TableCell) {
    const result = parseInlineMarkdown(cell.rawText);
    cell.inlines = result.segments;
    cell.sourceToVisual = result.sourceToVisual;
    cell.visualToSource = result.visualToSource;
  }

  /**
   * 用 tableData 中各格 rawText 写回块级 rawText。
   * 若存在原始行字符串模板，仅替换管道分隔之间的「实格」内容并保留格内前后空白样式，避免用户排版被统一成固定格式。
   */
  private rebuildTableRawText(block: Block) {
    if (!block.tableData) return;
    const { headers, rows, originalSeparator } = block.tableData;
    const colCount = headers.length;

    const oldLines = block.rawText.split('\n');
    const buildRow = (cells: TableCell[], templateLine?: string) => {
      if (templateLine) {
        const parts = templateLine.split('|');
        const cellValues = cells.map(c => c.rawText);
        let rebuilt = '';
        let cellIdx = 0;
        for (let p = 0; p < parts.length; p++) {
          if (p > 0) rebuilt += '|';
          const partTrimmed = parts[p].trim();
          if (cellIdx < cellValues.length && partTrimmed !== '' && p > 0 && p < parts.length - 1) {
            const leadingSpace = parts[p].match(/^(\s*)/)?.[1] ?? ' ';
            const trailingSpace = parts[p].match(/(\s*)$/)?.[1] ?? ' ';
            rebuilt += leadingSpace + cellValues[cellIdx] + trailingSpace;
            cellIdx++;
          } else {
            rebuilt += parts[p];
          }
        }
        return rebuilt;
      }
      return '| ' + Array.from({ length: colCount }, (_, c) => cells[c]?.rawText ?? '').join(' | ') + ' |';
    };

    const headerRow = buildRow(headers, oldLines[0]);
    const bodyRows = rows.map((row, idx) => buildRow(row, oldLines[idx + 2]));

    block.rawText = [headerRow, originalSeparator, ...bodyRows].join('\n');
  }

  private notify() {
    this.listeners.forEach(l => l());
  }
}
