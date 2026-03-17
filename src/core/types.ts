/** 支持的块类型：段落、标题、列表、代码块、引用、分割线等 */
export type BlockType =
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bullet-list'
  | 'ordered-list'
  | 'code-block'
  | 'blockquote'
  | 'hr';

/** 内联样式标记：对应 **bold**、*italic*、`code`、~~strikethrough~~ 等 */
export interface InlineStyle {
  bold: boolean;
  italic: boolean;
  code: boolean;
  strikethrough: boolean;
  link?: string;
}

/** 解析后的文本片段：携带文本内容及样式，用于渲染 */
export interface InlineSegment {
  text: string;
  style: InlineStyle;
}

/** 布局层级：BlockLayout（块）→ LineLayout（行）→ SegmentLayout（段），描述渲染时的几何信息 */
export interface BlockLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: LineLayout[];
}

export interface LineLayout {
  y: number;
  height: number;
  baseline: number;
  segments: SegmentLayout[];
  /** 区分代码块内 \n 换行与自动换行：true 表示由 \n 产生的换行，false 表示由 word-wrap 产生 */
  newlineBefore?: boolean;
}

export interface SegmentLayout {
  x: number;
  width: number;
  text: string;
  style: InlineStyle;
}

/** 文档的基本单元。rawText 是单一数据源，inlines/layout 等均由 rawText 派生 */
export interface Block {
  id: string;
  type: BlockType;
  rawText: string;
  inlines: InlineSegment[];
  layout: BlockLayout | null;
  /** sourceToVisual[i]：rawText 第 i 位 → 视觉偏移。visualToSource[i]：视觉第 i 位 → rawText 偏移。用于光标/选区映射 */
  sourceToVisual: number[];
  visualToSource: number[];
}

/** 光标/选区均在 source 空间（即 rawText 的字符偏移），与 Markdown 标记符一致 */
export interface CursorPosition {
  blockId: string;
  offset: number;
}

/** 选区：anchor 与 focus 均为 source 空间（rawText 偏移） */
export interface SelectionRange {
  anchor: CursorPosition;
  focus: CursorPosition;
}

export const DEFAULT_INLINE_STYLE: InlineStyle = {
  bold: false,
  italic: false,
  code: false,
  strikethrough: false,
};

/** 工厂函数：生成带唯一 id 的 Block，其余字段由参数传入 */
export function createBlock(
  type: BlockType,
  rawText: string,
  inlines: InlineSegment[],
  sourceToVisual: number[] = [],
  visualToSource: number[] = [],
): Block {
  return {
    id: crypto.randomUUID(),
    type,
    rawText,
    inlines,
    layout: null,
    sourceToVisual,
    visualToSource,
  };
}
