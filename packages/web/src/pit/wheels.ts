import { WHEEL, WHEELBASE, type Circle } from './geometry.ts';
import type { SideFrame } from './geometry.ts';
import type { CropRect } from './photos.ts';

/**
 * Find the two wheels in a side-on car photo. Every car has the same wheels
 * at the same spacing, so once they are found the picture can be scaled and
 * placed exactly like every other car's.
 *
 * No model download. Wheels are near-black, colourless discs: the distance
 * transform of the "dark" pixels peaks at the centre of a disc with a value
 * of its radius, so the peaks of the right size are wheel candidates (a thin
 * shadow or a dark floor joining a wheel does not move its peak). Each
 * candidate is checked for being a full disc with a clear edge above it, then
 * the pair spaced like a wheelbase and level with each other wins. A car with
 * black bodywork wrapping the wheels, or odd wheels, is simply not detected
 * and the crop stays manual.
 */

export interface WheelPair {
  left: Circle;
  right: Circle;
}

interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface WheelDebug {
  dark: number;
  bg: number;
  peaks: Circle[];
  /** Per peak: how much of the disc is dark, how much of the arc above it is, and the dark depth just past its sides (in radii). */
  checks: { peak: Circle; inside: number; above: number; sides: number }[];
  candidates: Circle[];
}

/** Centre distance divided by radius, for the real car. */
const SPACING = WHEELBASE / WHEEL.radius;

export function detectWheels(img: Pixels, debug?: (info: WheelDebug) => void): WheelPair | null {
  const { width: w, height: h, data } = img;
  const n = w * h;

  // 1. Which pixels could be wheel: near-black and colourless, judged against the backdrop (edge ring) brightness.
  const luma = new Uint8Array(n);
  const grey = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    luma[p] = (r * 299 + g * 587 + b * 114) / 1000;
    grey[p] = Math.max(r, g, b) - Math.min(r, g, b) < 56 ? 1 : 0;
  }
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const edge: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < ring || y < ring || x >= w - ring || y >= h - ring) edge.push(luma[y * w + x]!);
  edge.sort((a, b) => a - b);
  const bg = edge[edge.length >> 1] ?? 200;
  const dark = Math.max(36, Math.min(60, bg * 0.35));
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = luma[p]! < dark && grey[p] === 1 ? 1 : 0;

  // A wheel with a light hub is a dark ring; fill every enclosed hole so it becomes a solid disc.
  // (Flood the non-dark area from the frame edge; whatever non-dark is left is enclosed.)
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const seed = (p: number) => {
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }
  for (let p = 0; p < n; p++) if (!mask[p] && !outside[p]) mask[p] = 1;

  // 2. Distance to the nearest non-dark pixel (chamfer 3-4, scaled back to pixels).
  const INF = 1 << 20;
  const d = new Int32Array(n);
  for (let p = 0; p < n; p++) d[p] = mask[p] ? INF : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!d[p]) continue;
      let v = d[p]!;
      if (x > 0) v = Math.min(v, d[p - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, d[p - w]! + 3);
        if (x > 0) v = Math.min(v, d[p - w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, d[p - w + 1]! + 4);
      }
      if (x === 0 || y === 0) v = Math.min(v, 3); // the frame edge counts as "outside"
      d[p] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (!d[p]) continue;
      let v = d[p]!;
      if (x < w - 1) v = Math.min(v, d[p + 1]! + 3);
      if (y < h - 1) {
        v = Math.min(v, d[p + w]! + 3);
        if (x > 0) v = Math.min(v, d[p + w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, d[p + w + 1]! + 4);
      }
      if (x === w - 1 || y === h - 1) v = Math.min(v, 3);
      d[p] = v;
    }
  }

  // 3. Peaks of the right size: a disc of radius r has a peak of about r at its centre.
  const rMin = w * 0.02;
  const rMax = w * 0.12;
  const peaks: Circle[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const r = d[p]! / 3;
      if (r < rMin || r > rMax) continue;
      const win = Math.max(2, Math.round(r * 0.6));
      let isPeak = true;
      for (let dy = -win; dy <= win && isPeak; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -win; dx <= win; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (d[yy * w + xx]! > d[p]!) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) peaks.push({ cx: x, cy: y, r });
    }
  }
  // Keep one peak per disc (the strongest within a radius).
  peaks.sort((a, b) => b.r - a.r);
  const kept: Circle[] = [];
  for (const p of peaks) if (!kept.some((k) => Math.hypot(k.cx - p.cx, k.cy - p.cy) < Math.max(k.r, p.r))) kept.push(p);

  // 4. A wheel is a full dark disc that ends at its rim: just past the rim on either side the
  //    distance to non-dark drops to nothing (a dark bar keeps a high value along its length;
  //    a wheel joined to a dark body does too). The arc above the rim must be mostly clear.
  const candidates: Circle[] = [];
  const checks: WheelDebug['checks'] = [];
  const at = (x: number, y: number) => {
    const xx = Math.round(x);
    const yy = Math.round(y);
    return xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : d[yy * w + xx]! / 3;
  };
  for (const c of kept) {
    let inside = 0;
    let insideDark = 0;
    let above = 0;
    let aboveDark = 0;
    const span = Math.ceil(c.r * 1.45);
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const x = Math.round(c.cx + dx);
        const y = Math.round(c.cy + dy);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const dist = Math.hypot(dx, dy);
        const m = mask[y * w + x]!;
        if (dist <= c.r * 0.9) {
          inside++;
          insideDark += m;
        } else if (dist >= c.r * 1.2 && dist <= c.r * 1.45 && dy < -c.r * 0.35) {
          above++;
          aboveDark += m;
        }
      }
    }
    const sides = Math.max(at(c.cx - 1.3 * c.r, c.cy), at(c.cx + 1.3 * c.r, c.cy), at(c.cx - 1.3 * c.r, c.cy - 0.4 * c.r), at(c.cx + 1.3 * c.r, c.cy - 0.4 * c.r)) / c.r;
    const stats = { inside: inside ? insideDark / inside : 0, above: above ? aboveDark / above : 1, sides };
    checks.push({ peak: c, ...stats });
    if (stats.inside >= 0.85 && stats.above <= 0.5 && stats.sides <= 0.75) candidates.push(c);
  }
  debug?.({ dark, bg, peaks: kept, checks, candidates });

  // 5. The best-matching pair: level, similar size, spaced like a wheelbase.
  let best: { score: number; pair: WheelPair } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      const rAvg = (a.r + b.r) / 2;
      const sizeDiff = Math.abs(a.r - b.r) / rAvg;
      if (sizeDiff > 0.35) continue;
      const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      const spacing = dist / rAvg;
      if (spacing < 5.5 || spacing > 9.5) continue;
      const tilt = Math.abs(a.cy - b.cy) / dist;
      if (tilt > 0.2) continue; // a little perspective is normal; more means it is not a wheel pair
      const score = Math.abs(spacing - SPACING) / SPACING + sizeDiff * 0.5 + tilt;
      if (!best || score < best.score) {
        const [left, right] = a.cx < b.cx ? [a, b] : [b, a];
        best = { score, pair: { left: { ...left, r: rAvg }, right: { ...right, r: rAvg } } };
      }
    }
  }
  return best?.pair ?? null;
}

