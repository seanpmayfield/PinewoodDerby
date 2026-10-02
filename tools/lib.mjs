/** Shared helpers for the tools: talk to a running server, find a browser. */

import { existsSync } from 'node:fs';

export const BASE = process.env.DERBY_URL ?? 'http://localhost:8080';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a coordinator command on the server; throws with the server's message on failure. */
export async function api(name, args) {
  const res = await fetch(`${BASE}/api/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, args }) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${name}: ${body.error}`);
  return body.result;
}

export const state = async () => (await fetch(`${BASE}/api/state`)).json();
export const info = async () => (await fetch(`${BASE}/api/info`)).json();

/** Edge or Chrome on this machine, or whatever DERBY_BROWSER points at. */
export function findBrowser() {
  const candidates = [
    process.env.DERBY_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Edge or Chrome found. Set DERBY_BROWSER to the browser executable.');
  return found;
}
