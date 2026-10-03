/**
 * Timer profiles: how each make of track timer talks over its serial port.
 *
 * The protocols here are ported from DerbyNet by Jeff Piazza
 * (https://github.com/jeffpiazza/derbynet, MIT licence), specifically the
 * profile classes under timer/src/org/jeffpiazza/derby/profiles and the
 * engine in timer/TimerDeviceWithProfile.java, which took years of work with
 * real hardware to get right. Comments quoting timer output are his. Thank
 * you, Jeff.
 *
 * A profile is data, not code: the session in session.ts runs any profile.
 *
 *  params        serial settings
 *  eol           appended to every command (some timers want "\r")
 *  maxLanes      the most lanes this kind of timer has, for lane masks
 *  gateStateKnowable
 *                false when the timer never says whether the start gate is
 *                open, so racing can only be inferred from results
 *  timeScale     divide reported times by this (SuperTimer reports 1/10000 s)
 *  prober        how to recognise the timer: optional commands to settle it,
 *                the probe command, and the response patterns that must
 *                match, in order, across the lines that come back
 *  setup         commands sent once after a successful probe
 *  setupQueries  commands whose replies are read with their own matchers
 *                (lane count, feature bits); those matchers are live only for
 *                a moment after the query, since a bare digit could mean
 *                anything otherwise
 *  matchers      patterns applied to every line, in order; a match is cut
 *                out of the line and the rest is matched again
 *  gateWatcher   command polled while waiting for the gate, and the replies
 *                that mean open or closed
 *  heatPrep      how to get ready for a heat: clear the lane mask, mask each
 *                empty lane (`mask` + a lane character counted from `lane`),
 *                or send one command with the mask embedded; then reset
 *  on            extra commands when an event happens
 *  poll          commands repeated while waiting in a phase
 *  remoteStart   command that opens the gate, where the track has a solenoid
 */

export type TimerEvent =
  | 'GATE_OPEN'
  | 'GATE_CLOSED'
  | 'GET_SET'
  | 'RACE_STARTED'
  | 'RACE_FINISHED'
  | 'LANE_RESULT'
  | 'PARTIAL_LANE'
  | 'PARTIAL_TIME'
  | 'LANE_COUNT'
  | 'GATE_WATCHER_NOT_SUPPORTED'
  | 'NO_LASER_RESET'
  | 'OVERDUE';

export interface Matcher {
  /** A JavaScript regular expression source, searched (not anchored) in the line. */
  pattern: string;
  event?: TimerEvent;
  /** Capture groups passed with the event, e.g. [1, 2] for lane and time. */
  args?: number[];
}

export interface SerialParams {
  baud: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
}

export interface TimerProfile {
  /** Stable id saved in the timer setup. */
  key: string;
  name: string;
  /** Product page or maker. */
  url?: string;
  params: SerialParams;
  eol: string;
  maxLanes: number;
  gateStateKnowable: boolean;
  timeScale: number;
  /** USB bridge vendor ids this timer is known to use, to try likely ports first. */
  usbVendorIds?: string[];
  prober?: { preProbe?: string[]; probe: string; responses: string[] };
  setup?: string[];
  setupQueries?: { command: string; matchers: Matcher[] }[];
  matchers: Matcher[];
  gateWatcher?: { command: string; matchers: Matcher[] };
  heatPrep?: {
    unmask?: string;
    mask?: string;
    /** Character for lane 1 in mask commands, e.g. 'A' or '1'. */
    lane?: string;
    reset?: string;
    /** One command with the lane bitmask OR'd in at `offset`, sent as `nbytes` big-endian bytes. */
    embeddedMask?: { command: number; offset: number; nbytes: number };
  };
  on?: Partial<Record<TimerEvent, string[]>>;
  poll?: Partial<Record<'MARK' | 'SET', string[]>>;
  remoteStart?: { command: string; note?: string };
  notes?: string;
}

