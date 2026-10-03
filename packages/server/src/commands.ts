/**
 * Every mutation a screen can request, dispatched by name over one endpoint.
 * The engine does the real validation; this layer checks argument shapes and
 * routes to the engine, the timer service or the app.
 */

import {
  DerbyEngine,
  DerbyError,
  findPreset,
  findProfile,
  importRosterCsv,
  validateFormat,
  type Car,
  type DerbySettings,
  type Group,
  type Inspection,
  type LaneTimeInput,
  type RaceFormat,
  type Racer,
  type RosterRow,
} from '@derby/core';
import { seedDemo } from './demo.js';
import type { TimerConfig, TimerService } from './timer/service.js';

export interface CommandContext {
  engine: DerbyEngine;
  timer: TimerService;
  /** The media stores, for deleting files whose keys leave the state. */
  media: { photos: { remove: (key: string) => void }; replays: { remove: (key: string) => void }; headshots: { remove: (key: string) => void }; branding: { remove: (key: string) => void } };
  createDerby: (input: { name: string; date?: string; laneCount?: number; formatId?: string; copyRosterFrom?: string }) => DerbyEngine;
  /** Turn the automatic USB backup on or off (remembered). */
  setUsbBackup: (enabled: boolean) => void;
  /** Coordinator and crew PINs; null clears one. */
  setPins: (pins: { coordinator?: string | null; crew?: string | null }) => void;
  /** The voting password, kept out of the broadcast state. */
  setBallotPassword: (password: string | null) => void;
  loadDerby: (id: string) => DerbyEngine;
  restoreHistory: (historyId: number) => DerbyEngine;
  saveTimerConfig: (config: TimerConfig) => void;
  /** Remove an event that is not the active one. */
  deleteDerby: (id: string) => void;
  setWizardDone: (done: boolean) => void;
  /** Revert the last undoable command; returns what was undone. */
  undo: () => { label: string; at: string };
  /** Re-apply the last undone command. */
  redo: () => { label: string; at: string };
}

type Handler = (ctx: CommandContext, args: any) => unknown;

function str(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new DerbyError(`${name} is required.`, 'bad-args');
  return value;
}

function num(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new DerbyError(`${name} must be a number.`, 'bad-args');
  return value;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new DerbyError(`${name} must be true or false.`, 'bad-args');
  return value;
}

/** What a patch field may hold: a primitive type, null, a plain object, a list of strings, or one of a fixed set of strings. */
type Field = 'string' | 'number' | 'boolean' | 'object' | 'null' | 'strings' | { oneOf: readonly string[] };

/**
 * A client-supplied patch, reduced to the fields a command may change, with
 * each value checked. Anything else (an `id`, a storage key, a wrong type)
 * is refused rather than silently written into the event.
 */
function patchOf<T>(value: unknown, fields: Record<string, Field | Field[]>): Partial<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DerbyError('patch must be an object.', 'bad-args');
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined) continue;
    const spec = fields[key];
    if (!spec) throw new DerbyError(`"${key}" cannot be changed this way.`, 'bad-args');
    const options = Array.isArray(spec) ? spec : [spec];
    const ok = options.some((o) => {
      if (typeof o === 'object') return typeof raw === 'string' && o.oneOf.includes(raw);
      if (o === 'null') return raw === null;
      if (o === 'number') return typeof raw === 'number' && Number.isFinite(raw);
      if (o === 'object') return !!raw && typeof raw === 'object' && !Array.isArray(raw);
      if (o === 'strings') return Array.isArray(raw) && raw.every((x) => typeof x === 'string');
      return typeof raw === o;
    });
    if (!ok) throw new DerbyError(`Bad value for "${key}".`, 'bad-args');
    out[key] = raw;
  }
  return out as Partial<T>;
}

