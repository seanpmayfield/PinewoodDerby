import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, code128Svg, code128Symbols, parseCarCode } from '../src/print/code128.ts';

describe('Code 128', () => {
  it('has the full symbol table, every symbol eleven modules wide', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    for (const p of CODE128_PATTERNS) {
      expect(p).toMatch(/^[1-4]{6}$/);
      expect(p.split('').reduce((a, b) => a + Number(b), 0)).toBe(11);
    }
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    // Start B, Stop.
    expect(CODE128_PATTERNS[104]).toBe('211214');
    expect(CODE128_PATTERNS[106]).toBe('233111');
  });

  it('computes the checksum the standard way', () => {
    // Start B (104), then C A R 1 2 weighted 1..5: (104 + 35 + 66 + 150 + 68 + 90) mod 103 = 101.
    expect(code128Symbols('CAR12')).toEqual([104, 35, 33, 50, 17, 18, 101]);
    expect(code128Symbols('PJJ123C')).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55]);
  });

  it('draws bars for every odd element plus the stop, and refuses characters outside set B', () => {
    const svg = code128Svg('CAR7', { module: 1, quiet: 0 });
    const rects = svg.match(/<rect/g)?.length ?? 0;
    // 6 symbols (start, 4 data, check) with 3 bars each, plus 4 bars in the stop pattern.
    expect(rects).toBe(6 * 3 + 4);
    expect(svg).toContain('viewBox="0 0 79 40"');
    expect(() => code128Svg('tab\there')).toThrow();
  });

  it('reads car codes typed or scanned', () => {
    expect(parseCarCode('CAR12')).toBe(12);
    expect(parseCarCode('car007')).toBe(7);
    expect(parseCarCode(' 42 ')).toBe(42);
    expect(parseCarCode('Wyatt')).toBeNull();
    expect(parseCarCode('CAR12345')).toBeNull();
  });
});
