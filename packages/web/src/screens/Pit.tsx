import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Car, Derby, Racer } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { CAMERA_OK, carInfo } from '../lib/format.ts';
import { CarDetail } from '../pit/CarDetail.tsx';
import { photoUrl } from '../pit/photos.ts';
import '../pit/pit.css';

/**
 * Pit crew screen, built for a phone at the check-in table: find the car,
 * check the scout in, weigh and inspect the car, take its photo.
 */
export function Pit() {
  const { state, run } = useDerby();
  const { carId } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo' | 'in'>('all');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    if (!state) return [];
    const q = search.trim().toLowerCase();
    return state.cars
      .map((car) => ({ car, racer: state.racers.find((r) => r.id === car.racerId) }))
      .filter((r): r is { car: Car; racer: Racer } => !!r.racer && !r.car.withdrawn)
      .filter(({ racer }) => (filter === 'in' ? racer.checkedIn : filter === 'todo' ? !racer.checkedIn : true))
      .filter(({ car, racer }) => !q || `${racer.firstName} ${racer.lastName} ${car.number} ${car.name ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.car.number - b.car.number);
  }, [state, search, filter]);

  if (!state) return <div className="pit pit-loading">Connecting…</div>;

  const selected = carId ? rows.find((r) => r.car.id === carId) ?? lookup(state, carId) : null;
  if (selected) {
    return (
      <div className="pit">
        <CarDetail car={selected.car} racer={selected.racer} onBack={() => navigate('/pit')} />
      </div>
    );
  }

  const checkedIn = state.racers.filter((r) => r.checkedIn).length;
  const passed = state.cars.filter((c) => c.inspection.status === 'passed').length;
  const photos = state.cars.filter((c) => c.photo?.side).length;

  return (
    <div className="pit">
      <header className="pit-header">
        <div>
          <div className="pit-kicker">Pit crew</div>
          <h1>{state.name}</h1>
        </div>
        <div className="pit-stats">
          <span>
            <b>{checkedIn}</b>/{state.racers.length} in
          </span>
          <span>
            <b>{passed}</b> passed
          </span>
          <span>
            <b>{photos}</b> photos
          </span>
        </div>
      </header>

      {!CAMERA_OK && (
        <p className="pit-secure-hint pit-secure-banner">
          Live camera with the car outline needs the secure address. <a href="/phone">Set this phone up once</a>. Photos still work here through the camera app.
        </p>
      )}

      <div className="pit-toolbar">
        <input className="pit-search" type="search" placeholder="Car # or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="pit-chips">
          {(['all', 'todo', 'in'] as const).map((f) => (
            <button key={f} className={`pit-chip ${filter === f ? 'is-active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'todo' ? 'Not here yet' : 'Checked in'}
            </button>
          ))}
        </div>
      </div>

      <ul className="pit-list">
        {rows.map(({ car, racer }) => {
          const group = state.groups.find((g) => g.id === (car.groupId ?? racer.groupId));
          const profile = photoUrl(car.photo?.side?.cutout ?? car.photo?.side?.crop);
          const over = car.weightOz !== undefined && car.weightOz > state.settings.maxWeightOz;
          return (
            <li key={car.id}>
              <button className={`pit-row ${racer.checkedIn ? 'is-in' : ''}`} onClick={() => navigate(`/pit/${car.id}`)}>
                <span className="pit-row-num">#{car.number}</span>
                <span className="pit-row-thumb">{profile ? <img src={profile} alt="" /> : null}</span>
                <span className="pit-row-name">
                  {racer.firstName} {racer.lastName}
                  <small>
                    {group?.name}
                    {car.weightOz !== undefined && <span className={over ? 'pit-over' : ''}> · {car.weightOz.toFixed(2)} oz</span>}
                  </small>
                </span>
                <span className="pit-row-flags">
                  <i className={racer.checkedIn ? 'on' : ''} title="Checked in">
                    IN
                  </i>
                  <i className={racer.headshot ? 'on' : ''} title="Scout video">
                    VID
                  </i>
                  <i className={car.inspection.status === 'passed' ? 'on' : car.inspection.status === 'pending' ? '' : 'bad'} title="Inspection">
                    {car.inspection.status === 'passed' ? 'PASS' : car.inspection.status === 'pending' ? 'INSP' : car.inspection.status === 'failed' ? 'FAIL' : 'WORK'}
                  </i>
                </span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && <li className="pit-empty">No cars match.</li>}
      </ul>

      {adding ? (
        <AddRacer onDone={(id) => (setAdding(false), id && navigate(`/pit/${id}`))} />
      ) : (
        <button className="pit-fab" onClick={() => setAdding(true)}>
          + Walk-up racer
        </button>
      )}
      <button className="pit-fab pit-fab-demo" onClick={() => run('seedDemo')} hidden={state.racers.length > 0}>
        Load a demo pack
      </button>
    </div>
  );
}

function lookup(state: Derby, carId: string): { car: Car; racer: Racer } | null {
  const info = carInfo(state, carId);
  return info?.racer ? { car: info.car, racer: info.racer } : null;
}

function AddRacer({ onDone }: { onDone: (carId: string | null) => void }) {
  const { state, run } = useDerby();
  const groups = (state?.groups ?? []).filter((g) => g.kind !== 'pack');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [number, setNumber] = useState('');
  const submit = async () => {
    if (!first.trim() || !groupId) return;
    const result = await run<{ car: Car }>('addRacer', { firstName: first, lastName: last, groupId, carNumber: number ? Number(number) : undefined });
    if (result) {
      await run('setCheckedIn', { racerId: result.car.racerId, checkedIn: true });
      onDone(result.car.id);
    }
  };
  return (
    <form
      className="pit-card pit-add"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3>Walk-up racer</h3>
      <input placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} autoFocus required />
      <input placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
      <select value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <input type="number" inputMode="numeric" placeholder="Car # (blank = next free)" value={number} onChange={(e) => setNumber(e.target.value)} />
      <div className="pit-actions">
        <button type="button" className="pbtn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button className="pbtn pbtn-primary">Add and check in</button>
      </div>
    </form>
  );
}
