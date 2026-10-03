/**
 * Turns a stream of timer lines into whole-heat results, for any timer that
 * has a profile (profiles.ts).
 *
 * The real serial driver and the simulator both expose a `TimerPort`; the
 * session does not care which one it is talking to. Arm it with the lanes
 * that have cars, and it emits `heat-complete` once every one of those lanes
 * has reported, the timer says the race is over, or the heat timeout has
 * passed and the coordinator has ruled on the lanes still out.
 *
 * The phases while armed follow DerbyNet's state machine: after the heat is
 * prepared the track is on its MARK; once the start gate is seen closed it
 * is SET; the gate opening (or the timer's own start message) starts the
 * race. Timers that never report the gate skip straight to SET.
 */

import { DERBY_MAGIC_PROFILE, embeddedFieldCommand, isNoFinish, laneFromChar, placeFromChar, type Matcher, type TimerEvent, type TimerProfile } from './profiles.js';

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
  /** A line matched the profile's identity patterns. */
  identity: { text: string };
  /** The timer said how many lanes it has. */
  'lane-count': { lanes: number };
  /** The start gate was seen to open or close (debounced). */
  gate: { closed: boolean };
  line: { raw: string };
  unexpected: { message: string };
}

export type Scheduler = (fn: () => void, ms: number) => () => void;

export interface TimerSessionOptions {
  /** Which timer this is. Defaults to the Derby Magic, which the simulator also speaks. */
  profile?: TimerProfile;
  /** Lanes on the track, so empty lanes can be masked; the timer's own count wins when it reports one. */
  laneCount?: number | (() => number);
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
  now?: () => number;
  /** Pause between commands, so a timer is never sent two at once. */
  commandGapMs?: number;
  /** How often the gate is polled and phase commands repeated, once started. */
  pollIntervalMs?: number;
  /** A gate change must hold this long before it counts (DerbyNet's min-gate-time). */
  minGateMs?: number;
}

type Listener<K extends keyof TimerSessionEvents> = (payload: TimerSessionEvents[K]) => void;

export const defaultScheduler: Scheduler = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

/** How long a query's own matchers stay live after the query is actually sent. */
const QUERY_WINDOW_MS = 150;
/** Extra commands run this long after the event they follow (lets a Champ settle before "rg"). */
const ON_EVENT_DELAY_MS = 50;

interface Detector {
  re: RegExp;
  event?: TimerEvent;
  args: number[];
  /** null = always live; otherwise live until this time. */
  activeUntil: number | null;
}

export class TimerSession {
  readonly profile: TimerProfile;
  private _state: TimerState = 'idle';
  private phase: 'mark' | 'set' = 'mark';
  private expectedLanes: number[] = [];
  private results = new Map<number, HeatLaneTime>();
  private cancelTimeout: (() => void) | null = null;
  private listeners = new Map<keyof TimerSessionEvents, Set<Listener<never>>>();
  private readonly schedule: Scheduler;
  private readonly now: () => number;
  private readonly unsubscribe: () => void;

  private readonly matchers: Detector[];
  private readonly gateDetectors: Detector[];
  private readonly queryDetectors = new Map<string, Detector[]>();
  private readonly identityPatterns: RegExp[];

  private queue: string[] = [];
  /** Detectors to switch on when a queued command is actually written, keyed by command. */
  private pendingActivations = new Map<string, { detectors: Detector[]; windowMs: number }[]>();
  private pumpTimer: (() => void) | null = null;
  private pollTimer: (() => void) | null = null;
  private started = false;
  private disposed = false;

  private gateKnowable: boolean;
  private gateClosed = false;
  private gateChangeAt: number | null = null;
  private lastGatePoll = -Infinity;
  private markPolling = true;
  private overdueSent = false;
  private partialLane: string | null = null;
  private detectedLanes: number | null = null;

