import type { Block, CursorPosition } from './types';
import { createBlock, DEFAULT_INLINE_STYLE } from './types';
import { parseInlineMarkdown } from './InlineParser';
import { highlightCode } from './SyntaxHighlighter';

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

    const before = block.rawText.substring(0, cursor.offset);
    const after = block.rawText.substring(cursor.offset);
    block.rawText = before + text + after;

    this.reparseBlock(block);
    this.notify();

    return { blockId: cursor.blockId, offset: cursor.offset + text.length };
  }

  /** 删除 rawText 指定位置字符 */
  deleteCharAt(blockId: string, offset: number) {
    const block = this.getBlock(blockId);
    if (!block || offset < 0 || offset >= block.rawText.length) return;

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
   * - code-block 特殊处理：回车插入 \n 而非拆分块；末尾连续两次回车退出代码块
   * - continuableTypes：列表/引用在回车时自动续行同类型；空列表项回车退出为段落
   */
  splitBlock(cursor: CursorPosition): CursorPosition {
    const block = this.getBlock(cursor.blockId);
    if (!block) return cursor;

    const idx = this.getBlockIndex(cursor.blockId);
    const beforeRaw = block.rawText.substring(0, cursor.offset);
    const afterRaw = block.rawText.substring(cursor.offset);

    if (block.type === 'code-block') {
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

    const continuableTypes = new Set(['bullet-list', 'ordered-list', 'blockquote']);
    const continueType = continuableTypes.has(block.type) ? block.type : 'paragraph';

    if (continuableTypes.has(block.type) && beforeRaw.length === 0 && afterRaw.length === 0) {
      block.type = 'paragraph';
      this.notify();
      return { blockId: block.id, offset: 0 };
    }

    block.rawText = beforeRaw;
    this.reparseBlock(block);

    const newBlock = createBlock(continueType, afterRaw, [{ text: '', style: { ...DEFAULT_INLINE_STYLE } }]);
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

  /** 通知所有监听者 */
  private notify() {
    this.listeners.forEach(l => l());
  }
}
