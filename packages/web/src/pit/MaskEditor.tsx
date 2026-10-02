import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SIDE } from './geometry.ts';
import { autoMask, DEFAULT_MASK, geometryFromWheels, paintCircle, resizeAlpha } from './mask.ts';
import { detectWheels } from './wheels.ts';
import type { CropRect } from './photos.ts';

/** Working width for the automatic mask; the result is scaled up to the crop. */
const WORK_W = 480;

type Tool = 'none' | 'erase' | 'restore';

/**
 * Shows the cropped shot with its background removed. The pit crew can turn
 * the tolerance up or down and paint corrections, then keep the cutout (or
 * skip masking and keep just the photo).
 */
export function MaskEditor({
  img,
  crop,
  busy,
  onSave,
  onAdjustCrop,
  onRetake,
}: {
  img: HTMLImageElement;
  crop: CropRect;
  busy: boolean;
  onSave: (cutout: Blob | null) => void;
  onAdjustCrop: () => void;
  onRetake: () => void;
}) {
  const W = SIDE.width;
  const H = SIDE.height;
  const display = useRef<HTMLCanvasElement>(null);
  const [tolerance, setTolerance] = useState(DEFAULT_MASK.tolerance);
  const [tool, setTool] = useState<Tool>('none');
  const [brush, setBrush] = useState(40);
  const [version, setVersion] = useState(0);
  const alphaRef = useRef<Uint8ClampedArray | null>(null);
  const drawing = useRef(false);

  // The cropped pixels at output size, once.
  const base = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
    return { canvas: c, data: ctx.getImageData(0, 0, W, H) };
  }, [img, crop, W, H]);

  // A small copy for the automatic mask.
  const work = useMemo(() => {
    const ww = WORK_W;
    const wh = Math.round((H / W) * ww);
    const c = document.createElement('canvas');
    c.width = ww;
    c.height = wh;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(base.canvas, 0, 0, ww, wh);
    return { w: ww, h: wh, data: ctx.getImageData(0, 0, ww, wh) };
  }, [base, W, H]);

  // The wheels, when they can be found, are never cut away whatever the tolerance.
  const wheels = useMemo(() => detectWheels(work.data), [work]);

  // Recompute the automatic mask when tolerance changes (brush edits are discarded, by design).
  useEffect(() => {
    const keep = wheels ? [wheels.left, wheels.right].map((c) => ({ cx: c.cx, cy: c.cy, r: c.r * 0.96 })) : [];
    const geometry = wheels ? geometryFromWheels(wheels.left, wheels.right) : undefined;
    const small = autoMask(work.data, { ...DEFAULT_MASK, tolerance, keep, geometry });
    alphaRef.current = resizeAlpha(small, work.w, work.h, W, H);
    setVersion((v) => v + 1);
  }, [work, wheels, tolerance, W, H]);

  // Composite onto the display canvas.
  useEffect(() => {
    const el = display.current;
    const alpha = alphaRef.current;
    if (!el || !alpha) return;
    el.width = W;
    el.height = H;
    const ctx = el.getContext('2d')!;
    const out = ctx.createImageData(W, H);
    const src = base.data.data;
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      out.data[i] = src[i]!;
      out.data[i + 1] = src[i + 1]!;
      out.data[i + 2] = src[i + 2]!;
      out.data[i + 3] = alpha[p]!;
    }
    ctx.putImageData(out, 0, 0);
  }, [version, base, W, H]);

  const toCanvas = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const paint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const alpha = alphaRef.current;
    if (!alpha || tool === 'none') return;
    const { x, y } = toCanvas(e);
    paintCircle(alpha, W, H, x, y, brush * (W / 600), tool === 'erase' ? 0 : 255);
    setVersion((v) => v + 1);
  };

  const save = async () => {
    const alpha = alphaRef.current;
    if (!alpha) return onSave(null);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const out = ctx.createImageData(W, H);
    const src = base.data.data;
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      out.data[i] = src[i]!;
      out.data[i + 1] = src[i + 1]!;
      out.data[i + 2] = src[i + 2]!;
      out.data[i + 3] = alpha[p]!;
    }
    ctx.putImageData(out, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
    onSave(blob);
  };

  return (
    <div className="maskx">
      <p className="crop-hint">
        Background removed automatically. If part of the car is missing, slide left; if backdrop remains, slide right. Use the brushes for anything left.
        {wheels && <span className="pit-badge">Wheels found</span>}
      </p>
      <div className="maskx-stage">
        <canvas
          ref={display}
          className={`maskx-canvas tool-${tool}`}
          style={{ aspectRatio: `${W} / ${H}` }}
          onPointerDown={(e) => {
            if (tool === 'none') return;
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            paint(e);
          }}
          onPointerMove={(e) => drawing.current && paint(e)}
          onPointerUp={() => (drawing.current = false)}
          onPointerCancel={() => (drawing.current = false)}
        />
      </div>
      <label className="maskx-row">
        <span>Background tolerance</span>
        <input type="range" min={10} max={90} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
      </label>
      <div className="maskx-tools">
        <button className={`pbtn ${tool === 'none' ? 'is-active' : ''}`} onClick={() => setTool('none')}>
          Look
        </button>
        <button className={`pbtn ${tool === 'erase' ? 'is-active' : ''}`} onClick={() => setTool('erase')}>
          Erase backdrop
        </button>
        <button className={`pbtn ${tool === 'restore' ? 'is-active' : ''}`} onClick={() => setTool('restore')}>
          Restore car
        </button>
      </div>
      {tool !== 'none' && (
        <label className="maskx-row">
          <span>Brush size</span>
          <input type="range" min={10} max={120} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
        </label>
      )}
      <div className="pit-actions">
        <button className="pbtn pbtn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Use it'}
        </button>
        <button className="pbtn" onClick={() => onSave(null)} disabled={busy}>
          Keep photo, skip cutout
        </button>
        <button className="pbtn" onClick={onAdjustCrop} disabled={busy}>
          Adjust crop
        </button>
        <button className="pbtn" onClick={onRetake} disabled={busy}>
          Retake
        </button>
      </div>
    </div>
  );
}
