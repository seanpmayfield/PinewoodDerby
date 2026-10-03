import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp, type App } from '../src/app.js';
import { DerbyStore } from '../src/store.js';
import AdmZip from 'adm-zip';
import { BrandingStore, HeadshotStore, PhotoStore, ReplayStore } from '../src/media.js';
import type { ServerConfig } from '../src/config.js';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  httpsPort: null,
  tlsDir: '',
  dataDir: ':memory:',
  pin: null,
  timer: 'simulator',
  serialPort: null,
  simulatorSpeed: 0,
  simulatorDnfChance: 0,
  webDist: null,
  usbBackup: false,
};

let app: App | null = null;
let photoDir: string | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  if (photoDir) rmSync(photoDir, { recursive: true, force: true });
  photoDir = null;
});

async function start(overrides: Partial<ServerConfig> = {}): Promise<App> {
  photoDir = mkdtempSync(path.join(tmpdir(), 'derby-photos-'));
  app = await buildApp(
    { ...config, ...overrides },
    {
      store: new DerbyStore(':memory:'),
      photos: new PhotoStore(path.join(photoDir, 'photos')),
      replays: new ReplayStore(path.join(photoDir, 'replays')),
      headshots: new HeadshotStore(path.join(photoDir, 'headshots')),
      branding: new BrandingStore(path.join(photoDir, 'branding')),
    },
  );
  return app;
}

async function command(app: App, name: string, args?: unknown, headers: Record<string, string> = {}) {
  const res = await app.fastify.inject({ method: 'POST', url: '/api/command', payload: { name, args }, headers });
  return { status: res.statusCode, body: res.json() as { ok: boolean; result?: unknown; error?: string; code?: string } };
}

