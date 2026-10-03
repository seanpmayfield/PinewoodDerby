import { useEffect, useState } from 'react';
import { fetchInfo } from '../lib/connection.ts';
import type { ServerInfo } from '../lib/types.ts';
import { QrCode } from './QrCode.tsx';

/** "Vote for your favourite" with a QR code to the voting page, for the audience screen while the ballot is open. */
export function VoteQr({ size = 120 }: { size?: number }) {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => undefined);
  }, []);
  const base = info?.urls[0] ?? location.origin;
  return (
    <div className="aud-vote">
      <QrCode value={`${base}/vote`} size={size} />
      <div className="aud-vote-text">
        <div className="aud-kicker">Vote for your favourite car</div>
        <div className="aud-vote-url">{base.replace(/^https?:\/\//, '')}/vote</div>
      </div>
    </div>
  );
}
