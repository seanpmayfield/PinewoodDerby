import { describe, expect, it } from 'vitest';
import { DerbyEngine, DerbyError } from '../src/race/engine.js';
import { DEN_POINTS_THEN_FINAL, DEN_THEN_FINAL, PACK_AVERAGE_TIME } from '../src/format/presets.js';
import { seededRandom } from '../src/model/ids.js';
import { TimerSession } from '../src/timer/session.js';
import { SimulatedTimerPort } from '../src/timer/simulator.js';
import { normalizeDerby, type Derby, type Round } from '../src/model/types.js';

/** A pack with one den per entry in `sizes` (that many scouts each), everyone checked in. */
function buildPack(sizes: number[], format = DEN_THEN_FINAL, seed = 1): DerbyEngine {
  const engine = DerbyEngine.create({ name: 'Test Derby', laneCount: 4, format }, { random: seededRandom(seed) });
  const pack = engine.addGroup({ name: 'Pack 1', kind: 'pack' });
  sizes.forEach((size, d) => {
    const den = engine.addGroup({ name: `Den ${d + 1}`, kind: 'den', parentId: pack.id });
    for (let i = 0; i < size; i++) {
      const racer = engine.addRacer({ firstName: `Scout${d}${i}`, lastName: 'Test', groupId: den.id });
      engine.addCar({ racerId: racer.id });
      engine.setCheckedIn(racer.id, true);
    }
  });
  return engine;
}

/** Run every heat of a round through the simulator. */
function runRound(engine: DerbyEngine, round: Round, random = seededRandom(7)): void {
  const port = new SimulatedTimerPort({ timeScale: 0, random });
  const session = new TimerSession(port, { heatTimeoutMs: 10_000 });
  session.on('heat-complete', (e) => {
    const heat = engine.currentHeat(round.id)!;
    engine.finishHeat(heat.id, e.lanes, 'simulator');
  });
  let guard = 0;
  while (engine.currentHeat(round.id) && guard++ < 500) {
    const heat = engine.currentHeat(round.id)!;
    engine.startHeat(heat.id);
    const lanes = heat.lanes.map((c, i) => (c ? i + 1 : 0)).filter(Boolean);
    port.setOccupiedLanes(lanes);
    session.arm(lanes);
    port.releaseGate();
  }
}

