import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Derby, DerbyEngine } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { fetchDiagnostics } from '../lib/connection.ts';
import type { Diagnostics, TimerStatus } from '../lib/types.ts';
import { CAMERA_OK, carInfo } from '../lib/format.ts';
import { deriveMode } from '../audience/mode.ts';
import { recentEvents } from '../lib/errors.ts';

const TO = 'seanpmayfield@gmail.com';
const SUBJECT = 'Pinewood Derby Feedback';
const KINDS = ['Issue', 'Comment', 'Suggestion'] as const;

/**
 * A "Report feedback" button on every screen while the program is being
 * tried out. It composes an email in the user's own mail app: their words,
 * then a block of details about where they were and what the program was
 * doing, which the developer pastes back for diagnosis.
 */
export function Feedback() {
  const { pathname, search } = useLocation();
  const { state, view, timer } = useDerby();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('Issue');
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOpened(false);
    setCopied(false);
    fetchDiagnostics()
      .then(setDiag)
      .catch(() => setDiag(null));
  }, [open]);

  const details = useMemo(() => (open ? describe(state, view, timer, diag, pathname, search) : ''), [open, state, view, timer, diag, pathname, search]);
  if (pathname.startsWith('/print')) return null;

  const body = `${SUBJECT}\nType: ${kind}${name.trim() ? `\nFrom: ${name.trim()}` : ''}\n\n${comment.trim() || '(no comment)'}\n\n--- details ---\n${details}`;
  const mailto = `mailto:${TO}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(body).replace(/%0A/g, '%0D%0A')}`;
  const ready = comment.trim().length > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      const area = document.createElement('textarea');
      area.value = body;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      setCopied(true);
    }
  };

  return (
    <>
      <button className="fb-button" onClick={() => setOpen(true)} title="Report an issue, comment or suggestion">
        Report feedback
      </button>
      {open && (
        <div className="fb-backdrop" onClick={() => setOpen(false)}>
          <div className="fb-dialog" role="dialog" aria-label="Report feedback" onClick={(e) => e.stopPropagation()}>
            <h2>Report feedback</h2>
            <p className="fb-sub">Opens an email to the developer in your mail app. Attach screenshots to it if they help.</p>
            <div className="fb-kinds">
              {KINDS.map((k) => (
                <label key={k} className={kind === k ? 'is-on' : ''}>
                  <input type="radio" name="fb-kind" checked={kind === k} onChange={() => setKind(k)} />
                  {k}
                </label>
              ))}
            </div>
            <textarea
              className="fb-text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={kind === 'Issue' ? 'What happened, and what did you expect?' : 'What would you like to say?'}
              rows={5}
              autoFocus
            />
            <input className="fb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" />
            <details className="fb-details">
              <summary>What will be sent with it</summary>
              <pre>{details}</pre>
            </details>
            <div className="fb-actions">
              <a className={`fb-send ${ready ? '' : 'is-off'}`} href={ready ? mailto : undefined} onClick={() => ready && setOpened(true)} aria-disabled={!ready}>
                Open email app
              </a>
              <button className="fb-copy" onClick={copy} disabled={!ready}>
                {copied ? 'Copied' : 'Copy text instead'}
              </button>
              <button className="fb-close" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            {opened && (
              <p className="fb-hint">
                If no email window appeared, use <b>Copy text instead</b> and paste it into a message to {TO}.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function screenName(pathname: string): string {
  if (pathname === '/') return 'Home';
  if (pathname.startsWith('/coordinator')) return `Coordinator, ${pathname.split('/')[2] || 'race'} tab`;
  if (pathname.startsWith('/audience')) return 'Audience screen';
  if (pathname.startsWith('/pit')) return 'Pit crew';
  if (pathname.startsWith('/judges')) return 'Judges';
  if (pathname.startsWith('/replay')) return 'Replay camera';
  if (pathname.startsWith('/phone')) return 'Phone setup';
  return pathname;
}

const yn = (v: unknown) => (v ? 'yes' : 'no');

function describe(state: Derby | null, view: DerbyEngine | null, timer: TimerStatus | null, diag: Diagnostics | null, pathname: string, search: string): string {
  const lines: string[] = [];
  lines.push(`when: ${new Date().toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  lines.push(`screen: ${screenName(pathname)} (${pathname}${search})`);
  lines.push(`page: ${window.location.origin} secure=${yn(window.isSecureContext)} camera=${yn(CAMERA_OK)} online=${yn(navigator.onLine)}`);

  const carId = pathname.match(/^\/pit\/([^/]+)/)?.[1];
  const car = carId && state ? state.cars.find((c) => c.id === carId) : undefined;
  if (car && state) {
    const info = carInfo(state, car.id);
    const shot = car.photo?.side;
    const parts = shot ? (['original', 'crop', 'cutout'] as const).filter((k) => shot[k]) : [];
    lines.push(`car: #${car.number} ${car.name ?? ''} (${info?.racerName ?? '?'}) weight=${car.weightOz ?? '-'} photo=${parts.length ? parts.join('+') : 'none'}${shot ? ` keys=${[shot.original, shot.crop, shot.cutout].filter(Boolean).join(',')}` : ''}`);
  }

  if (state) {
    const complete = state.rounds.filter((r) => r.status === 'complete').length;
    lines.push(`event: "${state.name}" cars=${state.cars.length} racers=${state.racers.length} rounds=${state.rounds.length} (${complete} complete) format=${state.format.id} lanes=${state.laneCount}`);
    const active = view?.activeRound();
    if (active && view) {
      const heat = view.currentHeat(active.id);
      lines.push(`round: "${active.name}" status=${active.status} heats=${active.heats.length}${heat ? ` current=#${heat.number} ${heat.status}` : ''}`);
    }
    const p = state.presentation;
    const showing = view ? deriveMode(state, view, timer, Date.now()).kind : '?';
    lines.push(`audience: theme=${p.theme} mode=${p.mode} stage=${p.stage} showing=${showing} sound=${yn(p.soundEnabled)}`);
  } else {
    lines.push('event: (no state loaded)');
  }

  if (timer) {
    lines.push(`timer: ${timer.kind} state=${timer.state} connected=${yn(timer.connected)} port=${timer.port ?? '-'} verified=${yn(timer.verified)} replayCam=${timer.replayCamState ?? '-'} lastError=${timer.lastError ?? '-'}`);
  }

  lines.push(`device: ${navigator.userAgent}`);
  lines.push(`display: ${screen.width}x${screen.height} @${window.devicePixelRatio} viewport=${window.innerWidth}x${window.innerHeight} touch=${navigator.maxTouchPoints} lang=${navigator.language}`);

  if (diag) {
    lines.push(
      `server: ${diag.addresses.join(',') || '-'} port=${diag.port} https=${diag.httpsPort ?? 'off'} hotspot=${yn(diag.hotspot)} firewall=${diag.firewallRule === null ? '?' : yn(diag.firewallRule)} ffmpeg=${yn(diag.ffmpeg)} clients=${diag.clients.length} os=${diag.platform} node=${diag.node} build=${diag.build} up=${Math.round(diag.uptimeSec / 60)}m`,
    );
  } else {
    lines.push('server: (diagnostics not available)');
  }

  const events = recentEvents();
  if (events.length) {
    lines.push('recent:');
    for (const e of events) lines.push(`  ${e}`);
  }
  return lines.join('\n');
}
