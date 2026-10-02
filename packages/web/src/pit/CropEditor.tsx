import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CropRect } from './photos.ts';
import { SIDE, SIDE_GUIDE, SIDE_HINT } from './geometry.ts';
import { suggestSideCrop } from './wheels.ts';

/**
 * Pan and pinch the photo under the side outline so every car comes out the
 * same size and facing the same way on the big screen. The wheels are found
 * first and the picture is scaled and placed to match the frame exactly;
 * the pit crew only adjusts if that looks wrong.
 */
export function CropEditor({ img, onSave, onCancel, busy }: { img: HTMLImageElement; onSave: (crop: CropRect) => void; onCancel: () => void; busy: boolean }) {
  const aspect = SIDE.width / SIDE.height;
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ scale: 1, x: 0, y: 0, minScale: 1 });
  const [auto, setAuto] = useState<'wheels' | 'manual' | 'none'>('none');
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const suggestion = useMemo(() => suggestSideCrop(img, SIDE), [img]);

  /** The view that shows exactly `crop` inside a frame `w` wide. */
  const viewFor = (crop: CropRect, w: number, minScale: number) => {
    const scale = w / crop.sw;
    return { scale, x: -crop.sx * scale, y: -crop.sy * scale, minScale };
  };

  // Fit the image to the frame once we know the frame size: on the wheels when found, otherwise covering the frame.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = w / aspect;
      setFrame({ w, h });
      const minScale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      if (suggestion) {
        setView(viewFor(suggestion.crop, w, minScale));
        setAuto('wheels');
      } else {
        setView({ scale: minScale, x: (w - img.naturalWidth * minScale) / 2, y: (h - img.naturalHeight * minScale) / 2, minScale });
        setAuto('none');
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [img, aspect, suggestion]);

  const clamp = (scale: number, x: number, y: number) => {
    const s = Math.max(view.minScale, Math.min(view.minScale * 6, scale));
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    return { scale: s, x: Math.min(0, Math.max(frame.w - w, x)), y: Math.min(0, Math.max(frame.h - h, y)) };
  };

  const zoomAt = (factor: number, cx: number, cy: number) => {
    setView((v) => {
      const scale = v.scale * factor;
      const ratio = scale / v.scale;
      const next = clamp(scale, cx - (cx - v.x) * ratio, cy - (cy - v.y) * ratio);
      return { ...next, minScale: v.minScale };
    });
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (auto === 'wheels') setAuto('manual');
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: view.x, y: view.y };
    } else {
      gesture.current = { dist: 0, scale: view.scale, cx: e.clientX, cy: e.clientY, x: view.x, y: view.y };
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = frameRef.current!.getBoundingClientRect();
      const scale = (g.scale * dist) / Math.max(1, g.dist);
      const ratio = scale / g.scale;
      const cx = g.cx - rect.left;
      const cy = g.cy - rect.top;
      const mx = (a.x + b.x) / 2 - g.cx;
      const my = (a.y + b.y) / 2 - g.cy;
      setView((v) => ({ ...clamp(scale, cx - (cx - g.x) * ratio + mx, cy - (cy - g.y) * ratio + my), minScale: v.minScale }));
    } else {
      setView((v) => ({ ...clamp(v.scale, g.x + (e.clientX - g.cx), g.y + (e.clientY - g.cy)), minScale: v.minScale }));
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      const p = pts[0]!;
      gesture.current = { dist: 0, scale: view.scale, cx: p.x, cy: p.y, x: view.x, y: view.y };
    } else if (pts.length === 0) {
      gesture.current = null;
    }
  };

  const save = () => {
    onSave({ sx: -view.x / view.scale, sy: -view.y / view.scale, sw: frame.w / view.scale, sh: frame.h / view.scale });
  };

  return (
    <div className="crop">
      <p className="crop-hint">
        {auto === 'wheels' ? (
          <>
            <span className="pit-badge">Wheels found</span>{' '}
            {suggestion?.exact
              ? 'Scaled and placed to match every other car. Drag or zoom only if it looks wrong.'
              : 'The car fills the picture, so it is placed as close to standard as it can be; step back a little next time. Drag or zoom only if it looks wrong.'}
          </>
        ) : (
          <>
            Drag to position, pinch or use the slider to zoom. {SIDE_HINT}.
            {!suggestion && ' The wheels were not found in this picture, so line them up with the circles by hand.'}
          </>
        )}
        {auto === 'manual' && suggestion && (
          <button
            className="pit-link"
            onClick={() => {
              setView((v) => viewFor(suggestion.crop, frame.w, v.minScale));
              setAuto('wheels');
            }}
          >
            Back to the wheel fit
          </button>
        )}
      </p>
      <div
        ref={frameRef}
        className="crop-frame"
        style={{ height: frame.h || undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          const rect = frameRef.current!.getBoundingClientRect();
          zoomAt(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - rect.left, e.clientY - rect.top);
        }}
      >
        <img
          src={img.src}
          alt=""
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, width: img.naturalWidth, height: img.naturalHeight }}
        />
        <svg className="crop-guide" viewBox={SIDE_GUIDE.viewBox} preserveAspectRatio="none">
          {SIDE_GUIDE.paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
      </div>
      <input
        className="crop-zoom"
        type="range"
        min={1}
        max={6}
        step={0.01}
        value={view.scale / (view.minScale || 1)}
        onChange={(e) => {
          if (auto === 'wheels') setAuto('manual');
          const target = Number(e.target.value) * view.minScale;
          zoomAt(target / view.scale, frame.w / 2, frame.h / 2);
        }}
      />
      <div className="pit-actions">
        <button className="pbtn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="pbtn pbtn-primary" onClick={save} disabled={busy || frame.w === 0}>
          Use this photo
        </button>
      </div>
    </div>
  );
}