/**
 * The crop of the source image that puts these wheels exactly where the
 * standard side frame has them. `wheels` are in source pixels. When the car
 * fills the picture so the standard frame would reach past its edges, the
 * frame is shrunk just enough to fit and `exact` is false: the car comes out
 * a little larger than standard rather than with blank padding.
 */
export function cropFromWheels(wheels: WheelPair, source: { width: number; height: number }, frame: SideFrame): { crop: CropRect; exact: boolean } | null {
  const dist = Math.hypot(wheels.right.cx - wheels.left.cx, wheels.right.cy - wheels.left.cy);
  if (dist <= 0) return null;
  let scale = (frame.right.cx - frame.left.cx) / dist; // frame px per source px
  let exact = true;
  const minScale = Math.max(frame.width / source.width, frame.height / source.height);
  if (scale < minScale) {
    scale = minScale;
    exact = false;
  }
  const sw = frame.width / scale;
  const sh = frame.height / scale;
  const midX = (wheels.left.cx + wheels.right.cx) / 2;
  const midY = (wheels.left.cy + wheels.right.cy) / 2;
  let sx = midX - frame.width / 2 / scale;
  let sy = midY - frame.left.cy / scale;
  sx = Math.max(0, Math.min(source.width - sw, sx));
  sy = Math.max(0, Math.min(source.height - sh, sy));
  return { crop: { sx, sy, sw, sh }, exact };
}

/** Working width for detection; enough for a wheel to be a dozen pixels across. */
const WORK_W = 420;

/** Read a browser image at working size. */
function workingPixels(img: HTMLImageElement | HTMLCanvasElement, width = WORK_W): Pixels {
  const srcW = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const srcH = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const w = Math.min(width, srcW);
  const h = Math.max(1, Math.round((srcH / srcW) * w));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Find the wheels in a photo and propose the standard crop around them. Browser only. */
export function suggestSideCrop(img: HTMLImageElement, frame: SideFrame): { crop: CropRect; wheels: WheelPair; exact: boolean } | null {
  const work = workingPixels(img);
  const found = detectWheels(work);
  if (!found) return null;
  const k = img.naturalWidth / work.width;
  const wheels: WheelPair = {
    left: { cx: found.left.cx * k, cy: found.left.cy * k, r: found.left.r * k },
    right: { cx: found.right.cx * k, cy: found.right.cy * k, r: found.right.r * k },
  };
  const fit = cropFromWheels(wheels, { width: img.naturalWidth, height: img.naturalHeight }, frame);
  return fit ? { crop: fit.crop, wheels, exact: fit.exact } : null;
}
