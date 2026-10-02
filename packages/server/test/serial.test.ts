import { describe, expect, it } from 'vitest';
import { TimerSession } from '@derby/core';
import { connectDerbyMagic, probeIdentity, SerialTimerPort, type RawPort, type SerialPortInfo } from '../src/timer/serial.js';

/** A fake serial device that answers like a Derby Magic timer. */
function fakeDevice(opts: { answersAt?: number[]; failOpen?: boolean } = {}) {
  const written: string[] = [];
  const opens: { path: string; baud: number }[] = [];
  const open = async (path: string, baud: number): Promise<RawPort> => {
    opens.push({ path, baud });
    if (opts.failOpen) throw new Error('Access denied');
    let dataListener: ((chunk: Buffer | string) => void) | null = null;
    let closeListener: ((err?: Error | null) => void) | null = null;
    const port: RawPort & { emit: (s: string) => void; drop: () => void } = {
      write: (data) => {
        written.push(data);
        if (data === 'V' && (opts.answersAt ?? [19200]).includes(baud)) {
          setTimeout(() => dataListener?.('Derby Magic Timer v3\r\n'), 5);
        }
      },
      onData: (l) => (dataListener = l),
      onClose: (l) => (closeListener = l),
      close: async () => undefined,
      emit: (s) => dataListener?.(s),
      drop: () => closeListener?.(new Error('unplugged')),
    };
    devices.push(port);
    return port;
  };
  const devices: (RawPort & { emit: (s: string) => void; drop: () => void })[] = [];
  return { open, written, opens, devices };
}

const list = async (): Promise<SerialPortInfo[]> => [
  { path: 'COM3', manufacturer: 'Intel', likelyTimer: false },
  { path: 'COM7', manufacturer: 'Microchip', vendorId: '04D8', likelyTimer: true },
];

describe('SerialTimerPort', () => {
  it('splits on CR, LF or CRLF and drops blank lines', async () => {
    const dev = fakeDevice();
    const port = new SerialTimerPort(await dev.open('COM7', 19200), 'COM7', 19200);
    const lines: string[] = [];
    port.onLine((l) => lines.push(l));
    port.feed('B\r\n1=3.12');
    port.feed('34!\n\n2=3.2000"\r3=');
    port.feed('3.3000#\n');
    expect(lines).toEqual(['B', '1=3.1234!', '2=3.2000"', '3=3.3000#']);
  });

  it('feeds a real session end to end', async () => {
    const dev = fakeDevice();
    const port = new SerialTimerPort(await dev.open('COM7', 19200), 'COM7', 19200);
    const session = new TimerSession(port, { heatTimeoutMs: 10_000 });
    const done: unknown[] = [];
    session.on('heat-complete', (e) => done.push(e));
    session.arm([1, 2]);
    expect(dev.written).toEqual(['R']);
    dev.devices[0]!.emit('B\n1=3.1000!\n2=3.2000"\n');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ forcedDnf: false, lanes: [{ lane: 1, timeSec: 3.1, place: 1 }, { lane: 2, timeSec: 3.2, place: 2 }] });
  });

  it('reports a dropped connection once', async () => {
    const dev = fakeDevice();
    const port = new SerialTimerPort(await dev.open('COM7', 19200), 'COM7', 19200);
    let closes = 0;
    port.onClose(() => closes++);
    dev.devices[0]!.drop();
    dev.devices[0]!.drop();
    expect(closes).toBe(1);
  });
});

describe('connectDerbyMagic', () => {
  it('tries the likely port at 19200 first and verifies the identity', async () => {
    const dev = fakeDevice();
    const result = await connectDerbyMagic({ open: dev.open, list, probeTimeoutMs: 50 });
    expect(result.port.path).toBe('COM7');
    expect(result.port.baudRate).toBe(19200);
    expect(result.verified).toBe(true);
    expect(result.identity).toContain('Derby Magic');
    expect(dev.opens[0]).toEqual({ path: 'COM7', baud: 19200 });
  });

  it('falls back to 9600 for older firmware', async () => {
    const dev = fakeDevice({ answersAt: [9600] });
    const result = await connectDerbyMagic({ open: dev.open, list, probeTimeoutMs: 50 });
    expect(result.port.baudRate).toBe(9600);
    expect(dev.opens.map((o) => o.baud)).toEqual([19200, 9600]);
  });

  it('opens blind when path and baud are explicit and nothing answers', async () => {
    const dev = fakeDevice({ answersAt: [] });
    const result = await connectDerbyMagic({ open: dev.open, list, path: 'COM3', baudRate: 19200, probeTimeoutMs: 50 });
    expect(result.verified).toBe(false);
    expect(result.port.path).toBe('COM3');
  });

  it('fails with a useful message when nothing answers or opens', async () => {
    const quiet = fakeDevice({ answersAt: [] });
    await expect(connectDerbyMagic({ open: quiet.open, list, probeTimeoutMs: 20 })).rejects.toThrow(/No timer answered on COM7, COM3/);
    const busy = fakeDevice({ failOpen: true });
    await expect(connectDerbyMagic({ open: busy.open, list, probeTimeoutMs: 20 })).rejects.toThrow(/Access denied/);
    await expect(connectDerbyMagic({ open: quiet.open, list: async () => [], probeTimeoutMs: 20 })).rejects.toThrow(/plugged in/);
  });

  it('probeIdentity resolves null on silence', async () => {
    const dev = fakeDevice({ answersAt: [] });
    const port = new SerialTimerPort(await dev.open('COM7', 19200), 'COM7', 19200);
    expect(await probeIdentity(port, 20)).toBeNull();
  });
});
