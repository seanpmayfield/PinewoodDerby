import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchInfo } from '../lib/connection.ts';
import type { ServerInfo } from '../lib/types.ts';
import { QrCode } from '../components/QrCode.tsx';
import '../pit/pit.css';

/**
 * One-time setup so a phone can use the live camera: trust the server's
 * certificate, then open the secure address.
 */
export function PhoneSetup() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => undefined);
  }, []);
  const secureHere = window.isSecureContext;
  const httpsUrl = info?.httpsUrls[0] ?? null;
  const httpHere = location.protocol === 'http:';

  return (
    <div className="pit">
      <header className="pit-header">
        <div>
          <div className="pit-kicker">Phone setup</div>
          <h1>Live camera on this phone</h1>
        </div>
      </header>
      <div className="pit-detail">
        {secureHere ? (
          <div className="pit-card">
            <h3>You're set</h3>
            <p>This page is already on the secure address, so the live camera with the car outline works here.</p>
            <Link className="pbtn pbtn-primary" to="/pit">
              Go to the pit crew page
            </Link>
          </div>
        ) : (
          <p className="pit-hint">The live viewfinder needs the secure (https) address. It takes about a minute per phone and lasts 30 days, so do it in the month before the race.</p>
        )}

        <div className="pit-card">
          <h3>1. Install the certificate</h3>
          <p>Download it here, on the regular (http) address you are on now.</p>
          {httpHere ? (
            <a className="pbtn pbtn-primary" href="/ca.pem" download="pinewood-derby-ca.pem">
              Download certificate
            </a>
          ) : (
            <p className="pit-hint">Open this page from the http address to download.</p>
          )}
          <p style={{ marginTop: '0.75rem' }}>
            <strong>iPhone:</strong> tap Allow, then Settings › Profile Downloaded › Install. Then Settings › General › About › Certificate Trust Settings and switch on <em>Pinewood Derby Local CA</em>.
          </p>
          <p>
            <strong>Android:</strong> Settings › Security › Encryption &amp; credentials › Install a certificate › CA certificate, and pick the downloaded file.
          </p>
        </div>

        <div className="pit-card">
          <h3>2. Open the secure address</h3>
          {httpsUrl ? (
            <>
              <p>
                <a className="pbtn pbtn-primary" href={`${httpsUrl}/pit`}>
                  Open {httpsUrl}/pit
                </a>
              </p>
              <QrCode value={`${httpsUrl}/pit`} size={160} />
              <p className="pit-sub">Add it to the home screen so it is one tap next time.</p>
            </>
          ) : info ? (
            <p className="pit-hint is-warn">The server is not running HTTPS. Start it without DERBY_HTTPS_PORT=0.</p>
          ) : (
            <p>Loading…</p>
          )}
        </div>

        <div className="pit-card">
          <h3>Using this phone as the replay camera</h3>
          <p>
            After the steps above, open <code>{httpsUrl ? `${httpsUrl}/replay` : '/replay'}</code> on it, put it on a tripod at the finish line side-on, and leave the page in front. It asks the phone to keep the screen on; if that is not honoured, set Auto-Lock to Never in Settings › Display &amp; Brightness.
          </p>
          {httpsUrl && (
            <a className="pbtn" href={`${httpsUrl}/replay`}>
              Open the replay camera
            </a>
          )}
        </div>

        <div className="pit-card">
          <h3>Without this</h3>
          <p>The pit crew page still works on the http address: tapping a photo tile opens the phone's own camera app, and you line the car up afterwards in the crop tool.</p>
        </div>
      </div>
    </div>
  );
}
