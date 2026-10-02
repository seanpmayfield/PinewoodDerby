import { AXLE_HEIGHT, WHEEL } from './geometry.ts';

/**
 * Background removal that runs on the phone with no model download.
 *
 * The check-in table has a plain backdrop, and the car is the only thing in
 * the frame that is not that backdrop. So: learn the backdrop colour from the
 * edges of the picture, mark every pixel close to it, flood that region in
 * from the edges (an enclosed patch of the same colour, like a white decal,
 * stays part of the car), keep the car as the big remaining blob, then soften
 * the edge. Shadows are handled by comparing chromaticity more than
 * brightness. The pit crew fixes anything left with a brush.
 */

export interface MaskOptions {
  /** 0..100. Higher removes more (treats more colours as background). */
  tolerance: number;
  /** Edge softness in pixels at the working resolution. */
  feather: number;
  /** Discs (in working pixels) that are always part of the car, such as detected wheels. */
  keep?: Circle[];
  /** Where the car can be, from the wheels: below the block's bottom face only the wheels are car. */
  geometry?: MaskGeometry;
}

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where the car is, worked out from its wheels, all in working pixels. */
export interface MaskGeometry {
  /** y of the block's bottom face (plus a margin): below it only the wheels are car. */
  bodyBottom: number;
  wheels: Circle[];
  /** A band just above the axles between the wheels that is body on every car: the colours learned here are "car". */
  core: Box;
  /** The block envelope (with overhang either way and room for a tall car): body colours are only trusted inside it. */
  envelope: Box;
}

/** The geometry above from a detected wheel pair, using the kit's real dimensions. */
export function geometryFromWheels(left: Circle, right: Circle): MaskGeometry {
  const ppi = ((left.r + right.r) / 2) / WHEEL.radius;
  const axle = (left.cy + right.cy) / 2;
  // The block's bottom face sits just above the axles (same depth as the near wheel, so
  // camera height does not move it); a small margin covers wheel wobble and a low-riding body.
  const bodyBottom = axle - AXLE_HEIGHT * ppi + 0.07 * ppi;
  return {
    bodyBottom,
    wheels: [left, right],
    core: { x0: left.cx + left.r * 1.2, x1: right.cx - right.r * 1.2, y0: bodyBottom - 0.5 * ppi, y1: bodyBottom - 0.1 * ppi },
    envelope: { x0: left.cx - 2.2 * ppi, x1: right.cx + 2.2 * ppi, y0: bodyBottom - 3.2 * ppi, y1: bodyBottom },
  };
}

export const DEFAULT_MASK: MaskOptions = { tolerance: 45, feather: 1.2 };

