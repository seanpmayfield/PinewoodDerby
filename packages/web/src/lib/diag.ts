/**
 * The diagnostics log behind the secret menu: what this device is, what its
 * browser can do, every error and warning, the notes the tester types, and
 * snapshots of the layout taken when something looks wrong. It persists in
 * this browser so a report can be built up across screens and reloads, then
 * copied out or sent to the race laptop.
 */

import { onEvent } from './errors.ts';

const KEY = 'derby.diag';
const MAX_ENTRIES = 600;

export interface DiagEntry {
  at: string;
  kind: 'note' | 'error' | 'warn' | 'console' | 'nav' | 'net' | 'snapshot' | 'env' | 'fps' | 'ws';
  text: string;
}

let entries: DiagEntry[] = load();
const listeners = new Set<() => void>();

function load(): DiagEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as DiagEntry[];
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* full or private mode */
  }
  for (const l of listeners) l();
}

export function record(kind: DiagEntry['kind'], text: string): void {
  // Opening the panel on a page that was just loaded would log the same path twice.
  const last = entries[entries.length - 1];
  if (kind === 'nav' && last?.kind === 'nav' && (last.text === text || last.text === `loaded ${text}`)) return;
  entries.push({ at: new Date().toISOString(), kind, text: text.slice(0, 2000) });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  save();
}

export function clear(): void {
  entries = [];
  save();
}

