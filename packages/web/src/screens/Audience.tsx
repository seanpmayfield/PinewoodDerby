import { useEffect, useMemo, useRef, useState } from 'react';
import { useDerby } from '../lib/derby.tsx';
import { carInfo } from '../lib/format.ts';
import { deriveMode, type AudienceMode } from '../audience/mode.ts';
import { useSounds } from '../audience/useSounds.ts';
import { Confetti } from '../audience/Confetti.tsx';
import { AwardsView, HeatView, ReplayView, StandingsView, WelcomeView } from '../audience/views.tsx';
import { countdownLit, IntroView, SpotlightView, TreeView } from '../audience/stage.tsx';
import '../audience/audience.css';
import '../audience/themes.css';
import { DEFAULT_THEME } from '../audience/themes.ts';
import { SponsorsView } from '../audience/Sponsors.tsx';

/**
 * The projector screen. No controls: it follows the race automatically and
 * the coordinator can override it (welcome, standings, awards).
 */
export function Audience() {
  const { state, view, timer, connected } = useDerby();
  const [now, setNow] = useState(() => Date.now());
  const [started, setStarted] = useState(false);
  const [burst, setBurst] = useState(0);
  const sounds = useSounds(state?.presentation.soundEnabled ?? true);

  // 100 ms ticks keep the light tree crisp; everything else is cheap to re-derive.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const mode: AudienceMode | null = useMemo(() => (state && view ? deriveMode(state, view, timer, now) : null), [state, view, timer, now]);

  // Anchor the countdown to this screen's clock at the moment it arrived, so a
  // projector laptop whose clock differs from the server still shows every light.
  const anchor = useRef<{ serverStartedAt: number; local: number } | null>(null);
  const serverStartedAt = timer?.countdown?.startedAt ?? null;
  if (serverStartedAt === null) anchor.current = null;
  else if (anchor.current?.serverStartedAt !== serverStartedAt) anchor.current = { serverStartedAt, local: Date.now() };
  const countdownStart = anchor.current?.local ?? now;

  // Sound and confetti cues on transitions.
  const prev = useRef<{ key: string; lanes: number; revealed: number; lit: number; prevKind: string }>({ key: '', lanes: 0, revealed: 0, lit: 0, prevKind: '' });
  useEffect(() => {
    if (!mode || !state) return;
    const key = modeKey(mode);
    const lanes = mode.kind === 'racing' && timer ? timer.liveLanes.length : 0;
    const revealed = state.presentation.revealedAwardIds.length;
    const lit = mode.kind === 'countdown' ? countdownLit(Math.max(0, now - countdownStart), mode.lights, mode.intervalMs, mode.stageMs) : 0;
    const p = prev.current;
    if (key !== p.key) {
      if (mode.kind === 'lineup') sounds.play('attention');
      if (mode.kind === 'intro') {
        sounds.play('fanfare');
        setBurst((b) => b + 1);
      }
      if (mode.kind === 'armed') sounds.play('spotlight');
      // After a countdown the green light already played; only sting a surprise start.
      if (mode.kind === 'racing' && p.prevKind !== 'countdown') sounds.play('start');
      if (mode.kind === 'result') {
        sounds.play('result');
        setBurst((b) => b + 1);
      }
      if (mode.kind === 'awards' && p.key !== '') sounds.play('fanfare');
    } else if (mode.kind === 'racing' && lanes > p.lanes) {
      sounds.play(lanes === 1 ? 'win' : 'lane');
    }
    if (mode.kind === 'awards' && revealed > p.revealed && p.key === key) {
      sounds.play('reveal');
      setBurst((b) => b + 1);
    }
    if (mode.kind === 'countdown' && lit > p.lit) sounds.play(lit > mode.lights ? 'go' : 'light');
    prev.current = { key, lanes, revealed, lit, prevKind: key !== p.key ? p.key.split(':')[0]! : p.prevKind };
  }, [mode, timer, state, sounds, now, countdownStart]);

  const start = () => {
    sounds.unlock();
    setStarted(true);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (!state || !view || !mode) return <div className="aud aud-loading">Connecting…</div>;

  return (
    <div className="aud" data-theme={state.presentation.theme || DEFAULT_THEME} onDoubleClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()}>
      <header className="aud-header">
        <div className="aud-header-left">
          <span className="aud-flag" />
          <span className="aud-event">{state.name}</span>
        </div>
        <div className="aud-header-right">
          {!connected && <span className="aud-offline">reconnecting</span>}
          <Clock now={now} />
        </div>
      </header>

      <main className="aud-stage" key={modeKey(mode)}>
        {mode.kind === 'welcome' && <WelcomeView />}
        {mode.kind === 'intro' && <IntroView round={mode.round} />}
        {(mode.kind === 'lineup' || mode.kind === 'racing' || mode.kind === 'result') && (
          <HeatView round={mode.round} heat={mode.heat} phase={mode.kind} timer={timer} />
        )}
        {mode.kind === 'replay' && <ReplayView round={mode.round} heat={mode.heat} />}
        {mode.kind === 'armed' && <SpotlightView round={mode.round} heat={mode.heat} />}
        {mode.kind === 'countdown' && (
          <TreeView round={mode.round} heat={mode.heat} startedAt={countdownStart} lights={mode.lights} intervalMs={mode.intervalMs} stageMs={mode.stageMs} now={now} />
        )}
        {mode.kind === 'standings' && <StandingsView round={mode.round} final={mode.final} />}
        {mode.kind === 'awards' && <AwardsView />}
        {mode.kind === 'sponsors' && <SponsorsView />}
      </main>

      <Ticker />
      <Confetti burst={burst} intensity={mode.kind === 'awards' ? 1.6 : 0.6} />

      {!started && (
        <button className="aud-start" onClick={start}>
          <span className="aud-start-title">Start the show</span>
          <span className="aud-start-sub">Click to go full screen and enable sound</span>
        </button>
      )}
    </div>
  );
}

function modeKey(mode: AudienceMode): string {
  switch (mode.kind) {
    case 'welcome':
    case 'awards':
    case 'sponsors':
      return mode.kind;
    case 'standings':
      return `standings:${mode.round.id}`;
    case 'intro':
      return `intro:${mode.round.id}`;
    default:
      return `${mode.kind}:${mode.heat.id}`;
  }
}

function Clock({ now }: { now: number }) {
  return <span className="aud-clock">{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>;
}

/** Scrolling leaderboard strip along the bottom. */
function Ticker() {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  const round = view.activeRound() ?? state.rounds[state.rounds.length - 1];
  if (!round) return null;
  const standings = view.standings(round.id).filter((s) => s.runs > 0).slice(0, 15);
  if (standings.length === 0) return null;
  const items = standings.map((s) => {
    const info = carInfo(state, s.carId);
    return (
      <span key={s.carId} className="aud-tick">
        <b>{s.rank}</b> {info?.racerName} <i>{s.scoreLabel}</i>
      </span>
    );
  });
  return (
    <footer className="aud-ticker">
      <span className="aud-ticker-label">{round.name}</span>
      <div className="aud-ticker-track">
        <div className="aud-ticker-run">
          {items}
          {items}
        </div>
      </div>
    </footer>
  );
}
