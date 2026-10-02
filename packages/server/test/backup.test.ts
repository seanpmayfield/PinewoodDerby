import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BACKUP_FOLDER, UsbBackup } from '../src/backup.js';

describe('UsbBackup', () => {
  it('writes a backup zip to a removable drive once changes settle', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'derby-usb-'));
    try {
      const usb = new UsbBackup({
        enabled: true,
        archive: () => ({ name: 'test-event', buffer: Buffer.from('zip-bytes') }),
        listDrives: async () => [dir],
        settleMs: 10,
        pollMs: 60_000,
        initialDelayMs: 0,
      });
      usb.start();
      await new Promise((r) => setTimeout(r, 200));
      const latest = path.join(dir, BACKUP_FOLDER, 'test-event', 'test-event-latest.zip');
      expect(existsSync(latest)).toBe(true);
      expect(usb.status.lastPath).toBe(latest);
      expect(usb.status.pending).toBe(false);
      usb.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
