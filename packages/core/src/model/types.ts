/**
 * Core data model for a pinewood derby event.
 *
 * Everything here is plain JSON-serialisable data. The whole `Derby` object is
 * the unit of persistence: the server snapshots it after every change, which
 * gives us backup and undo for free at derby scale (a few hundred cars at most).
 */

export type Id = string;

// ---------------------------------------------------------------------------
// People and cars
// ---------------------------------------------------------------------------

/**
 * `pack`  – the top-level group (usually exactly one).
 * `den`   – a den within the pack; racers belong to a den.
 * `class` – a non-scout class such as "Open / Siblings / Adults".
 */
export type GroupKind = 'pack' | 'den' | 'class';

export interface Group {
  id: Id;
  name: string;
  kind: GroupKind;
  parentId: Id | null;
  sortOrder: number;
}

export interface Racer {
  id: Id;
  firstName: string;
  lastName: string;
  /** The den (or class) this racer belongs to. */
  groupId: Id;
  /** Scout rank, e.g. Lion, Tiger, Wolf, Bear, Webelos, AOL. Free text. */
  rank?: string;
  /** Storage key of the short video headshot shown in the spotlight and on awards. */
  headshot?: string;
  checkedIn: boolean;
  notes?: string;
}

export type InspectionStatus = 'pending' | 'passed' | 'needs-work' | 'failed';

export interface Inspection {
  status: InspectionStatus;
  /** Keyed by check id from `INSPECTION_CHECKS`, true = passed. */
  checks: Record<string, boolean>;
  notes?: string;
  inspectedAt?: string;
}

export interface CarShot {
  /** Storage key of the full upload (downscaled). */
  original: string;
  /** Storage key of the standardised side crop (JPEG). */
  crop: string;
  /** Storage key of the background-removed version (transparent PNG). */
  cutout?: string;
}

export interface CarPhoto {
  /** The side view: nose to the left, wheels on the standard spots. */
  side?: CarShot;
  /** Older saves (flat profile/original/cutout keys, or a `shots` map by angle); the engine folds them into `side` on load. */
  shots?: Record<string, CarShot | undefined>;
  original?: string;
  profile?: string;
  cutout?: string;
}

export interface Car {
  id: Id;
  racerId: Id;
  /** Unique car number, printed on the car and used everywhere on screen. */
  number: number;
  name?: string;
  /** Overrides the racer's group, e.g. a scout's second car entered in the open class. */
  groupId?: Id;
  weightOz?: number;
  photo?: CarPhoto;
  inspection: Inspection;
  withdrawn: boolean;
}

// ---------------------------------------------------------------------------
// Race formats
// ---------------------------------------------------------------------------

export type ScoringMethod =
  | { kind: 'average-time' }
  | { kind: 'total-time' }
  | { kind: 'best-time' }
  | {
      kind: 'points';
      /** Points for 1st, 2nd, 3rd, ... place. Places beyond the array get the last value. */
      pointsByPlace: number[];
      dnfPoints: number;
      higherIsBetter: boolean;
    }
  | { kind: 'wins' };

export type TieBreakRule = 'best-time' | 'fewest-dnf' | 'head-to-head' | 'car-number';

export type EntryRule =
  | {
      kind: 'all';
      /**
       * For combined rounds: which group kinds' cars take part. Defaults to
       * dens only, so an open/adult class does not race against the scouts.
       */
      groupKinds?: GroupKind[];
    }
  | {
      kind: 'advance';
      /** `key` of the round spec whose standings feed this round. */
      fromRound: string;
      /** Take the top N from each source round (e.g. top 3 of every den). */
      perGroup?: number;
      /** Additionally take the top N across all source rounds combined. */
      overall?: number;
    };

export interface RoundSpec {
  /** Stable key referenced by entry rules and awards, e.g. "den" or "final". */
  key: string;
  name: string;
  /** `per-group` creates one round per group of `groupKind`; `combined` creates one round for everyone. */
  scope: 'per-group' | 'combined';
  groupKind?: GroupKind;
  entry: EntryRule;
  /** One pass = every car runs in every lane exactly once. */
  passes: number;
  scoring: ScoringMethod;
  tieBreak: TieBreakRule[];
}

export interface SpeedAwardSpec {
  name: string;
  roundKey: string;
  place: number;
  scope: 'per-group' | 'combined';
}

export interface RaceFormat {
  id: string;
  name: string;
  description: string;
  rounds: RoundSpec[];
  speedAwards: SpeedAwardSpec[];
}

// ---------------------------------------------------------------------------
// Rounds, heats and results
// ---------------------------------------------------------------------------

export type HeatStatus = 'pending' | 'staged' | 'running' | 'finished' | 'voided';

export interface LaneResult {
  /** 1-based lane number. */
  lane: number;
  carId: Id | null;
  timeSec: number | null;
  /** 1-based finishing place within the heat; null for empty lanes and DNFs. */
  place: number | null;
  dnf: boolean;
}

