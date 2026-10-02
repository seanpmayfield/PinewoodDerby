/**
 * The real car, in inches, from the scale model of the kit block and wheels
 * (`derby car.STEP`). Every outline, crop frame and silhouette is derived
 * from these numbers so photos of different cars come out at the same scale.
 */

/** The block the cars are carved from. */
const BLOCK = { length: 7, width: 1.75, height: 1.26 };
export const WHEEL = { radius: 0.5925, width: 0.385 };
/** Distance between the axles. */
export const WHEELBASE = 4.37;
/** Axle centre above the bottom face of the block. */
export const AXLE_HEIGHT = 0.09;
/** Block beyond the axles: the kit puts the slots 0.94 from one end and 1.69 from the other. */
const OVERHANG = { short: 0.94, long: BLOCK.length - 0.94 - WHEELBASE };
/** Outer face of one wheel to the outer face of the other. */
export const TRACK = BLOCK.width + 2 * (WHEEL.width + 0.02);

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/** Where the wheels sit in the standard side crop, in output pixels. */
export interface SideFrame {
  width: number;
  height: number;
  /** Output pixels per inch. */
  pxPerInch: number;
  left: Circle;
  right: Circle;
  /** Bottom of the wheels. */
  ground: number;
  /** The block envelope with the longer overhang allowed at either end, so any car fits. */
  block: { x: number; y: number; w: number; h: number };
}

/**
 * The side crop: 1200x500 at 120 px per inch. The wheelbase is centred, the
 * wheels sit near the bottom, and there is room above the block for the
 * decorations scouts add, up to the usual 3 inch height limit, and for a
 * spoiler or nose past the block's ends.
 */
function sideFrame(width = 1200, height = 500, pxPerInch = 120): SideFrame {
  const r = WHEEL.radius * pxPerInch;
  const ground = height - 32;
  const cy = ground - r;
  const half = (WHEELBASE * pxPerInch) / 2;
  const left = { cx: width / 2 - half, cy, r };
  const right = { cx: width / 2 + half, cy, r };
  const blockBottom = cy - AXLE_HEIGHT * pxPerInch;
  const blockTop = blockBottom - BLOCK.height * pxPerInch;
  const over = OVERHANG.long * pxPerInch;
  return {
    width,
    height,
    pxPerInch,
    left,
    right,
    ground,
    block: { x: left.cx - over, y: blockTop, w: right.cx + over - (left.cx - over), h: blockBottom - blockTop },
  };
}

export const SIDE = sideFrame();

const f = (n: number) => n.toFixed(1);

/** SVG path of a full circle. */
function circlePath(c: Circle): string {
  return `M${f(c.cx)} ${f(c.cy)} m${f(-c.r)} 0 a${f(c.r)} ${f(c.r)} 0 1 0 ${f(2 * c.r)} 0 a${f(c.r)} ${f(c.r)} 0 1 0 ${f(-2 * c.r)} 0`;
}

function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${f(x)} ${f(y)} h${f(w)} v${f(h)} h${f(-w)} z`;
}

/** Outline for the side viewfinder: block envelope, a typical wedge, both wheels with hubs, and the ground. */
function sidePaths(frame: SideFrame = SIDE): string[] {
  const b = frame.block;
  const nose = b.x;
  const tail = b.x + b.w;
  const bottom = b.y + b.h;
  return [
    rectPath(b.x, b.y, b.w, b.h),
    `M${f(nose)} ${f(bottom)} L${f(nose)} ${f(bottom - b.h * 0.3)} Q${f(nose + b.w * 0.3)} ${f(b.y)} ${f(tail - b.w * 0.05)} ${f(b.y + b.h * 0.15)} L${f(tail)} ${f(bottom)} Z`,
    circlePath(frame.left),
    circlePath(frame.right),
    circlePath({ ...frame.left, r: frame.left.r * 0.24 }),
    circlePath({ ...frame.right, r: frame.right.r * 0.24 }),
    `M0 ${f(frame.ground)} H${frame.width}`,
  ];
}

/** The side outline as SVG, for the viewfinder and the crop editor. */
export const SIDE_GUIDE = { viewBox: `0 0 ${SIDE.width} ${SIDE.height}`, paths: sidePaths() };

/** What the pit crew is told while lining the car up. */
export const SIDE_HINT = 'Nose to the left, wheels on the circles';
