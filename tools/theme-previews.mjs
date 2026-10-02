/**
 * Renders every audience look on the same seven screens at 1080p into
 * docs/themes/<look>-<screen>.png, then stitches each look into
 * docs/themes/<look>-sheet.png (the sheets are the files kept in git).
 *
 * Usage: server running (npm start), then `npm run theme-previews`.
 * Uses the active event: it arms and cancels one heat and restores the
 * presentation afterwards. The list of looks must match
 * packages/web/src/audience/themes.ts.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { api, BASE, findBrowser, sleep, state } from './lib.mjs';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'themes');
const THEMES = ['cartoon', 'broadcast', 'dragstrip', 'minimal'];
const SCREENS = ['intro', 'staging', 'spotlight', 'countdown', 'result', 'standings', 'awards'];

/** Four across, two rows, each shot scaled to 640 wide; the empty slot is dark grey. */
function sheet(theme) {
  const inputs = SCREENS.flatMap((s) => ['-i', path.join(OUT, `${theme}-${s}.png`)]);
  const scaled = SCREENS.map((_, i) => `[${i}]scale=640:-1[s${i}]`).join(';');
  const filter = `${scaled};color=c=#222222:s=640x360:d=1[blank];[s0][s1][s2][s3]hstack=4[r1];[s4][s5][s6][blank]hstack=4[r2];[r1][r2]vstack=2`;
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-frames:v', '1', path.join(OUT, `${theme}-sheet.png`)], (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const s0 = await state();
  const original = { ...s0.presentation };
  const open = (h) => h.status === 'pending' || h.status === 'staged';
  const done = (r) => r.heats.filter((h) => h.status === 'finished').length;
  // Prefer a round that already has results and still has a heat to stage, so standings are not blank.
  const round = [...s0.rounds].sort((a, b) => done(b) - done(a)).find((r) => r.heats.some(open)) ?? s0.rounds[0];
  const heat = round?.heats.find(open);
  const finished = s0.rounds.flatMap((r) => r.heats).filter((h) => h.status === 'finished').sort((a, b) => (a.result.recordedAt < b.result.recordedAt ? 1 : -1))[0];

  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1920,1080'], defaultViewport: null });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(`${BASE}/audience`, { waitUntil: 'networkidle0' });
    await sleep(800);
    await page.evaluate(() => document.querySelector('.aud-start')?.click());

    const shoot = async (theme, name) => {
      await sleep(900);
      await page.screenshot({ path: path.join(OUT, `${theme}-${name}.png`) });
      console.log(`${theme}: ${name}`);
    };

    for (const theme of THEMES) {
      await api('setPresentation', { patch: { theme, mode: 'auto', stage: 'racing', stageRoundId: round?.id ?? null, introRoundId: null, replayHeatId: null } });
      // The result screen needs a finished heat; without one it is skipped and the sheet slot stays blank.
      if (!finished) console.log(`${theme}: no finished heat, result screen skipped`);
      if (heat) {
        await api('cancelArm').catch(() => undefined);
        await sleep(400);
        await shoot(theme, 'staging');
        await api('armHeat', { heatId: heat.id });
        await shoot(theme, 'spotlight');
        await api('startCountdown');
        await sleep(2600);
        await shoot(theme, 'countdown');
        await api('cancelArm');
      }
      if (finished) {
        await api('showReplay', { heatId: finished.id });
        await shoot(theme, finished.replay ? 'replay' : 'result');
        await api('showReplay', { heatId: null });
      }
      await api('setPresentation', { patch: { mode: 'standings', standingsRoundId: round?.id ?? null } });
      await shoot(theme, 'standings');
      await api('setPresentation', { patch: { mode: 'auto', introRoundId: round?.id ?? null } });
      await shoot(theme, 'intro');
      await api('setPresentation', { patch: { introRoundId: null, mode: 'awards' } });
      await shoot(theme, 'awards');
    }
    for (const theme of THEMES) await sheet(theme);
  } finally {
    await browser.close();
    await api('cancelArm').catch(() => undefined);
    await api('setPresentation', { patch: original }).catch(() => undefined);
  }
  console.log(`Pictures in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
