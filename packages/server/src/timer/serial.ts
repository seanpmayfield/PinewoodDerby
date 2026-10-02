/**
 * Serial transport for the Derby Magic timer.
 *
 * The timer is a plain serial device behind a Microchip MCP2221 USB bridge
 * (vendor id 04D8). Current firmware talks at 19200 8N1, older units at 9600.
 * Lines end in "\n" (with an optional "\r"); commands are single characters
 * with no terminator, exactly as DerbyNet sends them.
 */

import { SerialPort } from 'serialport';
import { DERBY_MAGIC, parseDerbyMagicLine, type TimerPort } from '@derby/core';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  friendlyName?: string;
  /** True when the USB vendor id matches the MCP2221 bridge the timer uses. */
  likelyTimer: boolean;
}

/** The subset of a serial port the transport needs; a fake implements it in tests. */
export interface RawPort {
  write(data: string): void;
  onData(listener: (chunk: Buffer | string) => void): void;
  onClose(listener: (err?: Error | null) => void): void;
  close(): Promise<void>;
}

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    vendorId: p.vendorId,
    productId: p.productId,
    friendlyName: (p as { friendlyName?: string }).friendlyName,
    likelyTimer: (p.vendorId ?? '').toUpperCase() === DERBY_MAGIC.usbVendorId,
  }));
}

function openRawPort(path: string, baudRate: number): Promise<RawPort> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate, dataBits: DERBY_MAGIC.dataBits, stopBits: DERBY_MAGIC.stopBits, parity: DERBY_MAGIC.parity, autoOpen: false });
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

/**
 * Splits the byte stream into lines and exposes the `TimerPort` interface the
 * core `TimerSession` expects.
 */
export class SerialTimerPort implements TimerPort {
  private listeners = new Set<(line: string) => void>();
  private closeListeners = new Set<(err?: Error | null) => void>();
  private buffer = '';
  private closed = false;

  constructor(
    private readonly raw: RawPort,
    readonly path: string,
    readonly baudRate: number,
  ) {
    raw.onData((chunk) => this.feed(chunk.toString()));
    raw.onClose((err) => {
      if (this.closed) return;
      this.closed = true;
      for (const l of this.closeListeners) l(err);
    });
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
    await this.raw.close();
  }

  /** Exposed for tests. */
  feed(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.search(/[\r\n]/)) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim() === '') continue;
      for (const l of this.listeners) l(line);
    }
    // Some firmware may omit the newline after the identity reply; flush a
    // recognisable identity string even without a terminator.
    if (DERBY_MAGIC.identityPattern.test(this.buffer)) {
      const line = this.buffer;
      this.buffer = '';
      for (const l of this.listeners) l(line);
    }
  }
}

/**
 * Send the identify command and wait for "Derby Magic" in the reply.
 * Resolves with the identity text or null when nothing recognisable arrived.
 */
export function probeIdentity(port: SerialTimerPort, timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const unsubscribe = port.onLine((line) => {
      for (const event of parseDerbyMagicLine(line)) {
        if (event.type === 'identity') finish(event.text);
      }
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    port.write(DERBY_MAGIC.commands.identify);
  });
}

export interface ConnectOptions {
  /** Specific port, or undefined to try the ports that look like the timer first, then everything else. */
  path?: string;
  /** Specific baud rate, or undefined to try 19200 then 9600. */
  baudRate?: number;
  probeTimeoutMs?: number;
  open?: (path: string, baud: number) => Promise<RawPort>;
  list?: () => Promise<SerialPortInfo[]>;
}

export interface ConnectResult {
  port: SerialTimerPort;
  identity: string | null;
  /** True when the timer answered the identify command; false = opened blind on the requested settings. */
  verified: boolean;
}

/**
 * Find and open the timer. With an explicit path and baud the port is opened
 * even if the timer does not answer (some firmware may be quiet), and the
 * result says so. With anything unspecified, only a port that answers is used.
 */
export async function connectDerbyMagic(options: ConnectOptions = {}): Promise<ConnectResult> {
  const open = options.open ?? openRawPort;
  const list = options.list ?? listSerialPorts;
  const bauds = options.baudRate ? [options.baudRate] : [...DERBY_MAGIC.baudRates];
  let paths: string[];
  if (options.path) {
    paths = [options.path];
  } else {
    const ports = await list();
    paths = [...ports.filter((p) => p.likelyTimer), ...ports.filter((p) => !p.likelyTimer)].map((p) => p.path);
  }
  if (paths.length === 0) throw new Error('No serial ports found. Is the timer plugged in?');

  const explicit = !!(options.path && options.baudRate);
  let lastError: Error | null = null;
  for (const path of paths) {
    for (const baud of bauds) {
      let port: SerialTimerPort | null = null;
      try {
        port = new SerialTimerPort(await open(path, baud), path, baud);
        const identity = await probeIdentity(port, options.probeTimeoutMs ?? 2000);
        if (identity !== null) return { port, identity, verified: true };
        if (explicit) return { port, identity: null, verified: false };
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
      : `No timer answered on ${paths.join(', ')}. Check the cable and that nothing else has the port open.`,
  );
}
