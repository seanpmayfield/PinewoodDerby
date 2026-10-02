import { describe, expect, it } from 'vitest';
import { DerbyEngine } from '../src/race/engine.js';
import { DEN_THEN_FINAL } from '../src/format/presets.js';
import { seededRandom } from '../src/model/ids.js';
import type { Derby } from '../src/model/types.js';

describe('presentation', () => {
  it('shows a shortlist before revealing an award that has one', () => {
    const engine = DerbyEngine.create({ name: 'T', laneCount: 4, format: DEN_THEN_FINAL }, { random: seededRandom(1) });
    const den = engine.addGroup({ name: 'Den', kind: 'den' });
    const cars = [1, 2, 3].map((n) => engine.addCar({ racerId: engine.addRacer({ firstName: `S${n}`, lastName: 'T', groupId: den.id }).id, number: n }));
    const [a, b] = cars;
    const award = engine.addAward({ name: 'Best in Show', kind: 'design' });
    engine.setAwardWinner(award.id, a!.id);
    engine.setAwardNominee(award.id, a!.id, true);
    engine.setAwardNominee(award.id, b!.id, true);
    engine.setPresentation({ stage: 'awards', mode: 'auto' });
    expect(engine.nextAward()).toMatchObject({ award: { id: award.id }, nomineesPending: true });
    const first = engine.flowNext();
    expect(first.nominees).toBe(true);
    expect(engine.state.presentation.nomineesAwardId).toBe(award.id);
    expect(engine.state.presentation.revealedAwardIds).toEqual([]);
    const second = engine.flowNext();
    expect(second.nominees).toBeUndefined();
    expect(engine.state.presentation.revealedAwardIds).toEqual([award.id]);
    expect(engine.state.presentation.nomineesAwardId).toBeNull();
    // A single nominee is not a moment.
    const solo = engine.addAward({ name: 'Solo', kind: 'design' });
    engine.setAwardNominee(solo.id, a!.id, true);
    expect(engine.nextAward()?.nomineesPending).toBe(false);
  });

  it('fills defaults for snapshots saved before the field existed', () => {
    const old = { id: 'x', name: 'Old', date: '2026-01-01', laneCount: 4, groups: [], racers: [], cars: [], format: DEN_THEN_FINAL, rounds: [] } as unknown as Derby;
    const engine = new DerbyEngine(old);
    expect(engine.state.presentation.mode).toBe('auto');
    expect(engine.state.deadLanes).toEqual([]);
    expect(engine.state.settings.dnfTimeSec).toBeGreaterThan(0);
  });

  it('reveals awards in ceremony order: design first, then den awards, then 3rd/2nd/1st', () => {
    const engine = DerbyEngine.create({ name: 'T' });
    const pack = engine.addGroup({ name: 'Pack', kind: 'pack' });
    engine.addGroup({ name: 'Wolves', kind: 'den', parentId: pack.id });
    engine.addGroup({ name: 'Bears', kind: 'den', parentId: pack.id });
    engine.generateSpeedAwards();
    engine.addAward({ name: 'Most Colorful', kind: 'design' });
    engine.addAward({ name: 'Best in Show', kind: 'design' });

    const names: string[] = [];
    let award = engine.revealNextAward();
    while (award) {
      names.push(award.name);
      award = engine.revealNextAward();
    }
    expect(names).toEqual(['Most Colorful', 'Best in Show', 'Wolves Den Champion', 'Bears Den Champion', '3rd Place', '2nd Place', '1st Place']);
    expect(engine.state.presentation.mode).toBe('awards');

    engine.unrevealLastAward();
    expect(engine.state.presentation.revealedAwardIds).toHaveLength(6);
    engine.resetCeremony();
    expect(engine.state.presentation.revealedAwardIds).toEqual([]);
  });

  it('walks the whole show with one button', () => {
    const engine = DerbyEngine.create({ name: 'T', format: DEN_THEN_FINAL }, { random: seededRandom(3) });
    const pack = engine.addGroup({ name: 'Pack', kind: 'pack' });
    for (const name of ['Lions', 'Tigers']) {
      const den = engine.addGroup({ name, kind: 'den', parentId: pack.id });
      for (let i = 0; i < 4; i++) {
        const r = engine.addRacer({ firstName: `${name}${i}`, lastName: 'X', groupId: den.id });
        engine.addCar({ racerId: r.id });
        engine.setCheckedIn(r.id, true);
      }
    }
    const runRound = (roundId: string) => {
      let heat = engine.currentHeat(roundId);
      while (heat) {
        engine.noteArmed(heat.id);
        engine.startHeat(heat.id);
        engine.finishHeat(heat.id, heat.lanes.map((c, i) => ({ lane: i + 1, timeSec: c ? 3 + i / 10 : null })));
        heat = engine.currentHeat(roundId);
      }
    };

    expect(engine.state.presentation.stage).toBe('welcome');
    const first = engine.flowNext();
    expect(first.stage).toBe('round-intro');
    expect(engine.state.rounds).toHaveLength(2); // den rounds scheduled on demand
    expect(first.round!.name).toContain('Lions');

    runRound(first.round!.id); // arming moves the show to racing
    expect(engine.state.presentation.stage).toBe('racing');
    expect(engine.state.presentation.stageRoundId).toBe(first.round!.id);

    const second = engine.flowNext();
    expect(second.stage).toBe('round-intro');
    expect(second.round!.name).toContain('Tigers');
    runRound(second.round!.id);

    const final = engine.flowNext();
    expect(final.stage).toBe('round-intro');
    expect(final.round!.specKey).toBe('final'); // scheduled automatically from the den results
    runRound(final.round!.id);

    // No open-class groups, so that spec is skipped and the ceremony begins.
    const awards = engine.flowNext();
    expect(awards.stage).toBe('awards');
    expect(engine.state.awards.find((a) => a.name === '1st Place')!.carId).toBeTruthy();
    const reveal = engine.flowNext();
    expect(reveal.award).not.toBeNull();
    expect(engine.state.presentation.revealedAwardIds).toHaveLength(1);

    engine.flowReset();
    expect(engine.state.presentation).toMatchObject({ stage: 'welcome', mode: 'auto', stageRoundId: null });
  });

  it('picking a mode clears a pinned intro or replay', () => {
    const engine = DerbyEngine.create({ name: 'T' });
    engine.setPresentation({ introRoundId: 'round-1', replayHeatId: 'heat-1' });
    engine.setPresentation({ mode: 'awards' });
    expect(engine.state.presentation).toMatchObject({ mode: 'awards', introRoundId: null, replayHeatId: null });
    // Pinning without changing the mode keeps the mode.
    engine.setPresentation({ introRoundId: 'round-2' });
    expect(engine.state.presentation).toMatchObject({ mode: 'awards', introRoundId: 'round-2' });
    // Revealing an award switches to awards mode and therefore unpins.
    engine.addAward({ name: 'Best in Show', kind: 'design' });
    engine.revealNextAward();
    expect(engine.state.presentation.introRoundId).toBeNull();
  });

  it('attaches and clears a replay clip on a heat', () => {
    const engine = DerbyEngine.create({ name: 'T', format: DEN_THEN_FINAL });
    const pack = engine.addGroup({ name: 'Pack', kind: 'pack' });
    const den = engine.addGroup({ name: 'Wolves', kind: 'den', parentId: pack.id });
    for (let i = 0; i < 2; i++) {
      const r = engine.addRacer({ firstName: `R${i}`, lastName: 'X', groupId: den.id });
      engine.addCar({ racerId: r.id });
      engine.setCheckedIn(r.id, true);
    }
    const [round] = engine.startRound('den');
    const heat = engine.currentHeat(round!.id)!;
    engine.setHeatReplay(heat.id, 'abc.webm');
    expect(heat.replay).toBe('abc.webm');
    engine.setHeatReplay(heat.id, undefined);
    expect(heat.replay).toBeUndefined();
    expect(engine.state.presentation.replaySpeed).toBe(0.5);
  });

  it('spreads the spotlight so every racer gets one', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const engine = DerbyEngine.create({ name: 'T', format: DEN_THEN_FINAL }, { random: seededRandom(seed) });
    const pack = engine.addGroup({ name: 'Pack', kind: 'pack' });
    const den = engine.addGroup({ name: 'Wolves', kind: 'den', parentId: pack.id });
    for (let i = 0; i < 6; i++) {
      const r = engine.addRacer({ firstName: `R${i}`, lastName: 'X', groupId: den.id });
      engine.addCar({ racerId: r.id });
      engine.setCheckedIn(r.id, true);
    }
      const [round] = engine.startRound('den');
      const chosen: string[] = [];
      for (const heat of round!.heats) {
        const id = engine.assignSpotlight(heat.id)!;
        expect(engine.assignSpotlight(heat.id)).toBe(id);
        chosen.push(id);
        engine.startHeat(heat.id);
        engine.finishHeat(heat.id, heat.lanes.map((c, i) => ({ lane: i + 1, timeSec: c ? 3 + i / 10 : null })));
      }
      // 6 heats, 6 cars, each car appears in 4 heats: everyone gets exactly one spotlight.
      expect(new Set(chosen).size, `seed ${seed}`).toBe(6);
    }
  });

  it('reorders judged awards and reports what a car has won', () => {
    const engine = DerbyEngine.create({ name: 'T' });
    const pack = engine.addGroup({ name: 'Pack', kind: 'pack' });
    const den = engine.addGroup({ name: 'Wolves', kind: 'den', parentId: pack.id });
    const racer = engine.addRacer({ firstName: 'A', lastName: 'B', groupId: den.id });
    const car = engine.addCar({ racerId: racer.id });
    const a = engine.addAward({ name: 'Most Colorful', kind: 'design' });
    const b = engine.addAward({ name: 'Best in Show', kind: 'design' });
    const c = engine.addAward({ name: 'Funniest', kind: 'design' });
    engine.reorderAwards([c.id, a.id]);
    expect(engine.ceremonyOrder().map((x) => x.name)).toEqual(['Funniest', 'Most Colorful', 'Best in Show']);
    engine.setAwardWinner(b.id, car.id);
    engine.setAwardWinner(c.id, car.id);
    expect(engine.awardsForCar(car.id).map((x) => x.name).sort()).toEqual(['Best in Show', 'Funniest']);
  });
});
