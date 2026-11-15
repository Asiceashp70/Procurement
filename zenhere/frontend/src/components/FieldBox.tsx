import { useRef, type ReactNode } from 'react';

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A draggable, resizable box on a page overlay (mouse and touch via pointer events). */
export function FieldBox({
  g,
  color,
  selected,
  pageSize,
  onSelect,
  onChange,
  children,
}: {
  g: Geometry;
  color: string;
  selected: boolean;
  pageSize: { width: number; height: number };
  onSelect: () => void;
  onChange: (g: Partial<Geometry>) => void;
  children: ReactNode;
}) {
  const start = useRef<{ px: number; py: number; g: Geometry; mode: 'move' | 'resize' } | null>(null);
  const minW = 12 / pageSize.width;
  const minH = 10 / pageSize.height;

  const down = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, g, mode };
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = (e.clientX - s.px) / pageSize.width;
    const dy = (e.clientY - s.py) / pageSize.height;
    if (s.mode === 'move') onChange({ x: clamp(s.g.x + dx, 0, 1 - s.g.w), y: clamp(s.g.y + dy, 0, 1 - s.g.h) });
    else onChange({ w: clamp(s.g.w + dx, minW, 1 - s.g.x), h: clamp(s.g.h + dy, minH, 1 - s.g.y) });
  };
  const up = () => {
    start.current = null;
  };

  return (
    <div
      className={`field-box ${selected ? 'selected' : ''}`}
      style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%`, width: `${g.w * 100}%`, height: `${g.h * 100}%`, ['--c' as string]: color }}
      onPointerDown={(e) => down(e, 'move')}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {children}
      {selected && <span className="handle" onPointerDown={(e) => down(e, 'resize')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />}
    </div>
  );
}
