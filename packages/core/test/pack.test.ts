import { describe, expect, it } from 'vitest';
import { packHeats } from '../src/schedule/pack.js';

describe('packHeats', () => {
  it('gives every car its remaining runs, spread across lanes', () => {
    const needs = ['a', 'b', 'c', 'd', 'e', 'f'].map((carId) => ({ carId, runsNeeded: 4, lanesUsed: [] }));
    const heats = packHeats(needs, 4);
    const runs = new Map<string, number[]>();
    for (const heat of heats) {
      heat.forEach((car, i) => {
        if (car) runs.set(car, [...(runs.get(car) ?? []), i + 1]);
      });
      const cars = heat.filter(Boolean);
      expect(new Set(cars).size).toBe(cars.length);
    }
    for (const need of needs) {
      const lanes = runs.get(need.carId)!;
      expect(lanes.length).toBe(4);
      expect(new Set(lanes).size).toBe(4);
    }
  });

  it('skips dead lanes', () => {
    const needs = ['a', 'b', 'c', 'd', 'e'].map((carId) => ({ carId, runsNeeded: 4, lanesUsed: [] }));
    const heats = packHeats(needs, 4, [2]);
    for (const heat of heats) expect(heat[1]).toBeNull();
    const total = heats.flat().filter(Boolean).length;
    expect(total).toBe(20);
  });

  it('prefers lanes a car has not used yet', () => {
    const heats = packHeats([{ carId: 'a', runsNeeded: 1, lanesUsed: [1, 2, 3] }], 4);
    expect(heats).toEqual([[null, null, null, 'a']]);
  });

  it('avoids back-to-back heats when it can', () => {
    const needs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((carId) => ({ carId, runsNeeded: 4, lanesUsed: [] }));
    const heats = packHeats(needs, 4, [], { previousHeatCars: ['a', 'b', 'c', 'd'] });
    expect(heats[0]!.filter(Boolean).some((c) => ['a', 'b', 'c', 'd'].includes(c!))).toBe(false);
    for (let h = 1; h < heats.length - 3; h++) {
      const prev = new Set(heats[h - 1]!.filter(Boolean));
      for (const car of heats[h]!) if (car) expect(prev.has(car)).toBe(false);
    }
  });

  it('returns nothing when nothing is owed', () => {
    expect(packHeats([{ carId: 'a', runsNeeded: 0, lanesUsed: [1, 2, 3, 4] }], 4)).toEqual([]);
  });
});
