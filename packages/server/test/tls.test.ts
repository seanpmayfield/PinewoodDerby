import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import https from 'node:https';
import tls from 'node:tls';
import { ensureTls } from '../src/tls.js';

/** Connect to an HTTPS server on 127.0.0.1 trusting only `ca`, with the host check skipped so only chain and constraints decide. */
function connects(cert: string, key: string, ca: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = https.createServer({ cert, key }, (_req, res) => res.end('ok'));
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const socket = tls.connect({ host: '127.0.0.1', port, ca, checkServerIdentity: () => undefined }, () => {
        socket.end();
        server.close(() => resolve(true));
      });
      socket.on('error', () => server.close(() => resolve(false)));
    });
  });
}

describe('ensureTls', () => {
  it('creates a CA once and re-issues the server certificate only when hosts change', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'derby-tls-'));
    try {
      const first = ensureTls(dir, ['192.168.137.1']);
      expect(first.issued).toBe(true);
      expect(first.hosts).toEqual(['localhost', '127.0.0.1', '192.168.137.1']);

      const again = ensureTls(dir, ['192.168.137.1']);
      expect(again.issued).toBe(false);
      expect(again.cert).toBe(first.cert);
      expect(again.ca).toBe(first.ca);

      const grown = ensureTls(dir, ['192.168.137.1', '10.0.0.5']);
      expect(grown.issued).toBe(true);
      expect(grown.ca).toBe(first.ca);
      expect(grown.hosts).toContain('10.0.0.5');

      const ca = forge.pki.certificateFromPem(grown.ca);
      const leaf = forge.pki.certificateFromPem(grown.cert);
      expect(ca.verify(leaf)).toBe(true);
      const san = leaf.getExtension('subjectAltName') as { altNames: { type: number; ip?: string; value?: string }[] };
      expect(san.altNames.map((a) => a.ip ?? a.value)).toEqual(expect.arrayContaining(['localhost', '127.0.0.1', '192.168.137.1', '10.0.0.5']));
      const eku = leaf.getExtension('extKeyUsage') as { serverAuth?: boolean };
      expect(eku.serverAuth).toBe(true);
      const days = (leaf.validity.notAfter.getTime() - leaf.validity.notBefore.getTime()) / 86_400_000;
      expect(days).toBeLessThanOrEqual(31);
      const caExt = ca.getExtension('basicConstraints') as { cA?: boolean };
      expect(caExt.cA).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('constrains the CA to private addresses and replaces an unconstrained root', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'derby-tls-'));
    try {
      const local = ensureTls(dir, ['192.168.137.1']);
      const ca = forge.pki.certificateFromPem(local.ca);
      const constraint = ca.extensions.find((e: { id?: string }) => e.id === '2.5.29.30');
      expect(constraint).toBeDefined();
      const days = (ca.validity.notAfter.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeLessThanOrEqual(31);
      expect(days).toBeGreaterThan(28);
      expect(forge.pki.certificateFromPem(local.cert).validity.notAfter.getTime()).toBeLessThanOrEqual(ca.validity.notAfter.getTime());
      // A certificate for a LAN address is accepted; one that also names a public address is not.
      expect(await connects(local.cert, local.key, local.ca)).toBe(true);
      const publicLeaf = ensureTls(dir, ['8.8.8.8']);
      expect(publicLeaf.ca).toBe(local.ca);
      expect(await connects(publicLeaf.cert, publicLeaf.key, publicLeaf.ca)).toBe(false);

      // A root from before the constraints existed is thrown away, and the server certificate with it.
      const oldKeys = forge.pki.rsa.generateKeyPair(1024);
      const old = forge.pki.createCertificate();
      old.publicKey = oldKeys.publicKey;
      old.serialNumber = '01';
      old.validity.notBefore = new Date(Date.now() - 86_400_000);
      old.validity.notAfter = new Date(Date.now() + 3650 * 86_400_000);
      old.setSubject([{ name: 'commonName', value: 'Old CA' }]);
      old.setIssuer([{ name: 'commonName', value: 'Old CA' }]);
      old.setExtensions([{ name: 'basicConstraints', cA: true }]);
      old.sign(oldKeys.privateKey, forge.md.sha256.create());
      writeFileSync(path.join(dir, 'ca.pem'), forge.pki.certificateToPem(old));
      writeFileSync(path.join(dir, 'ca.key'), forge.pki.privateKeyToPem(oldKeys.privateKey));
      const replaced = ensureTls(dir, ['8.8.8.8']);
      expect(replaced.issued).toBe(true);
      expect(forge.pki.certificateFromPem(replaced.ca).subject.getField('CN').value).toBe('Pinewood Derby Local CA');
      expect(forge.pki.certificateFromPem(replaced.ca).verify(forge.pki.certificateFromPem(replaced.cert))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
