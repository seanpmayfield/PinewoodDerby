/**
 * Local HTTPS for the phones.
 *
 * Browsers only allow the live camera on a secure page, and the hotspot has no
 * public name to get a real certificate for. So the server runs its own tiny
 * certificate authority: the CA root is generated once and kept in the data
 * folder (each phone trusts it once), and a server certificate signed by it
 * is re-issued whenever the laptop's addresses change. Pure JavaScript via
 * node-forge, so nothing to install and it works offline.
 *
 * A root that phones trust is a sensitive thing, so the CA carries X.509
 * name constraints: it can only vouch for private LAN addresses and
 * "localhost", never a public name, and it lasts only 30 days: long enough
 * for the phones to be set up in the week before the race and used on the
 * day, after which it expires on its own and a new one is made next time the
 * server runs. A root made before the constraints existed is replaced too.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';

export interface TlsMaterial {
  key: string;
  cert: string;
  ca: string;
  hosts: string[];
  /** True when the server certificate was (re)generated in this call. */
  issued: boolean;
}

const CA_DAYS = 30;
const NAME_CONSTRAINTS_OID = '2.5.29.30';
/** Re-issue a certificate when it has less than this left, so nothing expires mid-event. */
const RENEW_MS = 86_400_000;

export function ensureTls(dir: string, hosts: string[]): TlsMaterial {
  mkdirSync(dir, { recursive: true });
  const ca = loadOrCreateCa(dir);
  const wanted = uniqueHosts(hosts);

  const leafKeyPath = path.join(dir, 'server.key');
  const leafCertPath = path.join(dir, 'server.pem');
  const metaPath = path.join(dir, 'server.json');
  if (!ca.created && existsSync(leafKeyPath) && existsSync(leafCertPath) && existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { hosts: string[]; notAfter: string };
      const covers = wanted.every((h) => meta.hosts.includes(h));
      const fresh = new Date(meta.notAfter).getTime() > Date.now() + RENEW_MS;
      if (covers && fresh) {
        return { key: readFileSync(leafKeyPath, 'utf8'), cert: readFileSync(leafCertPath, 'utf8'), ca: ca.pem, hosts: meta.hosts, issued: false };
      }
    } catch {
      /* regenerate below */
    }
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  // The server certificate cannot outlive the root that signs it.
  cert.validity.notAfter = ca.cert.validity.notAfter;
  cert.setSubject([{ name: 'commonName', value: 'Pinewood Derby race server' }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: wanted.map((h) => (isIp(h) ? { type: 7, ip: h } : { type: 2, value: h })),
    },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());

  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);
  writeFileSync(leafKeyPath, keyPem);
  writeFileSync(leafCertPath, certPem);
  writeFileSync(metaPath, JSON.stringify({ hosts: wanted, notAfter: cert.validity.notAfter.toISOString() }));
  return { key: keyPem, cert: certPem, ca: ca.pem, hosts: wanted, issued: true };
}

function loadOrCreateCa(dir: string): { key: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate; pem: string; created: boolean } {
  const keyPath = path.join(dir, 'ca.key');
  const certPath = path.join(dir, 'ca.pem');
  if (existsSync(keyPath) && existsSync(certPath)) {
    const pem = readFileSync(certPath, 'utf8');
    const cert = forge.pki.certificateFromPem(pem);
    const constrained = cert.extensions.some((e: { id?: string }) => e.id === NAME_CONSTRAINTS_OID);
    const fresh = cert.validity.notAfter.getTime() > Date.now() + RENEW_MS;
    // A root made when the lifetime was longer is replaced, so the 30-day rule applies to existing installs too.
    const shortLived = cert.validity.notAfter.getTime() - cert.validity.notBefore.getTime() <= (CA_DAYS + 2) * 86_400_000;
    if (constrained && fresh && shortLived) {
      return { key: forge.pki.privateKeyFromPem(readFileSync(keyPath, 'utf8')) as forge.pki.rsa.PrivateKey, cert, pem, created: false };
    }
  }
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + CA_DAYS * 86_400_000);
  const subject = [
    { name: 'commonName', value: 'Pinewood Derby Local CA' },
    { name: 'organizationName', value: 'Pinewood Derby race server' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
    { id: NAME_CONSTRAINTS_OID, critical: false, value: nameConstraints() },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
  writeFileSync(certPath, pem);
  return { key: keys.privateKey, cert, pem, created: true };
}

/**
 * RFC 5280 NameConstraints: permitted subtrees only, so certificates from this
 * CA are accepted for private IPv4 ranges, loopback, link-local and the name
 * "localhost", and for nothing else. A leaf naming anything outside these is
 * rejected by clients that honour the extension (iOS, Android, Chrome, Node).
 */
function nameConstraints(): forge.asn1.Asn1 {
  const { asn1 } = forge;
  const bytes = (...n: number[]) => String.fromCharCode(...n);
  const ip = (addr: number[], mask: number[]) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.CONTEXT_SPECIFIC, 7, false, bytes(...addr, ...mask))]);
  const dns = (name: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, name)]);
  const permitted = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    ip([10, 0, 0, 0], [255, 0, 0, 0]),
    ip([172, 16, 0, 0], [255, 240, 0, 0]),
    ip([192, 168, 0, 0], [255, 255, 0, 0]),
    ip([169, 254, 0, 0], [255, 255, 0, 0]),
    ip([127, 0, 0, 0], [255, 0, 0, 0]),
    dns('localhost'),
  ]);
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [permitted]);
}

function serial(): string {
  // Positive, random, 16 bytes.
  return '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));
}

function isIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function uniqueHosts(hosts: string[]): string[] {
  return [...new Set(['localhost', '127.0.0.1', ...hosts])];
}
