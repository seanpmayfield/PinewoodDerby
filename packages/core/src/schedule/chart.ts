/**
 * Lane rotation charts.
 *
 * Given N cars and L lanes we build a cyclic chart: in heat h, lane l runs car
 * (h + g_l) mod M where M = max(N, L) and g is a set of distinct lane offsets.
 * Over M heats every car runs in every lane exactly once, no car appears twice
 * in a heat, and the offsets are chosen so that:
 *
 *   1. no car races in two consecutive heats where that is possible (so the
 *      pit crew can stage), and
 *   2. cars meet as many different opponents as possible.
 *
 * When N < L some lanes are simply empty in each heat. `passes` repeats the
 * chart with a different offset set so the opponents change on the second pass.
 */

import { seededRandom } from '../model/ids.js';

/** One heat: index = lane - 1, value = car index or null for an empty lane. */
export type ChartHeat = (number | null)[];

const EXHAUSTIVE_LIMIT = 200_000;

export function generateChart(carCount: number, laneCount: number, passes = 1): ChartHeat[] {
  if (carCount <= 0 || laneCount <= 0 || passes <= 0) return [];
  const m = Math.max(carCount, laneCount);
  const heats: ChartHeat[] = [];
  for (let p = 0; p < passes; p++) {
    const offsets = chooseOffsets(m, laneCount, p);
    for (let h = 0; h < m; h++) {
      const heat: ChartHeat = [];
      for (let l = 0; l < laneCount; l++) {
        const car = (h + offsets[l]!) % m;
        heat.push(car < carCount ? car : null);
      }
      heats.push(heat);
    }
  }
  return heats;
}

/**
 * Pick `laneCount` distinct offsets in [0, m). `variant` selects the n-th best
 * candidate so successive passes use different pairings.
 */
function chooseOffsets(m: number, laneCount: number, variant = 0): number[] {
  const L = Math.min(laneCount, m);
  if (L <= 1) return [0];

  const candidates: { offsets: number[]; cost: number }[] = [];
  if (countCombos(m - 1, L - 1) <= EXHAUSTIVE_LIMIT) {
    forEachCombo(m - 1, L - 1, (pick) => {
      const offsets = [0, ...pick.map((x) => x + 1)];
      candidates.push({ offsets, cost: offsetCost(offsets, m) });
    });
  } else {
    for (let seed = 1; seed <= 24; seed++) {
      const offsets = greedyOffsets(m, L, seededRandom(seed * 7919));
      candidates.push({ offsets, cost: offsetCost(offsets, m) });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost || compareArrays(a.offsets, b.offsets));

  // Drop duplicates (greedy search can converge on the same set).
  const unique: number[][] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = c.offsets.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c.offsets);
    }
  }
  return unique[variant % unique.length]!;
}

/**
 * Lower is better. Back-to-back heats for a car are the most expensive thing,
 * then repeated opponent pairings, then a mild preference for wider spacing.
 */
export function offsetCost(offsets: number[], m: number): number {
  let minGap = Infinity;
  const diffs = new Map<number, number>();
  let repeats = 0;
  for (let i = 0; i < offsets.length; i++) {
    for (let j = 0; j < offsets.length; j++) {
      if (i === j) continue;
      const d = (((offsets[i]! - offsets[j]!) % m) + m) % m;
      diffs.set(d, (diffs.get(d) ?? 0) + 1);
      if (i < j) {
        const gap = Math.min(d, m - d);
        if (gap < minGap) minGap = gap;
      }
    }
  }
  for (const count of diffs.values()) repeats += count - 1;
  // With an even m, a difference of m/2 means the same pair meets twice.
  if (m % 2 === 0 && (diffs.get(m / 2) ?? 0) > 0) repeats += 1;

  let cost = repeats * 10;
  if (minGap < 2) cost += 1000;
  if (minGap < 3) cost += 5;
  return cost;
}

function greedyOffsets(m: number, L: number, random: () => number): number[] {
  const offsets = [0];
  while (offsets.length < L) {
    let best: number[] = [];
    let bestCost = Infinity;
    for (let x = 1; x < m; x++) {
      if (offsets.includes(x)) continue;
      const cost = offsetCost([...offsets, x], m);
      if (cost < bestCost) {
        bestCost = cost;
        best = [x];
      } else if (cost === bestCost) {
        best.push(x);
      }
    }
    offsets.push(best[Math.floor(random() * best.length)]!);
  }
  return offsets.sort((a, b) => a - b);
}

function countCombos(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
    if (result > EXHAUSTIVE_LIMIT * 10) return Infinity;
  }
  return Math.round(result);
}

/** Enumerate k-combinations of 0..n-1 in lexicographic order. */
function forEachCombo(n: number, k: number, fn: (pick: number[]) => void): void {
  if (k === 0) {
    fn([]);
    return;
  }
  const pick = Array.from({ length: k }, (_, i) => i);
  while (true) {
    fn(pick.slice());
    let i = k - 1;
    while (i >= 0 && pick[i] === n - k + i) i--;
    if (i < 0) return;
    pick[i]!++;
    for (let j = i + 1; j < k; j++) pick[j] = pick[j - 1]! + 1;
  }
}

function compareArrays(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}
