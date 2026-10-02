/**
 * Glue between the timer (real or simulated) and the race engine.
 *
 * Coordinator arms a heat -> the session resets the timer and waits for the
 * lanes that have cars -> the gate opens -> lane results stream in live ->
 * the finished heat is recorded in the engine.
 *
 * The timer kind and port can be changed at runtime from the Setup screen, so
 * the coordinator can rehearse on the simulator and plug the real timer in
 * later. A lost serial connection is retried in the background.
 */

import {
  DerbyEngine,
  DerbyError,
  SimulatedTimerPort,
  TimerSession,
  type HeatLaneTime,
  type TimerPort,
  type TimerState,
} from '@derby/core';
import type { TimerKind } from '../config.js';
import { connectDerbyMagic, listSerialPorts, type ConnectOptions, type SerialPortInfo, type SerialTimerPort } from './serial.js';

export interface TimerConfig {
  kind: TimerKind;
  /** Serial port path, or null for auto-detect. */
  port: string | null;
  /** Baud rate, or null to try 19200 then 9600. */
  baud: number | null;
}

export interface TimerStatus {
  kind: TimerKind;
  connected: boolean;
  connecting: boolean;
  state: TimerState;
  identity: string | null;
  /** Serial port in use. */
  port: string | null;
  baud: number | null;
  /** False when the port was opened without the timer answering the identify probe. */
  verified: boolean;
  /** Serial ports seen at the last scan. */
  ports: SerialPortInfo[];
  /** Heat the timer is currently armed for or racing. */
  heatId: string | null;
  /** True while running a lane test (no heat involved). */
  testing: boolean;
  /** Lanes reported so far in the current heat or test. */
  liveLanes: HeatLaneTime[];
  /** Lanes still out after the heat timeout; the coordinator is asked to confirm DNF. */
  missingLanes: number[];
  /** Light-tree countdown in progress for the armed heat. */
  countdown: { startedAt: number; lights: number; intervalMs: number; stageMs: number } | null;
  /** Last heartbeat from an open replay camera page (ms since epoch), or null. */
  replayCamAt: number | null;
  /** What that page reported: camera ready, recording, or unable to open the camera. */
  replayCamState: 'ready' | 'recording' | 'no-camera' | null;
  /** The most recently completed heat and its lanes, for the "just finished" display. */
  lastHeatId: string | null;
  lastLanes: HeatLaneTime[];
  lastError: string | null;
  /** Serial log tail for the timer diagnostics panel. */
  log: string[];
}

export interface TimerServiceOptions {
  config: TimerConfig;
  simulatorSpeed?: number;
  simulatorDnfChance?: number;
  /** Called after any status change so it can be broadcast. */
  onStatus: (status: TimerStatus) => void;
  onNotice?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Injected in tests. */
  connectSerial?: (options: ConnectOptions) => ReturnType<typeof connectDerbyMagic>;
  listPorts?: () => Promise<SerialPortInfo[]>;
  reconnectDelayMs?: number;
}

const LOG_LINES = 80;

export class TimerService {
  readonly status: TimerStatus;
  config: TimerConfig;
  private session: TimerSession | null = null;
  private simulator: SimulatedTimerPort | null = null;
  private serial: SerialTimerPort | null = null;
  private engine: DerbyEngine;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private disposed = false;

  constructor(
    engine: DerbyEngine,
    private readonly options: TimerServiceOptions,
  ) {
    this.engine = engine;
    this.config = { ...options.config };
    this.status = {
      kind: this.config.kind,
      connected: false,
      connecting: false,
      state: 'idle',
      identity: null,
      port: null,
      baud: null,
      verified: false,
      ports: [],
      heatId: null,
      testing: false,
      liveLanes: [],
      missingLanes: [],
      countdown: null,
      replayCamAt: null,
      replayCamState: null,
      lastHeatId: null,
      lastLanes: [],
      lastError: null,
      log: [],
    };
    void this.connect();
  }

  /** The engine instance can be swapped when a different derby is loaded. */
  setEngine(engine: DerbyEngine): void {
    this.cancel();
    this.engine = engine;
  }

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  /** Switch timer kind or port. Tears down the current connection and reconnects. */
  async configure(config: Partial<TimerConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    this.status.kind = this.config.kind;
    await this.connect();
  }

