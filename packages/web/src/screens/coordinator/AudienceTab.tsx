import { useEffect, useRef, useState } from 'react';
import { useEmbeddedReplay } from '../../replay/ReplayCaptureContext.tsx';
import { attachStream } from '../../replay/useReplayCapture.ts';
import { PhoneQr } from '../../components/PhoneQr.tsx';
import { DEFAULT_THEME, THEMES } from '../../audience/themes.ts';
import type { PresentationMode } from '@derby/core';
import { useDerby } from '../../lib/derby.tsx';
import { carInfo, groupPath } from '../../lib/format.ts';
import { BrandingPanel } from './BrandingPanel.tsx';

const MODES: { value: PresentationMode; label: string; blurb: string }[] = [
  { value: 'auto', label: 'The show (normal)', blurb: 'Driven from the Race tab: welcome, round title cards, lineups, live times, replays, standings, awards.' },
  { value: 'welcome', label: 'Welcome slide', blurb: 'Event name, date and an optional message. Good before racing and during breaks.' },
  { value: 'standings', label: 'Standings', blurb: 'Leaderboard for a round of your choice.' },
  { value: 'awards', label: 'Awards ceremony', blurb: 'Reveal awards one at a time with the podium.' },
  { value: 'sponsors', label: 'Sponsors (intermission)', blurb: 'A thank-you screen with the pack logo and every sponsor. Good during breaks.' },
];

