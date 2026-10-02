import { useEffect, useState } from 'react';
import { fetchInfo } from '../lib/connection.ts';
import type { ServerInfo } from '../lib/types.ts';
import { QrCode } from './QrCode.tsx';

/**
 * QR codes for the phones: pit crew check-in and the replay camera. Uses the
 * secure address when the server has one (both pages need it for the camera).
 */
export function PhoneQr({ size = 110, compact = false }: { size?: number; compact?: boolean }) {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => undefined);
  }, []);
  if (!info) return null;
  const base = info.httpsUrls[0] ?? info.urls[0] ?? location.origin;
  const secure = base.startsWith('https');
  const links = [
    { label: 'Pit crew', path: '/pit' },
    { label: 'Replay camera', path: '/replay' },
  ];
  return (
    <div className={`phone-qr ${compact ? 'is-compact' : ''}`}>
      {links.map((l) => (
        <a key={l.path} className="phone-qr-item" href={`${base}${l.path}`} target="_blank" rel="noreferrer" title={`${base}${l.path}`}>
          <QrCode value={`${base}${l.path}`} size={size} />
          <span>{l.label}</span>
        </a>
      ))}
      <p className="muted small phone-qr-note">
        {secure ? (
          <>
            Secure address. New phone? Open{' '}
            <a href="/phone" target="_blank" rel="noreferrer">
              /phone
            </a>{' '}
            first to trust the certificate.
          </>
        ) : (
          'HTTPS is off; the phone camera will fall back to the camera app.'
        )}
      </p>
    </div>
  );
}