  constructor(
    private readonly port: TimerPort,
    private readonly options: TimerSessionOptions,
  ) {
    this.profile = options.profile ?? DERBY_MAGIC_PROFILE;
    this.schedule = options.schedule ?? defaultScheduler;
    this.now = options.now ?? Date.now;
    this.gateKnowable = this.profile.gateStateKnowable && !!this.profile.gateWatcher;
    const toDetector = (m: Matcher, active: boolean): Detector => ({ re: new RegExp(m.pattern), event: m.event, args: m.args ?? [], activeUntil: active ? null : -Infinity });
    this.matchers = this.profile.matchers.map((m) => toDetector(m, true));
    this.gateDetectors = (this.profile.gateWatcher?.matchers ?? []).map((m) => toDetector(m, false));
    for (const q of this.profile.setupQueries ?? []) this.queryDetectors.set(q.command, q.matchers.map((m) => toDetector(m, false)));
    this.identityPatterns = (this.profile.prober?.responses ?? []).map((p) => new RegExp(p));
    this.unsubscribe = port.onLine((line) => this.handleLine(line));
  }

  get state(): TimerState {
    return this._state;
  }

  /** Lanes the timer said it has, or null if it never said. */
  get laneCount(): number | null {
    return this.detectedLanes;
  }

  get remoteStartSupported(): boolean {
    return !!this.profile.remoteStart;
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

  /**
   * Send the profile's set-up commands and queries, then start polling the
   * gate. Call once the port is open and the timer has been recognised.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.profile.setup) this.send(...this.profile.setup);
    for (const q of this.profile.setupQueries ?? []) this.query(q.command, this.queryDetectors.get(q.command) ?? []);
    if (this.profile.gateWatcher || this.profile.poll) this.schedulePoll();
  }

  /** Ask the timer who it is; the reply arrives as an `identity` event. */
  identify(): void {
    if (this.profile.prober) this.send(this.profile.prober.probe);
  }

  /** Prepare the timer for a heat: mask the empty lanes, reset, and wait for results from these lanes. */
  arm(expectedLanes: number[]): void {
    this.clearHeatTimeout();
    this.expectedLanes = [...new Set(expectedLanes)].sort((a, b) => a - b);
    this.results.clear();
    this.overdueSent = false;
    this.partialLane = null;
    this.gateClosed = false;
    this.gateChangeAt = null;
    this.phase = 'mark';
    this.setState('armed');

    const prep = this.profile.heatPrep;
    const commands: string[] = [];
    if (prep?.unmask !== undefined && prep.mask !== undefined && prep.lane !== undefined) {
      commands.push(prep.unmask);
      const lanes = this.detectedLanes ?? this.trackLanes() ?? this.profile.maxLanes;
      for (let lane = 1; lane <= lanes; lane++) {
        if (!this.expectedLanes.includes(lane)) commands.push(prep.mask + String.fromCharCode(prep.lane.charCodeAt(0) + lane - 1));
      }
    } else if (prep?.embeddedMask) {
      let mask = 0;
      for (const lane of this.expectedLanes) mask |= 1 << (lane - 1);
      commands.push(embeddedFieldCommand(prep.embeddedMask.command, prep.embeddedMask.offset, prep.embeddedMask.nbytes, mask));
    }
    if (prep?.reset !== undefined) commands.push(prep.reset);
    this.send(...commands);

    // With no way to see the gate, the track counts as set as soon as it is prepared.
    if (!this.gateKnowable) this.getSet();
  }

  remoteStart(): void {
    const rs = this.profile.remoteStart;
    if (!rs) throw new Error(`${this.profile.name} has no remote start.`);
    this.send(rs.command);
  }

  /** Abandon the current heat without emitting a result. */
  cancel(): void {
    this.clearHeatTimeout();
    this.results.clear();
    this.expectedLanes = [];
    this.setState('idle');
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    if (this.pumpTimer) this.pumpTimer();
    if (this.pollTimer) this.pollTimer();
    this.pumpTimer = null;
    this.pollTimer = null;
    this.queue = [];
  }

  // ---- commands ---------------------------------------------------------------

  /** Queue commands; the first goes at once, the rest spaced by commandGapMs so the timer is never swamped. */
  private send(...commands: string[]): void {
    if (this.disposed) return;
    this.queue.push(...commands);
    this.pump();
  }

  private pump(): void {
    if (this.pumpTimer) return;
    const command = this.queue.shift();
    if (command === undefined) return;
    this.port.write(command + this.profile.eol);
    const activations = this.pendingActivations.get(command);
    if (activations?.length) {
      const { detectors, windowMs } = activations.shift()!;
      for (const d of detectors) d.activeUntil = this.now() + windowMs;
    }
    const gap = this.options.commandGapMs ?? 0;
    if (gap > 0) {
      this.pumpTimer = this.schedule(() => {
        this.pumpTimer = null;
        this.pump();
      }, gap);
    } else if (this.queue.length) {
      this.pump();
    }
  }

  /** Send a command whose reply is read by its own matchers, live only for a moment after it goes out. */
  private query(command: string, detectors: Detector[], windowMs = QUERY_WINDOW_MS): void {
    const list = this.pendingActivations.get(command) ?? [];
    list.push({ detectors, windowMs });
    this.pendingActivations.set(command, list);
    this.send(command);
  }

  private sendAfter(ms: number, commands: string[]): void {
    this.schedule(() => this.send(...commands), ms);
  }

  // ---- polling ----------------------------------------------------------------

  private schedulePoll(): void {
    this.pollTimer = this.schedule(() => {
      this.pollTimer = null;
      this.pollTick();
      if (!this.disposed) this.schedulePoll();
    }, this.options.pollIntervalMs ?? 250);
  }

  private pollTick(): void {
    if (this._state === 'racing' || this.queue.length > 0) return;
    const now = this.now();
    if (this.profile.gateWatcher && this.gateKnowable) {
      // Idle, the gate is read now and then to keep the connection alive; armed, it is watched closely.
      if (this._state !== 'idle' || now - this.lastGatePoll >= 1000) {
        this.lastGatePoll = now;
        // Live until the next poll, so a reply is never missed between polls.
        this.query(this.profile.gateWatcher.command, this.gateDetectors, (this.options.pollIntervalMs ?? 250) + 50);
      }
    }
    if (this._state === 'armed') {
      const commands = this.profile.poll?.[this.phase === 'mark' ? 'MARK' : 'SET'];
      if (commands && (this.phase !== 'mark' || this.markPolling)) this.send(...commands);
    }
  }

  // ---- lines and events -----------------------------------------------------------

  private handleLine(raw: string): void {
    // FastTrack echoes prompts; JIT wraps text in escape sequences.
    let line = raw.replace(/\x1b/g, '').trim().replace(/^[@>]+/, '');
    if (line === '') return;
    this.emit('line', { raw: line });
    if (this.identityPatterns.some((p) => p.test(line))) this.emit('identity', { text: line });

    const now = this.now();
    const detectors = [...this.matchers, ...this.gateDetectors, ...[...this.queryDetectors.values()].flat()];
    let progress = true;
    while (line.length > 0 && progress) {
      progress = false;
      for (const d of detectors) {
        if (d.activeUntil !== null && now > d.activeUntil) continue;
        const m = d.re.exec(line);
        if (!m) continue;
        if (d.event) this.handleEvent(d.event, d.args.map((i) => m[i] ?? ''), m[0]);
        line = (line.slice(0, m.index) + line.slice(m.index + m[0].length)).trim();
        progress = true;
        break;
      }
    }
  }

  private handleEvent(event: TimerEvent, args: string[], matched: string): void {
    switch (event) {
      case 'LANE_RESULT': {
        const lane = laneFromChar(args[0] ?? '');
        const raw = args[1] ?? '';
        const value = Number(raw) / this.profile.timeScale;
        const noFinish = isNoFinish(raw) || !Number.isFinite(value) || value <= 0 || /\bDNF\b/i.test(matched);
        this.onLaneResult(lane, noFinish ? null : value, placeFromChar(args[2]));
        break;
      }
      case 'PARTIAL_LANE':
        this.partialLane = args[0] ?? null;
        break;
      case 'PARTIAL_TIME':
        if (this.partialLane !== null) {
          const lane = this.partialLane;
          this.partialLane = null;
          this.handleEvent('LANE_RESULT', [lane, args[0] ?? ''], matched);
        }
        break;
      case 'LANE_COUNT': {
        const n = Number(args[0]);
        if (Number.isFinite(n) && n > 0) {
          this.detectedLanes = n;
          this.emit('lane-count', { lanes: n });
        }
        break;
      }
      case 'RACE_STARTED':
        this.onRaceStart();
        break;
      case 'RACE_FINISHED':
        this.onTimerFinished();
        break;
      case 'GATE_OPEN':
      case 'GATE_CLOSED':
        this.onGate(event === 'GATE_CLOSED');
        break;
      case 'GATE_WATCHER_NOT_SUPPORTED':
        this.gateKnowable = false;
        if (this._state === 'armed' && this.phase === 'mark') this.getSet();
        break;
      case 'NO_LASER_RESET':
        this.markPolling = false;
        break;
      case 'GET_SET':
      case 'OVERDUE':
        break;
    }
    const extra = this.profile.on?.[event];
    if (extra) this.sendAfter(ON_EVENT_DELAY_MS, extra);
  }

  /** Fire an event the session itself decided on (GET_SET, RACE_STARTED from the gate, OVERDUE). */
  private fire(event: TimerEvent): void {
    this.handleEvent(event, [], '');
  }

  private getSet(): void {
    if (this._state !== 'armed' || this.phase === 'set') return;
    this.phase = 'set';
    this.fire('GET_SET');
  }

  private onGate(closed: boolean): void {
    if (this._state === 'racing') return;
    if (closed === this.gateClosed) {
      this.gateChangeAt = null;
      return;
    }
    // A change must be seen twice, at least minGateMs apart, before it counts (a bouncing switch is common).
    const now = this.now();
    if (this.gateChangeAt === null) {
      this.gateChangeAt = now;
      return;
    }
    if (now - this.gateChangeAt <= (this.options.minGateMs ?? 500)) return;
    this.gateClosed = closed;
    this.gateChangeAt = null;
    this.emit('gate', { closed });
    if (this._state !== 'armed') return;
    if (closed && this.phase === 'mark') this.getSet();
    else if (!closed && this.phase === 'set') this.fire('RACE_STARTED');
  }

  private onRaceStart(): void {
    if (this._state === 'idle') {
      this.emit('unexpected', { message: 'Timer reported a start while not armed.' });
      return;
    }
    if (this._state === 'racing') return;
    this.setState('racing');
    this.emit('race-start', {});
    this.armHeatTimeout();
  }

  private armHeatTimeout(): void {
    this.clearHeatTimeout();
    this.cancelTimeout = this.schedule(() => {
      // Give the timer the chance to force out whatever results it has (Champ "ra", Derby Timer "F").
      if (!this.overdueSent) {
        this.overdueSent = true;
        this.fire('OVERDUE');
      }
      if (this.options.autoCompleteOnTimeout ?? true) {
        this.complete(true);
      } else {
        this.emit('timeout', { missingLanes: this.missingLanes() });
        this.armHeatTimeout();
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
    // Not every timer announces the start; the first result means the race is on.
    if (this._state === 'armed') this.onRaceStart();
    // Some timers report every lane, masked or not; results for empty lanes are dropped.
    if (!this.expectedLanes.includes(lane) || this.results.has(lane)) return;
    const result = { lane, timeSec, place };
    this.results.set(lane, result);
    this.emit('lane-result', result);
    if (this.expectedLanes.every((l) => this.results.has(l))) this.complete(false);
  }

  /** The timer says the race is over; anything still out did not finish. */
  private onTimerFinished(): void {
    if (this._state === 'idle') return;
    if (this._state === 'armed') this.onRaceStart();
    const missing = this.missingLanes();
    for (const lane of missing) {
      const result = { lane, timeSec: null, place: null };
      this.results.set(lane, result);
      this.emit('lane-result', result);
    }
    this.complete(false);
  }

  private complete(forcedDnf: boolean): void {
    this.clearHeatTimeout();
    const lanes = this.expectedLanes.map((lane) => this.results.get(lane) ?? { lane, timeSec: null, place: null });
    this.expectedLanes = [];
    this.results.clear();
    this.setState('idle');
    this.emit('heat-complete', { lanes, forcedDnf });
  }

  private trackLanes(): number | null {
    const v = this.options.laneCount;
    if (v === undefined) return null;
    return typeof v === 'function' ? v() : v;
  }

  private clearHeatTimeout(): void {
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
