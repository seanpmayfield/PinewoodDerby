import { describe, expect, it } from 'vitest';
import { customFormat, FORMAT_PRESETS, validateFormat } from '../src/format/presets.js';

describe('format presets', () => {
  it('are all valid', () => {
    for (const preset of FORMAT_PRESETS) {
      expect(validateFormat(preset), preset.id).toEqual([]);
    }
  });

  it('have unique ids', () => {
    expect(new Set(FORMAT_PRESETS.map((p) => p.id)).size).toBe(FORMAT_PRESETS.length);
  });
});

describe('validateFormat', () => {
  it('catches a final that advances from a later or unknown round', () => {
    const format = customFormat([
      {
        key: 'final',
        name: 'Final',
        scope: 'combined',
        entry: { kind: 'advance', fromRound: 'prelim', perGroup: 2 },
        passes: 1,
        scoring: { kind: 'average-time' },
        tieBreak: ['car-number'],
      },
      {
        key: 'prelim',
        name: 'Prelim',
        scope: 'per-group',
        entry: { kind: 'all' },
        passes: 1,
        scoring: { kind: 'average-time' },
        tieBreak: ['car-number'],
      },
    ]);
    const errors = validateFormat(format);
    expect(errors.some((e) => e.includes('must come after'))).toBe(true);
    expect(errors.some((e) => e.includes('groupKind'))).toBe(true);
  });

  it('rejects an empty format', () => {
    expect(validateFormat(customFormat([]))).toHaveLength(1);
  });
});