const N81 = (baud: number): SerialParams => ({ baud, dataBits: 8, stopBits: 1, parity: 'none' });

/** Lane results in the common "A=3.001! B=3.002\"" style: lane letter, time, optional place character counted from '!'. */
const LETTER_RESULT = ' *([A-Z])=(\\d+\\.\\d+)([^ ]?)';

export const DERBY_MAGIC_PROFILE: TimerProfile = {
  key: 'DerbyMagic',
  name: 'Derby Magic',
  url: 'http://www.derbymagic.com',
  params: N81(19200),
  eol: '',
  maxLanes: 8,
  gateStateKnowable: false,
  timeScale: 1,
  // Microchip MCP2221 USB bridge.
  usbVendorIds: ['04D8'],
  prober: { probe: 'V', responses: ['Derby Magic'] },
  setup: ['R'],
  matchers: [
    { pattern: '^B$', event: 'RACE_STARTED' },
    // 1=3.1234! with the place as a character counted from '!'; 0.0000 for a lane that did not finish.
    { pattern: '([1-8])=(\\d\\.\\d+)([!-/:-@])? *', event: 'LANE_RESULT', args: [1, 2, 3] },
  ],
  // DerbyNet resets this timer once at set-up; it also accepts a reset before each heat, which is what the simulator expects.
  heatPrep: { reset: 'R' },
  remoteStart: { command: 'S', note: 'Only with the Derby Magic solenoid start gate.' },
};

