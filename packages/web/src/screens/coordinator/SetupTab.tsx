import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FORMAT_PRESETS, TIMER_PROFILES } from '@derby/core';
import { useDerby } from '../../lib/derby.tsx';
import { fetchHistory, fetchInfo, getPin, importEvent, setPin } from '../../lib/connection.ts';
import type { BackupStatus, HistoryEntry, ServerInfo } from '../../lib/types.ts';
import { laneColor, timeAgo } from '../../lib/format.ts';
import { PhoneQr } from '../../components/PhoneQr.tsx';
import { Modal } from '../../components/Modal.tsx';

export function SetupTab() {
  const { state, run } = useDerby();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [name, setName] = useState(state?.name ?? '');
  const [date, setDate] = useState(state?.date ?? '');
  const [pin, setPinState] = useState(getPin());
  const [newRace, setNewRace] = useState(false);

  useEffect(() => {
    setName(state?.name ?? '');
    setDate(state?.date ?? '');
  }, [state?.name, state?.date]);

  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => undefined);
    fetchHistory().then(setHistory).catch(() => undefined);
  }, [state?.id, state?.rounds.length]);

  if (!state) return null;
  const started = state.rounds.length > 0;
  const s = state.settings;

  return (
    <main className="setup">
      <section className="panel new-race">
        <h2>New race</h2>
        <p className="muted small">
          Start a fresh event for the next derby. This one stays saved and can be reopened from the Events list below.
        </p>
        <button className="btn btn-primary btn-lg" onClick={() => setNewRace(true)}>
          Start a new race…
        </button>
        {newRace && <NewRaceDialog onClose={() => setNewRace(false)} />}
      </section>

      <BackupPanel initial={info?.backup ?? null} />

      <section className="panel">
        <h2>Event</h2>
        <p className="small">
          <Link to="/coordinator/wizard">Run the setup wizard</Link> for a guided walk-through with live checks.
        </p>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== state.name && run('updateDerby', { patch: { name } })} />
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => date !== state.date && run('updateDerby', { patch: { date } })} />
        </label>
        <label className="field">
          <span>Lanes</span>
          <select value={state.laneCount} disabled={started} onChange={(e) => run('updateDerby', { patch: { laneCount: Number(e.target.value) } })}>
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <h3>Lanes in service</h3>
        <div className="lane-toggles">
          {Array.from({ length: state.laneCount }, (_, i) => i + 1).map((lane) => {
            const dead = state.deadLanes.includes(lane);
            return (
              <button key={lane} className={`btn ${dead ? 'btn-warn' : ''}`} onClick={() => run('setLaneDead', { lane, dead: !dead })}>
                Lane {lane}: {dead ? 'OUT' : 'ok'}
              </button>
            );
          })}
        </div>
        <p className="muted small">Marking a lane out re-plans every heat that has not run yet.</p>
      </section>

      <section className="panel">
        <h2>Race format</h2>
        {started && <p className="warn-box">Racing has started; the format is locked.</p>}
        {FORMAT_PRESETS.map((f) => (
          <label key={f.id} className={`format-option ${state.format.id === f.id ? 'selected' : ''}`}>
            <input type="radio" name="format" checked={state.format.id === f.id} disabled={started} onChange={() => run('setFormat', { formatId: f.id })} />
            <div>
              <strong>{f.name}</strong>
              <p className="muted small">{f.description}</p>
            </div>
          </label>
        ))}
        {state.format.id === 'custom' && <p className="muted small">Custom format in use.</p>}
      </section>

      <section className="panel">
        <h2>Racing rules</h2>
        <label className="field">
          <span>Re-run placement</span>
          <select value={s.rerunPlacement} onChange={(e) => run('updateSettings', { patch: { rerunPlacement: e.target.value } })}>
            <option value="next">Immediately next</option>
            <option value="end">End of the round</option>
          </select>
        </label>
        <NumberField label="DNF time (s)" value={s.dnfTimeSec} step={0.0001} onCommit={(v) => run('updateSettings', { patch: { dnfTimeSec: v } })} />
        <NumberField label="Heat timeout (s)" value={s.heatTimeoutSec} step={1} onCommit={(v) => run('updateSettings', { patch: { heatTimeoutSec: v } })} />
        <NumberField label="Max weight (oz)" value={s.maxWeightOz} step={0.01} onCommit={(v) => run('updateSettings', { patch: { maxWeightOz: v } })} />
        <label className="field check">
          <input type="checkbox" checked={s.requireInspectionPass} onChange={(e) => run('updateSettings', { patch: { requireInspectionPass: e.target.checked } })} />
          <span>Only cars that passed inspection can race</span>
        </label>
      </section>

      <TimerPanel />

      <section className="panel">
        <h2>Network</h2>
        <p className="muted small">Open these on phones and the projector laptop while on the hotspot.</p>
        <ul className="urls">
          {(info?.urls ?? []).map((u) => (
            <li key={u}>
              <code>{u}</code>
            </li>
          ))}
          {info && info.urls.length === 0 && <li className="muted">No network address found.</li>}
        </ul>
        <PhoneQr size={96} compact />
        {info?.secureAvailable && (
          <p className="muted small">
            Secure address for phone cameras: {info.httpsUrls.map((u) => <code key={u}>{u}</code>)} (each phone opens{' '}
            <a href="/phone" target="_blank" rel="noreferrer">
              /phone
            </a>{' '}
            once to trust the certificate).
          </p>
        )}
        <p className="muted small">{info ? `${info.clients} screen${info.clients === 1 ? '' : 's'} connected.` : ''}</p>
        <h3>PINs</h3>
        <p className="muted small">
          With a coordinator PIN set, every change from any screen needs a PIN. The crew PIN only allows check-in, the pit table and judging, so volunteers' phones cannot touch the race. Screens
          ask for a PIN the first time they need one and remember it.
        </p>
        <PinFields coordinatorSet={!!info?.pinRequired} crewSet={!!info?.crewPinSet} onSaved={() => fetchInfo().then(setInfo).catch(() => undefined)} />
        <label className="field">
          <span>This screen's PIN</span>
          <input
            value={pin}
            onChange={(e) => {
              setPinState(e.target.value);
              setPin(e.target.value);
            }}
            placeholder={info?.pinRequired ? 'Coordinator PIN' : 'No PIN needed'}
          />
        </label>
      </section>

      <section className="panel">
        <h2>Events</h2>
        <ul className="derby-list">
          {(info?.derbies ?? []).map((d) => (
            <li key={d.id}>
              <span>
                <strong>{d.name}</strong> <span className="muted small">{d.date}</span>
              </span>
              {d.id === state.id ? (
                <span className="muted small">current</span>
              ) : (
                <button className="btn btn-sm" onClick={() => run('loadDerby', { id: d.id })}>
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="muted small">Another event? Use "Start a new race" at the top of this page.</p>

        <h3>Start over</h3>
        <p className="muted small">Clears every round, result, replay and award winner and puts the welcome slide back. Roster, check-ins, weights, inspections and photos stay.</p>
        <button
          className="btn btn-warn"
          onClick={() => confirm('Reset all races for this event? The roster is kept. Results are gone for good (a snapshot stays in history below).') && run('resetRaces')}
        >
          Reset races, keep roster
        </button>

        <h3>Restore an earlier state</h3>
        <p className="muted small">Every change is snapshotted. Restoring makes that snapshot the current state (the newer ones stay in history).</p>
        <ul className="history-list">
          {history.slice(0, 25).map((h) => (
            <li key={h.id}>
              <span>
                {h.change} <span className="muted small">{timeAgo(h.createdAt)}</span>
              </span>
              <button className="btn btn-sm" onClick={() => confirm('Restore this snapshot?') && run('restoreHistory', { historyId: h.id })}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/** Create the next event: name, date, and optionally last time's roster. Opens the wizard afterwards. */
function NewRaceDialog({ onClose }: { onClose: () => void }) {
  const { state, run } = useDerby();
  const navigate = useNavigate();
  const year = new Date().getFullYear();
  const suggested = state ? state.name.replace(/\b(19|20)\d{2}\b/, String(year)) : `Pinewood Derby ${year}`;
  const [name, setName] = useState(suggested === state?.name ? `${suggested} ${year}` : suggested);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [copyRoster, setCopyRoster] = useState(false);
  const [busy, setBusy] = useState(false);
  const racers = state?.racers.length ?? 0;
  const create = async () => {
    if (!name.trim() || !state) return;
    setBusy(true);
    const id = await run<string>('newDerby', { name: name.trim(), date, laneCount: state.laneCount, copyRosterFrom: copyRoster ? state.id : undefined });
    setBusy(false);
    if (id) {
      onClose();
      navigate('/coordinator/wizard');
    }
  };
  return (
    <Modal title="Start a new race" onClose={onClose}>
      <p className="muted small">
        The current event, <strong>{state?.name}</strong>, is kept with all its results. The new one starts on the welcome slide.
      </p>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field check">
        <input type="checkbox" checked={copyRoster} disabled={racers === 0} onChange={(e) => setCopyRoster(e.target.checked)} />
        <span>
          Copy the roster from {state?.name} ({racers} racer{racers === 1 ? '' : 's'}: dens, names, car numbers and names; no results, check-ins, weights or photos)
        </span>
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={create}>
          Create and open the setup wizard
        </button>
      </div>
    </Modal>
  );
}

/** Export, import and the automatic USB backup. */
function BackupPanel({ initial }: { initial: BackupStatus | null }) {
  const { state, backup: live, run, notify } = useDerby();
  const backup = live ?? initial;
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'copy' | 'replace'>('copy');
  const [busy, setBusy] = useState(false);
  if (!state) return null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (mode === 'replace' && !confirm(`Replace the saved copy of the event inside "${file.name}" with the file's contents? Anything done since that export is lost.`)) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setBusy(true);
    try {
      const result = await importEvent(file, mode);
      notify('info', `Imported "${result.name}" and opened it${result.media ? ` (${result.media} media files)` : ''}.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="panel backup">
      <h2>Backup</h2>
      <p className="muted small">Everything saves to disk as it happens. This is for keeping a copy somewhere else, or moving the event to another computer.</p>

      <h3>Export</h3>
      <p className="muted small">One zip with the event, its photos, scout videos and replay clips. Import it on any computer running this program.</p>
      <a className="btn" href="/api/export" download>
        Download this event as a zip
      </a>

      <h3>Import</h3>
      <div className="field-row import-row">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'copy' | 'replace')}>
          <option value="copy">Open as a separate event</option>
          <option value="replace">Replace the saved event it came from</option>
        </select>
        <input ref={fileRef} type="file" accept=".zip,application/zip" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      <h3>USB stick</h3>
      {backup && !backup.supported && <p className="muted small">Automatic USB backup only runs on Windows.</p>}
      {backup && backup.supported && (
        <>
          <label className="field check">
            <input type="checkbox" checked={backup.enabled} onChange={(e) => run('setUsbBackup', { enabled: e.target.checked })} />
            <span>Copy the event to any USB stick that is plugged in, a few seconds after every change</span>
          </label>
          <p className="small backup-status">
            {backup.drives.length === 0 ? (
              <span className="muted">No USB stick plugged in. Plug one in and the first copy is written straight away.</span>
            ) : (
              <>
                <span className="ok">Stick found: {backup.drives.join(', ')}</span>
                {backup.busy ? ' · writing…' : backup.pending ? ' · change waiting to be written' : ''}
              </>
            )}
            {backup.lastAt && (
              <>
                <br />
                Last copy {timeAgo(backup.lastAt)} to <code>{backup.lastPath}</code>
              </>
            )}
            {backup.lastError && (
              <>
                <br />
                <span className="bad">Last attempt failed: {backup.lastError}</span>
              </>
            )}
          </p>
          <p className="muted small">A dated copy is also kept every half hour. Nothing on the stick is ever deleted.</p>
        </>
      )}
    </section>
  );
}

function TimerPanel() {
  const { timer, run } = useDerby();
  const [port, setPort] = useState<string>('');
  const [baud, setBaud] = useState<string>('');
  useEffect(() => {
    if (timer) {
      setPort(timer.port ?? '');
      setBaud(timer.baud ? String(timer.baud) : '');
    }
  }, [timer?.port, timer?.baud]);
  if (!timer) {
    return (
      <section className="panel">
        <h2>Timer</h2>
        <p className="muted">No timer status yet.</p>
      </section>
    );
  }
  const isSim = timer.kind === 'simulator';
  const chosen = TIMER_PROFILES.find((p) => p.key === timer.kind);
  const statusText = timer.connecting ? (timer.kind === 'auto' ? 'looking for a timer…' : 'connecting…') : timer.connected ? (timer.verified ? 'connected' : 'port open, timer not answering') : 'offline';
  const busy = timer.state !== 'idle';

  return (
    <section className="panel">
      <h2>Timer</h2>
      <label className="field">
        <span>Timer</span>
        <select value={timer.kind} onChange={(e) => run('configureTimer', { kind: e.target.value })} disabled={busy}>
          <option value="simulator">Simulator (rehearsal, no hardware)</option>
          <option value="auto">Auto-detect any known timer</option>
          {TIMER_PROFILES.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
              {p.prober ? '' : ' (pick the port by hand)'}
            </option>
          ))}
        </select>
      </label>
      <p className="timer-status">
        <span className={`pill ${timer.connected ? (timer.verified ? 'pill-ok' : 'pill-armed') : 'pill-off'}`}>{statusText}</span>
        {timer.profile && !isSim && <span className="muted small"> {timer.profile.name}</span>}
        {timer.port && (
          <span className="muted small">
            {' '}
            on {timer.port} @ {timer.baud}
          </span>
        )}
        {timer.identity && <span className="muted small"> · {timer.identity}</span>}
        {timer.lanesDetected !== null && <span className="muted small"> · {timer.lanesDetected} lanes</span>}
      </p>
      {chosen?.notes && <p className="muted small">{chosen.notes}</p>}
      {timer.lastError && <p className="warn-box">{timer.lastError}</p>}

      {!isSim && (
        <>
          <label className="field">
            <span>Port</span>
            <span className="field-row">
              <select value={port} onChange={(e) => setPort(e.target.value)}>
                <option value="">Auto-detect</option>
                {timer.ports.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path}
                    {p.likelyTimer ? ' ★ timer' : ''}
                    {p.friendlyName ? ` – ${p.friendlyName}` : p.manufacturer ? ` – ${p.manufacturer}` : ''}
                  </option>
                ))}
                {port && !timer.ports.some((p) => p.path === port) && <option value={port}>{port}</option>}
              </select>
              <button className="btn btn-sm" onClick={() => run('listSerialPorts')}>
                Rescan
              </button>
            </span>
          </label>
          <label className="field">
            <span>Baud</span>
            <select value={baud} onChange={(e) => setBaud(e.target.value)}>
              <option value="">The timer's usual rate{chosen ? ` (${chosen.params.baud})` : ''}</option>
              <option value="19200">19200</option>
              <option value="9600">9600</option>
              <option value="4800">4800</option>
              <option value="1200">1200</option>
            </select>
          </label>
          <div className="control-actions">
            <button className="btn btn-primary" onClick={() => run('configureTimer', { port: port || null, baud: baud ? Number(baud) : null })} disabled={busy}>
              Connect
            </button>
            <button className="btn btn-sm" onClick={() => run('identifyTimer')} disabled={!timer.connected || busy}>
              Identify
            </button>
            {timer.remoteStart && (
              <button className="btn btn-sm" onClick={() => run('remoteStartTimer')} disabled={!timer.connected || timer.state !== 'armed'} title="Open the gate from the timer's own release">
                Open gate
              </button>
            )}
          </div>
          <p className="muted small">
            The timer shows up as a COM port (★ marks a USB bridge a known timer uses). With Auto-detect the server probes every port for every timer it knows, which takes a few seconds. A timer marked
            "pick the port by hand" never answers a probe, so choose its port here and press Connect. The timer protocols come from the DerbyNet project; see the README.
          </p>
        </>
      )}

      <h3>Lane test</h3>
      <p className="muted small">Arms the timer for every lane with no heat attached. Roll a car down each lane and confirm all lanes report.</p>
      <div className="control-actions">
        {!timer.testing ? (
          <button className="btn" onClick={() => run('testTimer')} disabled={!timer.connected || busy}>
            Start lane test
          </button>
        ) : (
          <>
            <span className="waiting">{timer.state === 'racing' ? 'Cars running…' : 'Armed, waiting for the gate…'}</span>
            {isSim && timer.state === 'armed' && (
              <button className="btn btn-go btn-sm" onClick={() => run('simulateGate')}>
                Open gate (simulated)
              </button>
            )}
            <button className="btn btn-sm" onClick={() => run('cancelArm')}>
              Cancel
            </button>
          </>
        )}
      </div>
      {(timer.liveLanes.length > 0 || (timer.lastHeatId === null && timer.lastLanes.length > 0)) && (
        <div className="result-strip">
          {(timer.liveLanes.length ? timer.liveLanes : timer.lastLanes).map((l) => (
            <div key={l.lane} className={`result-chip ${l.timeSec === null ? 'chip-bad' : ''}`}>
              <span className="lane-dot" style={{ background: laneColor(l.lane) }} />
              Lane {l.lane}: {l.timeSec === null ? 'no finish' : `${l.timeSec.toFixed(4)} s`}
            </div>
          ))}
        </div>
      )}

      <pre className="log">{timer.log.join('\n') || 'no traffic yet'}</pre>
    </section>
  );
}

function PinFields({ coordinatorSet, crewSet, onSaved }: { coordinatorSet: boolean; crewSet: boolean; onSaved: () => void }) {
  const { run } = useDerby();
  const [coordinator, setCoordinator] = useState('');
  const [crew, setCrew] = useState('');
  const save = async (patch: { coordinator?: string | null; crew?: string | null }) => {
    const ok = await run('setPins', { patch });
    if (ok !== undefined) {
      if (patch.coordinator !== undefined) {
        setCoordinator('');
        // The coordinator's own screen keeps working with the new PIN.
        if (patch.coordinator) setPin(patch.coordinator);
      }
      if (patch.crew !== undefined) setCrew('');
      onSaved();
    }
  };
  return (
    <>
      <label className="field">
        <span>Coordinator PIN {coordinatorSet ? '(set)' : '(none)'}</span>
        <span className="field-row">
          <input value={coordinator} onChange={(e) => setCoordinator(e.target.value)} placeholder={coordinatorSet ? 'New PIN' : 'Set a PIN'} />
          <button className="btn btn-sm" onClick={() => save({ coordinator: coordinator.trim() || null })} disabled={!coordinator.trim() && !coordinatorSet}>
            {coordinator.trim() ? 'Set' : 'Clear'}
          </button>
        </span>
      </label>
      <label className="field">
        <span>Crew PIN {crewSet ? '(set)' : '(none)'}</span>
        <span className="field-row">
          <input value={crew} onChange={(e) => setCrew(e.target.value)} placeholder={crewSet ? 'New PIN' : 'Set a PIN'} />
          <button className="btn btn-sm" onClick={() => save({ crew: crew.trim() || null })} disabled={!crew.trim() && !crewSet}>
            {crew.trim() ? 'Set' : 'Clear'}
          </button>
        </span>
      </label>
    </>
  );
}

function NumberField({ label, value, step, onCommit }: { label: string; value: number; step: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number(text);
          if (Number.isFinite(v) && v !== value) onCommit(v);
          else setText(String(value));
        }}
      />
    </label>
  );
}
