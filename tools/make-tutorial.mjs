/**
 * Builds the tutorial video: docs/tutorial/tutorial.mp4 (+ .srt and script.md).
 *
 * How it works, all offline:
 *   1. Creates a temporary demo event on the running server (localhost:8080)
 *      and drives it through a whole race so every screen has real content.
 *   2. Opens each screen in a headless Edge/Chrome at 1920x1080 (phones at a
 *      phone-sized viewport) and captures stills; animated moments (title
 *      card, spotlight, light tree, live race) are recorded as short clips.
 *   3. Narrates each chapter with the Windows text-to-speech voice.
 *   4. Assembles everything with the bundled ffmpeg, burning in captions.
 *   5. Restores the event that was active before.
 *
 * Usage: start the server (npm start or Start Derby.cmd), then `npm run tutorial`.
 */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { api, BASE, findBrowser, info, sleep, state } from './lib.mjs';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'tutorial');
const BUILD = path.join(OUT, 'build');
const VOICE = process.env.DERBY_VOICE ?? 'Microsoft Zira Desktop';
const W = 1920;
const H = 1080;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timerStatus = async () => (await info()).timer;

/** Wait for the armed heat to finish; a simulated DNF is confirmed so the demo never stalls. */
async function waitHeat(maxMs = 7000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const t = await timerStatus();
    if (t.state === 'idle') return;
    await sleep(250);
  }
  await api('confirmDnf').catch(() => undefined);
  await sleep(300);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(String(stdout))));
  });
}

async function ffprobeDuration(file) {
  const out = await run(ffmpeg, ['-hide_banner', '-i', file]).catch((e) => e.message);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/** Windows text-to-speech to a WAV file. */
async function speak(text, file) {
  const txt = file.replace(/\.wav$/, '.txt');
  writeFileSync(txt, text, 'utf8');
  const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice('${VOICE}') } catch {}
$s.Rate = 0
$s.SetOutputToWaveFile('${file.replace(/'/g, "''")}')
$s.Speak([IO.File]::ReadAllText('${txt.replace(/'/g, "''")}'))
$s.Dispose()`;
  const psFile = file.replace(/\.wav$/, '.ps1');
  writeFileSync(psFile, ps, 'utf8');
  await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile]);
  return ffprobeDuration(file);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

let browser;
let shot = 0;
const shotFile = (name) => path.join(BUILD, `${String(++shot).padStart(3, '0')}-${name}.png`);

async function newPage(kind = 'desktop') {
  const page = await browser.newPage();
  if (kind === 'phone') await page.setViewport({ width: 430, height: 880, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  return page;
}

async function open(page, route, { settle = 1200 } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(settle);
  // Dismiss the audience "start the show" overlay.
  await page.evaluate(() => document.querySelector('.aud-start')?.click());
  await sleep(200);
}

async function still(page, name) {
  const file = shotFile(name);
  await page.screenshot({ path: file, type: 'png' });
  return { type: 'still', file };
}

/** Record the page for `seconds` via the CDP screencast (captures animations). */
async function clip(page, name, seconds) {
  const dir = path.join(BUILD, `clip-${String(++shot).padStart(3, '0')}-${name}`);
  mkdirSync(dir, { recursive: true });
  const client = await page.createCDPSession();
  const frames = [];
  client.on('Page.screencastFrame', async (ev) => {
    const f = path.join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(f, Buffer.from(ev.data, 'base64'));
    frames.push({ file: f, t: ev.metadata.timestamp });
    await client.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(seconds * 1000);
  await client.send('Page.stopScreencast');
  await client.detach();
  if (frames.length < 2) return still(page, name);
  // Concat demuxer with per-frame durations, so a static page yields a valid clip too.
  const list = frames
    .map((fr, i) => {
      const next = frames[i + 1]?.t ?? fr.t + (frames[i].t - (frames[i - 1]?.t ?? fr.t - 0.1));
      const d = Math.max(0.02, Math.min(1, next - fr.t));
      return `file '${fr.file.replace(/\\/g, '/')}'\nduration ${d.toFixed(3)}`;
    })
    .join('\n') + `\nfile '${frames[frames.length - 1].file.replace(/\\/g, '/')}'\n`;
  const listFile = path.join(dir, 'frames.txt');
  writeFileSync(listFile, list);
  const out = path.join(dir, 'clip.mp4');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out]);
  return { type: 'clip', file: out, seconds: await ffprobeDuration(out) };
}

/** A title card rendered from HTML, in the Broadcast look. */
async function card(title, subtitle, kicker = 'Pinewood Derby Race Manager') {
  const page = await newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;background:radial-gradient(1400px 700px at 50% 120%,rgba(255,59,31,.18),transparent 60%),radial-gradient(900px 500px at 0% 0%,rgba(0,212,255,.12),transparent 60%),#08080a;color:#fff;font-family:Bahnschrift,'Segoe UI',sans-serif;display:grid;place-content:center;text-align:center;">
  <div style="position:absolute;inset:-30%;background:repeating-conic-gradient(from 0deg,rgba(255,255,255,.05) 0 6deg,transparent 6deg 14deg);-webkit-mask-image:radial-gradient(circle at center,black 10%,transparent 60%)"></div>
  <div style="position:relative">
    <div style="display:inline-block;background:#00d4ff;color:#000;font-weight:800;letter-spacing:.3em;text-transform:uppercase;padding:10px 34px;font-size:34px">${kicker}</div>
    <div style="font-size:150px;font-weight:800;text-transform:uppercase;line-height:1;margin:26px 0 18px;text-shadow:0 0 40px rgba(255,59,31,.5),0 10px 0 rgba(0,0,0,.45)">${title}</div>
    <div style="font-size:44px;color:#a9adb8;letter-spacing:.1em;text-transform:uppercase">${subtitle}</div>
  </div></body></html>`);
  await sleep(300);
  const s = await still(page, 'card');
  await page.close();
  return s;
}

