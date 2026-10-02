import { NavLink, Route, Routes } from 'react-router-dom';
import { useDerby } from '../lib/derby.tsx';
import { RaceTab } from './coordinator/RaceTab.tsx';
import { RosterTab } from './coordinator/RosterTab.tsx';
import { SetupTab } from './coordinator/SetupTab.tsx';
import { AudienceTab } from './coordinator/AudienceTab.tsx';
import { ReplayCaptureProvider } from '../replay/ReplayCaptureContext.tsx';
import { WizardTab } from './coordinator/WizardTab.tsx';

export function Coordinator() {
  return (
    <ReplayCaptureProvider>
      <CoordinatorInner />
    </ReplayCaptureProvider>
  );
}

function CoordinatorInner() {
  const { state, timer, connected } = useDerby();
  if (!state) return <main className="loading">Connecting to the race server…</main>;

  const camFresh = !!timer?.replayCamAt && Date.now() - timer.replayCamAt < 15_000;
  const replayCamPill = !camFresh
    ? { cls: 'pill-off', label: 'replay cam off' }
    : timer?.replayCamState === 'no-camera'
      ? { cls: 'pill-off', label: 'replay cam: no camera' }
      : timer?.replayCamState === 'recording'
        ? { cls: 'pill-racing', label: 'replay recording' }
        : { cls: 'pill-ok', label: 'replay cam ready' };

  const timerLabel = !timer
    ? 'timer ?'
    : !timer.connected
      ? 'timer offline'
      : timer.state === 'racing'
        ? 'racing'
        : timer.state === 'armed'
          ? 'armed'
          : timer.kind === 'simulator'
            ? 'simulator ready'
            : 'timer ready';

  return (
    <div className="coordinator">
      <header className="topbar">
        <div className="topbar-title">
          <span className="wordmark">Race Coordinator</span>
          <span className="topbar-event">{state.name}</span>
        </div>
        <nav className="tabs">
          {/* Absolute paths: relative links inside a splat route resolve against the
              current sub-path in React Router 7, so "setup" from /coordinator/roster
              would become /coordinator/roster/setup. */}
          <NavLink to="/coordinator" end>
            Race
          </NavLink>
          <NavLink to="/coordinator/roster">Roster</NavLink>
          <NavLink to="/coordinator/audience">Audience</NavLink>
          <NavLink to="/coordinator/setup">Setup</NavLink>
          <NavLink to="/coordinator/wizard">Wizard</NavLink>
        </nav>
        <div className="topbar-status">
          <span className={`pill ${replayCamPill.cls}`} title="The replay camera: this computer's webcam (Audience tab) or the /replay page">
            {replayCamPill.label}
          </span>
          <span className={`pill pill-${timer?.state ?? 'idle'} ${timer?.connected ? '' : 'pill-off'}`}>{timerLabel}</span>
          <span className={`pill ${connected ? 'pill-ok' : 'pill-off'}`}>{connected ? 'live' : 'offline'}</span>
        </div>
      </header>
      <Routes>
        <Route index element={<RaceTab />} />
        <Route path="roster" element={<RosterTab />} />
        <Route path="audience" element={<AudienceTab />} />
        <Route path="setup" element={<SetupTab />} />
        <Route path="wizard" element={<WizardTab />} />
      </Routes>
    </div>
  );
}
