import { useEffect, useMemo, useState } from 'react';
import type { Award, Car } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { carInfo } from '../lib/format.ts';
import { CarPortrait } from '../audience/CarPortrait.tsx';
import '../pit/pit.css';
import '../judges/judges.css';

const VOTER_KEY = 'derby.voter';
const PASSWORD_KEY = 'derby.votePassword';

/** One ballot per phone: a random id the browser keeps. */
function voterId(): string {
  try {
    let id = localStorage.getItem(VOTER_KEY);
    if (!id) {
      id = `v-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem(VOTER_KEY, id);
    }
    return id;
  } catch {
    return `v-${Date.now().toString(36)}session`;
  }
}

/**
 * People's choice: the audience votes for design awards from their phones.
 * Taps toggle picks up to the limit; every change is saved at once and can
 * be changed while voting stays open. The judges see the tally and still
 * make the final call.
 */
export function Vote() {
  const { state, view } = useDerby();
  const [password, setPassword] = useState(() => sessionStorage.getItem(PASSWORD_KEY) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const me = useMemo(voterId, []);
  const ballot = state?.ballot;
  const awards = useMemo(() => (state ? state.awards.filter((a) => ballot?.awardIds.includes(a.id)).sort((a, b) => a.sortOrder - b.sortOrder) : []), [state, ballot]);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (ballot) setPicks(ballot.votes[me] ?? {});
  }, [ballot, me]);

  if (!state || !view || !ballot) return <div className="pit pit-loading">Connecting…</div>;

  const send = async (awardId: string, carIds: string[]) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/vote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voterId: me, awardId, carIds, password: password || undefined }) });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) setError(body.error ?? 'Could not save your vote.');
      else sessionStorage.setItem(PASSWORD_KEY, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (award: Award, car: Car) => {
    const current = picks[award.id] ?? [];
    let next: string[];
    if (current.includes(car.id)) next = current.filter((id) => id !== car.id);
    else if (current.length >= ballot.votesPerAward) next = ballot.votesPerAward === 1 ? [car.id] : current;
    else next = [...current, car.id];
    if (next === current) return;
    setPicks({ ...picks, [award.id]: next });
    void send(award.id, next);
  };

  return (
    <div className="pit vote">
      <header className="pit-header">
        <div>
          <div className="pit-kicker">People's choice</div>
          <h1>{state.name}</h1>
        </div>
      </header>
      {!ballot.open || awards.length === 0 ? (
        <div className="pit-card">
          <h3>Voting is not open right now</h3>
          <p className="pit-sub">Keep this page handy; the judges will open it when it is time to vote.</p>
        </div>
      ) : (
        <>
          <p className="pit-sub vote-intro">
            Tap your favourite{ballot.votesPerAward > 1 ? `s (up to ${ballot.votesPerAward} per award)` : ' for each award'}. Your picks save as you go, and you can change them while voting is open.
          </p>
          {ballot.passwordRequired && (
            <label className="pit-card vote-password">
              <span>Voting password (announced at the race)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
            </label>
          )}
          {error && <p className="pit-secure-banner">{error}</p>}
          {awards.map((award) => {
            const mine = picks[award.id] ?? [];
            const cars = view.ballotCandidates(award.id).sort((a, b) => a.number - b.number);
            return (
              <section className="pit-card" key={award.id}>
                <h3>
                  {award.name}
                  <small className="jud-muted"> · {mine.length}/{ballot.votesPerAward} picked</small>
                </h3>
                <div className="vote-grid">
                  {cars.map((car) => {
                    const info = carInfo(state, car.id);
                    const on = mine.includes(car.id);
                    return (
                      <button key={car.id} className={`vote-car ${on ? 'is-on' : ''}`} onClick={() => toggle(award, car)} disabled={saving && !on}>
                        <div className="jud-car-photo">
                          <CarPortrait car={car} color="#c4c8d0" />
                          {on && <span className="jud-star">✓</span>}
                        </div>
                        <div className="vote-car-body">
                          <b>#{car.number}</b> {car.name || info?.racerName}
                          <small>{car.name ? info?.racerName : info?.groupName}</small>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
