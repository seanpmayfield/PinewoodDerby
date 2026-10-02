import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FORMAT_PRESETS } from '@derby/core';
import { useDerby } from '../../lib/derby.tsx';
import { fetchDiagnostics } from '../../lib/connection.ts';
import type { Diagnostics } from '../../lib/types.ts';
import { QrCode } from '../../components/QrCode.tsx';
import { useEmbeddedReplay } from '../../replay/ReplayCaptureContext.tsx';
import { attachStream } from '../../replay/useReplayCapture.ts';
import { laneColor } from '../../lib/format.ts';

/**
 * First-time setup, step by step, with live checks: the wizard watches which
 * screens and phones are connected and how, and tries the timer and camera.
 */

type Status = 'ok' | 'warn' | 'todo';

const STEPS = ['Event', 'Network', 'Projector', 'Phones', 'Replay camera', 'Timer', 'Roster', 'Dry run', 'Done'] as const;

export function WizardTab() {
  const { state, timer, run, view } = useDerby();
  const [step, setStep] = useState(0);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [name, setName] = useState(state?.name ?? '');
  const [date, setDate] = useState(state?.date ?? '');
  const rep = useEmbeddedReplay();
  const previewRef = useRef<HTMLVideoElement>(null);
  useEffect(() => attachStream(previewRef.current, rep.stream), [rep.stream, rep.enabled, step]);

  useEffect(() => {
    let alive = true;
    const poll = () => fetchDiagnostics().then((d) => alive && setDiag(d)).catch(() => undefined);
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  useEffect(() => {
    setName(state?.name ?? '');
    setDate(state?.date ?? '');
  }, [state?.name, state?.date]);

  if (!state || !view) return null;

  const clients = diag?.clients ?? [];
  const audienceScreens = clients.filter((c) => c.page === 'audience');
  const pitPhones = clients.filter((c) => c.page === 'pit' || c.page === 'phone');
  const replayPages = clients.filter((c) => c.page === 'replay');
  const localIps = new Set(['127.0.0.1', '::1', ...(diag?.addresses ?? [])]);
  const remote = (ip: string) => !localIps.has(ip);
  const httpsBase = diag?.httpsPort && diag.addresses[0] ? `https://${diag.addresses[0]}:${diag.httpsPort}` : null;
  const httpBase = diag?.addresses[0] ? `http://${diag.addresses[0]}:${diag.port}` : location.origin;
  const camFresh = !!timer?.replayCamAt && Date.now() - timer.replayCamAt < 15_000;
  const laneTestOk = !!timer && timer.lastHeatId === null && timer.lastLanes.length === state.laneCount && timer.lastLanes.every((l) => l.timeSec !== null);
  const dens = view.groupsOfKind('den');
  const racersOk = state.racers.length > 0 && dens.length > 0;

  const statuses: Record<(typeof STEPS)[number], Status> = {
    Event: state.name.trim() && !/^new pinewood derby$/i.test(state.name) ? 'ok' : 'todo',
    Network: !diag ? 'todo' : diag.addresses.length === 0 ? 'warn' : diag.firewallRule === false ? 'warn' : 'ok',
    Projector: audienceScreens.length > 0 ? 'ok' : 'todo',
    Phones: pitPhones.some((c) => remote(c.ip) && c.secure && c.camera) ? 'ok' : pitPhones.some((c) => remote(c.ip)) ? 'warn' : 'todo',
    'Replay camera': camFresh && timer?.replayCamState !== 'no-camera' ? 'ok' : camFresh ? 'warn' : 'todo',
    Timer: !timer ? 'todo' : timer.connected && laneTestOk ? 'ok' : timer.connected ? 'warn' : 'todo',
    Roster: racersOk ? 'ok' : 'todo',
    'Dry run': state.rounds.some((r) => r.heats.some((h) => h.status === 'finished')) ? 'ok' : 'todo',
    Done: diag?.wizardDone ? 'ok' : 'todo',
  };

  const current = STEPS[step]!;

  return (
    <main className="wizard">
      <aside className="panel wizard-steps">
        <h2>Setup checklist</h2>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s} className={`wizard-step ${i === step ? 'is-current' : ''} status-${statuses[s]}`} onClick={() => setStep(i)}>
              <span className="wizard-dot" />
              {s}
            </li>
          ))}
        </ol>
        <p className="muted small">Green means verified right now, amber means connected but something is off, grey means not seen yet. The checks keep running while you work.</p>
      </aside>

      <section className="panel wizard-body">
        <header className="wizard-head">
          <span className="wordmark">
            Step {step + 1} of {STEPS.length}
          </span>
          <h2>{current}</h2>
        </header>

        {current === 'Event' && (
          <Section>
            <p>Name the event and pick how you race. The format can't change once heats have run.</p>
            <label className="field">
              <span>Event name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== state.name && run('updateDerby', { patch: { name } })} placeholder="Pack 316 Pinewood Derby 2027" />
            </label>
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => date && date !== state.date && run('updateDerby', { patch: { date } })} />
            </label>
            <label className="field">
              <span>Lanes</span>
              <select value={state.laneCount} disabled={state.rounds.length > 0} onChange={(e) => run('updateDerby', { patch: { laneCount: Number(e.target.value) } })}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {FORMAT_PRESETS.map((f) => (
              <label key={f.id} className={`format-option ${state.format.id === f.id ? 'selected' : ''}`}>
                <input type="radio" name="wizfmt" checked={state.format.id === f.id} disabled={state.rounds.length > 0} onChange={() => run('setFormat', { formatId: f.id })} />
                <div>
                  <strong>{f.name}</strong>
                  <p className="muted small">{f.description}</p>
                </div>
              </label>
            ))}
          </Section>
        )}

        {current === 'Network' && (
          <Section>
            <p>Everything talks over one local Wi-Fi network; no internet is needed. A small router is the most reliable; the Windows hotspot on this laptop also works.</p>
            <Check status={diag ? (diag.addresses.length ? 'ok' : 'warn') : 'todo'} title="This laptop has a network address">
              {diag?.addresses.length ? (
                <>
                  {diag.addresses.map((a) => (
                    <code key={a}>{a}</code>
                  ))}
                  {diag.hotspot && <span className="muted small"> · Windows Mobile Hotspot detected</span>}
                </>
              ) : (
                'No address found. Join the race network (or turn the hotspot on) and this will update.'
              )}
            </Check>
            <Check status={diag?.firewallRule === true ? 'ok' : diag?.firewallRule === false ? 'warn' : 'todo'} title="Windows Firewall lets phones in">
              {diag?.firewallRule === true
                ? `Rule found for port ${diag.port}.`
                : diag?.firewallRule === false
                  ? 'No rule yet. Right-click "Allow Through Firewall.cmd" in the app folder and choose Run as administrator. This check updates by itself.'
                  : 'Could not check (not Windows, or netsh unavailable).'}
            </Check>
            <Check status={diag?.httpsPort ? 'ok' : 'warn'} title="Secure address for phone cameras">
              {diag?.httpsPort ? `HTTPS is on: ${httpsBase}` : 'HTTPS is off; phone cameras will fall back to the camera app.'}
            </Check>
          </Section>
        )}

        {current === 'Projector' && (
          <Section>
            <p>
              On the projector computer open <code>{httpBase}/audience</code> (or run "Start Audience Screen.cmd" if the projector is on this laptop) and click once for full screen and sound.
            </p>
            <Check status={audienceScreens.length ? 'ok' : 'todo'} title="Audience screen connected">
              {audienceScreens.length ? `${audienceScreens.length} audience screen${audienceScreens.length > 1 ? 's' : ''} connected (${audienceScreens.map((c) => (remote(c.ip) ? c.ip : 'this laptop')).join(', ')}).` : 'Waiting for an audience screen to open…'}
            </Check>
            <div className="control-actions">
              <button className="btn" onClick={() => run('setPresentation', { patch: { mode: 'welcome' } })}>
                Show welcome slide
              </button>
              <button className="btn" onClick={() => run('setPresentation', { patch: { mode: 'auto' } })}>
                Back to the show
              </button>
            </div>
            <p className="muted small">If the projector shows nothing: check it is on the same network, and that the firewall step is green.</p>
          </Section>
        )}

        {current === 'Phones' && (
          <Section>
            <p>Each pit crew phone does a one-time certificate install so its camera works in the browser, then uses the secure address.</p>
            <div className="wizard-qr">
              <div>
                <QrCode value={`${httpBase}/phone`} size={150} />
                <span>1. Scan: install certificate</span>
              </div>
              {httpsBase && (
                <div>
                  <QrCode value={`${httpsBase}/pit`} size={150} />
                  <span>2. Scan: pit crew page</span>
                </div>
              )}
            </div>
            <Check status={statuses.Phones} title="A phone is on the pit crew page with a working camera">
              {pitPhones.filter((c) => remote(c.ip)).length === 0 ? (
                'No phone connected yet.'
              ) : (
                <ul className="wizard-list">
                  {pitPhones
                    .filter((c) => remote(c.ip))
                    .map((c, i) => (
                      <li key={i}>
                        {c.ip} · {c.page} page · {c.tls ? 'secure address' : 'plain http'} · camera {c.secure && c.camera ? 'available' : 'blocked'}
                        {!c.tls && <span className="muted small"> → open the https address after installing the certificate</span>}
                      </li>
                    ))}
                </ul>
              )}
            </Check>
            <details className="wizard-help">
              <summary>Troubleshooting</summary>
              <ul>
                <li>Phone can't open the http address at all: it is not on the race network, or the firewall step is not green.</li>
                <li>Certificate warning on the https address: the trust switch was missed. iPhone: Settings › General › About › Certificate Trust Settings.</li>
                <li>Camera "blocked" on the https address: allow the camera for the site in the browser's address bar, then reload.</li>
                <li>Phone says "no internet" for this Wi-Fi: expected. Keep it connected.</li>
              </ul>
            </details>
          </Section>
        )}

        {current === 'Replay camera' && (
          <Section>
            <p>Pick one: a webcam on this laptop, a laptop at the finish line, or a phone on a tripod. Then record a test clip.</p>
            <label className="field check">
              <input type="checkbox" checked={rep.enabled} onChange={(e) => rep.setEnabled(e.target.checked)} disabled={!rep.secure && !rep.enabled} />
              <span>Use this computer's webcam{!rep.secure && <span className="muted small"> (open the coordinator at localhost or the https address)</span>}</span>
            </label>
            {rep.enabled && (
              <div className="embed-replay-body">
                <div className="embed-replay-preview">
                  <video ref={previewRef} autoPlay muted playsInline />
                </div>
                <div>
                  <button className="btn btn-sm" onClick={rep.testRecord} disabled={!rep.stream || rep.recordingHeat !== undefined}>
                    Record a 4 s test clip
                  </button>
                  {rep.last && <p className="muted small">Last clip {(rep.last.durationMs / 1000).toFixed(1)} s, {(rep.last.size / 1024 / 1024).toFixed(1)} MB.</p>}
                </div>
              </div>
            )}
            {httpsBase && (
              <div className="wizard-qr">
                <div>
                  <QrCode value={`${httpsBase}/replay`} size={130} />
                  <span>Phone on a tripod (after the certificate step)</span>
                </div>
              </div>
            )}
            <Check status={statuses['Replay camera']} title="A replay camera is on duty">
              {camFresh
                ? timer?.replayCamState === 'no-camera'
                  ? 'A replay page is open but its camera is blocked.'
                  : `Ready: ${replayPages.length ? replayPages.map((c) => (remote(c.ip) ? c.ip : 'this laptop')).join(', ') : 'this coordinator'}.`
                : 'No camera reporting in. The replay is optional; skip if you are not using it.'}
            </Check>
          </Section>
        )}

        {current === 'Timer' && (
          <Section>
            <p>Plug the Derby Magic in, choose it here, then run a lane test: roll a car down each lane and every lane should report.</p>
            <div className="lane-toggles">
              <button className={`btn ${timer?.kind === 'simulator' ? 'btn-primary' : ''}`} onClick={() => run('configureTimer', { kind: 'simulator' })}>
                Simulator (rehearsal)
              </button>
              <button className={`btn ${timer?.kind === 'derby-magic' ? 'btn-primary' : ''}`} onClick={() => run('configureTimer', { kind: 'derby-magic' })}>
                Derby Magic (USB)
              </button>
            </div>
            <Check status={timer?.connected ? 'ok' : 'todo'} title="Timer connected">
              {timer?.connected ? `${timer.kind === 'simulator' ? 'Simulator' : `Derby Magic on ${timer.port} @ ${timer.baud}`}${timer.identity ? ` · ${timer.identity}` : ''}` : timer?.lastError ?? 'Not connected.'}
            </Check>
            <div className="control-actions">
              <button className="btn" onClick={() => run('testTimer')} disabled={!timer?.connected || timer.state !== 'idle'}>
                Start lane test
              </button>
              {timer?.kind === 'simulator' && timer.testing && timer.state === 'armed' && (
                <button className="btn btn-go btn-sm" onClick={() => run('simulateGate')}>
                  Open gate (simulated)
                </button>
              )}
              {timer?.testing && (
                <button className="btn btn-sm" onClick={() => run('cancelArm')}>
                  Cancel
                </button>
              )}
            </div>
            <Check status={laneTestOk ? 'ok' : timer?.lastLanes.length ? 'warn' : 'todo'} title="Every lane reports">
              {timer?.lastHeatId === null && timer.lastLanes.length ? (
                <div className="result-strip">
                  {timer.lastLanes.map((l) => (
                    <div key={l.lane} className={`result-chip ${l.timeSec === null ? 'chip-bad' : ''}`}>
                      <span className="lane-dot" style={{ background: laneColor(l.lane) }} />
                      Lane {l.lane}: {l.timeSec === null ? 'no finish' : `${l.timeSec.toFixed(4)} s`}
                    </div>
                  ))}
                </div>
              ) : (
                'No lane test yet.'
              )}
            </Check>
            <details className="wizard-help">
              <summary>Troubleshooting</summary>
              <ul>
                <li>"No timer answered": check the USB cable and that no other program has the COM port open. Try forcing 9600 baud on the Setup tab for older firmware.</li>
                <li>A lane never reports: check that lane's finish sensor for dust or a misaligned car; mark the lane out on the Setup tab if it cannot be fixed.</li>
                <li>Two lanes report identical times every heat: the sensors may be wired to the wrong lanes; compare with a single car per lane.</li>
              </ul>
            </details>
          </Section>
        )}

        {current === 'Roster' && (
          <Section>
            <p>Bring in the racers and dens now; check-in happens on race day at the pit crew table.</p>
            <Check status={racersOk ? 'ok' : 'todo'} title="Racers and dens loaded">
              {state.racers.length ? `${state.racers.length} racers in ${dens.length} den${dens.length === 1 ? '' : 's'}${view.groupsOfKind('class').length ? ` plus ${view.groupsOfKind('class').length} open class` : ''}.` : 'No racers yet.'}
            </Check>
            <div className="control-actions">
              <Link className="btn btn-primary" to="/coordinator/roster">
                Open the roster (import a CSV or type names)
              </Link>
              {state.racers.length === 0 && (
                <button className="btn" onClick={() => run('seedDemo')}>
                  Load a demo pack
                </button>
              )}
            </div>
          </Section>
        )}

        {current === 'Dry run' && (
          <Section>
            <p>Run one heat end to end with the simulator so you have seen the whole thing on the projector before the scouts arrive: welcome slide, title card, spotlight, countdown, live times, replay, standings.</p>
            <ol className="wizard-list">
              <li>Timer step: choose Simulator.</li>
              <li>Race tab: Start race, Arm timer, Start countdown, Open gate (simulated).</li>
              <li>Watch the projector. Then Setup tab › Reset races, keep roster.</li>
            </ol>
            <Check status={statuses['Dry run']} title="At least one heat has been run">
              {statuses['Dry run'] === 'ok' ? 'A heat has been recorded. Remember to reset races before the real event.' : 'No heat run yet.'}
            </Check>
            <div className="control-actions">
              <Link className="btn btn-primary" to="/coordinator">
                Go to the Race tab
              </Link>
            </div>
          </Section>
        )}

        {current === 'Done' && (
          <Section>
            <ul className="wizard-summary">
              {STEPS.filter((s) => s !== 'Done').map((s) => (
                <li key={s} className={`status-${statuses[s]}`}>
                  <span className="wizard-dot" /> {s}
                </li>
              ))}
            </ul>
            <p className="muted small">Amber items are worth a second look but will not stop the race. Replay is optional.</p>
            <div className="control-actions">
              <button className="btn btn-primary" onClick={() => run('setWizardDone', { done: true })}>
                Mark setup complete
              </button>
              <Link className="btn" to="/coordinator">
                Race tab
              </Link>
            </div>
          </Section>
        )}

        <footer className="wizard-nav">
          <button className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            ‹ Back
          </button>
          <span className={`pill ${statuses[current] === 'ok' ? 'pill-ok' : statuses[current] === 'warn' ? 'pill-armed' : ''}`}>{statuses[current] === 'ok' ? 'verified' : statuses[current] === 'warn' ? 'needs attention' : 'not yet'}</span>
          <button className="btn btn-primary" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === STEPS.length - 1}>
            Next ›
          </button>
        </footer>
      </section>
    </main>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <div className="wizard-section">{children}</div>;
}

function Check({ status, title, children }: { status: Status; title: string; children: ReactNode }) {
  return (
    <div className={`wizard-check status-${status}`}>
      <span className="wizard-dot" />
      <div>
        <strong>{title}</strong>
        <div className="small">{children}</div>
      </div>
    </div>
  );
}
