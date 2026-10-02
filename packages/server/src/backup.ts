import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Automatic backup to a USB stick. While a removable drive is plugged in,
 * the event is written there as an export zip shortly after every change
 * (debounced), and a dated copy is kept every so often. Nothing is deleted.
 */

export interface BackupStatus {
  enabled: boolean;
  supported: boolean;
  /** Removable drives seen right now, e.g. ["E:\\"]. */
  drives: string[];
  lastAt: string | null;
  lastPath: string | null;
  lastError: string | null;
  /** True while a backup is being written. */
  busy: boolean;
  /** A change happened since the last backup. */
  pending: boolean;
}

export interface BackupOptions {
  enabled: boolean;
  /** Produces the zip to write. */
  archive: () => { name: string; buffer: Buffer };
  onStatus?: (status: BackupStatus) => void;
  /** How long after the last change to wait before writing. */
  settleMs?: number;
  /** How often to check for drives. */
  pollMs?: number;
  /** Delay before the first check after start-up. */
  initialDelayMs?: number;
  /** Minimum gap between dated copies. */
  datedEveryMs?: number;
  /** Override drive discovery (tests). */
  listDrives?: () => Promise<string[]>;
  /** Force on or off regardless of platform (tests, config). */
  supported?: boolean;
}

export const BACKUP_FOLDER = 'Pinewood Derby Backups';

export class UsbBackup {
  readonly status: BackupStatus;
  private timer: NodeJS.Timeout | null = null;
  private initial: NodeJS.Timeout | null = null;
  private settle: NodeJS.Timeout | null = null;
  private lastDated = new Map<string, number>();
  private backedUp = new Set<string>();

  constructor(private readonly opts: BackupOptions) {
    this.status = {
      enabled: opts.enabled,
      supported: opts.supported ?? (process.platform === 'win32' || !!opts.listDrives),
      drives: [],
      lastAt: null,
      lastPath: null,
      lastError: null,
      busy: false,
      pending: false,
    };
  }

  start(): void {
    if (this.timer || !this.status.supported) return;
    const poll = () => void this.poll();
    this.timer = setInterval(poll, this.opts.pollMs ?? 15_000);
    // First look a moment after start-up, so the server is answering before PowerShell spins up.
    this.initial = setTimeout(poll, this.opts.initialDelayMs ?? 2000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initial) clearTimeout(this.initial);
    if (this.settle) clearTimeout(this.settle);
    this.timer = null;
    this.initial = null;
    this.settle = null;
  }

  setEnabled(enabled: boolean): void {
    this.status.enabled = enabled;
    this.publish();
    if (enabled) this.markChanged();
  }

  /** Call after every change; the backup is written once things settle. Quiet: status is pushed when a write happens. */
  markChanged(): void {
    if (!this.status.supported) return;
    this.status.pending = true;
    if (this.settle) clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      this.settle = null;
      void this.run();
    }, this.opts.settleMs ?? 20_000);
  }

  /** Write now to every drive (used by the poll when a drive appears, and by tests). */
  async run(): Promise<void> {
    if (!this.status.enabled || this.status.busy) return;
    if (this.status.drives.length === 0) return;
    this.status.busy = true;
    this.publish();
    try {
      const { name, buffer } = this.opts.archive();
      const now = Date.now();
      for (const drive of this.status.drives) {
        const dir = path.join(drive, BACKUP_FOLDER, name);
        mkdirSync(dir, { recursive: true });
        const latest = path.join(dir, `${name}-latest.zip`);
        const tmp = `${latest}.part`;
        writeFileSync(tmp, buffer);
        renameSync(tmp, latest);
        this.status.lastPath = latest;
        const dated = this.lastDated.get(drive) ?? 0;
        if (now - dated > (this.opts.datedEveryMs ?? 30 * 60_000)) {
          const d = new Date(now);
          const two = (n: number) => String(n).padStart(2, '0');
          const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
          writeFileSync(path.join(dir, `${name}-${stamp}.zip`), buffer);
          this.lastDated.set(drive, now);
        }
        this.backedUp.add(drive);
      }
      this.status.lastAt = new Date(now).toISOString();
      this.status.lastError = null;
      this.status.pending = false;
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.status.busy = false;
      this.publish();
    }
  }

  private async poll(): Promise<void> {
    if (!this.status.supported) return;
    let drives: string[];
    try {
      drives = await (this.opts.listDrives ?? listRemovableDrives)();
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      this.publish();
      return;
    }
    const before = this.status.drives.join(',');
    this.status.drives = drives;
    for (const d of [...this.backedUp]) if (!drives.includes(d)) this.backedUp.delete(d);
    const fresh = drives.some((d) => !this.backedUp.has(d));
    if (before !== drives.join(',')) this.publish();
    if (fresh || (this.status.pending && !this.settle)) await this.run();
  }

  private publish(): void {
    this.opts.onStatus?.({ ...this.status, drives: [...this.status.drives] });
  }
}

/** Removable drives that are mounted with a file system, e.g. ["E:\\"]. Windows only. */
function listRemovableDrives(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object { if ($_.FileSystem) { $_.DeviceID } }"],
      { timeout: 10_000, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        const drives = String(stdout)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => /^[A-Z]:$/i.test(l))
          .map((l) => `${l}\\`)
          .filter((d) => {
            try {
              return existsSync(d) && statSync(d).isDirectory();
            } catch {
              return false;
            }
          });
        resolve(drives);
      },
    );
  });
}
