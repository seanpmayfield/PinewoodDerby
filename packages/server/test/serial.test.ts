import { describe, expect, it } from 'vitest';
import { TimerSession, type SerialParams } from '@derby/core';
import { connectTimer, probeProfile, SerialTimerPort, type RawPort, type SerialPortInfo } from '../src/timer/serial.js';
import { findProfile } from '@derby/core';

/** A fake serial device: scripted replies per command, recorded writes and opens. */
function fakeDevice(opts: { replies?: Record<string, string>; answersAt?: number[]; failOpen?: boolean } = {}) {
  const written: string[] = [];
  const opens: { path: string; params: SerialParams }[] = [];
  const devices: (RawPort & { emit: (s: string) => void; drop: () => void })[] = [];
  const open = async (path: string, params: SerialParams): Promise<RawPort> => {
    opens.push({ path, params });
    if (opts.failOpen) throw new Error('Access denied');
    let dataListener: ((chunk: Buffer | string) => void) | null = null;
    let closeListener: ((err?: Error | null) => void) | null = null;
    const replies = opts.replies ?? { V: 'Derby Magic Timer v3\r\n' };
    const port: RawPort & { emit: (s: string) => void; drop: () => void } = {
      write: (data) => {
        written.push(data);
        const reply = replies[data];
        if (reply !== undefined && (opts.answersAt ?? [19200]).includes(params.baud)) setTimeout(() => dataListener?.(reply), 5);
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
  return { open, written, opens, devices };
}

const list = async (): Promise<SerialPortInfo[]> => [
  { path: 'COM3', manufacturer: 'Intel', likelyTimer: false },
  { path: 'COM7', manufacturer: 'Microchip', vendorId: '04D8', likelyTimer: true },
];
const N81 = (baud: number): SerialParams => ({ baud, dataBits: 8, stopBits: 1, parity: 'none' });

describe('SerialTimerPort', () => {
  it('splits on CR, LF or CRLF, drops blank lines, and flushes a reply with no line ending after a pause', async () => {
    const dev = fakeDevice();
    const port = new SerialTimerPort(await dev.open('COM7', N81(19200)), 'COM7', N81(19200));
    const lines: string[] = [];
    port.onLine((l) => lines.push(l));
    port.feed('B\r\n1=3.12');
    port.feed('34!\n\n2=3.2000"\r3=');
    port.feed('3.3000#\n');
    expect(lines).toEqual(['B', '1=3.1234!', '2=3.2000"', '3=3.3000#']);
    port.feed('UUUUt');
    await new Promise((r) => setTimeout(r, 200));
    expect(lines.at(-1)).toBe('UUUUt');
  });

  it('feeds a real session end to end', async () => {
    const dev = fakeDevice();
    const port = new SerialTimerPort(await dev.open('COM7', N81(19200)), 'COM7', N81(19200));
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
    const port = new SerialTimerPort(await dev.open('COM7', N81(19200)), 'COM7', N81(19200));
    let closes = 0;
    port.onClose(() => closes++);
    dev.devices[0]!.drop();
    dev.devices[0]!.drop();
    expect(closes).toBe(1);
  });
});

describe('connectTimer', () => {
  it('auto-detect tries the likely port first and recognises the Derby Magic', async () => {
    const dev = fakeDevice();
    const result = await connectTimer({ open: dev.open, list, probeTimeoutMs: 50, settleMs: 10 });
    expect(result.profile.key).toBe('DerbyMagic');
    expect(result.port.path).toBe('COM7');
    expect(result.port.baudRate).toBe(19200);
    expect(result.verified).toBe(true);
    expect(result.identity).toContain('Derby Magic');
    expect(dev.opens[0]).toEqual({ path: 'COM7', params: N81(19200) });
  });

  it('finds an older Derby Magic at 9600 through its own profile', async () => {
    const dev = fakeDevice({ answersAt: [9600] });
    const result = await connectTimer({ open: dev.open, list, probeTimeoutMs: 50, settleMs: 10 });
    expect(result.profile.key).toBe('DerbyMagic9600');
    expect(result.port.baudRate).toBe(9600);
  });

  it('recognises a FastTrack from its two-line reply to RV, opened with its own settings', async () => {
    const dev = fakeDevice({ replies: { RV: 'Copyright (c) Micro Wizard 2002-2005\r\nK3 Version 1.05A  Serial Number 12345\r\n' }, answersAt: [9600] });
    const result = await connectTimer({ open: dev.open, list, probeTimeoutMs: 80, settleMs: 10 });
    expect(result.profile.key).toBe('FastTrack-K');
    expect(result.identity).toContain('K3 Version');
    expect(result.port.params).toEqual(N81(9600));
  });

  it('a profile without a prober opens blind when the port is given', async () => {
    const dev = fakeDevice({ replies: {} });
    const result = await connectTimer({ open: dev.open, list, profileKey: 'NewBold', path: 'COM3', probeTimeoutMs: 20, settleMs: 10 });
    expect(result.verified).toBe(false);
    expect(result.profile.key).toBe('NewBold');
    expect(dev.opens[0]!.params).toEqual({ baud: 1200, dataBits: 7, stopBits: 2, parity: 'none' });
  });

  it('a chosen profile that does not answer fails unless the port is explicit', async () => {
    const quiet = fakeDevice({ replies: {} });
    await expect(connectTimer({ open: quiet.open, list, profileKey: 'DerbyMagic', probeTimeoutMs: 20, settleMs: 10 })).rejects.toThrow(/No Derby Magic answered/);
    const blind = await connectTimer({ open: quiet.open, list, profileKey: 'DerbyMagic', path: 'COM3', probeTimeoutMs: 20, settleMs: 10 });
    expect(blind.verified).toBe(false);
  });

  it('fails with a useful message when nothing answers or opens', async () => {
    const quiet = fakeDevice({ replies: {} });
    await expect(connectTimer({ open: quiet.open, list, probeTimeoutMs: 10, settleMs: 10 })).rejects.toThrow(/No known timer answered/);
    const busy = fakeDevice({ failOpen: true });
    await expect(connectTimer({ open: busy.open, list, probeTimeoutMs: 10, settleMs: 10 })).rejects.toThrow(/Access denied/);
    await expect(connectTimer({ open: quiet.open, list: async () => [], probeTimeoutMs: 10, settleMs: 10 })).rejects.toThrow(/plugged in/);
    await expect(connectTimer({ open: quiet.open, list, profileKey: 'NoSuchTimer' })).rejects.toThrow(/Unknown timer/);
  });

  it('probeProfile resolves null on silence and sends the profile’s line ending', async () => {
    const dev = fakeDevice({ replies: {} });
    const champ = findProfile('TheChamp')!;
    const port = new SerialTimerPort(await dev.open('COM7', champ.params), 'COM7', champ.params);
    const result = await probeProfile(port, { ...champ, prober: { probe: 'v', responses: ['eTekGadget'] } }, 20);
    expect(result).toBeNull();
    expect(dev.written).toEqual(['v\r']);
  });
});
