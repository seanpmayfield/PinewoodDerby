/** Renders the program icon (a yellow car on a blue checkered tile) to installer/derby.ico without a browser: `node tools/make-icon.mjs`. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BLUE = hex('#1b7cf0');
const NAVY = hex('#0b2a5b');
const YELLOW = hex('#ffd21f');
const HUB = hex('#cdd9e8');

// Car body outline, in a 256-unit square (same shape as the SVG the audience uses).
const BODY = [
  [40, 160], [40, 138], [48, 124], [96, 108], [128, 78], [140, 71], [196, 70], [210, 76], [216, 90], [220, 160],
];
const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const distToSeg = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
};
const nearEdge = (x, y, poly, w) => poly.some((p, i) => distToSeg(x, y, p, poly[(i + 1) % poly.length]) <= w);
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return Math.hypot(x - cx, y - cy) <= r;
};

/** Colour and alpha at a point of the 256-unit design. */
function sample(x, y) {
  if (!inRoundRect(x, y, 8, 8, 248, 248, 52)) return [0, 0, 0, 0];
  let c = BLUE;
  if ((Math.floor((x - 8) / 30) + Math.floor((y - 8) / 30)) % 2) c = c.map((v) => Math.round(v + (255 - v) * 0.16));
  for (const [cx, cy] of [[84, 168], [180, 168]]) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= 10) return [...HUB, 255];
    if (d <= 26) return [...NAVY, 255];
  }
  if (nearEdge(x, y, BODY, 5)) return [...NAVY, 255];
  if (inPoly(x, y, BODY)) return [...YELLOW, 255];
  return [...c, 255];
}

function render(size) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = sample(((i + (sx + 0.5) / ss) * 256) / size, ((j + (sy + 0.5) / ss) * 256) / size);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const o = (j * size + i) * 4;
      if (a) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
        px[o + 3] = Math.round(a / (ss * ss));
      }
    }
  }
  return png(size, size, px);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const sizes = [256, 64, 48, 32, 16];
const images = sizes.map(render);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size, i) => {
  const e = Buffer.alloc(16);
  e[0] = size === 256 ? 0 : size;
  e[1] = size === 256 ? 0 : size;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
const out = path.resolve('installer/derby.ico');
writeFileSync(out, Buffer.concat([header, ...entries, ...images]));
console.log('wrote', out);
