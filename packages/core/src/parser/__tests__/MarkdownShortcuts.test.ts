import { describe, it, expect } from 'vitest';
import { checkBlockShortcut, applyBlockShortcut } from '../MarkdownShortcuts';
import { createBlock, DEFAULT_INLINE_STYLE } from '../../types';

/** 创建一个用于测试的 paragraph 块 */
function makeParagraph(text: string) {
  return createBlock('paragraph', text, [{ text, style: { ...DEFAULT_INLINE_STYLE } }]);
}

/** 创建一个用于测试的 bullet-list 块 */
function makeBulletList(text: string) {
  const block = createBlock('bullet-list', text, [{ text, style: { ...DEFAULT_INLINE_STYLE } }]);
  return block;
}

describe('MarkdownShortcuts', () => {
  // ─── 块级快捷键：用户在段落中输入特定前缀后，段落自动转换为对应块类型 ───
  //
  // 例如输入 "# " 后，当前 paragraph 变为 heading-1，前缀被消耗。
  // 这是编辑器"所见即所得"体验的核心：用户输入 Markdown 语法，立即看到格式化效果。

  it('# 空格 → heading-1', () => {
    const block = makeParagraph('# Hello');
    const result = checkBlockShortcut(block);
    expect(result.matched).toBe(true);
    expect(result.newType).toBe('heading-1');
    expect(result.prefixLength).toBe(2); // "# " 共 2 个字符
  });

  it('###### 空格 → heading-6（最深级别）', () => {
    const block = makeParagraph('###### Deep');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('heading-6');
  });

  it('- 空格 → bullet-list', () => {
    const block = makeParagraph('- item');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('bullet-list');
  });

  it('* 空格 → bullet-list（星号也是无序列表标记）', () => {
    const block = makeParagraph('* item');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('bullet-list');
  });

  it('1. 空格 → ordered-list（数字序号）', () => {
    const block = makeParagraph('1. first');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('ordered-list');
  });

  it('> 空格 → blockquote', () => {
    const block = makeParagraph('> quote');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('blockquote');
  });

  it('--- → hr（精确匹配，不能有后续内容）', () => {
    const block = makeParagraph('---');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('hr');

    // "---extra" 不匹配 hr
    const block2 = makeParagraph('---extra');
    expect(checkBlockShortcut(block2).matched).toBe(false);
  });

  it('``` → code-block（精确匹配）', () => {
    const block = makeParagraph('```');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('code-block');
  });

  it('- [x] → task-list（已选中）', () => {
    const block = makeParagraph('- [x] done');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('task-list');
    expect(result.checked).toBe(true);
  });

  it('- [ ] → task-list（未选中）', () => {
    const block = makeParagraph('- [ ] todo');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('task-list');
    expect(result.checked).toBe(false);
  });

  // ─── bullet-list 升级为 task-list ───
  //
  // 用户先输入 "- " 触发 bullet-list，再输入 "[ ] " 时升级为 task-list。
  // 这是两步触发的快捷键，因为 "- " 已经先匹配了。

  it('bullet-list 中输入 [ ] 升级为 task-list', () => {
    const block = makeBulletList('[ ] some task');
    const result = checkBlockShortcut(block);
    expect(result.matched).toBe(true);
    expect(result.newType).toBe('task-list');
    expect(result.checked).toBe(false);
  });

  it('bullet-list 中输入 [x] 升级为已选中 task-list', () => {
    const block = makeBulletList('[x] done');
    const result = checkBlockShortcut(block);
    expect(result.newType).toBe('task-list');
    expect(result.checked).toBe(true);
  });

  // ─── 不匹配的情况 ───

  it('非 paragraph 非 bullet-list 类型不触发快捷键', () => {
    const block = createBlock('heading-1', '# nested', [{ text: '# nested', style: { ...DEFAULT_INLINE_STYLE } }]);
    expect(checkBlockShortcut(block).matched).toBe(false);
  });

  it('普通文本不匹配任何快捷键', () => {
    const block = makeParagraph('just text');
    expect(checkBlockShortcut(block).matched).toBe(false);
  });

  // ─── applyBlockShortcut：应用匹配结果，修改块类型并去掉前缀 ───

  it('apply 后块类型改变，rawText 去掉前缀', () => {
    const block = makeParagraph('## Title');
    const result = checkBlockShortcut(block);
    applyBlockShortcut(block, result);
    expect(block.type).toBe('heading-2');
    expect(block.rawText).toBe('Title');
  });

  it('apply hr 后 rawText 被清空', () => {
    const block = makeParagraph('---');
    const result = checkBlockShortcut(block);
    applyBlockShortcut(block, result);
    expect(block.type).toBe('hr');
    expect(block.rawText).toBe('');
  });
});