export function all(): DiagEntry[] {
  return entries;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A stable id for this device so reports from several phones can be told apart. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('derby.device');
    if (!id) {
      id = Math.random().toString(36).slice(2, 8);
      localStorage.setItem('derby.device', id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

let watching = false;
/** Start capturing errors, warnings and resources that fail to load. Safe to call more than once. */
export function watch(): void {
  if (watching) return;
  watching = true;
  onEvent((kind, text) => record(kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'console', text));
  // Images, videos and scripts that fail to load fire error events that never reach window.onerror.
  window.addEventListener(
    'error',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target !== (window as unknown as HTMLElement) && 'tagName' in target) {
        const src = (target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src || (target as HTMLVideoElement).currentSrc;
        record('net', `${target.tagName.toLowerCase()} failed to load: ${src || '(no src)'}`);
      }
    },
    true,
  );
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    record('warn', args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    originalWarn.apply(console, args);
  };
  record('nav', `loaded ${location.pathname}${location.search}`);
}

/** Yes/no for the browser features the screens depend on. */
export function featureChecks(): { name: string; ok: boolean }[] {
  const css = (decl: string) => {
    try {
      return CSS.supports(decl);
    } catch {
      return false;
    }
  };
  const sel = (s: string) => {
    try {
      return CSS.supports(`selector(${s})`);
    } catch {
      return false;
    }
  };
  let webgl = false;
  try {
    webgl = !!document.createElement('canvas').getContext('webgl');
  } catch {
    /* no */
  }
  return [
    { name: 'CSS mask-image (unprefixed)', ok: css('mask-image: linear-gradient(black, transparent)') },
    { name: 'CSS -webkit-mask-image', ok: css('-webkit-mask-image: linear-gradient(black, transparent)') },
    { name: 'CSS backdrop-filter', ok: css('backdrop-filter: blur(1px)') || css('-webkit-backdrop-filter: blur(1px)') },
    { name: 'CSS color-mix()', ok: css('color: color-mix(in srgb, red, blue)') },
    { name: 'CSS :has()', ok: sel(':has(a)') },
    { name: 'CSS aspect-ratio', ok: css('aspect-ratio: 1') },
    { name: 'CSS clamp()', ok: css('width: clamp(1px, 2px, 3px)') },
    { name: 'CSS conic-gradient', ok: css('background: repeating-conic-gradient(red 0 25%, blue 0 50%)') },
    { name: 'CSS container queries', ok: css('container-type: inline-size') },
    { name: 'WebGL', ok: webgl },
    { name: 'Web Audio', ok: 'AudioContext' in window || 'webkitAudioContext' in window },
    { name: 'MediaRecorder', ok: 'MediaRecorder' in window },
    { name: 'MediaRecorder MP4', ok: 'MediaRecorder' in window && (window as unknown as { MediaRecorder: { isTypeSupported(t: string): boolean } }).MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') },
    { name: 'Camera API', ok: !!navigator.mediaDevices?.getUserMedia },
    { name: 'Secure context (camera allowed)', ok: window.isSecureContext },
    { name: 'BarcodeDetector', ok: 'BarcodeDetector' in window },
    { name: 'Fullscreen API', ok: !!document.documentElement.requestFullscreen },
    { name: 'localStorage', ok: (() => { try { localStorage.setItem('t', '1'); localStorage.removeItem('t'); return true; } catch { return false; } })() },
  ];
}

/** Which of the fonts the looks ask for are actually installed. */
export function fontChecks(): { name: string; ok: boolean }[] {
  const check = (family: string) => {
    try {
      return document.fonts.check(`16px "${family}"`);
    } catch {
      return false;
    }
  };
  return ['Bahnschrift', 'Franklin Gothic Medium', 'Arial Narrow', 'Segoe UI', 'Segoe UI Black', 'Arial Black', 'Segoe UI Emoji'].map((f) => ({ name: f, ok: check(f) }));
}

/** The graphics adapter, when the browser will say. */
export function gpuInfo(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) return `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} / ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`;
  } catch {
    /* not available */
  }
  return 'not reported';
}

export function environment(): string {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string } };
  return [
    `device ${deviceId()} · ${navigator.userAgent}`,
    `screen ${screen.width}x${screen.height} @${window.devicePixelRatio} · viewport ${window.innerWidth}x${window.innerHeight} · touch ${navigator.maxTouchPoints} · cores ${navigator.hardwareConcurrency ?? '?'} · memory ${n.deviceMemory ?? '?'} GB`,
    `gpu ${gpuInfo()}`,
    `page ${location.href} · secure=${window.isSecureContext} · online=${navigator.onLine} · lang ${navigator.language} · tz ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `features missing: ${featureChecks().filter((f) => !f.ok).map((f) => f.name).join(', ') || 'none'}`,
    `fonts missing: ${fontChecks().filter((f) => !f.ok).map((f) => f.name).join(', ') || 'none'}`,
  ].join('\n');
}

/** Measure rendering smoothness for a moment: average frames per second and how many frames took over 50 ms. */
export function measureFps(ms = 3000): Promise<{ fps: number; longFrames: number }> {
  return new Promise((resolve) => {
    let frames = 0;
    let long = 0;
    let last = performance.now();
    const start = last;
    const tick = (now: number) => {
      frames++;
      if (now - last > 50) long++;
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else resolve({ fps: Math.round((frames * 1000) / (now - start)), longFrames: long });
    };
    requestAnimationFrame(tick);
  });
}

/**
 * What is on screen right now: every visible element of the app's own
 * classes with its box and the styles that most often go wrong, so a
 * broken layout can be read from text.
 */
export function layoutSnapshot(limit = 60): string {
  const out: string[] = [];
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('#root [class]')).filter((el) => /^(aud|pit|jud|home|wizard|lane|sponsor|replaycam|round|result|heat|deck|phone|vote|topbar|panel|modal|print)/.test(String(el.className)));
  for (const el of nodes) {
    if (out.length >= limit) {
      out.push(`… ${nodes.length - limit} more`);
      break;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const bits = [`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 3).join('.')}`, `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`];
    const mask = cs.maskImage !== 'none' ? cs.maskImage : (cs as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage;
    if (mask && mask !== 'none') bits.push('mask');
    if (cs.filter !== 'none') bits.push(`filter:${cs.filter.slice(0, 30)}`);
    if (cs.animationName !== 'none') bits.push(`anim:${cs.animationName}`);
    if (cs.opacity !== '1') bits.push(`opacity:${cs.opacity}`);
    if (cs.overflow !== 'visible' && el.scrollHeight > el.clientHeight + 2) bits.push('overflowing');
    if (/font|title|name|kicker/.test(el.className)) bits.push(`font:${cs.fontFamily.split(',')[0]?.trim().replace(/"/g, '')} ${cs.fontSize}`);
    out.push(bits.join(' | '));
  }
  return out.join('\n');
}

export function reportText(extra: string[] = []): string {
  const lines = [`Pinewood Derby device report · ${new Date().toISOString()}`, environment(), ...extra, '', '--- log ---'];
  for (const e of entries) lines.push(`${e.at.slice(11, 19)} [${e.kind}] ${e.text}`);
  return lines.join('\n');
}

/** Hand the report to the race laptop, which keeps it under data/reports. */
export async function sendReport(text: string): Promise<string> {
  const res = await fetch(`/api/diag-report?device=${encodeURIComponent(deviceId())}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text });
  const body = (await res.json()) as { ok: boolean; result?: { file: string }; error?: string };
  if (!body.ok) throw new Error(body.error ?? 'Could not send the report.');
  return body.result!.file;
}
