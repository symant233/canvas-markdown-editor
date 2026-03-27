import { describe, it, expect } from 'vitest';
import { MarkdownParser } from '../MarkdownParser';

const parser = new MarkdownParser();

describe('MarkdownParser', () => {
  // ─── 块类型识别：每行 Markdown 根据前缀被分类为不同的 Block 类型 ───

  it('普通文本解析为 paragraph', () => {
    const blocks = parser.parse('hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].rawText).toBe('hello world');
  });

  it('# 前缀解析为对应级别的 heading（1-6 级）', () => {
    const blocks = parser.parse('# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6');
    expect(blocks.map(b => b.type)).toEqual([
      'heading-1', 'heading-2', 'heading-3',
      'heading-4', 'heading-5', 'heading-6',
    ]);
    // rawText 不含前缀标记，只保留内容
    expect(blocks[0].rawText).toBe('H1');
    expect(blocks[5].rawText).toBe('H6');
  });

  it('- 前缀解析为 bullet-list，内容去掉前缀', () => {
    const blocks = parser.parse('- item one\n- item two');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('bullet-list');
    expect(blocks[0].rawText).toBe('item one');
  });

  it('* 前缀也解析为 bullet-list', () => {
    const blocks = parser.parse('* star item');
    expect(blocks[0].type).toBe('bullet-list');
    expect(blocks[0].rawText).toBe('star item');
  });

  it('数字. 前缀解析为 ordered-list', () => {
    const blocks = parser.parse('1. first\n2. second');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('ordered-list');
    expect(blocks[0].rawText).toBe('first');
  });

  it('- [x] 和 - [ ] 解析为 task-list，携带 checked 状态', () => {
    const blocks = parser.parse('- [x] done\n- [ ] todo');
    expect(blocks[0].type).toBe('task-list');
    expect(blocks[0].checked).toBe(true);
    expect(blocks[0].rawText).toBe('done');
    expect(blocks[1].type).toBe('task-list');
    expect(blocks[1].checked).toBe(false);
  });

  it('> 前缀解析为 blockquote', () => {
    const blocks = parser.parse('> quoted text');
    expect(blocks[0].type).toBe('blockquote');
    expect(blocks[0].rawText).toBe('quoted text');
  });

  it('--- / *** / ___ 解析为 hr（水平线），rawText 为空', () => {
    for (const marker of ['---', '***', '___']) {
      const blocks = parser.parse(marker);
      expect(blocks[0].type).toBe('hr');
      expect(blocks[0].rawText).toBe('');
    }
  });

  // ─── 代码块：``` 围栏包裹，支持语言标记 ───

  it('``` 围栏之间的内容解析为 code-block，保留换行', () => {
    const md = '```js\nconst a = 1;\nconst b = 2;\n```';
    const blocks = parser.parse(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code-block');
    expect(blocks[0].language).toBe('js');
    expect(blocks[0].rawText).toBe('const a = 1;\nconst b = 2;');
  });

  it('代码块不解析内联 Markdown（代码内容保持原样）', () => {
    const blocks = parser.parse('```\n**not bold**\n```');
    // 代码块走 SyntaxHighlighter 而非 InlineParser，不会产生 bold 样式
    expect(blocks[0].type).toBe('code-block');
    expect(blocks[0].rawText).toBe('**not bold**');
  });

  // ─── 表格：| 分隔的行 + 分隔符行 ───

  it('含表头 + 分隔行 + 数据行的管道文本解析为 table', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |';
    const blocks = parser.parse(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('table');
    expect(blocks[0].tableData).toBeDefined();
    expect(blocks[0].tableData!.headers).toHaveLength(2);
    expect(blocks[0].tableData!.headers[0].rawText).toBe('Name');
    expect(blocks[0].tableData!.rows).toHaveLength(1);
    expect(blocks[0].tableData!.rows[0][1].rawText).toBe('30');
  });

  it('表格分隔符行的对齐标记被正确解析', () => {
    const md = '| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |';
    const blocks = parser.parse(md);
    const alignments = blocks[0].tableData!.alignments;
    expect(alignments).toEqual(['left', 'center', 'right']);
  });

  // ─── 多块混合 ───

  it('多种块类型混合时按行正确分类', () => {
    const md = '# Title\n\nSome text\n\n- item';
    const blocks = parser.parse(md);
    const types = blocks.map(b => b.type);
    expect(types).toEqual(['heading-1', 'paragraph', 'paragraph', 'paragraph', 'bullet-list']);
  });

  // ─── 空文档 ───

  it('空字符串返回一个空 paragraph（保证文档至少有一个块）', () => {
    const blocks = parser.parse('');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].rawText).toBe('');
  });

  // ─── 内联样式穿透 ───

  it('块内容中的内联 Markdown 被解析为带样式的 segments', () => {
    const blocks = parser.parse('# **bold** heading');
    expect(blocks[0].inlines[0].text).toBe('bold');
    expect(blocks[0].inlines[0].style.bold).toBe(true);
  });
});
