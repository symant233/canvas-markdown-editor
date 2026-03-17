import type { InlineSegment } from './types';
import { DEFAULT_INLINE_STYLE } from './types';

export interface ParseResult {
  segments: InlineSegment[];
  /** sourceToVisual[i]：rawText 第 i 个字符对应的视觉偏移 */
  sourceToVisual: number[];
  /** visualToSource[i]：视觉第 i 个字符对应的 rawText 偏移 */
  visualToSource: number[];
}

/**
 * 解析原始 Markdown 文本为视觉片段，同时构建 source↔visual 双向偏移映射。
 * 标记符（**、*、`、~~）消耗后不加入视觉文本，但在 sourceToVisual 中映射到标记符后的第一个视觉字符位置。
 */
export function parseInlineMarkdown(text: string): ParseResult {
  const segments: InlineSegment[] = [];
  const sourceToVisual: number[] = new Array(text.length + 1);
  const visualToSource: number[] = [];
  let visualOffset = 0;
  let i = 0;

  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      /* end > i + 2：防止匹配空内联标记（如 ** **）导致内容消失 */
      if (end !== -1 && end > i + 2) {
        sourceToVisual[i] = visualOffset;
        sourceToVisual[i + 1] = visualOffset;
        i += 2;

        const content = text.substring(i, end);
        segments.push({ text: content, style: { ...DEFAULT_INLINE_STYLE, bold: true } });
        for (let j = 0; j < content.length; j++) {
          sourceToVisual[i + j] = visualOffset;
          visualToSource.push(i + j);
          visualOffset++;
        }
        i = end;

        sourceToVisual[i] = visualOffset;
        sourceToVisual[i + 1] = visualOffset;
        i += 2;
        continue;
      }
    }

    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      /* end > i + 1：同上，避免 * * 空匹配 */
      if (end !== -1 && end > i + 1 && (end + 1 >= text.length || text[end + 1] !== '*')) {
        sourceToVisual[i] = visualOffset;
        i += 1;

        const content = text.substring(i, end);
        segments.push({ text: content, style: { ...DEFAULT_INLINE_STYLE, italic: true } });
        for (let j = 0; j < content.length; j++) {
          sourceToVisual[i + j] = visualOffset;
          visualToSource.push(i + j);
          visualOffset++;
        }
        i = end;

        sourceToVisual[i] = visualOffset;
        i += 1;
        continue;
      }
    }

    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      /* end > i + 1：避免 `` `` 空匹配 */
      if (end !== -1 && end > i + 1) {
        sourceToVisual[i] = visualOffset;
        i += 1;

        const content = text.substring(i, end);
        segments.push({ text: content, style: { ...DEFAULT_INLINE_STYLE, code: true } });
        for (let j = 0; j < content.length; j++) {
          sourceToVisual[i + j] = visualOffset;
          visualToSource.push(i + j);
          visualOffset++;
        }
        i = end;

        sourceToVisual[i] = visualOffset;
        i += 1;
        continue;
      }
    }

    if (text.startsWith('~~', i)) {
      const end = text.indexOf('~~', i + 2);
      /* end > i + 2：避免 ~~ ~~ 空匹配 */
      if (end !== -1 && end > i + 2) {
        sourceToVisual[i] = visualOffset;
        sourceToVisual[i + 1] = visualOffset;
        i += 2;

        const content = text.substring(i, end);
        segments.push({ text: content, style: { ...DEFAULT_INLINE_STYLE, strikethrough: true } });
        for (let j = 0; j < content.length; j++) {
          sourceToVisual[i + j] = visualOffset;
          visualToSource.push(i + j);
          visualOffset++;
        }
        i = end;

        sourceToVisual[i] = visualOffset;
        sourceToVisual[i + 1] = visualOffset;
        i += 2;
        continue;
      }
    }

    /* 纯文本段：从 i 起向后扫描，直到遇到 *、`、~~ 或结尾，整段作为无样式片段 */
    let plainEnd = i + 1;
    while (plainEnd < text.length) {
      if (text[plainEnd] === '*' || text[plainEnd] === '`' || text.startsWith('~~', plainEnd)) {
        break;
      }
      plainEnd++;
    }

    const content = text.substring(i, plainEnd);
    segments.push({ text: content, style: { ...DEFAULT_INLINE_STYLE } });
    for (let j = 0; j < content.length; j++) {
      sourceToVisual[i + j] = visualOffset;
      visualToSource.push(i + j);
      visualOffset++;
    }
    i = plainEnd;
  }

  sourceToVisual[text.length] = visualOffset;
  visualToSource.push(text.length);

  if (segments.length === 0) {
    segments.push({ text: '', style: { ...DEFAULT_INLINE_STYLE } });
  }

  return { segments, sourceToVisual, visualToSource };
}
