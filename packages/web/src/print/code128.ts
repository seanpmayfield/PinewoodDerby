/**
 * Code 128 barcodes as SVG, for the car tags. Code set B covers digits,
 * letters and punctuation; a USB barcode scanner types the encoded text
 * followed by Enter, which the pit screen's search box understands.
 */

/** Bar and space widths for symbol values 0..106 (the standard Code 128 table; each symbol is 11 modules). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '233111',
];
const START_B = 104;
/** The stop symbol plus its 2-module termination bar. */
const STOP = '2331112';

/** Symbol values for `text` in code set B: start, data, checksum (no stop). */
export function code128Symbols(text: string): number[] {
  const codes = [START_B];
  for (const ch of text) {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Cannot encode "${ch}" in Code 128-B.`);
    codes.push(v);
  }
  let checksum = START_B;
  for (let i = 1; i < codes.length; i++) checksum += codes[i]! * i;
  codes.push(checksum % 103);
  return codes;
}

export interface BarcodeOptions {
  /** Width of the narrowest bar, in SVG units. */
  module?: number;
  height?: number;
  /** Quiet zone at each end, in modules. */
  quiet?: number;
}

/** An SVG string of the Code 128-B barcode for `text` (ASCII 32..126 only). */
export function code128Svg(text: string, options: BarcodeOptions = {}): string {
  const module = options.module ?? 2;
  const height = options.height ?? 40;
  const quiet = options.quiet ?? 10;
  const widths = code128Symbols(text).map((c) => PATTERNS[c]!).join('') + STOP;
  let x = quiet * module;
  const bars: string[] = [];
  widths.split('').forEach((w, i) => {
    const width = Number(w) * module;
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="${height}"/>`);
    x += width;
  });
  const total = x + quiet * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${total}" height="${height}" shape-rendering="crispEdges" fill="#000">${bars.join('')}</svg>`;
}

/** Exposed for the test that checks the table. */
export const CODE128_PATTERNS: readonly string[] = PATTERNS;

/** What a car's barcode says, and how to read one back. */
export const CAR_CODE_PREFIX = 'CAR';
export const carCode = (number: number) => `${CAR_CODE_PREFIX}${number}`;
export function parseCarCode(text: string): number | null {
  const m = text.trim().match(/^(?:CAR)?0*(\d{1,4})$/i);
  return m ? Number(m[1]) : null;
}
