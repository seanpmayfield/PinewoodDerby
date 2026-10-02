import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../../components/Modal.tsx';
import { fetchInfo } from '../../lib/connection.ts';
import type { Heat, Round, RoundSpec } from '@derby/core';
import type { TimerStatus } from '../../lib/types.ts';
import { useDerby } from '../../lib/derby.tsx';
import { carInfo, fmtTime, groupPath, heatStatusLabel, laneColor, ordinal, scoringLabel } from '../../lib/format.ts';
import { ManualTimes } from '../../components/ManualTimes.tsx';
import { PhoneQr } from '../../components/PhoneQr.tsx';

/** Undo labels are command names; say them the way the coordinator would. */
const UNDO_LABELS: Record<string, string> = {
  timerResult: 'timer result',
  finishHeat: 'manual times',
  amendHeat: 'time fix',
  rerunHeat: 're-run',
  confirmDnf: 'DNF',
  uploadPhoto: 'photo upload',
  uploadReplay: 'replay upload',
  uploadHeadshot: 'headshot upload',
  clearHeatReplay: 'replay removal',
  startRound: 'round schedule',
  addCarToRound: 'car added to round',
  setLaneDead: 'lane change',
  resetRaces: 'race reset',
  flowNext: 'show step',
  flowStandings: 'standings step',
  flowReset: 'show restart',
  setAwardWinner: 'award pick',
  revealNextAward: 'award reveal',
  unrevealLastAward: 'award un-reveal',
  resetCeremony: 'ceremony reset',
  generateSpeedAwards: 'speed awards',
  importRoster: 'roster import',
  setCheckedIn: 'check-in',
  setWeight: 'weigh-in',
  setInspection: 'inspection',
  withdrawCar: 'withdrawal',
};

function undoLabel(label: string): string {
  return UNDO_LABELS[label] ?? label.replace(/([A-Z])/g, ' $1').toLowerCase();
}

