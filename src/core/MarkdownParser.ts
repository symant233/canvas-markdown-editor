import type { Block, BlockType } from './types';
import { DEFAULT_INLINE_STYLE, createBlock } from './types';
import { parseInlineMarkdown } from './InlineParser';

export class MarkdownParser {
  /** 将 Markdown 字符串按行解析为 Block 数组 */
  parse(markdown: string): Block[] {
    const lines = markdown.split('\n');
    const blocks: Block[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('```')) {
        /* 代码块：``` 开头直到下一个 ``` 之间的行合并为 rawText，不做内联解析 */
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        blocks.push(this.createBlockSimple('code-block', codeLines.join('\n')));
      } else if (line === '---' || line === '***' || line === '___') {
        blocks.push(this.createBlockSimple('hr', ''));
        i++;
      } else if (line.startsWith('> ')) {
        blocks.push(this.createBlockParsed('blockquote', line.substring(2)));
        i++;
      } else if (/^\d+\.\s/.test(line)) {
        const match = line.match(/^\d+\.\s(.*)$/);
        blocks.push(this.createBlockParsed('ordered-list', match ? match[1] : line));
        i++;
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        blocks.push(this.createBlockParsed('bullet-list', line.substring(2)));
        i++;
      } else if (line.startsWith('### ')) {
        blocks.push(this.createBlockParsed('heading-3', line.substring(4)));
        i++;
      } else if (line.startsWith('## ')) {
        blocks.push(this.createBlockParsed('heading-2', line.substring(3)));
        i++;
      } else if (line.startsWith('# ')) {
        blocks.push(this.createBlockParsed('heading-1', line.substring(2)));
        i++;
      } else {
        blocks.push(this.createBlockParsed('paragraph', line));
        i++;
      }
    }

    if (blocks.length === 0) {
      blocks.push(createBlock('paragraph', '', [{ text: '', style: { ...DEFAULT_INLINE_STYLE } }]));
    }

    return blocks;
  }

  /** createBlockParsed：内容需解析内联 Markdown（**、* 等），带 sourceToVisual/visualToSource；createBlockSimple：原样作为纯文本，不做内联解析 */
  private createBlockParsed(type: BlockType, contentText: string): Block {
    const result = parseInlineMarkdown(contentText);
    return createBlock(type, contentText, result.segments, result.sourceToVisual, result.visualToSource);
  }

  /** 不解析内联，原样作为纯文本；用于代码块、分割线等 */
  private createBlockSimple(type: BlockType, rawText: string): Block {
    return createBlock(type, rawText, [{ text: rawText, style: { ...DEFAULT_INLINE_STYLE } }]);
  }
}
