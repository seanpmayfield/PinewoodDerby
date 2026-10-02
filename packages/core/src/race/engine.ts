/**
 * The race engine: every mutation of a `Derby` goes through here.
 *
 * It is deliberately synchronous and side-effect free apart from calling the
 * change listeners, so the server can snapshot the state after each command
 * and any screen can be rebuilt from the state alone.
 */

import { newId, shuffle } from '../model/ids.js';
import {
  DEFAULT_PRESENTATION,
  DEFAULT_SETTINGS,
  normalizeDerby,
  type Presentation,
  type ShowStage,
  type CarShot,
  type Sponsor,
  type Judge,
  type Award,
  type Car,
  type Derby,
  type DerbySettings,
  type Group,
  type GroupKind,
  type Heat,
  type Id,
  type Inspection,
  type Racer,
  type RaceFormat,
  type Round,
  type RoundSpec,
  type Standing,
  type JudgingCriterion,
} from '../model/types.js';
import { DEN_THEN_FINAL, syncFormatWithPreset } from '../format/presets.js';
import { generateChart } from '../schedule/chart.js';
import { packHeats, type PackNeed } from '../schedule/pack.js';
import { computePlaces, computeStandings, higherIsBetter } from '../scoring/index.js';
import type { RosterRow } from '../roster/csv.js';

export class DerbyError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DerbyError';
  }
}

export interface EngineOptions {
  random?: () => number;
  now?: () => string;
}

export interface CreateDerbyInput {
  name: string;
  date?: string;
  laneCount?: number;
  format?: RaceFormat;
  settings?: Partial<DerbySettings>;
}

export interface LaneTimeInput {
  lane: number;
  timeSec: number | null;
}

type ChangeListener = (state: Derby, change: string) => void;

/** "Tigers Den Races", unless the group is already named in the spec (an "Open Class" round for the Open Class group). */
function scopedName(specName: string, group: Group | null): string {
  if (!group) return specName;
  return specName.toLowerCase().includes(group.name.trim().toLowerCase()) ? specName : `${group.name} ${specName}`;
}

export class DerbyEngine {
  private listeners = new Set<ChangeListener>();
  private readonly random: () => number;
  private readonly now: () => string;

  public state: Derby;

