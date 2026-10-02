import { useMemo, useState } from 'react';
import type { Heat } from '@derby/core';
import { Modal } from './Modal.tsx';
import { useDerby } from '../lib/derby.tsx';
import { checkedInCars, laneColor } from '../lib/format.ts';

/**
 * Enter or correct a heat by hand: the time in each lane, and which car was
 * actually in it. Blank time = did not finish. Changing a car re-scores the
 * heat with the same lane times and re-plans the rest of the round so every
 * car still gets its full set of runs.
 */
export function ManualTimes({ heat, mode, onClose }: { heat: Heat; mode: 'finish' | 'amend'; onClose: () => void }) {
  const { state, view, run } = useDerby();
  const [times, setTimes] = useState<string[]>(() =>
    heat.lanes.map((_, i) => {
      const existing = heat.result?.lanes[i]?.timeSec;
      return existing === null || existing === undefined ? '' : existing.toFixed(4);
    }),
  );
  const [lanes, setLanes] = useState<(string | null)[]>(() => [...heat.lanes]);
  const [busy, setBusy] = useState(false);

  const round = useMemo(() => state?.rounds.find((r) => r.id === heat.roundId), [state, heat.roundId]);
  const options = useMemo(() => {
    if (!state || !view) return [];
    const inRound = new Set(round?.entries ?? []);
    const cars = checkedInCars(state)
      .sort((a, b) => Number(!inRound.has(a.car.id)) - Number(!inRound.has(b.car.id)) || a.number - b.number);
    return cars.map((i) => ({ id: i.car.id, label: `#${i.number} ${i.racerName}${i.carName ? ` (${i.carName})` : ''}`, inRound: inRound.has(i.car.id) }));
  }, [state, view, round]);

  if (!state) return null;
  const changed = lanes.some((c, i) => c !== heat.lanes[i]);
  const duplicate = new Set(lanes.filter(Boolean)).size !== lanes.filter(Boolean).length;
  const runsNeeded = round && view ? view.roundSpec(round.specKey).passes * state.laneCount : null;

  const submit = async () => {
    if (duplicate) return;
    setBusy(true);
    const payload = lanes.map((carId, i) => ({
      lane: i + 1,
      timeSec: carId && times[i]?.trim() ? Number(times[i]) : null,
    }));
    const result = await run(mode === 'finish' ? 'finishHeat' : 'amendHeat', { heatId: heat.id, times: payload, lanes: changed ? lanes : undefined });
    setBusy(false);
    if (result !== undefined) onClose();
  };

  return (
    <Modal title={mode === 'finish' ? 'Enter times manually' : 'Fix times'} onClose={onClose}>
      <p className="muted">Leave a lane blank if the car did not finish. Change the car if the wrong one was on that lane.</p>
      <div className="manual-lanes">
        {heat.lanes.map((_, i) => {
          const carId = lanes[i] ?? null;
          return (
            <div key={i} className="manual-lane">
              <span className="lane-badge" style={{ background: laneColor(i + 1) }}>
                {i + 1}
              </span>
              <select
                className={carId !== heat.lanes[i] ? 'is-changed' : ''}
                value={carId ?? ''}
                onChange={(e) => setLanes((l) => l.map((v, j) => (j === i ? e.target.value || null : v)))}
              >
                <option value="">empty lane</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.inRound ? '' : '(other) '}
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.0001"
                min="0"
                inputMode="decimal"
                placeholder="DNF"
                disabled={!carId}
                value={times[i] ?? ''}
                onChange={(e) => setTimes((t) => t.map((v, j) => (j === i ? e.target.value : v)))}
              />
            </div>
          );
        })}
      </div>
      {duplicate && <p className="warn-box">The same car is in two lanes.</p>}
      {changed && !duplicate && (
        <p className="warn-box">
          Cars changed. The times stay with their lanes and are re-scored for the new cars. Heats still to run will be re-planned so every car in this round still gets {runsNeeded ?? 'its'} runs.
        </p>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={busy || duplicate}>
          Save result
        </button>
      </div>
    </Modal>
  );
}
