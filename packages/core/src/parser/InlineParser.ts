import type { InlineSegment } from '../types';
import { DEFAULT_INLINE_STYLE } from '../types';

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
    /* 反斜杠转义：\后跟 Markdown 特殊字符时，\ 不可见，后面字符作为纯文本 */
    if (text[i] === '\\' && i + 1 < text.length && '\\`*_{}[]()#+-.!|~>='.includes(text[i + 1])) {
      sourceToVisual[i] = visualOffset;
      i += 1;
      const escaped = text[i];
      sourceToVisual[i] = visualOffset;
      visualToSource.push(i);
      visualOffset++;
      segments.push({ text: escaped, style: { ...DEFAULT_INLINE_STYLE } });
      i += 1;
      continue;
    }

    /* ***粗斜体***：必须在 ** 和 * 之前匹配 */
    if (text.startsWith('***', i)) {
      const end = text.indexOf('***', i + 3);
      if (end !== -1 && end > i + 3) {
        sourceToVisual[i] = visualOffset;
        sourceToVisual[i + 1] = visualOffset;
        sourceToVisual[i + 2] = visualOffset;
        i += 3;

        const content = text.substring(i, end);
        segments.push({ text: content, style: { ...DEFAULT_INLINE_STYLE, bold: true, italic: true } });
        for (let j = 0; j < content.length; j++) {
          sourceToVisual[i + j] = visualOffset;
          visualToSource.push(i + j);
          visualOffset++;
        }
        i = end;

        sourceToVisual[i] = visualOffset;
        sourceToVisual[i + 1] = visualOffset;
        sourceToVisual[i + 2] = visualOffset;
        i += 3;
        continue;
      }
    }

    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
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

    /* 内联代码：支持单反引号 `code` 和多反引号 `` `code` `` 语法。
     * 多反引号允许内容包含较少数量的反引号而不会提前闭合。
     * 例如 `` `code` `` → 渲染为 `code`（含反引号的 code 内联）。
     * 闭合条件：找到与开头 **恰好** 相同数量的连续反引号。 */
    if (text[i] === '`') {
      // 1) 统计开头连续反引号个数，例如 `` 就是 2
      let backtickCount = 0;
      while (i + backtickCount < text.length && text[i + backtickCount] === '`') {
        backtickCount++;
      }

      // 2) 从开头反引号之后开始扫描，寻找恰好 backtickCount 个连续反引号作为闭合
      let end = -1;
      let j = i + backtickCount;
      while (j < text.length) {
        if (text[j] === '`') {
          let closeCount = 0;
          while (j + closeCount < text.length && text[j + closeCount] === '`') {
            closeCount++;
          }
          if (closeCount === backtickCount) {
            end = j; // 找到匹配的闭合位置
            break;
          }
          // 数量不匹配，跳过这一组反引号继续搜索
          j += closeCount;
        } else {
          j++;
        }
      }

      // 3) end > i + backtickCount 确保内容非空
      if (end !== -1 && end > i + backtickCount) {
        // 映射所有开头反引号 → 当前 visualOffset（标记符不占视觉宽度）
        for (let k = 0; k < backtickCount; k++) {
          sourceToVisual[i + k] = visualOffset;
        }
        i += backtickCount;

        let contentStart = i;
        let contentEnd = end;
        const raw = text.substring(contentStart, contentEnd);
        // CommonMark 规范：多反引号时，若内容首尾各有空格且非全空格，去掉首尾各一个空格
        // 例如 `` `hi` `` 的 raw 是 " `hi` "，剥离后变为 "`hi`"
        if (backtickCount > 1 && raw.length >= 2 && raw[0] === ' ' && raw[raw.length - 1] === ' ' && raw.trim().length > 0) {
          sourceToVisual[contentStart] = visualOffset;
          contentStart += 1;
          contentEnd -= 1;
        }

        const content = text.substring(contentStart, contentEnd);
        segments.push({ text: content, style: { ...DEFAULT_INLINE_STYLE, code: true } });
        for (let ci = 0; ci < content.length; ci++) {
          sourceToVisual[contentStart + ci] = visualOffset;
          visualToSource.push(contentStart + ci);
          visualOffset++;
        }

        // 映射被剥离的尾部空格（如果有的话）
        if (contentEnd < end) {
          sourceToVisual[contentEnd] = visualOffset;
        }

        // 映射所有闭合反引号 → 当前 visualOffset
        for (let k = 0; k < backtickCount; k++) {
          sourceToVisual[end + k] = visualOffset;
        }
        i = end + backtickCount;
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

    if (text.startsWith('++', i)) {
      const end = text.indexOf('++', i + 2);
      if (end !== -1 && end > i + 2) {
        sourceToVisual[i] = visualOffset;
        sourceToVisual[i + 1] = visualOffset;
        i += 2;

        const content = text.substring(i, end);
        segments.push({ text: content, style: { ...DEFAULT_INLINE_STYLE, underline: true } });
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

    if (text.startsWith('==', i)) {
      const end = text.indexOf('==', i + 2);
      if (end !== -1 && end > i + 2) {
        sourceToVisual[i] = visualOffset;
        sourceToVisual[i + 1] = visualOffset;
        i += 2;

        const content = text.substring(i, end);
        segments.push({ text: content, style: { ...DEFAULT_INLINE_STYLE, highlight: true } });
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

    let plainEnd = i + 1;
    while (plainEnd < text.length) {
      if (text[plainEnd] === '*' || text[plainEnd] === '`' || text[plainEnd] === '\\' ||
          text.startsWith('~~', plainEnd) || text.startsWith('++', plainEnd) || text.startsWith('==', plainEnd)) {
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
