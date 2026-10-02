import { describe, expect, it } from 'vitest';
import { autoMask, geometryFromWheels, paintCircle, resizeAlpha } from '../src/pit/mask.ts';

/** A synthetic "photo": light grey backdrop with a shadow, a red car body with a white decal, two dark wheels. */
function scene(w = 240, h = 100) {
  const data = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * w + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // backdrop with a soft shadow band under the car
      const shadow = y > 70 && y < 82 && x > 40 && x < 200 ? 0.78 : 1;
      set(x, y, 232 * shadow, 234 * shadow, 238 * shadow);
    }
  }
  for (let y = 30; y < 70; y++) for (let x = 40; x < 200; x++) set(x, y, 210, 40, 40);
  for (let y = 42; y < 56; y++) for (let x = 100; x < 140; x++) set(x, y, 235, 235, 235); // white decal, same as backdrop
  for (let y = 60; y < 80; y++) for (let x = 55; x < 75; x++) set(x, y, 20, 20, 24);
  for (let y = 60; y < 80; y++) for (let x = 165; x < 185; x++) set(x, y, 20, 20, 24);
  return { width: w, height: h, data, colorSpace: 'srgb' as const } as ImageData;
}

describe('autoMask', () => {
  it('keeps the car (including a backdrop-coloured decal) and drops the backdrop and its shadow', () => {
    const img = scene();
    const alpha = autoMask(img, { tolerance: 45, feather: 1 });
    const at = (x: number, y: number) => alpha[y * img.width + x]!;
    expect(at(120, 50)).toBeGreaterThan(200); // decal inside the car stays
    expect(at(60, 45)).toBeGreaterThan(200); // red body
    expect(at(65, 70)).toBeGreaterThan(200); // wheel
    expect(at(10, 10)).toBe(0); // backdrop corner
    expect(at(120, 90)).toBe(0); // backdrop below
    expect(at(120, 76)).toBeLessThan(40); // the shadow band is treated as backdrop
  });

  it('a higher tolerance removes more, a lower one keeps more', () => {
    const img = scene();
    const loose = autoMask(img, { tolerance: 85, feather: 0 });
    const tight = autoMask(img, { tolerance: 15, feather: 0 });
    const opaque = (a: Uint8ClampedArray) => a.reduce((n, v) => n + (v > 128 ? 1 : 0), 0);
    expect(opaque(loose)).toBeLessThanOrEqual(opaque(tight));
  });
});

describe('autoMask with lighting and geometry', () => {
  /** Backdrop that fades from bright on the left to dim on the right, a red car, a warm shadow pooled under it. */
  function litScene(w = 240, h = 100) {
    const data = new Uint8ClampedArray(w * h * 4);
    const set = (x: number, y: number, r: number, g: number, b: number) => {
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = 1 - (x / w) * 0.4; // 240 -> 144 across the frame
        set(x, y, 236 * k, 232 * k, 226 * k);
      }
    }
    for (let y = 30; y < 70; y++) for (let x = 40; x < 200; x++) set(x, y, 210, 40, 40);
    // wheels, r = 10, centres y = 70 (bottom at 80)
    for (const cx of [65, 175]) for (let y = 60; y <= 80; y++) for (let x = cx - 10; x <= cx + 10; x++) if (Math.hypot(x - cx, y - 70) <= 10) set(x, y, 20, 20, 24);
    // a warm, dark shadow pooled under the car and touching the wheels
    for (let y = 72; y < 92; y++) for (let x = 55; x < 190; x++) set(x, y, 150, 120, 95);
    return { width: w, height: h, data, colorSpace: 'srgb' as const } as ImageData;
  }

  it('follows a lighting gradient: both ends of the backdrop go, the car stays', () => {
    const img = litScene();
    const alpha = autoMask(img, { tolerance: 45, feather: 0 });
    const at = (x: number, y: number) => alpha[y * img.width + x]!;
    expect(at(10, 10)).toBe(0);
    expect(at(230, 10)).toBe(0);
    expect(at(230, 90)).toBe(0);
    expect(at(120, 50)).toBe(255);
  });

  it('with the wheels known, the pooled shadow below the body is dropped and the wheels kept', () => {
    const img = litScene();
    const wheels = [
      { cx: 65, cy: 70, r: 10 },
      { cx: 175, cy: 70, r: 10 },
    ];
    const plain = autoMask(img, { tolerance: 45, feather: 0 });
    const withGeo = autoMask(img, { tolerance: 45, feather: 0, keep: wheels, geometry: geometryFromWheels(wheels[0]!, wheels[1]!) });
    const at = (a: Uint8ClampedArray, x: number, y: number) => a[y * img.width + x]!;
    expect(at(plain, 120, 85)).toBe(255); // colour alone keeps the shadow
    expect(at(withGeo, 120, 85)).toBe(0); // geometry drops it
    expect(at(withGeo, 65, 76)).toBe(255); // wheel stays
    expect(at(withGeo, 120, 50)).toBe(255); // body stays
  });
});

describe('autoMask learns the body colour', () => {
  it('keeps a bare-wood body on a cream backdrop when the wheels say where the body is', () => {
    const w = 240;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    const set = (x: number, y: number, r: number, g: number, b: number) => {
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, 232, 226, 214); // cream
    for (let y = 48; y < 70; y++) for (let x = 40; x < 200; x++) set(x, y, 214, 196, 150); // pale pine, close to cream
    for (const cx of [65, 175]) for (let y = 60; y <= 80; y++) for (let x = cx - 10; x <= cx + 10; x++) if (Math.hypot(x - cx, y - 70) <= 10) set(x, y, 20, 20, 24);
    const img = { width: w, height: h, data, colorSpace: 'srgb' as const } as ImageData;
    const wheels = [
      { cx: 65, cy: 70, r: 10 },
      { cx: 175, cy: 70, r: 10 },
    ];
    const plain = autoMask(img, { tolerance: 45, feather: 0 });
    const withGeo = autoMask(img, { tolerance: 45, feather: 0, keep: wheels, geometry: geometryFromWheels(wheels[0]!, wheels[1]!) });
    const at = (a: Uint8ClampedArray, x: number, y: number) => a[y * img.width + x]!;
    expect(at(plain, 120, 55)).toBe(0); // colour alone loses the wood
    expect(at(withGeo, 120, 55)).toBe(255); // learned body colour keeps it
    expect(at(withGeo, 120, 20)).toBe(0); // backdrop above still goes
    expect(at(withGeo, 10, 55)).toBe(0); // backdrop beside, outside the envelope, still goes
  });
});

describe('mask helpers', () => {
  it('resizes an alpha map and paints brush strokes', () => {
    const small = new Uint8ClampedArray([0, 255, 0, 255]);
    const big = resizeAlpha(small, 2, 2, 4, 4);
    expect(big.length).toBe(16);
    expect(big[0]).toBeLessThan(big[3]!);
    const a = new Uint8ClampedArray(100).fill(255);
    paintCircle(a, 10, 10, 5, 5, 2, 0);
    expect(a[5 * 10 + 5]).toBe(0);
    expect(a[0]).toBe(255);
    paintCircle(a, 10, 10, 5, 5, 3, 255);
    expect(a[5 * 10 + 5]).toBe(255);
  });
});
