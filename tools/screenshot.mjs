/**
 * Full-size screenshots of pages on the running server, for checking a
 * change without opening a browser by hand.
 *
 * Usage: node tools/screenshot.mjs [--out DIR] "name|/path" "name|/path|Key" "name|/path|click=.selector" ...
 *   The third field presses a key (puppeteer key name) or clicks a selector
 *   before the shot. Files go to --out (default: the system temp folder).
 */

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BASE, findBrowser, sleep } from './lib.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT = outIndex >= 0 ? args.splice(outIndex, 2)[1] : path.join(os.tmpdir(), 'derby-screenshots');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--window-size=1600,1000', '--mute-audio'], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
for (const spec of args) {
  const [name, url, ...rest] = spec.split('|');
  const action = rest.join('|');
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle0' });
  await sleep(700);
  if (action.startsWith('click=')) {
    await page.click(action.slice(6));
    await sleep(500);
  } else if (action) {
    await page.keyboard.press(action);
    await sleep(400);
  }
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