  async scanPorts(): Promise<SerialPortInfo[]> {
    try {
      this.status.ports = await (this.options.listPorts ?? listSerialPorts)();
    } catch (err) {
      this.status.lastError = `Could not list serial ports: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.publish();
    return this.status.ports;
  }

  async connect(): Promise<void> {
    const generation = ++this.generation;
    await this.teardown();
    if (this.disposed) return;

    this.status.connecting = true;
    this.status.lastError = null;
    this.publish();

    let port: TimerPort;
    if (this.config.kind === 'simulator') {
      this.simulator = new SimulatedTimerPort({
        timeScale: this.options.simulatorSpeed ?? 1,
        dnfChance: this.options.simulatorDnfChance ?? 0.03,
        random: Math.random,
      });
      port = this.simulator;
      this.status.port = null;
      this.status.baud = null;
      this.status.verified = true;
    } else {
      try {
        await this.scanPorts();
        const connect = this.options.connectSerial ?? connectDerbyMagic;
        const result = await connect({ path: this.config.port ?? undefined, baudRate: this.config.baud ?? undefined });
        if (generation !== this.generation) {
          await result.port.close();
          return;
        }
        this.serial = result.port;
        port = result.port;
        this.status.port = result.port.path;
        this.status.baud = result.port.baudRate;
        this.status.verified = result.verified;
        this.status.identity = result.identity;
        this.log(`connected ${result.port.path} @ ${result.port.baudRate}${result.verified ? '' : ' (no reply to probe)'}`);
        result.port.onClose((err) => {
          if (generation !== this.generation) return;
          this.log(`port closed${err ? `: ${err.message}` : ''}`);
          this.status.connected = false;
          this.status.lastError = err ? `Timer disconnected: ${err.message}` : 'Timer disconnected.';
          this.options.onNotice?.('error', this.status.lastError);
          this.cancel();
          this.publish();
          this.scheduleReconnect();
        });
      } catch (err) {
        if (generation !== this.generation) return;
        this.status.connecting = false;
        this.status.connected = false;
        this.status.lastError = err instanceof Error ? err.message : String(err);
        this.log(`connect failed: ${this.status.lastError}`);
        this.publish();
        this.scheduleReconnect();
        return;
      }
    }

    const session = new TimerSession(port, {
      heatTimeoutMs: () => this.engine.state.settings.heatTimeoutSec * 1000,
      // A missing car is the coordinator's call, not the clock's.
      autoCompleteOnTimeout: false,
    });
    this.session = session;
    session.on('line', ({ raw }) => this.log(`< ${raw}`));
    session.on('state', ({ state }) => {
      this.status.state = state;
      // Going idle is always followed by heat-complete or cancel(), which publish
      // the consistent status (lastHeatId set, heatId cleared). Publishing here
      // too would show screens a moment where the heat looks abandoned.
      if (state === 'idle' && this.status.heatId) return;
      this.publish();
    });
    session.on('identity', ({ text }) => {
      this.status.identity = text;
      this.status.verified = true;
      this.publish();
    });
    session.on('unexpected', ({ message }) => this.options.onNotice?.('warn', message));
    session.on('race-start', () => this.onRaceStart());
    session.on('lane-result', (lane) => {
      this.status.liveLanes = [...this.status.liveLanes, lane];
      this.status.missingLanes = this.status.missingLanes.filter((l) => l !== lane.lane);
      this.publish();
    });
    session.on('timeout', ({ missingLanes }) => {
      this.status.missingLanes = missingLanes;
      this.log(`timeout: lanes ${missingLanes.join(', ')} still out`);
      this.publish();
    });
    session.on('heat-complete', (result) => this.onHeatComplete(result.lanes, result.forcedDnf));

    this.status.connected = true;
    this.status.connecting = false;
    if (this.simulator) {
      this.log('> V');
      session.identify();
    }
    this.publish();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.config.kind === 'simulator') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.options.reconnectDelayMs ?? 4000);
  }

  private async teardown(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.session?.dispose();
    this.session = null;
    this.simulator = null;
    const serial = this.serial;
    this.serial = null;
    if (serial) await serial.close().catch(() => undefined);
    this.status.connected = false;
    this.status.state = 'idle';
    this.status.identity = null;
    this.status.verified = false;
    this.status.heatId = null;
    this.status.testing = false;
    this.status.liveLanes = [];
    this.status.missingLanes = [];
    this.status.countdown = null;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.generation++;
    await this.teardown();
  }

  // -------------------------------------------------------------------------
  // Racing
  // -------------------------------------------------------------------------

  private requireSession(): TimerSession {
    if (!this.session || !this.status.connected) {
      throw new DerbyError(this.status.lastError ?? 'Timer not connected.', 'timer-offline');
    }
    return this.session;
  }

  /** Reset the timer and wait for the cars in this heat. */
  arm(heatId: string): void {
    const session = this.requireSession();
    const { heat } = this.engine.getHeat(heatId);
    if (heat.status === 'finished' || heat.status === 'voided') {
      throw new DerbyError('That heat has already run.', 'bad-state');
    }
    if (this.status.state === 'racing') throw new DerbyError('A heat is in progress.', 'bad-state');

    const lanes = heat.lanes
      .map((carId, i) => (carId && !this.engine.state.deadLanes.includes(i + 1) ? i + 1 : 0))
      .filter((l) => l > 0);
    if (lanes.length === 0) throw new DerbyError('This heat has no cars in usable lanes.', 'empty-heat');

    if (heat.status === 'pending') this.engine.stageHeat(heatId);
    this.engine.assignSpotlight(heatId);
    this.engine.noteArmed(heatId);
    this.simulator?.setOccupiedLanes(lanes);
    this.status.heatId = heatId;
    this.status.testing = false;
    this.status.liveLanes = [];
    this.status.countdown = null;
    this.status.lastError = null;
    this.log('> R');
    session.arm(lanes);
    this.publish();
  }

  /** Arm for every lane with no heat attached, to check the track and sensors. */
  test(): void {
    const session = this.requireSession();
    if (this.status.state === 'racing') throw new DerbyError('A heat is in progress.', 'bad-state');
    const lanes = Array.from({ length: this.engine.state.laneCount }, (_, i) => i + 1);
    this.simulator?.setOccupiedLanes(lanes);
    this.status.heatId = null;
    this.status.testing = true;
    this.status.liveLanes = [];
    this.status.lastError = null;
    this.log('> R (lane test)');
    session.arm(lanes);
    this.publish();
  }

  /** Run the light tree on the audience screen; the scout opens the gate on green. */
  startCountdown(): void {
    this.requireSession();
    if (this.status.state !== 'armed' || !this.status.heatId) throw new DerbyError('Arm a heat first.', 'bad-state');
    // Staging lights hold for stageMs, then one amber per intervalMs, then green.
    this.status.countdown = { startedAt: Date.now(), lights: 3, intervalMs: 1000, stageMs: 1500 };
    this.log('> countdown');
    this.publish();
  }

  cancelCountdown(): void {
    this.status.countdown = null;
    this.publish();
  }

  /** The replay camera page calls this every few seconds while it is open. */
  replayCamPing(state: 'ready' | 'recording' | 'no-camera'): void {
    this.status.replayCamAt = Date.now();
    this.status.replayCamState = state;
    this.publish();
  }

  /** Coordinator marks one lane as not finishing. Completes the heat if it was the last one out. */
  markDnf(lane: number): void {
    const session = this.requireSession();
    if (this.status.state === 'idle') throw new DerbyError('No heat is running.', 'bad-state');
    this.log(`> DNF lane ${lane} (coordinator)`);
    session.markDnf(lane);
  }

  /** Coordinator confirms every lane still out is a DNF. */
  confirmDnf(): void {
    const session = this.requireSession();
    if (this.status.state !== 'racing') throw new DerbyError('No heat is running.', 'bad-state');
    this.log('> DNF for all lanes still out (coordinator)');
    session.markMissingDnf();
  }

  /** Dismiss the DNF prompt and keep waiting; it returns after another timeout period. */
  keepWaiting(): void {
    this.status.missingLanes = [];
    this.publish();
  }

  /** Stop waiting for the armed heat (e.g. the coordinator enters times by hand). */
  cancel(): void {
    this.session?.cancel();
    this.status.heatId = null;
    this.status.testing = false;
    this.status.liveLanes = [];
    this.status.missingLanes = [];
    this.status.countdown = null;
    this.publish();
  }

  identify(): void {
    this.log('> V');
    this.requireSession().identify();
  }

  remoteStart(): void {
    this.log('> S');
    this.requireSession().remoteStart();
  }

  /** Simulator only: open the start gate. */
  simulateGate(): void {
    if (!this.simulator) throw new DerbyError('Only available with the simulated timer.', 'not-simulator');
    if (this.status.state !== 'armed') throw new DerbyError('Arm a heat first.', 'bad-state');
    this.simulator.releaseGate();
  }

  private onRaceStart(): void {
    this.status.countdown = null;
    const heatId = this.status.heatId;
    if (!heatId) {
      this.publish();
      return;
    }
    try {
      const { heat } = this.engine.getHeat(heatId);
      if (heat.status === 'pending' || heat.status === 'staged') this.engine.startHeat(heatId);
    } catch (err) {
      this.fail(err);
    }
    this.publish();
  }

  private onHeatComplete(lanes: HeatLaneTime[], forcedDnf: boolean): void {
    const heatId = this.status.heatId;
    const wasTest = this.status.testing;
    this.status.heatId = null;
    this.status.testing = false;
    this.status.lastLanes = lanes;
    this.status.lastHeatId = heatId;
    this.status.missingLanes = [];
    this.status.countdown = null;
    if (heatId) {
      try {
        this.engine.finishHeat(heatId, lanes, this.simulator ? 'simulator' : 'timer');
        if (forcedDnf) {
          const dnf = lanes.filter((l) => l.timeSec === null).map((l) => l.lane);
          this.options.onNotice?.('info', `Lane${dnf.length > 1 ? 's' : ''} ${dnf.join(', ')} recorded as DNF.`);
        }
      } catch (err) {
        this.fail(err);
      }
    } else if (wasTest) {
      const finished = lanes.filter((l) => l.timeSec !== null).map((l) => l.lane);
      const missing = lanes.filter((l) => l.timeSec === null).map((l) => l.lane);
      this.options.onNotice?.(
        missing.length ? 'warn' : 'info',
        missing.length ? `Lane test: lanes ${finished.join(', ') || 'none'} reported, lanes ${missing.join(', ')} did not.` : `Lane test: all ${finished.length} lanes reported.`,
      );
    }
    this.status.liveLanes = [];
    this.publish();
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.status.lastError = message;
    this.options.onNotice?.('error', message);
  }

  private log(line: string): void {
    this.status.log = [...this.status.log.slice(-(LOG_LINES - 1)), `${new Date().toLocaleTimeString()} ${line}`];
  }

  private publish(): void {
    this.options.onStatus(this.status);
  }
}
