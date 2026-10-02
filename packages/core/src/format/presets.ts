import type { RaceFormat, RoundSpec, TieBreakRule } from '../model/types.js';

const TIME_TIEBREAK: TieBreakRule[] = ['best-time', 'fewest-dnf', 'head-to-head', 'car-number'];
const POINTS_TIEBREAK: TieBreakRule[] = ['best-time', 'head-to-head', 'car-number'];

/**
 * Open / sibling / adult class: one round per class group, run on its own.
 * Present in every preset; the coordinator only sees it when such a group
 * exists.
 */
const OPEN_CLASS_ROUND: RoundSpec = {
  key: 'open',
  name: 'Open Class',
  scope: 'per-group',
  groupKind: 'class',
  entry: { kind: 'all' },
  passes: 1,
  scoring: { kind: 'average-time' },
  tieBreak: TIME_TIEBREAK,
};

const OPEN_CLASS_AWARD = { name: 'Champion', roundKey: 'open', place: 1, scope: 'per-group' as const };

/**
 * Each den races on its own, every car in every lane once, ranked by average
 * time. The top three from each den advance to a pack final run the same way.
 */
export const DEN_THEN_FINAL: RaceFormat = {
  id: 'den-then-final',
  name: 'Den races, then pack final',
  description:
    'Each den races separately (every car runs every lane once, fastest average wins). The top 3 from each den advance to a pack final.',
  rounds: [
    {
      key: 'den',
      name: 'Den Races',
      scope: 'per-group',
      groupKind: 'den',
      entry: { kind: 'all' },
      passes: 1,
      scoring: { kind: 'average-time' },
      tieBreak: TIME_TIEBREAK,
    },
    {
      key: 'final',
      name: 'Pack Final',
      scope: 'combined',
      entry: { kind: 'advance', fromRound: 'den', perGroup: 3 },
      passes: 1,
      scoring: { kind: 'average-time' },
      tieBreak: TIME_TIEBREAK,
    },
    OPEN_CLASS_ROUND,
  ],
  speedAwards: [
    { name: '1st Place', roundKey: 'final', place: 1, scope: 'combined' },
    { name: '2nd Place', roundKey: 'final', place: 2, scope: 'combined' },
    { name: '3rd Place', roundKey: 'final', place: 3, scope: 'combined' },
    { name: 'Den Champion', roundKey: 'den', place: 1, scope: 'per-group' },
    OPEN_CLASS_AWARD,
  ],
};

/** Everyone in one big round, every lane once, fastest average wins. */
export const PACK_AVERAGE_TIME: RaceFormat = {
  id: 'pack-average-time',
  name: 'Whole pack, fastest average time',
  description: 'All cars race together. Every car runs every lane once and the fastest average time wins.',
  rounds: [
    {
      key: 'main',
      name: 'Pack Races',
      scope: 'combined',
      entry: { kind: 'all' },
      passes: 1,
      scoring: { kind: 'average-time' },
      tieBreak: TIME_TIEBREAK,
    },
    OPEN_CLASS_ROUND,
  ],
  speedAwards: [
    { name: '1st Place', roundKey: 'main', place: 1, scope: 'combined' },
    { name: '2nd Place', roundKey: 'main', place: 2, scope: 'combined' },
    { name: '3rd Place', roundKey: 'main', place: 3, scope: 'combined' },
    OPEN_CLASS_AWARD,
  ],
};

/** Same as above but two passes (each lane twice), for smaller packs that want more racing. */
export const PACK_DOUBLE_PASS: RaceFormat = {
  id: 'pack-double-pass',
  name: 'Whole pack, two passes',
  description: 'All cars race together and every car runs every lane twice. Fastest average time wins. Good for small packs.',
  rounds: [
    {
      key: 'main',
      name: 'Pack Races',
      scope: 'combined',
      entry: { kind: 'all' },
      passes: 2,
      scoring: { kind: 'average-time' },
      tieBreak: TIME_TIEBREAK,
    },
    OPEN_CLASS_ROUND,
  ],
  speedAwards: PACK_AVERAGE_TIME.speedAwards,
};

/** Place points: 1st = 1 point, lowest total wins. No timer precision needed. */
export const PACK_POINTS: RaceFormat = {
  id: 'pack-points',
  name: 'Whole pack, place points',
  description:
    'All cars race together, every lane once. Each heat awards 1 point for 1st, 2 for 2nd and so on; the lowest total wins. Ties broken by best time.',
  rounds: [
    {
      key: 'main',
      name: 'Pack Races',
      scope: 'combined',
      entry: { kind: 'all' },
      passes: 1,
      scoring: { kind: 'points', pointsByPlace: [1, 2, 3, 4], dnfPoints: 5, higherIsBetter: false },
      tieBreak: POINTS_TIEBREAK,
    },
    OPEN_CLASS_ROUND,
  ],
  speedAwards: PACK_AVERAGE_TIME.speedAwards,
};