// ---------------------------------------------------------------------------
// The tutorial: chapters of narration and what to show
// ---------------------------------------------------------------------------

/**
 * Each chapter: narration text, and a function that returns visual segments
 * (stills or clips). Segment weights spread the narration time across them.
 */
const chapters = [];
const chapter = (title, narration, visuals) => chapters.push({ title, narration, visuals });

async function buildChapters(ids) {
  // ---- 1. Welcome ---------------------------------------------------------
  chapter(
    'Welcome',
    `Welcome to the Pinewood Derby race manager. One laptop runs everything: it keeps the roster and results, talks to the track timer, and serves a web page for every job. The race coordinator runs the show from the laptop. The projector shows the audience screen. The pit crew checks cars in from their phones. Judges pick design awards on a tablet. And a camera at the finish line records instant replays. All of it works over a local Wi-Fi network with no internet at all. This video walks through setup, race day, and every feature.`,
    async () => {
      const home = await newPage();
      await open(home, '/');
      const segs = [await card('Race Manager', 'A tour of every screen'), { ...(await still(home, 'home')), weight: 2 }];
      await home.close();
      return segs;
    },
  );

  // ---- 2. Race day scripts and the wizard ----------------------------------
  chapter(
    'Getting started',
    `Install once with the installer; it checks the computer, fetches what it needs, opens the firewall for the phones, and puts a Start Pinewood Derby shortcut on the desktop. From then on race day starts with that one double-click: the server starts and the home page opens. The first time you open the coordinator, it points you to the setup wizard. The wizard walks through nine steps and checks each one live: the event, the network, the projector, the phones, the replay camera, the timer, the roster, a dry run, and a summary. Green means verified right now. Amber means connected but something needs attention. Grey means not seen yet.`,
    async () => {
      const p = await newPage();
      await open(p, '/coordinator/wizard');
      const segs = [await card('Getting started', 'The setup wizard', 'Chapter 2')];
      segs.push({ ...(await still(p, 'wizard-event')), weight: 2 });
      for (const [i, name] of [[1, 'network'], [2, 'projector'], [3, 'phones']]) {
        await p.evaluate((n) => [...document.querySelectorAll('.wizard-step')][n].click(), i);
        await sleep(400);
        segs.push({ ...(await still(p, `wizard-${name}`)), weight: 1.5 });
      }
      await p.close();
      return segs;
    },
  );

  // ---- 3. Network and phones ------------------------------------------------
  chapter(
    'Network and phones',
    `Everything needs one local network. A small router is the most reliable. The Windows mobile hotspot on the laptop also works, and the laptop then always has the same address. Phones scan a QR code to reach their page; the codes are on the home page and on the coordinator. Phone cameras only work on a secure address, so each phone does a one-time certificate install from the phone setup page. After that the pit crew and replay pages open the live camera directly. The wizard shows which phones are connected, whether they came in over the secure address, and whether their camera is available.`,
    async () => {
      const p = await newPage();
      await open(p, '/coordinator/setup');
      const segs = [await card('Network', 'Hotspot, QR codes, phone setup', 'Chapter 3'), { ...(await still(p, 'setup-network')), weight: 2 }];
      const ph = await newPage('phone');
      await open(ph, '/phone');
      segs.push({ ...(await still(ph, 'phone-setup')), weight: 2 });
      await ph.close();
      await p.close();
      return segs;
    },
  );

  // ---- 4. Roster and formats --------------------------------------------------
  chapter(
    'Roster and race format',
    `The roster tab holds the pack: dens, racers, cars. Import a C S V from your pack spreadsheet, and the columns are detected automatically, or type names in. Each racer gets a car number. An open class for siblings and adults gets its own round and never races against the scouts. On the setup tab, pick the race format. The default runs each den on its own, every car in every lane once, ranked by average time, then sends the top three from each den to a pack final. Other presets race the whole pack together, by time or by place points. The format locks once heats have run.`,
    async () => {
      const p = await newPage();
      await open(p, '/coordinator/roster');
      const segs = [await card('Roster', 'Dens, racers, cars, formats', 'Chapter 4'), { ...(await still(p, 'roster')), weight: 2 }];
      await open(p, '/coordinator/setup');
      await p.evaluate(() => document.querySelector('.format-option')?.scrollIntoView());
      segs.push({ ...(await still(p, 'formats')), weight: 1.5 });
      await p.close();
      return segs;
    },
  );

  // ---- 5. Pit crew --------------------------------------------------------------
  chapter(
    'Pit crew check-in',
    `On race morning the pit crew works from a phone. Find the car by number or name. One tap checks the scout in. Type the weight; anything over the limit is flagged. Tap through the inspection checklist and mark the car passed, needs work, or failed. Take the car photo: the live camera shows a side outline, the wheels set the scale so every car comes out the same size, and the background is cut away so the car sits on the big screen by itself. Record a few seconds of the scout saying hi; it plays in their spotlight and when they win an award. Walk-up racers can be added right there.`,
    async () => {
      const ph = await newPage('phone');
      await open(ph, '/pit');
      const segs = [await card('Pit crew', 'Check-in, weigh, inspect, photograph', 'Chapter 5'), { ...(await still(ph, 'pit-list')), weight: 1.5 }];
      await open(ph, `/pit/${ids.carId}`);
      segs.push({ ...(await still(ph, 'pit-detail')), weight: 2 });
      await ph.evaluate(() => document.querySelector('.shot-image')?.click());
      await sleep(1500);
      segs.push({ ...(await still(ph, 'pit-camera')), weight: 2 });
      await ph.close();
      return segs;
    },
  );

  // ---- 6. Running the race ------------------------------------------------------
  chapter(
    'Running the race',
    `The race tab is the coordinator's home. At the top, the "on the projector" strip says what the audience is seeing and has one button for the next step. Click Start race, and the projector shows the round's title card with every car parading across. When the cars are on the pins, click Arm timer. The audience sees Next up, with one racer in the spotlight; the spotlight rotates so every scout gets one during the day. Click Start countdown: a drag race light tree runs, three ambers then green, and the scout opens the gate on green. The timer reports the start, times pop in as cars cross, and the heat records itself. The result holds, then the instant replay plays in slow motion, then the next lineup appears with Now staging, telling the scouts who is up. Keep arming heats. When the round's last heat is done, the projector shows that round's standings, and the button reads Next round.`,
    async () => {
      const co = await newPage();
      const au = await newPage();
      // A headless replay camera (the browser's fake device) so the replay chapter has a clip.
      const rc = await newPage();
      await open(rc, '/replay', { settle: 2000 });
      await api('flowReset');
      await open(co, '/coordinator');
      const segs = [await card('Race day', 'One button, and Arm', 'Chapter 6'), { ...(await still(co, 'race-tab')), weight: 1.5 }];
      await api('flowNext'); // title card
      await open(au, '/audience', { settle: 800 });
      segs.push({ ...(await clip(au, 'title-card', 3.5)), weight: 2 });
      const s1 = await state();
      const round = s1.rounds.find((r) => r.id === s1.presentation.stageRoundId);
      const heat = round.heats.find((h) => h.status === 'pending');
      await api('armHeat', { heatId: heat.id });
      await sleep(900);
      segs.push({ ...(await clip(au, 'spotlight', 3.5)), weight: 2 });
      await api('startCountdown');
      segs.push({ ...(await clip(au, 'countdown', 6.5)), weight: 2.5 });
      await api('simulateGate');
      segs.push({ ...(await clip(au, 'racing', 4.5)), weight: 2 });
      await waitHeat();
      await sleep(500);
      segs.push({ ...(await still(au, 'result')), weight: 1.5 });
      await sleep(4200);
      segs.push({ ...(await clip(au, 'replay', 3)), weight: 1.5 });
      await sleep(11000);
      segs.push({ ...(await still(au, 'now-staging')), weight: 1.5 });
      await open(co, '/coordinator', { settle: 600 });
      segs.push({ ...(await still(co, 'race-tab-after')), weight: 1.5 });
      await api('flowStandings');
      await sleep(800);
      segs.push({ ...(await still(au, 'standings')), weight: 1.5 });
      await co.close();
      await au.close();
      await rc.close();
      return segs;
    },
  );

  // ---- 7. When things go wrong ----------------------------------------------------
  chapter(
    'When things go wrong',
    `Races have hiccups, and the coordinator has a button for each one. A car that does not finish: every lane still out shows a D N F button while racing, and after the heat timeout a prompt asks whether to record the D N F or keep waiting. A car jumped the track: Re-run this heat voids it and puts an identical heat next. A wrong time, or the wrong car on a lane: Fix times lets you edit each lane's time and pick the car that was really there; the remaining heats re-plan themselves so every car still gets its full set of runs. A lane sensor dies: mark it out on the setup tab, and the schedule adapts. Every change is snapshotted, so an earlier state can always be restored.`,
    async () => {
      const co = await newPage();
      await open(co, '/coordinator');
      const segs = [await card('When things go wrong', 'DNF, re-run, fix times', 'Chapter 7')];
      await co.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Fix')?.click());
      await sleep(500);
      segs.push({ ...(await still(co, 'fix-times')), weight: 3 });
      await co.evaluate(() => [...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.trim() === 'Cancel')?.click());
      await open(co, '/coordinator/setup');
      await co.evaluate(() => document.querySelector('.history')?.scrollIntoView());
      segs.push({ ...(await still(co, 'history')), weight: 1.5 });
      await co.close();
      return segs;
    },
  );

  // ---- 8. Instant replay --------------------------------------------------------------
  chapter(
    'Instant replay',
    `The replay camera can be a webcam on the race laptop, a laptop at the finish line, or a phone on a tripod. On the audience tab, tick "use this computer's webcam" and you are done. For a phone, scan the replay camera code. Recording starts just before the fastest car of the day could reach the line and stops right after the last car that finishes, so a car that never finishes never drags the clip out. The clip is converted on the server and plays on the projector at half speed with the finishing order underneath. The coordinator can put any heat's replay back on screen.`,
    async () => {
      const co = await newPage();
      await open(co, '/coordinator/audience');
      const segs = [await card('Instant replay', 'Webcam, laptop, or phone', 'Chapter 8'), { ...(await still(co, 'audience-tab')), weight: 2 }];
      const rc = await newPage();
      await open(rc, '/replay', { settle: 2500 });
      segs.push({ ...(await still(rc, 'replay-cam')), weight: 2 });
      await rc.close();
      await co.close();
      return segs;
    },
  );

  // ---- 9. Judges and awards -----------------------------------------------------------
  chapter(
    'Judges and awards',
    `Judges use their own page, usually on a tablet by the display table. Add awards from the preset list, like Best in Show or Most Colorful, or type a custom one, optionally for one den. Walk the display table ticking each car as seen, and score it against a rubric if you want one. Select an award, star the cars in the running, then tap the winner; the card notes anything else that car has already won so awards get spread around. Speed awards fill themselves from the results. After the last round the coordinator clicks Start awards ceremony. The projector shows the awards card, and each click reveals the next award, showing the nominees first when there is a shortlist: design awards first, then den champions, then third, second, and first place onto the podium, with the scout's video beside their car.`,
    async () => {
      const j = await newPage();
      await open(j, '/judges');
      const segs = [await card('Judges and awards', 'Design awards and the ceremony', 'Chapter 9'), { ...(await still(j, 'judges')), weight: 2 }];
      await j.close();
      const au = await newPage();
      await api('setPresentation', { patch: { mode: 'auto', stage: 'awards', revealedAwardIds: [] } });
      await api('generateSpeedAwards');
      await api('computeSpeedAwards');
      // Only one den has raced in this demo, so hand out the rest of the speed awards for the picture.
      {
        const s = await state();
        const used = new Set(s.awards.map((a) => a.carId).filter(Boolean));
        const pool = s.cars.filter((c) => !used.has(c.id));
        for (const a of s.awards) if (!a.carId && pool.length) await api('setAwardWinner', { awardId: a.id, carId: pool.shift().id });
      }
      await open(au, '/audience', { settle: 800 });
      segs.push({ ...(await clip(au, 'awards-card', 3)), weight: 1.5 });
      const total = (await state()).awards.length;
      for (let i = 0; i < total; i++) await api('revealNextAward');
      await sleep(1200);
      segs.push({ ...(await still(au, 'podium')), weight: 2.5 });
      await au.close();
      return segs;
    },
  );

  // ---- 10. Printing, resets, and the end -------------------------------------------------
  chapter(
    'Printing and wrapping up',
    `Heat sheets, standings, the roster, full results and award certificates all print from plain pages linked on the coordinator, or save as PDF. Everything is saved as it happens, and while a USB stick is plugged in a copy of the event goes there too. When rehearsal is over, Reset races on the setup tab clears every round and result but keeps the roster, so you can run the whole show again the next morning. Next year, Start a new race carries the roster forward. Every screen you saw is a web page served by the laptop, so any device on the network with a browser can join. That is the tour. Have a great derby.`,
    async () => {
      const p = await newPage();
      const s = await state();
      const round = s.rounds[0];
      await open(p, `/print/standings/${round.id}`);
      const segs = [await card('Printing', 'Heat sheets, standings, awards', 'Chapter 10'), { ...(await still(p, 'print')), weight: 2 }];
      await open(p, '/coordinator/setup');
      await p.evaluate(() => [...document.querySelectorAll('h3')].find((h) => h.textContent === 'Start over')?.scrollIntoView());
      segs.push({ ...(await still(p, 'reset')), weight: 1.5 });
      segs.push({ ...(await card('Have a great derby', 'pinewood derby race manager', 'The end')), weight: 2 });
      await p.close();
      return segs;
    },
  );
}

