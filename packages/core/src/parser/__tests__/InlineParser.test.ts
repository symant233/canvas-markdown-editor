import { describe, it, expect } from 'vitest';
import { parseInlineMarkdown } from '../InlineParser';

describe('InlineParser', () => {
  // ─── 基础：纯文本不含任何 Markdown 标记 ───

  it('纯文本原样输出，不产生样式', () => {
    const result = parseInlineMarkdown('hello world');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('hello world');
    expect(result.segments[0].style.bold).toBe(false);
  });

  it('空字符串返回一个空 segment', () => {
    const result = parseInlineMarkdown('');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('');
  });

  // ─── 粗体 **text** ───

  it('**双星号** 解析为粗体', () => {
    const result = parseInlineMarkdown('**bold**');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('bold');
    expect(result.segments[0].style.bold).toBe(true);
  });

  it('粗体前后的普通文本作为独立 segment', () => {
    const result = parseInlineMarkdown('before **bold** after');
    expect(result.segments.map(s => s.text)).toEqual(['before ', 'bold', ' after']);
    expect(result.segments[1].style.bold).toBe(true);
    expect(result.segments[0].style.bold).toBe(false);
  });

  // ─── 斜体 *text* ───

  it('*单星号* 解析为斜体', () => {
    const result = parseInlineMarkdown('*italic*');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('italic');
    expect(result.segments[0].style.italic).toBe(true);
  });

  // ─── 粗斜体 ***text*** ───

  it('***三星号*** 同时启用粗体和斜体', () => {
    const result = parseInlineMarkdown('***both***');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('both');
    expect(result.segments[0].style.bold).toBe(true);
    expect(result.segments[0].style.italic).toBe(true);
  });

  // ─── 内联代码 `code` ───

  it('`反引号` 解析为内联代码', () => {
    const result = parseInlineMarkdown('use `const` here');
    expect(result.segments.map(s => s.text)).toEqual(['use ', 'const', ' here']);
    expect(result.segments[1].style.code).toBe(true);
  });

  it('``双反引号`` 允许内容包含单反引号', () => {
    // `` `code` `` → 视觉上显示 `code`（CommonMark 规范：首尾空格剥离）
    const result = parseInlineMarkdown('`` `code` ``');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('`code`');
    expect(result.segments[0].style.code).toBe(true);
  });

  // ─── 删除线 ~~text~~ ───

  it('~~双波浪号~~ 解析为删除线', () => {
    const result = parseInlineMarkdown('~~removed~~');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('removed');
    expect(result.segments[0].style.strikethrough).toBe(true);
  });

  // ─── 下划线 ++text++ ───

  it('++双加号++ 解析为下划线', () => {
    const result = parseInlineMarkdown('++underlined++');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('underlined');
    expect(result.segments[0].style.underline).toBe(true);
  });

  // ─── 高亮 ==text== ───

  it('==双等号== 解析为高亮', () => {
    const result = parseInlineMarkdown('==important==');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('important');
    expect(result.segments[0].style.highlight).toBe(true);
  });

  // ─── 反斜杠转义 ───

  it('反斜杠转义使标记符作为纯文本显示', () => {
    // \*not italic\* → 视觉上就是 *not italic*
    const result = parseInlineMarkdown('\\*not italic\\*');
    const visual = result.segments.map(s => s.text).join('');
    expect(visual).toBe('*not italic*');
    // 没有斜体
    expect(result.segments.every(s => !s.style.italic)).toBe(true);
  });

  // ─── 未闭合标记 ───

  it('未闭合的 ** 当作普通文本', () => {
    const result = parseInlineMarkdown('**not closed');
    const visual = result.segments.map(s => s.text).join('');
    expect(visual).toBe('**not closed');
  });

  // ─── Source ↔ Visual 偏移映射 ───
  //
  // 这是编辑器的核心概念：rawText 中 Markdown 标记符（如 **）不在画布上显示，
  // 但光标始终在 source 空间工作。偏移映射让光标位置和视觉位置之间能 O(1) 互转。

  it('纯文本的 source 和 visual 偏移一一对应', () => {
    const result = parseInlineMarkdown('abc');
    // source: a(0) b(1) c(2) end(3)
    // visual: a(0) b(1) c(2) end(3)
    expect(result.sourceToVisual).toEqual([0, 1, 2, 3]);
    expect(result.visualToSource).toEqual([0, 1, 2, 3]);
  });

  it('**bold** 的标记符在 visual 中被跳过', () => {
    const result = parseInlineMarkdown('**ab**');
    // source: *(0) *(1) a(2) b(3) *(4) *(5) end(6)
    // visual:             a(0) b(1)               end(2)
    // sourceToVisual: 两个开头 * 都映射到 0，a→0，b→1，两个闭合 * 映射到 2
    expect(result.sourceToVisual[0]).toBe(0); // 第一个 *
    expect(result.sourceToVisual[1]).toBe(0); // 第二个 *
    expect(result.sourceToVisual[2]).toBe(0); // a
    expect(result.sourceToVisual[3]).toBe(1); // b
    expect(result.sourceToVisual[4]).toBe(2); // 闭合 *
    expect(result.sourceToVisual[5]).toBe(2); // 闭合 *
    expect(result.sourceToVisual[6]).toBe(2); // end

    // visualToSource: visual 位置 0→source 2(a), 1→source 3(b), 2→end(6)
    expect(result.visualToSource[0]).toBe(2);
    expect(result.visualToSource[1]).toBe(3);
  });

  it('混合标记的偏移映射长度正确', () => {
    const result = parseInlineMarkdown('a**b**c');
    // source 长度 7 → sourceToVisual 长度 8（含 end）
    // visual "abc" 长度 3 → visualToSource 长度 4（含 end）
    expect(result.sourceToVisual).toHaveLength(8);
    expect(result.visualToSource).toHaveLength(4);
  });
});
