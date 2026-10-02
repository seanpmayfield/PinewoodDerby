import { describe, expect, it } from 'vitest';
import { generateChart, offsetCost } from '../src/schedule/chart.js';

function laneCounts(chart: (number | null)[][], carCount: number, laneCount: number): number[][] {
  const counts = Array.from({ length: carCount }, () => new Array<number>(laneCount).fill(0));
  for (const heat of chart) {
    heat.forEach((car, lane) => {
      if (car !== null) counts[car]![lane]!++;
    });
  }
  return counts;
}

describe('generateChart', () => {
  it('runs every car in every lane exactly once per pass', () => {
    for (const carCount of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 17, 24, 40, 61]) {
      for (const passes of [1, 2]) {
        const chart = generateChart(carCount, 4, passes);
        const counts = laneCounts(chart, carCount, 4);
        for (const row of counts) expect(row).toEqual([passes, passes, passes, passes]);
        expect(chart.length).toBe(Math.max(carCount, 4) * passes);
      }
    }
  });

  it('never puts a car in two lanes of the same heat', () => {
    for (const carCount of [2, 4, 5, 9, 30]) {
      for (const heat of generateChart(carCount, 4)) {
        const cars = heat.filter((c) => c !== null);
        expect(new Set(cars).size).toBe(cars.length);
      }
    }
  });

  it('keeps cars out of consecutive heats once there are enough cars', () => {
    for (const carCount of [8, 9, 10, 13, 20, 33, 50, 120]) {
      const chart = generateChart(carCount, 4);
      for (let h = 1; h < chart.length; h++) {
        const prev = new Set(chart[h - 1]!.filter((c) => c !== null));
        for (const car of chart[h]!) {
          if (car !== null) expect(prev.has(car), `car ${car} runs back to back at heat ${h} with ${carCount} cars`).toBe(false);
        }
      }
    }
  });

  it('handles a large pack quickly', () => {
    const start = performance.now();
    const chart = generateChart(150, 4, 1);
    expect(chart.length).toBe(150);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('works for six and eight lanes', () => {
    for (const laneCount of [6, 8]) {
      const chart = generateChart(20, laneCount);
      const counts = laneCounts(chart, 20, laneCount);
      for (const row of counts) expect(row.every((n) => n === 1)).toBe(true);
    }
  });

  it('returns nothing for zero cars', () => {
    expect(generateChart(0, 4)).toEqual([]);
  });
});

describe('offsetCost', () => {
  it('penalises adjacent offsets most', () => {
    expect(offsetCost([0, 1, 3, 9], 13)).toBeGreaterThan(offsetCost([0, 2, 5, 9], 13));
  });
});
