import { useRef } from 'react';

interface ScrollbarProps {
  scrollY: number;
  contentHeight: number;
  viewportHeight: number;
  onScroll: (scrollY: number) => void;
}

/**
 * 自定义滚动条组件。
 * ratio = viewport/content 决定滑块高度（至少 30px），
 * 拖拽通过 setPointerCapture 实现平滑拖动，点击轨道跳转到对应位置。
 */
export function Scrollbar({ scrollY, contentHeight, viewportHeight, onScroll }: ScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ mouseY: 0, scrollY: 0 });

  if (contentHeight <= viewportHeight) return null;

  const ratio = viewportHeight / contentHeight;
  const thumbHeight = Math.max(30, viewportHeight * ratio);
  const maxThumbTop = viewportHeight - thumbHeight;
  const maxScroll = contentHeight - viewportHeight;
  const thumbTop = maxScroll > 0 ? (scrollY / maxScroll) * maxThumbTop : 0;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = true;
    dragStartRef.current = { mouseY: e.clientY, scrollY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const deltaY = e.clientY - dragStartRef.current.mouseY;
    const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
    const newScroll = Math.max(0, Math.min(maxScroll, dragStartRef.current.scrollY + scrollDelta));
    onScroll(newScroll);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (e.target !== trackRef.current) return;
    const rect = trackRef.current!.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const targetScroll = (clickY / viewportHeight) * maxScroll;
    onScroll(Math.max(0, Math.min(maxScroll, targetScroll)));
  };

  return (
    <div className="scrollbar-track" ref={trackRef} onClick={handleTrackClick}>
      <div
        className="scrollbar-thumb"
        style={{ top: thumbTop, height: thumbHeight }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
