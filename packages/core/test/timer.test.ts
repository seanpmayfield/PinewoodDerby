import { describe, expect, it } from 'vitest';
import { TimerSession, type Scheduler } from '../src/timer/session.js';
import { SimulatedTimerPort } from '../src/timer/simulator.js';

/** A manual scheduler so tests control time. */
function fakeClock(): { schedule: Scheduler; advance: (ms: number) => void } {
  let now = 0;
  const jobs: { at: number; fn: () => void; cancelled: boolean }[] = [];
  return {
    schedule: (fn, ms) => {
      const job = { at: now + ms, fn, cancelled: false };
      jobs.push(job);
      return () => (job.cancelled = true);
    },
    advance: (ms) => {
      const target = now + ms;
      while (true) {
        const due = jobs.filter((j) => !j.cancelled && j.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        due.cancelled = true;
        due.fn();
      }
      now = target;
    },
  };
}

describe('TimerSession with the simulator', () => {
  it('collects a full heat', () => {
    const port = new SimulatedTimerPort({ timeScale: 0 });
    const session = new TimerSession(port, { heatTimeoutMs: 10_000 });
    const completed: unknown[] = [];
    session.on('heat-complete', (e) => completed.push(e));

    port.setOccupiedLanes([1, 2, 4]);
    session.arm([1, 2, 4]);
    expect(port.commandLog).toEqual(['R']);
    expect(session.state).toBe('armed');

    port.releaseGate();
    expect(completed).toHaveLength(1);
    const result = completed[0] as { lanes: { lane: number; timeSec: number | null; place: number | null }[]; forcedDnf: boolean };
    expect(result.forcedDnf).toBe(false);
    expect(result.lanes.map((l) => l.lane)).toEqual([1, 2, 4]);
    expect(result.lanes.every((l) => l.timeSec !== null && l.timeSec > 2.5)).toBe(true);
    const places = result.lanes.map((l) => l.place).sort();
    expect(places).toEqual([1, 2, 3]);
    expect(session.state).toBe('idle');
  });

  it('times out lanes that never finish', () => {
    const clock = fakeClock();
    const port = new SimulatedTimerPort({ timeScale: 1, schedule: clock.schedule, dnfChance: 1 });
    const session = new TimerSession(port, { heatTimeoutMs: 8_000, schedule: clock.schedule });
    const completed: { lanes: { timeSec: number | null }[]; forcedDnf: boolean }[] = [];
    session.on('heat-complete', (e) => completed.push(e));

    port.setOccupiedLanes([1, 2]);
    session.arm([1, 2]);
    port.releaseGate();
    expect(session.state).toBe('racing');
    clock.advance(7_999);
    expect(completed).toHaveLength(0);
    clock.advance(1);
    expect(completed).toHaveLength(1);
    expect(completed[0]!.forcedDnf).toBe(true);
    expect(completed[0]!.lanes.map((l) => l.timeSec)).toEqual([null, null]);
  });

  it('prompts instead of auto-completing when asked, and lets the coordinator mark DNFs', () => {
    const clock = fakeClock();
    const port = new SimulatedTimerPort({ timeScale: 1, schedule: clock.schedule, dnfChance: 1 });
    const session = new TimerSession(port, { heatTimeoutMs: 5_000, schedule: clock.schedule, autoCompleteOnTimeout: false });
    const timeouts: number[][] = [];
    const completed: { lanes: { lane: number; timeSec: number | null }[]; forcedDnf: boolean }[] = [];
    session.on('timeout', (e) => timeouts.push(e.missingLanes));
    session.on('heat-complete', (e) => completed.push(e));

    port.setOccupiedLanes([1, 2, 3]);
    session.arm([1, 2, 3]);
    port.releaseGate();
    clock.advance(5_000);
    expect(timeouts).toEqual([[1, 2, 3]]);
    expect(completed).toHaveLength(0);
    expect(session.state).toBe('racing');

    session.markDnf(2);
    expect(session.missingLanes()).toEqual([1, 3]);
    clock.advance(5_000);
    expect(timeouts).toEqual([[1, 2, 3], [1, 3]]);

    session.markMissingDnf();
    expect(completed).toHaveLength(1);
    expect(completed[0]!.forcedDnf).toBe(true);
    expect(completed[0]!.lanes.map((l) => l.timeSec)).toEqual([null, null, null]);
    expect(session.state).toBe('idle');
    clock.advance(10_000);
    expect(timeouts).toHaveLength(2);
  });

  it('marking the last outstanding lane DNF completes the heat', () => {
    const port = new SimulatedTimerPort({ timeScale: 0 });
    const session = new TimerSession(port, { heatTimeoutMs: 10_000, autoCompleteOnTimeout: false });
    const completed: unknown[] = [];
    session.on('heat-complete', (e) => completed.push(e));
    port.setOccupiedLanes([1, 2]);
    session.arm([1, 2, 3]);
    port.releaseGate();
    expect(completed).toHaveLength(0);
    session.markDnf(3);
    expect(completed).toHaveLength(1);
  });

  it('delivers results in finishing order over simulated time', () => {
    const clock = fakeClock();
    const port = new SimulatedTimerPort({ timeScale: 1, schedule: clock.schedule });
    const session = new TimerSession(port, { heatTimeoutMs: 10_000, schedule: clock.schedule });
    const seen: number[] = [];
    session.on('lane-result', (r) => seen.push(r.place!));

    port.setOccupiedLanes([1, 2, 3, 4]);
    session.arm([1, 2, 3, 4]);
    port.releaseGate();
    clock.advance(5_000);
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('quietly ignores results for lanes it was not told about', () => {
    const port = new SimulatedTimerPort({ timeScale: 0 });
    const session = new TimerSession(port, { heatTimeoutMs: 10_000 });
    const unexpected: string[] = [];
    const completed: { lanes: { lane: number }[] }[] = [];
    session.on('unexpected', (e) => unexpected.push(e.message));
    session.on('heat-complete', (e) => completed.push(e));
    port.setOccupiedLanes([1, 2, 3]);
    session.arm([1, 2]);
    port.releaseGate();
    expect(unexpected).toEqual([]);
    expect(completed[0]!.lanes.map((l) => l.lane)).toEqual([1, 2]);
    expect(session.state).toBe('idle');
  });

  it('answers the identity probe', () => {
    const port = new SimulatedTimerPort({ timeScale: 0 });
    const session = new TimerSession(port, { heatTimeoutMs: 10_000 });
    let identity = '';
    session.on('identity', (e) => (identity = e.text));
    session.identify();
    expect(identity).toContain('Derby Magic');
  });

  it('auto-starts when configured', () => {
    const clock = fakeClock();
    const port = new SimulatedTimerPort({ timeScale: 1, schedule: clock.schedule, autoStartMs: 2_000 });
    const session = new TimerSession(port, { heatTimeoutMs: 10_000, schedule: clock.schedule });
    let started = false;
    session.on('race-start', () => (started = true));
    port.setOccupiedLanes([1]);
    session.arm([1]);
    clock.advance(1_999);
    expect(started).toBe(false);
    clock.advance(1);
    expect(started).toBe(true);
  });
});
