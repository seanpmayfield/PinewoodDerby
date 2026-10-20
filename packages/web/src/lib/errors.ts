/**
 * A short log of recent trouble on this page (script errors, failed
 * promises, console errors, warning and error notices) so a feedback report
 * can say what went wrong just before it was written. The diagnostics panel
 * subscribes for the long version.
 */

const MAX = 8;
const events: string[] = [];
const listeners = new Set<(kind: string, text: string) => void>();

export function recordEvent(kind: string, text: string): void {
  const time = new Date().toTimeString().slice(0, 8);
  events.push(`[${kind}] ${time} ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (events.length > MAX) events.shift();
  for (const l of listeners) l(kind, text);
}

export function recentEvents(): string[] {
  return [...events];
}

/** Hear every event as it is recorded. */
export function onEvent(listener: (kind: string, text: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Start collecting. Call once when the page loads. */
export function watchErrors(): void {
  window.addEventListener('error', (e) => recordEvent('error', `${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { message?: string } | undefined;
    recordEvent('error', String(reason?.message ?? e.reason));
  });
  const original = console.error;
  console.error = (...args: unknown[]) => {
    recordEvent('console', args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    original.apply(console, args);
  };
}