  constructor(state: Derby, options: EngineOptions = {}) {
    this.state = normalizeDerby(state);
    this.state.format = syncFormatWithPreset(this.state.format);
    this.migratePhotos();
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  static create(input: CreateDerbyInput, options: EngineOptions = {}): DerbyEngine {
    const state: Derby = {
      id: newId(),
      name: input.name,
      date: input.date ?? new Date().toISOString().slice(0, 10),
      laneCount: input.laneCount ?? 4,
      groups: [],
      racers: [],
      cars: [],
      format: input.format ?? DEN_THEN_FINAL,
      rounds: [],
      deadLanes: [],
      awards: [],
      judging: { seenCarIds: [], criteria: [], judges: [], sheets: {} },
      settings: { ...DEFAULT_SETTINGS, ...input.settings },
      presentation: { ...DEFAULT_PRESENTATION },
      branding: { logo: null, sponsors: [] },
    };
    return new DerbyEngine(state, options);
  }

  // -------------------------------------------------------------------------
  // Change tracking
  // -------------------------------------------------------------------------

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(change: string): void {
    for (const listener of this.listeners) listener(this.state, change);
  }

  snapshot(): Derby {
    return structuredClone(this.state);
  }

  // -------------------------------------------------------------------------
  // Settings and format
  // -------------------------------------------------------------------------

  updateSettings(patch: Partial<DerbySettings>): void {
    this.state.settings = { ...this.state.settings, ...patch };
    this.commit('settings');
  }

  updateDerby(patch: Partial<Pick<Derby, 'name' | 'date' | 'laneCount'>>): void {
    if (patch.laneCount !== undefined && this.state.rounds.length > 0) {
      throw new DerbyError('Lane count cannot change after racing has started.', 'racing-started');
    }
    Object.assign(this.state, patch);
    this.commit('derby');
  }

  setFormat(format: RaceFormat): void {
    if (this.state.rounds.length > 0) {
      throw new DerbyError('The race format cannot change after racing has started.', 'racing-started');
    }
    this.state.format = format;
    this.commit('format');
  }

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------

  addGroup(input: { name: string; kind: GroupKind; parentId?: Id | null }): Group {
    const group: Group = {
      id: newId(),
      name: input.name.trim(),
      kind: input.kind,
      parentId: input.parentId ?? null,
      sortOrder: this.state.groups.length,
    };
    this.state.groups.push(group);
    this.commit('groups');
    return group;
  }

  updateGroup(id: Id, patch: Partial<Omit<Group, 'id'>>): Group {
    const group = this.requireGroup(id);
    Object.assign(group, patch);
    this.commit('groups');
    return group;
  }

  /** The pack group, created on demand. */
  pack(): Group {
    const existing = this.state.groups.find((g) => g.kind === 'pack');
    return existing ?? this.addGroup({ name: 'Pack', kind: 'pack' });
  }

  /** The den (or class) with this name, case-insensitively, created under the pack if new. */
  private findOrCreateGroup(name: string): Group {
    const wanted = name.trim().toLowerCase();
    const existing = this.state.groups.find((g) => g.kind !== 'pack' && g.name.toLowerCase() === wanted);
    return existing ?? this.addGroup({ name, kind: 'den', parentId: this.pack().id });
  }

  groupsOfKind(kind: GroupKind): Group[] {
    return this.state.groups.filter((g) => g.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // -------------------------------------------------------------------------
  // Racers
  // -------------------------------------------------------------------------

  addRacer(input: { firstName: string; lastName: string; groupId: Id; rank?: string; notes?: string }): Racer {
    this.requireGroup(input.groupId);
    const racer: Racer = {
      id: newId(),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      groupId: input.groupId,
      rank: input.rank,
      checkedIn: false,
      notes: input.notes,
    };
    this.state.racers.push(racer);
    this.commit('racers');
    return racer;
  }

  updateRacer(id: Id, patch: Partial<Omit<Racer, 'id'>>): Racer {
    const racer = this.requireRacer(id);
    if (patch.groupId) this.requireGroup(patch.groupId);
    Object.assign(racer, patch);
    this.commit('racers');
    return racer;
  }

  removeRacer(id: Id): void {
    this.requireRacer(id);
    const cars = this.state.cars.filter((c) => c.racerId === id);
    for (const car of cars) {
      if (this.carHasResults(car.id)) {
        throw new DerbyError('This racer has race results. Withdraw the car instead.', 'has-results');
      }
    }
    this.state.cars = this.state.cars.filter((c) => c.racerId !== id);
    this.state.racers = this.state.racers.filter((r) => r.id !== id);
    this.commit('racers');
  }

  setCheckedIn(racerId: Id, checkedIn: boolean): Racer {
    const racer = this.requireRacer(racerId);
    racer.checkedIn = checkedIn;
    this.commit('racers');
    return racer;
  }

  /**
   * Copy dens, racers and cars from another event into this (empty) one:
   * names, ranks, car numbers and car names. Results, check-ins, weights,
   * inspections, photos and videos are not carried over.
   */
  adoptRoster(from: Derby): { racers: number; cars: number } {
    if (this.state.rounds.length > 0 || this.state.racers.length > 0) throw new DerbyError('The roster can only be copied into an empty event.', 'bad-state');
    this.state.groups = from.groups.map((g) => ({ ...g }));
    this.state.racers = from.racers.map((r) => ({ ...r, checkedIn: false, headshot: undefined }));
    this.state.cars = from.cars
      .filter((c) => !c.withdrawn)
      .map((c) => ({ id: c.id, racerId: c.racerId, number: c.number, name: c.name, groupId: c.groupId, inspection: { status: 'pending', checks: {} }, withdrawn: false }));
    this.commit('import');
    return { racers: this.state.racers.length, cars: this.state.cars.length };
  }

  /** Import roster rows, creating dens as needed. Returns what was created. */
  importRoster(rows: RosterRow[]): { racers: Racer[]; cars: Car[] } {
    const racers: Racer[] = [];
    const cars: Car[] = [];
    for (const row of rows) {
      const group = this.findOrCreateGroup(row.den?.trim() || 'Unassigned');
      const racer = this.addRacer({ firstName: row.firstName, lastName: row.lastName, groupId: group.id, rank: row.rank });
      const car = this.addCar({ racerId: racer.id, number: row.carNumber, name: row.carName });
      racers.push(racer);
      cars.push(car);
    }
    this.commit('import');
    return { racers, cars };
  }

  // -------------------------------------------------------------------------
  // Cars
  // -------------------------------------------------------------------------

  addCar(input: { racerId: Id; number?: number; name?: string; groupId?: Id }): Car {
    this.requireRacer(input.racerId);
    if (input.groupId) this.requireGroup(input.groupId);
    let number = input.number;
    if (number !== undefined && this.state.cars.some((c) => c.number === number)) {
      number = undefined;
    }
    const car: Car = {
      id: newId(),
      racerId: input.racerId,
      number: number ?? this.nextCarNumber(),
      name: input.name,
      groupId: input.groupId,
      inspection: { status: 'pending', checks: {} },
      withdrawn: false,
    };
    this.state.cars.push(car);
    this.commit('cars');
    return car;
  }

  updateCar(id: Id, patch: Partial<Omit<Car, 'id' | 'inspection'>>): Car {
    const car = this.requireCar(id);
    if (patch.number !== undefined && this.state.cars.some((c) => c.id !== id && c.number === patch.number)) {
      throw new DerbyError(`Car number ${patch.number} is already taken.`, 'duplicate-number');
    }
    Object.assign(car, patch);
    this.commit('cars');
    return car;
  }

  setWeight(carId: Id, weightOz: number | undefined): Car {
    const car = this.requireCar(carId);
    car.weightOz = weightOz;
    if (weightOz !== undefined) {
      car.inspection.checks['weight'] = weightOz <= this.state.settings.maxWeightOz;
    }
    this.commit('cars');
    return car;
  }

  setInspection(carId: Id, patch: Partial<Inspection>): Car {
    const car = this.requireCar(carId);
    car.inspection = {
      ...car.inspection,
      ...patch,
      checks: { ...car.inspection.checks, ...(patch.checks ?? {}) },
      inspectedAt: patch.inspectedAt ?? this.now(),
    };
    this.commit('cars');
    return car;
  }

  setRacerHeadshot(racerId: Id, key: string | undefined): Racer {
    const racer = this.requireRacer(racerId);
    if (key) racer.headshot = key;
    else delete racer.headshot;
    this.commit('racers');
    return racer;
  }

  /** Remove the car's photo. Returns the storage keys that should be deleted. */
  clearCarPhoto(carId: Id): { car: Car; removed: string[] } {
    const car = this.requireCar(carId);
    const shot = car.photo?.side;
    const removed = shot ? [shot.original, shot.crop, shot.cutout].filter((k): k is string => !!k) : [];
    delete car.photo;
    this.commit('cars');
    return { car, removed };
  }

  /** Record one file of the car's photo. Returns the key it replaced, if any, so the caller can delete it. */
  setCarShot(carId: Id, kind: keyof CarShot, key: string): { car: Car; replaced?: string } {
    const car = this.requireCar(carId);
    const side: Partial<CarShot> = { ...(car.photo?.side ?? {}) };
    const replaced = side[kind];
    side[kind] = key;
    car.photo = { side: side as CarShot };
    this.commit('cars');
    return { car, replaced: replaced === key ? undefined : replaced };
  }

  /** Photos saved in older shapes (flat profile/original/cutout keys, or a `shots` map by angle) become `side`. */
  private migratePhotos(): void {
    for (const car of this.state.cars) {
      const p = car.photo;
      if (!p) continue;
      const side = p.side ?? p.shots?.side ?? (p.profile ? { original: p.original ?? p.profile, crop: p.profile, ...(p.cutout ? { cutout: p.cutout } : {}) } : undefined);
      if (side) car.photo = { side };
      else delete car.photo;
    }
  }

  /** Pull a car from the rest of the event. Completed results are kept. */
  withdrawCar(carId: Id, withdrawn = true): Car {
    const car = this.requireCar(carId);
    car.withdrawn = withdrawn;
    for (const round of this.state.rounds) {
      if (round.status !== 'complete' && round.entries.includes(carId)) this.repackRound(round);
    }
    this.commit('cars');
    return car;
  }

  private nextCarNumber(): number {
    const used = new Set(this.state.cars.map((c) => c.number));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  private effectiveGroupId(car: Car): Id {
    return car.groupId ?? this.requireRacer(car.racerId).groupId;
  }

  private isEligible(car: Car): boolean {
    if (car.withdrawn) return false;
    const racer = this.state.racers.find((r) => r.id === car.racerId);
    if (!racer || !racer.checkedIn) return false;
    if (this.state.settings.requireInspectionPass && car.inspection.status !== 'passed') return false;
    return true;
  }

  eligibleCars(groupId?: Id): Car[] {
    return this.state.cars.filter(
      (c) => this.isEligible(c) && (groupId === undefined || this.effectiveGroupId(c) === groupId),
    );
  }

  private carHasResults(carId: Id): boolean {
    return this.state.rounds.some((round) =>
      round.heats.some((h) => h.status === 'finished' && h.lanes.includes(carId)),
    );
  }

  // -------------------------------------------------------------------------
  // Rounds
  // -------------------------------------------------------------------------

  roundSpec(key: string): RoundSpec {
    const spec = this.state.format.rounds.find((r) => r.key === key);
    if (!spec) throw new DerbyError(`No round "${key}" in the race format.`, 'unknown-round');
    return spec;
  }

  roundsForSpec(key: string): Round[] {
    return this.state.rounds.filter((r) => r.specKey === key);
  }

  private getRound(id: Id): Round {
    const round = this.state.rounds.find((r) => r.id === id);
    if (!round) throw new DerbyError('Round not found.', 'not-found');
    return round;
  }

  /** The round currently being run, or the next one to run. */
  activeRound(): Round | undefined {
    return this.state.rounds.find((r) => r.status !== 'complete');
  }

  /** Generate the schedule for a round spec. Per-group specs create one round per group. */
  startRound(specKey: string): Round[] {
    const spec = this.roundSpec(specKey);
    if (this.roundsForSpec(specKey).length > 0) {
      throw new DerbyError(`Round "${spec.name}" has already been scheduled.`, 'already-scheduled');
    }
    if (spec.entry.kind === 'advance') {
      const sources = this.roundsForSpec(spec.entry.fromRound);
      if (sources.length === 0) {
        throw new DerbyError(`Run "${spec.entry.fromRound}" before "${spec.key}".`, 'source-not-run');
      }
      if (sources.some((r) => r.status !== 'complete')) {
        throw new DerbyError(`Finish every "${spec.entry.fromRound}" round first.`, 'source-incomplete');
      }
    }

    const created: Round[] = [];
    if (spec.scope === 'per-group') {
      for (const group of this.groupsOfKind(spec.groupKind ?? 'den')) {
        const entries = this.resolveEntries(spec, group.id);
        if (entries.length === 0) continue;
        created.push(this.buildRound(spec, group, entries));
      }
    } else {
      const entries = this.resolveEntries(spec, null);
      if (entries.length > 0) created.push(this.buildRound(spec, null, entries));
    }
    if (created.length === 0) {
      throw new DerbyError('No eligible cars for this round. Check people in first.', 'no-entries');
    }
    this.commit('rounds');
    return created;
  }

  private resolveEntries(spec: RoundSpec, groupId: Id | null): Id[] {
    if (spec.entry.kind === 'all') {
      if (groupId !== null) return this.eligibleCars(groupId).map((c) => c.id);
      // Combined round: dens only unless the format says otherwise, so the open
      // class never races against the scouts.
      const kinds = new Set<GroupKind>(spec.entry.groupKinds ?? ['den']);
      return this.eligibleCars().filter((c) => kinds.has(this.requireGroup(this.effectiveGroupId(c)).kind)).map((c) => c.id);
    }
    const rule = spec.entry;
    let sources = this.roundsForSpec(rule.fromRound);
    if (groupId !== null) sources = sources.filter((r) => r.groupId === groupId);
    const chosen = new Set<Id>();
    const standingsBySource = sources.map((round) => this.standings(round.id).filter((s) => this.isEligibleId(s.carId)));

    if (rule.perGroup) {
      for (const standings of standingsBySource) {
        for (const s of standings.slice(0, rule.perGroup)) chosen.add(s.carId);
      }
    }
    if (rule.overall) {
      const sourceSpec = this.roundSpec(rule.fromRound);
      const direction = higherIsBetter(sourceSpec.scoring) ? -1 : 1;
      const pool = standingsBySource
        .flat()
        .filter((s) => !chosen.has(s.carId))
        .sort((a, b) => (a.score - b.score) * direction || a.rank - b.rank);
      for (const s of pool.slice(0, rule.overall)) chosen.add(s.carId);
    }
    return [...chosen];
  }

  private isEligibleId(carId: Id): boolean {
    const car = this.state.cars.find((c) => c.id === carId);
    return !!car && this.isEligible(car);
  }

  private buildRound(spec: RoundSpec, group: Group | null, entryIds: Id[]): Round {
    const entries = shuffle(entryIds, this.random);
    const round: Round = {
      id: newId(),
      specKey: spec.key,
      name: scopedName(spec.name, group),
      groupId: group?.id ?? null,
      sequence: this.state.rounds.length + 1,
      entries,
      heats: [],
      status: 'scheduled',
    };
    const L = this.state.laneCount;
    if (this.state.deadLanes.length === 0) {
      const chart = generateChart(entries.length, L, spec.passes);
      round.heats = chart.map((lanes, i) =>
        this.makeHeat(round.id, i + 1, lanes.map((idx) => (idx === null ? null : entries[idx]!))),
      );
    } else {
      const needs: PackNeed[] = entries.map((carId) => ({ carId, runsNeeded: spec.passes * L, lanesUsed: [] }));
      round.heats = packHeats(needs, L, this.state.deadLanes).map((lanes, i) => this.makeHeat(round.id, i + 1, lanes));
    }
    this.state.rounds.push(round);
    return round;
  }

  /** One more than the highest heat number in the round, so re-runs and re-packs never collide. */
  private nextHeatNumber(round: Round): number {
    return Math.max(0, ...round.heats.map((h) => h.number)) + 1;
  }

  private makeHeat(roundId: Id, number: number, lanes: (Id | null)[], extra: Partial<Heat> = {}): Heat {
    return { id: newId(), roundId, number, lanes, status: 'pending', attempt: 1, ...extra };
  }

  /**
   * Back to the very beginning of race day: every round, result, replay and
   * award winner is cleared and the welcome slide goes up. The roster,
   * check-ins, weights, inspections and photos are kept.
   */
  resetRaces(): void {
    this.state.rounds = [];
    this.state.awards = this.state.awards.filter((a) => a.kind !== 'speed').map((a) => ({ ...a, carId: null, presentedAt: undefined }));
    this.state.presentation = { ...this.state.presentation, mode: 'auto', stage: 'welcome', stageRoundId: null, introRoundId: null, replayHeatId: null, standingsRoundId: null, revealedAwardIds: [], nomineesAwardId: null };
    this.commit('reset-races');
  }

  // -------------------------------------------------------------------------
  // Heats
  // -------------------------------------------------------------------------

  getHeat(heatId: Id): { round: Round; heat: Heat } {
    for (const round of this.state.rounds) {
      const heat = round.heats.find((h) => h.id === heatId);
      if (heat) return { round, heat };
    }
    throw new DerbyError('Heat not found.', 'not-found');
  }

  /** Heats in run order, voided ones excluded. */
  heatOrder(round: Round): Heat[] {
    return round.heats.filter((h) => h.status !== 'voided');
  }

  /** 1-based position of a heat among the round's non-voided heats. */
  heatPosition(heatId: Id): { position: number; total: number } {
    const { round } = this.getHeat(heatId);
    const order = this.heatOrder(round);
    return { position: order.findIndex((h) => h.id === heatId) + 1, total: order.length };
  }

  currentHeat(roundId: Id): Heat | undefined {
    const round = this.getRound(roundId);
    return round.heats.find((h) => h.status === 'running') ?? round.heats.find((h) => h.status === 'staged' || h.status === 'pending');
  }

  /** The next `count` heats after the current one, for the on-deck display. */
  onDeck(roundId: Id, count = 2): Heat[] {
    const round = this.getRound(roundId);
    const current = this.currentHeat(roundId);
    const pending = round.heats.filter((h) => h.status === 'pending' || h.status === 'staged');
    return pending.filter((h) => h.id !== current?.id).slice(0, count);
  }

  stageHeat(heatId: Id): Heat {
    const { round, heat } = this.getHeat(heatId);
    if (heat.status !== 'pending') throw new DerbyError('Only a pending heat can be staged.', 'bad-state');
    for (const other of round.heats) if (other.status === 'staged') other.status = 'pending';
    heat.status = 'staged';
    this.commit('heats');
    return heat;
  }

  startHeat(heatId: Id): Heat {
    const { round, heat } = this.getHeat(heatId);
    if (heat.status !== 'pending' && heat.status !== 'staged') {
      throw new DerbyError('This heat has already run.', 'bad-state');
    }
    if (round.heats.some((h) => h.status === 'running')) {
      throw new DerbyError('Another heat is already running.', 'bad-state');
    }
    heat.status = 'running';
    round.status = 'running';
    this.commit('heats');
    return heat;
  }

  /** Record results. Lanes with a car but no time are DNF; lanes not listed are DNF. */
  finishHeat(heatId: Id, times: LaneTimeInput[], source: 'timer' | 'manual' | 'simulator' = 'timer'): Heat {
    const { round, heat } = this.getHeat(heatId);
    if (heat.status === 'finished' || heat.status === 'voided') {
      throw new DerbyError('This heat already has a result. Re-run it instead.', 'bad-state');
    }
    const lanes = heat.lanes.map((carId, i) => {
      const lane = i + 1;
      const input = times.find((t) => t.lane === lane);
      const timeSec = input?.timeSec ?? null;
      return { lane, carId, timeSec: timeSec !== null && timeSec > 0 ? timeSec : null };
    });
    heat.result = { lanes: computePlaces(lanes), recordedAt: this.now(), source };
    heat.status = 'finished';
    round.status = this.heatOrder(round).every((h) => h.status === 'finished') ? 'complete' : 'running';
    this.commit('heats');
    return heat;
  }

  /** Correct a recorded result without re-running (typo, manual timing). */
  amendHeat(heatId: Id, times: LaneTimeInput[]): Heat {
    const { heat } = this.getHeat(heatId);
    if (heat.status !== 'finished') throw new DerbyError('Only a finished heat can be amended.', 'bad-state');
    heat.status = 'running';
    return this.finishHeat(heatId, times, 'manual');
  }

  /**
   * Change which cars were (or will be) in a heat's lanes, e.g. the scouts put
   * the wrong car on a lane and nobody noticed until after the run. Recorded
   * lane times stay with their lanes and are re-scored for the new cars, and
   * the heats still to run are re-planned so every car in the round still gets
   * its full set of runs (a car that raced an extra time simply keeps it).
   */
  setHeatLanes(heatId: Id, lanes: (Id | null)[]): Heat {
    const { round, heat } = this.getHeat(heatId);
    if (heat.status === 'voided') throw new DerbyError('This heat was voided.', 'bad-state');
    if (lanes.length !== this.state.laneCount) throw new DerbyError('One entry per lane is required.', 'bad-args');
    const cars = lanes.filter((c): c is Id => c !== null);
    if (new Set(cars).size !== cars.length) throw new DerbyError('A car cannot be in two lanes.', 'bad-args');
    for (const carId of cars) {
      const car = this.requireCar(carId);
      if (car.withdrawn) throw new DerbyError(`Car #${car.number} is withdrawn.`, 'bad-args');
      if (!round.entries.includes(carId)) round.entries.push(carId);
    }
    if (lanes.every((c, i) => c === heat.lanes[i])) return heat;

    heat.lanes = [...lanes];
    if (heat.status === 'finished' && heat.result) {
      heat.result = {
        ...heat.result,
        lanes: computePlaces(heat.result.lanes.map((l, i) => ({ lane: l.lane, carId: lanes[i] ?? null, timeSec: lanes[i] ? l.timeSec : null }))),
        source: 'manual',
      };
    }
    if (heat.spotlightCarId && !lanes.includes(heat.spotlightCarId)) delete heat.spotlightCarId;
    this.repackRound(round);
    this.commit('heats');
    return heat;
  }

  /**
   * Void a heat (kid stepped on a car, track fault, timer glitch) and schedule
   * it again with the same lane assignments.
   */
  rerunHeat(heatId: Id, reason = ''): Heat {
    const { round, heat } = this.getHeat(heatId);
    if (heat.status === 'voided') throw new DerbyError('This heat is already voided.', 'bad-state');
    if (heat.status === 'pending' || heat.status === 'staged') {
      throw new DerbyError('This heat has not run yet.', 'bad-state');
    }
    heat.status = 'voided';
    heat.voidReason = reason;

    const rerun = this.makeHeat(round.id, this.nextHeatNumber(round), [...heat.lanes], {
      rerunOf: heat.id,
      attempt: heat.attempt + 1,
    });
    if (this.state.settings.rerunPlacement === 'next') {
      const firstPending = round.heats.findIndex((h) => h.status === 'pending' || h.status === 'staged');
      if (firstPending < 0) round.heats.push(rerun);
      else round.heats.splice(firstPending, 0, rerun);
    } else {
      round.heats.push(rerun);
    }
    round.status = 'running';
    this.commit('heats');
    return rerun;
  }

  /**
   * Pick the racer to spotlight for a heat: whoever in the heat has been
   * spotlighted least so far, so every racer gets a turn over the event.
   * Idempotent: a heat keeps its spotlight once chosen.
   */
  assignSpotlight(heatId: Id): Id | null {
    const { heat } = this.getHeat(heatId);
    if (heat.spotlightCarId) return heat.spotlightCarId;
    const counts = new Map<Id, number>();
    for (const round of this.state.rounds) {
      for (const h of round.heats) if (h.spotlightCarId) counts.set(h.spotlightCarId, (counts.get(h.spotlightCarId) ?? 0) + 1);
    }
    const candidates = heat.lanes.filter((c): c is Id => c !== null);
    if (candidates.length === 0) return null;
    // Among the least-spotlighted, prefer the car with the fewest heats still to
    // come: it has the fewest other chances, so taking it now keeps everyone covered.
    const upcoming = new Map<Id, number>();
    for (const round of this.state.rounds) {
      for (const h of round.heats) {
        if (h.id === heatId || h.status === 'finished' || h.status === 'voided') continue;
        for (const c of h.lanes) if (c) upcoming.set(c, (upcoming.get(c) ?? 0) + 1);
      }
    }
    const score = (c: Id) => (counts.get(c) ?? 0) * 1000 + (upcoming.get(c) ?? 0);
    const best = Math.min(...candidates.map(score));
    const pool = candidates.filter((c) => score(c) === best);
    heat.spotlightCarId = pool[Math.floor(this.random() * pool.length)]!;
    this.commit('heats');
    return heat.spotlightCarId;
  }

  /** Attach (or clear) the replay clip recorded for a heat. */
  setHeatReplay(heatId: Id, key: string | undefined): Heat {
    const { heat } = this.getHeat(heatId);
    if (key) heat.replay = key;
    else delete heat.replay;
    this.commit('heats');
    return heat;
  }

  /** Take a lane out of service (or back in). Remaining heats are re-planned. */
  setLaneDead(lane: number, dead: boolean): void {
    if (lane < 1 || lane > this.state.laneCount) throw new DerbyError('No such lane.', 'bad-lane');
    const set = new Set(this.state.deadLanes);
    if (dead) set.add(lane);
    else set.delete(lane);
    this.state.deadLanes = [...set].sort((a, b) => a - b);
    for (const round of this.state.rounds) {
      if (round.status !== 'complete') this.repackRound(round);
    }
    this.commit('lanes');
  }

  /** Late arrival: add a car to a round that is already scheduled or running. */
  addCarToRound(roundId: Id, carId: Id): Round {
    const round = this.getRound(roundId);
    this.requireCar(carId);
    if (round.status === 'complete') throw new DerbyError('This round is already complete.', 'bad-state');
    if (!round.entries.includes(carId)) round.entries.push(carId);
    this.repackRound(round);
    this.commit('rounds');
    return round;
  }

  /**
   * Rebuild the not-yet-run heats of a round from what each car still owes.
   * Finished, voided and running heats are kept as they are.
   */
  private repackRound(round: Round): void {
    const spec = this.roundSpec(round.specKey);
    const L = this.state.laneCount;
    const keep = round.heats.filter((h) => h.status === 'finished' || h.status === 'voided' || h.status === 'running');
    const counted = keep.filter((h) => h.status !== 'voided');

    const needs: PackNeed[] = [];
    for (const carId of round.entries) {
      const car = this.state.cars.find((c) => c.id === carId);
      if (!car || car.withdrawn) continue;
      const lanesUsed: number[] = [];
      for (const heat of counted) {
        const idx = heat.lanes.indexOf(carId);
        if (idx >= 0) lanesUsed.push(idx + 1);
      }
      needs.push({ carId, runsNeeded: spec.passes * L - lanesUsed.length, lanesUsed });
    }
    const last = counted.at(-1);
    const previousHeatCars = last ? last.lanes.filter((c): c is Id => c !== null) : [];
    const packed = packHeats(needs, L, this.state.deadLanes, { previousHeatCars });
    const nextNumber = this.nextHeatNumber(round);
    round.heats = [...keep, ...packed.map((lanes, i) => this.makeHeat(round.id, nextNumber + i, lanes))];
    if (round.status === 'complete' && packed.length > 0) round.status = 'running';
    if (round.status !== 'scheduled' && packed.length === 0 && counted.every((h) => h.status === 'finished')) {
      round.status = 'complete';
    }
  }

  // -------------------------------------------------------------------------
  // Standings
  // -------------------------------------------------------------------------

  standings(roundId: Id): Standing[] {
    const round = this.getRound(roundId);
    const spec = this.roundSpec(round.specKey);
    return computeStandings(round, spec, this.state.settings, (carId) => this.requireCar(carId).number);
  }

  // -------------------------------------------------------------------------
  // Awards
  // -------------------------------------------------------------------------

  addAward(input: { name: string; kind: Award['kind']; groupId?: Id | null; speed?: Award['speed'] }): Award {
    const award: Award = {
      id: newId(),
      name: input.name.trim(),
      kind: input.kind,
      groupId: input.groupId ?? null,
      carId: null,
      speed: input.speed,
      sortOrder: this.state.awards.length,
    };
    this.state.awards.push(award);
    this.commit('awards');
    return award;
  }

  updateAward(id: Id, patch: Partial<Omit<Award, 'id'>>): Award {
    const award = this.state.awards.find((a) => a.id === id);
    if (!award) throw new DerbyError('Award not found.', 'not-found');
    Object.assign(award, patch);
    this.commit('awards');
    return award;
  }

  removeAward(id: Id): void {
    this.state.awards = this.state.awards.filter((a) => a.id !== id);
    this.commit('awards');
  }

  setAwardWinner(awardId: Id, carId: Id | null): Award {
    if (carId) this.requireCar(carId);
    return this.updateAward(awardId, { carId });
  }

  /** Set the presentation order of judged awards. Ids not listed keep their relative order after the listed ones. */
  reorderAwards(ids: Id[]): void {
    const position = new Map(ids.map((id, i) => [id, i]));
    const rest = this.state.awards.filter((a) => !position.has(a.id)).sort((a, b) => a.sortOrder - b.sortOrder);
    rest.forEach((a, i) => position.set(a.id, ids.length + i));
    for (const award of this.state.awards) award.sortOrder = position.get(award.id) ?? award.sortOrder;
    this.commit('awards');
  }

  // ---- branding: pack logo and sponsors -------------------------------------

  /** Set or clear the pack logo. Returns the key it replaced, so the caller can delete the file. */
  setLogo(key: string | null): string | null {
    const previous = this.state.branding.logo;
    this.state.branding.logo = key;
    this.commit('branding');
    return previous === key ? null : previous;
  }

  addSponsor(name: string): Sponsor {
    const sponsor: Sponsor = { id: newId(), name: name.trim(), image: null };
    this.state.branding.sponsors.push(sponsor);
    this.commit('branding');
    return sponsor;
  }

  requireSponsor(id: Id): Sponsor {
    const sponsor = this.state.branding.sponsors.find((s) => s.id === id);
    if (!sponsor) throw new DerbyError('Sponsor not found.', 'not-found');
    return sponsor;
  }

  /** Rename a sponsor or swap its image. Returns the image key replaced, if any. */
  updateSponsor(id: Id, patch: { name?: string; image?: string | null }): { sponsor: Sponsor; replaced: string | null } {
    const sponsor = this.requireSponsor(id);
    const previous = sponsor.image;
    if (patch.name !== undefined) sponsor.name = patch.name.trim();
    if (patch.image !== undefined) sponsor.image = patch.image;
    this.commit('branding');
    return { sponsor, replaced: patch.image !== undefined && previous !== sponsor.image ? previous : null };
  }

  /** Remove a sponsor. Returns its image key, if any, so the caller can delete the file. */
  removeSponsor(id: Id): string | null {
    const sponsor = this.requireSponsor(id);
    this.state.branding.sponsors = this.state.branding.sponsors.filter((s) => s.id !== id);
    this.commit('branding');
    return sponsor.image;
  }

  /** Put the listed sponsors first, in that order; any others keep their order after them. */
  reorderSponsors(ids: Id[]): void {
    const list = this.state.branding.sponsors;
    const first = ids.map((id) => list.find((s) => s.id === id)).filter((s): s is Sponsor => !!s);
    const rest = list.filter((s) => !first.includes(s));
    this.state.branding.sponsors = [...first, ...rest];
    this.commit('branding');
  }

  /** Every award a car has won so far, for spreading awards around. */
  awardsForCar(carId: Id): Award[] {
    return this.state.awards.filter((a) => a.carId === carId);
  }

  // --- judging aids ---------------------------------------------------------

  /** Add a car to (or drop it from) an award's shortlist. */
  setAwardNominee(awardId: Id, carId: Id, nominated: boolean): Award {
    const award = this.state.awards.find((a) => a.id === awardId);
    if (!award) throw new DerbyError('Award not found.', 'not-found');
    this.requireCar(carId);
    const list = (award.nominees ?? []).filter((id) => id !== carId);
    if (nominated) list.push(carId);
    award.nominees = list;
    this.commit('awards');
    return award;
  }

  /** Tick a car as looked at by the judges. */
  setCarSeen(carId: Id, seen: boolean): void {
    this.requireCar(carId);
    const list = this.state.judging.seenCarIds.filter((id) => id !== carId);
    if (seen) list.push(carId);
    this.state.judging.seenCarIds = list;
    this.commit('judging');
  }

  /** Replace the rubric. Scores for criteria that are gone are dropped; scores above a lowered max are clamped. */
  setJudgingCriteria(criteria: { id?: Id; name: string; max: number }[]): JudgingCriterion[] {
    const next: JudgingCriterion[] = criteria.map((c) => {
      const name = c.name.trim();
      if (!name) throw new DerbyError('A criterion needs a name.', 'bad-args');
      const max = Math.round(c.max);
      if (!Number.isFinite(max) || max < 1 || max > 100) throw new DerbyError('Max score must be between 1 and 100.', 'bad-args');
      return { id: c.id ?? newId(), name, max };
    });
    const keep = new Map(next.map((c) => [c.id, c.max]));
    for (const sheet of Object.values(this.state.judging.sheets)) {
      for (const [carId, scores] of Object.entries(sheet)) {
        const cleaned: Record<Id, number> = {};
        for (const [cid, value] of Object.entries(scores)) {
          const max = keep.get(cid);
          if (max !== undefined) cleaned[cid] = Math.min(value, max);
        }
        if (Object.keys(cleaned).length) sheet[carId] = cleaned;
        else delete sheet[carId];
      }
    }
    this.state.judging.criteria = next;
    this.commit('judging');
    return next;
  }

  addJudge(name: string): Judge {
    const trimmed = name.trim();
    if (!trimmed) throw new DerbyError('A judge needs a name.', 'bad-args');
    const judge: Judge = { id: newId(), name: trimmed };
    this.state.judging.judges.push(judge);
    this.commit('judging');
    return judge;
  }

  requireJudge(id: Id): Judge {
    const judge = this.state.judging.judges.find((j) => j.id === id);
    if (!judge) throw new DerbyError('Judge not found.', 'not-found');
    return judge;
  }

  renameJudge(id: Id, name: string): Judge {
    const judge = this.requireJudge(id);
    const trimmed = name.trim();
    if (!trimmed) throw new DerbyError('A judge needs a name.', 'bad-args');
    judge.name = trimmed;
    this.commit('judging');
    return judge;
  }

  /** Remove a judge and every score on their sheet. */
  removeJudge(id: Id): void {
    this.requireJudge(id);
    this.state.judging.judges = this.state.judging.judges.filter((j) => j.id !== id);
    delete this.state.judging.sheets[id];
    this.commit('judging');
  }

  /** One judge scores one criterion for a car; null clears it. */
  setCarScore(judgeId: Id, carId: Id, criterionId: Id, value: number | null): void {
    this.requireJudge(judgeId);
    this.requireCar(carId);
    const criterion = this.state.judging.criteria.find((c) => c.id === criterionId);
    if (!criterion) throw new DerbyError('Criterion not found.', 'not-found');
    const sheet = this.state.judging.sheets[judgeId] ?? {};
    const scores = sheet[carId] ?? {};
    if (value === null) delete scores[criterionId];
    else {
      const v = Math.round(value);
      if (!Number.isFinite(v) || v < 0 || v > criterion.max) throw new DerbyError(`Score must be between 0 and ${criterion.max}.`, 'bad-args');
      scores[criterionId] = v;
    }
    if (Object.keys(scores).length) sheet[carId] = scores;
    else delete sheet[carId];
    if (Object.keys(sheet).length) this.state.judging.sheets[judgeId] = sheet;
    else delete this.state.judging.sheets[judgeId];
    this.commit('judging');
  }

  /**
   * Rubric total for a car across the judges. Each criterion is the average
   * of the judges who scored it (so a judge who skipped one does not drag the
   * car down); the total sums those, to one decimal. `scored` is how many
   * criteria have at least one score and `judges` how many judges scored
   * anything for this car.
   */
  judgingTotal(carId: Id): { total: number; max: number; scored: number; judges: number } {
    const sheets = this.state.judging.judges.map((j) => this.state.judging.sheets[j.id]?.[carId]).filter((s): s is Record<Id, number> => !!s);
    let total = 0;
    let max = 0;
    let scored = 0;
    for (const c of this.state.judging.criteria) {
      max += c.max;
      const values = sheets.map((s) => s[c.id]).filter((v): v is number => v !== undefined);
      if (values.length) {
        total += values.reduce((a, b) => a + b, 0) / values.length;
        scored++;
      }
    }
    return { total: Math.round(total * 10) / 10, max, scored, judges: sheets.length };
  }

  /** Each judge's own total for a car, for the score sheet. */
  judgeTotals(carId: Id): { judge: Judge; total: number; scored: number }[] {
    return this.state.judging.judges.map((judge) => {
      const scores = this.state.judging.sheets[judge.id]?.[carId] ?? {};
      let total = 0;
      let scored = 0;
      for (const c of this.state.judging.criteria) {
        const v = scores[c.id];
        if (v !== undefined) {
          total += v;
          scored++;
        }
      }
      return { judge, total, scored };
    });
  }

  /** Create the format's speed awards (once), one per group for per-group awards. */
  generateSpeedAwards(): Award[] {
    const created: Award[] = [];
    for (const spec of this.state.format.speedAwards) {
      const roundSpec = this.roundSpec(spec.roundKey);
      const targets: (Group | null)[] =
        spec.scope === 'per-group' ? this.groupsOfKind(roundSpec.groupKind ?? 'den') : [null];
      for (const group of targets) {
        const groupId = group?.id ?? null;
        const exists = this.state.awards.some(
          (a) => a.kind === 'speed' && a.speed?.roundKey === spec.roundKey && a.speed.place === spec.place && a.groupId === groupId,
        );
        if (exists) continue;
        created.push(
          this.addAward({
            name: scopedName(spec.name, group),
            kind: 'speed',
            groupId,
            speed: { roundKey: spec.roundKey, place: spec.place },
          }),
        );
      }
    }
    return created;
  }

  /** Fill in speed award winners from the standings. Safe to call repeatedly. */
  computeSpeedAwards(): Award[] {
    const updated: Award[] = [];
    for (const award of this.state.awards) {
      if (award.kind !== 'speed' || !award.speed) continue;
      const speed = award.speed;
      const round = this.roundsForSpec(speed.roundKey).find((r) => r.groupId === award.groupId);
      if (!round || round.status !== 'complete') continue;
      const winner = this.standings(round.id).find((s) => s.rank === speed.place);
      award.carId = winner?.carId ?? null;
      updated.push(award);
    }
    this.commit('awards');
    return updated;
  }

  // -------------------------------------------------------------------------
  // Audience presentation
  // -------------------------------------------------------------------------

  setPresentation(patch: Partial<Presentation>): Presentation {
    // Choosing what the audience sees always wins over a pinned intro or
    // replay; otherwise the coordinator picks "Awards" and nothing changes.
    const clearsPins = patch.mode !== undefined ? { introRoundId: null, replayHeatId: null } : {};
    this.state.presentation = { ...this.state.presentation, ...clearsPins, ...patch };
    this.commit('presentation');
    return this.state.presentation;
  }

  // ---- the show flow -------------------------------------------------------

  /** Rounds still to run, in order. */
  private pendingRounds(): Round[] {
    return this.state.rounds.filter((r) => r.status !== 'complete').sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Schedule the next round spec that can run (its source rounds complete,
   * and it has entries). Returns the rounds created, or [] when nothing is left.
   */
  private scheduleNextSpec(): Round[] {
    for (const spec of this.state.format.rounds) {
      if (this.roundsForSpec(spec.key).length > 0) continue;
      try {
        return this.startRound(spec.key);
      } catch (err) {
        // No entries (e.g. no open-class groups) or sources not finished: try the next spec.
        if (err instanceof DerbyError && (err.code === 'no-entries' || err.code === 'source-incomplete' || err.code === 'source-not-run')) continue;
        throw err;
      }
    }
    return [];
  }

  /** Welcome slide up; the show is ready to begin. */
  flowReset(): Presentation {
    return this.setPresentation({ mode: 'auto', stage: 'welcome', stageRoundId: null });
  }

  /** Bring up the next round's title card, scheduling the round if needed; the awards when nothing is left. */
  private flowIntroNextRound(): Round | null {
    let next = this.pendingRounds()[0];
    if (!next) next = this.scheduleNextSpec()[0];
    if (!next) {
      this.flowAwards();
      return null;
    }
    this.setPresentation({ mode: 'auto', stage: 'round-intro', stageRoundId: next.id });
    return next;
  }

  /** The awards ceremony: create and fill the speed awards, show the title card. */
  private flowAwards(): void {
    this.generateSpeedAwards();
    this.computeSpeedAwards();
    this.setPresentation({ mode: 'auto', stage: 'awards', stageRoundId: null });
  }

  private nextUnrevealedAward(): Award | undefined {
    const revealed = new Set(this.state.presentation.revealedAwardIds);
    return this.ceremonyOrder().find((a) => !revealed.has(a.id));
  }

  /** The award the ceremony reveals next, and whether its shortlist still has to be shown first. */
  nextAward(): { award: Award; nomineesPending: boolean } | null {
    const award = this.nextUnrevealedAward();
    if (!award) return null;
    const shortlist = (award.nominees ?? []).filter((id) => this.state.cars.some((c) => c.id === id && !c.withdrawn));
    return { award, nomineesPending: shortlist.length > 1 && this.state.presentation.nomineesAwardId !== award.id };
  }

  /**
   * The one "Next" button. What it does depends on where the show is:
   * welcome -> first round intro; intro -> racing (skip the card); racing or
   * standings -> next round's intro (scheduling it if needed) or the awards;
   * awards -> show the nominees, then reveal the award.
   */
  flowNext(): { stage: ShowStage; round: Round | null; award: Award | null; nominees?: boolean } {
    const p = this.state.presentation;
    switch (p.stage) {
      case 'welcome': {
        const round = this.flowIntroNextRound();
        return { stage: this.state.presentation.stage, round, award: null };
      }
      case 'round-intro':
        this.setPresentation({ mode: 'auto', stage: 'racing' });
        return { stage: 'racing', round: this.state.rounds.find((r) => r.id === p.stageRoundId) ?? null, award: null };
      case 'racing':
      case 'standings': {
        const round = this.flowIntroNextRound();
        return { stage: this.state.presentation.stage, round, award: null };
      }
      case 'awards': {
        // With a shortlist of two or more, the first press shows the nominees; the next reveals the winner.
        const next = this.nextAward();
        if (next && next.nomineesPending) {
          this.setPresentation({ mode: 'auto', nomineesAwardId: next.award.id });
          return { stage: 'awards', round: null, award: next.award, nominees: true };
        }
        const award = this.revealNextAward();
        return { stage: 'awards', round: null, award };
      }
    }
  }

  /** Show the current round's standings now (without waiting for it to finish). */
  flowStandings(): void {
    const roundId = this.state.presentation.stageRoundId ?? this.pendingRounds()[0]?.id ?? this.state.rounds[this.state.rounds.length - 1]?.id ?? null;
    this.setPresentation({ mode: 'auto', stage: 'standings', stageRoundId: roundId });
  }

  /** The coordinator armed a heat: the show follows that round. */
  noteArmed(heatId: Id): void {
    const { round } = this.getHeat(heatId);
    const p = this.state.presentation;
    if (p.stage !== 'racing' || p.stageRoundId !== round.id) {
      this.setPresentation({ stage: 'racing', stageRoundId: round.id, introRoundId: null, replayHeatId: null });
    }
  }

  /** Awards in the order they are presented: design awards, then speed from slowest place up. */
  ceremonyOrder(): Award[] {
    const awards = this.state.awards;
    const design = awards.filter((a) => a.kind !== 'speed').sort((a, b) => a.sortOrder - b.sortOrder);
    const groupOrder = new Map(this.state.groups.map((g) => [g.id, g.sortOrder]));
    const speed = awards
      .filter((a) => a.kind === 'speed')
      .sort((a, b) => {
        // Per-group awards before the pack-wide ones; within each, 3rd, 2nd, 1st.
        const ag = a.groupId ? 0 : 1;
        const bg = b.groupId ? 0 : 1;
        if (ag !== bg) return ag - bg;
        if (a.groupId && b.groupId && a.groupId !== b.groupId) {
          return (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0);
        }
        return (b.speed?.place ?? 0) - (a.speed?.place ?? 0);
      });
    return [...design, ...speed];
  }

  /** Reveal the next award in ceremony order. Returns it, or null when all are shown. */
  revealNextAward(): Award | null {
    const next = this.nextUnrevealedAward();
    if (!next) return null;
    this.setPresentation({ mode: 'awards', revealedAwardIds: [...this.state.presentation.revealedAwardIds, next.id], nomineesAwardId: null });
    return next;
  }

  /** Hide the most recently revealed award (undo a premature click). */
  unrevealLastAward(): void {
    this.setPresentation({ revealedAwardIds: this.state.presentation.revealedAwardIds.slice(0, -1), nomineesAwardId: null });
  }

  resetCeremony(): void {
    this.setPresentation({ revealedAwardIds: [], nomineesAwardId: null });
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  private requireGroup(id: Id): Group {
    const group = this.state.groups.find((g) => g.id === id);
    if (!group) throw new DerbyError('Group not found.', 'not-found');
    return group;
  }

  requireRacer(id: Id): Racer {
    const racer = this.state.racers.find((r) => r.id === id);
    if (!racer) throw new DerbyError('Racer not found.', 'not-found');
    return racer;
  }

  requireCar(id: Id): Car {
    const car = this.state.cars.find((c) => c.id === id);
    if (!car) throw new DerbyError('Car not found.', 'not-found');
    return car;
  }

}
