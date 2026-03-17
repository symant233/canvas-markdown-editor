import type { BlockType, InlineStyle } from './types';

export interface FontConfig {
  family: string;
  size: number;
  weight: string;
  style: string;
}

const BLOCK_FONT_CONFIG: Record<BlockType, { size: number; weight: string }> = {
  'heading-1': { size: 32, weight: 'bold' },
  'heading-2': { size: 24, weight: 'bold' },
  'heading-3': { size: 20, weight: 'bold' },
  'paragraph': { size: 16, weight: 'normal' },
  'bullet-list': { size: 16, weight: 'normal' },
  'ordered-list': { size: 16, weight: 'normal' },
  'code-block': { size: 14, weight: 'normal' },
  'blockquote': { size: 16, weight: 'normal' },
  'hr': { size: 16, weight: 'normal' },
};

const FONT_FAMILY = "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const CODE_FONT_FAMILY = "'Consolas', 'Courier New', monospace";

/** 使用离屏 Canvas 测量文本宽度，结果带缓存 */
export class TextMeasurer {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private cache = new Map<string, number>();

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** 测量完整文本宽度（带缓存） */
  measureWidth(text: string, blockType: BlockType, inlineStyle: InlineStyle): number {
    const font = this.buildFont(blockType, inlineStyle);
    const cacheKey = `${font}|${text}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    this.ctx.font = font;
    const width = this.ctx.measureText(text).width;
    this.cache.set(cacheKey, width);
    return width;
  }

  /** 逐字符测量宽度，用于布局引擎的换行计算和点击定位 */
  measureCharWidths(text: string, blockType: BlockType, inlineStyle: InlineStyle): number[] {
    const font = this.buildFont(blockType, inlineStyle);
    this.ctx.font = font;

    const widths: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const cacheKey = `${font}|char|${char}`;
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        widths.push(cached);
      } else {
        const w = this.ctx.measureText(char).width;
        this.cache.set(cacheKey, w);
        widths.push(w);
      }
    }
    return widths;
  }

  /** 行高：基于字体大小的固定比例（1.5 倍） */
  getLineHeight(blockType: BlockType): number {
    const config = BLOCK_FONT_CONFIG[blockType];
    return Math.ceil(config.size * 1.5);
  }

  /** 基线偏移：基于字体大小的固定比例（1.2 倍），用于文字垂直定位 */
  getBaseline(blockType: BlockType): number {
    const config = BLOCK_FONT_CONFIG[blockType];
    return Math.ceil(config.size * 1.2);
  }

  /**
   * 根据块类型和内联样式组合完整的 CSS font 字符串。
   * - 代码块/行内代码使用等宽字体族（CODE_FONT_FAMILY）
   * - 内联 bold 和 italic 叠加到块级设置之上
   */
  buildFont(blockType: BlockType, inlineStyle: InlineStyle): string {
    const config = BLOCK_FONT_CONFIG[blockType];
    const family = inlineStyle.code ? CODE_FONT_FAMILY : FONT_FAMILY;

    let weight = config.weight;
    if (inlineStyle.bold && weight === 'normal') {
      weight = 'bold';
    }

    const fontStyle = inlineStyle.italic ? 'italic' : 'normal';
    return `${fontStyle} ${weight} ${config.size}px ${family}`;
  }

  getFontSize(blockType: BlockType): number {
    return BLOCK_FONT_CONFIG[blockType].size;
  }

  clearCache() {
    this.cache.clear();
  }
}
