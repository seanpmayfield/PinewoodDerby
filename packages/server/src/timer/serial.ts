/**
 * Serial transport for track timers.
 *
 * Opens a COM port with a profile's settings, splits the byte stream into
 * lines for the core `TimerSession`, and recognises which timer is on the
 * other end by probing the way DerbyNet does: settle it if the profile says
 * so, send the probe command, and expect its response patterns in order.
 */

import { SerialPort } from 'serialport';
import { detectableProfiles, findProfile, TIMER_PROFILES, type SerialParams, type TimerPort, type TimerProfile } from '@derby/core';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  friendlyName?: string;
  /** True when the USB vendor id is one a known timer uses. */
  likelyTimer: boolean;
}

/** The subset of a serial port the transport needs; a fake implements it in tests. */
export interface RawPort {
  write(data: string): void;
  onData(listener: (chunk: Buffer | string) => void): void;
  onClose(listener: (err?: Error | null) => void): void;
  close(): Promise<void>;
}

const KNOWN_VENDORS = new Set(TIMER_PROFILES.flatMap((p) => p.usbVendorIds ?? []).map((v) => v.toUpperCase()));

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    vendorId: p.vendorId,
    productId: p.productId,
    friendlyName: (p as { friendlyName?: string }).friendlyName,
    likelyTimer: KNOWN_VENDORS.has((p.vendorId ?? '').toUpperCase()),
  }));
}

function openRawPort(path: string, params: SerialParams): Promise<RawPort> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: params.baud, dataBits: params.dataBits, stopBits: params.stopBits, parity: params.parity, autoOpen: false });
    port.open((err) => {
      if (err) return reject(err);
      resolve({
        write: (data) => port.write(data),
        onData: (listener) => port.on('data', listener),
        onClose: (listener) => {
          port.on('close', (e: Error | null) => listener(e));
          port.on('error', (e: Error) => listener(e));
        },
        close: () =>
          new Promise<void>((res) => {
            if (!port.isOpen) return res();
            port.close(() => res());
          }),
      });
    });
  });
}

/** A reply with no line ending (some timers) is taken as a line after this much silence. */
const SILENCE_FLUSH_MS = 120;

/**
 * Splits the byte stream into lines and exposes the `TimerPort` interface the
 * core `TimerSession` expects.
 */