describe('server', () => {
  it('creates an empty derby on first start and persists commands', async () => {
    const app = await start();
    const info = (await app.fastify.inject('/api/info')).json() as { name: string; formats: unknown[] };
    expect(info.name).toBe('New Pinewood Derby');
    expect(info.formats.length).toBeGreaterThan(3);

    const seeded = await command(app, 'seedDemo');
    expect(seeded.body.ok).toBe(true);
    expect(app.engine().state.racers.length).toBeGreaterThan(20);
    expect(app.store.load(app.engine().state.id)?.racers.length).toBe(app.engine().state.racers.length);
  });

  it('reports engine errors as 409 with a code', async () => {
    const app = await start();
    const res = await command(app, 'startRound', { specKey: 'final' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('source-not-run');
    const unknown = await command(app, 'nope');
    expect(unknown.body.code).toBe('unknown-command');
  });

  it('enforces the PIN when configured', async () => {
    const app = await start({ pin: '1234' });
    expect((await command(app, 'seedDemo')).status).toBe(401);
    expect((await command(app, 'seedDemo', {}, { 'x-derby-pin': '1234' })).status).toBe(200);
  });

  it('runs a heat end to end through the simulated timer', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const rounds = await command(app, 'startRound', { specKey: 'den' });
    const roundId = (rounds.body.result as string[])[0]!;
    const heat = app.engine().currentHeat(roundId)!;

    expect((await command(app, 'armHeat', { heatId: heat.id })).body.ok).toBe(true);
    expect(app.timer.status.state).toBe('armed');
    expect(app.timer.status.heatId).toBe(heat.id);
    expect(heat.status).toBe('staged');

    expect((await command(app, 'simulateGate')).body.ok).toBe(true);
    // Speed 0: the whole heat resolves synchronously.
    expect(heat.status).toBe('finished');
    expect(heat.result?.source).toBe('simulator');
    expect(app.timer.status.state).toBe('idle');
    expect(app.timer.status.lastHeatId).toBe(heat.id);

    expect(app.engine().standings(roundId).some((s) => s.runs === 1)).toBe(true);
  });

  it('never broadcasts an idle status that still names the running heat', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const roundId = ((await command(app, 'startRound', { specKey: 'den' })).body.result as string[])[0]!;
    const heat = app.engine().currentHeat(roundId)!;
    const seen: { state: string; heatId: string | null; lastHeatId: string | null }[] = [];
    // Watch every status the service publishes by replacing its callback.
    (app.timer as unknown as { options: { onStatus: (s: typeof app.timer.status) => void } }).options.onStatus = (s) =>
      seen.push({ state: s.state, heatId: s.heatId, lastHeatId: s.lastHeatId });
    await command(app, 'armHeat', { heatId: heat.id });
    await command(app, 'simulateGate');
    const idle = seen.filter((s) => s.state === 'idle');
    expect(idle.length).toBeGreaterThan(0);
    for (const s of idle) {
      // Once idle, the finished heat must already be lastHeatId and heatId cleared.
      expect(s.heatId).toBeNull();
      expect(s.lastHeatId).toBe(heat.id);
    }
  });

  it('assigns a spotlight on arm and runs the countdown until the gate opens', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const roundId = ((await command(app, 'startRound', { specKey: 'den' })).body.result as string[])[0]!;
    const heat = app.engine().currentHeat(roundId)!;
    expect((await command(app, 'startCountdown')).body.code).toBe('bad-state');
    await command(app, 'armHeat', { heatId: heat.id });
    expect(heat.spotlightCarId).toBeTruthy();
    expect(heat.lanes).toContain(heat.spotlightCarId);
    expect((await command(app, 'startCountdown')).body.ok).toBe(true);
    expect(app.timer.status.countdown).toMatchObject({ lights: 3, intervalMs: 1000 });
    await command(app, 'simulateGate');
    expect(app.timer.status.countdown).toBeNull();
    expect(heat.status).toBe('finished');
  });

  it('waits for the coordinator to call a DNF instead of deciding on its own', async () => {
    const app = await start({ simulatorDnfChance: 1 });
    await command(app, 'seedDemo');
    const roundId = ((await command(app, 'startRound', { specKey: 'den' })).body.result as string[])[0]!;
    const heat = app.engine().currentHeat(roundId)!;
    await command(app, 'armHeat', { heatId: heat.id });
    await command(app, 'simulateGate');
    // Gate opened, nobody finished: the heat must still be racing, not recorded.
    expect(app.timer.status.state).toBe('racing');
    expect(heat.status).toBe('running');
    const lanes = heat.lanes.map((c, i) => (c ? i + 1 : 0)).filter(Boolean);
    expect((await command(app, 'markLaneDnf', { lane: lanes[0] })).body.ok).toBe(true);
    expect(heat.status).toBe('running');
    expect(app.timer.status.liveLanes.map((l) => l.lane)).toEqual([lanes[0]]);
    expect((await command(app, 'confirmDnf')).body.ok).toBe(true);
    expect(heat.status).toBe('finished');
    expect(heat.result!.lanes.filter((l) => l.carId).every((l) => l.dnf)).toBe(true);
    expect(app.timer.status.state).toBe('idle');
  });

  it('lets a manual result replace an armed heat and a re-run void it', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const roundId = ((await command(app, 'startRound', { specKey: 'den' })).body.result as string[])[0]!;
    const heat = app.engine().currentHeat(roundId)!;
    await command(app, 'armHeat', { heatId: heat.id });
    const times = heat.lanes.map((c, i) => ({ lane: i + 1, timeSec: c ? 3 + i / 10 : null }));
    expect((await command(app, 'finishHeat', { heatId: heat.id, times })).body.ok).toBe(true);
    expect(app.timer.status.heatId).toBeNull();
    expect(heat.result?.source).toBe('manual');
    const rerun = await command(app, 'rerunHeat', { heatId: heat.id, reason: 'test' });
    expect(rerun.body.ok).toBe(true);
    expect(heat.status).toBe('voided');
  });

  it('streams state and timer updates over the websocket', async () => {
    const app = await start();
    await app.fastify.listen({ host: '127.0.0.1', port: 0 });
    const address = app.fastify.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: { type: string }[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
        if (messages.length >= 3) resolve();
      });
      ws.on('error', reject);
    });
    expect(messages.map((m) => m.type).sort()).toEqual(['build', 'state', 'timer']);

    const next = new Promise<{ type: string; state?: { name: string } }>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    await command(app, 'updateDerby', { patch: { name: 'Renamed' } });
    const update = await next;
    expect(update.type).toBe('state');
    expect(update.state?.name).toBe('Renamed');
    ws.close();
  });

  it('stores car photos and serves them back', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const car = app.engine().state.cars[0]!;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

    const bad = await app.fastify.inject({ method: 'POST', url: `/api/photos/${car.id}?kind=crop`, payload: 'nope', headers: { 'content-type': 'text/plain' } });
    expect(bad.statusCode).toBe(415);

    const up = await app.fastify.inject({ method: 'POST', url: `/api/photos/${car.id}?kind=crop`, payload: jpeg, headers: { 'content-type': 'image/jpeg' } });
    expect(up.statusCode).toBe(200);
    const key = (up.json() as { result: { key: string } }).result.key;
    expect(car.photo?.side?.crop).toBe(key);

    // A cutout must be a PNG; the kind must be one of the three.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const cut = await app.fastify.inject({ method: 'POST', url: `/api/photos/${car.id}?kind=cutout`, payload: png, headers: { 'content-type': 'image/png' } });
    expect(cut.statusCode).toBe(200);
    expect(car.photo?.side?.cutout).toBeTruthy();
    const badCut = await app.fastify.inject({ method: 'POST', url: `/api/photos/${car.id}?kind=cutout`, payload: jpeg, headers: { 'content-type': 'image/jpeg' } });
    expect(badCut.statusCode).toBe(415);
    expect((await app.fastify.inject({ method: 'POST', url: `/api/photos/${car.id}?kind=thumb`, payload: jpeg, headers: { 'content-type': 'image/jpeg' } })).statusCode).toBe(400);

    const down = await app.fastify.inject(`/api/photos/${key}`);
    expect(down.statusCode).toBe(200);
    expect(down.headers['content-type']).toBe('image/jpeg');
    expect(down.rawPayload.equals(jpeg)).toBe(true);

    // Replacing removes the old file.
    const again = await app.fastify.inject({ method: 'POST', url: `/api/photos/${car.id}?kind=crop`, payload: jpeg, headers: { 'content-type': 'image/jpeg' } });
    const key2 = (again.json() as { result: { key: string } }).result.key;
    expect(key2).not.toBe(key);
    expect((await app.fastify.inject(`/api/photos/${key}`)).statusCode).toBe(404);
    expect((await app.fastify.inject('/api/photos/../../etc/passwd')).statusCode).toBe(404);

    expect((await command(app, 'clearCarPhoto', { carId: car.id })).body.result).toBe(2);
    expect(car.photo).toBeUndefined();
    expect((await app.fastify.inject(`/api/photos/${key2}`)).statusCode).toBe(404);
  });

  it('reports connected screens and setup diagnostics', async () => {
    const app = await start();
    await app.fastify.listen({ host: '127.0.0.1', port: 0 });
    const address = app.fastify.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(JSON.stringify({ type: 'hello', page: 'audience', secure: true, camera: false }));
    await new Promise((r) => setTimeout(r, 100));
    const diag = (await app.fastify.inject('/api/diagnostics')).json() as { clients: { page: string; secure: boolean; tls: boolean; ip: string }[]; wizardDone: boolean; port: number };
    expect(diag.clients.some((c) => c.page === 'audience' && c.secure && !c.tls && c.ip === '127.0.0.1')).toBe(true);
    expect(diag.wizardDone).toBe(false);
    await command(app, 'setWizardDone', { done: true });
    expect(((await app.fastify.inject('/api/info')).json() as { wizardDone: boolean }).wizardDone).toBe(true);
    ws.close();
  });

  it('stores a video headshot against a racer', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const racer = app.engine().state.racers[0]!;
    const fake = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]);
    const up = await app.fastify.inject({ method: 'POST', url: `/api/headshots/${racer.id}`, payload: fake, headers: { 'content-type': 'video/webm' } });
    expect(up.statusCode).toBe(200);
    const key = (up.json() as { result: { key: string } }).result.key;
    expect(racer.headshot).toBe(key);
    expect((await app.fastify.inject(`/api/headshots/${key}`)).statusCode).toBe(200);
    await command(app, 'clearRacerHeadshot', { racerId: racer.id });
    expect(racer.headshot).toBeUndefined();
  });

  it('stores a replay clip against a heat and can show it again', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const roundId = ((await command(app, 'startRound', { specKey: 'den' })).body.result as string[])[0]!;
    const heat = app.engine().currentHeat(roundId)!;
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]);
    const up = await app.fastify.inject({ method: 'POST', url: `/api/replays/${heat.id}`, payload: webm, headers: { 'content-type': 'video/webm' } });
    expect(up.statusCode).toBe(200);
    const key = (up.json() as { result: { key: string } }).result.key;
    expect(heat.replay).toBe(key);
    const down = await app.fastify.inject(`/api/replays/${key}`);
    expect(down.headers['content-type']).toBe('video/webm');
    expect(down.rawPayload.equals(webm)).toBe(true);
    await command(app, 'showReplay', { heatId: heat.id });
    expect(app.engine().state.presentation.replayHeatId).toBe(heat.id);
    await command(app, 'showReplay', { heatId: null });
    expect(app.engine().state.presentation.replayHeatId).toBeNull();
    await command(app, 'clearHeatReplay', { heatId: heat.id });
    expect(heat.replay).toBeUndefined();
  });

  it('switches the timer kind at runtime and remembers it', async () => {
    const app = await start();
    expect(app.timer.status.kind).toBe('simulator');
    // The real timer is not attached here: connecting must fail cleanly, not hang or throw.
    const res = await command(app, 'configureTimer', { kind: 'DerbyMagic', port: 'COM99', baud: 19200 });
    expect(res.body.ok).toBe(true);
    expect(app.timer.status.kind).toBe('DerbyMagic');
    expect(app.timer.status.connected).toBe(false);
    expect(app.timer.status.lastError).toBeTruthy();
    expect(JSON.parse(app.store.getMeta('timerConfig')!)).toMatchObject({ kind: 'DerbyMagic', port: 'COM99', baud: 19200 });
    expect((await command(app, 'configureTimer', { kind: 'NoSuchTimer' })).status).toBe(400);
    const armed = await command(app, 'testTimer');
    expect(armed.body.code).toBe('timer-offline');
    const back = await command(app, 'configureTimer', { kind: 'simulator' });
    expect(back.body.ok).toBe(true);
    expect(app.timer.status.connected).toBe(true);
    expect((await command(app, 'testTimer')).body.ok).toBe(true);
    expect(app.timer.status.testing).toBe(true);
    await command(app, 'simulateGate');
    expect(app.timer.status.testing).toBe(false);
    expect(app.timer.status.lastLanes).toHaveLength(4);
  });

  it('undoes the last meaningful command, skipping housekeeping, and stops at the beginning', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const roundId = ((await command(app, 'startRound', { specKey: 'den' })).body.result as string[])[0]!;
    const heat = app.engine().currentHeat(roundId)!;
    const times = heat.lanes.map((c, i) => ({ lane: i + 1, timeSec: c ? 3 + i / 10 : null }));
    await command(app, 'armHeat', { heatId: heat.id });
    await command(app, 'finishHeat', { heatId: heat.id, times });
    // A presentation tweak after the result must not be what Undo reverts, and must survive it.
    await command(app, 'setPresentation', { patch: { theme: 'minimal' } });
    expect(app.engine().getHeat(heat.id).heat.status).toBe('finished');

    const undone = await command(app, 'undo');
    expect(undone.body.ok).toBe(true);
    expect((undone.body.result as { label: string }).label).toBe('finishHeat');
    expect(app.engine().getHeat(heat.id).heat.status).not.toBe('finished');
    expect(app.engine().state.presentation.theme).toBe('minimal');

    // Second undo steps back over the round schedule.
    const again = await command(app, 'undo');
    expect((again.body.result as { label: string }).label).toBe('startRound');
    expect(app.engine().state.rounds.length).toBe(0);

    // Then the demo seed, then nothing.
    expect((await command(app, 'undo')).body.ok).toBe(true);
    expect(app.engine().state.racers.length).toBe(0);
    expect((await command(app, 'undo')).body.code).toBe('bad-state');

    // Redo walks forward again, and a fresh command clears the redo stack.
    expect((await command(app, 'redo')).body.ok).toBe(true);
    expect(app.engine().state.racers.length).toBeGreaterThan(20);
    expect((await command(app, 'redo')).body.ok).toBe(true);
    expect(app.engine().state.rounds.length).toBeGreaterThan(0);
    await command(app, 'undo');
    await command(app, 'updateDerby', { patch: { name: 'Fresh' } });
    expect((await command(app, 'redo')).body.code).toBe('bad-state');

    // A new command after an undo starts a fresh timeline.
    await command(app, 'updateDerby', { patch: { name: 'Tail' } });
    expect(app.engine().state.name).toBe('Tail');
    expect((await command(app, 'undo')).body.ok).toBe(true);
    expect(app.engine().state.name).toBe('Fresh');
  });

  it('refuses patch fields a client may not change', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const before = app.engine().state;
    const car = before.cars[0]!;
    expect((await command(app, 'updateDerby', { patch: { id: 'hijack' } })).status).toBe(400);
    expect((await command(app, 'updateDerby', { patch: { name: 'Fine' } })).status).toBe(200);
    expect((await command(app, 'updateCar', { id: car.id, patch: { number: '7' } })).status).toBe(400);
    expect((await command(app, 'updateCar', { id: car.id, patch: { photo: { side: { crop: '../x' } } } })).status).toBe(400);
    expect((await command(app, 'updateRacer', { id: car.racerId, patch: { headshot: 'nope.mp4' } })).status).toBe(400);
    expect((await command(app, 'setPresentation', { patch: { mode: 'bogus' } })).status).toBe(400);
    expect((await command(app, 'setPresentation', { patch: { revealedAwardIds: [1, 2] } })).status).toBe(400);
    expect((await command(app, 'setInspection', { carId: car.id, patch: { checks: { weight: 'yes' } } })).status).toBe(400);
    expect((await command(app, 'updateSettings', { patch: { rerunPlacement: 'later' } })).status).toBe(400);
    expect((await command(app, 'updateSettings', { patch: 'nope' })).status).toBe(400);
    const after = app.engine().state;
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('Fine');
    expect(after.cars[0]!.number).toBe(car.number);
  });

  it('stores the pack logo and sponsor images and exports them', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const up = await app.fastify.inject({ method: 'POST', url: '/api/branding/logo', payload: png, headers: { 'content-type': 'image/png' } });
    expect(up.statusCode).toBe(200);
    const key = (up.json() as { result: { key: string } }).result.key;
    expect(app.engine().state.branding.logo).toBe(key);
    expect((await app.fastify.inject(`/api/branding/${key}`)).statusCode).toBe(200);

    const sponsor = (await command(app, 'addSponsor', { name: 'Ace Hardware' })).body.result as { id: string };
    const sp = await app.fastify.inject({ method: 'POST', url: `/api/branding/sponsors/${sponsor.id}`, payload: png, headers: { 'content-type': 'image/png' } });
    expect(sp.statusCode).toBe(200);
    const image = (sp.json() as { result: { key: string } }).result.key;
    expect((await app.fastify.inject({ method: 'POST', url: '/api/branding/sponsors/nope', payload: png, headers: { 'content-type': 'image/png' } })).statusCode).toBe(404);

    const zip = new AdmZip((await app.fastify.inject('/api/export')).rawPayload);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain(`branding/${key}`);
    expect(names).toContain(`branding/${image}`);

    await command(app, 'removeSponsor', { id: sponsor.id });
    expect((await app.fastify.inject(`/api/branding/${image}`)).statusCode).toBe(404);
    await command(app, 'clearLogo');
    expect(app.engine().state.branding.logo).toBeNull();
    expect((await app.fastify.inject(`/api/branding/${key}`)).statusCode).toBe(404);
  });

  it('exports an event as a zip and imports it back, as a copy or a replacement', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    await command(app, 'updateDerby', { patch: { name: 'Pack 9 Derby' } });
    const car = app.engine().state.cars[0]!;
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const up = await app.fastify.inject({ method: 'POST', url: `/api/photos/${car.id}?kind=crop`, payload: png, headers: { 'content-type': 'image/png' } });
    expect(up.statusCode).toBe(200);
    const originalId = app.engine().state.id;

    const exported = await app.fastify.inject('/api/export');
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('application/zip');
    expect(exported.headers['content-disposition']).toContain('pack-9-derby');
    const zip = exported.rawPayload;
    expect(zip.length).toBeGreaterThan(1000);

    // A copy gets a fresh id and a distinct name; the media is shared by key.
    const copy = await app.fastify.inject({ method: 'POST', url: '/api/import?mode=copy', payload: zip, headers: { 'content-type': 'application/zip' } });
    expect(copy.json().ok).toBe(true);
    const copyId = copy.json().result.id as string;
    expect(copyId).not.toBe(originalId);
    expect(app.engine().state.name).toBe('Pack 9 Derby (imported)');
    expect(app.engine().state.cars.length).toBe(app.store.load(originalId)!.cars.length);

    // Change the original, then replace it from the export: the change is gone.
    await command(app, 'loadDerby', { id: originalId });
    await command(app, 'updateDerby', { patch: { name: 'Changed' } });
    const replace = await app.fastify.inject({ method: 'POST', url: '/api/import?mode=replace', payload: zip, headers: { 'content-type': 'application/zip' } });
    expect(replace.json().result.replaced).toBe(true);
    expect(app.engine().state.id).toBe(originalId);
    expect(app.engine().state.name).toBe('Pack 9 Derby');

    // Junk is refused politely.
    const junk = await app.fastify.inject({ method: 'POST', url: '/api/import', payload: Buffer.from('not a zip'), headers: { 'content-type': 'application/zip' } });
    expect(junk.json().ok).toBe(false);
    expect(junk.json().code).toBe('bad-args');
  });

  it('copies last year\'s roster into a new race without results or photos', async () => {
    const app = await start();
    await command(app, 'seedDemo');
    const fromId = app.engine().state.id;
    const racers = app.engine().state.racers.length;
    await command(app, 'setCheckedIn', { racerId: app.engine().state.racers[0]!.id, checkedIn: true });
    const created = await command(app, 'newDerby', { name: 'Next Year', copyRosterFrom: fromId });
    expect(created.body.ok).toBe(true);
    const s = app.engine().state;
    expect(s.name).toBe('Next Year');
    expect(s.racers.length).toBe(racers);
    expect(s.racers.every((r) => !r.checkedIn && !r.headshot)).toBe(true);
    expect(s.cars.every((c) => !c.photo && c.inspection.status === 'pending' && c.weightOz === undefined)).toBe(true);
    expect(s.rounds).toEqual([]);
  });

  it('switches between derbies and restores a snapshot', async () => {
    const app = await start();
    const firstId = app.engine().state.id;
    await command(app, 'updateDerby', { patch: { name: 'First' } });
    const created = await command(app, 'newDerby', { name: 'Second', formatId: 'pack-points' });
    expect(created.body.ok).toBe(true);
    expect(app.engine().state.name).toBe('Second');
    expect(app.engine().state.format.id).toBe('pack-points');
    const secondId = app.engine().state.id;
    expect((await command(app, 'deleteDerby', { id: secondId })).body.code).toBe('bad-state');
    await command(app, 'loadDerby', { id: firstId });
    expect(app.engine().state.name).toBe('First');
    expect((await command(app, 'deleteDerby', { id: secondId })).body.ok).toBe(true);
    expect(app.store.load(secondId)).toBeNull();
    const history = (await app.fastify.inject('/api/history')).json() as { id: number; change: string }[];
    const before = history.find((h) => h.change === 'create')!;
    await command(app, 'restoreHistory', { historyId: before.id });
    expect(app.engine().state.name).toBe('New Pinewood Derby');
  });
});
