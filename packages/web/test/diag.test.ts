import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The log runs where there is no browser (a stripped phone browser, or here in Node):
// give it the few globals it reads and make sure it never throws.
const storage = new Map<string, string>();
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };
  g.window = g;
  g.document = { createElement: () => ({ getContext: () => null }), documentElement: {}, fonts: { check: () => false } };
  Object.defineProperty(g, 'navigator', { value: { userAgent: 'test', maxTouchPoints: 0, language: 'en', onLine: true, hardwareConcurrency: 2 }, configurable: true });
  g.screen = { width: 1, height: 1 };
  g.devicePixelRatio = 1;
  g.innerWidth = 1;
  g.innerHeight = 1;
  g.isSecureContext = true;
  g.location = { href: 'http://test/', pathname: '/', search: '' };
});

describe('diagnostics log', () => {
  beforeEach(async () => (await import('../src/lib/diag.ts')).clear());

  it('keeps timestamped entries in order and persists them for the next page load', async () => {
    const { all, record } = await import('../src/lib/diag.ts');
    record('note', 'the gradient is missing');
    record('error', 'boom');
    expect(all().map((e) => e.kind)).toEqual(['note', 'error']);
    expect(JSON.parse(storage.get('derby.diag')!)).toHaveLength(2);
  });

  it('writes a report with the device, the extra sections and the log', async () => {
    const { deviceId, record, reportText } = await import('../src/lib/diag.ts');
    record('note', 'hello');
    const text = reportText(['--- extra ---', 'x']);
    expect(text).toContain(`device ${deviceId()}`);
    expect(text).toContain('--- extra ---');
    expect(text).toMatch(/\[note\] hello/);
    expect(deviceId()).toBe(deviceId());
  });

  it('answers every feature check as a plain yes or no even where the API is missing', async () => {
    const { featureChecks, fontChecks } = await import('../src/lib/diag.ts');
    const checks = featureChecks();
    expect(checks.length).toBeGreaterThan(10);
    for (const c of [...checks, ...fontChecks()]) expect(typeof c.ok).toBe('boolean');
  });
});
