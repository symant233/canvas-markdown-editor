import type { Block, InlineStyle } from './types';
import { TextMeasurer } from './TextMeasurer';
import { computeVerticalScrollBlit } from './ScrollHelper';

const HEADING_BOTTOM_BORDER: Record<string, boolean> = {
  'heading-1': true,
  'heading-2': true,
};

const LIST_INDENT = 24;
const QUOTE_BAR_WIDTH = 4;
const QUOTE_BAR_GAP = 12;
const CODE_BLOCK_PADDING = 12;
const CODE_BLOCK_RADIUS = 6;

/** 静态内容渲染器，负责绘制文档内容（标题、段落、列表等） */
export class StaticCanvasRenderer {
  private textMeasurer: TextMeasurer;
  private _enableScrollBlit = true;

  constructor(textMeasurer: TextMeasurer) {
    this.textMeasurer = textMeasurer;
  }

  /** 启用/禁用滚动截屏优化（禁用后滚动退化为全量重绘） */
  setScrollBlitEnabled(enabled: boolean) {
    this._enableScrollBlit = enabled;
  }

  /**
   * 渲染文档块：dpr 缩放保证高分屏清晰度；ctx.translate(0, -scrollY) 实现虚拟滚动；
   * viewportTop/Bottom 判断块是否在可视区域内（视口裁剪优化）；
   * orderedListCounter 追踪连续有序列表的序号
   */
  render(
    ctx: CanvasRenderingContext2D,
    blocks: readonly Block[],
    viewportTop: number,
    viewportBottom: number,
    dpr: number,
    scrollY: number = 0,
  ) {
    ctx.save();
    ctx.scale(dpr, dpr); // dpr 保证高分屏清晰度
    ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);

    ctx.translate(0, -scrollY); // 虚拟滚动

