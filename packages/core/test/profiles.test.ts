import { describe, expect, it } from 'vitest';
import { embeddedFieldCommand, findProfile, TIMER_PROFILES, type TimerProfile } from '../src/timer/profiles.js';
import { TimerSession, type Scheduler, type TimerPort } from '../src/timer/session.js';

/** A manual scheduler and clock so tests control time. */
function fakeClock() {
  let now = 0;
  const jobs: { at: number; fn: () => void; cancelled: boolean }[] = [];
  const schedule: Scheduler = (fn, ms) => {
    const job = { at: now + ms, fn, cancelled: false };
    jobs.push(job);
    return () => (job.cancelled = true);
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = jobs.filter((j) => !j.cancelled && j.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.cancelled = true;
      due.fn();
    }
    now = target;
  };
  return { schedule, advance, now: () => now };
}

/** A scripted timer: records what the session writes and lets the test inject lines. */
function fakePort() {
  const written: string[] = [];
  const listeners = new Set<(line: string) => void>();
  const port: TimerPort & { written: string[]; emit: (...lines: string[]) => void } = {
    written,
    write: (c) => written.push(c),
    onLine: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit: (...lines) => lines.forEach((line) => listeners.forEach((l) => l(line))),
  };
  return port;
}

function rig(profileKey: string, extra: Partial<ConstructorParameters<typeof TimerSession>[1]> = {}) {
  const profile = findProfile(profileKey)!;
  const clock = fakeClock();
  const port = fakePort();
  const session = new TimerSession(port, { profile, heatTimeoutMs: 10_000, schedule: clock.schedule, now: clock.now, laneCount: 4, commandGapMs: 100, ...extra });
  const done: { lanes: { lane: number; timeSec: number | null; place: number | null }[]; forcedDnf: boolean }[] = [];
  const results: { lane: number; timeSec: number | null; place: number | null }[] = [];
  const events: string[] = [];
  session.on('heat-complete', (e) => done.push(e));
  session.on('lane-result', (r) => results.push(r));
  session.on('race-start', () => events.push('start'));
  session.on('lane-count', (e) => events.push(`lanes:${e.lanes}`));
  session.on('gate', (e) => events.push(e.closed ? 'closed' : 'open'));
  session.on('identity', (e) => events.push(`id:${e.text}`));
  return { profile, clock, port, session, done, results, events };
}

/** Feed a gate reading a few times over a second, as polling would, so the debounce accepts the change. */
function gate(r: ReturnType<typeof rig>, reply: string) {
  for (let i = 0; i < 4; i++) {
    r.port.emit(reply);
    r.clock.advance(300);
  }
}

/** Step time forward until the session has written `command` (a reply in a test must follow the command it answers). */
function advanceUntil(r: ReturnType<typeof rig>, command: string) {
  for (let i = 0; i < 100 && !r.port.written.includes(command); i++) r.clock.advance(50);
  expect(r.port.written).toContain(command);
}