describe('DerbyEngine roster', () => {
  it('assigns unique car numbers and resolves duplicates on import', () => {
    const engine = buildPack([2]);
    const numbers = engine.state.cars.map((c) => c.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    const { cars } = engine.importRoster([
      { firstName: 'A', lastName: 'B', den: 'Tigers', carNumber: 1 },
      { firstName: 'C', lastName: 'D', den: 'tigers', carNumber: 99 },
    ]);
    expect(cars[0]!.number).not.toBe(1);
    expect(cars[1]!.number).toBe(99);
    expect(engine.groupsOfKind('den').map((g) => g.name)).toContain('Tigers');
    expect(engine.groupsOfKind('den').filter((g) => g.name.toLowerCase() === 'tigers')).toHaveLength(1);
  });

  it('flags overweight cars at weigh-in', () => {
    const engine = buildPack([1]);
    const car = engine.state.cars[0]!;
    engine.setWeight(car.id, 5.2);
    expect(car.inspection.checks['weight']).toBe(false);
    engine.setWeight(car.id, 4.98);
    expect(car.inspection.checks['weight']).toBe(true);
  });

  it('respects the inspection gate when enabled', () => {
    const engine = buildPack([3]);
    engine.updateSettings({ requireInspectionPass: true });
    expect(engine.eligibleCars()).toHaveLength(0);
    engine.setInspection(engine.state.cars[0]!.id, { status: 'passed' });
    expect(engine.eligibleCars()).toHaveLength(1);
  });
});

describe('DerbyEngine racing', () => {
  it('schedules one round per den with every car in every lane once', () => {
    const engine = buildPack([5, 6, 7]);
    const rounds = engine.startRound('den');
    expect(rounds).toHaveLength(3);
    for (const round of rounds) {
      expect(round.heats).toHaveLength(round.entries.length);
      for (const carId of round.entries) {
        const lanes = round.heats.map((h) => h.lanes.indexOf(carId)).filter((i) => i >= 0);
        expect(lanes.sort()).toEqual([0, 1, 2, 3]);
      }
    }
    expect(() => engine.startRound('den')).toThrow(DerbyError);
  });

  it('gives every normalised derby its own judging objects', () => {
    // An old snapshot has no judging block; two engines built from it must not share state.
    const old = { ...buildPack([2]).state } as Record<string, unknown>;
    delete old.judging;
    const first = new DerbyEngine(normalizeDerby(old as unknown as Parameters<typeof normalizeDerby>[0]));
    const car = first.state.cars[0]!;
    first.setCarSeen(car.id, true);
    const [c] = first.setJudgingCriteria([{ name: 'Paint', max: 5 }]);
    const judge = first.addJudge('Sam');
    first.setCarScore(judge.id, car.id, c!.id, 3);
    const second = normalizeDerby(old as unknown as Parameters<typeof normalizeDerby>[0]);
    expect(second.judging).toEqual({ seenCarIds: [], criteria: [], judges: [], sheets: {} });
  });

  it('keeps judging aids: seen ticks, shortlists and a rubric with clamped scores', () => {
    const engine = buildPack([3]);
    const [a, b, c] = engine.state.cars;
    const award = engine.addAward({ name: 'Best in Show', kind: 'design' });

    engine.setCarSeen(a!.id, true);
    engine.setCarSeen(b!.id, true);
    engine.setCarSeen(a!.id, false);
    expect(engine.state.judging.seenCarIds).toEqual([b!.id]);

    engine.setAwardNominee(award.id, a!.id, true);
    engine.setAwardNominee(award.id, c!.id, true);
    engine.setAwardNominee(award.id, a!.id, true);
    expect(engine.state.awards[0]!.nominees).toEqual([c!.id, a!.id]);
    engine.setAwardNominee(award.id, c!.id, false);
    expect(engine.state.awards[0]!.nominees).toEqual([a!.id]);

    const [paint, craft] = engine.setJudgingCriteria([
      { name: 'Paint', max: 10 },
      { name: 'Craft', max: 5 },
    ]);
    const sam = engine.addJudge('Sam');
    engine.setCarScore(sam.id, a!.id, paint!.id, 8);
    engine.setCarScore(sam.id, a!.id, craft!.id, 5);
    engine.setCarScore(sam.id, b!.id, paint!.id, 3);
    expect(engine.judgingTotal(a!.id)).toEqual({ total: 13, max: 15, scored: 2, judges: 1 });
    expect(engine.judgingTotal(b!.id)).toEqual({ total: 3, max: 15, scored: 1, judges: 1 });
    expect(() => engine.setCarScore(sam.id, b!.id, craft!.id, 6)).toThrow(DerbyError);
    expect(() => engine.setCarScore('nobody', b!.id, craft!.id, 1)).toThrow(DerbyError);

    // Lowering a max clamps; dropping a criterion drops its scores.
    engine.setJudgingCriteria([{ id: paint!.id, name: 'Paint', max: 5 }]);
    expect(engine.judgingTotal(a!.id)).toEqual({ total: 5, max: 5, scored: 1, judges: 1 });
    engine.setCarScore(sam.id, b!.id, paint!.id, null);
    expect(engine.state.judging.sheets[sam.id]![b!.id]).toBeUndefined();
  });

  it('averages scores across judges, criterion by criterion', () => {
    const engine = buildPack([2]);
    const [a] = engine.state.cars;
    const [paint, craft] = engine.setJudgingCriteria([
      { name: 'Paint', max: 10 },
      { name: 'Craft', max: 10 },
    ]);
    const sam = engine.addJudge('Sam');
    const dana = engine.addJudge('Dana');
    engine.setCarScore(sam.id, a!.id, paint!.id, 8);
    engine.setCarScore(dana.id, a!.id, paint!.id, 5);
    engine.setCarScore(dana.id, a!.id, craft!.id, 9);
    // Paint averages 6.5; Craft is Dana's alone, 9.
    expect(engine.judgingTotal(a!.id)).toEqual({ total: 15.5, max: 20, scored: 2, judges: 2 });
    expect(engine.judgeTotals(a!.id)).toEqual([
      { judge: sam, total: 8, scored: 1 },
      { judge: dana, total: 14, scored: 2 },
    ]);
    engine.renameJudge(dana.id, ' Dana R. ');
    expect(engine.state.judging.judges[1]!.name).toBe('Dana R.');
    engine.removeJudge(sam.id);
    expect(engine.judgingTotal(a!.id)).toEqual({ total: 14, max: 20, scored: 2, judges: 1 });
    expect(engine.state.judging.sheets[sam.id]).toBeUndefined();

    // A save from when there was one shared sheet becomes the first judge's.
    const snap = engine.snapshot();
    snap.judging = { seenCarIds: [], criteria: snap.judging.criteria, judges: [], sheets: {}, scores: { [a!.id]: { [paint!.id]: 4 } } };
    const reloaded = new DerbyEngine(snap);
    expect(reloaded.state.judging.judges).toEqual([{ id: 'judge-1', name: 'Judge 1' }]);
    expect(reloaded.judgingTotal(a!.id)).toEqual({ total: 4, max: 20, scored: 1, judges: 1 });
    expect(reloaded.state.judging.scores).toBeUndefined();
  });

  it('runs a full event: den races, re-run, advancement, final, awards', () => {
    const engine = buildPack([5, 6, 7]);
    const changes: string[] = [];
    engine.onChange((_, change) => changes.push(change));

    expect(() => engine.startRound('final')).toThrow(/Run "den"/);
    const dens = engine.startRound('den');

    // Run the first den, then void its last heat and re-run it.
    runRound(engine, dens[0]!);
    expect(dens[0]!.status).toBe('complete');
    const last = engine.heatOrder(dens[0]!).at(-1)!;
    const rerun = engine.rerunHeat(last.id, 'car jumped the track');
    expect(last.status).toBe('voided');
    expect(dens[0]!.status).toBe('running');
    expect(rerun.rerunOf).toBe(last.id);
    expect(rerun.attempt).toBe(2);
    expect(rerun.lanes).toEqual(last.lanes);
    runRound(engine, dens[0]!);
    expect(dens[0]!.status).toBe('complete');

    const standings = engine.standings(dens[0]!.id);
    expect(standings.every((s) => s.runs === 4 && s.complete)).toBe(true);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(engine.heatPosition(rerun.id)).toEqual({ position: 5, total: 5 });

    expect(() => engine.startRound('final')).toThrow(/Finish every/);
    runRound(engine, dens[1]!);
    runRound(engine, dens[2]!);

    const [final] = engine.startRound('final');
    expect(final!.entries).toHaveLength(9);
    for (const den of dens) {
      const top3 = engine.standings(den.id).slice(0, 3).map((s) => s.carId);
      for (const id of top3) expect(final!.entries).toContain(id);
    }
    runRound(engine, final!);
    expect(final!.status).toBe('complete');
    expect(engine.activeRound()).toBeUndefined();

    engine.generateSpeedAwards();
    expect(engine.state.awards.filter((a) => a.kind === 'speed')).toHaveLength(3 + 3);
    engine.computeSpeedAwards();
    const first = engine.state.awards.find((a) => a.name === '1st Place')!;
    expect(first.carId).toBe(engine.standings(final!.id)[0]!.carId);
    const denChamp = engine.state.awards.find((a) => a.name === 'Den 2 Den Champion')!;
    expect(denChamp.carId).toBe(engine.standings(dens[1]!.id)[0]!.carId);

    expect(changes).toContain('heats');
  });

  it('re-plans remaining heats when a lane dies mid-round', () => {
    const engine = buildPack([8], PACK_AVERAGE_TIME);
    const [round] = engine.startRound('main');
    // Run three heats, then lane 2 fails.
    for (let i = 0; i < 3; i++) {
      const heat = engine.currentHeat(round!.id)!;
      engine.startHeat(heat.id);
      engine.finishHeat(heat.id, heat.lanes.map((c, l) => ({ lane: l + 1, timeSec: c ? 3 + l / 10 : null })));
    }
    engine.setLaneDead(2, true);
    const pending = round!.heats.filter((h) => h.status === 'pending');
    expect(pending.length).toBeGreaterThan(0);
    for (const heat of pending) expect(heat.lanes[1]).toBeNull();
    runRound(engine, round!);
    for (const s of engine.standings(round!.id)) {
      expect(s.runs).toBe(4);
      expect(s.complete).toBe(true);
    }
  });

  it('handles a late arrival and a withdrawal', () => {
    const engine = buildPack([6], PACK_AVERAGE_TIME);
    const [round] = engine.startRound('main');
    const heat = engine.currentHeat(round!.id)!;
    engine.startHeat(heat.id);
    engine.finishHeat(heat.id, heat.lanes.map((c, l) => ({ lane: l + 1, timeSec: c ? 3.1 : null })));

    const den = engine.groupsOfKind('den')[0]!;
    const late = engine.addRacer({ firstName: 'Late', lastName: 'Arrival', groupId: den.id });
    const lateCar = engine.addCar({ racerId: late.id });
    engine.setCheckedIn(late.id, true);
    engine.addCarToRound(round!.id, lateCar.id);
    expect(round!.entries).toContain(lateCar.id);

    const quitter = round!.entries[0]!;
    engine.withdrawCar(quitter);
    for (const h of round!.heats.filter((h) => h.status === 'pending')) expect(h.lanes).not.toContain(quitter);

    runRound(engine, round!);
    const standings = engine.standings(round!.id);
    expect(standings.find((s) => s.carId === lateCar.id)!.runs).toBe(4);
    for (const s of standings) if (s.carId !== quitter) expect(s.complete).toBe(true);
  });

  it('places a re-run at the end when configured', () => {
    const engine = buildPack([6], PACK_AVERAGE_TIME);
    engine.updateSettings({ rerunPlacement: 'end' });
    const [round] = engine.startRound('main');
    const heat = engine.currentHeat(round!.id)!;
    engine.startHeat(heat.id);
    engine.finishHeat(heat.id, [{ lane: 1, timeSec: 3 }]);
    const rerun = engine.rerunHeat(heat.id);
    expect(round!.heats.at(-1)!.id).toBe(rerun.id);
  });

  it('records DNFs for lanes with no time and lets a result be amended', () => {
    const engine = buildPack([4], PACK_AVERAGE_TIME);
    const [round] = engine.startRound('main');
    const heat = engine.currentHeat(round!.id)!;
    engine.finishHeat(heat.id, [
      { lane: 1, timeSec: 3.2 },
      { lane: 2, timeSec: 3.1 },
    ], 'manual');
    const lanes = heat.result!.lanes;
    expect(lanes[2]!.dnf).toBe(true);
    expect(lanes[3]!.dnf).toBe(true);
    expect(lanes[1]!.place).toBe(1);
    engine.amendHeat(heat.id, [
      { lane: 1, timeSec: 3.0 },
      { lane: 2, timeSec: 3.1 },
      { lane: 3, timeSec: 3.2 },
      { lane: 4, timeSec: 3.3 },
    ]);
    expect(heat.result!.lanes.map((l) => l.place)).toEqual([1, 2, 3, 4]);
    expect(heat.result!.source).toBe('manual');
  });

  it('lets a wrong car be corrected after the fact and re-plans so everyone still gets their runs', () => {
    const engine = buildPack([6], PACK_AVERAGE_TIME);
    const [round] = engine.startRound('main');
    const first = engine.currentHeat(round!.id)!;
    engine.startHeat(first.id);
    engine.finishHeat(first.id, first.lanes.map((c, l) => ({ lane: l + 1, timeSec: c ? 3 + l / 10 : null })));

    // The car in lane 2 was actually a car that was not in this heat at all.
    const wrong = first.lanes[1]!;
    const actual = round!.entries.find((c) => !first.lanes.includes(c))!;
    const lanes = [...first.lanes];
    lanes[1] = actual;
    engine.setHeatLanes(first.id, lanes);

    expect(first.lanes[1]).toBe(actual);
    expect(first.result!.lanes[1]!.carId).toBe(actual);
    expect(first.result!.lanes[1]!.timeSec).toBeCloseTo(3.1, 5);
    expect(first.result!.lanes.map((l) => l.place)).toEqual([1, 2, 3, 4]);
    expect(first.result!.source).toBe('manual');

    // The displaced car owes a full 4 runs, the substituted car owes 3 more; nobody appears twice in a heat.
    runRound(engine, round!);
    const standings = engine.standings(round!.id);
    expect(standings.find((s) => s.carId === wrong)!.runs).toBe(4);
    expect(standings.find((s) => s.carId === actual)!.runs).toBe(4);
    for (const s of standings) expect(s.runs).toBeGreaterThanOrEqual(4);
    for (const heat of round!.heats) {
      const cars = heat.lanes.filter(Boolean);
      expect(new Set(cars).size).toBe(cars.length);
    }
    expect(() => engine.setHeatLanes(first.id, [actual, actual, null, null])).toThrow(/two lanes/);
  });

  it('gives the open class its own round and keeps it out of the scout rounds', () => {
    const engine = buildPack([4, 4]);
    const pack = engine.pack();
    const open = engine.addGroup({ name: 'Open Class', kind: 'class', parentId: pack.id });
    const adults: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = engine.addRacer({ firstName: `Adult${i}`, lastName: 'X', groupId: open.id });
      adults.push(engine.addCar({ racerId: r.id }).id);
      engine.setCheckedIn(r.id, true);
    }
    const dens = engine.startRound('den');
    expect(dens).toHaveLength(2);
    for (const d of dens) for (const id of adults) expect(d.entries).not.toContain(id);
    const [openRound] = engine.startRound('open');
    expect(openRound!.groupId).toBe(open.id);
    expect(openRound!.entries.sort()).toEqual([...adults].sort());
    for (const d of dens) runRound(engine, d);
    const [final] = engine.startRound('final');
    for (const id of adults) expect(final!.entries).not.toContain(id);
    // Whole-pack formats also leave the class out of the combined round.
    const pack2 = buildPack([3], PACK_AVERAGE_TIME);
    const cls = pack2.addGroup({ name: 'Outlaw', kind: 'class', parentId: pack2.pack().id });
    const r = pack2.addRacer({ firstName: 'Big', lastName: 'Kid', groupId: cls.id });
    const car = pack2.addCar({ racerId: r.id });
    pack2.setCheckedIn(r.id, true);
    const [main] = pack2.startRound('main');
    expect(main!.entries).not.toContain(car.id);
    expect(pack2.startRound('open')[0]!.entries).toEqual([car.id]);
    pack2.generateSpeedAwards();
    expect(pack2.state.awards.some((a) => a.name === 'Outlaw Champion')).toBe(true);
  });

  it('adds rounds a preset gained after the derby was created', () => {
    const engine = buildPack([2]);
    const snapshot = engine.snapshot();
    snapshot.format = { ...snapshot.format, rounds: snapshot.format.rounds.filter((r) => r.key !== 'open'), speedAwards: snapshot.format.speedAwards.filter((a) => a.roundKey !== 'open') };
    const reloaded = new DerbyEngine(snapshot);
    expect(reloaded.state.format.rounds.map((r) => r.key)).toEqual(['den', 'final', 'open']);
    expect(reloaded.state.format.speedAwards.some((a) => a.roundKey === 'open')).toBe(true);
  });

  it('advances by points per den plus fastest overall', () => {
    const engine = buildPack([5, 5, 5], DEN_POINTS_THEN_FINAL);
    const dens = engine.startRound('den');
    for (const den of dens) runRound(engine, den);
    const [final] = engine.startRound('final');
    expect(final!.entries).toHaveLength(2 * 3 + 4);
  });

  it('keeps the car photo and migrates older photo shapes', () => {
    const engine = buildPack([1]);
    const car = engine.state.cars[0]!;
    engine.setCarShot(car.id, 'original', 'o1.jpg');
    engine.setCarShot(car.id, 'crop', 'c1.jpg');
    engine.setCarShot(car.id, 'cutout', 'k1.png');
    expect(car.photo).toEqual({ side: { original: 'o1.jpg', crop: 'c1.jpg', cutout: 'k1.png' } });
    const { replaced } = engine.setCarShot(car.id, 'crop', 'c1b.jpg');
    expect(replaced).toBe('c1.jpg');
    expect(car.photo!.side!.crop).toBe('c1b.jpg');
    const { removed } = engine.clearCarPhoto(car.id);
    expect(removed.sort()).toEqual(['c1b.jpg', 'k1.png', 'o1.jpg']);
    expect(car.photo).toBeUndefined();

    // Older saves: flat profile/original/cutout keys, or a shots map by angle, fold into `side` on load.
    const snap = engine.snapshot();
    snap.cars[0]!.photo = { original: 'old-o.jpg', profile: 'old-p.jpg' };
    expect(new DerbyEngine(snap).state.cars[0]!.photo).toEqual({ side: { original: 'old-o.jpg', crop: 'old-p.jpg' } });
    snap.cars[0]!.photo = { shots: { side: { original: 's.jpg', crop: 't.jpg' }, threeq: { original: 'x.jpg', crop: 'y.jpg' } } };
    expect(new DerbyEngine(snap).state.cars[0]!.photo).toEqual({ side: { original: 's.jpg', crop: 't.jpg' } });
  });

  it('reset races clears rounds and winners but keeps the roster', () => {
    const engine = buildPack([4]);
    const [round] = engine.startRound('den');
    runRound(engine, round!);
    engine.generateSpeedAwards();
    const design = engine.addAward({ name: 'Best in Show', kind: 'design' });
    engine.setAwardWinner(design.id, engine.state.cars[0]!.id);
    engine.flowNext();
    engine.resetRaces();
    expect(engine.state.rounds).toEqual([]);
    expect(engine.state.awards.map((a) => a.name)).toEqual(['Best in Show']);
    expect(engine.state.awards[0]!.carId).toBeNull();
    expect(engine.state.presentation).toMatchObject({ stage: 'welcome', mode: 'auto', revealedAwardIds: [] });
    expect(engine.state.racers.every((r) => r.checkedIn)).toBe(true);
    expect(engine.state.cars).toHaveLength(4);
    expect(engine.startRound('den')).toHaveLength(1);
  });

  it('keeps a pack logo and an ordered sponsor list', () => {
    const engine = buildPack([1]);
    expect(engine.setLogo('logo1.png')).toBeNull();
    expect(engine.setLogo('logo2.png')).toBe('logo1.png');
    const a = engine.addSponsor(' Ace Hardware ');
    const b = engine.addSponsor("Bob's Pizza");
    expect(a.name).toBe('Ace Hardware');
    expect(engine.updateSponsor(a.id, { image: 'a.png' }).replaced).toBeNull();
    expect(engine.updateSponsor(a.id, { image: 'a2.png' }).replaced).toBe('a.png');
    expect(engine.updateSponsor(a.id, { name: 'Ace' }).replaced).toBeNull();
    engine.reorderSponsors([b.id]);
    expect(engine.state.branding.sponsors.map((s) => s.name)).toEqual(["Bob's Pizza", 'Ace']);
    expect(engine.removeSponsor(a.id)).toBe('a2.png');
    expect(engine.state.branding.sponsors).toHaveLength(1);
    expect(() => engine.removeSponsor('nope')).toThrow(DerbyError);

    // Saves from before branding existed load with an empty one.
    const snap = engine.snapshot();
    delete (snap as Partial<Derby>).branding;
    expect(new DerbyEngine(snap).state.branding).toEqual({ logo: null, sponsors: [] });
  });

  it('runs a people\'s-choice ballot and tallies it', () => {
    const engine = buildPack([3]);
    const [a, b, c] = engine.state.cars;
    const award = engine.addAward({ name: 'Coolest Car', kind: 'design' });
    const speed = engine.addAward({ name: 'Fastest', kind: 'speed', speed: { roundKey: 'den', place: 1 } });
    expect(() => engine.setBallot({ awardIds: [speed.id] })).toThrow(DerbyError);
    expect(() => engine.setBallot({ votesPerAward: 9 })).toThrow(DerbyError);
    engine.setBallot({ awardIds: [award.id], votesPerAward: 2 });
    expect(() => engine.castVote('phone-aaaaaaaa', award.id, [a!.id])).toThrow(/closed/);
    engine.setBallot({ open: true });
    engine.castVote('phone-aaaaaaaa', award.id, [a!.id, b!.id]);
    engine.castVote('phone-bbbbbbbb', award.id, [a!.id]);
    expect(() => engine.castVote('phone-cccccccc', award.id, [a!.id, b!.id, c!.id])).toThrow(/at most 2/);
    expect(() => engine.castVote('x', award.id, [a!.id])).toThrow(/voter/);
    // A withdrawn car cannot be voted for; a changed mind replaces the earlier picks.
    engine.withdrawCar(c!.id);
    expect(() => engine.castVote('phone-dddddddd', award.id, [c!.id])).toThrow(/cannot be voted/);
    engine.castVote('phone-bbbbbbbb', award.id, [b!.id]);
    expect(engine.voteTally(award.id)).toEqual([
      { carId: a!.id, votes: 1 },
      { carId: b!.id, votes: 2 },
    ].sort((x, y) => y.votes - x.votes));
    expect(engine.voterCount()).toBe(2);
    engine.castVote('phone-bbbbbbbb', award.id, []);
    expect(engine.voterCount()).toBe(1);
    expect(engine.ballotCandidates(award.id).map((x) => x.id)).toEqual([a!.id, b!.id]);
  });

  it('checks a whole den in at once and reports lane bias and the heat timeline', () => {
    const engine = buildPack([4, 4]);
    const den = engine.state.groups.find((g) => g.kind === 'den')!;
    for (const r of engine.state.racers) engine.setCheckedIn(r.id, false);
    expect(engine.setGroupCheckedIn(den.id, true)).toBe(4);
    expect(engine.setGroupCheckedIn(den.id, true)).toBe(0);
    for (const r of engine.state.racers) engine.setCheckedIn(r.id, true);
    const rounds = engine.startRound('den');
    // Lane 1 is made slow by a tenth of a second in every heat.
    let t = 0;
    for (const round of rounds) {
      for (const heat of engine.heatOrder(round)) {
        const times = heat.lanes.map((carId, i) => ({ lane: i + 1, timeSec: carId ? 3 + (i === 0 ? 0.1 : 0) + ((t++ * 7) % 5) / 1000 : null }));
        engine.finishHeat(heat.id, times, 'manual');
      }
    }
    const bias = engine.laneBias();
    expect(bias.heats).toBe(8);
    expect(bias.lanes[0]!.verdict).toBe('slow');
    expect(bias.lanes.slice(1).every((l) => l.verdict === 'even' || l.verdict === 'fast')).toBe(true);
    const timeline = engine.heatTimeline();
    expect(timeline).toHaveLength(8);
    expect(timeline[0]!.gapSec).toBeNull();
    expect(timeline[1]!.gapSec).not.toBeNull();
    expect(timeline.every((e) => e.position >= 1 && !e.voided)).toBe(true);
  });

  it('snapshots are independent copies', () => {
    const engine = buildPack([2]);
    const snap = engine.snapshot();
    engine.addGroup({ name: 'Extra', kind: 'den' });
    expect(snap.groups.length).toBe(engine.state.groups.length - 1);
  });
});
