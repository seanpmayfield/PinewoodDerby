import { useMemo, useState } from 'react';
import type { Car, Group, Racer } from '@derby/core';
import { useDerby } from '../../lib/derby.tsx';

export function RosterTab() {
  const { state, run } = useDerby();
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [newDen, setNewDen] = useState('');
  const [csv, setCsv] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', groupId: '', carNumber: '', carName: '' });

  const groups = useMemo(() => (state?.groups ?? []).filter((g) => g.kind !== 'pack').sort((a, b) => a.sortOrder - b.sortOrder), [state]);

  const rows = useMemo(() => {
    if (!state) return [];
    const q = search.trim().toLowerCase();
    return state.cars
      .map((car) => ({ car, racer: state.racers.find((r) => r.id === car.racerId)! }))
      .filter(({ racer }) => racer)
      .filter(({ car, racer }) => filterGroup === 'all' || (car.groupId ?? racer.groupId) === filterGroup)
      .filter(({ car, racer }) => !q || `${racer.firstName} ${racer.lastName} ${car.number} ${car.name ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.car.number - b.car.number);
  }, [state, filterGroup, search]);

  if (!state) return null;
  const racingStarted = state.rounds.length > 0;
  const checkedIn = state.racers.filter((r) => r.checkedIn).length;

  const addRacer = async () => {
    if (!form.firstName.trim() || !form.groupId) return;
    await run('addRacer', {
      firstName: form.firstName,
      lastName: form.lastName,
      groupId: form.groupId,
      carNumber: form.carNumber ? Number(form.carNumber) : undefined,
      carName: form.carName || undefined,
    });
    setForm((f) => ({ ...f, firstName: '', lastName: '', carNumber: '', carName: '' }));
  };

  const importCsv = async () => {
    if (!csv.trim()) return;
    const result = await run<{ imported: number }>('importRoster', { csv });
    if (result) setCsv('');
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    file.text().then(setCsv);
  };

  return (
    <main className="roster">
      <aside className="panel">
        <h2>Dens</h2>
        <button className={`round-row ${filterGroup === 'all' ? 'selected' : ''}`} onClick={() => setFilterGroup('all')}>
          <span>Everyone</span>
          <span className="muted small">{state.cars.length}</span>
        </button>
        {groups.map((g) => (
          <GroupRow key={g.id} group={g} count={state.racers.filter((r) => r.groupId === g.id).length} selected={filterGroup === g.id} onSelect={() => setFilterGroup(g.id)} />
        ))}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (newDen.trim()) run('addGroup', { name: newDen, kind: 'den' }).then(() => setNewDen(''));
          }}
        >
          <input placeholder="New den name" value={newDen} onChange={(e) => setNewDen(e.target.value)} />
          <button className="btn btn-sm">Add</button>
        </form>

        <h2>Import</h2>
        <p className="muted small">Paste a CSV or choose a file. Columns like First Name, Last Name, Den, Car Number are detected automatically.</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        <textarea rows={5} placeholder={'First Name,Last Name,Den,Car Number\nAlex,Smith,Wolves,12'} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={importCsv} disabled={!csv.trim()}>
          Import roster
        </button>
        {state.racers.length === 0 && (
          <>
            <h2>Demo</h2>
            <button className="btn btn-sm" onClick={() => run('seedDemo')}>
              Load a demo pack
            </button>
          </>
        )}
      </aside>

      <section className="panel roster-main">
        <header className="roster-header">
          <div>
            <h2>Racers</h2>
            <span className="muted">
              {checkedIn} of {state.racers.length} checked in
            </span>
          </div>
          <input className="search" placeholder="Search name or car #" value={search} onChange={(e) => setSearch(e.target.value)} />
        </header>

        <form
          className="add-racer"
          onSubmit={(e) => {
            e.preventDefault();
            addRacer();
          }}
        >
          <input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          <input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })} required>
            <option value="">Den…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <input placeholder="Car #" type="number" min={1} value={form.carNumber} onChange={(e) => setForm({ ...form, carNumber: e.target.value })} style={{ width: 80 }} />
          <input placeholder="Car name" value={form.carName} onChange={(e) => setForm({ ...form, carName: e.target.value })} />
          <button className="btn btn-primary">Add racer</button>
        </form>

        <table className="table roster-table">
          <thead>
            <tr>
              <th>In</th>
              <th>Car #</th>
              <th></th>
              <th>Racer</th>
              <th>Den</th>
              <th>Car name</th>
              <th>Weight (oz)</th>
              <th>Inspection</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ car, racer }) => (
              <RacerRow key={car.id} car={car} racer={racer} groups={groups} racingStarted={racingStarted} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No racers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function GroupRow({ group, count, selected, onSelect }: { group: Group; count: number; selected: boolean; onSelect: () => void }) {
  const { run } = useDerby();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  if (editing) {
    return (
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          run('updateGroup', { id: group.id, patch: { name } }).then(() => setEditing(false));
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <button className="btn btn-sm">Save</button>
      </form>
    );
  }
  return (
    <button className={`round-row ${selected ? 'selected' : ''}`} onClick={onSelect} onDoubleClick={() => setEditing(true)} title="Double-click to rename">
      <span>
        {group.name}
        {group.kind === 'class' && <span className="muted small"> (class)</span>}
      </span>
      <span className="muted small">
        {count}
        {selected && count > 0 && (
          <>
            {' '}
            <span
              className="link-sm"
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Check in everyone in ${group.name}?`)) void run('checkInGroup', { groupId: group.id, checkedIn: true });
              }}
            >
              check in all
            </span>
          </>
        )}
      </span>
    </button>
  );
}

