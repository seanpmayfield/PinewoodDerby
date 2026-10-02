/**
 * A short log of recent trouble on this page (script errors, failed
 * promises, console errors, warning and error notices) so a feedback report
 * can say what went wrong just before it was written.
 */

const MAX = 8;
const events: string[] = [];

export function recordEvent(kind: string, text: string): void {
  const time = new Date().toTimeString().slice(0, 8);
  events.push(`[${kind}] ${time} ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  if (events.length > MAX) events.shift();
}

export function recentEvents(): string[] {
  return [...events];
}

/** Start collecting. Call once when the page loads. */
export function watchErrors(): void {
  window.addEventListener('error', (e) => recordEvent('error', e.message));
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
