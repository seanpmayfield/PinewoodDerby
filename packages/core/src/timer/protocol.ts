/**
 * The Derby Magic dialect the simulator speaks (the real profile is in
 * profiles.ts): "V" asks for identity, "R" resets, "S" opens a solenoid gate,
 * the timer sends "B" when the gate opens and "1=3.1234!" per lane, the
 * place being a character counted from "!".
 */

export const DERBY_MAGIC = {
  commands: {
    identify: 'V',
    reset: 'R',
    remoteStart: 'S',
  },
} as const;

/** Format a lane result the way the timer would send it. Used by the simulator. */
export function formatDerbyMagicResult(lane: number, timeSec: number, place: number | null): string {
  const marker = place ? String.fromCharCode('!'.charCodeAt(0) + place - 1) : '';
  return `${lane}=${timeSec.toFixed(4)}${marker}`;
}
