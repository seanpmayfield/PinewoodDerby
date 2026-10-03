import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { statSync } from 'node:fs';
import { DerbyEngine, DerbyError, findPreset, findProfile, FORMAT_PRESETS, type Derby } from '@derby/core';
import type { ServerConfig } from './config.js';
import { DerbyStore, type HistoryEntry } from './store.js';
import { BrandingStore, HeadshotStore, MediaStore, PhotoStore, ReplayStore } from './media.js';
import { Hub, type UndoInfo } from './hub.js';
import { exportEvent, importEvent, slugify } from './archive.js';
import { UsbBackup } from './backup.js';
import { TimerService, type TimerConfig } from './timer/service.js';
import { runCommand, type CommandContext } from './commands.js';
import { ensureTls, type TlsMaterial } from './tls.js';
import { findFfmpeg, transcodeToMp4, type TranscodeOptions } from './transcode.js';
import { firewallRuleExists, HOTSPOT_ADDRESS, lanHosts, lanUrls, tlsHosts } from './network.js';

export interface App {
  fastify: FastifyInstance;
  store: DerbyStore;
  timer: TimerService;
  backup: UsbBackup;
  engine: () => DerbyEngine;
  /** Start the HTTPS listener (after `fastify.listen`). Resolves with the port, or null when disabled. */
  listenHttps: () => Promise<number | null>;
  close: () => Promise<void>;
}

/** Actions whose snapshot Undo may revert; everything else (arming, look, pings) is housekeeping and is skipped. */
const UNDOABLE = new Set([
  'finishHeat', 'amendHeat', 'rerunHeat', 'confirmDnf', 'markLaneDnf', 'simulateGate', 'timerResult',
  'startRound', 'addCarToRound', 'setLaneDead', 'resetRaces',
  'flowNext', 'flowStandings', 'flowReset',
  'setAwardWinner', 'revealNextAward', 'unrevealLastAward', 'resetCeremony', 'generateSpeedAwards', 'computeSpeedAwards',
  'addAward', 'removeAward', 'reorderAwards', 'setAwardNominee', 'setJudgingCriteria', 'setCarScore',
  'addSponsor', 'updateSponsor', 'reorderSponsors', 'addJudge', 'renameJudge', 'removeJudge', 'checkInGroup', 'setBallot',
  'addRacer', 'updateRacer', 'removeRacer', 'setCheckedIn', 'importRoster',
  'updateCar', 'setWeight', 'setInspection', 'withdrawCar',
  'addGroup', 'updateGroup', 'setFormat', 'updateSettings', 'updateDerby', 'seedDemo',
]);

/** How far back Undo looks. */
const HISTORY_WINDOW = 300;

const USB_BACKUP_KEY = 'usbBackup';
const ACTIVE_KEY = 'activeDerbyId';
const TIMER_KEY = 'timerConfig';
const WIZARD_KEY = 'wizardDone';
const PINS_KEY = 'pins';
const BALLOT_PASSWORD_KEY = 'ballotPassword';

/** What a crew PIN may do: check-in, pit table, judging. Everything else needs the coordinator PIN. */
const CREW_COMMANDS = new Set([
  'setCheckedIn', 'checkInGroup', 'setWeight', 'setInspection', 'updateCar', 'updateRacer', 'addRacer', 'clearCarPhoto', 'clearRacerHeadshot',
  'setCarSeen', 'setAwardNominee', 'setCarScore', 'addJudge', 'renameJudge', 'removeJudge', 'setAwardWinner', 'addAward', 'setBallot',
]);

export { lanUrls } from './network.js';