describe('timer profiles', () => {
  it('every profile has valid patterns, unique keys and a sane serial setup', () => {
    const keys = new Set<string>();
    for (const p of TIMER_PROFILES) {
      expect(keys.has(p.key)).toBe(false);
      keys.add(p.key);
      for (const m of [...p.matchers, ...(p.gateWatcher?.matchers ?? []), ...(p.setupQueries ?? []).flatMap((q) => q.matchers)]) expect(() => new RegExp(m.pattern)).not.toThrow();
      for (const r of p.prober?.responses ?? []) expect(() => new RegExp(r)).not.toThrow();
      expect([7, 8]).toContain(p.params.dataBits);
      expect(p.maxLanes).toBeGreaterThan(0);
    }
  });

  it('Derby Magic: reset per heat, B starts, place markers, zeros mean no finish', () => {
    const r = rig('DerbyMagic');
    r.session.arm([1, 2, 3]);
    expect(r.port.written).toEqual(['R']);
    r.port.emit('B');
    expect(r.events).toContain('start');
    r.port.emit('1=3.1234! 3=3.3000"', '2=0.0000');
    expect(r.done).toHaveLength(1);
    expect(r.done[0]!.lanes).toEqual([
      { lane: 1, timeSec: 3.1234, place: 1 },
      { lane: 2, timeSec: null, place: null },
      { lane: 3, timeSec: 3.3, place: 2 },
    ]);
    r.session.identify();
    r.port.emit('Derby Magic Timer v3');
    expect(r.events).toContain('id:Derby Magic Timer v3');
  });

  it('FastTrack: masks empty lanes with M, reads the gate with RG, polls LR while on the mark, parses a whole line of letters', () => {
    const r = rig('FastTrack-K');
    r.session.start();
    r.clock.advance(1000);
    expect(r.port.written.slice(0, 4)).toEqual(['RE', 'N1', 'N2', 'RF']);
    r.port.written.length = 0;
    r.session.arm([1, 2, 4]);
    r.clock.advance(1000);
    expect(r.port.written.filter((c) => c.startsWith('M'))).toEqual(['MG', 'MC']);
    // On the mark: RG (gate) and LR (laser reset) are polled.
    expect(r.port.written).toContain('RG');
    expect(r.port.written).toContain('LR');
    gate(r, 'RG1');
    expect(r.events).toContain('closed');
    const before = r.port.written.length;
    r.clock.advance(1000);
    // Set: no more LR.
    expect(r.port.written.slice(before)).not.toContain('LR');
    gate(r, 'RG0');
    expect(r.events).toContain('start');
    r.port.emit('A=3.001! B=3.002" C=0.000 D=3.004# E=0.000 F=0.000');
    expect(r.done).toHaveLength(1);
    expect(r.done[0]!.lanes).toEqual([
      { lane: 1, timeSec: 3.001, place: 1 },
      { lane: 2, timeSec: 3.002, place: 2 },
      { lane: 4, timeSec: 3.004, place: 3 },
    ]);
  });

  it('FastTrack: RF saying there is no laser reset stops the LR polling', () => {
    const r = rig('FastTrack-K');
    r.session.start();
    advanceUntil(r, 'RF');
    r.port.emit('0101 1011');
    r.clock.advance(1000);
    r.port.written.length = 0;
    r.session.arm([1]);
    r.clock.advance(1500);
    expect(r.port.written).not.toContain('LR');
    expect(r.port.written).toContain('RG');
  });

  it('FastTrack: a timer without the gate option answers X, so the track counts as set at once and gate polling stops', () => {
    const r = rig('FastTrack-K');
    r.session.start();
    r.clock.advance(1000);
    r.port.written.length = 0;
    r.session.arm([1]);
    advanceUntil(r, 'RG');
    r.port.emit('X');
    const mark = r.port.written.length;
    r.clock.advance(1500);
    expect(r.port.written.slice(mark)).not.toContain('RG');
    // At most the LR already queued behind that RG goes out.
    expect(r.port.written.slice(mark).filter((c) => c === 'LR').length).toBeLessThanOrEqual(1);
    r.port.emit('A=3.100!');
    expect(r.done).toHaveLength(1);
  });

  it('The Champ: CR after every command, settle before probing, lane count query, rs gate, rg on start, ra when overdue', () => {
    const r = rig('TheChamp', { autoCompleteOnTimeout: false });
    expect(r.profile.prober?.preProbe).toEqual(['']);
    r.session.start();
    expect(r.port.written[0]).toBe('r\r');
    advanceUntil(r, 'on\r');
    // The reply to "on" is a bare digit: it is the lane count only right after the query.
    r.port.emit('4');
    r.clock.advance(1000);
    expect(r.events).toContain('lanes:4');
    expect(r.session.laneCount).toBe(4);
    r.port.written.length = 0;
    r.session.arm([1, 3]);
    r.clock.advance(800);
    expect(r.port.written.slice(0, 4)).toEqual(['om0\r', 'om2\r', 'om4\r', 'rg\r']);
    expect(r.port.written).toContain('rs\r');
    gate(r, '0');
    expect(r.events).toContain('closed');
    gate(r, '1');
    expect(r.events).toContain('start');
    r.clock.advance(100);
    expect(r.port.written.at(-1)).toBe('rg\r');
    r.port.emit('A=3.1234! C=3.2000"');
    expect(r.done).toHaveLength(1);
    expect(r.done[0]!.lanes.map((l) => l.timeSec)).toEqual([3.1234, 3.2]);
    // A heat where a car never arrives: the timeout asks the timer to force the race over.
    r.session.arm([1, 2]);
    r.clock.advance(800);
    r.port.emit('A=3.1!');
    r.clock.advance(10_100);
    expect(r.port.written.at(-1)).toBe('ra\r');
    expect(r.session.missingLanes()).toEqual([2]);
  });

  it('The Champ (SRM firmware): S starts, lanes are digits', () => {
    const r = rig('TheChampSRM');
    r.session.arm([1, 2]);
    r.port.emit('S', '1=3.1000!', '2=3.2000"');
    expect(r.events).toContain('start');
    expect(r.done[0]!.lanes.map((l) => l.timeSec)).toEqual([3.1, 3.2]);
  });

  it('The Judge: lane count, Go!, DNF lanes carry a time but count as no finish, Race Over ends the heat', () => {
    const r = rig('TheJudge');
    r.port.emit('Checking Valid Lanes', 'Number of Lanes: 4');
    expect(r.events).toContain('lanes:4');
    r.session.arm([1, 2, 3]);
    r.clock.advance(500);
    expect(r.port.written).toEqual(['om0\r', 'om4\r']);
    r.port.emit('Go!');
    r.port.emit('Lane 2    3.1234', 'Lane 1    3.2000', 'Lane 3   31.0589   DNF', 'Race Over');
    expect(r.done).toHaveLength(1);
    expect(r.done[0]!.lanes).toEqual([
      { lane: 1, timeSec: 3.2, place: null },
      { lane: 2, timeSec: 3.1234, place: null },
      { lane: 3, timeSec: null, place: null },
    ]);
  });

  it('NewBold: 1200 7N2, a space resets, "1  3.1234" per lane, first result starts the race', () => {
    const r = rig('NewBold');
    expect(r.profile.params).toEqual({ baud: 1200, dataBits: 7, stopBits: 2, parity: 'none' });
    r.session.arm([1, 2]);
    expect(r.port.written).toEqual([' ']);
    r.port.emit(' 2  3.1234', ' 1  3.4000');
    expect(r.events).toContain('start');
    expect(r.done[0]!.lanes.map((l) => l.timeSec)).toEqual([3.4, 3.1234]);
  });

  it('Derby Timer: READY line gives the lane count, C/M masks, RACE starts, G reads the gate, F forces results', () => {
    const r = rig('DerbyTimer.com', { autoCompleteOnTimeout: false });
    r.session.start();
    r.port.emit('RESET', 'READY 4 LANES');
    expect(r.events).toContain('lanes:4');
    r.port.written.length = 0;
    r.session.arm([2, 3]);
    r.clock.advance(500);
    expect(r.port.written.slice(0, 3)).toEqual(['C', 'M1', 'M4']);
    expect(r.port.written).toContain('G');
    gate(r, 'U');
    gate(r, 'D');
    expect(r.events).toContain('start');
    r.port.emit('2  3.0100');
    r.clock.advance(10_100);
    expect(r.port.written.at(-1)).toBe('F');
  });

  it('PDT: probe settles first, numl gives lanes, reset again once the gate is closed, B starts, "1 - 3.1234" results', () => {
    const r = rig('MiscJunk');
    r.session.start();
    advanceUntil(r, 'N');
    r.port.emit('vert=1.2', 'numl=4');
    expect(r.events).toContain('lanes:4');
    r.port.written.length = 0;
    r.session.arm([1]);
    r.clock.advance(600);
    expect(r.port.written.slice(0, 5)).toEqual(['U', 'M2', 'M3', 'M4', 'R']);
    gate(r, '.');
    r.clock.advance(200);
    // GET_SET sends the reset again, now that the gate is closed.
    expect(r.port.written.filter((c) => c === 'R')).toHaveLength(2);
    r.port.emit('B', '1 - 3.1234');
    expect(r.done).toHaveLength(1);
    expect(r.done[0]!.lanes[0]!.timeSec).toBe(3.1234);
    expect(r.session.remoteStartSupported).toBe(true);
    r.session.remoteStart();
    r.clock.advance(200);
    expect(r.port.written.at(-1)).toBe('S');
  });

  it('Bert Drake: C reads Gc/Go, B means the gate opened, plain "1 3.1234" results', () => {
    const r = rig('BertDrake');
    r.session.start();
    r.session.arm([1, 2]);
    r.clock.advance(500);
    gate(r, 'Gc');
    expect(r.events).toContain('closed');
    gate(r, 'B');
    expect(r.events).toContain('start');
    r.port.emit('1 3.1000', '2 3.2000');
    expect(r.done[0]!.lanes.map((l) => l.timeSec)).toEqual([3.1, 3.2]);
  });

  it('JIT Racemaster: verbose result lines, R resets', () => {
    const r = rig('JIT');
    r.session.arm([1, 2]);
    expect(r.port.written).toEqual(['R']);
    r.port.emit('\x1b[2JFirst Place Single Lane Number: 2  Time in Seconds: 3.1234', 'Second Place Single Lane Number: 1  Time in Seconds: 3.4567');
    expect(r.done[0]!.lanes).toEqual([
      { lane: 1, timeSec: 3.4567, place: null },
      { lane: 2, timeSec: 3.1234, place: null },
    ]);
  });

  it('SuperTimer II: one mask command with the lane bits, results in two lines scaled by 10000, "!" ends the race', () => {
    const r = rig('SuperTimerII');
    r.session.arm([1, 2, 3, 4]);
    expect(r.port.written).toEqual(['3O5A\r']);
    r.port.emit('#1', '31234', '#3', '32000', '#2', '0', '!');
    expect(r.done).toHaveLength(1);
    expect(r.done[0]!.lanes).toEqual([
      { lane: 1, timeSec: 3.1234, place: null },
      { lane: 2, timeSec: null, place: null },
      { lane: 3, timeSec: 3.2, place: null },
      { lane: 4, timeSec: null, place: null },
    ]);
    expect(embeddedFieldCommand(0x33403541, 16, 4, 0b111100)).toBe('3|5A');
  });

  it('commands are spaced out and masked-lane results are ignored', () => {
    const r = rig('FastTrack-K');
    r.session.arm([1]);
    expect(r.port.written).toEqual(['MG']);
    r.clock.advance(100);
    expect(r.port.written).toEqual(['MG', 'MB']);
    r.clock.advance(1000);
    expect(r.port.written.slice(0, 4)).toEqual(['MG', 'MB', 'MC', 'MD']);
    r.port.emit('A=3.001! B=3.100" C=3.200# D=3.300$');
    expect(r.done).toHaveLength(1);
    expect(r.done[0]!.lanes).toEqual([{ lane: 1, timeSec: 3.001, place: 1 }]);
  });

  it('profiles without a prober are listed as manual', () => {
    const manual = TIMER_PROFILES.filter((p: TimerProfile) => !p.prober).map((p) => p.key);
    expect(manual).toEqual(['FastTrack-P', 'NewBold']);
  });
});
