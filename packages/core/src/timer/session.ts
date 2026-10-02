/**
 * Turns a stream of timer lines into whole-heat results.
 *
 * The real serial driver and the simulator both expose a `TimerPort`; the
 * session does not care which one it is talking to. Arm it with the lanes
 * that have cars, and it emits `heat-complete` once every one of those lanes
 * has reported or the timeout after the gate opened has passed.
 */

import { DERBY_MAGIC, parseDerbyMagicLine } from './protocol.js';

export interface TimerPort {
  write(command: string): void;
  onLine(listener: (line: string) => void): () => void;
}

export type TimerState = 'idle' | 'armed' | 'racing';

export interface HeatLaneTime {
  lane: number;
  timeSec: number | null;
  place: number | null;
}

export interface TimerSessionEvents {
  state: { state: TimerState };
  'race-start': Record<string, never>;
  'lane-result': HeatLaneTime;
  /** `forcedDnf` is true when a lane was recorded DNF by the timeout or the coordinator rather than by the timer. */
  'heat-complete': { lanes: HeatLaneTime[]; forcedDnf: boolean };
  /** The heat timeout passed with lanes still out (only when autoCompleteOnTimeout is false). */
  timeout: { missingLanes: number[] };
  identity: { text: string };
  line: { raw: string };
  unexpected: { message: string };
}

export type Scheduler = (fn: () => void, ms: number) => () => void;

export interface TimerSessionOptions {
  /** Milliseconds after the gate opens before lanes still out are considered missing. A function is re-read each heat. */
  heatTimeoutMs: number | (() => number);
  /**
   * true (default): lanes still out when the timeout passes are recorded as DNF
   * and the heat completes. false: a `timeout` event is emitted instead and the
   * heat waits for `markDnf` / `markMissingDnf`, re-emitting `timeout` every
   * `heatTimeoutMs` until then.
   */
  autoCompleteOnTimeout?: boolean;
  schedule?: Scheduler;
}

type Listener<K extends keyof TimerSessionEvents> = (payload: TimerSessionEvents[K]) => void;

export const defaultScheduler: Scheduler = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

export class TimerSession {
  private _state: TimerState = 'idle';
  private expectedLanes: number[] = [];
  private results = new Map<number, HeatLaneTime>();
  private cancelTimeout: (() => void) | null = null;
  private listeners = new Map<keyof TimerSessionEvents, Set<Listener<never>>>();
  private readonly schedule: Scheduler;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly port: TimerPort,
    private readonly options: TimerSessionOptions,
  ) {
    this.schedule = options.schedule ?? defaultScheduler;
    this.unsubscribe = port.onLine((line) => this.handleLine(line));
  }

  get state(): TimerState {
    return this._state;
  }

  on<K extends keyof TimerSessionEvents>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => set!.delete(listener as Listener<never>);
  }

  private emit<K extends keyof TimerSessionEvents>(event: K, payload: TimerSessionEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) (listener as Listener<K>)(payload);
  }

  identify(): void {
    this.port.write(DERBY_MAGIC.commands.identify);
  }

  /** Reset the timer and wait for results from these lanes. */
  arm(expectedLanes: number[]): void {
    this.clearTimeout();
    this.expectedLanes = [...new Set(expectedLanes)].sort((a, b) => a - b);
    this.results.clear();
    this.port.write(DERBY_MAGIC.commands.reset);
    this.setState('armed');
  }

  remoteStart(): void {
    this.port.write(DERBY_MAGIC.commands.remoteStart);
  }

  /** Abandon the current heat without emitting a result. */
  cancel(): void {
    this.clearTimeout();
    this.results.clear();
    this.expectedLanes = [];
    this.setState('idle');
  }

  dispose(): void {
    this.cancel();
    this.unsubscribe();
  }

  private handleLine(raw: string): void {
    this.emit('line', { raw });
    for (const event of parseDerbyMagicLine(raw)) {
      switch (event.type) {
        case 'identity':
          this.emit('identity', { text: event.text });
          break;
        case 'race-start':
          this.onRaceStart();
          break;
        case 'lane-result':
          this.onLaneResult(event.lane, event.timeSec, event.place);
          break;
        case 'unknown':
          break;
      }
    }
  }

  private onRaceStart(): void {
    if (this._state === 'idle') {
      this.emit('unexpected', { message: 'Timer reported a start while not armed.' });
      return;
    }
    if (this._state === 'racing') return;
    this.setState('racing');
    this.emit('race-start', {});
    this.armTimeout();
  }

  private armTimeout(): void {
    this.clearTimeout();
    this.cancelTimeout = this.schedule(() => {
      if (this.options.autoCompleteOnTimeout ?? true) {
        this.complete(true);
      } else {
        this.emit('timeout', { missingLanes: this.missingLanes() });
        this.armTimeout();
      }
    }, typeof this.options.heatTimeoutMs === 'function' ? this.options.heatTimeoutMs() : this.options.heatTimeoutMs);
  }

  /** Lanes armed for this heat that have not reported yet. */
  missingLanes(): number[] {
    return this.expectedLanes.filter((l) => !this.results.has(l));
  }

  /** The coordinator says this car is not going to finish. */
  markDnf(lane: number): void {
    if (this._state === 'idle' || !this.expectedLanes.includes(lane) || this.results.has(lane)) return;
    if (this._state === 'armed') this.onRaceStart();
    const result = { lane, timeSec: null, place: null };
    this.results.set(lane, result);
    this.emit('lane-result', result);
    if (this.expectedLanes.every((l) => this.results.has(l))) this.complete(true);
  }

  /** Record every lane still out as DNF and finish the heat. */
  markMissingDnf(): void {
    if (this._state === 'idle') return;
    const missing = this.missingLanes();
    if (missing.length === 0) return;
    for (const lane of missing) {
      const result = { lane, timeSec: null, place: null };
      this.results.set(lane, result);
      this.emit('lane-result', result);
    }
    this.complete(true);
  }

  private onLaneResult(lane: number, timeSec: number | null, place: number | null): void {
    if (this._state === 'idle') {
      this.emit('unexpected', { message: `Timer reported lane ${lane} while not armed.` });
      return;
    }
    // Some firmware versions may not send the start marker; treat the first
    // result as the start.
    if (this._state === 'armed') this.onRaceStart();
    if (!this.expectedLanes.includes(lane)) {
      this.emit('unexpected', { message: `Result for empty lane ${lane} ignored.` });
      return;
    }
    if (this.results.has(lane)) return;
    const result = { lane, timeSec, place };
    this.results.set(lane, result);
    this.emit('lane-result', result);
    if (this.expectedLanes.every((l) => this.results.has(l))) this.complete(false);
  }

  private complete(forcedDnf: boolean): void {
    this.clearTimeout();
    const lanes = this.expectedLanes.map(
      (lane) => this.results.get(lane) ?? { lane, timeSec: null, place: null },
    );
    this.expectedLanes = [];
    this.results.clear();
    this.setState('idle');
    this.emit('heat-complete', { lanes, forcedDnf });
  }

  private clearTimeout(): void {
    if (this.cancelTimeout) {
      this.cancelTimeout();
      this.cancelTimeout = null;
    }
  }

  private setState(state: TimerState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit('state', { state });
  }
}