export const TIMER_PROFILES: TimerProfile[] = [
  DERBY_MAGIC_PROFILE,
  {
    ...DERBY_MAGIC_PROFILE,
    key: 'DerbyMagic9600',
    name: 'Derby Magic (older firmware, 9600 baud)',
    params: N81(9600),
  },
  {
    key: 'FastTrack-K',
    name: 'MicroWizard FastTrack K or Q series',
    url: 'http://www.microwizard.com',
    params: N81(9600),
    eol: '',
    maxLanes: 6,
    gateStateKnowable: true,
    timeScale: 1,
    // Replies to RV: "Copyright (c) Micro Wizard 2002-2005" then "K3 Version 1.05A  Serial Number nnnnn" (or "Model: Q...").
    prober: { probe: 'RV', responses: ['Micro Wizard|MICRO WIZARD', '^K|Model: Q'] },
    // RE: reset eliminator mode. N1: "new" result format. N2: enhanced format (5-digit times, 2012 or newer timers).
    setup: ['RE', 'N1', 'N2'],
    // RF returns feature bits; bit 6 clear means the laser gate cannot be reset from the computer (no LR).
    setupQueries: [{ command: 'RF', matchers: [{ pattern: '^[01][01]0[01] *[01][01][01]1$', event: 'NO_LASER_RESET' }] }],
    matchers: [{ pattern: LETTER_RESULT, event: 'LANE_RESULT', args: [1, 2, 3] }],
    // MG clears the mask; M + A..F masks one lane.
    heatPrep: { unmask: 'MG', mask: 'M', lane: 'A' },
    // RG reads the start switch: 0 open, 1 closed, X when the option is not fitted.
    gateWatcher: {
      command: 'RG',
      matchers: [
        { pattern: '^RG0|0$', event: 'GATE_OPEN' },
        { pattern: '^RG1|1$', event: 'GATE_CLOSED' },
        { pattern: '^X$', event: 'GATE_WATCHER_NOT_SUPPORTED' },
      ],
    },
    // LR resets the laser gate while cars are being staged.
    poll: { MARK: ['LR'] },
    remoteStart: { command: 'LG', note: 'Only with the MicroWizard automatic gate release.' },
  },
  {
    key: 'FastTrack-P',
    name: 'MicroWizard FastTrack P series',
    url: 'http://www.microwizard.com',
    params: N81(9600),
    eol: '',
    maxLanes: 6,
    gateStateKnowable: false,
    timeScale: 1,
    setup: ['RF'],
    matchers: [{ pattern: ' *([A-Z])=(\\d\\.\\d+)([^ ]?)', event: 'LANE_RESULT', args: [1, 2, 3] }],
    notes: 'Cannot be detected automatically; pick it by hand.',
  },
  {
    key: 'TheChamp',
    name: 'The Champ (SmartLine, eTekGadget, BestTrack)',
    url: 'http://www.besttrack.com/champ_timer.htm',
    params: N81(9600),
    eol: '\r',
    maxLanes: 6,
    gateStateKnowable: true,
    timeScale: 1,
    // An empty command first lets the timer settle; "v" is answered with "eTekGadget SmartLine Timer ...".
    prober: { preProbe: [''], probe: 'v', responses: ['eTekGadget SmartLine Timer'] },
    // r reset; or/ol/od/op/rs read the configuration into the log; ol0 reports lane 1 as "A"; op3 uses '!' for first place.
    setup: ['r', 'or', 'ol', 'od', 'op', 'rs', 'ol0', 'op3'],
    // on: number of lanes.
    setupQueries: [{ command: 'on', matchers: [{ pattern: '^(\\d)$', event: 'LANE_COUNT', args: [1] }] }],
    matchers: [{ pattern: ' *([A-Z])=(\\d\\.\\d+)([^ ]?)', event: 'LANE_RESULT', args: [1, 2, 3] }],
    // om0 clears the mask; om + 1..6 masks a lane; rg asks for results when the race ends.
    heatPrep: { unmask: 'om0', mask: 'om', lane: '1', reset: 'rg' },
    // rs reads the start switch: 0 closed, 1 open.
    gateWatcher: {
      command: 'rs',
      matchers: [
        { pattern: '^0$', event: 'GATE_CLOSED' },
        { pattern: '^1$', event: 'GATE_OPEN' },
      ],
    },
    // Gate polling after the start cancels the pending rg, so it is sent again once the race starts; ra forces the end of a race.
    on: { RACE_STARTED: ['rg'], OVERDUE: ['ra'] },
  },
  {
    key: 'TheChampSRM',
    name: 'The Champ (SRM firmware, 2023 and later)',
    url: 'http://www.besttrack.com/champ_timer.htm',
    params: N81(9600),
    eol: '\r',
    maxLanes: 6,
    gateStateKnowable: false,
    timeScale: 1,
    // "v" is answered with "Rev H Copyright SRM Enterprises".
    prober: { preProbe: [''], probe: 'v', responses: ['SRM.*Enterprises'] },
    matchers: [
      { pattern: 'S', event: 'RACE_STARTED' },
      // This firmware reports lanes as numbers.
      { pattern: ' *(\\d)=(\\d\\.\\d+)([^ ]?)', event: 'LANE_RESULT', args: [1, 2, 3] },
    ],
  },
  {
    key: 'TheJudge',
    name: 'The Judge (New Directions)',
    url: 'http://www.newdirections.ws',
    params: N81(9600),
    eol: '\r',
    maxLanes: 6,
    gateStateKnowable: false,
    timeScale: 1,
    prober: { probe: '*', responses: ['Checking Valid Lanes'] },
    matchers: [
      { pattern: 'Number of Lanes:?\\s+(\\d)', event: 'LANE_COUNT', args: [1] },
      { pattern: '^G[oO]!?$', event: 'RACE_STARTED' },
      // A lane that never finishes is still reported, with a long time and "DNF", e.g. "Lane 6     31.0589   DNF".
      { pattern: '^Lane\\s+(\\d)\\s+0*(\\d+\\.\\d+)(\\s.*)?$', event: 'LANE_RESULT', args: [1, 2] },
      { pattern: 'Race Over.*', event: 'RACE_FINISHED' },
    ],
    heatPrep: { unmask: 'om0', mask: 'om', lane: '1' },
    on: { OVERDUE: ['*'] },
  },
  {
    key: 'NewBold',
    name: 'NewBold DT, TURBO or DerbyStick',
    url: 'http://www.pinewood-derby-timer.com',
    params: { baud: 1200, dataBits: 7, stopBits: 2, parity: 'none' },
    eol: '',
    maxLanes: 6,
    gateStateKnowable: false,
    timeScale: 1,
    setup: [' '],
    // "1  3.1234" per lane.
    matchers: [{ pattern: '^\\s*(\\d)\\s+(\\d\\.\\d+)(\\s|)', event: 'LANE_RESULT', args: [1, 2] }],
    heatPrep: { reset: ' ' },
    notes: 'Cannot be detected automatically; pick it by hand.',
  },
  {
    key: 'DerbyTimer.com',
    name: 'Derby Timer (derbytimer.com)',
    url: 'https://derbytimer.com',
    params: N81(9600),
    eol: '',
    maxLanes: 6,
    gateStateKnowable: true,
    timeScale: 1,
    // R is answered with "RESET" then "READY 4 LANES".
    prober: { probe: 'R', responses: ['^RESET$', '^READY\\s*(\\d+)\\s+LANES'] },
    matchers: [
      { pattern: '^READY\\s*(\\d+)\\s+LANES', event: 'LANE_COUNT', args: [1] },
      { pattern: '^\\s*(\\d)\\s+(\\d\\.\\d+)(\\s.*|)', event: 'LANE_RESULT', args: [1, 2] },
      { pattern: '^RACE$', event: 'RACE_STARTED' },
    ],
    // C clears the mask; M + 1..6 masks a lane.
    heatPrep: { unmask: 'C', mask: 'M', lane: '1' },
    // G reads the gate: U up (closed), D down (open).
    gateWatcher: {
      command: 'G',
      matchers: [
        { pattern: '^U$', event: 'GATE_CLOSED' },
        { pattern: '^D$', event: 'GATE_OPEN' },
      ],
    },
    on: { OVERDUE: ['F'] },
  },
  {
    key: 'MiscJunk',
    name: 'PDT timer (dfgtec.com, Arduino)',
    url: 'https://www.dfgtec.com/pdt',
    params: N81(9600),
    eol: '',
    maxLanes: 6,
    gateStateKnowable: true,
    timeScale: 1,
    // Arduino boards.
    usbVendorIds: ['2341', '1A86'],
    // V is answered with "vert=..."; N replies "numl=4".
    prober: { preProbe: [''], probe: 'V', responses: ['vert='] },
    setup: ['R', 'N'],
    matchers: [
      { pattern: 'numl=(\\d)', event: 'LANE_COUNT', args: [1] },
      { pattern: '^B$', event: 'RACE_STARTED' },
      { pattern: '(\\d) - (\\d+\\.\\d+)', event: 'LANE_RESULT', args: [1, 2] },
    ],
    // U clears the mask; M + 1..6 masks a lane; R resets, and must be sent again once the gate is closed.
    heatPrep: { unmask: 'U', mask: 'M', lane: '1', reset: 'R' },
    gateWatcher: {
      command: 'G',
      matchers: [
        { pattern: 'O', event: 'GATE_OPEN' },
        { pattern: '\\.', event: 'GATE_CLOSED' },
      ],
    },
    on: { GET_SET: ['R'], OVERDUE: ['F'] },
    remoteStart: { command: 'S' },
  },
  {
    key: 'BertDrake',
    name: 'Bert Drake timer',
    url: 'http://drakedev.com/pinewood/',
    params: N81(9600),
    eol: '',
    maxLanes: 6,
    gateStateKnowable: true,
    timeScale: 1,
    prober: { preProbe: ['R'], probe: 'V', responses: ['Bert Drake'] },
    matchers: [
      // B means the gate opened; the race starts when that follows a closed gate.
      { pattern: '^B$', event: 'GATE_OPEN' },
      { pattern: '^\\s*(\\d)\\s+(\\d\\.\\d+)(\\s.*|)', event: 'LANE_RESULT', args: [1, 2] },
    ],
    heatPrep: { reset: 'R' },
    // C reads the gate: Gc closed, Go open.
    gateWatcher: {
      command: 'C',
      matchers: [
        { pattern: '^Gc$', event: 'GATE_CLOSED' },
        { pattern: '^Go$', event: 'GATE_OPEN' },
      ],
    },
    on: { OVERDUE: ['F'] },
  },
  {
    key: 'JIT',
    name: 'JIT Racemaster',
    params: N81(9600),
    eol: '',
    maxLanes: 6,
    gateStateKnowable: false,
    timeScale: 1,
    prober: { probe: 'V', responses: ['JIT, Inc.*Racemaster Software', '^Software Version'] },
    setup: ['L'],
    matchers: [{ pattern: '^.*Place Single Lane Number:\\s*(\\d+)\\s+Time in Seconds:\\s*(\\d+\\.\\d{4,})', event: 'LANE_RESULT', args: [1, 2] }],
    heatPrep: { reset: 'R' },
  },
  {
    key: 'SuperTimerII',
    name: 'SuperTimer II',
    url: 'http://www.supertimer.com',
    params: N81(9600),
    eol: '\r',
    maxLanes: 6,
    gateStateKnowable: false,
    // Times arrive as whole numbers of 1/10000 s.
    timeScale: 10000,
    prober: { probe: 'UUUUc', responses: ['UUUUt'] },
    // Each result is two lines: "#1" for the lane, then the time; "!" ends the race.
    matchers: [
      { pattern: '#([1-6])', event: 'PARTIAL_LANE', args: [1] },
      { pattern: '(\\d{4,})', event: 'PARTIAL_TIME', args: [0] },
      { pattern: '!', event: 'RACE_FINISHED' },
    ],
    // "3@5A" with the six-bit lane mask added to the second byte: 3O5A enables lanes 1-4.
    heatPrep: { embeddedMask: { command: 0x33403541, offset: 16, nbytes: 4 } },
    notes: 'Protocol worked out by sniffing the maker’s software; DerbyNet marks it untested.',
  },
];

