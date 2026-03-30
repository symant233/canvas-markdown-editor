/** 支持的块类型：段落、标题、列表、代码块、引用、分割线、表格等 */
export type BlockType =
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'code-block'
  | 'blockquote'
  | 'hr'
  | 'table';

export type TableAlignment = 'left' | 'center' | 'right' | 'none';

export interface TableCell {
  rawText: string;
  inlines: InlineSegment[];
  sourceToVisual: number[];
  visualToSource: number[];
}

export interface TableData {
  headers: TableCell[];
  alignments: TableAlignment[];
  rows: TableCell[][];
  originalSeparator: string;
}

/** 内联样式标记：对应 **bold**、*italic*、`code`、~~strikethrough~~、++underline++、==highlight== 等 */
export interface InlineStyle {
  bold: boolean;
  italic: boolean;
  code: boolean;
  strikethrough: boolean;
  underline: boolean;
  highlight: boolean;
  link?: string;
  color?: string;
}

/** 解析后的文本片段：携带文本内容及样式，用于渲染 */
export interface InlineSegment {
  text: string;
  style: InlineStyle;
}

/** 表格单元格的布局信息 */
export interface TableCellLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: LineLayout[];
}

/** 布局层级：BlockLayout（块）→ LineLayout（行）→ SegmentLayout（段），描述渲染时的几何信息 */
export interface BlockLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: LineLayout[];
  /** 表格单元格布局：tableCells[row][col]，row=-1 的表头存在 tableCells[0] */
  tableCells?: TableCellLayout[][];
  /** 表格各列宽度 */
  tableColumnWidths?: number[];
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
  /** 代码块的编程语言（从 ```lang 标记中提取） */
  language?: string;
  /** 任务列表的勾选状态 */
  checked?: boolean;
  /** 表格数据（仅 type='table' 时有效） */
  tableData?: TableData;
}

/** 光标/选区均在 source 空间（即 rawText 的字符偏移），与 Markdown 标记符一致 */
export interface CursorPosition {
  blockId: string;
  offset: number;
  /** 表格单元格定位：row=-1 表示表头行 */
  tableCell?: { row: number; col: number };
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
  underline: false,
  highlight: false,
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
