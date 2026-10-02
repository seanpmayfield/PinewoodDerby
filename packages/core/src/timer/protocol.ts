/**
 * Wire protocol for the NewBold Derby Magic timer, as reverse-engineered by the
 * DerbyNet project. The timer is a plain serial device (USB via an MCP2221
 * bridge, appears as a COM port).
 *
 *   Serial      19200 8N1 on current firmware, 9600 8N1 on older units
 *   "V"         ask for identity; reply contains "Derby Magic"
 *   "R"         reset / arm for the next heat
 *   "S"         remote start (only with the solenoid gate)
 *   "B"         sent by the timer when the gate opens
 *   "1=3.1234!" lane 1 finished in 3.1234 s, place marker "!" = 1st
 *
 * Place markers are ASCII characters counted from "!" (0x21): "!" 1st, '"'
 * 2nd, "#" 3rd, "$" 4th. A lane that never finishes sends nothing.
 */

export const DERBY_MAGIC = {
  baudRates: [19200, 9600] as const,
  dataBits: 8,
  stopBits: 1,
  parity: 'none' as const,
  /** USB vendor id of the Microchip MCP2221 bridge, for auto-detecting the port. */
  usbVendorId: '04D8',
  commands: {
    identify: 'V',
    reset: 'R',
    remoteStart: 'S',
  },
  identityPattern: /Derby\s*Magic/i,
} as const;

export type TimerLineEvent =
  | { type: 'race-start' }
  | { type: 'lane-result'; lane: number; timeSec: number | null; place: number | null }
  | { type: 'identity'; text: string }
  | { type: 'unknown'; raw: string };

const RACE_START = /^B$/;
const LANE_RESULT = /([1-8])=(\d\.\d+)([!-/:-@])?/g;

/** Parse one line from the timer. A line may carry several lane results. */
export function parseDerbyMagicLine(raw: string): TimerLineEvent[] {
  const line = raw.replace(/[\r\n\x1b]/g, '').trim();
  if (line === '') return [];
  if (RACE_START.test(line)) return [{ type: 'race-start' }];
  if (DERBY_MAGIC.identityPattern.test(line)) return [{ type: 'identity', text: line }];

  const events: TimerLineEvent[] = [];
  for (const match of line.matchAll(LANE_RESULT)) {
    const lane = Number(match[1]);
    const time = Number(match[2]);
    const marker = match[3];
    events.push({
      type: 'lane-result',
      lane,
      // The timer reports 0.0000 for a lane that did not finish.
      timeSec: time > 0 ? time : null,
      place: marker ? marker.charCodeAt(0) - '!'.charCodeAt(0) + 1 : null,
    });
  }
  if (events.length === 0) events.push({ type: 'unknown', raw: line });
  return events;
}

/** Format a lane result the way the timer would send it. Used by the simulator. */
export function formatDerbyMagicResult(lane: number, timeSec: number, place: number | null): string {
  const marker = place ? String.fromCharCode('!'.charCodeAt(0) + place - 1) : '';
  return `${lane}=${timeSec.toFixed(4)}${marker}`;
}