// ---------------------------------------------------------------------------
// Demo event: created fresh so every screen has content, restored afterwards
// ---------------------------------------------------------------------------

async function prepareDemo() {
  const before = await info();
  const originalId = before.derbyId;
  const originalTimer = { kind: before.timer.kind, port: before.timer.port ?? null, baud: before.timer.baud ?? null };
  await api('newDerby', { name: 'Pack 316 Pinewood Derby', formatId: 'den-then-final' });
  await api('seedDemo');
  await api('configureTimer', { kind: 'simulator' });
  // Run the first den so standings and results exist, leave the rest for the live chapter.
  const [roundId] = await api('startRound', { specKey: 'den' });
  let s = await state();
  let round = s.rounds.find((r) => r.id === roundId);
  for (const heat of round.heats) {
    await api('armHeat', { heatId: heat.id });
    await api('simulateGate');
    await waitHeat();
  }
  s = await state();
  const car = s.cars[0];
  // Judges' awards with winners, so the ceremony has content.
  const a = await api('addAward', { name: 'Best in Show', kind: 'design' });
  await api('setAwardWinner', { awardId: a.id, carId: s.cars[1].id });
  const b = await api('addAward', { name: 'Most Colorful', kind: 'design' });
  await api('setAwardWinner', { awardId: b.id, carId: s.cars[5].id });
  await api('flowReset');
  return { originalId, originalTimer, carId: car.id };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function srtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/** Split narration into caption-sized sentences, timed by character share of the chapter. */
function captions(text, start, duration) {
  const raw = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text];
  // Keep each caption to roughly two lines: split long sentences at a comma or semicolon.
  const sentences = raw.flatMap((s) => {
    if (s.length <= 95) return [s];
    const parts = s.split(/(?<=[,;:])\s+/);
    const out = [];
    let cur = '';
    for (const part of parts) {
      if (cur && (cur + ' ' + part).length > 95) {
        out.push(cur);
        cur = part;
      } else cur = cur ? `${cur} ${part}` : part;
    }
    if (cur) out.push(cur);
    return out;
  });
  const total = sentences.reduce((n, s) => n + s.length, 0);
  let t = start;
  return sentences.map((s) => {
    const d = (s.length / total) * duration;
    const c = { start: t, end: t + d, text: s };
    t += d;
    return c;
  });
}