export function RaceTab() {
  const { state, view, timer, run, undo, redo } = useDerby();
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [manual, setManual] = useState<{ heat: Heat; mode: 'finish' | 'amend' } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const showAction = useShowAction();

  const rounds = state?.rounds ?? [];
  const activeRound = view?.activeRound();
  const stageRoundId = state?.presentation.stageRoundId ?? null;
  useEffect(() => {
    if (!selectedRoundId || !rounds.some((r) => r.id === selectedRoundId)) {
      setSelectedRoundId(stageRoundId ?? activeRound?.id ?? rounds[0]?.id ?? null);
    }
  }, [rounds, selectedRoundId, activeRound?.id, stageRoundId]);
  // When the show moves to a round, follow it.
  useEffect(() => {
    if (stageRoundId) setSelectedRoundId(stageRoundId);
  }, [stageRoundId]);

  const round = rounds.find((r) => r.id === selectedRoundId) ?? null;
  const standings = useMemo(() => (round && view ? view.standings(round.id) : []), [round, view]);
  // Keyboard shortcuts. The handler reads the latest render through a ref so
  // the listener is registered once.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  if (!state || !view) return null;

  const current = round ? view.currentHeat(round.id) : undefined;
  const onDeck = round ? view.onDeck(round.id, 2) : [];
  const order = round ? view.heatOrder(round) : [];
  const finished = round ? [...round.heats].reverse().find((h) => h.status === 'finished') : undefined;
  const position = current ? view.heatPosition(current.id) : null;

  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const modal = document.querySelector('.modal-backdrop');
    if (modal && !helpOpen) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if ((key === 'y' || (key === 'z' && e.shiftKey)) && redo) {
        e.preventDefault();
        if (confirm(`Redo ${undoLabel(redo.label)}?`)) void run('redo');
      } else if (key === 'z' && undo) {
        e.preventDefault();
        if (confirm(`Undo ${undoLabel(undo.label)}?`)) void run('undo');
      }
      return;
    }
    if (e.altKey) return;
    const onCurrent = !!current && timer?.heatId === current.id;
    const armed = onCurrent && timer?.state === 'armed';
    const racing = onCurrent && timer?.state === 'racing';
    const lane = Number.parseInt(e.key, 10);
    if (helpOpen && key !== '?' && key !== 'escape') return;
    if (key === '?') {
      setHelpOpen((v) => !v);
    } else if (key === 'escape') {
      if (helpOpen) setHelpOpen(false);
      else if (onCurrent && timer?.state !== 'racing') void run('cancelArm');
    } else if (key === 'a') {
      if (current && !onCurrent && timer?.connected && timer.state === 'idle') void run('armHeat', { heatId: current.id });
    } else if (key === ' ' || key === 's') {
      if (armed && !timer?.countdown) {
        e.preventDefault();
        void run('startCountdown');
      }
    } else if (key === 'g') {
      if (armed && timer?.kind === 'simulator') void run('simulateGate');
    } else if (key === 'enter') {
      if (onCurrent && timer && timer.missingLanes.length > 0) void run('confirmDnf');
    } else if (Number.isInteger(lane) && lane >= 1 && lane <= state.laneCount) {
      if (racing && current?.lanes[lane - 1] && !timer?.liveLanes.some((l) => l.lane === lane)) void run('markLaneDnf', { lane });
    } else if (key === 'n') {
      showAction.action?.onClick();
    } else if (key === 'z' && e.shiftKey) {
      if (redo && confirm(`Redo ${undoLabel(redo.label)}?`)) void run('redo');
    } else if (key === 'z') {
      if (undo && confirm(`Undo ${undoLabel(undo.label)}?`)) void run('undo');
    } else if (key === 'f') {
      if (finished) setManual({ heat: finished, mode: 'amend' });
    } else if (key === 'm') {
      if (current && !racing) setManual({ heat: current, mode: 'finish' });
    }
  };

  return (
    <main className="race">
      <FirstRunBanner />
      <ShowStrip onHelp={() => setHelpOpen(true)} />
      <aside className="panel rounds">
        <h2>Rounds</h2>
        {state.format.rounds.filter((spec) => spec.scope !== 'per-group' || view.groupsOfKind(spec.groupKind ?? 'den').length > 0).map((spec) => (
          <RoundGroup
            key={spec.key}
            spec={spec}
            rounds={rounds.filter((r) => r.specKey === spec.key)}
            selectedId={selectedRoundId}
            onSelect={setSelectedRoundId}
            onSchedule={() => run('startRound', { specKey: spec.key })}
          />
        ))}
        {state.deadLanes.length > 0 && (
          <p className="warn-box">Lane{state.deadLanes.length > 1 ? 's' : ''} {state.deadLanes.join(', ')} out of service.</p>
        )}
        {round && (
          <div className="control-actions intro-actions">
            <button
              className={`btn btn-sm ${state.presentation.introRoundId === round.id ? 'btn-go' : ''}`}
              onClick={() => run('setPresentation', { patch: { introRoundId: state.presentation.introRoundId === round.id ? null : round.id } })}
            >
              {state.presentation.introRoundId === round.id ? 'Intro on screen · resume' : 'Show round intro'}
            </button>
          </div>
        )}
        <h3>Phones</h3>
        <PhoneQr size={96} compact />
        {round && (
          <div className="print-links">
            <h3>Print</h3>
            <a href={`/print/heats/${round.id}`} target="_blank" rel="noreferrer">
              Heat sheet
            </a>
            <a href={`/print/standings/${round.id}`} target="_blank" rel="noreferrer">
              Standings
            </a>
            <a href="/print/roster" target="_blank" rel="noreferrer">
              Roster
            </a>
            <a href="/print/results" target="_blank" rel="noreferrer">
              Full results
            </a>
            <a href="/print/certificates" target="_blank" rel="noreferrer">
              Certificates
            </a>
          </div>
        )}
      </aside>

      <section className="panel control">
        {!round ? (
          <div className="empty">
            <h2>No round scheduled</h2>
            <p className="muted">Check racers in on the Roster tab, then schedule the first round.</p>
          </div>
        ) : (
          <>
            <header className="control-header">
              <div>
                <h2>{round.name}</h2>
                <span className="muted">{groupPath(state, round.groupId)}</span>
              </div>
              <div className="heat-counter">
                {current && position ? (
                  <>
                    Heat <strong>{position.position}</strong> of {position.total}
                  </>
                ) : (
                  <strong>Round complete</strong>
                )}
              </div>
            </header>

            {current && timer?.heatId === current.id && timer.missingLanes.length > 0 && (
              <DnfPrompt heat={current} lanes={timer.missingLanes} />
            )}

            {current ? (
              <HeatBoard heat={current} timer={timer} />
            ) : (
              <div className="empty">
                <p>Every heat in this round has run.</p>
              </div>
            )}

            <div className="control-actions">
              {current && timer?.heatId !== current.id && timer?.state !== 'racing' && (
                <button className="btn btn-primary btn-lg" onClick={() => run('armHeat', { heatId: current.id })} disabled={!timer?.connected}>
                  Arm timer for heat {position?.position} <kbd>A</kbd>
                </button>
              )}
              {current && timer?.heatId === current.id && timer.state === 'armed' && !timer.countdown && (
                <button className="btn btn-go btn-lg" onClick={() => run('startCountdown')}>
                  Start countdown <kbd>Space</kbd>
                </button>
              )}
              {current && timer?.heatId === current.id && timer.state === 'armed' && timer.countdown && (
                <span className="waiting">Lights running… scout opens the gate on green</span>
              )}
              {current && timer?.heatId === current.id && timer.state === 'armed' && timer.kind === 'simulator' && (
                <button className="btn btn-sm" onClick={() => run('simulateGate')}>
                  Open gate (simulated) <kbd>G</kbd>
                </button>
              )}
              {current && timer?.heatId === current.id && timer.state === 'armed' && timer.kind !== 'simulator' && !timer.countdown && (
                <span className="muted small">or just open the gate</span>
              )}
              {timer?.state === 'racing' && <span className="waiting racing">Racing…</span>}
              {current && timer?.heatId === current.id && (
                <button className="btn" onClick={() => run('cancelArm')}>
                  Cancel <kbd>Esc</kbd>
                </button>
              )}
              {current && (
                <button className="btn" onClick={() => setManual({ heat: current, mode: 'finish' })}>
                  Enter times manually <kbd>M</kbd>
                </button>
              )}
            </div>

            {finished && (
              <LastResult heat={finished} onRerun={() => run('rerunHeat', { heatId: finished.id, reason: 'Re-run by coordinator' })} onAmend={() => setManual({ heat: finished, mode: 'amend' })} />
            )}

            {onDeck.length > 0 && (
              <div className="on-deck">
                <h3>On deck</h3>
                {onDeck.map((heat) => (
                  <div key={heat.id} className="deck-row">
                    <span className="muted">Heat {view.heatPosition(heat.id).position}</span>
                    {heat.lanes.map((carId, i) => {
                      const info = carId ? carInfo(state, carId) : null;
                      return (
                        <span key={i} className="deck-lane">
                          <span className="lane-dot" style={{ background: laneColor(i + 1) }} />
                          {info ? `#${info.number} ${info.racerName}` : '—'}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <aside className="panel standings">
        <h2>Standings</h2>
        {round ? (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Car</th>
                <th>Racer</th>
                <th className="num">{scoringLabel(view.roundSpec(round.specKey).scoring)}</th>
                <th className="num">Runs</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => {
                const info = carInfo(state, s.carId);
                return (
                  <tr key={s.carId} className={info?.car.withdrawn ? 'withdrawn' : ''}>
                    <td>{s.runs ? s.rank : '—'}</td>
                    <td>
                      <strong>#{info?.number}</strong>
                    </td>
                    <td>
                      {info?.racerName}
                      <div className="muted small">{info?.carName}</div>
                    </td>
                    <td className="num">{s.scoreLabel}</td>
                    <td className="num">
                      {s.runs}/{s.expectedRuns}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted">Select a round.</p>
        )}
      </aside>

      {round && (
        <section className="panel history">
          <h2>Heats</h2>
          <table className="table heats">
            <thead>
              <tr>
                <th>Heat</th>
                {Array.from({ length: state.laneCount }, (_, i) => (
                  <th key={i}>
                    <span className="lane-badge" style={{ background: laneColor(i + 1) }}>
                      {i + 1}
                    </span>
                  </th>
                ))}
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {round.heats.map((heat) => {
                const pos = order.findIndex((h) => h.id === heat.id) + 1;
                return (
                  <tr key={heat.id} className={`heat-${heat.status} ${heat.id === current?.id ? 'current' : ''}`}>
                    <td>
                      {heat.status === 'voided' ? <s>{heat.number}</s> : pos}
                      {heat.rerunOf && <span className="muted small"> re-run</span>}
                    </td>
                    {heat.lanes.map((carId, i) => {
                      const info = carId ? carInfo(state, carId) : null;
                      const result = heat.result?.lanes[i];
                      return (
                        <td key={i}>
                          {info ? (
                            <>
                              <strong>#{info.number}</strong> <span className="muted small">{info.racerName}</span>
                              {result && (
                                <div className={`small ${result.place === 1 ? 'win' : ''}`}>
                                  {result.dnf ? 'DNF' : `${fmtTime(result.timeSec)} ${result.place ? ordinal(result.place) : ''}`}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      {heatStatusLabel(heat)}
                      {heat.voidReason && <div className="muted small">{heat.voidReason}</div>}
                    </td>
                    <td className="actions">
                      {heat.status === 'finished' && (
                        <>
                          <button className="btn btn-sm" onClick={() => setManual({ heat, mode: 'amend' })}>
                            Fix times
                          </button>
                          <button className="btn btn-sm" onClick={() => run('rerunHeat', { heatId: heat.id, reason: 'Re-run by coordinator' })}>
                            Re-run
                          </button>
                        </>
                      )}
                      {(heat.status === 'pending' || heat.status === 'staged') && heat.id !== current?.id && (
                        <button className="btn btn-sm" onClick={() => run('armHeat', { heatId: heat.id })} disabled={timer?.state !== 'idle'}>
                          Run now
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {manual && <ManualTimes heat={manual.heat} mode={manual.mode} onClose={() => setManual(null)} />}
      {helpOpen && <ShortcutHelp laneCount={state.laneCount} onClose={() => setHelpOpen(false)} />}
    </main>
  );
}

function ShortcutHelp({ laneCount, onClose }: { laneCount: number; onClose: () => void }) {
  const rows: [string, string][] = [
    ['A', 'Arm the timer for the current heat'],
    ['Space or S', 'Start the countdown lights'],
    ['G', 'Open the gate (simulator only)'],
    [`1 to ${laneCount}`, 'Mark that lane DNF while the heat is running'],
    ['Enter', 'Confirm the DNF prompt after the timeout'],
    ['Esc', 'Cancel the armed heat'],
    ['N', 'Next step of the show (Start race, Next round, Reveal award)'],
    ['M', 'Enter times manually for the current heat'],
    ['F', 'Fix the times of the last heat'],
    ['Z or Ctrl+Z', 'Undo the last action'],
    ['Shift+Z or Ctrl+Y', 'Redo what was just undone'],
    ['?', 'Show or hide this list'],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <p className="muted small">Shortcuts work on the Race tab whenever you are not typing in a box.</p>
      <table className="table keys">
        <tbody>
          {rows.map(([k, what]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

/** Points a fresh install at the setup wizard until it has been completed once. */
function FirstRunBanner() {
  const { state } = useDerby();
  const [done, setDone] = useState<boolean | null>(null);
  useEffect(() => {
    fetchInfo().then((i) => setDone(i.wizardDone)).catch(() => setDone(true));
  }, [state?.id]);
  if (done !== false || (state && state.racers.length > 0 && state.rounds.length > 0)) return null;
  return (
    <div className="first-run">
      <span>
        <strong>First time here?</strong> The setup wizard walks through the network, projector, phones, timer and a dry run, and checks each one.
      </span>
      <Link className="btn btn-primary btn-sm" to="/coordinator/wizard">
        Open the setup wizard
      </Link>
    </div>
  );
}

interface ShowAction {
  showing: string;
  action: { label: string; primary: boolean; onClick: () => void } | null;
  hint: string | null;
}

/** The one-button show flow: what the audience sees now, and the next step. */
function useShowAction(): ShowAction {
  const { state, view, run, timer } = useDerby();
  if (!state || !view) return { showing: '', action: null, hint: null };
  const p = state.presentation;
  const round = p.stageRoundId ? state.rounds.find((r) => r.id === p.stageRoundId) : undefined;
  const manual = p.mode !== 'auto';
  const roundDone = !!round && round.status === 'complete';
  const pending = [...state.rounds].filter((r) => r.status !== 'complete').sort((a, b) => a.sequence - b.sequence);
  const nextRound = pending.find((r) => r.id !== round?.id) ?? (roundDone ? pending[0] : undefined);
  const unscheduled = state.format.rounds.find(
    (s) => view.roundsForSpec(s.key).length === 0 && (s.scope !== 'per-group' || view.groupsOfKind(s.groupKind ?? 'den').length > 0),
  );
  const order = view.ceremonyOrder();
  const revealedCount = p.revealedAwardIds.length;
  const afterRound: ShowAction['action'] =
    nextRound || unscheduled
      ? { label: `Next round: ${(nextRound ?? unscheduled)!.name}`, primary: true, onClick: () => run('flowNext') }
      : { label: 'Start awards ceremony', primary: true, onClick: () => run('flowNext') };

  let showing: string;
  let action: { label: string; primary: boolean; onClick: () => void } | null = null;
  let hint: string | null = null;
  if (manual) {
    showing = `Manual override: ${p.mode}`;
    action = { label: 'Back to the show', primary: true, onClick: () => run('setPresentation', { patch: { mode: 'auto' } }) };
  } else {
    switch (p.stage) {
      case 'welcome':
        showing = 'Welcome slide';
        action = { label: 'Start race', primary: true, onClick: () => run('flowNext') };
        hint = state.rounds.length === 0 ? 'Schedules the first round from the checked-in racers.' : null;
        break;
      case 'round-intro':
        showing = `Title card: ${round?.name ?? 'round'}`;
        hint = 'Arm the first heat when the scouts are ready; the show follows.';
        action = { label: 'Skip title card', primary: false, onClick: () => run('flowNext') };
        break;
      case 'racing':
        if (roundDone) {
          showing = `Standings: ${round?.name ?? ''}`;
          action = afterRound;
        } else {
          showing = `Following the race: ${round?.name ?? ''}${timer?.state === 'racing' ? ' · racing' : timer?.state === 'armed' ? ' · armed' : ''}`;
          action = { label: 'Show standings now', primary: false, onClick: () => run('flowStandings') };
        }
        break;
      case 'standings':
        showing = `Standings: ${round?.name ?? ''}`;
        action = afterRound;
        break;
      case 'awards': {
        const next = view.nextAward();
        const nomineesUp = !!next && p.nomineesAwardId === next.award.id;
        showing = nomineesUp ? `Nominees for ${next.award.name}` : revealedCount === 0 ? 'Awards title card' : `Awards: ${revealedCount} of ${order.length} revealed`;
        action = next
          ? { label: next.nomineesPending ? `Show nominees: ${next.award.name}` : `Reveal${nomineesUp ? ' winner' : ''}: ${next.award.name}`, primary: true, onClick: () => run('flowNext') }
          : null;
        hint = revealedCount >= order.length && order.length > 0 ? 'All awards revealed. Undo and details are on the Audience tab.' : 'Design winners come from the Judges screen; speed awards were filled from the results.';
        break;
      }
    }
  }
  return { showing, action, hint };
}

function ShowStrip({ onHelp }: { onHelp: () => void }) {
  const { state, run, undo, redo } = useDerby();
  const { showing, action, hint } = useShowAction();
  if (!state) return null;
  const p = state.presentation;

  return (
    <section className="panel show-strip">
      <div className="show-strip-now">
        <span className="wordmark">On the projector</span>
        <strong>{showing}</strong>
        {hint && <span className="muted small">{hint}</span>}
      </div>
      <div className="control-actions">
        {action && (
          <button className={`btn ${action.primary ? 'btn-primary btn-lg' : ''}`} onClick={action.onClick}>
            {action.label} <kbd>N</kbd>
          </button>
        )}
        {(p.introRoundId || p.replayHeatId) && (
          <button className="btn btn-sm btn-warn" onClick={() => run('setPresentation', { patch: { introRoundId: null, replayHeatId: null } })}>
            Unpin {p.introRoundId ? 'intro' : 'replay'}
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={() => confirm('Put the welcome slide back up? Results are kept.') && run('flowReset')}>
          Restart show
        </button>
        <button
          className="btn btn-sm undo"
          disabled={!undo}
          title={undo ? `Reverts the ${undoLabel(undo.label)} from ${new Date(undo.at).toLocaleTimeString()}` : 'Nothing to undo yet'}
          onClick={() => undo && confirm(`Undo ${undoLabel(undo.label)}?`) && run('undo')}
        >
          Undo{undo ? `: ${undoLabel(undo.label)}` : ''} <kbd>Z</kbd>
        </button>
        {redo && (
          <button className="btn btn-sm undo" title={`Re-applies the ${undoLabel(redo.label)} that was undone`} onClick={() => confirm(`Redo ${undoLabel(redo.label)}?`) && run('redo')}>
            Redo: {undoLabel(redo.label)} <kbd>⇧Z</kbd>
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={onHelp} title="Keyboard shortcuts">
          <kbd>?</kbd> Keys
        </button>
      </div>
    </section>
  );
}

function RoundGroup({
  spec,
  rounds,
  selectedId,
  onSelect,
  onSchedule,
}: {
  spec: RoundSpec;
  rounds: Round[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSchedule: () => void;
}) {
  const { view, state } = useDerby();
  return (
    <div className="round-group">
      <div className="round-group-header">
        <strong>{spec.name}</strong>
        {rounds.length === 0 && (
          <button className="btn btn-sm btn-primary" onClick={onSchedule}>
            Schedule
          </button>
        )}
      </div>
      {rounds.length === 0 && (
        <p className="muted small">{spec.scope === 'per-group' ? (spec.groupKind === 'class' ? 'One round per class, on its own.' : 'One round per den.') : 'Everyone together.'}</p>
      )}
      {rounds.map((round) => {
        const order = view?.heatOrder(round) ?? [];
        const done = order.filter((h) => h.status === 'finished').length;
        return (
          <button key={round.id} className={`round-row ${round.id === selectedId ? 'selected' : ''} status-${round.status}`} onClick={() => onSelect(round.id)}>
            <span>{state ? groupPath(state, round.groupId) : round.name}</span>
            <span className="muted small">
              {done}/{order.length}
            </span>
            <span className="progress">
              <span style={{ width: `${order.length ? (done / order.length) * 100 : 0}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DnfPrompt({ heat, lanes }: { heat: Heat; lanes: number[] }) {
  const { state, run } = useDerby();
  if (!state) return null;
  const names = lanes.map((lane) => {
    const carId = heat.lanes[lane - 1];
    const info = carId ? carInfo(state, carId) : null;
    return info ? `lane ${lane} (#${info.number} ${info.racerName})` : `lane ${lane}`;
  });
  return (
    <div className="dnf-prompt">
      <div>
        <strong>Still waiting on {names.join(' and ')}.</strong>
        <div className="muted small">{state.settings.heatTimeoutSec} second{state.settings.heatTimeoutSec === 1 ? '' : 's'} have passed since the gate opened. Record {lanes.length > 1 ? 'them' : 'it'} as did-not-finish?</div>
      </div>
      <div className="control-actions">
        <button className="btn btn-warn" onClick={() => run('confirmDnf')}>
          Record DNF <kbd>Enter</kbd>
        </button>
        <button className="btn" onClick={() => run('keepWaiting')}>
          Keep waiting
        </button>
      </div>
    </div>
  );
}

function HeatBoard({ heat, timer }: { heat: Heat; timer: TimerStatus | null }) {
  const { state, run } = useDerby();
  if (!state) return null;
  const live = timer?.heatId === heat.id ? timer.liveLanes : [];
  const racing = timer?.heatId === heat.id && timer.state === 'racing';
  return (
    <div className="heat-board">
      {heat.lanes.map((carId, i) => {
        const lane = i + 1;
        const info = carId ? carInfo(state, carId) : null;
        const dead = state.deadLanes.includes(lane);
        const result = live.find((l) => l.lane === lane);
        return (
          <div key={lane} className={`lane-row ${dead ? 'dead' : ''} ${result?.place === 1 ? 'win' : ''}`} style={{ borderColor: laneColor(lane) }}>
            <span className="lane-badge big" style={{ background: laneColor(lane) }}>
              {lane}
            </span>
            {info ? (
              <div className="lane-car">
                <div className="lane-number">#{info.number}</div>
                <div className="lane-name">{info.racerName}</div>
                <div className="muted small">
                  {info.carName}
                  {info.carName && info.groupName ? ' · ' : ''}
                  {info.groupName}
                </div>
              </div>
            ) : (
              <div className="lane-car muted">{dead ? 'Lane out of service' : 'Empty'}</div>
            )}
            <div className="lane-time">
              {result ? (
                <>
                  <span className="time">{result.timeSec === null ? 'DNF' : fmtTime(result.timeSec)}</span>
                  {result.place && <span className="place">{ordinal(result.place)}</span>}
                </>
              ) : racing && info && !dead ? (
                <span className="lane-waiting">
                  <span className="time muted">…</span>
                  <button className="btn btn-sm btn-warn" onClick={() => run('markLaneDnf', { lane })} title="This car is not going to finish">
                    DNF <kbd>{lane}</kbd>
                  </button>
                </span>
              ) : (
                <span className="time muted"></span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LastResult({ heat, onRerun, onAmend }: { heat: Heat; onRerun: () => void; onAmend: () => void }) {
  const { state, view, run } = useDerby();
  if (!state || !view || !heat.result) return null;
  const placed = [...heat.result.lanes].filter((l) => l.carId).sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const pinned = state.presentation.replayHeatId === heat.id;
  return (
    <div className="last-result">
      <div className="last-result-header">
        <h3>
          Heat {view.heatPosition(heat.id).position} result
          {heat.replay ? (
            <span className="muted small"> · replay ready</span>
          ) : (
            <span className="muted small">
              {' '}
              · no replay clip (turn on the webcam on the Audience tab, or open{' '}
              <a href="/replay" target="_blank" rel="noreferrer">
                /replay
              </a>
              )
            </span>
          )}
        </h3>
        <div>
          {heat.replay && (
            <button className={`btn btn-sm ${pinned ? 'btn-go' : ''}`} onClick={() => run('showReplay', { heatId: pinned ? null : heat.id })}>
              {pinned ? 'Resume live screen' : 'Show replay on screen'}
            </button>
          )}
          <button className="btn btn-sm" onClick={onAmend}>
            Fix times
          </button>
          <button className="btn btn-sm btn-warn" onClick={onRerun}>
            Re-run this heat
          </button>
        </div>
      </div>
      <div className="result-strip">
        {placed.map((l) => {
          const info = carInfo(state, l.carId!);
          return (
            <div key={l.lane} className={`result-chip ${l.place === 1 ? 'win' : ''}`}>
              <span className="lane-dot" style={{ background: laneColor(l.lane) }} />
              <span className="place">{l.dnf ? 'DNF' : ordinal(l.place!)}</span>
              <span>#{info?.number}</span>
              <span className="muted small">{fmtTime(l.timeSec)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
