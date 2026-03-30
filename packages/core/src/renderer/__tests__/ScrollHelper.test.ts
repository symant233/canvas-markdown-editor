import { describe, it, expect } from 'vitest';
import { computeVerticalScrollBlit } from '../ScrollHelper';

describe('ScrollHelper', () => {
  // ─── 滚动 blit 优化 ───
  //
  // 滚动时画布上大部分像素只是平移了位置，没必要全部重绘。
  // computeVerticalScrollBlit 计算哪些像素可以通过 drawImage 直接搬运（blit），
  // 以及新露出的条带区域需要重新绘制。这是编辑器流畅滚动的关键优化。

  it('向下滚动：旧画面上移复用，底部补画新条带', () => {
    // 视口 1000px，向下滚 100px
    const result = computeVerticalScrollBlit(0, 100, 1000);

    // blit: 把旧画面 [100, 1000) 搬到 [0, 900)（上移 100px）
    expect(result.blit).not.toBeNull();
    expect(result.blit!.srcY).toBe(100);  // 从旧画面 y=100 开始取
    expect(result.blit!.dstY).toBe(0);    // 放到新画面 y=0
    expect(result.blit!.height).toBe(900); // 可复用 900px

    // 底部 100px 是新露出的内容，需要重绘
    expect(result.stripY).toBe(900);
    expect(result.stripHeight).toBe(100);
  });

  it('向上滚动：旧画面下移复用，顶部补画新条带', () => {
    const result = computeVerticalScrollBlit(200, 100, 1000);

    // blit: 把旧画面 [0, 900) 搬到 [100, 1000)（下移 100px）
    expect(result.blit!.srcY).toBe(0);
    expect(result.blit!.dstY).toBe(100);
    expect(result.blit!.height).toBe(900);

    // 顶部 100px 是新露出的，需要重绘
    expect(result.stripY).toBe(0);
    expect(result.stripHeight).toBe(100);
  });

  it('滚动距离超过视口高度时放弃 blit，全量重绘', () => {
    // 一次跳了 1200px，超过视口 1000px，没有任何像素可复用
    const result = computeVerticalScrollBlit(0, 1200, 1000);
    expect(result.blit).toBeNull();
    expect(result.stripY).toBe(0);
    expect(result.stripHeight).toBe(1000); // 整个视口都要重绘
  });

  it('滚动距离为零时也返回全量重绘（无意义的滚动）', () => {
    const result = computeVerticalScrollBlit(500, 500, 1000);
    expect(result.blit).toBeNull();
  });

  it('blit 区域 + 条带区域 = 完整视口', () => {
    // 不管怎么滚，复用区 + 补画区必须恰好覆盖整个视口，不能有遗漏
    const result = computeVerticalScrollBlit(0, 300, 1000);
    const blitHeight = result.blit!.height;
    expect(blitHeight + result.stripHeight).toBe(1000);
  });
});