async function assemble(built) {
  const parts = [];
  const srt = [];
  let clock = 0;
  for (const [i, ch] of built.entries()) {
    const target = ch.audioSec + 0.6;
    // Clips keep their own length; stills share the rest of the time by weight.
    const clipSec = ch.visuals.filter((v) => v.type === 'clip').reduce((n, v) => n + v.seconds, 0);
    const stillWeight = ch.visuals.filter((v) => v.type === 'still').reduce((n, v) => n + (v.weight ?? 1), 0);
    const stillTotal = Math.max(2 * ch.visuals.filter((v) => v.type === 'still').length, target - clipSec);
    const inputs = [];
    const filters = [];
    ch.visuals.forEach((v, k) => {
      if (v.type === 'still') {
        const d = (stillTotal * (v.weight ?? 1)) / stillWeight;
        inputs.push('-loop', '1', '-t', d.toFixed(2), '-i', v.file);
      } else {
        inputs.push('-i', v.file);
      }
      filters.push(`[${k}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#08080a,setsar=1,fps=30,format=yuv420p[v${k}]`);
    });
    const concat = ch.visuals.map((_, k) => `[v${k}]`).join('') + `concat=n=${ch.visuals.length}:v=1:a=0[vout]`;
    const out = path.join(BUILD, `chapter-${String(i + 1).padStart(2, '0')}.mp4`);
    await run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...inputs,
      '-i', ch.audio,
      '-filter_complex', [...filters, concat].join(';'),
      '-map', '[vout]', '-map', `${ch.visuals.length}:a`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '128k', '-shortest',
      out,
    ]);
    const dur = await ffprobeDuration(out);
    parts.push(out);
    for (const c of captions(ch.narration, clock, ch.audioSec)) srt.push(`${srt.length + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`);
    clock += dur;
  }
  const listFile = path.join(BUILD, 'parts.txt');
  writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  writeFileSync(path.join(OUT, 'tutorial.srt'), srt.join('\n'), 'utf8');
  const joined = path.join(BUILD, 'joined.mp4');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined]);
  // Burn captions in (run from the output folder so the subtitle path needs no escaping).
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', joined, '-vf', "subtitles=tutorial.srt:force_style='FontName=Segoe UI,FontSize=11,Bold=1,Outline=1.2,Shadow=0.6,MarginV=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'copy', path.join(OUT, 'tutorial.mp4')], { cwd: OUT });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  console.log('Preparing demo event…');
  const originalId = (await (await fetch(`${BASE}/api/info`)).json()).derbyId;
  let ids = { originalId, carId: null, demoId: null };
  try {
    ids = { ...(await prepareDemo()), demoId: (await (await fetch(`${BASE}/api/info`)).json()).derbyId };
    browser = await puppeteer.launch({
      executablePath: findBrowser(),
      headless: true,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--window-size=${W},${H}`],
      defaultViewport: null,
    });
    await buildChapters(ids);
    const built = [];
    for (const [i, ch] of chapters.entries()) {
      console.log(`Chapter ${i + 1}: ${ch.title}`);
      const visuals = await ch.visuals();
      const audio = path.join(BUILD, `narration-${String(i + 1).padStart(2, '0')}.wav`);
      const audioSec = await speak(ch.narration, audio);
      built.push({ ...ch, visuals, audio, audioSec });
    }
    console.log('Assembling…');
    await assemble(built);
    writeFileSync(path.join(OUT, 'script.md'), `# Tutorial video script\n\n${chapters.map((c, i) => `## ${i + 1}. ${c.title}\n\n${c.narration}\n`).join('\n')}`);
    const mp4 = path.join(OUT, 'tutorial.mp4');
    console.log(`Done in ${Math.round((Date.now() - t0) / 1000)} s: ${mp4} (${(await ffprobeDuration(mp4)).toFixed(0)} s)`);
  } finally {
    await browser?.close();
    await api('loadDerby', { id: ids.originalId }).catch(() => undefined);
    if (ids.demoId && ids.demoId !== ids.originalId) await api('deleteDerby', { id: ids.demoId }).catch(() => undefined);
    if (ids.originalTimer && ids.originalTimer.kind !== 'simulator') await api('configureTimer', ids.originalTimer).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
