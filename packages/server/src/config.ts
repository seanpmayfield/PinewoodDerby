import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type TimerKind = 'simulator' | 'derby-magic';

export interface ServerConfig {
  host: string;
  port: number;
  /** HTTPS port for the phones (live camera needs a secure page). null disables it. */
  httpsPort: number | null;
  /** Where the local CA and server certificate live. */
  tlsDir: string;
  /** Directory holding the SQLite database, photos, replay clips, headshots and the TLS material. */
  dataDir: string;
  /** Automatic backup to USB sticks (Windows). */
  usbBackup: boolean;
  /** Optional PIN that every POST (commands, uploads, import) must carry in the x-derby-pin header. */
  pin: string | null;
  timer: TimerKind;
  /** Serial port for the real timer, e.g. COM3. null = auto-detect. */
  serialPort: string | null;
  /** Simulator speed: 1 = real time, 0 = instant. */
  simulatorSpeed: number;
  /** Probability that a simulated car never finishes. */
  simulatorDnfChance: number;
  /** Built web app to serve, or null to run API only (Vite dev server serves the UI). */
  webDist: string | null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const webDist = env['DERBY_WEB_DIST'] ?? path.join(repoRoot, 'packages', 'web', 'dist');
  const dataDir = env['DERBY_DATA_DIR'] ?? path.join(repoRoot, 'data');
  return {
    host: env['DERBY_HOST'] ?? '0.0.0.0',
    port: Number(env['DERBY_PORT'] ?? 8080),
    httpsPort: Number(env['DERBY_HTTPS_PORT'] ?? 8443) || null,
    tlsDir: path.join(dataDir, 'tls'),
    dataDir,
    usbBackup: env['DERBY_USB_BACKUP'] !== '0',
    pin: env['DERBY_PIN'] || null,
    timer: env['DERBY_TIMER'] === 'derby-magic' ? 'derby-magic' : 'simulator',
    serialPort: env['DERBY_SERIAL_PORT'] || null,
    simulatorSpeed: Number(env['DERBY_SIM_SPEED'] ?? 1),
    simulatorDnfChance: Number(env['DERBY_SIM_DNF'] ?? 0.03),
    webDist: existsSync(path.join(webDist, 'index.html')) ? webDist : null,
  };
}
