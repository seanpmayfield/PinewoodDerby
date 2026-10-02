import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDerby } from '../lib/derby.tsx';
import { fetchInfo } from '../lib/connection.ts';
import type { ServerInfo } from '../lib/types.ts';
import { PhoneQr } from '../components/PhoneQr.tsx';

const SCREENS = [
  { to: '/coordinator', title: 'Race Coordinator', blurb: 'Run the heats, manage the roster, fix problems. Behind the scenes.' },
  { to: '/audience', title: 'Audience Display', blurb: 'Who is up, lane assignments, results, replay. For the projector.' },
  { to: '/pit', title: 'Pit Crew', blurb: 'Check in, weigh, inspect and photograph cars.' },
  { to: '/judges', title: 'Judges', blurb: 'Pick the design award winners.' },
  { to: '/replay', title: 'Replay Camera', blurb: 'Open on the computer with the finish-line webcam. Records each heat for the instant replay.' },
  { to: '/coordinator/wizard', title: 'Setup Wizard', blurb: 'First-time setup with live checks: network, projector, phones, replay, timer, roster, dry run.' },
];

export function Home() {
  const { state, connected } = useDerby();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => setInfo(null));
  }, [connected]);

  return (
    <main className="home">
      <header className="home-header">
        <div className="wordmark">Pinewood Derby</div>
        <h1>{state?.name ?? 'Connecting…'}</h1>
        <p className="muted">{state?.date}</p>
      </header>
      <div className="home-grid">
        {SCREENS.map((s) => (
          <Link key={s.to} to={s.to} className="home-card">
            <h2>{s.title}</h2>
            <p>{s.blurb}</p>
          </Link>
        ))}
      </div>
      {info && (
        <footer className="home-footer">
          <p className="muted">Scan with a phone on the hotspot:</p>
          <PhoneQr size={150} />
          <p className="muted small" style={{ marginTop: '1rem' }}>
            Other laptops: <code>{info.urls[0] ?? location.origin}</code>
            {info.secureAvailable && (
              <>
                {' '}
                · first time on a phone, open <Link to="/phone">Phone setup</Link> to trust the certificate.
              </>
            )}
          </p>
        </footer>
      )}
    </main>
  );
}