export interface HeatResult {
  lanes: LaneResult[];
  recordedAt: string;
  source: 'timer' | 'manual' | 'simulator';
}

export interface Heat {
  id: Id;
  roundId: Id;
  /** Creation order within the round. Display position is derived from array order. */
  number: number;
  /** Index = lane - 1. Car id or null for an empty lane. */
  lanes: (Id | null)[];
  status: HeatStatus;
  result?: HeatResult;
  /** Set when this heat is a re-run of a voided heat. */
  rerunOf?: Id;
  attempt: number;
  voidReason?: string;
  /** Storage key of the finish-line replay clip, once the camera page has uploaded it. */
  replay?: string;
  /** Car featured in the audience spotlight while this heat is staged. */
  spotlightCarId?: Id;
}

export type RoundStatus = 'scheduled' | 'running' | 'complete';

export interface Round {
  id: Id;
  specKey: string;
  name: string;
  /** Group this round is for, or null when combined. */
  groupId: Id | null;
  sequence: number;
  /** Car ids racing in this round. */
  entries: Id[];
  /** Run order. Voided heats stay in place for the audit trail. */
  heats: Heat[];
  status: RoundStatus;
}

export interface Standing {
  carId: Id;
  rank: number;
  score: number;
  scoreLabel: string;
  runs: number;
  expectedRuns: number;
  complete: boolean;
  bestTime: number | null;
  avgTime: number | null;
  dnfCount: number;
  wins: number;
}

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

export type AwardKind = 'speed' | 'design' | 'custom';

export interface Award {
  id: Id;
  name: string;
  kind: AwardKind;
  /** Restrict to one group, or null for the whole pack. */
  groupId: Id | null;
  carId: Id | null;
  /** For speed awards: which standings decide the winner. */
  speed?: { roundKey: string; place: number };
  sortOrder: number;
  presentedAt?: string;
  /** Shortlist the judges built before picking the winner. */
  nominees?: Id[];
}

// ---------------------------------------------------------------------------
// Judging aids
// ---------------------------------------------------------------------------

export interface JudgingCriterion {
  id: Id;
  name: string;
  /** Highest score for this criterion; scores run 1..max. */
  max: number;
}

export interface Judge {
  id: Id;
  name: string;
}

export interface Judging {
  /** Cars a judge has looked at, so the table can be walked without missing one. */
  seenCarIds: Id[];
  /** Optional scoring rubric. Empty means the judges just pick. */
  criteria: JudgingCriterion[];
  /** The people scoring. Each has their own sheet; totals average across them. */
  judges: Judge[];
  /** sheets[judgeId][carId][criterionId]. */
  sheets: Record<Id, Record<Id, Record<Id, number>>>;
  /** Older saves had one shared sheet; it becomes the first judge's on load. */
  scores?: Record<Id, Record<Id, number>>;
}

/** Fresh copies of a judging block, so engines never share the defaults. */
export function normalizeJudging(j: Partial<Judging> | undefined): Judging {
  const judges = (j?.judges ?? []).map((x) => ({ ...x }));
  const sheets: Judging['sheets'] = {};
  for (const [judgeId, sheet] of Object.entries(j?.sheets ?? {})) {
    sheets[judgeId] = Object.fromEntries(Object.entries(sheet).map(([carId, s]) => [carId, { ...s }]));
  }
  if (j?.scores && Object.keys(j.scores).length && judges.length === 0) {
    const judge: Judge = { id: 'judge-1', name: 'Judge 1' };
    judges.push(judge);
    sheets[judge.id] = Object.fromEntries(Object.entries(j.scores).map(([carId, s]) => [carId, { ...s }]));
  }
  return { seenCarIds: [...(j?.seenCarIds ?? [])], criteria: (j?.criteria ?? []).map((c) => ({ ...c })), judges, sheets };
}

export const JUDGING_CRITERIA_PRESETS: { name: string; max: number }[] = [
  { name: 'Paint and finish', max: 10 },
  { name: 'Creativity', max: 10 },
  { name: 'Craftsmanship', max: 10 },
  { name: 'Scout did the work', max: 5 },
];

// ---------------------------------------------------------------------------
// The event
// ---------------------------------------------------------------------------

export interface DerbySettings {
  /** Time substituted for a DNF in time-based scoring. */
  dnfTimeSec: number;
  /** After the gate opens, lanes that have not reported by this time are DNF. */
  heatTimeoutSec: number;
  maxWeightOz: number;
  /** When true, a car must have a passed inspection to be scheduled. */
  requireInspectionPass: boolean;
  /** Where a re-run heat goes: immediately next, or at the end of the round. */
  rerunPlacement: 'next' | 'end';
}

/**
 * What the audience screen shows. `auto` follows the race; the other modes are
 * set by the coordinator for the welcome slide, standings and the ceremony.
 */
export type PresentationMode = 'auto' | 'welcome' | 'standings' | 'awards' | 'sponsors';

/**
 * Where the show is. The coordinator steps through these with one button;
 * the audience screen follows. `mode` other than 'auto' overrides it.
 */