/** Alpha (0..255) per pixel for `img`, car opaque, backdrop transparent. */
export function autoMask(img: ImageData, opts: MaskOptions = DEFAULT_MASK): Uint8ClampedArray {
  const { width: w, height: h, data } = img;
  const n = w * h;

  // 1. The backdrop colour at every pixel, interpolated from the four edges, so a
  //    lighting gradient, a vignette or a warm corner is followed instead of fought.
  const bg = localBackdrop(data, w, h);

  // 2. Distance of every pixel from its local backdrop: chromaticity weighs most;
  //    darker than the backdrop (a shadow) counts less than brighter.
  const dist = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const sum = Math.max(1, r + g + b);
    const dr = r / sum - bg.r[p]!;
    const dg = g / sum - bg.g[p]!;
    const dl = sum / 3 - bg.l[p]!;
    dist[p] = Math.hypot(dr, dg) * 255 * 2.4 + (dl < 0 ? -dl * 0.3 : dl * 0.5);
  }
  const t = 14 + (opts.tolerance / 100) * 90;

  // 2b. The car's own colours, learned from the band above the axles, so bare wood on a
  //     cream backdrop (or a shadow-coloured body) is not mistaken for backdrop. Only trusted
  //     inside the block envelope; a table the colour of the car is still backdrop elsewhere.
  const geo = opts.geometry;
  const bodyLike = new Uint8Array(n);
  if (geo) {
    const centres = bodyColours(data, w, h, geo);
    if (centres.length) {
      const e = geo.envelope;
      for (let y = Math.max(0, Math.floor(e.y0)); y <= Math.min(h - 1, Math.ceil(e.y1)); y++) {
        for (let x = Math.max(0, Math.floor(e.x0)); x <= Math.min(w - 1, Math.ceil(e.x1)); x++) {
          const p = y * w + x;
          const i = p * 4;
          const r = data[i]!;
          const g = data[i + 1]!;
          const b = data[i + 2]!;
          const sum = Math.max(1, r + g + b);
          let best = Infinity;
          for (const c of centres) {
            const dd = Math.hypot((r / sum - c[0]) * 255 * 2.4, (g / sum - c[1]) * 255 * 2.4, (sum / 3 - c[2]) * 0.5);
            if (dd < best) best = dd;
          }
          if (best < Math.max(10, dist[p]! * 0.7)) bodyLike[p] = 1;
        }
      }
    }
  }

  // 3. Flood the backdrop in from the edges through "close to backdrop" pixels that do not look like the car.
  const isBg = new Uint8Array(n);
  const stack: number[] = [];
  const candidate = (p: number) => dist[p]! < t && !bodyLike[p];
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const p = y * w + x;
      if (candidate(p) && !isBg[p]) {
        isBg[p] = 1;
        stack.push(p);
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      const p = y * w + x;
      if (candidate(p) && !isBg[p]) {
        isBg[p] = 1;
        stack.push(p);
      }
    }
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (y > 0) visit(p - w);
    if (y < h - 1) visit(p + w);
  }
  function visit(q: number) {
    if (!isBg[q] && candidate(q)) {
      isBg[q] = 1;
      stack.push(q);
    }
  }

  // 3b. Geometry: the car sits on its wheels, so below the block's bottom face everything
  //     that is not a wheel is table and shadow, whatever colour it is.
  if (geo) {
    const discs = geo.wheels.map((c) => ({ ...c, r: c.r * 1.12 }));
    for (let y = Math.max(0, Math.ceil(geo.bodyBottom)); y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!discs.some((c) => Math.hypot(x - c.cx, y - c.cy) <= c.r)) isBg[y * w + x] = 1;
      }
    }
  }

  // 4. Foreground blobs: keep the biggest, anything at least 1.5% of the frame, and, when the
  //    car's place is known, anything at least 0.15% that sits on or above the car (a flag on a
  //    thin mast, a loose decoration past the block's end).
  const label = new Int32Array(n).fill(-1);
  const areas: number[] = [];
  const nearCar: boolean[] = [];
  const zone = geo ? { x0: geo.envelope.x0 - 0.5 * (geo.envelope.x1 - geo.envelope.x0) * 0.25, x1: geo.envelope.x1 + 0.5 * (geo.envelope.x1 - geo.envelope.x0) * 0.25, y1: geo.bodyBottom } : null;
  for (let p = 0; p < n; p++) {
    if (isBg[p] || label[p] !== -1) continue;
    const id = areas.length;
    let area = 0;
    let near = false;
    const q: number[] = [p];
    label[p] = id;
    while (q.length) {
      const c = q.pop()!;
      area++;
      const x = c % w;
      const y = (c - x) / w;
      if (zone && !near && y <= zone.y1 && x >= zone.x0 && x <= zone.x1) near = true;
      const nb = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1];
      for (const m of nb) {
        if (m >= 0 && !isBg[m] && label[m] === -1) {
          label[m] = id;
          q.push(m);
        }
      }
    }
    areas.push(area);
    nearCar.push(near);
  }
  const biggest = areas.length ? areas.indexOf(Math.max(...areas)) : -1;
  const minArea = n * 0.015;
  const minNear = n * 0.0015;
  const keep = new Uint8Array(areas.length);
  areas.forEach((a, id) => (keep[id] = id === biggest || a >= minArea || (nearCar[id] && a >= minNear) ? 1 : 0));

  const hard = new Uint8ClampedArray(n);
  for (let p = 0; p < n; p++) hard[p] = !isBg[p] && label[p]! >= 0 && keep[label[p]!] === 1 ? 255 : 0;
  for (const disc of opts.keep ?? []) paintCircle(hard, w, h, disc.cx, disc.cy, disc.r, 255);

  // 5. Erode a pixel (drops the backdrop-coloured fringe) then soften.
  const eroded = erode(hard, w, h);
  return blur(eroded, w, h, opts.feather);
}

/**
 * Up to three typical colours (r share, g share, brightness) of the band above the axles,
 * by a few rounds of k-means over a sample of its pixels, wheels excluded.
 */
function bodyColours(data: Uint8ClampedArray, w: number, h: number, geo: MaskGeometry): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const c = geo.core;
  const step = Math.max(1, Math.round(Math.sqrt(Math.max(1, ((c.x1 - c.x0) * (c.y1 - c.y0)) / 1500))));
  for (let y = Math.max(0, Math.floor(c.y0)); y <= Math.min(h - 1, Math.ceil(c.y1)); y += step) {
    for (let x = Math.max(0, Math.floor(c.x0)); x <= Math.min(w - 1, Math.ceil(c.x1)); x += step) {
      if (geo.wheels.some((wh) => Math.hypot(x - wh.cx, y - wh.cy) <= wh.r * 1.1)) continue;
      const i = (y * w + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const sum = Math.max(1, r + g + b);
      pts.push([r / sum, g / sum, sum / 3]);
    }
  }
  if (pts.length < 12) return [];
  const k = Math.min(3, pts.length);
  let centres = [0, 1, 2].slice(0, k).map((i) => pts[Math.floor((i + 0.5) * (pts.length / k))]!);
  const d2 = (a: [number, number, number], b: [number, number, number]) => Math.hypot((a[0] - b[0]) * 255 * 2.4, (a[1] - b[1]) * 255 * 2.4, (a[2] - b[2]) * 0.5);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let bi = 0;
      let bd = Infinity;
      centres.forEach((cc, i) => {
        const dd = d2(p, cc);
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      });
      const s = sums[bi]!;
      s[0] = s[0]! + p[0];
      s[1] = s[1]! + p[1];
      s[2] = s[2]! + p[2];
      s[3] = s[3]! + 1;
    }
    centres = sums.map((s, i) => (s[3] ? ([s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!] as [number, number, number]) : centres[i]!));
  }
  return centres;
}

