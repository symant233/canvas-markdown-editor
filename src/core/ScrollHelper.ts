export interface ScrollBlitInfo {
  /** 源区域在视口内的 Y 起点（逻辑像素） */
  srcY: number;
  /** 目标区域在视口内的 Y 起点（逻辑像素） */
  dstY: number;
  /** 可复用区域的高度（逻辑像素） */
  height: number;
}

export interface ScrollBlitResult {
  /** 可复用的像素搬运信息，null 表示需要全量重绘 */
  blit: ScrollBlitInfo | null;
  /** 需补画条带在视口内的 Y 起点（逻辑像素） */
  stripY: number;
  /** 需补画条带的高度（逻辑像素） */
  stripHeight: number;
}

/**
 * 纵向滚动时计算可复用像素区域和需要补画的条带。
 * 坐标为视口内逻辑像素（CSS px），不含 DPR。
 *
 * 几何示意（向下滚 deltaY）：
 *   旧视口:  [oldScrollY ─────────── oldScrollY + vpH]
 *   新视口:       [newScrollY ─────────── newScrollY + vpH]
 *   交集:         [newScrollY ─── oldScrollY + vpH]   ← blit 区
 *   新条带:                                   [oldScrollY + vpH ── newScrollY + vpH]
 */
export function computeVerticalScrollBlit(
  oldScrollY: number,
  newScrollY: number,
  viewportHeight: number,
): ScrollBlitResult {
  const deltaY = newScrollY - oldScrollY;
  const absDelta = Math.abs(deltaY);

  if (absDelta >= viewportHeight || absDelta === 0) {
    return { blit: null, stripY: 0, stripHeight: viewportHeight };
  }

  const overlapHeight = viewportHeight - absDelta;

  if (deltaY > 0) {
    return {
      blit: { srcY: absDelta, dstY: 0, height: overlapHeight },
      stripY: overlapHeight,
      stripHeight: absDelta,
    };
  }

  return {
    blit: { srcY: 0, dstY: absDelta, height: overlapHeight },
    stripY: 0,
    stripHeight: absDelta,
  };
}
