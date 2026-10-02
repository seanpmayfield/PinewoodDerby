/**
 * A fake Derby Magic timer that speaks the real wire protocol, so everything
 * above the serial port can be developed and tested without hardware.
 */

import { seededRandom } from '../model/ids.js';
import { DERBY_MAGIC, formatDerbyMagicResult } from './protocol.js';
import { defaultScheduler, type Scheduler, type TimerPort } from './session.js';

export interface SimulatedTimerOptions {
  /** 1 = real time, 0.1 = ten times faster, 0 = instant (synchronous). */
  timeScale?: number;
  /** After arming, open the gate by itself after this many ms. null = wait for `releaseGate()`. */
  autoStartMs?: number | null;
  /** Probability that an occupied lane never finishes. */
  dnfChance?: number;
  random?: () => number;
  schedule?: Scheduler;
}

/** Simulated finish times, in seconds: a typical 32-foot track. */
const MIN_TIME_SEC = 2.8;
const MAX_TIME_SEC = 3.6;

export class SimulatedTimerPort implements TimerPort {
  private listeners = new Set<(line: string) => void>();
  private armed = false;
  private occupied: number[] = [];
  private readonly timeScale: number;
  private readonly autoStartMs: number | null;
  private readonly dnfChance: number;
  private readonly random: () => number;
  private readonly schedule: Scheduler;
  /** Every command the session sent, oldest first. Handy in tests. */
  readonly commandLog: string[] = [];

  constructor(options: SimulatedTimerOptions = {}) {
    this.timeScale = options.timeScale ?? 1;
    this.autoStartMs = options.autoStartMs ?? null;
    this.dnfChance = options.dnfChance ?? 0;
    this.random = options.random ?? seededRandom(42);
    this.schedule = options.schedule ?? defaultScheduler;
  }

  /** Tell the simulator which lanes have cars; the real timer just sees them cross. */
  setOccupiedLanes(lanes: number[]): void {
    this.occupied = [...new Set(lanes)];
  }

  onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  write(command: string): void {
    this.commandLog.push(command);
    switch (command) {
      case DERBY_MAGIC.commands.identify:
        this.emit('Derby Magic Timer (simulated)');
        break;
      case DERBY_MAGIC.commands.reset:
        this.armed = true;
        if (this.autoStartMs !== null) this.after(this.autoStartMs, () => this.releaseGate());
        break;
      case DERBY_MAGIC.commands.remoteStart:
        this.releaseGate();
        break;
      default:
        break;
    }
  }

  /** Open the start gate: the timer sends "B" then a result per occupied lane. */
  releaseGate(): void {
    if (!this.armed) return;
    this.armed = false;
    this.emit('B');

    const finishers = this.occupied
      .filter(() => this.random() >= this.dnfChance)
      .map((lane) => ({ lane, timeSec: MIN_TIME_SEC + this.random() * (MAX_TIME_SEC - MIN_TIME_SEC) }))
      .sort((a, b) => a.timeSec - b.timeSec);

    finishers.forEach((f, i) => {
      this.after(f.timeSec * 1000, () => this.emit(formatDerbyMagicResult(f.lane, f.timeSec, i + 1)));
    });
  }

  private after(ms: number, fn: () => void): void {
    const scaled = ms * this.timeScale;
    if (scaled <= 0) fn();
    else this.schedule(fn, scaled);
  }

  private emit(line: string): void {
    for (const listener of this.listeners) listener(line);
  }
}
