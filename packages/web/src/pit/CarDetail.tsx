import { useEffect, useState } from 'react';
import { INSPECTION_CHECKS, type Car, type InspectionStatus, type Racer } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { CAMERA_OK } from '../lib/format.ts';
import { HeadshotRecorder } from './HeadshotRecorder.tsx';
import { CarPhotos } from './CarPhotos.tsx';

const STATUS_LABEL: Record<InspectionStatus, string> = {
  pending: 'Not inspected',
  passed: 'Passed',
  'needs-work': 'Needs work',
  failed: 'Failed',
};

export function CarDetail({ car, racer, onBack }: { car: Car; racer: Racer; onBack: () => void }) {
  const { state, run } = useDerby();
  const [weight, setWeight] = useState(car.weightOz?.toFixed(2) ?? '');
  const [notes, setNotes] = useState(car.inspection.notes ?? '');
  const [carName, setCarName] = useState(car.name ?? '');
  const [headshot, setHeadshot] = useState(false);

  useEffect(() => setWeight(car.weightOz?.toFixed(2) ?? ''), [car.weightOz]);
  useEffect(() => setNotes(car.inspection.notes ?? ''), [car.inspection.notes]);
  useEffect(() => setCarName(car.name ?? ''), [car.name]);

  if (!state) return null;
  const maxWeight = state.settings.maxWeightOz;
  const over = car.weightOz !== undefined && car.weightOz > maxWeight;
  const group = state.groups.find((g) => g.id === (car.groupId ?? racer.groupId));
  const allChecked = INSPECTION_CHECKS.every((c) => car.inspection.checks[c.id] === true);
  const anyFailed = INSPECTION_CHECKS.some((c) => car.inspection.checks[c.id] === false);

  const commitWeight = () => {
    const value = weight.trim() === '' ? null : Number(weight);
    if (value !== null && !Number.isFinite(value)) return;
    if (value !== (car.weightOz ?? null)) run('setWeight', { carId: car.id, weightOz: value });
  };

  const toggleCheck = (id: string) => {
    const current = car.inspection.checks[id];
    // Cycle: unknown -> pass -> fail -> unknown
    const next = current === undefined ? true : current === true ? false : undefined;
    const checks = { ...car.inspection.checks };
    if (next === undefined) delete checks[id];
    else checks[id] = next;
    run('setInspection', { carId: car.id, patch: { checks: replaceChecks(checks) } });
  };

  const setStatus = (status: InspectionStatus) => run('setInspection', { carId: car.id, patch: { status } });

  // The video recorder takes the whole screen; the photo flow overlays itself.
  if (headshot) {
    return <HeadshotRecorder racerId={racer.id} racerName={racer.firstName} onDone={() => setHeadshot(false)} onCancel={() => setHeadshot(false)} />;
  }

  return (
    <section className="pit-detail">
      <header className="pit-detail-header">
        <button className="pbtn pbtn-ghost" onClick={onBack}>
          ‹ Cars
        </button>
        <div>
          <h2>
            #{car.number} {racer.firstName} {racer.lastName}
          </h2>
          <div className="pit-sub">
            {group?.name}
            {racer.rank ? ` · ${racer.rank}` : ''}
          </div>
        </div>
      </header>

      <button className={`pit-checkin ${racer.checkedIn ? 'is-in' : ''}`} onClick={() => run('setCheckedIn', { racerId: racer.id, checkedIn: !racer.checkedIn })}>
        {racer.checkedIn ? '✓ Checked in' : 'Check in'}
      </button>

      <CarPhotos car={car} />

      <div className="pit-card">
        <h3>Scout video</h3>
        <div className="pit-headshot">
          {racer.headshot ? (
            <video key={racer.headshot} src={`/api/headshots/${racer.headshot}`} autoPlay loop muted playsInline />
          ) : (
            <div className="pit-photo-empty">No video yet</div>
          )}
        </div>
        <p className="pit-sub">A few seconds of {racer.firstName} saying hi. Plays on the big screen in the racer spotlight and when they win an award.</p>
        <div className="pit-actions">
          <button className="pbtn pbtn-primary" onClick={() => setHeadshot(true)} disabled={!CAMERA_OK} title={CAMERA_OK ? '' : 'Needs the secure address'}>
            {racer.headshot ? 'Record again' : 'Record video'}
          </button>
          {racer.headshot && (
            <button className="pbtn pbtn-ghost" onClick={() => confirm('Remove this video?') && run('clearRacerHeadshot', { racerId: racer.id })}>
              Remove
            </button>
          )}
        </div>
        {!CAMERA_OK && <p className="pit-secure-hint">Recording needs the secure address: open /phone on this device once, then come back on the https link.</p>}
      </div>

      <div className="pit-card">
        <h3>Weight</h3>
        <div className="pit-weight">
          <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={weight} onChange={(e) => setWeight(e.target.value)} onBlur={commitWeight} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <span className="pit-unit">oz</span>
          <span className={`pit-badge ${car.weightOz === undefined ? '' : over ? 'is-bad' : 'is-good'}`}>
            {car.weightOz === undefined ? `max ${maxWeight.toFixed(2)}` : over ? `${(car.weightOz - maxWeight).toFixed(2)} over` : 'OK'}
          </span>
        </div>
      </div>

      <div className="pit-card">
        <h3>Inspection</h3>
        <ul className="pit-checks">
          {INSPECTION_CHECKS.map((check) => {
            const value = car.inspection.checks[check.id];
            return (
              <li key={check.id}>
                <button className={`pit-check ${value === true ? 'is-pass' : value === false ? 'is-fail' : ''}`} onClick={() => toggleCheck(check.id)}>
                  <span className="pit-check-mark">{value === true ? '✓' : value === false ? '✕' : ''}</span>
                  <span>
                    <strong>{check.label}</strong>
                    <small>{check.hint}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="pit-status">
          {(['passed', 'needs-work', 'failed'] as InspectionStatus[]).map((s) => (
            <button key={s} className={`pbtn status-${s} ${car.inspection.status === s ? 'is-active' : ''}`} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {car.inspection.status === 'pending' && allChecked && !over && <p className="pit-hint">Everything checks out. Mark it passed.</p>}
        {car.inspection.status === 'passed' && (anyFailed || over) && <p className="pit-hint is-warn">Marked passed but a check is failing.</p>}
        <textarea placeholder="Notes for the pit crew or the family" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (car.inspection.notes ?? '') && run('setInspection', { carId: car.id, patch: { notes } })} />
      </div>

      <div className="pit-card">
        <h3>Car</h3>
        <label className="pit-field">
          <span>Car name</span>
          <input value={carName} onChange={(e) => setCarName(e.target.value)} onBlur={() => carName !== (car.name ?? '') && run('updateCar', { id: car.id, patch: { name: carName } })} />
        </label>
        <label className="pit-field">
          <span>Car number</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            defaultValue={car.number}
            key={car.number}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (n > 0 && n !== car.number) run('updateCar', { id: car.id, patch: { number: n } });
            }}
          />
        </label>
      </div>
    </section>
  );
}

/** The engine merges check patches, so send the full map with explicit false/true and drop cleared keys by name. */
function replaceChecks(checks: Record<string, boolean>): Record<string, boolean> {
  const full: Record<string, boolean> = {};
  for (const c of INSPECTION_CHECKS) if (checks[c.id] !== undefined) full[c.id] = checks[c.id]!;
  return full;
}
