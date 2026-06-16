import { useEffect, useRef } from 'react';

type Props = {
  onDrag: (deltaPx: number) => void;
  onDragEnd?: () => void;
  onDoubleClick?: () => void;
  ariaValueNow?: number;
};

export function Splitter({ onDrag, onDragEnd, onDoubleClick, ariaValueNow }: Props) {
  const startX = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;
      startX.current = e.clientX;
      onDrag(dx);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onDragEnd?.();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onDrag, onDragEnd]);

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={ariaValueNow}
      tabIndex={0}
      onMouseDown={(e) => {
        dragging.current = true;
        startX.current = e.clientX;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onDrag(e.shiftKey ? -50 : -10);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onDrag(e.shiftKey ? 50 : 10);
        }
      }}
      title="拖动调整 · 双击重置 · 键盘 ← →"
    >
      <span />
    </div>
  );
}
