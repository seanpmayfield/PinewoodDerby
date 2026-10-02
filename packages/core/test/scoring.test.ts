import { describe, expect, it } from 'vitest';
import { computePlaces, computeStandings, scoreRuns } from '../src/scoring/index.js';
import { DEFAULT_SETTINGS, type Heat, type Round, type RoundSpec } from '../src/model/types.js';

const settings = DEFAULT_SETTINGS;

function heat(id: string, lanes: (string | null)[], times: (number | null)[]): Heat {
  const laneInputs = lanes.map((carId, i) => ({ lane: i + 1, carId, timeSec: times[i] ?? null }));
  return {
    id,
    roundId: 'r',
    number: 1,
    lanes,
    status: 'finished',
    attempt: 1,
    result: { lanes: computePlaces(laneInputs), recordedAt: '', source: 'manual' },
  };
}

const carNumber = (id: string) => ['a', 'b', 'c', 'd'].indexOf(id) + 1;

describe('computePlaces', () => {
  it('orders by time, ties share a place, DNF gets none', () => {
    const places = computePlaces([
      { lane: 1, carId: 'a', timeSec: 3.2 },
      { lane: 2, carId: 'b', timeSec: 3.1 },
      { lane: 3, carId: 'c', timeSec: 3.1 },
      { lane: 4, carId: 'd', timeSec: null },
    ]);
    expect(places.map((p) => p.place)).toEqual([3, 1, 1, null]);
    expect(places[3]!.dnf).toBe(true);
  });

  it('marks empty lanes as neither placed nor DNF', () => {
    const places = computePlaces([{ lane: 1, carId: null, timeSec: null }]);
    expect(places[0]).toMatchObject({ place: null, dnf: false });
  });
});

describe('scoreRuns', () => {
  const runs = [
    { heatId: '1', lane: 1, timeSec: 3.0, place: 1, dnf: false },
    { heatId: '2', lane: 2, timeSec: 3.5, place: 2, dnf: false },
    { heatId: '3', lane: 3, timeSec: null, place: null, dnf: true },
  ];

  it('averages with the DNF penalty', () => {
    expect(scoreRuns(runs, { kind: 'average-time' }, settings)).toBeCloseTo((3.0 + 3.5 + 9.9999) / 3, 4);
  });

  it('best time ignores DNFs', () => {
    expect(scoreRuns(runs, { kind: 'best-time' }, settings)).toBe(3.0);
  });

  it('points use the table and the DNF value', () => {
    expect(
      scoreRuns(runs, { kind: 'points', pointsByPlace: [1, 2, 3, 4], dnfPoints: 5, higherIsBetter: false }, settings),
    ).toBe(8);
  });

  it('counts wins', () => {
    expect(scoreRuns(runs, { kind: 'wins' }, settings)).toBe(1);
  });

  it('gives the worst possible score with no runs', () => {
    expect(scoreRuns([], { kind: 'average-time' }, settings)).toBe(Infinity);
    expect(scoreRuns([], { kind: 'wins' }, settings)).toBe(-Infinity);
  });
});

describe('computeStandings', () => {
  const spec: RoundSpec = {
    key: 'x',
    name: 'X',
    scope: 'combined',
    entry: { kind: 'all' },
    passes: 1,
    scoring: { kind: 'average-time' },
    tieBreak: ['best-time', 'fewest-dnf', 'head-to-head', 'car-number'],
  };

  it('ranks by average time and flags completeness', () => {
    const round: Round = {
      id: 'r',
      specKey: 'x',
      name: 'X',
      groupId: null,
      sequence: 1,
      entries: ['a', 'b', 'c', 'd'],
      status: 'running',
      heats: [
        heat('1', ['a', 'b', 'c', 'd'], [3.0, 3.2, 3.4, 3.6]),
        heat('2', ['b', 'c', 'd', 'a'], [3.1, 3.5, 3.7, 3.0]),
        { ...heat('3', ['c', 'd', 'a', 'b'], [3.3, 3.8, 3.1, 3.2]), status: 'pending', result: undefined },
      ],
    };
    const standings = computeStandings(round, spec, settings, carNumber);
    expect(standings.map((s) => s.carId)).toEqual(['a', 'b', 'c', 'd']);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
    expect(standings[0]!.runs).toBe(2);
    expect(standings[0]!.expectedRuns).toBe(3);
    expect(standings[0]!.complete).toBe(false);
  });

  it('shares a rank on a dead tie and breaks ties by best time', () => {
    const round: Round = {
      id: 'r',
      specKey: 'x',
      name: 'X',
      groupId: null,
      sequence: 1,
      entries: ['a', 'b', 'c'],
      status: 'complete',
      heats: [
        heat('1', ['a', 'b', 'c', null], [3.0, 3.2, 3.1, null]),
        heat('2', ['b', 'a', 'c', null], [3.0, 3.2, 3.1, null]),
      ],
    };
    const standings = computeStandings(round, spec, settings, carNumber);
    // a and b both average 3.1 with best 3.0; c averages 3.1 with best 3.1
    expect(standings.map((s) => s.carId)).toEqual(['a', 'b', 'c']);
    expect(standings.map((s) => s.rank)).toEqual([1, 1, 3]);
  });

  it('sorts higher-is-better methods descending', () => {
    const winsSpec: RoundSpec = { ...spec, scoring: { kind: 'wins' }, tieBreak: ['car-number'] };
    const round: Round = {
      id: 'r',
      specKey: 'x',
      name: 'X',
      groupId: null,
      sequence: 1,
      entries: ['a', 'b'],
      status: 'complete',
      heats: [heat('1', ['a', 'b', null, null], [3.5, 3.0, null, null])],
    };
    const standings = computeStandings(round, winsSpec, settings, carNumber);
    expect(standings[0]!.carId).toBe('b');
    expect(standings[0]!.scoreLabel).toBe('1 win');
  });
});