export function findProfile(key: string): TimerProfile | undefined {
  return TIMER_PROFILES.find((p) => p.key === key);
}

/** Profiles that can be recognised by probing, in the order worth trying. */
export function detectableProfiles(): TimerProfile[] {
  return TIMER_PROFILES.filter((p) => p.prober);
}

/** A DerbyNet convention: a lane that never finished is reported as all zeros, so "0.0000" means did not finish. */
export function isNoFinish(time: string): boolean {
  return /^0\.0+$/.test(time);
}

/** Lane number from the character a timer uses: digits count from '1', letters from 'A'. */
export function laneFromChar(c: string): number {
  return c >= '0' && c <= '9' ? c.charCodeAt(0) - '1'.charCodeAt(0) + 1 : c.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0) + 1;
}

/** Place from the character after a time, counted from '!' (so '!' is 1st, '"' 2nd, '#' 3rd). */
export function placeFromChar(c: string | undefined): number | null {
  if (!c) return null;
  const place = c.charCodeAt(0) - '!'.charCodeAt(0) + 1;
  return place >= 1 && place <= 26 ? place : null;
}

/** Bytes of a command with a field OR'd in, most significant byte first (SuperTimer lane masks). */
export function embeddedFieldCommand(command: number, offset: number, nbytes: number, value: number): string {
  let n = command + value * 2 ** offset;
  const chars: string[] = [];
  for (let i = 0; i < nbytes; i++) {
    chars.push(String.fromCharCode(n % 256));
    n = Math.floor(n / 256);
  }
  return chars.reverse().join('');
}
