import type { Block, CursorPosition, SelectionRange } from './types';
import { TextMeasurer } from './TextMeasurer';
import { BlockStore } from './BlockStore';

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

    ctx.fillStyle = '#000';
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

    const startVisual = this.blockStore.sourceToVisual(block, startCursor.offset);
    const endVisual = this.blockStore.sourceToVisual(block, startCursor.offset + compositionLength);

    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;

    let charCount = 0;
    for (const line of block.layout.lines) {
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

    const visualOffset = this.blockStore.sourceToVisual(block, cursor.offset);

    let charCount = 0;
    for (const line of block.layout.lines) {
      if (line.newlineBefore) charCount++; // 补偿 \n 占位
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
   * 选区高亮：normalizeSelection 确保 anchor 在 focus 之前；
   * 单块选区和跨块选区的不同处理
   */
  private renderSelectionHighlight(
    ctx: CanvasRenderingContext2D,
    blocks: readonly Block[],
    selection: SelectionRange,
  ) {
    const { anchor, focus } = this.normalizeSelection(blocks, selection);

    let inRange = false;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';

    for (const block of blocks) {
      if (!block.layout) continue;

      const isAnchorBlock = block.id === anchor.blockId;
      const isFocusBlock = block.id === focus.blockId;

      if (isAnchorBlock && isFocusBlock) {
        // 单块选区
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

  /** 在指定 visual 范围内绘制蓝色半透明高亮；同样需考虑 newlineBefore 的字符计数 */
  private highlightVisualRange(ctx: CanvasRenderingContext2D, block: Block, startVisual: number, endVisual: number) {
    if (startVisual === endVisual) return;
    if (!block.layout) return;

    let charCount = 0;
    for (const line of block.layout.lines) {
      if (line.newlineBefore) charCount++;
      for (const seg of line.segments) {
        const segStart = charCount;
        const segEnd = charCount + seg.text.length;

        const overlapStart = Math.max(startVisual, segStart);
        const overlapEnd = Math.min(endVisual, segEnd);

        if (overlapStart < overlapEnd) {
          const xStart = seg.x + this.textMeasurer.measureWidth(
            seg.text.substring(0, overlapStart - segStart), block.type, seg.style
          );
          const xEnd = seg.x + this.textMeasurer.measureWidth(
            seg.text.substring(0, overlapEnd - segStart), block.type, seg.style
          );
          ctx.fillRect(xStart, line.y, xEnd - xStart, line.height);
        }

        charCount = segEnd;
      }
    }
  }

  private normalizeSelection(
    blocks: readonly Block[],
    sel: SelectionRange,
  ): { anchor: CursorPosition; focus: CursorPosition } {
    const anchorIdx = blocks.findIndex(b => b.id === sel.anchor.blockId);
    const focusIdx = blocks.findIndex(b => b.id === sel.focus.blockId);

    if (anchorIdx < focusIdx) return { anchor: sel.anchor, focus: sel.focus };
    if (anchorIdx > focusIdx) return { anchor: sel.focus, focus: sel.anchor };

    if (sel.anchor.offset <= sel.focus.offset) return { anchor: sel.anchor, focus: sel.focus };
    return { anchor: sel.focus, focus: sel.anchor };
  }
}