const ID: Field[] = ['string', 'null'];
const PRESENTATION_FIELDS: Record<string, Field | Field[]> = {
  mode: { oneOf: ['auto', 'welcome', 'standings', 'awards', 'sponsors'] },
  stage: { oneOf: ['welcome', 'round-intro', 'racing', 'standings', 'awards'] },
  stageRoundId: ID,
  standingsRoundId: ID,
  revealedAwardIds: 'strings',
  nomineesAwardId: ID,
  message: 'string',
  resultHoldSec: 'number',
  soundEnabled: 'boolean',
  replayHeatId: ID,
  replaySpeed: 'number',
  replayPreRollSec: 'number',
  replayTailSec: 'number',
  introRoundId: ID,
  introHoldSec: 'number',
  theme: 'string',
};

function laneTimes(value: unknown): LaneTimeInput[] {
  if (!Array.isArray(value)) throw new DerbyError('times must be a list.', 'bad-args');
  return value.map((t: { lane: unknown; timeSec: unknown }) => ({
    lane: num(t.lane, 'lane'),
    timeSec: t.timeSec === null || t.timeSec === undefined || t.timeSec === '' ? null : num(Number(t.timeSec), 'timeSec'),
  }));
}

const COMMANDS: Record<string, Handler> = {
  // --- event ---------------------------------------------------------------
  newDerby: (ctx, a) => {
    const engine = ctx.createDerby({
      name: str(a.name, 'name'),
      date: a.date,
      laneCount: a.laneCount,
      formatId: a.formatId,
      copyRosterFrom: typeof a.copyRosterFrom === 'string' ? a.copyRosterFrom : undefined,
    });
    return engine.state.id;
  },
  setUsbBackup: (ctx, a) => ctx.setUsbBackup(a.enabled !== false),
  loadDerby: (ctx, a) => ctx.loadDerby(str(a.id, 'id')).state.id,
  deleteDerby: (ctx, a) => ctx.deleteDerby(str(a.id, 'id')),
  restoreHistory: (ctx, a) => ctx.restoreHistory(num(a.historyId, 'historyId')).state.id,
  updateDerby: (ctx, a) => ctx.engine.updateDerby(patchOf(a.patch, { name: 'string', date: 'string', laneCount: 'number' })),
  updateSettings: (ctx, a) =>
    ctx.engine.updateSettings(
      patchOf<DerbySettings>(a.patch, {
        dnfTimeSec: 'number',
        heatTimeoutSec: 'number',
        maxWeightOz: 'number',
        requireInspectionPass: 'boolean',
        rerunPlacement: { oneOf: ['next', 'end'] },
      }),
    ),
  setFormat: (ctx, a) => {
    let format: RaceFormat | undefined;
    if (typeof a.formatId === 'string') format = findPreset(a.formatId);
    else if (a.format) format = a.format as RaceFormat;
    if (!format) throw new DerbyError('Unknown format.', 'bad-args');
    const errors = validateFormat(format);
    if (errors.length) throw new DerbyError(errors.join(' '), 'invalid-format');
    ctx.engine.setFormat(format);
  },
  seedDemo: (ctx) => seedDemo(ctx.engine),
  undo: (ctx) => ctx.undo(),
  redo: (ctx) => ctx.redo(),
  setWizardDone: (ctx, a) => ctx.setWizardDone(a.done !== false),
  resetRaces: (ctx) => {
    ctx.timer.cancel();
    ctx.engine.resetRaces();
  },

  // --- groups ----------------------------------------------------------------
  addGroup: (ctx, a) => ctx.engine.addGroup({ name: str(a.name, 'name'), kind: a.kind ?? 'den', parentId: a.parentId ?? ctx.engine.pack().id }),
  updateGroup: (ctx, a) => ctx.engine.updateGroup(str(a.id, 'id'), patchOf<Group>(a.patch, { name: 'string', kind: { oneOf: ['pack', 'den', 'class'] }, parentId: ID, sortOrder: 'number' })),

  // --- racers and cars ---------------------------------------------------------
  addRacer: (ctx, a) => {
    const racer = ctx.engine.addRacer({
      firstName: str(a.firstName, 'firstName'),
      lastName: typeof a.lastName === 'string' ? a.lastName : '',
      groupId: str(a.groupId, 'groupId'),
      rank: a.rank,
    });
    const car = ctx.engine.addCar({ racerId: racer.id, number: a.carNumber, name: a.carName });
    return { racer, car };
  },
  updateRacer: (ctx, a) =>
    ctx.engine.updateRacer(str(a.id, 'id'), patchOf<Racer>(a.patch, { firstName: 'string', lastName: 'string', groupId: 'string', rank: 'string', notes: 'string', checkedIn: 'boolean' })),
  removeRacer: (ctx, a) => ctx.engine.removeRacer(str(a.id, 'id')),
  setCheckedIn: (ctx, a) => ctx.engine.setCheckedIn(str(a.racerId, 'racerId'), bool(a.checkedIn, 'checkedIn')),
  checkInGroup: (ctx, a) => ctx.engine.setGroupCheckedIn(str(a.groupId, 'groupId'), a.checkedIn !== false),
  importRoster: (ctx, a) => {
    const rows: RosterRow[] = Array.isArray(a.rows) ? a.rows : importRosterCsv(str(a.csv, 'csv')).roster;
    const result = ctx.engine.importRoster(rows);
    return { imported: result.racers.length };
  },
  updateCar: (ctx, a) => ctx.engine.updateCar(str(a.id, 'id'), patchOf<Car>(a.patch, { number: 'number', name: 'string', groupId: ID, weightOz: ['number', 'null'], withdrawn: 'boolean' })),
  setWeight: (ctx, a) => ctx.engine.setWeight(str(a.carId, 'carId'), a.weightOz === null ? undefined : num(a.weightOz, 'weightOz')),
  setInspection: (ctx, a) => {
    const patch = patchOf<Inspection>(a.patch, { status: { oneOf: ['pending', 'passed', 'needs-work', 'failed'] }, checks: 'object', notes: 'string', inspectedAt: 'string' });
    if (patch.checks && !Object.values(patch.checks).every((v) => typeof v === 'boolean')) throw new DerbyError('checks must be true or false.', 'bad-args');
    return ctx.engine.setInspection(str(a.carId, 'carId'), patch);
  },
  withdrawCar: (ctx, a) => ctx.engine.withdrawCar(str(a.carId, 'carId'), a.withdrawn ?? true),
  clearCarPhoto: (ctx, a) => {
    const { removed } = ctx.engine.clearCarPhoto(str(a.carId, 'carId'));
    for (const key of removed) ctx.media.photos.remove(key);
    return removed.length;
  },
  clearRacerHeadshot: (ctx, a) => {
    const racer = ctx.engine.requireRacer(str(a.racerId, 'racerId'));
    const previous = racer.headshot;
    ctx.engine.setRacerHeadshot(racer.id, undefined);
    if (previous) ctx.media.headshots.remove(previous);
    return racer.id;
  },
  clearHeatReplay: (ctx, a) => {
    const { heat } = ctx.engine.getHeat(str(a.heatId, 'heatId'));
    const previous = heat.replay;
    ctx.engine.setHeatReplay(heat.id, undefined);
    if (previous) ctx.media.replays.remove(previous);
    return heat.id;
  },
  /** Put a heat's result and replay back on the audience screen (null to resume). */
  showReplay: (ctx, a) => ctx.engine.setPresentation({ replayHeatId: a.heatId ?? null }),

  // --- rounds and heats ----------------------------------------------------------
  startRound: (ctx, a) => ctx.engine.startRound(str(a.specKey, 'specKey')).map((r) => r.id),
  setLaneDead: (ctx, a) => ctx.engine.setLaneDead(num(a.lane, 'lane'), bool(a.dead, 'dead')),
  armHeat: (ctx, a) => ctx.timer.arm(str(a.heatId, 'heatId')),
  cancelArm: (ctx) => ctx.timer.cancel(),
  startCountdown: (ctx) => ctx.timer.startCountdown(),
  replayCamPing: (ctx, a) => ctx.timer.replayCamPing(a.state === 'recording' || a.state === 'no-camera' ? a.state : 'ready'),
  markLaneDnf: (ctx, a) => ctx.timer.markDnf(num(a.lane, 'lane')),
  confirmDnf: (ctx) => ctx.timer.confirmDnf(),
  keepWaiting: (ctx) => ctx.timer.keepWaiting(),
  simulateGate: (ctx) => ctx.timer.simulateGate(),
  identifyTimer: (ctx) => ctx.timer.identify(),
  /** Open the start gate on a track with a solenoid release the timer controls. */
  remoteStartTimer: (ctx) => ctx.timer.remoteStart(),
  testTimer: (ctx) => ctx.timer.test(),
  listSerialPorts: (ctx) => ctx.timer.scanPorts(),
  /** Switch between the simulator and the real timer, or pick a port/baud. */
  configureTimer: async (ctx, a) => {
    const patch: Partial<TimerConfig> = {};
    if (a.kind !== undefined) {
      const kind = str(a.kind, 'kind');
      if (kind !== 'simulator' && kind !== 'auto' && !findProfile(kind)) throw new DerbyError('kind must be simulator, auto, or a known timer.', 'bad-args');
      patch.kind = kind;
    }
    if (a.port !== undefined) patch.port = a.port === null || a.port === '' ? null : str(a.port, 'port');
    if (a.baud !== undefined) patch.baud = a.baud === null || a.baud === '' ? null : num(Number(a.baud), 'baud');
    await ctx.timer.configure(patch);
    ctx.saveTimerConfig(ctx.timer.config);
    return ctx.timer.status;
  },
  finishHeat: (ctx, a) => {
    const heatId = str(a.heatId, 'heatId');
    if (ctx.timer.status.heatId === heatId) ctx.timer.cancel();
    if (Array.isArray(a.lanes)) ctx.engine.setHeatLanes(heatId, a.lanes as (string | null)[]);
    return ctx.engine.finishHeat(heatId, laneTimes(a.times), 'manual').id;
  },
  amendHeat: (ctx, a) => {
    const heatId = str(a.heatId, 'heatId');
    if (Array.isArray(a.lanes)) ctx.engine.setHeatLanes(heatId, a.lanes as (string | null)[]);
    return ctx.engine.amendHeat(heatId, laneTimes(a.times)).id;
  },
  rerunHeat: (ctx, a) => {
    const heatId = str(a.heatId, 'heatId');
    if (ctx.timer.status.heatId === heatId) ctx.timer.cancel();
    return ctx.engine.rerunHeat(heatId, typeof a.reason === 'string' ? a.reason : '').id;
  },

  // --- awards --------------------------------------------------------------------
  addAward: (ctx, a) => ctx.engine.addAward({ name: str(a.name, 'name'), kind: a.kind ?? 'design', groupId: a.groupId ?? null }),
  removeAward: (ctx, a) => ctx.engine.removeAward(str(a.id, 'id')),
  setAwardWinner: (ctx, a) => ctx.engine.setAwardWinner(str(a.awardId, 'awardId'), a.carId ?? null),
  reorderAwards: (ctx, a) => {
    if (!Array.isArray(a.ids)) throw new DerbyError('ids must be a list.', 'bad-args');
    ctx.engine.reorderAwards(a.ids as string[]);
  },
  clearLogo: (ctx) => {
    const previous = ctx.engine.setLogo(null);
    if (previous) ctx.media.branding.remove(previous);
  },
  addSponsor: (ctx, a) => ctx.engine.addSponsor(str(a.name, 'name')),
  updateSponsor: (ctx, a) => ctx.engine.updateSponsor(str(a.id, 'id'), { name: a.name === undefined ? undefined : str(a.name, 'name') }).sponsor,
  removeSponsor: (ctx, a) => {
    const image = ctx.engine.removeSponsor(str(a.id, 'id'));
    if (image) ctx.media.branding.remove(image);
  },
  reorderSponsors: (ctx, a) => {
    if (!Array.isArray(a.ids)) throw new DerbyError('ids must be a list.', 'bad-args');
    ctx.engine.reorderSponsors(a.ids as string[]);
  },
  /** Voting set-up. `password` is stored server-side; null clears it. */
  setBallot: (ctx, a) => {
    const patch = patchOf<{ open: boolean; awardIds: string[]; votesPerAward: number; password: string | null }>(a.patch ?? {}, { open: 'boolean', awardIds: 'strings', votesPerAward: 'number', password: ['string', 'null'] });
    const { password, ...rest } = patch;
    if (password !== undefined) {
      ctx.setBallotPassword(password && password.trim() ? password.trim() : null);
      (rest as { passwordRequired?: boolean }).passwordRequired = !!(password && password.trim());
    }
    return ctx.engine.setBallot(rest);
  },
  /** Set or clear the coordinator and crew PINs (coordinator only). */
  setPins: (ctx, a) => {
    const patch = patchOf<{ coordinator: string | null; crew: string | null }>(a.patch ?? {}, { coordinator: ['string', 'null'], crew: ['string', 'null'] });
    ctx.setPins(patch);
  },
  setAwardNominee: (ctx, a) => ctx.engine.setAwardNominee(str(a.awardId, 'awardId'), str(a.carId, 'carId'), a.nominated !== false),
  setCarSeen: (ctx, a) => ctx.engine.setCarSeen(str(a.carId, 'carId'), a.seen !== false),
  setJudgingCriteria: (ctx, a) => {
    if (!Array.isArray(a.criteria)) throw new DerbyError('criteria must be a list.', 'bad-args');
    return ctx.engine.setJudgingCriteria(a.criteria as { id?: string; name: string; max: number }[]);
  },
  setCarScore: (ctx, a) =>
    ctx.engine.setCarScore(str(a.judgeId, 'judgeId'), str(a.carId, 'carId'), str(a.criterionId, 'criterionId'), a.value === null || a.value === undefined ? null : num(a.value, 'value')),
  addJudge: (ctx, a) => ctx.engine.addJudge(str(a.name, 'name')),
  renameJudge: (ctx, a) => ctx.engine.renameJudge(str(a.id, 'id'), str(a.name, 'name')),
  removeJudge: (ctx, a) => ctx.engine.removeJudge(str(a.id, 'id')),
  generateSpeedAwards: (ctx) => ctx.engine.generateSpeedAwards().length,
  computeSpeedAwards: (ctx) => ctx.engine.computeSpeedAwards().length,

  // --- the show flow ----------------------------------------------------------------
  flowReset: (ctx) => ctx.engine.flowReset(),
  flowNext: (ctx) => {
    const r = ctx.engine.flowNext();
    return { stage: r.stage, roundId: r.round?.id ?? null, awardId: r.award?.id ?? null, nominees: r.nominees ?? false };
  },
  flowStandings: (ctx) => ctx.engine.flowStandings(),

  // --- audience screen -------------------------------------------------------------
  setPresentation: (ctx, a) => ctx.engine.setPresentation(patchOf(a.patch ?? {}, PRESENTATION_FIELDS)),
  revealNextAward: (ctx) => ctx.engine.revealNextAward()?.id ?? null,
  unrevealLastAward: (ctx) => ctx.engine.unrevealLastAward(),
  resetCeremony: (ctx) => ctx.engine.resetCeremony(),
};

export async function runCommand(ctx: CommandContext, name: string, args: unknown): Promise<unknown> {
  const handler = COMMANDS[name];
  if (!handler) throw new DerbyError(`Unknown command "${name}".`, 'unknown-command');
  return handler(ctx, args ?? {});
}
