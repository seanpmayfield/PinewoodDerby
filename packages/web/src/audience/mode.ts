import type { Derby, DerbyEngine, Heat, Round } from '@derby/core';
import type { TimerStatus } from '../lib/types.ts';

export type AudienceMode =
  | { kind: 'welcome' }
  | { kind: 'lineup'; round: Round; heat: Heat; freshRound: boolean }
  | { kind: 'intro'; round: Round }
  | { kind: 'armed'; round: Round; heat: Heat }
  | { kind: 'countdown'; round: Round; heat: Heat; startedAt: number; lights: number; intervalMs: number; stageMs: number }
  | { kind: 'racing'; round: Round; heat: Heat }
  | { kind: 'result'; round: Round; heat: Heat }
  | { kind: 'replay'; round: Round; heat: Heat }
  | { kind: 'standings'; round: Round; final: boolean }
  | { kind: 'awards' }
  | { kind: 'sponsors' };

/** Decide what the projector shows right now. Pure, so it is easy to test and reason about. */
export function deriveMode(state: Derby, view: DerbyEngine, timer: TimerStatus | null, now: number): AudienceMode {
  const p = state.presentation;
  const rounds = state.rounds;
  const lastRound = rounds[rounds.length - 1];

  // The coordinator can pin a heat's result (and replay) on screen.
  if (p.replayHeatId) {
    const pinned = findHeat(state, p.replayHeatId);
    if (pinned && pinned.heat.result) return { kind: pinned.heat.replay ? 'replay' : 'result', round: pinned.round, heat: pinned.heat };
  }

  if (p.introRoundId) {
    const round = rounds.find((r) => r.id === p.introRoundId);
    if (round) return { kind: 'intro', round };
  }

  if (p.mode === 'welcome') return { kind: 'welcome' };
  if (p.mode === 'awards') return { kind: 'awards' };
  if (p.mode === 'sponsors') return { kind: 'sponsors' };
  if (p.mode === 'standings') {
    const round = rounds.find((r) => r.id === p.standingsRoundId) ?? view.activeRound() ?? lastRound;
    return round ? { kind: 'standings', round, final: round.status === 'complete' } : { kind: 'welcome' };
  }

  // The show flow: the coordinator steps through welcome -> round intro ->
  // racing -> standings -> next round ... -> awards.
  const stageRound = p.stageRoundId ? rounds.find((r) => r.id === p.stageRoundId) : undefined;
  if (p.stage === 'welcome') return { kind: 'welcome' };
  if (p.stage === 'awards') return { kind: 'awards' };
  if (p.stage === 'round-intro' && stageRound) return { kind: 'intro', round: stageRound };
  if (p.stage === 'standings' && stageRound) return { kind: 'standings', round: stageRound, final: stageRound.status === 'complete' };

  // Racing: follow the show's round. A heat that just finished stays up for a moment.
  const recent = latestFinishedHeat(state, stageRound?.id);
  if (recent) {
    // Result first; once the clip has arrived (a second or two after the finish)
    // the replay takes over the screen, and the whole hold is stretched so the
    // crowd actually gets to watch it.
    const elapsed = now - new Date(recent.heat.result!.recordedAt).getTime();
    const holdSec = recent.heat.replay ? Math.max(p.resultHoldSec, 18) : p.resultHoldSec;
    if (elapsed < holdSec * 1000) {
      if (recent.heat.replay && elapsed >= RESULT_BEFORE_REPLAY_MS) return { kind: 'replay', round: recent.round, heat: recent.heat };
      return { kind: 'result', round: recent.round, heat: recent.heat };
    }
  }

  // The show's round once it is complete: its standings, until the coordinator moves on.
  if (stageRound && stageRound.status === 'complete') return { kind: 'standings', round: stageRound, final: true };

  const active = stageRound ?? view.activeRound();
  if (!active) {
    if (lastRound && lastRound.status === 'complete') return { kind: 'standings', round: lastRound, final: true };
    return { kind: 'welcome' };
  }

  const current = view.currentHeat(active.id);
  if (current && timer?.heatId === current.id && timer.state === 'racing') {
    return { kind: 'racing', round: active, heat: current };
  }
  if (current && timer?.heatId === current.id && timer.state === 'armed') {
    if (timer.countdown) return { kind: 'countdown', round: active, heat: current, ...timer.countdown };
    return { kind: 'armed', round: active, heat: current };
  }
  if (current) {
    // First heat of a round that has not started: the audience gets the intro card first.
    const freshRound = active.heats.every((h) => h.status === 'pending' || h.status === 'voided') && view.heatOrder(active)[0]?.id === current.id;
    return { kind: 'lineup', round: active, heat: current, freshRound };
  }
  return { kind: 'standings', round: active, final: active.status === 'complete' };
}

/** How long the plain result shows before the replay takes over. */
const RESULT_BEFORE_REPLAY_MS = 4000;

function latestFinishedHeat(state: Derby, roundId?: string): { round: Round; heat: Heat } | null {
  let best: { round: Round; heat: Heat; at: number } | null = null;
  for (const round of state.rounds) {
    if (roundId && round.id !== roundId) continue;
    for (const heat of round.heats) {
      if (heat.status !== 'finished' || !heat.result) continue;
      const at = new Date(heat.result.recordedAt).getTime();
      if (!best || at > best.at) best = { round, heat, at };
    }
  }
  return best ? { round: best.round, heat: best.heat } : null;
}

export function findHeat(state: Derby, heatId: string): { round: Round; heat: Heat } | null {
  for (const round of state.rounds) {
    const heat = round.heats.find((h) => h.id === heatId);
    if (heat) return { round, heat };
  }
  return null;
}
