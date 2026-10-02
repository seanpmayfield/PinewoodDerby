import { describe, expect, it } from 'vitest';
import { formatDerbyMagicResult, parseDerbyMagicLine } from '../src/timer/protocol.js';

describe('parseDerbyMagicLine', () => {
  it('recognises the start marker', () => {
    expect(parseDerbyMagicLine('B\r\n')).toEqual([{ type: 'race-start' }]);
  });

  it('parses a lane result with a place marker', () => {
    expect(parseDerbyMagicLine('1=3.1234!')).toEqual([{ type: 'lane-result', lane: 1, timeSec: 3.1234, place: 1 }]);
    expect(parseDerbyMagicLine('4=3.4000$')).toEqual([{ type: 'lane-result', lane: 4, timeSec: 3.4, place: 4 }]);
  });

  it('parses several results on one line', () => {
    const events = parseDerbyMagicLine('1=3.1234! 2=3.2000" 3=3.3000#');
    expect(events.map((e) => (e.type === 'lane-result' ? e.place : null))).toEqual([1, 2, 3]);
  });

  it('treats a zero time as no finish', () => {
    expect(parseDerbyMagicLine('2=0.0000')).toEqual([{ type: 'lane-result', lane: 2, timeSec: null, place: null }]);
  });

  it('recognises the identity reply', () => {
    expect(parseDerbyMagicLine('Derby Magic Timer v2')).toEqual([{ type: 'identity', text: 'Derby Magic Timer v2' }]);
  });

  it('returns unknown for anything else and nothing for blank lines', () => {
    expect(parseDerbyMagicLine('hello')).toEqual([{ type: 'unknown', raw: 'hello' }]);
    expect(parseDerbyMagicLine('  \r\n')).toEqual([]);
  });

  it('round-trips through the formatter', () => {
    const line = formatDerbyMagicResult(3, 2.9876, 2);
    expect(line).toBe('3=2.9876"');
    expect(parseDerbyMagicLine(line)).toEqual([{ type: 'lane-result', lane: 3, timeSec: 2.9876, place: 2 }]);
  });
});
