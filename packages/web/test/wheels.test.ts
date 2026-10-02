import { describe, expect, it } from 'vitest';
import { cropFromWheels, detectWheels } from '../src/pit/wheels.ts';
import { SIDE, WHEEL, WHEELBASE } from '../src/pit/geometry.ts';

/** A synthetic side-on photo: light backdrop, a red wedge, and two black wheels sized like the real ones. */
function scene(opts: { pxPerInch: number; leftX: number; groundY: number; width?: number; height?: number; wheels?: number; tilt?: number }) {
  const w = opts.width ?? 400;
  const h = opts.height ?? 220;
  const data = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, 228, 230, 236);
  const r = WHEEL.radius * opts.pxPerInch;
  const span = WHEELBASE * opts.pxPerInch;
  const cy = opts.groundY - r;
  const centres = [
    { cx: opts.leftX, cy },
    { cx: opts.leftX + span, cy: cy + (opts.tilt ?? 0) },
  ].slice(0, opts.wheels ?? 2);
  // body: a wedge sitting on the axles
  const bodyTop = cy - 1.2 * opts.pxPerInch;
  for (let y = Math.round(bodyTop); y < cy; y++) {
    for (let x = Math.round(opts.leftX - 1.5 * opts.pxPerInch); x < opts.leftX + span + 0.9 * opts.pxPerInch; x++) set(x, y, 200, 40, 40);
  }
  for (const c of centres) {
    for (let y = Math.floor(c.cy - r); y <= Math.ceil(c.cy + r); y++) {
      for (let x = Math.floor(c.cx - r); x <= Math.ceil(c.cx + r); x++) {
        if (Math.hypot(x - c.cx, y - c.cy) <= r) set(x, y, 18, 18, 22);
      }
    }
  }
  return { width: w, height: h, data };
}

describe('detectWheels', () => {
  it('finds both wheels, their size and their spacing', () => {
    const img = scene({ pxPerInch: 30, leftX: 110, groundY: 180 });
    const found = detectWheels(img);
    expect(found).not.toBeNull();
    const r = WHEEL.radius * 30;
    expect(found!.left.cx).toBeCloseTo(110, 0);
    expect(found!.right.cx).toBeCloseTo(110 + WHEELBASE * 30, 0);
    expect(found!.left.cy).toBeCloseTo(180 - r, 0);
    expect(Math.abs(found!.left.r - r)).toBeLessThan(1.5);
  });

  it('still works when the car is small in the frame, and gives up with one wheel or a tilted pair', () => {
    expect(detectWheels(scene({ pxPerInch: 18, leftX: 150, groundY: 150 }))).not.toBeNull();
    expect(detectWheels(scene({ pxPerInch: 30, leftX: 110, groundY: 180, wheels: 1 }))).toBeNull();
    expect(detectWheels(scene({ pxPerInch: 30, leftX: 110, groundY: 180, tilt: 40 }))).toBeNull();
  });
});

describe('cropFromWheels', () => {
  it('scales and places the crop so the wheels land on the standard frame', () => {
    const wheels = { left: { cx: 300, cy: 500, r: 50 }, right: { cx: 300 + 7.376 * 50, cy: 500, r: 50 } };
    const fit = cropFromWheels(wheels, { width: 2000, height: 1200 }, SIDE)!;
    expect(fit.exact).toBe(true);
    const crop = fit.crop;
    const scale = SIDE.width / crop.sw;
    expect((wheels.left.cx - crop.sx) * scale).toBeCloseTo(SIDE.left.cx, 0);
    expect((wheels.right.cx - crop.sx) * scale).toBeCloseTo(SIDE.right.cx, 0);
    expect((wheels.left.cy - crop.sy) * scale).toBeCloseTo(SIDE.left.cy, 0);
    expect(wheels.left.r * scale).toBeCloseTo(SIDE.left.r, 0);
  });

  it('slides the frame to stay inside the picture, and shrinks it when the car fills the picture', () => {
    const near = { left: { cx: 60, cy: 100, r: 50 }, right: { cx: 60 + 7.376 * 50, cy: 100, r: 50 } };
    const slid = cropFromWheels(near, { width: 1200, height: 800 }, SIDE)!;
    expect(slid.exact).toBe(true);
    expect(slid.crop.sx).toBe(0);
    expect(slid.crop.sy).toBe(0);
    const tight = cropFromWheels(near, { width: 500, height: 300 }, SIDE)!;
    expect(tight.exact).toBe(false);
    expect(tight.crop.sw).toBeLessThanOrEqual(500);
    expect(tight.crop.sh).toBeLessThanOrEqual(300);
  });
});