/** Den races by points, then a final by average time with the top 2 per den plus the next 4 fastest overall. */
export const DEN_POINTS_THEN_FINAL: RaceFormat = {
  id: 'den-points-then-final',
  name: 'Den races by points, timed final',
  description:
    'Dens race separately using place points. The top 2 from each den plus the 4 fastest remaining cars overall advance to a timed pack final.',
  rounds: [
    {
      key: 'den',
      name: 'Den Races',
      scope: 'per-group',
      groupKind: 'den',
      entry: { kind: 'all' },
      passes: 1,
      scoring: { kind: 'points', pointsByPlace: [1, 2, 3, 4], dnfPoints: 5, higherIsBetter: false },
      tieBreak: POINTS_TIEBREAK,
    },
    {
      key: 'final',
      name: 'Pack Final',
      scope: 'combined',
      entry: { kind: 'advance', fromRound: 'den', perGroup: 2, overall: 4 },
      passes: 1,
      scoring: { kind: 'average-time' },
      tieBreak: TIME_TIEBREAK,
    },
    OPEN_CLASS_ROUND,
  ],
  speedAwards: DEN_THEN_FINAL.speedAwards,
};

export const FORMAT_PRESETS: RaceFormat[] = [
  DEN_THEN_FINAL,
  PACK_AVERAGE_TIME,
  PACK_DOUBLE_PASS,
  PACK_POINTS,
  DEN_POINTS_THEN_FINAL,
];

export function findPreset(id: string): RaceFormat | undefined {
  return FORMAT_PRESETS.find((f) => f.id === id);
}

/**
 * A derby keeps its own copy of the format. On load, any rounds or speed
 * awards the preset has that the copy lacks are added, without touching
 * anything the event already has.
 */
export function syncFormatWithPreset(format: RaceFormat): RaceFormat {
  const preset = findPreset(format.id);
  if (!preset) return format;
  const keys = new Set(format.rounds.map((r) => r.key));
  const rounds = [...format.rounds, ...preset.rounds.filter((r) => !keys.has(r.key))];
  const awardKey = (a: { roundKey: string; place: number; scope: string }) => `${a.roundKey}:${a.place}:${a.scope}`;
  const have = new Set(format.speedAwards.map(awardKey));
  const speedAwards = [...format.speedAwards, ...preset.speedAwards.filter((a) => !have.has(awardKey(a)))];
  if (rounds.length === format.rounds.length && speedAwards.length === format.speedAwards.length) return format;
  return { ...format, rounds, speedAwards };
}

/** A format that is not one of the presets (no UI builds these yet; used by tests and custom set-ups). */
export function customFormat(rounds: RoundSpec[], name = 'Custom format'): RaceFormat {
  return {
    id: 'custom',
    name,
    description: 'Custom race format.',
    rounds,
    speedAwards: [],
  };
}

export function validateFormat(format: RaceFormat): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  if (format.rounds.length === 0) errors.push('A format needs at least one round.');
  format.rounds.forEach((round, i) => {
    if (!round.key) errors.push(`Round ${i + 1} has no key.`);
    if (keys.has(round.key)) errors.push(`Round key "${round.key}" is used more than once.`);
    keys.add(round.key);
    if (round.passes < 1) errors.push(`Round "${round.key}" must have at least one pass.`);
    if (round.scope === 'per-group' && !round.groupKind) {
      errors.push(`Round "${round.key}" is per-group but has no groupKind.`);
    }
    if (round.entry.kind === 'advance') {
      const from = round.entry.fromRound;
      const fromIndex = format.rounds.findIndex((r) => r.key === from);
      if (fromIndex < 0) errors.push(`Round "${round.key}" advances from unknown round "${from}".`);
      else if (fromIndex >= i) errors.push(`Round "${round.key}" must come after the round it advances from.`);
      if (!round.entry.perGroup && !round.entry.overall) {
        errors.push(`Round "${round.key}" advances nobody: set perGroup and/or overall.`);
      }
    }
    if (round.scoring.kind === 'points' && round.scoring.pointsByPlace.length === 0) {
      errors.push(`Round "${round.key}" points scoring needs a pointsByPlace table.`);
    }
  });
  for (const award of format.speedAwards) {
    if (!keys.has(award.roundKey)) errors.push(`Award "${award.name}" refers to unknown round "${award.roundKey}".`);
  }
  return errors;
}

/** Judges' award presets. Judges can also add their own. */
export const DESIGN_AWARD_PRESETS: string[] = [
  'Best in Show',
  "Judges' Choice",
  'Most Creative',
  'Best Paint Job',
  'Most Colorful',
  'Fastest Looking',
  'Most Realistic',
  'Most Patriotic',
  'Best Scout Spirit',
  'Funniest Car',
  'Most Original',
  'Best Use of Decals',
  'Best Theme',
  'Sleekest Design',
  'Coolest Wheels',
];

export interface InspectionCheck {
  id: string;
  label: string;
  hint: string;
}

/** Standard BSA-style inspection checklist. */
export const INSPECTION_CHECKS: InspectionCheck[] = [
  { id: 'weight', label: 'Weight', hint: 'Not more than 5.0 oz' },
  { id: 'length', label: 'Length', hint: 'Not more than 7 inches' },
  { id: 'width', label: 'Width', hint: 'Not more than 2¾ inches' },
  { id: 'clearance', label: 'Clearance', hint: 'At least ⅜ inch under the car' },
  { id: 'wheelbase', label: 'Wheelbase', hint: 'Axle slots in original position' },
  { id: 'wheels', label: 'Wheels and axles', hint: 'Official BSA wheels, no bearings, washers or springs' },
  { id: 'nose', label: 'Nose', hint: 'Fits the starting pin, no notches' },
  { id: 'loose', label: 'Nothing loose', hint: 'No loose weights or parts' },
];
