import { execFile } from 'node:child_process';
import os from 'node:os';

/** The address Windows gives the laptop on its own mobile hotspot. */
export const HOTSPOT_ADDRESS = '192.168.137.1';

/** Does the Windows firewall have our inbound rule? null when that cannot be determined (not Windows). */
export function firewallRuleExists(port: number): Promise<boolean | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=Pinewood Derby race server (TCP ${port})`], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err && !String(stdout).includes('No rules match')) return resolve(null);
      resolve(!err && /Enabled:\s+Yes/i.test(String(stdout)));
    });
  });
}

/** IPv4 addresses of this machine that other devices can reach. */
export function lanHosts(): string[] {
  const hosts: string[] = [];
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) hosts.push(addr.address);
    }
  }
  return hosts;
}

/** Addresses other devices on the hotspot can use. */
export function lanUrls(port: number, protocol: 'http' | 'https' = 'http'): string[] {
  return lanHosts().map((h) => `${protocol}://${h}:${port}`);
}

/** Hosts the certificate must cover: current addresses plus the hotspot address, which may appear later. */
export function tlsHosts(): string[] {
  return [...lanHosts(), HOTSPOT_ADDRESS];
}
