import type { Block, CursorPosition, SelectionRange } from './types';
import { TextMeasurer } from './TextMeasurer';
import { BlockStore } from './BlockStore';
import { Colors } from '../config/colors';

/** 交互层渲染器，绘制光标、选区高亮和 IME 组合文本 */
export class SelectionCanvasRenderer {
  private cursorVisible = true;
  private blinkTimer: number | null = null;
  private onBlink: (() => void) | null = null;

  private textMeasurer: TextMeasurer;
  private blockStore: BlockStore;
  constructor(textMeasurer: TextMeasurer, blockStore: BlockStore) {
    this.textMeasurer = textMeasurer;
    this.blockStore = blockStore;
  }

  /** 光标闪烁：530ms 间隔切换 cursorVisible */
  startBlink(onBlink: () => void) {
    this.stopBlink();
    this.cursorVisible = true;
    this.onBlink = onBlink;
    this.blinkTimer = window.setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
      this.onBlink?.();
    }, 530);
  }

  stopBlink() {
    if (this.blinkTimer !== null) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
  }

  /** 用户操作后重置闪烁周期（立即显示光标） */
  resetBlink() {
    this.cursorVisible = true;
    if (this.onBlink) {
      this.stopBlink();
      this.startBlink(this.onBlink);
    }
  }

  /** 与 StaticCanvas 使用相同的 dpr 和 scrollY 变换 */
  render(
    ctx: CanvasRenderingContext2D,
    blocks: readonly Block[],
    cursor: CursorPosition | null,
    selection: SelectionRange | null,
    dpr: number,
    scrollY: number = 0,
  ) {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
    ctx.translate(0, -scrollY);

    if (selection) {
      this.renderSelectionHighlight(ctx, blocks, selection);
    }

    if (cursor && this.cursorVisible) {
      this.renderCursor(ctx, blocks, cursor);
    }

    ctx.restore();
  }

  private renderCursor(
    ctx: CanvasRenderingContext2D,
    blocks: readonly Block[],
    cursor: CursorPosition,
  ) {
    const pos = this.getCursorPixelPosition(blocks, cursor);
    if (!pos) return;

    ctx.fillStyle = Colors.cursor;
    ctx.fillRect(pos.x, pos.y, 2, pos.height);
  }

  /**
   * 在组合文本范围内绘制虚线下划线（跨行支持）。
   * startCursor 为组合起始位置（source 空间），compositionLength 为组合文本在 source 空间的长度。
   * 调用前需确保 block 的 inlines/layout/sourceToVisual 已包含组合文本。
   */
  renderCompositionUnderline(
    ctx: CanvasRenderingContext2D,
    blocks: readonly Block[],
    startCursor: CursorPosition,
    compositionLength: number,
    dpr: number,
    scrollY: number,
  ) {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(0, -scrollY);

    const block = blocks.find(b => b.id === startCursor.blockId);
    if (!block?.layout) { ctx.restore(); return; }

    let startVisual: number;
    let endVisual: number;
    let lines: typeof block.layout.lines;

    if (startCursor.tableCell && block.layout.tableCells) {
      const { row, col } = startCursor.tableCell;
      startVisual = this.blockStore.tableCellSourceToVisual(block, row, col, startCursor.offset);
      endVisual = this.blockStore.tableCellSourceToVisual(block, row, col, startCursor.offset + compositionLength);
      const layoutRow = row === -1 ? 0 : row + 1;
      const cellLayout = block.layout.tableCells[layoutRow]?.[col];
      lines = cellLayout?.lines ?? [];
    } else {
      startVisual = this.blockStore.sourceToVisual(block, startCursor.offset);
      endVisual = this.blockStore.sourceToVisual(block, startCursor.offset + compositionLength);
      lines = block.layout.lines;
    }

    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = Colors.compositionUnderline;
    ctx.lineWidth = 1;

    let charCount = 0;
    for (const line of lines) {
      if (line.newlineBefore) charCount++;
      for (const seg of line.segments) {
        const segStart = charCount;
        const segEnd = charCount + seg.text.length;

        const overlapStart = Math.max(startVisual, segStart);
        const overlapEnd = Math.min(endVisual, segEnd);

        if (overlapStart < overlapEnd) {
          const xStart = seg.x + this.textMeasurer.measureWidth(
            seg.text.substring(0, overlapStart - segStart), block.type, seg.style,
          );
          const xEnd = seg.x + this.textMeasurer.measureWidth(
            seg.text.substring(0, overlapEnd - segStart), block.type, seg.style,
          );

          ctx.beginPath();
          ctx.moveTo(xStart, line.y + line.height - 2);
          ctx.lineTo(xEnd, line.y + line.height - 2);
          ctx.stroke();
        }

        charCount = segEnd;
      }
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * 关键逻辑：将 source 偏移转换为 visual 偏移；遍历布局行和段找到对应像素位置；
   * line.newlineBefore 时 charCount++ 补偿 \n 字符占位
   */
  getCursorPixelPosition(
    blocks: readonly Block[],
    cursor: CursorPosition,
  ): { x: number; y: number; height: number } | null {
    const block = blocks.find(b => b.id === cursor.blockId);
    if (!block?.layout) return null;

    if (cursor.tableCell && block.layout.tableCells) {
      return this.getTableCellCursorPosition(block, cursor);
    }

    const visualOffset = this.blockStore.sourceToVisual(block, cursor.offset);

    let charCount = 0;
    for (const line of block.layout.lines) {
      if (line.newlineBefore) charCount++;
      if (line.segments.length === 0 && visualOffset <= charCount) {
        return { x: block.layout.x, y: line.y, height: line.height };
      }
      for (const seg of line.segments) {
        const segEnd = charCount + seg.text.length;
        if (visualOffset <= segEnd) {
          const charInSeg = visualOffset - charCount;
          const textBefore = seg.text.substring(0, charInSeg);
          const xOffset = this.textMeasurer.measureWidth(textBefore, block.type, seg.style);
          return { x: seg.x + xOffset, y: line.y, height: line.height };
        }
        charCount = segEnd;
      }
    }

    const lastLine = block.layout.lines[block.layout.lines.length - 1];
    if (lastLine) {
      const lastSeg = lastLine.segments[lastLine.segments.length - 1];
      if (lastSeg) {
        return { x: lastSeg.x + lastSeg.width, y: lastLine.y, height: lastLine.height };
      }
      return { x: block.layout.x, y: lastLine.y, height: lastLine.height };
    }

    return { x: block.layout.x, y: block.layout.y, height: this.textMeasurer.getLineHeight(block.type) };
  }

  /**
   * 表内光标像素：layout 行 0 为表头（data row -1），其余为 body 行 +1；
   * 在单元格 lines 上按段累加字符得到 visualOffset（与 getCursorPixelPosition 正文路径分离，坐标相对 cellLayout）。
   */
  private getTableCellCursorPosition(
    block: Block,
    cursor: CursorPosition,
  ): { x: number; y: number; height: number } | null {
    const { row, col } = cursor.tableCell!;
    const layoutRow = row === -1 ? 0 : row + 1;
    const cellLayout = block.layout!.tableCells?.[layoutRow]?.[col];
    if (!cellLayout) return null;

    const visualOffset = this.blockStore.tableCellSourceToVisual(block, row, col, cursor.offset);
    const cellLines = cellLayout.lines;

    let charCount = 0;
    for (const line of cellLines) {
      if (line.segments.length === 0 && visualOffset <= charCount) {
        return { x: cellLayout.x + 4, y: line.y, height: line.height };
      }
      for (const seg of line.segments) {
        const segEnd = charCount + seg.text.length;
        if (visualOffset <= segEnd) {
          const charInSeg = visualOffset - charCount;
          const textBefore = seg.text.substring(0, charInSeg);
          const xOffset = this.textMeasurer.measureWidth(textBefore, block.type, seg.style);
          return { x: seg.x + xOffset, y: line.y, height: line.height };
        }
        charCount = segEnd;
      }
    }

    if (cellLines.length > 0) {
      const lastLine = cellLines[cellLines.length - 1];
      const lastSeg = lastLine.segments[lastLine.segments.length - 1];
      if (lastSeg) {
        return { x: lastSeg.x + lastSeg.width, y: lastLine.y, height: lastLine.height };
      }
      return { x: cellLayout.x + 4, y: lastLine.y, height: lastLine.height };
    }

    return { x: cellLayout.x + 4, y: cellLayout.y, height: cellLayout.height };
  }

  /**
   * 选区高亮：normalizeSelection 将 anchor 排到 focus 之前（块序、同块 offset、表单元格行列）后绘制。
   * 同块且同一表单元格时在 cellLayout.lines 上按 visual 区间高亮；否则整块 layout 或跨块矩形填充。
   */
  private renderSelectionHighlight(
    ctx: CanvasRenderingContext2D,
    blocks: readonly Block[],
    selection: SelectionRange,
  ) {
    const { anchor, focus } = this.normalizeSelection(blocks, selection);

    let inRange = false;
    ctx.fillStyle = Colors.selectionHighlight;

    for (const block of blocks) {
      if (!block.layout) continue;

      const isAnchorBlock = block.id === anchor.blockId;
      const isFocusBlock = block.id === focus.blockId;

      if (isAnchorBlock && isFocusBlock) {
        // 单格内选区：在 cellLayout.lines 上绘制，避免误用整块 block.layout.lines。
        if (anchor.tableCell && focus.tableCell && block.layout.tableCells &&
            anchor.tableCell.row === focus.tableCell.row && anchor.tableCell.col === focus.tableCell.col) {
          const { row, col } = anchor.tableCell;
          const startVisual = this.blockStore.tableCellSourceToVisual(block, row, col, anchor.offset);
          const endVisual = this.blockStore.tableCellSourceToVisual(block, row, col, focus.offset);
          const layoutRow = row === -1 ? 0 : row + 1;
          const cellLayout = block.layout.tableCells[layoutRow]?.[col];
          if (cellLayout) {
            this.highlightVisualRangeInLines(ctx, block.type, cellLayout.lines, startVisual, endVisual);
          }
          return;
        }
        const startVisual = this.blockStore.sourceToVisual(block, anchor.offset);
        const endVisual = this.blockStore.sourceToVisual(block, focus.offset);
        this.highlightVisualRange(ctx, block, startVisual, endVisual);
        return;
      }

      if (isAnchorBlock) {
        inRange = true;
        const startVisual = this.blockStore.sourceToVisual(block, anchor.offset);
        const visualLen = this.blockStore.getVisualTextLength(block);
        this.highlightVisualRange(ctx, block, startVisual, visualLen);
        continue;
      }

      if (isFocusBlock) {
        // 跨块：选区的终点块
        const endVisual = this.blockStore.sourceToVisual(block, focus.offset);
        this.highlightVisualRange(ctx, block, 0, endVisual);
        return;
      }

      if (inRange) {
        // 跨块：anchor 与 focus 之间的整块
        ctx.fillRect(block.layout.x, block.layout.y, block.layout.width, block.layout.height);
      }
    }
  }

  private highlightVisualRange(ctx: CanvasRenderingContext2D, block: Block, startVisual: number, endVisual: number) {
    if (startVisual === endVisual) return;
    if (!block.layout) return;
    this.highlightVisualRangeInLines(ctx, block.type, block.layout.lines, startVisual, endVisual);
  }

  /**
   * 在任意行数组上按 visual 区间与每段求交并 fillRect，供块正文或表单元格多行共用同一套几何逻辑。
   */
  private highlightVisualRangeInLines(
    ctx: CanvasRenderingContext2D,
    blockType: import('./types').BlockType,
    lines: readonly import('./types').LineLayout[],
    startVisual: number,
    endVisual: number,
  ) {
    if (startVisual === endVisual) return;

    let charCount = 0;
    for (const line of lines) {
      if (line.newlineBefore) charCount++;
      for (const seg of line.segments) {
        const segStart = charCount;
        const segEnd = charCount + seg.text.length;

        const overlapStart = Math.max(startVisual, segStart);
        const overlapEnd = Math.min(endVisual, segEnd);

        if (overlapStart < overlapEnd) {
          const xStart = seg.x + this.textMeasurer.measureWidth(
            seg.text.substring(0, overlapStart - segStart), blockType, seg.style
          );
          const xEnd = seg.x + this.textMeasurer.measureWidth(
            seg.text.substring(0, overlapEnd - segStart), blockType, seg.style
          );
          ctx.fillRect(xStart, line.y, xEnd - xStart, line.height);
        }

        charCount = segEnd;
      }
    }
  }

  /** 将选区规范为 anchor 在 focus 之前：先比块序，同块再比表单元格 (row,col)，最后比 offset */
  private normalizeSelection(
    blocks: readonly Block[],
    sel: SelectionRange,
  ): { anchor: CursorPosition; focus: CursorPosition } {
    const anchorIdx = blocks.findIndex(b => b.id === sel.anchor.blockId);
    const focusIdx = blocks.findIndex(b => b.id === sel.focus.blockId);

    if (anchorIdx < focusIdx) return { anchor: sel.anchor, focus: sel.focus };
    if (anchorIdx > focusIdx) return { anchor: sel.focus, focus: sel.anchor };

    if (sel.anchor.tableCell && sel.focus.tableCell) {
      const ac = sel.anchor.tableCell, fc = sel.focus.tableCell;
      if (ac.row < fc.row || (ac.row === fc.row && ac.col < fc.col)) return { anchor: sel.anchor, focus: sel.focus };
      if (ac.row > fc.row || (ac.row === fc.row && ac.col > fc.col)) return { anchor: sel.focus, focus: sel.anchor };
    }

    if (sel.anchor.offset <= sel.focus.offset) return { anchor: sel.anchor, focus: sel.focus };
    return { anchor: sel.focus, focus: sel.anchor };
  }
}