    let orderedListCounter = 0; // 追踪连续有序列表的序号
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block.layout) continue;

      if (block.type === 'ordered-list') {
        orderedListCounter++;
      } else {
        orderedListCounter = 0;
      }

      const { y, height } = block.layout;
      if (y + height < viewportTop + scrollY || y > viewportBottom + scrollY) continue; // 视口裁剪：仅绘制可视区域内的块

      this.renderBlock(ctx, block, orderedListCounter);
    }

    ctx.restore();
  }

  /**
   * 滚动渲染：先 blit 可复用像素，再只补画新露出条带。
   * oldScrollY/newScrollY 差值小于视口高度时走 blit 路径，否则退化为全量重绘。
   */
  renderScroll(
    ctx: CanvasRenderingContext2D,
    blocks: readonly Block[],
    viewportHeight: number,
    dpr: number,
    oldScrollY: number,
    newScrollY: number,
  ) {
    if (!this._enableScrollBlit) {
      this.render(ctx, blocks, 0, viewportHeight, dpr, newScrollY);
      return;
    }

    const result = computeVerticalScrollBlit(oldScrollY, newScrollY, viewportHeight);

    if (!result.blit) {
      this.render(ctx, blocks, 0, viewportHeight, dpr, newScrollY);
      return;
    }

    const canvas = ctx.canvas;
    const { srcY, dstY, height } = result.blit;

    // Step 1: blit — 取整设备像素坐标，防止子像素插值导致累积模糊
    const srcPxY = Math.round(srcY * dpr);
    const dstPxY = Math.round(dstY * dpr);
    const heightPx = Math.round(height * dpr);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(
      canvas,
      0, srcPxY, canvas.width, heightPx,
      0, dstPxY, canvas.width, heightPx,
    );
    ctx.restore();

    // Step 2: clip + 清空 + 补画新露出的条带
    // 条带向两侧各扩展 1px 覆盖取整间隙
    const logicalWidth = canvas.width / dpr;
    const safeStripY = Math.max(0, result.stripY - 1);
    const safeStripEnd = Math.min(viewportHeight, result.stripY + result.stripHeight + 1);
    const safeStripHeight = safeStripEnd - safeStripY;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.beginPath();
    ctx.rect(0, safeStripY, logicalWidth, safeStripHeight);
    ctx.clip();
    ctx.clearRect(0, safeStripY, logicalWidth, safeStripHeight);

    ctx.translate(0, -newScrollY);

    const stripSceneTop = newScrollY + safeStripY;
    const stripSceneBottom = stripSceneTop + safeStripHeight;

    let orderedListCounter = 0;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block.layout) continue;

      if (block.type === 'ordered-list') {
        orderedListCounter++;
      } else {
        orderedListCounter = 0;
      }

      const { y, height: bh } = block.layout;
      if (y + bh < stripSceneTop || y > stripSceneBottom) continue;

      this.renderBlock(ctx, block, orderedListCounter);
    }

    ctx.restore();
  }

  /** 各块类型的渲染入口（hr/code-block/blockquote/bullet-list/ordered-list） */
  private renderBlock(ctx: CanvasRenderingContext2D, block: Block, orderedListIndex: number = 0) {
    const layout = block.layout!;

    switch (block.type) {
      case 'hr':
        this.renderHR(ctx, layout);
        return;
      case 'code-block':
        this.renderCodeBlockBackground(ctx, layout);
        break;
      case 'blockquote':
        this.renderQuoteBar(ctx, layout);
        break;
      case 'bullet-list':
        this.renderBullet(ctx, layout);
        break;
      case 'ordered-list':
        this.renderOrderedNumber(ctx, layout, block, orderedListIndex);
        break;
    }

    for (const line of layout.lines) {
      for (const seg of line.segments) {
        ctx.font = this.textMeasurer.buildFont(block.type, seg.style);
        ctx.fillStyle = this.getTextColor(block.type, seg.style);

        // 行内代码特殊处理：非代码块中的 code 样式文本绘制灰色背景 + 红色文字
        if (seg.style.code && block.type !== 'code-block') {
          ctx.fillStyle = '#e5e7eb';
          const padding = 2;
          ctx.fillRect(seg.x - padding, line.y + 2, seg.width + padding * 2, line.height - 4);
          ctx.fillStyle = '#dc2626';
          ctx.font = this.textMeasurer.buildFont(block.type, seg.style);
        }

        ctx.fillText(seg.text, seg.x, line.y + line.baseline);

        // 删除线：通过 canvas 画线实现
        if (seg.style.strikethrough) {
          const y = line.y + line.height * 0.5;
          ctx.strokeStyle = this.getTextColor(block.type, seg.style);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(seg.x, y);
          ctx.lineTo(seg.x + seg.width, y);
          ctx.stroke();
        }
      }
    }

    // heading 底部分割线
    if (HEADING_BOTTOM_BORDER[block.type]) {
      const bottomY = layout.y + layout.height;
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(layout.x, bottomY);
      ctx.lineTo(layout.x + layout.width, bottomY);
      ctx.stroke();
    }
  }

  private renderHR(ctx: CanvasRenderingContext2D, layout: { x: number; y: number; width: number; height: number }) {
    const centerY = layout.y + layout.height / 2;
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.x, centerY);
    ctx.lineTo(layout.x + layout.width, centerY);
    ctx.stroke();
  }

  /** 圆角矩形背景 */
  private renderCodeBlockBackground(ctx: CanvasRenderingContext2D, layout: { x: number; y: number; width: number; height: number }) {
    ctx.fillStyle = '#f3f4f6';
    this.roundRect(ctx, layout.x - CODE_BLOCK_PADDING, layout.y - 4, layout.width + CODE_BLOCK_PADDING * 2, layout.height + 8, CODE_BLOCK_RADIUS);
    ctx.fill();
  }

  private renderQuoteBar(ctx: CanvasRenderingContext2D, layout: { x: number; y: number; height: number }) {
    ctx.fillStyle = '#d1d5db';
    ctx.fillRect(layout.x - QUOTE_BAR_GAP, layout.y, QUOTE_BAR_WIDTH, layout.height);
  }

  /** 第一行左侧绘制圆点 */
  private renderBullet(ctx: CanvasRenderingContext2D, layout: { x: number; y: number; lines: Array<{ y: number; height: number }> }) {
    if (layout.lines.length === 0) return;
    const firstLine = layout.lines[0];
    const bulletY = firstLine.y + firstLine.height / 2;
    const bulletX = layout.x - LIST_INDENT / 2;
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.arc(bulletX, bulletY, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 第一行左侧绘制递增序号 */
  private renderOrderedNumber(ctx: CanvasRenderingContext2D, layout: { x: number; lines: Array<{ y: number; baseline: number }> }, block: Block, index: number) {
    if (layout.lines.length === 0) return;
    const firstLine = layout.lines[0];
    ctx.font = this.textMeasurer.buildFont(block.type, { bold: false, italic: false, code: false, strikethrough: false });
    ctx.fillStyle = '#374151';
    ctx.fillText(`${index}.`, layout.x - LIST_INDENT, firstLine.y + firstLine.baseline);
  }

  private getTextColor(blockType: string, style: InlineStyle): string {
    if (style.color) return style.color;
    if (style.link) return '#2563eb';
    if (blockType === 'blockquote') return '#6b7280';
    if (blockType === 'code-block') return '#1f2937';
    return '#1f2937';
  }

  /** 手动绘制圆角矩形路径（兼容不支持 ctx.roundRect 的环境） */
  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
