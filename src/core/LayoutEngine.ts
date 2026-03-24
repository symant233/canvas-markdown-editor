import type { Block, BlockLayout, LineLayout, SegmentLayout } from './types';
import { TextMeasurer } from './TextMeasurer';

/** 左/右内边距 */
const PADDING_LEFT = 20;
/** 顶部内边距 */
const PADDING_TOP = 20;
/** 块与块之间的垂直间距 */
const BLOCK_GAP = 8;
/** 列表项缩进（bullet/ordered） */
const LIST_INDENT = 24;
/** 引用块缩进 */
const QUOTE_INDENT = 16;
/** 代码块左右内边距 */
const CODE_BLOCK_PADDING = 12;
/** 分割线（hr）固定高度 */
const HR_HEIGHT = 24;

export class LayoutEngine {
  private textMeasurer: TextMeasurer;
  constructor(textMeasurer: TextMeasurer) {
    this.textMeasurer = textMeasurer;
  }

  /** 全量计算所有块的布局，从顶部开始依次堆叠 */
  computeLayout(blocks: readonly Block[], containerWidth: number) {
    let y = PADDING_TOP;
    const contentWidth = containerWidth - PADDING_LEFT * 2;

    for (let i = 0; i < blocks.length; i++) {
      y += this.getTopMargin(blocks, i);
      const layout = this.layoutBlock(blocks[i], PADDING_LEFT, y, contentWidth);
      blocks[i].layout = layout;
      y = layout.y + layout.height + BLOCK_GAP;
    }
  }

  /** 增量重排：仅从 startIndex 开始重新计算，后续块位置依次更新（编辑优化核心） */
  reflowFrom(blocks: readonly Block[], startIndex: number, containerWidth: number) {
    if (startIndex < 0 || startIndex >= blocks.length) return;

    const contentWidth = containerWidth - PADDING_LEFT * 2;

    let y: number;
    if (startIndex === 0) {
      y = PADDING_TOP;
    } else {
      const prev = blocks[startIndex - 1].layout!;
      y = prev.y + prev.height + BLOCK_GAP;
    }

    for (let i = startIndex; i < blocks.length; i++) {
      y += this.getTopMargin(blocks, i);
      const layout = this.layoutBlock(blocks[i], PADDING_LEFT, y, contentWidth);
      blocks[i].layout = layout;
      y = layout.y + layout.height + BLOCK_GAP;
    }
  }

  /** 代码块/引用/分割线与相邻块之间增加额外间距（8px），普通块间无额外间距 */
  private getTopMargin(blocks: readonly Block[], index: number): number {
    if (index === 0) return 0;
    const block = blocks[index];
    const prev = blocks[index - 1];
    if (block.type === 'code-block' || block.type === 'blockquote') return 8;
    if (prev.type === 'code-block' || prev.type === 'blockquote') return 8;
    if (block.type === 'hr') return 8;
    if (prev.type === 'hr') return 8;
    return 0;
  }

  /**
   * 布局单个块：hr 直接返回固定高度；其余块按类型处理缩进后逐行排版。
   * - pendingNewline：追踪是否有 \n 触发的换行（与自动换行区分）
   * - 内联段中的 \n：代码块中的 \n 产生显式换行，设置 newlineBefore=true
   * - 自动换行：逐字符累加宽度直到超出 effectiveWidth
   * - segEnd === segStart：行首放不下的单字符强制放入，防止死循环
   * - endsWithNewline：rawText 以 \n 结尾时额外添加空行（代码块回车后可见空行）
   */
  private layoutBlock(block: Block, x: number, y: number, maxWidth: number): BlockLayout {
    if (block.type === 'hr') {
      return { x, y, width: maxWidth, height: HR_HEIGHT, lines: [] };
    }

    let effectiveX = x;
    let effectiveWidth = maxWidth;

    if (block.type === 'bullet-list' || block.type === 'ordered-list' || block.type === 'task-list') {
      effectiveX = x + LIST_INDENT;
      effectiveWidth = maxWidth - LIST_INDENT;
    } else if (block.type === 'blockquote') {
      effectiveX = x + QUOTE_INDENT;
      effectiveWidth = maxWidth - QUOTE_INDENT;
    } else if (block.type === 'code-block') {
      effectiveX = x + CODE_BLOCK_PADDING;
      effectiveWidth = maxWidth - CODE_BLOCK_PADDING * 2;
    }

    const lines: LineLayout[] = [];
    const lineHeight = this.textMeasurer.getLineHeight(block.type);
    const baseline = this.textMeasurer.getBaseline(block.type);

    let currentLine: SegmentLayout[] = [];
    let lineX = 0;
    let lineY = y;
    let pendingNewline = false;

    for (const seg of block.inlines) {
      if (seg.text.length === 0) continue;

      const hasNewlines = seg.text.includes('\n');
      const subParts = hasNewlines ? seg.text.split('\n') : [seg.text];

      for (let partIdx = 0; partIdx < subParts.length; partIdx++) {
        const part = subParts[partIdx];

        if (hasNewlines && partIdx > 0) {
          lines.push({ y: lineY, height: lineHeight, baseline, segments: currentLine, newlineBefore: pendingNewline });
          currentLine = [];
          lineX = 0;
          lineY += lineHeight;
          pendingNewline = true;
        }

        if (part.length === 0) continue;

        const charWidths = this.textMeasurer.measureCharWidths(part, block.type, seg.style);
        let segStart = 0;

        while (segStart < part.length) {
          let segEnd = segStart;
          let width = 0;

          while (segEnd < part.length && lineX + width + charWidths[segEnd] <= effectiveWidth) {
            width += charWidths[segEnd];
            segEnd++;
          }

          if (segEnd === segStart && currentLine.length === 0) {
            width = charWidths[segEnd];
            segEnd = segStart + 1;
          }

          if (segEnd > segStart) {
            currentLine.push({
              x: effectiveX + lineX,
              width,
              text: part.substring(segStart, segEnd),
              style: seg.style,
            });
            lineX += width;
            segStart = segEnd;
          }

          if (segStart < part.length) {
            lines.push({ y: lineY, height: lineHeight, baseline, segments: currentLine, newlineBefore: pendingNewline });
            currentLine = [];
            lineX = 0;
            lineY += lineHeight;
            pendingNewline = false;
          }
        }
      }
    }

    const endsWithNewline = block.rawText.endsWith('\n');
    if (currentLine.length > 0 || lines.length === 0 || endsWithNewline) {
      lines.push({
        y: lineY,
        height: lineHeight,
        baseline,
        segments: currentLine,
        newlineBefore: pendingNewline,
      });
    }

    const totalHeight = lines.length * lineHeight;

    return {
      x: effectiveX,
      y,
      width: effectiveWidth,
      height: totalHeight,
      lines,
    };
  }
}
