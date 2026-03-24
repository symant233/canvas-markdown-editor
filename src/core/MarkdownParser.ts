import type { Block, BlockType, TableAlignment, TableCell, TableData } from './types';
import { DEFAULT_INLINE_STYLE, createBlock } from './types';
import { parseInlineMarkdown } from './InlineParser';
import { highlightCode } from './SyntaxHighlighter';

export class MarkdownParser {
  /** 将 Markdown 字符串按行解析为 Block 数组 */
  parse(markdown: string): Block[] {
    const lines = markdown.split('\n');
    const blocks: Block[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('```')) {
        const language = line.substring(3).trim() || undefined;
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        const code = codeLines.join('\n');
        const block = createBlock('code-block', code, highlightCode(code, language));
        block.language = language;
        blocks.push(block);
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
      } else if (line.startsWith('- [x] ') || line.startsWith('- [X] ')) {
        const block = this.createBlockParsed('task-list', line.substring(6));
        block.checked = true;
        blocks.push(block);
        i++;
      } else if (line.startsWith('- [ ] ')) {
        const block = this.createBlockParsed('task-list', line.substring(6));
        block.checked = false;
        blocks.push(block);
        i++;
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        blocks.push(this.createBlockParsed('bullet-list', line.substring(2)));
        i++;
      } else if (line.startsWith('###### ')) {
        blocks.push(this.createBlockParsed('heading-6', line.substring(7)));
        i++;
      } else if (line.startsWith('##### ')) {
        blocks.push(this.createBlockParsed('heading-5', line.substring(6)));
        i++;
      } else if (line.startsWith('#### ')) {
        blocks.push(this.createBlockParsed('heading-4', line.substring(5)));
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
      } else if (this.isTableRow(line) && i + 1 < lines.length && this.isTableSeparator(lines[i + 1])) {
        const tableLines: string[] = [line, lines[i + 1]];
        i += 2;
        while (i < lines.length && this.isTableRow(lines[i])) {
          tableLines.push(lines[i]);
          i++;
        }
        blocks.push(this.parseTable(tableLines));
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

  private createBlockParsed(type: BlockType, contentText: string): Block {
    const result = parseInlineMarkdown(contentText);
    return createBlock(type, contentText, result.segments, result.sourceToVisual, result.visualToSource);
  }

  private createBlockSimple(type: BlockType, rawText: string): Block {
    return createBlock(type, rawText, [{ text: rawText, style: { ...DEFAULT_INLINE_STYLE } }]);
  }

  private isTableRow(line: string): boolean {
    return line.includes('|') && line.trim().startsWith('|');
  }

  private isTableSeparator(line: string): boolean {
    if (!line.includes('|')) return false;
    const cells = this.splitTableRow(line);
    return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c.trim()));
  }

  private splitTableRow(line: string): string[] {
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.substring(1);
    if (trimmed.endsWith('|')) trimmed = trimmed.substring(0, trimmed.length - 1);
    return trimmed.split('|');
  }

  private parseTableCell(text: string): TableCell {
    const trimmed = text.trim();
    const result = parseInlineMarkdown(trimmed);
    return {
      rawText: trimmed,
      inlines: result.segments,
      sourceToVisual: result.sourceToVisual,
      visualToSource: result.visualToSource,
    };
  }

  private parseAlignments(separatorCells: string[]): TableAlignment[] {
    return separatorCells.map(cell => {
      const trimmed = cell.trim();
      const left = trimmed.startsWith(':');
      const right = trimmed.endsWith(':');
      if (left && right) return 'center' as TableAlignment;
      if (right) return 'right' as TableAlignment;
      if (left) return 'left' as TableAlignment;
      return 'none' as TableAlignment;
    });
  }

  private parseTable(tableLines: string[]): Block {
    const headerCells = this.splitTableRow(tableLines[0]);
    const separatorCells = this.splitTableRow(tableLines[1]);
    const colCount = headerCells.length;

    const alignments = this.parseAlignments(separatorCells);
    const headers = headerCells.map(c => this.parseTableCell(c));

    const rows: TableCell[][] = [];
    for (let r = 2; r < tableLines.length; r++) {
      const cells = this.splitTableRow(tableLines[r]);
      const row: TableCell[] = [];
      for (let c = 0; c < colCount; c++) {
        row.push(this.parseTableCell(cells[c] ?? ''));
      }
      rows.push(row);
    }

    const tableData: TableData = { headers, alignments, rows, originalSeparator: tableLines[1] };
    const rawText = tableLines.join('\n');
    const block = createBlock('table', rawText, [{ text: '', style: { ...DEFAULT_INLINE_STYLE } }]);
    block.tableData = tableData;
    return block;
  }
}