/**
 * Backdrop colour per pixel: chromaticity (r, g shares) and brightness, from the
 * median of a ring at each edge, smoothed along the edge and blended across the
 * picture by distance to the four edges.
 */
function localBackdrop(data: Uint8ClampedArray, w: number, h: number): { r: Float32Array; g: Float32Array; l: Float32Array } {
  const ring = Math.max(4, Math.round(Math.min(w, h) * 0.04));
  const sample = (px: number[]): [number, number, number] => {
    const rs: number[] = [];
    const gs: number[] = [];
    const ls: number[] = [];
    for (const p of px) {
      const i = p * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const sum = Math.max(1, r + g + b);
      rs.push(r / sum);
      gs.push(g / sum);
      ls.push(sum / 3);
    }
    return [median(rs), median(gs), median(ls)];
  };
  const top: [number, number, number][] = [];
  const bottom: [number, number, number][] = [];
  const left: [number, number, number][] = [];
  const right: [number, number, number][] = [];
  for (let x = 0; x < w; x++) {
    const t: number[] = [];
    const b: number[] = [];
    for (let y = 0; y < ring; y++) {
      t.push(y * w + x);
      b.push((h - 1 - y) * w + x);
    }
    top.push(sample(t));
    bottom.push(sample(b));
  }
  for (let y = 0; y < h; y++) {
    const l: number[] = [];
    const r: number[] = [];
    for (let x = 0; x < ring; x++) {
      l.push(y * w + x);
      r.push(y * w + (w - 1 - x));
    }
    left.push(sample(l));
    right.push(sample(r));
  }
  // Smooth along each edge so a wheel or a prop touching the edge does not dent the estimate.
  const smooth = (arr: [number, number, number][]): [number, number, number][] => {
    const win = Math.max(4, Math.round(arr.length / 12));
    return arr.map((_, i) => {
      const slice = arr.slice(Math.max(0, i - win), Math.min(arr.length, i + win + 1));
      return [median(slice.map((v) => v[0])), median(slice.map((v) => v[1])), median(slice.map((v) => v[2]))];
    });
  };
  const T = smooth(top);
  const B = smooth(bottom);
  const L = smooth(left);
  const R = smooth(right);
  const n = w * h;
  const out = { r: new Float32Array(n), g: new Float32Array(n), l: new Float32Array(n) };
  for (let y = 0; y < h; y++) {
    const ty = h > 1 ? y / (h - 1) : 0.5;
    for (let x = 0; x < w; x++) {
      const tx = w > 1 ? x / (w - 1) : 0.5;
      const p = y * w + x;
      for (const [k, ch] of (['r', 'g', 'l'] as const).entries()) {
        out[ch][p] = ((1 - ty) * T[x]![k]! + ty * B[x]![k]! + (1 - tx) * L[y]![k]! + tx * R[y]![k]!) / 2;
      }
    }
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function erode(a: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!a[p]) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (edge || (a[p - 1] && a[p + 1] && a[p - w] && a[p + w])) out[p] = 255;
    }
  }
  return out;
}

/** Separable box blur, radius in pixels (fractional radii blend two sizes). */
function blur(a: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return a;
  const tmp = new Float32Array(a.length);
  const out = new Uint8ClampedArray(a.length);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += a[y * w + clamp(x, 0, w - 1)]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / k;
      acc += a[y * w + clamp(x + r + 1, 0, w - 1)]! - a[y * w + clamp(x - r, 0, w - 1)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k;
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x]! - tmp[clamp(y - r, 0, h - 1) * w + x]!;
    }
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Scale an alpha map to another size with bilinear sampling. */
export function resizeAlpha(alpha: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = clamp(Math.floor(fy), 0, sh - 1);
    const y1 = clamp(y0 + 1, 0, sh - 1);
    const wy = clamp(fy - y0, 0, 1);
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = clamp(Math.floor(fx), 0, sw - 1);
      const x1 = clamp(x0 + 1, 0, sw - 1);
      const wx = clamp(fx - x0, 0, 1);
      const a = alpha[y0 * sw + x0]! * (1 - wx) + alpha[y0 * sw + x1]! * wx;
      const b = alpha[y1 * sw + x0]! * (1 - wx) + alpha[y1 * sw + x1]! * wx;
      out[y * dw + x] = a * (1 - wy) + b * wy;
    }
  }
  return out;
}

/** Paint a soft circle of `value` (0 or 255) into an alpha map. */
export function paintCircle(alpha: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, radius: number, value: number): void {
  const r2 = radius * radius;
  const soft = Math.max(1, radius * 0.25);
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(h - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(w - 1, Math.ceil(cx + radius)); x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      const k = d > radius - soft ? (radius - d) / soft : 1;
      const p = y * w + x;
      alpha[p] = value === 255 ? Math.max(alpha[p]!, 255 * k) : Math.min(alpha[p]!, 255 * (1 - k));
    }
  }
}
