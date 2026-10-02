/**
 * Greedy heat packer used whenever the pretty cyclic chart no longer applies:
 * a lane dies mid-round, a car is withdrawn, or a late arrival is added.
 *
 * Every car still owes `runsNeeded` runs. The packer fills heats so that each
 * car gets its runs, spreads a car's runs across the lanes it has used least,
 * and avoids putting a car in two consecutive heats where it can.
 */

export interface PackNeed {
  carId: string;
  runsNeeded: number;
  /** 1-based lanes this car has already run in (with repeats). */
  lanesUsed: number[];
}

export interface PackOptions {
  /** Cars in the heat that will run immediately before the first packed heat. */
  previousHeatCars?: string[];
}

export type PackedHeat = (string | null)[];

export function packHeats(
  needs: PackNeed[],
  laneCount: number,
  deadLanes: number[] = [],
  opts: PackOptions = {},
): PackedHeat[] {
  const usableLanes: number[] = [];
  for (let lane = 1; lane <= laneCount; lane++) {
    if (!deadLanes.includes(lane)) usableLanes.push(lane);
  }
  if (usableLanes.length === 0) return [];

  const state = new Map<string, { remaining: number; laneCounts: number[] }>();
  for (const need of needs) {
    const laneCounts = new Array<number>(laneCount + 1).fill(0);
    for (const lane of need.lanesUsed) laneCounts[lane] = (laneCounts[lane] ?? 0) + 1;
    state.set(need.carId, { remaining: Math.max(0, need.runsNeeded), laneCounts });
  }

  const heats: PackedHeat[] = [];
  let previous = new Set(opts.previousHeatCars ?? []);

  while (true) {
    const candidates = [...state.entries()]
      .filter(([, s]) => s.remaining > 0)
      .sort((a, b) => {
        const aPrev = previous.has(a[0]) ? 1 : 0;
        const bPrev = previous.has(b[0]) ? 1 : 0;
        return aPrev - bPrev || b[1].remaining - a[1].remaining || (a[0] < b[0] ? -1 : 1);
      });
    if (candidates.length === 0) break;

    const chosen = candidates.slice(0, usableLanes.length).map(([carId]) => carId);
    const assignment = assignLanes(
      chosen,
      usableLanes,
      (carId, lane) => state.get(carId)!.laneCounts[lane] ?? 0,
    );

    const heat: PackedHeat = new Array<string | null>(laneCount).fill(null);
    for (const [carId, lane] of assignment) {
      heat[lane - 1] = carId;
      const s = state.get(carId)!;
      s.remaining -= 1;
      s.laneCounts[lane] = (s.laneCounts[lane] ?? 0) + 1;
    }
    heats.push(heat);
    previous = new Set(chosen);
  }
  return heats;
}

/**
 * Assign each chosen car to a distinct lane minimising the total "times this
 * car has already used this lane". Brute force over permutations; lane counts
 * are tiny (typically 4, at most 8).
 */
function assignLanes(
  cars: string[],
  lanes: number[],
  cost: (carId: string, lane: number) => number,
): Map<string, number> {
  let best: number[] = [];
  let bestCost = Infinity;
  const used = new Array<boolean>(lanes.length).fill(false);
  const current: number[] = [];

  const search = (i: number, acc: number): void => {
    if (acc >= bestCost) return;
    if (i === cars.length) {
      bestCost = acc;
      best = current.slice();
      return;
    }
    for (let l = 0; l < lanes.length; l++) {
      if (used[l]) continue;
      used[l] = true;
      current.push(l);
      search(i + 1, acc + cost(cars[i]!, lanes[l]!));
      current.pop();
      used[l] = false;
    }
  };
  search(0, 0);

  const result = new Map<string, number>();
  cars.forEach((carId, i) => result.set(carId, lanes[best[i]!]!));
  return result;
}
