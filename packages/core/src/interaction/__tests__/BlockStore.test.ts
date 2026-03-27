import { describe, it, expect } from 'vitest';
import { BlockStore } from '../BlockStore';
import { MarkdownParser } from '../../parser/MarkdownParser';

const parser = new MarkdownParser();

/** 创建一个预填充内容的 BlockStore */
function createStore(md: string) {
  const store = new BlockStore();
  store.setBlocks(parser.parse(md));
  return store;
}

describe('BlockStore', () => {
  // ─── 基础数据操作 ───

  it('setBlocks 后能通过 getBlocks 取回', () => {
    const store = createStore('hello');
    expect(store.getBlocks()).toHaveLength(1);
    expect(store.getBlocks()[0].rawText).toBe('hello');
  });

  it('getBlock 按 id 查找，不存在返回 undefined', () => {
    const store = createStore('hello');
    const block = store.getBlocks()[0];
    expect(store.getBlock(block.id)).toBe(block);
    expect(store.getBlock('nonexistent')).toBeUndefined();
  });

  it('removeBlock 后文档至少保留一个空 paragraph', () => {
    const store = createStore('only block');
    const id = store.getBlocks()[0].id;
    store.removeBlock(id);
    // 删除最后一个块后，自动补一个空 paragraph
    expect(store.getBlocks()).toHaveLength(1);
    expect(store.getBlocks()[0].type).toBe('paragraph');
    expect(store.getBlocks()[0].rawText).toBe('');
  });

  // ─── 文本插入：光标位置插入文本后自动重解析 ───

  it('insertTextAtCursor 在指定位置插入文本，返回新光标位置', () => {
    const store = createStore('ac');
    const block = store.getBlocks()[0];
    const newCursor = store.insertTextAtCursor(
      { blockId: block.id, offset: 1 }, // 光标在 a 和 c 之间
      'b',
    );
    expect(store.getBlock(block.id)!.rawText).toBe('abc');
    expect(newCursor.offset).toBe(2); // 光标移到 b 之后
  });

  it('插入文本后内联样式自动重解析', () => {
    const store = createStore('**b**');
    const block = store.getBlocks()[0];
    // 在 b 后面插入 c → **bc**，仍然是粗体
    store.insertTextAtCursor({ blockId: block.id, offset: 3 }, 'c');
    const updated = store.getBlock(block.id)!;
    expect(updated.rawText).toBe('**bc**');
    expect(updated.inlines[0].style.bold).toBe(true);
    expect(updated.inlines[0].text).toBe('bc');
  });

  // ─── 文本删除 ───

  it('deleteCharAt 删除指定位置的字符', () => {
    const store = createStore('abc');
    const block = store.getBlocks()[0];
    store.deleteCharAt(block.id, 1); // 删除 b
    expect(store.getBlock(block.id)!.rawText).toBe('ac');
  });

  it('越界 offset 不会删除任何内容', () => {
    const store = createStore('abc');
    const block = store.getBlocks()[0];
    store.deleteCharAt(block.id, 10);
    expect(store.getBlock(block.id)!.rawText).toBe('abc');
  });

  // ─── 块合并：Backspace 在块首时，当前块内容合并到上一块 ───

  it('mergeWithPrevBlock 将当前块文本追加到上一块', () => {
    const store = createStore('first\nsecond');
    const blocks = store.getBlocks();
    const secondId = blocks[1].id;
    const cursor = store.mergeWithPrevBlock(secondId);

    expect(store.getBlocks()).toHaveLength(1);
    expect(store.getBlocks()[0].rawText).toBe('firstsecond');
    // 返回的光标位置在原 first 块末尾（即合并点）
    expect(cursor!.offset).toBe(5);
  });

  it('第一个块无法向上合并，返回 null', () => {
    const store = createStore('only');
    const id = store.getBlocks()[0].id;
    expect(store.mergeWithPrevBlock(id)).toBeNull();
  });

  // ─── 块拆分：Enter 键将当前块从光标处一分为二 ───

  it('splitBlock 在光标处拆分为两个块', () => {
    const store = createStore('helloworld');
    const block = store.getBlocks()[0];
    const newCursor = store.splitBlock({ blockId: block.id, offset: 5 });

    expect(store.getBlocks()).toHaveLength(2);
    expect(store.getBlocks()[0].rawText).toBe('hello');
    expect(store.getBlocks()[1].rawText).toBe('world');
    // 光标移到新块开头
    expect(newCursor.offset).toBe(0);
  });

  it('列表项拆分后新块继承列表类型', () => {
    const store = createStore('- hello world');
    const block = store.getBlocks()[0];
    store.splitBlock({ blockId: block.id, offset: 6 }); // "hello " | "world"

    const blocks = store.getBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('bullet-list');
    expect(blocks[1].type).toBe('bullet-list');
  });

  it('空列表项回车退化为 paragraph（退出列表模式）', () => {
    const store = createStore('- ');
    const block = store.getBlocks()[0];
    // rawText 是空的（"- " 前缀已被解析器消耗）
    store.splitBlock({ blockId: block.id, offset: 0 });

    // 空列表项回车 → 类型变为 paragraph
    expect(store.getBlocks()[0].type).toBe('paragraph');
  });

  // ─── 代码块内 Enter：插入换行而非拆分块 ───

  it('代码块内 Enter 插入 \\n，不拆分块', () => {
    const store = createStore('```\nline1\n```');
    const block = store.getBlocks()[0];
    expect(block.type).toBe('code-block');

    const cursor = store.splitBlock({ blockId: block.id, offset: 5 }); // "line1" 末尾
    // 代码块不拆分，而是插入换行
    expect(store.getBlocks()).toHaveLength(1);
    expect(block.rawText).toBe('line1\n');
    expect(cursor.offset).toBe(6);
  });

  it('代码块末尾连续两次 Enter 退出代码块', () => {
    const store = createStore('```\ncode\n\n```');
    const block = store.getBlocks()[0];
    // rawText = "code\n"，光标在末尾（offset=5），此时 beforeRaw 以 \n 结尾且 after 为空
    const cursor = store.splitBlock({ blockId: block.id, offset: 5 });

    // 退出代码块：代码块末尾 \n 被移除，新建一个 paragraph
    expect(store.getBlocks()).toHaveLength(2);
    expect(store.getBlocks()[0].type).toBe('code-block');
    expect(store.getBlocks()[0].rawText).toBe('code');
    expect(store.getBlocks()[1].type).toBe('paragraph');
    expect(cursor.offset).toBe(0);
  });

  // ─── Source ↔ Visual 偏移安全转换 ───

  it('sourceToVisual 对含标记的文本返回正确的视觉偏移', () => {
    const store = createStore('**bold**');
    const block = store.getBlocks()[0];
    // source offset 2 (第一个 'b') → visual offset 0
    expect(store.sourceToVisual(block, 2)).toBe(0);
    // source offset 0 (第一个 '*') → visual offset 0（标记符映射到后续第一个可见字符）
    expect(store.sourceToVisual(block, 0)).toBe(0);
  });

  it('visualToSource 从视觉偏移还原到 rawText 偏移', () => {
    const store = createStore('**bold**');
    const block = store.getBlocks()[0];
    // visual offset 0 → source offset 2（跳过两个 *）
    expect(store.visualToSource(block, 0)).toBe(2);
  });

  // ─── 订阅机制 ───

  it('subscribe 在数据变更时收到通知', () => {
    const store = createStore('hello');
    let called = 0;
    store.subscribe(() => called++);

    const block = store.getBlocks()[0];
    store.insertTextAtCursor({ blockId: block.id, offset: 5 }, '!');
    expect(called).toBe(1);
  });
});