function RacerRow({ car, racer, groups, racingStarted }: { car: Car; racer: Racer; groups: Group[]; racingStarted: boolean }) {
  const { run, state } = useDerby();
  const [weight, setWeight] = useState(car.weightOz?.toFixed(2) ?? '');
  const [number, setNumber] = useState(String(car.number));
  const [carName, setCarName] = useState(car.name ?? '');
  const over = car.weightOz !== undefined && state && car.weightOz > state.settings.maxWeightOz;

  return (
    <tr className={car.withdrawn ? 'withdrawn' : ''}>
      <td>
        <input type="checkbox" checked={racer.checkedIn} onChange={(e) => run('setCheckedIn', { racerId: racer.id, checkedIn: e.target.checked })} />
      </td>
      <td>
        <input
          className="cell"
          type="number"
          min={1}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onBlur={() => {
            if (Number(number) !== car.number && Number(number) > 0) run('updateCar', { id: car.id, patch: { number: Number(number) } });
            else setNumber(String(car.number));
          }}
          style={{ width: 64 }}
        />
      </td>
      <td>{car.photo?.side?.crop ? <img className="roster-thumb" src={`/api/photos/${car.photo.side.crop}`} alt="" /> : null}</td>
      <td>
        {racer.firstName} {racer.lastName}
        {racer.rank && <div className="muted small">{racer.rank}</div>}
      </td>
      <td>
        <select className="cell" value={racer.groupId} onChange={(e) => run('updateRacer', { id: racer.id, patch: { groupId: e.target.value } })} disabled={racingStarted}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input className="cell" value={carName} onChange={(e) => setCarName(e.target.value)} onBlur={() => carName !== (car.name ?? '') && run('updateCar', { id: car.id, patch: { name: carName } })} />
      </td>
      <td>
        <input
          className={`cell ${over ? 'over' : ''}`}
          type="number"
          step="0.01"
          min={0}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onBlur={() => {
            const value = weight.trim() === '' ? null : Number(weight);
            if (value !== (car.weightOz ?? null)) run('setWeight', { carId: car.id, weightOz: value });
          }}
          style={{ width: 72 }}
        />
      </td>
      <td>
        <select className={`cell status-${car.inspection.status}`} value={car.inspection.status} onChange={(e) => run('setInspection', { carId: car.id, patch: { status: e.target.value } })}>
          <option value="pending">Pending</option>
          <option value="passed">Passed</option>
          <option value="needs-work">Needs work</option>
          <option value="failed">Failed</option>
        </select>
      </td>
      <td className="actions">
        {car.withdrawn ? (
          <button className="btn btn-sm" onClick={() => run('withdrawCar', { carId: car.id, withdrawn: false })}>
            Reinstate
          </button>
        ) : racingStarted ? (
          <button className="btn btn-sm btn-warn" onClick={() => confirm(`Withdraw #${car.number} from the rest of the event?`) && run('withdrawCar', { carId: car.id })}>
            Withdraw
          </button>
        ) : (
          <button className="btn btn-sm" onClick={() => confirm(`Remove ${racer.firstName} ${racer.lastName}?`) && run('removeRacer', { id: racer.id })}>
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}
