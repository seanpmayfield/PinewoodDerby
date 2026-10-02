import type {
  DerbySettings,
  Id,
  LaneResult,
  Round,
  RoundSpec,
  ScoringMethod,
  Standing,
  TieBreakRule,
} from '../model/types.js';

export interface CarRun {
  heatId: Id;
  lane: number;
  timeSec: number | null;
  place: number | null;
  dnf: boolean;
}

/**
 * Compute finishing places for one heat from the recorded times. Ties share a
 * place; DNFs and empty lanes get no place.
 */
export function computePlaces(
  lanes: { lane: number; carId: Id | null; timeSec: number | null }[],
): LaneResult[] {
  const finished = lanes.filter((l) => l.carId !== null && l.timeSec !== null);
  return lanes.map((l) => {
    if (l.carId === null) return { lane: l.lane, carId: null, timeSec: null, place: null, dnf: false };
    if (l.timeSec === null) return { lane: l.lane, carId: l.carId, timeSec: null, place: null, dnf: true };
    const faster = finished.filter((f) => f.timeSec! < l.timeSec!).length;
    return { lane: l.lane, carId: l.carId, timeSec: l.timeSec, place: faster + 1, dnf: false };
  });
}

/** Runs per car from finished (non-voided) heats. */
export function collectRuns(round: Round): Map<Id, CarRun[]> {
  const runs = new Map<Id, CarRun[]>();
  for (const carId of round.entries) runs.set(carId, []);
  for (const heat of round.heats) {
    if (heat.status !== 'finished' || !heat.result) continue;
    for (const lane of heat.result.lanes) {
      if (!lane.carId) continue;
      const list = runs.get(lane.carId) ?? [];
      list.push({ heatId: heat.id, lane: lane.lane, timeSec: lane.timeSec, place: lane.place, dnf: lane.dnf });
      runs.set(lane.carId, list);
    }
  }
  return runs;
}

export function higherIsBetter(method: ScoringMethod): boolean {
  switch (method.kind) {
    case 'points':
      return method.higherIsBetter;
    case 'wins':
      return true;
    default:
      return false;
  }
}

export function scoreRuns(runs: CarRun[], method: ScoringMethod, settings: DerbySettings): number {
  const worst = higherIsBetter(method) ? -Infinity : Infinity;
  if (runs.length === 0) return worst;
  const timeOf = (r: CarRun) => (r.dnf || r.timeSec === null ? settings.dnfTimeSec : r.timeSec);
  switch (method.kind) {
    case 'average-time':
      return runs.reduce((s, r) => s + timeOf(r), 0) / runs.length;
    case 'total-time':
      return runs.reduce((s, r) => s + timeOf(r), 0);
    case 'best-time': {
      const times = runs.filter((r) => !r.dnf && r.timeSec !== null).map((r) => r.timeSec!);
      return times.length ? Math.min(...times) : settings.dnfTimeSec;
    }
    case 'points':
      return runs.reduce((s, r) => {
        if (r.dnf || r.place === null) return s + method.dnfPoints;
        const idx = Math.min(r.place, method.pointsByPlace.length) - 1;
        return s + (method.pointsByPlace[idx] ?? 0);
      }, 0);
    case 'wins':
      return runs.filter((r) => r.place === 1).length;
  }
}

export function formatScore(score: number, method: ScoringMethod): string {
  if (!Number.isFinite(score)) return '—';
  switch (method.kind) {
    case 'average-time':
    case 'total-time':
    case 'best-time':
      return score.toFixed(4);
    case 'points':
      return `${score} pts`;
    case 'wins':
      return `${score} ${score === 1 ? 'win' : 'wins'}`;
  }
}

/** Number of non-voided heats in the round that include this car. */
export function expectedRuns(round: Round, carId: Id): number {
  return round.heats.filter((h) => h.status !== 'voided' && h.lanes.includes(carId)).length;
}

export function computeStandings(
  round: Round,
  spec: RoundSpec,
  settings: DerbySettings,
  carNumber: (carId: Id) => number,
): Standing[] {
  const runsByCar = collectRuns(round);
  const rows: Standing[] = round.entries.map((carId) => {
    const runs = runsByCar.get(carId) ?? [];
    const times = runs.filter((r) => !r.dnf && r.timeSec !== null).map((r) => r.timeSec!);
    const score = scoreRuns(runs, spec.scoring, settings);
    const expected = expectedRuns(round, carId);
    return {
      carId,
      rank: 0,
      score,
      scoreLabel: formatScore(score, spec.scoring),
      runs: runs.length,
      expectedRuns: expected,
      complete: expected > 0 && runs.length >= expected,
      bestTime: times.length ? Math.min(...times) : null,
      avgTime: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      dnfCount: runs.filter((r) => r.dnf).length,
      wins: runs.filter((r) => r.place === 1).length,
    };
  });

  const direction = higherIsBetter(spec.scoring) ? -1 : 1;
  const rules = spec.tieBreak;

  const compareRanked = (a: Standing, b: Standing): number => {
    const scoreCmp = compareScores(a.score, b.score) * direction;
    if (scoreCmp !== 0) return scoreCmp;
    for (const rule of rules) {
      const c = applyTieBreak(rule, a, b, runsByCar);
      if (c !== 0) return c;
    }
    return 0;
  };

  rows.sort((a, b) => compareRanked(a, b) || carNumber(a.carId) - carNumber(b.carId));

  let rank = 0;
  rows.forEach((row, i) => {
    if (i === 0 || compareRanked(rows[i - 1]!, row) !== 0) rank = i + 1;
    row.rank = rank;
  });
  return rows;
}

function compareScores(a: number, b: number): number {
  if (a === b) return 0;
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
  return a < b ? -1 : 1;
}

function applyTieBreak(
  rule: TieBreakRule,
  a: Standing,
  b: Standing,
  runsByCar: Map<Id, CarRun[]>,
): number {
  switch (rule) {
    case 'best-time': {
      const at = a.bestTime ?? Infinity;
      const bt = b.bestTime ?? Infinity;
      return compareScores(at, bt);
    }
    case 'fewest-dnf':
      return a.dnfCount - b.dnfCount;
    case 'head-to-head': {
      let aWins = 0;
      let bWins = 0;
      const aRuns = runsByCar.get(a.carId) ?? [];
      const bRuns = runsByCar.get(b.carId) ?? [];
      for (const ar of aRuns) {
        const br = bRuns.find((r) => r.heatId === ar.heatId);
        if (!br) continue;
        const at = ar.dnf ? Infinity : ar.timeSec ?? Infinity;
        const bt = br.dnf ? Infinity : br.timeSec ?? Infinity;
        if (at < bt) aWins++;
        else if (bt < at) bWins++;
      }
      return bWins - aWins;
    }
    case 'car-number':
      // The final sort always falls back to car number; nothing to do here.
      return 0;
  }
}
