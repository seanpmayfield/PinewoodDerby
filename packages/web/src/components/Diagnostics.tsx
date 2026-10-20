import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { useDerby } from '../lib/derby.tsx';
import { fetchDiagnostics } from '../lib/connection.ts';
import type { Diagnostics as ServerDiagnostics } from '../lib/types.ts';
import { all, clear, deviceId, environment, featureChecks, fontChecks, layoutSnapshot, measureFps, record, reportText, sendReport, subscribe } from '../lib/diag.ts';
import { describe } from './Feedback.tsx';

const OPEN_KEY = 'derby.diagOpen';

/**
 * The hidden diagnostics panel. Opened with Ctrl+Shift+D, five quick taps
 * on the feedback button, or a #diag in the address; it stays open across
 * screens and reloads until closed. It shows what this browser can and
 * cannot do, keeps a running log of errors, connection changes and the
 * tester's own notes while they reproduce a problem, and hands the whole
 * thing over as text: copied, downloaded, or sent to the race laptop.
 */
export function Diagnostics() {
  const { pathname, search } = useLocation();
  const { state, view, timer, connected } = useDerby();
  const [open, setOpen] = useState(() => readOpen() || location.hash === '#diag');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [server, setServer] = useState<ServerDiagnostics | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showChecks, setShowChecks] = useState(false);
  const entries = useSyncExternalStore(subscribe, all, all);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('derby:diagnostics', toggle);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('derby:diagnostics', toggle);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (open) {
      record('nav', `${pathname}${search}`);
      fetchDiagnostics().then(setServer).catch(() => setServer(null));
    }
  }, [open, pathname, search]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [entries, open]);

  const addNote = useCallback(() => {
    const text = note.trim();
    if (!text) return;
    record('note', text);
    setNote('');
  }, [note]);

  const snapshot = () => {
    record('snapshot', `on ${pathname}: ${describe(state, view, timer, server, pathname, search).replace(/\n/g, ' · ')}`);
    record('snapshot', `layout:\n${layoutSnapshot()}`);
    flash('Captured what is on screen.');
  };

  const fps = async () => {
    setBusy('fps');
    const r = await measureFps();
    record('fps', `${r.fps} fps over 3 s, ${r.longFrames} slow frames, on ${pathname}`);
    setBusy(null);
  };

  const buildReport = () => {
    const extra = [
      '',
      '--- checks ---',
      ...featureChecks().map((f) => `${f.ok ? 'ok  ' : 'MISSING'} ${f.name}`),
      ...fontChecks().map((f) => `${f.ok ? 'ok  ' : 'MISSING'} font ${f.name}`),
      '',
      '--- now ---',
      describe(state, view, timer, server, pathname, search),
    ];
    return reportText(extra);
  };

  const flash = (text: string) => {
    setStatus(text);
    setTimeout(() => setStatus(null), 3000);
  };

  const copy = async () => {
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
      flash('Report copied.');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      flash('Report copied.');
    }
  };

  const download = () => {
    const blob = new Blob([buildReport()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `derby-report-${deviceId()}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const send = async () => {
    setBusy('send');
    try {
      const file = await sendReport(buildReport());
      flash(`Saved on the race computer as reports\\${file}.`);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not send.');
    }
    setBusy(null);
  };

  if (!open || pathname.startsWith('/print')) return null;

  const missing = featureChecks().filter((f) => !f.ok);
  const missingFonts = fontChecks().filter((f) => !f.ok);
  const errors = entries.filter((e) => e.kind === 'error' || e.kind === 'net').length;

  return (
    <aside className="dg" role="dialog" aria-label="Diagnostics">
      <header className="dg-head">
        <b>Diagnostics</b>
        <span className={`dg-dot ${connected ? 'is-on' : ''}`} title={connected ? 'connected' : 'not connected'} />
        <span className="dg-meta">
          {deviceId()} · {server?.build ? `build ${server.build.slice(0, 7)}` : 'no server'} · {errors} error{errors === 1 ? '' : 's'}
        </span>
        <button className="dg-x" onClick={() => setOpen(false)} title="Close (Ctrl+Shift+D)">
          ×
        </button>
      </header>

      <div className="dg-env">
        {environment().split('\n').slice(0, 3).map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        <button className="dg-link" onClick={() => setShowChecks((s) => !s)}>
          {missing.length + missingFonts.length === 0 ? 'All browser checks pass' : `${missing.length} feature${missing.length === 1 ? '' : 's'} and ${missingFonts.length} font${missingFonts.length === 1 ? '' : 's'} missing`}
          {showChecks ? ' ▴' : ' ▾'}
        </button>
        {showChecks && (
          <ul className="dg-checks">
            {featureChecks().map((f) => (
              <li key={f.name} className={f.ok ? 'is-ok' : 'is-bad'}>
                {f.name}
              </li>
            ))}
            {fontChecks().map((f) => (
              <li key={f.name} className={f.ok ? 'is-ok' : 'is-bad'}>
                font: {f.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="dg-tools">
        <button onClick={snapshot}>Looks wrong here</button>
        <button onClick={fps} disabled={busy === 'fps'}>
          {busy === 'fps' ? 'Measuring…' : 'Measure smoothness'}
        </button>
      </div>

      <form
        className="dg-note"
        onSubmit={(e) => {
          e.preventDefault();
          addNote();
        }}
      >
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type what you see, press Enter" />
        <button type="submit" disabled={!note.trim()}>
          Add
        </button>
      </form>

      <div className="dg-log" ref={logRef}>
        {entries.length === 0 && <div className="dg-empty">Nothing logged yet. Walk through the screens; errors and your notes collect here.</div>}
        {entries.slice(-150).map((e, i) => (
          <div key={`${e.at}-${i}`} className={`dg-row is-${e.kind}`}>
            <span className="dg-time">{e.at.slice(11, 19)}</span>
            <span className="dg-kind">{e.kind}</span>
            <span className="dg-text">{e.kind === 'snapshot' ? summarizeSnapshot(e.text) : e.text}</span>
          </div>
        ))}
      </div>

      <footer className="dg-actions">
        <button onClick={send} disabled={busy === 'send'} title="Save the report on the computer running the race">
          {busy === 'send' ? 'Sending…' : 'Send to race computer'}
        </button>
        <button onClick={copy}>Copy</button>
        <button onClick={download}>Download</button>
        <button
          className="dg-clear"
          onClick={() => {
            if (window.confirm('Clear the diagnostics log on this device?')) clear();
          }}
        >
          Clear
        </button>
      </footer>
      {status && <div className="dg-status">{status}</div>}
    </aside>
  );
}

/** The log shows a one-line stand-in for a snapshot; the full text goes in the report. */
function summarizeSnapshot(text: string): string {
  if (text.startsWith('layout:')) return `layout captured (${text.split('\n').length - 1} elements)`;
  const screen = text.match(/screen: ([^·]+)/)?.[1]?.trim();
  return `state captured${screen ? ` on ${screen}` : ''}`;
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}