export class SerialTimerPort implements TimerPort {
  private listeners = new Set<(line: string) => void>();
  private closeListeners = new Set<(err?: Error | null) => void>();
  private buffer = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly raw: RawPort,
    readonly path: string,
    readonly params: SerialParams,
  ) {
    raw.onData((chunk) => this.feed(chunk.toString('latin1')));
    raw.onClose((err) => {
      if (this.closed) return;
      this.closed = true;
      for (const l of this.closeListeners) l(err);
    });
  }

  get baudRate(): number {
    return this.params.baud;
  }

  write(command: string): void {
    if (!this.closed) this.raw.write(command);
  }

  onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: (err?: Error | null) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.raw.close();
  }

  /** Exposed for tests. */
  feed(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.search(/[\r\n]/)) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim() !== '') this.deliver(line);
    }
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.buffer.trim() !== '') {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const line = this.buffer;
        this.buffer = '';
        if (line.trim() !== '') this.deliver(line);
      }, SILENCE_FLUSH_MS);
      this.flushTimer.unref?.();
    }
  }

  private deliver(line: string): void {
    for (const l of this.listeners) l(line);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long a timer gets to settle after the pre-probe commands, and to answer the probe. */
const PRE_PROBE_SETTLE_MS = 1500;
const PROBE_RESPONSE_MS = 700;

/**
 * Ask a port whether this profile's timer is on it: the responses must arrive
 * in order within the window. Resolves with the identifying line, or null.
 */
export async function probeProfile(port: SerialTimerPort, profile: TimerProfile, timeoutMs = PROBE_RESPONSE_MS, settleMs = PRE_PROBE_SETTLE_MS): Promise<string | null> {
  const prober = profile.prober;
  if (!prober) return null;
  if (prober.preProbe) {
    for (const command of prober.preProbe) {
      port.write(command + profile.eol);
      await sleep(100);
    }
    await sleep(settleMs);
  }
  return new Promise((resolve) => {
    let index = 0;
    let pattern = new RegExp(prober.responses[0]!);
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const unsubscribe = port.onLine((raw) => {
      const line = raw.replace(/\x1b/g, '').trim();
      if (!pattern.test(line)) return;
      index++;
      if (index >= prober.responses.length) finish(line);
      else pattern = new RegExp(prober.responses[index]!);
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    port.write(prober.probe + profile.eol);
  });
}

export interface ConnectOptions {
  /** Specific port, or undefined to try the ports that look like a timer first, then everything else. */
  path?: string;
  /** Override the profile's baud rate (older Derby Magic firmware, say). */
  baudRate?: number;
  /** A profile key to connect as, or 'auto' / undefined to try every detectable profile. */
  profileKey?: string;
  probeTimeoutMs?: number;
  /** Settle time after a profile's pre-probe commands (tests shorten it). */
  settleMs?: number;
  open?: (path: string, params: SerialParams) => Promise<RawPort>;
  list?: () => Promise<SerialPortInfo[]>;
  /** Progress, for the timer log. */
  onProgress?: (message: string) => void;
}

export interface ConnectResult {
  port: SerialTimerPort;
  profile: TimerProfile;
  identity: string | null;
  /** True when the timer answered the probe; false = opened blind on the requested settings. */
  verified: boolean;
}

/**
 * Find and open the timer. With an explicit profile, path and baud the port
 * is opened even if the timer does not answer (profiles without a prober can
 * only work this way), and the result says so. Otherwise only a port that
 * answers a probe is used.
 */
export async function connectTimer(options: ConnectOptions = {}): Promise<ConnectResult> {
  const open = options.open ?? openRawPort;
  const list = options.list ?? listSerialPorts;
  const explicitProfile = options.profileKey && options.profileKey !== 'auto' ? findProfile(options.profileKey) : undefined;
  if (options.profileKey && options.profileKey !== 'auto' && !explicitProfile) throw new Error(`Unknown timer "${options.profileKey}".`);
  const candidates = explicitProfile ? [explicitProfile] : detectableProfiles();

  let paths: string[];
  if (options.path) {
    paths = [options.path];
  } else {
    const ports = await list();
    const vendorsOf = (p: SerialPortInfo) => (p.vendorId ?? '').toUpperCase();
    // Ports whose USB bridge matches the wanted profile first, then other timer-like bridges, then the rest.
    const preferred = explicitProfile ? new Set((explicitProfile.usbVendorIds ?? []).map((v) => v.toUpperCase())) : new Set<string>();
    paths = [...ports.filter((p) => preferred.has(vendorsOf(p))), ...ports.filter((p) => !preferred.has(vendorsOf(p)) && p.likelyTimer), ...ports.filter((p) => !preferred.has(vendorsOf(p)) && !p.likelyTimer)].map((p) => p.path);
  }
  if (paths.length === 0) throw new Error('No serial ports found. Is the timer plugged in?');

  // Blind opening is only sensible when nothing is left to guess.
  const blind = !!(explicitProfile && options.path && (options.baudRate || !explicitProfile.prober || true));
  let lastError: Error | null = null;
  for (const path of paths) {
    for (const profile of candidates) {
      const params: SerialParams = { ...profile.params, baud: options.baudRate ?? profile.params.baud };
      let port: SerialTimerPort | null = null;
      try {
        options.onProgress?.(`trying ${profile.name} on ${path} @ ${params.baud}`);
        port = new SerialTimerPort(await open(path, params), path, params);
        const identity = profile.prober ? await probeProfile(port, profile, options.probeTimeoutMs, options.settleMs) : null;
        if (identity !== null) return { port, profile, identity, verified: true };
        if (blind) return { port, profile, identity: null, verified: false };
        await port.close();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await port?.close().catch(() => undefined);
      }
    }
  }
  throw new Error(
    lastError
      ? `Could not open the timer: ${lastError.message}`
      : explicitProfile
        ? `No ${explicitProfile.name} answered on ${paths.join(', ')}. Check the cable and that nothing else has the port open.`
        : `No known timer answered on ${paths.join(', ')}. Check the cable, or pick the timer by hand and set its port.`,
  );
}
