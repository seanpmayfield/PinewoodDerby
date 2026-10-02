import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Derby, DerbyEngine } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { carInfo } from '../lib/format.ts';
import { findHeat } from '../audience/mode.ts';
import { attachStream, loadReplayPrefs, saveReplayPrefs, useReplayCapture } from '../replay/useReplayCapture.ts';

/**
 * Standalone finish-line camera page: a laptop with a webcam, or a phone on a
 * tripod at the finish. Open it at localhost on the laptop, or at the https
 * address on a phone (after the one-time certificate setup).
 */
export function ReplayCam() {
  const { state, view, timer } = useDerby();
  const [deviceId, setDeviceId] = useState(() => loadReplayPrefs().deviceId);
  const cap = useReplayCapture(true, deviceId);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => attachStream(videoRef.current, cap.stream), [cap.stream]);

  const phone = /iPhone|iPad|Android/i.test(navigator.userAgent);
  const speed = state?.presentation.replaySpeed ?? 0.5;
  const lastHeat = cap.last?.heatId && state && view ? heatLabel(state, view, cap.last.heatId) : null;

  const chooseDevice = (id: string) => {
    setDeviceId(id);
    saveReplayPrefs({ deviceId: id });
  };

  return (
    <main className="replaycam">
      <header className="topbar">
        <div className="topbar-title">
          <span className="wordmark">Replay camera</span>
          <span className="topbar-event">{state?.name ?? '…'}</span>
        </div>
        <div className="topbar-status">
          <span className={`pill ${cap.camState === 'recording' ? 'pill-racing' : cap.camState === 'ready' ? 'pill-ok' : 'pill-off'}`}>
            {cap.camState === 'recording' ? 'recording' : cap.camState === 'ready' ? 'camera ready' : 'no camera'}
          </span>
          <span className={`pill pill-${timer?.state ?? 'idle'}`}>{timer ? `timer ${timer.state}` : 'timer ?'}</span>
        </div>
      </header>

      <div className="replaycam-body">
        <section className="panel replaycam-preview">
          {!cap.secure ? (
            <div className="warn-box replaycam-warn">
              <strong>No camera: this page is not on a secure address.</strong> On the laptop open <code>{`http://localhost${location.port ? `:${location.port}` : ''}/replay`}</code>. On a phone use the https address from <Link to="/phone">Phone setup</Link>.
            </div>
          ) : cap.error ? (
            <div className="warn-box replaycam-warn">
              <strong>No camera:</strong> {cap.error}. Allow camera access for this site, or pick another device below.
            </div>
          ) : null}
          <video ref={videoRef} autoPlay muted playsInline className={cap.camState === 'recording' ? 'is-recording' : ''} />
          {cap.settings && (
            <p className="muted small">
              {cap.settings.width}×{cap.settings.height} at {cap.settings.frameRate ? Math.round(cap.settings.frameRate) : '?'} fps
              {phone && <> · screen {cap.awake ? 'kept awake' : 'may lock: set Auto-Lock to Never'}</>}
            </p>
          )}
        </section>

        <aside className="replaycam-side">
          <section className="panel">
            <h2>Camera</h2>
            <label className="field">
              <span>Device</span>
              <select value={deviceId} onChange={(e) => chooseDevice(e.target.value)} disabled={!cap.secure}>
                <option value="">{phone ? 'Back camera' : 'Default camera'}</option>
                {cap.devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              Point it at the finish line from the side so all lanes are in frame. Leave this page open during the race. Recording starts about {cap.preRollSec.toFixed(1)} s before the fastest car could reach the line
              (fastest so far {cap.fastestSec.toFixed(2)} s) and ends {cap.tailSec.toFixed(1)} s after the last car that finishes, so a DNF never drags the clip out.
            </p>
            <button className="btn" onClick={cap.testRecord} disabled={!cap.stream || cap.recordingHeat !== undefined}>
              Record a 4 s test clip
            </button>
          </section>

          {phone && (
            <section className="panel">
              <h2>On a phone</h2>
              <ul className="muted small replaycam-tips">
                <li>Tripod or clamp at the finish, side-on, all four lanes in frame.</li>
                <li>{cap.awake ? 'This page is keeping the screen awake.' : 'Set Auto-Lock to Never (Settings › Display & Brightness) so the screen stays on.'}</li>
                <li>Keep this page in front; Safari pauses the camera when you switch apps.</li>
                <li>Plug the phone in if the race runs long.</li>
              </ul>
            </section>
          )}

          <section className="panel">
            <h2>Last clip</h2>
            {cap.last ? (
              <>
                <video
                  key={cap.last.url}
                  src={cap.last.url}
                  controls
                  loop
                  autoPlay
                  muted
                  playsInline
                  className="replaycam-last"
                  ref={(el) => {
                    if (el) el.playbackRate = speed;
                  }}
                />
                <p className="small">
                  {(cap.last.size / 1024 / 1024).toFixed(1)} MB · {(cap.last.durationMs / 1000).toFixed(1)} s · playing at {speed}×
                  <br />
                  {cap.last.heatId ? (
                    cap.last.uploaded ? (
                      <span className="ok">Uploaded for {lastHeat ?? 'heat'}.</span>
                    ) : (
                      <span className="bad">Not uploaded: {cap.last.error}</span>
                    )
                  ) : (
                    <span className="muted">Test clip (not uploaded).</span>
                  )}
                </p>
              </>
            ) : (
              <p className="muted">Nothing recorded yet.</p>
            )}
          </section>

          <section className="panel">
            <p className="muted small">
              Replay speed and timing are on the coordinator's <Link to="/coordinator/audience">Audience tab</Link>. If the webcam is on the race PC, tick "use this computer's webcam" there instead of keeping this page open.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function heatLabel(state: Derby, view: DerbyEngine, heatId: string): string | null {
  const found = findHeat(state, heatId);
  if (!found) return null;
  const winner = found.heat.result?.lanes.find((l) => l.place === 1);
  const info = winner?.carId ? carInfo(state, winner.carId) : null;
  return `${found.round.name} heat ${view.heatPosition(found.heat.id).position}${info ? ` (won by #${info.number})` : ''}`;
}