export async function buildApp(
  config: ServerConfig,
  deps: { store?: DerbyStore; photos?: PhotoStore; replays?: ReplayStore; headshots?: HeadshotStore; branding?: BrandingStore } = {},
): Promise<App> {
  const store = deps.store ?? new DerbyStore(path.join(config.dataDir, 'derby.sqlite'));
  const photos = deps.photos ?? new PhotoStore(path.join(config.dataDir, 'photos'));
  const replays = deps.replays ?? new ReplayStore(path.join(config.dataDir, 'replays'));
  const headshots = deps.headshots ?? new HeadshotStore(path.join(config.dataDir, 'headshots'));
  const branding = deps.branding ?? new BrandingStore(path.join(config.dataDir, 'branding'));
  const hub = new Hub();

  let engine = loadOrCreateActive(store);
  let unsubscribe = wire(engine);

  // Undo. Every change is already snapshotted; a snapshot's label is the
  // command that made it (or 'timerResult' for a finish reported by the
  // timer), so Undo can say what it reverts and skip the housekeeping ones.
  let currentAction: string | null = null;
  // While a command runs, its commits are collected and saved as one snapshot
  // when it finishes, so Undo reverts the whole command (a roster import, say).
  let batch: { state: Derby; change: string } | null = null;
  /** History id the current state was restored from by Undo, or null when the current state is the newest. */
  let undoCursor: number | null = null;
  /** History ids of changes undone in a row, newest last; cleared by any other change. */
  const redoStack: number[] = [];
  let finishedCount = countFinished(engine.state);
  const history = () => store.history(engine.state.id, HISTORY_WINDOW);

  function countFinished(state: Derby): number {
    return state.rounds.reduce((n, r) => n + r.heats.filter((h) => h.status === 'finished').length, 0);
  }

  function labelFor(state: Derby, change: string): string {
    if (currentAction) return currentAction;
    const grew = countFinished(state) > finishedCount;
    return change === 'heats' && grew ? 'timerResult' : 'timer';
  }

  function record(state: Derby, label: string): void {
    store.save(state, label);
    backup.markChanged();
    if (label !== 'undo' && label !== 'redo') {
      undoCursor = null;
      redoStack.length = 0;
    }
    finishedCount = countFinished(state);
  }

  function undoTarget(): { restore: HistoryEntry; undoing: HistoryEntry } | null {
    const entries = history();
    let i = undoCursor === null ? 0 : entries.findIndex((e) => e.id === undoCursor);
    if (i < 0) return null;
    for (; i < entries.length - 1; i++) {
      if (UNDOABLE.has(entries[i]!.change)) return { restore: entries[i + 1]!, undoing: entries[i]! };
    }
    return null;
  }

  function undoInfo(): UndoInfo | null {
    const target = undoTarget();
    return target ? { label: target.undoing.change, at: target.undoing.createdAt } : null;
  }

  function redoInfo(): UndoInfo | null {
    const id = redoStack.at(-1);
    const entry = id === undefined ? undefined : history().find((e) => e.id === id);
    return entry ? { label: entry.change, at: entry.createdAt } : null;
  }

  function broadcastState(): void {
    hub.broadcast({ type: 'state', state: engine.state, undo: undoInfo(), redo: redoInfo() });
  }

  /** Preferences are not part of what Undo or Redo revert: the look, sound and timings stay as they are now. */
  function keepPreferences(restored: Derby): Derby {
    const p = engine.state.presentation;
    restored.presentation = {
      ...restored.presentation,
      theme: p.theme,
      soundEnabled: p.soundEnabled,
      replaySpeed: p.replaySpeed,
      replayPreRollSec: p.replayPreRollSec,
      replayTailSec: p.replayTailSec,
      resultHoldSec: p.resultHoldSec,
      introHoldSec: p.introHoldSec,
      message: p.message,
    };
    return restored;
  }

  function redo(): UndoInfo {
    const id = redoStack.at(-1);
    const entry = id === undefined ? undefined : history().find((e) => e.id === id);
    const restored = id === undefined ? null : store.loadHistory(id);
    if (id === undefined || !entry || !restored) throw new DerbyError('Nothing to redo.', 'bad-state');
    redoStack.pop();
    if (timer.status.heatId) timer.cancel();
    undoCursor = id;
    activate(new DerbyEngine(keepPreferences(restored)), 'redo');
    return { label: entry.change, at: entry.createdAt };
  }

  function wire(e: DerbyEngine): () => void {
    return e.onChange((state, change) => {
      if (currentAction) {
        batch = { state, change };
        return;
      }
      record(state, labelFor(state, change));
      broadcastState();
    });
  }

  function flushBatch(): void {
    const b = batch;
    batch = null;
    if (!b || !currentAction) return;
    record(b.state, currentAction);
    broadcastState();
  }

  function activate(e: DerbyEngine, label = 'activate'): DerbyEngine {
    unsubscribe();
    batch = null;
    engine = e;
    unsubscribe = wire(engine);
    record(engine.state, label);
    store.setMeta(ACTIVE_KEY, engine.state.id);
    timer.setEngine(engine);
    broadcastState();
    return engine;
  }

  function undo(): UndoInfo {
    const target = undoTarget();
    if (!target) throw new DerbyError('Nothing to undo.', 'bad-state');
    const restored = store.loadHistory(target.restore.id);
    if (!restored) throw new DerbyError('That snapshot is gone.', 'not-found');
    if (timer.status.heatId) timer.cancel();
    undoCursor = target.restore.id;
    redoStack.push(target.undoing.id);
    activate(new DerbyEngine(keepPreferences(restored)), 'undo');
    return { label: target.undoing.change, at: target.undoing.createdAt };
  }

  /** Run a state change outside /api/command (an upload) under its own undo label. */
  async function withAction<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
    currentAction = label;
    try {
      return await fn();
    } finally {
      flushBatch();
      currentAction = null;
    }
  }

  // The timer setup chosen in the UI outlives restarts; env vars are the defaults.
  const timerConfig = readTimerConfig(store.getMeta(TIMER_KEY)) ?? { kind: config.timer, port: config.serialPort, baud: null };
  const timer = new TimerService(engine, {
    config: timerConfig,
    simulatorSpeed: config.simulatorSpeed,
    simulatorDnfChance: config.simulatorDnfChance,
    onStatus: (status) => hub.broadcast({ type: 'timer', timer: status }),
    onNotice: (level, message) => hub.broadcast({ type: 'notice', level, message }),
  });

  const stores = { photos, replays, headshots, branding };
  const backup = new UsbBackup({
    enabled: store.getMeta(USB_BACKUP_KEY) !== '0',
    supported: config.usbBackup,
    archive: () => ({ name: slugify(engine.state.name), buffer: exportEvent(engine.state, stores) }),
    onStatus: (status) => hub.broadcast({ type: 'backup', backup: status }),
  });
  backup.start();

  const ctx: CommandContext = {
    get engine() {
      return engine;
    },
    timer,
    media: stores,
    saveTimerConfig: (c: TimerConfig) => store.setMeta(TIMER_KEY, JSON.stringify(c)),
    deleteDerby: (id: string) => {
      if (id === engine.state.id) throw new DerbyError('Open a different event first; the active event cannot be deleted.', 'bad-state');
      store.delete(id);
    },
    setWizardDone: (done: boolean) => store.setMeta(WIZARD_KEY, done ? '1' : '0'),
    setPins: (patch) => {
      const saved = JSON.parse(store.getMeta(PINS_KEY) ?? '{}') as { coordinator?: string | null; crew?: string | null };
      const next = { ...saved, ...patch };
      for (const key of ['coordinator', 'crew'] as const) if (next[key] !== undefined && next[key] !== null && !next[key]!.trim()) next[key] = null;
      store.setMeta(PINS_KEY, JSON.stringify(next));
    },
    setBallotPassword: (password) => store.setMeta(BALLOT_PASSWORD_KEY, password ?? ''),
    undo,
    redo,
    createDerby: (input) => {
      const created = DerbyEngine.create({
        name: input.name,
        date: input.date,
        laneCount: input.laneCount,
        format: input.formatId ? findPreset(input.formatId) : undefined,
      });
      if (input.copyRosterFrom) {
        const from = input.copyRosterFrom === engine.state.id ? engine.state : store.load(input.copyRosterFrom);
        if (!from) throw new DerbyError('No such event to copy the roster from.', 'not-found');
        created.adoptRoster(from);
      }
      return activate(created);
    },
    setUsbBackup: (enabled) => {
      store.setMeta(USB_BACKUP_KEY, enabled ? '1' : '0');
      backup.setEnabled(enabled);
    },
    loadDerby: (id) => {
      const state = store.load(id);
      if (!state) throw new DerbyError('No such derby.', 'not-found');
      return activate(new DerbyEngine(state));
    },
    restoreHistory: (historyId) => {
      const state = store.loadHistory(historyId);
      if (!state) throw new DerbyError('No such snapshot.', 'not-found');
      return activate(new DerbyEngine(state));
    },
  };

  // HTTPS with our own local CA so phones can use the live camera. The same
  // request handler serves both ports; WebSocket upgrades on the HTTPS server
  // are forwarded to the HTTP server object that @fastify/websocket listens on.
  let tls: TlsMaterial | null = null;
  let httpsServer: https.Server | null = null;
  if (config.httpsPort) {
    try {
      tls = ensureTls(config.tlsDir, tlsHosts());
    } catch (err) {
      console.error('HTTPS disabled: could not prepare certificates.', err);
    }
  }
  const fastify = Fastify({
    logger: false,
    bodyLimit: 80 * 1024 * 1024,
    serverFactory: (handler) => {
      const server = http.createServer((req, res) => handler(req, res));
      if (tls) {
        httpsServer = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => handler(req, res));
        httpsServer.on('upgrade', (req, socket, head) => server.emit('upgrade', req, socket, head));
      }
      return server;
    },
  });
  await fastify.register(fastifyWebsocket);

  // Re-issue the certificate when the laptop's addresses change (hotspot turned on later).
  const tlsRefresh = tls
    ? setInterval(() => {
        try {
          const next = ensureTls(config.tlsDir, tlsHosts());
          if (next.issued && httpsServer) {
            tls = next;
            httpsServer.setSecureContext({ key: next.key, cert: next.cert });
          }
        } catch {
          /* keep the current certificate */
        }
      }, 30_000)
    : null;
  tlsRefresh?.unref();

  // Open pages keep running the bundle they loaded. When a new build lands on
  // disk (an update, or a rebuild while the server runs) tell them so they reload.
  const buildStamp = (): string => {
    if (!config.webDist) return 'dev';
    try {
      const st = statSync(path.join(config.webDist, 'index.html'));
      return `${st.mtimeMs}-${st.size}`;
    } catch {
      return 'none';
    }
  };
  let build = buildStamp();
  const buildWatch = setInterval(() => {
    const now = buildStamp();
    if (now !== build) {
      build = now;
      hub.broadcast({ type: 'build', build });
    }
  }, 10_000);
  buildWatch.unref();
  fastify.addContentTypeParser(/^(image|video)\/.+/, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  fastify.addContentTypeParser(['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  /** PINs set on the Setup tab win over the environment. */
  const pins = (): { coordinator: string | null; crew: string | null } => {
    const saved = JSON.parse(store.getMeta(PINS_KEY) ?? '{}') as { coordinator?: string | null; crew?: string | null };
    return { coordinator: saved.coordinator ?? config.pin, crew: saved.crew ?? config.crewPin };
  };

  /**
   * Every POST needs a PIN when a coordinator PIN is configured. The crew
   * PIN opens only the check-in, pit and judging commands and the photo and
   * video uploads; GETs (screens, media, export) are always open.
   */
  const requireRole = (crewAllowed: boolean | ((req: { body?: unknown }) => boolean)): preHandlerHookHandler => (req, reply, done) => {
    const { coordinator, crew } = pins();
    if (coordinator === null) return done();
    const given = req.headers['x-derby-pin'];
    if (given === coordinator) return done();
    const allowed = typeof crewAllowed === 'function' ? crewAllowed(req) : crewAllowed;
    if (crew !== null && given === crew && allowed) return done();
    reply.code(401).send({ ok: false, error: given ? 'That PIN cannot do this.' : 'PIN required.', code: 'unauthorized' });
  };
  const requirePin = requireRole(false);
  const requireCrew = requireRole(true);
  const requireCommandRole = requireRole((req) => CREW_COMMANDS.has(((req.body as { name?: string } | undefined)?.name) ?? ''));

  /** Serve one stored media file, immutable (keys are unique per upload). */
  function serveMedia(route: string, store: MediaStore, notFound: string): void {
    fastify.get<{ Params: { key: string } }>(route, async (req, reply) => {
      const key = req.params.key;
      if (!store.exists(key)) return reply.code(404).send({ ok: false, error: notFound, code: 'not-found' });
      return reply
        .header('content-type', store.contentType(key))
        .header('content-length', store.size(key))
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(store.stream(key));
    });
  }

  /** Convert a recorded clip to H.264 MP4 so every screen can play it; keep the original if ffmpeg fails. */
  async function normaliseClip(what: string, data: Buffer, ext: string, options: TranscodeOptions): Promise<{ data: Buffer; ext: string }> {
    try {
      const out = await transcodeToMp4(data, ext, options);
      return { data: out.buffer, ext: out.ext };
    } catch (err) {
      console.warn(`${what} kept as ${ext}; conversion failed: ${err instanceof Error ? err.message : String(err)}`);
      return { data, ext };
    }
  }

  fastify.get('/ws', { websocket: true }, (socket, req) => {
    const raw = req.raw.socket as { encrypted?: boolean; remoteAddress?: string };
    hub.add(socket, { tls: !!raw.encrypted, ip: (raw.remoteAddress ?? '').replace(/^::ffff:/, ''), userAgent: req.headers['user-agent'] ?? '' });
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; page?: string; secure?: boolean; camera?: boolean };
        if (msg.type === 'hello') {
          hub.describe(socket, { page: typeof msg.page === 'string' ? msg.page : 'unknown', secure: !!msg.secure, camera: !!msg.camera });
        }
      } catch {
        /* ignore */
      }
    });
    hub.send(socket, { type: 'build', build });
    hub.send(socket, { type: 'state', state: engine.state, undo: undoInfo(), redo: redoInfo() });
    hub.send(socket, { type: 'timer', timer: timer.status });
  });

  /** Everything the setup wizard needs to verify the room: network, firewall, screens, phones, tools. */
  fastify.get('/api/diagnostics', async () => ({
    addresses: lanHosts(),
    hotspot: lanHosts().includes(HOTSPOT_ADDRESS),
    port: config.port,
    httpsPort: tls ? config.httpsPort : null,
    firewallRule: await firewallRuleExists(config.port),
    ffmpeg: findFfmpeg() !== null,
    dataDir: config.dataDir,
    wizardDone: store.getMeta(WIZARD_KEY) === '1',
    clients: hub.list().map((c) => ({ ...c, userAgent: c.userAgent.slice(0, 120) })),
    timer: timer.status,
    build,
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    uptimeSec: Math.round(process.uptime()),
  }));

  /** The local CA root, for phones to trust once. */
  fastify.get('/ca.pem', async (_req, reply) => {
    if (!tls) return reply.code(404).send({ ok: false, error: 'HTTPS is not enabled.' });
    return reply
      .header('content-type', 'application/x-x509-ca-cert')
      .header('content-disposition', 'attachment; filename="pinewood-derby-ca.pem"')
      .send(tls.ca);
  });

  /** The active event as one zip: state plus photos, replays, headshots and logos. A plain GET so a download link works. */
  fastify.get('/api/export', async (_req, reply) => {
    const state = engine.state;
    const buffer = exportEvent(state, stores);
    const file = `${slugify(state.name)}-${state.date || 'export'}.zip`;
    return reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="${file}"`).send(buffer);
  });

  /** Import an export zip. mode=copy (default) gives it a new id; mode=replace overwrites the event with the same id. */
  fastify.post<{ Querystring: { mode?: string } }>('/api/import', { preHandler: requirePin, bodyLimit: 1024 * 1024 * 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ ok: false, error: 'Send the zip as the request body.', code: 'bad-args' });
    try {
      const imported = importEvent(req.body, stores);
      const state = imported.state;
      const existing = store.load(state.id);
      const replace = req.query.mode === 'replace';
      if (existing && !replace) {
        state.id = randomUUID();
        if (existing.name === state.name) state.name = `${state.name} (imported)`;
      }
      if (existing && replace && state.id === engine.state.id && timer.status.heatId) timer.cancel();
      activate(new DerbyEngine(state), 'import');
      return { ok: true, result: { id: state.id, name: state.name, replaced: !!existing && replace, media: imported.written } };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.get('/api/info', async () => ({
    name: engine.state.name,
    derbyId: engine.state.id,
    urls: lanUrls(config.port),
    httpsUrls: tls && config.httpsPort ? lanUrls(config.httpsPort, 'https') : [],
    secureAvailable: tls !== null,
    pinRequired: pins().coordinator !== null,
    crewPinSet: pins().crew !== null,
    timer: timer.status,
    derbies: store.listDerbies(),
    formats: FORMAT_PRESETS.map((f) => ({ id: f.id, name: f.name, description: f.description })),
    clients: hub.size,
    wizardDone: store.getMeta(WIZARD_KEY) === '1',
    backup: backup.status,
  }));

  fastify.get('/api/state', async () => engine.state);

  fastify.get('/api/history', async () => store.history(engine.state.id));

  /**
   * Upload one file of the car's photo. `kind` is original, crop (the
   * standardised JPEG) or cutout (the transparent PNG).
   */
  fastify.post<{ Params: { carId: string }; Querystring: { kind?: string } }>('/api/photos/:carId', { preHandler: requireCrew }, async (req, reply) => {
    const kind = req.query.kind ?? 'crop';
    if (kind !== 'original' && kind !== 'crop' && kind !== 'cutout') return reply.code(400).send({ ok: false, error: 'Unknown kind.', code: 'bad-args' });
    const ext = photos.extensionFor(req.headers['content-type']);
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.code(415).send({ ok: false, error: 'Send a JPEG, PNG or WebP image.', code: 'bad-image' });
    }
    if (kind === 'cutout' && ext !== 'png' && ext !== 'webp') {
      return reply.code(415).send({ ok: false, error: 'A cutout must be a PNG or WebP with transparency.', code: 'bad-image' });
    }
    const body = req.body;
    try {
      return await withAction('uploadPhoto', () => {
        const car = engine.requireCar(req.params.carId);
        const key = photos.save(body, ext);
        const { replaced } = engine.setCarShot(car.id, kind, key);
        if (replaced) photos.remove(replaced);
        return { ok: true, result: { key, kind } };
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Upload the finish-line clip for a heat (WebM or MP4 from the replay camera). */
  fastify.post<{ Params: { heatId: string } }>('/api/replays/:heatId', { preHandler: requirePin }, async (req, reply) => {
    const ext = replays.extensionFor(req.headers['content-type']);
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.code(415).send({ ok: false, error: 'Send a WebM or MP4 clip.', code: 'bad-video' });
    }
    const body = req.body;
    try {
      const { heat } = engine.getHeat(req.params.heatId);
      const clip = await normaliseClip('Replay', body, ext, {});
      return await withAction('uploadReplay', () => {
        const previous = heat.replay;
        const key = replays.save(clip.data, clip.ext);
        engine.setHeatReplay(heat.id, key);
        if (previous) replays.remove(previous);
        return { ok: true, result: { key } };
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Upload a scout's video headshot (a few seconds, with sound). */
  fastify.post<{ Params: { racerId: string } }>('/api/headshots/:racerId', { preHandler: requireCrew }, async (req, reply) => {
    const ext = headshots.extensionFor(req.headers['content-type']);
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.code(415).send({ ok: false, error: 'Send a WebM or MP4 clip.', code: 'bad-video' });
    }
    const body = req.body;
    try {
      const racer = engine.requireRacer(req.params.racerId);
      const clip = await normaliseClip('Headshot', body, ext, { audio: true, maxSeconds: 8 });
      return await withAction('uploadHeadshot', () => {
        const previous = racer.headshot;
        const key = headshots.save(clip.data, clip.ext);
        engine.setRacerHeadshot(racer.id, key);
        if (previous) headshots.remove(previous);
        return { ok: true, result: { key } };
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Upload the pack logo (JPEG, PNG or WebP), replacing the old one. */
  fastify.post('/api/branding/logo', { preHandler: requirePin }, async (req, reply) => {
    const ext = branding.extensionFor(req.headers['content-type']);
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.code(415).send({ ok: false, error: 'Send a JPEG, PNG or WebP image.', code: 'bad-image' });
    }
    const body = req.body;
    try {
      return await withAction('uploadLogo', () => {
        const key = branding.save(body, ext);
        const previous = engine.setLogo(key);
        if (previous) branding.remove(previous);
        return { ok: true, result: { key } };
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Upload a sponsor's logo, replacing the old one. */
  fastify.post<{ Params: { sponsorId: string } }>('/api/branding/sponsors/:sponsorId', { preHandler: requirePin }, async (req, reply) => {
    const ext = branding.extensionFor(req.headers['content-type']);
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.code(415).send({ ok: false, error: 'Send a JPEG, PNG or WebP image.', code: 'bad-image' });
    }
    const body = req.body;
    try {
      return await withAction('uploadSponsorImage', () => {
        const sponsor = engine.requireSponsor(req.params.sponsorId);
        const key = branding.save(body, ext);
        const { replaced } = engine.updateSponsor(sponsor.id, { image: key });
        if (replaced) branding.remove(replaced);
        return { ok: true, result: { key } };
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  serveMedia('/api/photos/:key', photos, 'No such photo.');
  serveMedia('/api/branding/:key', branding, 'No such image.');
  serveMedia('/api/headshots/:key', headshots, 'No such video.');
  serveMedia('/api/replays/:key', replays, 'No such replay.');

  /** A vote from the audience's phone. No PIN; the ballot's own password, if any, instead. */
  fastify.post<{ Body: { voterId?: unknown; awardId?: unknown; carIds?: unknown; password?: unknown } }>('/api/vote', async (req, reply) => {
    const body = req.body ?? {};
    const expected = store.getMeta(BALLOT_PASSWORD_KEY) || null;
    if (expected && body.password !== expected) return reply.code(401).send({ ok: false, error: 'That is not the voting password.', code: 'unauthorized' });
    if (typeof body.voterId !== 'string' || typeof body.awardId !== 'string' || !Array.isArray(body.carIds) || !body.carIds.every((c) => typeof c === 'string')) {
      return reply.code(400).send({ ok: false, error: 'voterId, awardId and carIds are required.', code: 'bad-args' });
    }
    try {
      currentAction = 'vote';
      engine.castVote(body.voterId, body.awardId, body.carIds as string[]);
      return { ok: true, result: null };
    } catch (err) {
      return sendError(reply, err);
    } finally {
      flushBatch();
      currentAction = null;
    }
  });

  fastify.post<{ Body: { name?: string; args?: unknown } }>('/api/command', { preHandler: requireCommandRole }, async (req, reply) => {
    const name = req.body?.name;
    if (typeof name !== 'string') return reply.code(400).send({ ok: false, error: 'Command name missing.', code: 'bad-args' });
    currentAction = name;
    try {
      const result = await runCommand(ctx, name, req.body?.args);
      return { ok: true, result: result ?? null };
    } catch (err) {
      return sendError(reply, err);
    } finally {
      flushBatch();
      currentAction = null;
    }
  });

  if (config.webDist) {
    await fastify.register(fastifyStatic, {
      root: config.webDist,
      // Serve whatever is on disk at request time, so a rebuild with new hashed
      // asset names is picked up without restarting the server.
      wildcard: true,
      // Hashed assets are immutable; index.html must always be revalidated so a rebuild is picked up.
      setHeaders: (res, filePath) => {
        res.setHeader('cache-control', filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
      },
    });
    fastify.setNotFoundHandler((req, reply) => {
      const looksLikeFile = /\.[a-z0-9]{2,5}(\?.*)?$/i.test(req.url);
      if (req.method === 'GET' && !req.url.startsWith('/api') && !looksLikeFile) {
        return reply.header('cache-control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ ok: false, error: 'Not found.' });
    });
  }

  return {
    fastify,
    store,
    timer,
    backup,
    engine: () => engine,
    listenHttps: () =>
      new Promise<number | null>((resolve, reject) => {
        if (!httpsServer || !config.httpsPort) return resolve(null);
        httpsServer.once('error', reject);
        httpsServer.listen(config.httpsPort, config.host, () => resolve(config.httpsPort));
      }),
    close: async () => {
      backup.stop();
      clearInterval(buildWatch);
      if (tlsRefresh) clearInterval(tlsRefresh);
      await timer.dispose();
      await new Promise<void>((resolve) => (httpsServer ? httpsServer.close(() => resolve()) : resolve()));
      await fastify.close();
      store.close();
    },
  };
}

function loadOrCreateActive(store: DerbyStore): DerbyEngine {
  const activeId = store.getMeta(ACTIVE_KEY);
  const state = activeId ? store.load(activeId) : null;
  if (state) return new DerbyEngine(state);
  const latest = store.listDerbies()[0];
  if (latest) {
    const s = store.load(latest.id);
    if (s) return new DerbyEngine(s);
  }
  const engine = DerbyEngine.create({ name: 'New Pinewood Derby' });
  store.save(engine.state, 'create');
  store.setMeta(ACTIVE_KEY, engine.state.id);
  return engine;
}

/** Engine errors carry a code; bad input is 400, missing things 404, and anything the current state forbids 409. */
function sendError(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) {
  if (err instanceof DerbyError) {
    const status = err.code === 'bad-args' ? 400 : err.code === 'not-found' ? 404 : 409;
    return reply.code(status).send({ ok: false, error: err.message, code: err.code });
  }
  const message = err instanceof Error ? err.message : String(err);
  return reply.code(500).send({ ok: false, error: message, code: 'internal' });
}

/** The saved timer setup, or null when there is none or it is unreadable. */
function readTimerConfig(raw: string | null): TimerConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TimerConfig>;
    const kind = parsed.kind === 'derby-magic' ? 'DerbyMagic' : parsed.kind;
    if (typeof kind !== 'string' || (kind !== 'simulator' && kind !== 'auto' && !findProfile(kind))) return null;
    return { kind, port: typeof parsed.port === 'string' ? parsed.port : null, baud: typeof parsed.baud === 'number' ? parsed.baud : null };
  } catch {
    return null;
  }
}
