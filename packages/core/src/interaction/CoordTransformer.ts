/**
 * 在浏览器视口坐标和编辑器场景坐标之间转换，整合滚动偏移。
 */
export class CoordTransformer {
  private scrollY = 0;
  private containerRect: DOMRect | null = null;

  setScrollY(y: number) {
    this.scrollY = y;
  }

  getScrollY(): number {
    return this.scrollY;
  }

  updateContainerRect(rect: DOMRect) {
    this.containerRect = rect;
  }

  /** 浏览器坐标减去容器偏移再加滚动量 = 场景坐标 */
  browserToScene(clientX: number, clientY: number): { sceneX: number; sceneY: number } {
    const rect = this.containerRect;
    if (!rect) return { sceneX: clientX, sceneY: clientY };

    return {
      sceneX: clientX - rect.left,
      sceneY: clientY - rect.top + this.scrollY,
    };
  }

  /** 反向转换：场景坐标 -> 浏览器坐标 */
  sceneToBrowser(sceneX: number, sceneY: number): { clientX: number; clientY: number } {
    const rect = this.containerRect;
    if (!rect) return { clientX: sceneX, clientY: sceneY };

    return {
      clientX: sceneX + rect.left,
      clientY: sceneY - this.scrollY + rect.top,
    };
  }

  /** 判断场景中的元素（给定 sceneY 与 height）是否在当前视口内可见 */
  isInViewport(sceneY: number, height: number, viewportHeight: number): boolean {
    return sceneY + height >= this.scrollY && sceneY <= this.scrollY + viewportHeight;
  }

  /** 将滚动量钳制到合法范围 [0, maxContentHeight - viewportHeight + 40] */
  clampScroll(maxContentHeight: number, viewportHeight: number): number {
    const maxScroll = Math.max(0, maxContentHeight - viewportHeight + 40);
    this.scrollY = Math.max(0, Math.min(maxScroll, this.scrollY));
    return this.scrollY;
  }
}
