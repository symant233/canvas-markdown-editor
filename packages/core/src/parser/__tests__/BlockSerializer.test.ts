import { describe, it, expect } from 'vitest';
import { blocksToMarkdown } from '../BlockSerializer';
import { MarkdownParser } from '../MarkdownParser';

const parser = new MarkdownParser();

describe('BlockSerializer', () => {
  // ─── 核心保证：parse → serialize 的往返一致性 ───
  //
  // 编辑器右侧面板显示的 Markdown 源码就是 blocksToMarkdown 的输出。
  // 如果 parse → serialize 不一致，用户看到的源码和画布内容就会不同步。

  it('paragraph 往返一致', () => {
    const md = 'hello world';
    expect(blocksToMarkdown(parser.parse(md))).toBe(md);
  });

  it('heading 往返一致（1-6 级）', () => {
    const md = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    expect(blocksToMarkdown(parser.parse(md))).toBe(md);
  });

  it('bullet-list 往返一致', () => {
    const md = '- one\n- two\n- three';
    expect(blocksToMarkdown(parser.parse(md))).toBe(md);
  });

  it('ordered-list 往返一致（序号从 1 重新编号）', () => {
    // 注意：序列化时序号总是从 1 递增，不保留原始序号
    const md = '1. first\n2. second\n3. third';
    expect(blocksToMarkdown(parser.parse(md))).toBe(md);
  });

  it('task-list 往返一致，checked 状态保留', () => {
    const md = '- [x] done\n- [ ] todo';
    expect(blocksToMarkdown(parser.parse(md))).toBe(md);
  });

  it('blockquote 往返一致', () => {
    const md = '> some quote';
    expect(blocksToMarkdown(parser.parse(md))).toBe(md);
  });

  it('code-block 往返一致，语言标记保留', () => {
    const md = '```ts\nconst x = 1;\n```';
    expect(blocksToMarkdown(parser.parse(md))).toBe(md);
  });

  it('hr 往返一致', () => {
    const md = '---';
    expect(blocksToMarkdown(parser.parse(md))).toBe(md);
  });

  // ─── ordered-list 序号重建 ───

  it('有序列表中间插入其他类型后，序号重新计数', () => {
    // 有序列表被段落打断后，序号从 1 重新开始
    const md = '1. a\nbreak\n1. b';
    const result = blocksToMarkdown(parser.parse(md));
    expect(result).toBe('1. a\nbreak\n1. b');
  });
});