export type ShowStage = 'welcome' | 'round-intro' | 'racing' | 'standings' | 'awards';

export interface Presentation {
  mode: PresentationMode;
  stage: ShowStage;
  /** The round the show is on (intro, racing or standings). */
  stageRoundId: Id | null;
  /** Round to show in standings mode; null = the current or last round. */
  standingsRoundId: Id | null;
  /** Awards revealed so far during the ceremony, in reveal order. */
  revealedAwardIds: Id[];
  /** Award whose shortlist is on screen, just before its winner is revealed. */
  nomineesAwardId: Id | null;
  /** Free-text line on the welcome slide, e.g. "Racing starts at 10:00". */
  message: string;
  /** How long a finished heat's result stays on screen before the next lineup. */
  resultHoldSec: number;
  soundEnabled: boolean;
  /** Force the result view (with replay) for this heat until cleared. */
  replayHeatId: Id | null;
  /** Playback rate for replay clips, e.g. 0.5 for half speed. */
  replaySpeed: number;
  /** Seconds of footage to keep before the first car is expected at the line. */
  replayPreRollSec: number;
  /** Seconds to keep rolling after the last car that actually finishes. */
  replayTailSec: number;
  /** Pin a round's intro card on the audience screen until cleared. */
  introRoundId: Id | null;
  /** How long the automatic round intro shows before the first lineup. */
  introHoldSec: number;
  /** Look of the audience screen; the ids and default live in the web app's theme list. */
  theme: string;
}

/**
 * People's-choice voting: the audience picks some design awards from their
 * phones. One ballot per phone (a random voter id the phone keeps); the
 * judges still choose the winner, with the tally in front of them. The
 * optional voting password lives on the server, not here, since the whole
 * event state is visible to every screen.
 */
export interface Ballot {
  open: boolean;
  /** Awards up for a vote; speed awards never are. */
  awardIds: Id[];
  /** Picks each voter may make per award. */
  votesPerAward: number;
  passwordRequired: boolean;
  /** votes[voterId][awardId] = car ids picked. */
  votes: Record<string, Record<Id, Id[]>>;
}

export interface Sponsor {
  id: Id;
  name: string;
  /** Storage key of the sponsor's logo, or null for a name-only card. */
  image: string | null;
}

/** The pack's own look: its logo and the sponsors to thank. */
export interface Branding {
  /** Storage key of the pack logo. */
  logo: string | null;
  sponsors: Sponsor[];
}

export interface Derby {
  id: Id;
  name: string;
  /** ISO date, e.g. 2027-01-23. */
  date: string;
  laneCount: number;
  groups: Group[];
  racers: Racer[];
  cars: Car[];
  format: RaceFormat;
  rounds: Round[];
  /** 1-based lanes currently out of service. */
  deadLanes: number[];
  awards: Award[];
  judging: Judging;
  settings: DerbySettings;
  presentation: Presentation;
  branding: Branding;
  ballot: Ballot;
}

export const DEFAULT_SETTINGS: DerbySettings = {
  dnfTimeSec: 9.9999,
  heatTimeoutSec: 10,
  maxWeightOz: 5.0,
  requireInspectionPass: false,
  rerunPlacement: 'next',
};

export const DEFAULT_PRESENTATION: Presentation = {
  mode: 'auto',
  stage: 'welcome',
  stageRoundId: null,
  standingsRoundId: null,
  revealedAwardIds: [],
  nomineesAwardId: null,
  message: '',
  resultHoldSec: 10,
  soundEnabled: true,
  replayHeatId: null,
  replaySpeed: 0.5,
  replayPreRollSec: 1.0,
  replayTailSec: 1.5,
  introRoundId: null,
  introHoldSec: 10,
  theme: 'cartoon',
};

/** Fill in fields added after a derby was saved, so old snapshots keep loading. */
export function normalizeDerby(state: Derby): Derby {
  return {
    ...state,
    deadLanes: state.deadLanes ?? [],
    awards: state.awards ?? [],
    // Fresh arrays and objects every time: the engine mutates these in place,
    // so sharing the defaults would leak one derby's judging into the next.
    judging: normalizeJudging(state.judging),
    settings: { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) },
    presentation: { ...DEFAULT_PRESENTATION, ...(state.presentation ?? {}), revealedAwardIds: [...(state.presentation?.revealedAwardIds ?? [])] },
    branding: { logo: state.branding?.logo ?? null, sponsors: (state.branding?.sponsors ?? []).map((s) => ({ ...s })) },
    ballot: {
      open: state.ballot?.open ?? false,
      awardIds: [...(state.ballot?.awardIds ?? [])],
      votesPerAward: state.ballot?.votesPerAward ?? 1,
      passwordRequired: state.ballot?.passwordRequired ?? false,
      votes: Object.fromEntries(Object.entries(state.ballot?.votes ?? {}).map(([voter, byAward]) => [voter, Object.fromEntries(Object.entries(byAward).map(([a, cars]) => [a, [...cars]]))])),
    },
  };
}