function EmbeddedReplayPanel() {
  const rep = useEmbeddedReplay();
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => attachStream(videoRef.current, rep.stream), [rep.stream, rep.enabled]);
  const label = rep.camState === 'recording' ? 'recording' : rep.camState === 'ready' ? 'camera ready' : rep.camState === 'no-camera' ? 'no camera' : 'off';
  return (
    <div className="embed-replay">
      <label className="field check">
        <input type="checkbox" checked={rep.enabled} onChange={(e) => rep.setEnabled(e.target.checked)} disabled={!rep.secure && !rep.enabled} />
        <span>
          Use this computer's webcam for instant replay
          {!rep.secure && <span className="muted small"> (needs the localhost or https address)</span>}
        </span>
      </label>
      {rep.enabled && (
        <div className="embed-replay-body">
          <div className="embed-replay-preview">
            <video ref={videoRef} autoPlay muted playsInline className={rep.camState === 'recording' ? 'is-recording' : ''} />
            <span className={`pill ${rep.camState === 'recording' ? 'pill-racing' : rep.camState === 'ready' ? 'pill-ok' : 'pill-off'}`}>{label}</span>
          </div>
          <div className="embed-replay-controls">
            {rep.error && <p className="warn-box">{rep.error}</p>}
            <label className="field">
              <span>Camera</span>
              <select value={rep.deviceId} onChange={(e) => rep.setDeviceId(e.target.value)}>
                <option value="">Default camera</option>
                {rep.devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            {rep.settings && (
              <p className="muted small">
                {rep.settings.width}×{rep.settings.height} at {rep.settings.frameRate ? Math.round(rep.settings.frameRate) : '?'} fps · keep this browser tab in front during racing
              </p>
            )}
            <button className="btn btn-sm" onClick={rep.testRecord} disabled={!rep.stream || rep.recordingHeat !== undefined}>
              Record a 4 s test clip
            </button>
            {rep.last && (
              <p className="muted small">
                Last clip {(rep.last.durationMs / 1000).toFixed(1)} s · {rep.last.heatId ? (rep.last.uploaded ? 'uploaded' : `not uploaded: ${rep.last.error}`) : 'test (not uploaded)'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AudienceTab() {
  const { state, view, run } = useDerby();
  const [message, setMessage] = useState(state?.presentation.message ?? '');
  if (!state || !view) return null;
  const p = state.presentation;
  const order = view.ceremonyOrder();
  const revealed = new Set(p.revealedAwardIds);
  const nextAward = order.find((a) => !revealed.has(a.id));
  const allRoundsDone = state.rounds.length > 0 && state.rounds.every((r) => r.status === 'complete');

  return (
    <main className="setup">
      <section className="panel">
        <h2>What the audience sees</h2>
        <p className="muted small">
          Open <a href="/audience" target="_blank" rel="noreferrer">/audience</a> on the projector machine and click once to go full screen. Normally you drive it from the Race tab's "On the projector" strip
          (Start race, Next round, Start awards, Reveal). The choices below override that when you need something specific.
        </p>
        {p.mode !== 'auto' && (
          <div className="warn-box control-actions">
            <span>Manual override is on; the show flow is paused.</span>
            <button className="btn btn-sm" onClick={() => run('setPresentation', { patch: { mode: 'auto' } })}>
              Back to the show
            </button>
          </div>
        )}
        {(p.introRoundId || p.replayHeatId) && (
          <div className="warn-box control-actions">
            <span>
              {p.introRoundId ? 'A round intro is pinned on the audience screen.' : 'A replay is pinned on the audience screen.'} Picking a mode below also clears it.
            </span>
            <button className="btn btn-sm" onClick={() => run('setPresentation', { patch: { introRoundId: null, replayHeatId: null } })}>
              Resume
            </button>
          </div>
        )}
        {MODES.map((m) => (
          <label key={m.value} className={`format-option ${p.mode === m.value ? 'selected' : ''}`}>
            <input type="radio" name="mode" checked={p.mode === m.value} onChange={() => run('setPresentation', { patch: { mode: m.value } })} />
            <div>
              <strong>{m.label}</strong>
              <p className="muted small">{m.blurb}</p>
            </div>
          </label>
        ))}
        {p.mode === 'standings' && (
          <label className="field">
            <span>Round</span>
            <select value={p.standingsRoundId ?? ''} onChange={(e) => run('setPresentation', { patch: { standingsRoundId: e.target.value || null } })}>
              <option value="">Current round</option>
              {state.rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Welcome message</span>
          <input value={message} placeholder="Racing starts at 10:00" onChange={(e) => setMessage(e.target.value)} onBlur={() => message !== p.message && run('setPresentation', { patch: { message } })} />
        </label>
        <label className="field">
          <span>Hold results (s)</span>
          <input type="number" min={3} max={60} value={p.resultHoldSec} onChange={(e) => run('setPresentation', { patch: { resultHoldSec: Number(e.target.value) } })} />
        </label>
        <label className="field check">
          <input type="checkbox" checked={p.soundEnabled} onChange={(e) => run('setPresentation', { patch: { soundEnabled: e.target.checked } })} />
          <span>Sound effects on the audience screen</span>
        </label>
      </section>

      <section className="panel">
        <h2>Look</h2>
        <p className="muted small">The audience screen switches live, so try each on the projector.</p>
        {THEMES.map((t) => (
          <label key={t.id} className={`format-option ${(p.theme || DEFAULT_THEME) === t.id ? 'selected' : ''}`}>
            <input type="radio" name="theme" checked={(p.theme || DEFAULT_THEME) === t.id} onChange={() => run('setPresentation', { patch: { theme: t.id } })} />
            <div>
              <strong>{t.name}</strong>
              <p className="muted small">{t.blurb}</p>
            </div>
          </label>
        ))}
      </section>

      <BrandingPanel />

      <section className="panel">
        <h2>Instant replay</h2>
        <EmbeddedReplayPanel />
        <p className="muted small">
          Or put the camera at the other end of the track: open <a href="/replay" target="_blank" rel="noreferrer">/replay</a> on a laptop there (localhost address) or on a phone on a tripod (https address, see{' '}
          <a href="/phone" target="_blank" rel="noreferrer">
            Phone setup
          </a>
          ). Only one camera should be on at a time; the last clip uploaded wins.
        </p>
        <PhoneQr size={96} compact />
        <label className="field">
          <span>Playback speed</span>
          <select value={String(p.replaySpeed)} onChange={(e) => run('setPresentation', { patch: { replaySpeed: Number(e.target.value) } })}>
            <option value="0.25">¼ speed</option>
            <option value="0.5">½ speed</option>
            <option value="0.75">¾ speed</option>
            <option value="1">Full speed</option>
          </select>
        </label>
        <label className="field">
          <span>Pre-roll (s)</span>
          <input type="number" min={0} max={5} step={0.1} value={p.replayPreRollSec} onChange={(e) => run('setPresentation', { patch: { replayPreRollSec: Number(e.target.value) } })} />
        </label>
        <label className="field">
          <span>Tail after last finisher (s)</span>
          <input type="number" min={0} max={5} step={0.1} value={p.replayTailSec} onChange={(e) => run('setPresentation', { patch: { replayTailSec: Number(e.target.value) } })} />
        </label>
        <p className="muted small">Recording starts pre-roll seconds before the fastest time seen so far, and ends the tail after the last car that finishes. A DNF never extends it.</p>
        {p.replayHeatId && (
          <div className="control-actions">
            <span className="waiting">A replay is pinned on the audience screen.</span>
            <button className="btn btn-sm" onClick={() => run('showReplay', { heatId: null })}>
              Resume live screen
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Awards ceremony</h2>
        <p className="small">
          <a href="/print/awards" target="_blank" rel="noreferrer">
            Print the awards list
          </a>
        </p>
        {order.length === 0 ? (
          <>
            <p className="muted small">No awards yet. Create the speed awards from the race format, then add design awards on the Judges screen.</p>
            <button className="btn btn-sm" onClick={() => run('generateSpeedAwards')}>
              Create speed awards
            </button>
          </>
        ) : (
          <>
            <div className="control-actions">
              <button className="btn btn-sm" onClick={() => run('computeSpeedAwards')} disabled={!allRoundsDone} title={allRoundsDone ? '' : 'Finish every round first'}>
                Fill winners from results
              </button>
              <button className="btn btn-primary" onClick={() => run('revealNextAward')} disabled={!nextAward}>
                {nextAward ? `Reveal: ${nextAward.name}` : 'All revealed'}
              </button>
              <button className="btn btn-sm" onClick={() => run('unrevealLastAward')} disabled={p.revealedAwardIds.length === 0}>
                Undo
              </button>
              <button className="btn btn-sm" onClick={() => confirm('Hide every award again?') && run('resetCeremony')} disabled={p.revealedAwardIds.length === 0}>
                Reset
              </button>
            </div>
            <ol className="ceremony">
              {order.map((a) => {
                const info = a.carId ? carInfo(state, a.carId) : null;
                return (
                  <li key={a.id} className={revealed.has(a.id) ? 'revealed' : ''}>
                    <span>
                      <strong>{a.name}</strong>
                      <span className="muted small"> {a.groupId ? groupPath(state, a.groupId) : ''}</span>
                    </span>
                    <span className={info ? '' : 'muted'}>{info ? `#${info.number} ${info.racerName}` : 'no winner yet'}</span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>
    </main>
  );
}
