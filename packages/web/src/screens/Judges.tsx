import { useEffect, useMemo, useState } from 'react';
import { DESIGN_AWARD_PRESETS, JUDGING_CRITERIA_PRESETS, type Award, type Car, type Judge, type JudgingCriterion } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { carInfo, checkedInCars, groupPath, type CarInfo } from '../lib/format.ts';
import { CarPortrait } from '../audience/CarPortrait.tsx';
import { CarPhotos } from '../pit/CarPhotos.tsx';
import '../pit/pit.css';
import '../judges/judges.css';

type Only = 'all' | 'nominees' | 'unseen' | 'scored';

/** Which judge this device scores as; remembered per browser. */
const JUDGE_KEY = 'derby.judgeId';

const fmtScore = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Judges' screen: set up the design awards, walk the table ticking cars as
 * seen, shortlist nominees, optionally score a rubric, then pick winners.
 * Speed awards are shown read-only; they come from the race results.
 */
export function Judges() {
  const { state, view, run } = useDerby();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [denFilter, setDenFilter] = useState<string>('all');
  const [only, setOnly] = useState<Only>('all');
  const [sortBy, setSortBy] = useState<'number' | 'score'>('number');
  const [customName, setCustomName] = useState('');
  const [customGroup, setCustomGroup] = useState<string>('');
  const [scoringCarId, setScoringCarId] = useState<string | null>(null);
  const [photoCarId, setPhotoCarId] = useState<string | null>(null);
  const [judgeId, setJudgeIdState] = useState<string | null>(() => localStorage.getItem(JUDGE_KEY));
  const setJudgeId = (id: string | null) => {
    setJudgeIdState(id);
    if (id) localStorage.setItem(JUDGE_KEY, id);
    else localStorage.removeItem(JUDGE_KEY);
  };

  const judged = useMemo(() => (state?.awards ?? []).filter((a) => a.kind !== 'speed').sort((a, b) => a.sortOrder - b.sortOrder), [state]);
  const speed = useMemo(() => (state?.awards ?? []).filter((a) => a.kind === 'speed'), [state]);
  const selected = judged.find((a) => a.id === selectedId) ?? null;
  const dens = (state?.groups ?? []).filter((g) => g.kind !== 'pack').sort((a, b) => a.sortOrder - b.sortOrder);
  const criteria = state?.judging.criteria ?? [];
  const judges = state?.judging.judges ?? [];
  const judge = judges.find((j) => j.id === judgeId) ?? null;
  // A judge removed on another device: forget the stale choice.
  useEffect(() => {
    if (judgeId && judges.length && !judges.some((j) => j.id === judgeId)) setJudgeId(null);
  }, [judgeId, judges]);
  const seen = useMemo(() => new Set(state?.judging.seenCarIds ?? []), [state]);
  const nominees = useMemo(() => new Set(selected?.nominees ?? []), [selected]);

  const eligible = useMemo(() => (state ? checkedInCars(state) : []), [state]);

  const cars = useMemo(() => {
    if (!state || !view) return [];
    const q = search.trim().toLowerCase();
    const scope = selected?.groupId ?? (denFilter === 'all' ? null : denFilter);
    const list = eligible
      .filter((i) => !scope || (i.car.groupId ?? i.racer?.groupId) === scope)
      .filter((i) => !q || `${i.number} ${i.racerName} ${i.carName}`.toLowerCase().includes(q))
      .filter((i) => {
        if (only === 'nominees') return nominees.has(i.car.id);
        if (only === 'unseen') return !seen.has(i.car.id);
        if (only === 'scored') return view.judgingTotal(i.car.id).scored > 0;
        return true;
      });
    if (sortBy === 'score' && criteria.length) {
      return list.sort((a, b) => view.judgingTotal(b.car.id).total - view.judgingTotal(a.car.id).total || a.number - b.number);
    }
    return list.sort((a, b) => a.number - b.number);
  }, [state, view, eligible, search, denFilter, selected, only, sortBy, nominees, seen, criteria.length]);

  if (!state || !view) return <div className="pit pit-loading">Connecting…</div>;

  const usedNames = new Set(judged.map((a) => a.name.toLowerCase()));
  const presetsLeft = DESIGN_AWARD_PRESETS.filter((n) => !usedNames.has(n.toLowerCase()));
  const seenCount = eligible.filter((i) => seen.has(i.car.id)).length;
  const scoringCar = scoringCarId ? carInfo(state, scoringCarId) : null;
  const photoCar = photoCarId ? state.cars.find((c) => c.id === photoCarId) : null;

  const addAward = async (name: string, groupId: string | null) => {
    const award = await run<Award>('addAward', { name, kind: 'design', groupId });
    if (award) setSelectedId(award.id);
  };

  const move = (award: Award, dir: -1 | 1) => {
    const ids = judged.map((a) => a.id);
    const i = ids.indexOf(award.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    run('reorderAwards', { ids });
  };

  const pick = (car: Car) => {
    if (!selected) return;
    run('setAwardWinner', { awardId: selected.id, carId: selected.carId === car.id ? null : car.id });
  };

  const selectAward = (id: string | null) => {
    setSelectedId(id);
    if (!id && only === 'nominees') setOnly('all');
  };

  return (
    <div className="pit jud">
      <header className="pit-header">
        <div>
          <div className="pit-kicker">Judges</div>
          <h1>{state.name}</h1>
        </div>
        <div className="pit-stats">
          {criteria.length > 0 && <JudgePicker judges={judges} judgeId={judgeId} onChange={setJudgeId} />}
          <span>
            <b>{seenCount}</b>/{eligible.length} seen
          </span>
          <span>
            <b>{judged.filter((a) => a.carId).length}</b>/{judged.length} awarded
          </span>
        </div>
      </header>

      <div className="jud-layout">
        <aside className="jud-awards">
          <div className="pit-card">
            <h3>Design awards</h3>
            {judged.length === 0 && <p className="jud-empty">No awards yet. Add some below.</p>}
            <ul className="jud-award-list">
              {judged.map((award) => {
                const info = award.carId ? carInfo(state, award.carId) : null;
                const shortlisted = award.nominees?.length ?? 0;
                return (
                  <li key={award.id} className={`jud-award ${award.id === selectedId ? 'is-selected' : ''} ${award.carId ? 'has-winner' : ''}`}>
                    <button className="jud-award-main" onClick={() => selectAward(award.id === selectedId ? null : award.id)}>
                      <span className="jud-award-name">
                        {award.name}
                        <small>
                          {groupPath(state, award.groupId)}
                          {shortlisted > 0 && ` · ★ ${shortlisted}`}
                        </small>
                      </span>
                      <span className="jud-award-winner">
                        {info ? (
                          <>
                            <span className="jud-thumb">
                              <CarPortrait car={info.car} color="#888" />
                            </span>
                            #{info.number}
                          </>
                        ) : (
                          <span className="jud-muted">{shortlisted > 0 ? 'pick from shortlist' : 'pick winner'}</span>
                        )}
                      </span>
                    </button>
                    <span className="jud-award-tools">
                      <button title="Move up" onClick={() => move(award, -1)}>
                        ▲
                      </button>
                      <button title="Move down" onClick={() => move(award, 1)}>
                        ▼
                      </button>
                      <button title="Remove" onClick={() => confirm(`Remove "${award.name}"?`) && run('removeAward', { id: award.id })}>
                        ✕
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="pit-card">
            <h3>Add an award</h3>
            <div className="jud-presets">
              {presetsLeft.map((name) => (
                <button key={name} className="pit-chip" onClick={() => addAward(name, null)}>
                  + {name}
                </button>
              ))}
            </div>
            <form
              className="jud-custom"
              onSubmit={(e) => {
                e.preventDefault();
                if (customName.trim()) addAward(customName.trim(), customGroup || null).then(() => setCustomName(''));
              }}
            >
              <input placeholder="Custom award name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
              <select value={customGroup} onChange={(e) => setCustomGroup(e.target.value)}>
                <option value="">Whole pack</option>
                {dens.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} only
                  </option>
                ))}
              </select>
              <button className="pbtn pbtn-primary" disabled={!customName.trim()}>
                Add
              </button>
            </form>
          </div>

          <RubricCard criteria={criteria} judges={judges} />

          {speed.length > 0 && (
            <div className="pit-card">
              <h3>Speed awards (from results)</h3>
              <ul className="jud-speed">
                {speed.map((a) => {
                  const info = a.carId ? carInfo(state, a.carId) : null;
                  return (
                    <li key={a.id}>
                      <span>{a.name}</span>
                      <span className={info ? '' : 'jud-muted'}>{info ? `#${info.number} ${info.racerName}` : 'not decided yet'}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>

        <section className="jud-gallery">
          <div className="jud-gallery-head">
            {selected ? (
              <div>
                <div className="pit-kicker">Pick the winner</div>
                <h2>{selected.name}</h2>
                <p className="jud-muted">
                  {selected.groupId ? `${groupPath(state, selected.groupId)} cars only. ` : ''}
                  Star the cars in the running, then tap one to award it; tap again to clear.
                </p>
              </div>
            ) : (
              <div>
                <div className="pit-kicker">Walk the table</div>
                <h2>All cars</h2>
                <p className="jud-muted">Tick each car as you look at it{criteria.length ? ', score it if you like' : ''}. Select an award on the left to pick a winner.</p>
              </div>
            )}
            <div className="jud-filters">
              <input className="pit-search" type="search" placeholder="Car # or name" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="pit-chips">
                <button className={`pit-chip ${only === 'all' ? 'is-active' : ''}`} onClick={() => setOnly('all')}>
                  All
                </button>
                {selected && (
                  <button className={`pit-chip ${only === 'nominees' ? 'is-active' : ''}`} onClick={() => setOnly('nominees')}>
                    ★ Shortlist ({nominees.size})
                  </button>
                )}
                <button className={`pit-chip ${only === 'unseen' ? 'is-active' : ''}`} onClick={() => setOnly('unseen')}>
                  Not seen yet ({eligible.length - seenCount})
                </button>
                {criteria.length > 0 && (
                  <>
                    <button className={`pit-chip ${only === 'scored' ? 'is-active' : ''}`} onClick={() => setOnly('scored')}>
                      Scored
                    </button>
                    <button className={`pit-chip ${sortBy === 'score' ? 'is-active' : ''}`} onClick={() => setSortBy(sortBy === 'score' ? 'number' : 'score')}>
                      {sortBy === 'score' ? 'Sorted by score' : 'Sort by score'}
                    </button>
                  </>
                )}
              </div>
              {!selected?.groupId && (
                <div className="pit-chips">
                  <button className={`pit-chip ${denFilter === 'all' ? 'is-active' : ''}`} onClick={() => setDenFilter('all')}>
                    Every den
                  </button>
                  {dens.map((g) => (
                    <button key={g.id} className={`pit-chip ${denFilter === g.id ? 'is-active' : ''}`} onClick={() => setDenFilter(g.id)}>
                      {g.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="jud-grid">
            {cars.map((info) => (
              <CarCard
                key={info.car.id}
                info={info}
                selected={selected}
                isSeen={seen.has(info.car.id)}
                isNominee={nominees.has(info.car.id)}
                hasRubric={criteria.length > 0}
                onPick={() => pick(info.car)}
                onScore={() => setScoringCarId(info.car.id)}
                onPhoto={() => setPhotoCarId(info.car.id)}
              />
            ))}
            {cars.length === 0 && <p className="jud-empty">No cars match.</p>}
          </div>
        </section>
      </div>

      {scoringCar && <ScoreSheet info={scoringCar} criteria={criteria} judge={judge} judges={judges} onPickJudge={setJudgeId} onClose={() => setScoringCarId(null)} />}
      {photoCar && (
        <div className="jud-modal-backdrop" onClick={() => setPhotoCarId(null)}>
          <div className="jud-modal jud-photo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="jud-modal-head">
              <h3>Car #{photoCar.number} photos</h3>
              <button className="pbtn pbtn-ghost" onClick={() => setPhotoCarId(null)}>
                Done
              </button>
            </div>
            <CarPhotos car={photoCar} />
          </div>
        </div>
      )}
    </div>
  );
}

function CarCard({
  info,
  selected,
  isSeen,
  isNominee,
  hasRubric,
  onPick,
  onScore,
  onPhoto,
}: {
  info: CarInfo;
  selected: Award | null;
  isSeen: boolean;
  isNominee: boolean;
  hasRubric: boolean;
  onPick: () => void;
  onScore: () => void;
  onPhoto: () => void;
}) {
  const { view, run } = useDerby();
  if (!view) return null;
  const isWinner = selected?.carId === info.car.id;
  const wins = view.awardsForCar(info.car.id).filter((a) => a.id !== selected?.id);
  const total = hasRubric ? view.judgingTotal(info.car.id) : null;
  return (
    <div className={`jud-car ${isWinner ? 'is-winner' : ''} ${selected ? 'is-pickable' : ''} ${isSeen ? 'is-seen' : ''} ${isNominee ? 'is-nominee' : ''}`}>
      <button className="jud-car-pick" onClick={onPick} disabled={!selected} title={selected ? `Award ${selected.name} to #${info.number}` : undefined}>
        <div className="jud-car-photo">
          <CarPortrait car={info.car} color="#c4c8d0" />
          {isWinner && <span className="jud-ribbon">Winner</span>}
          {!isWinner && isNominee && <span className="jud-star">★</span>}
        </div>
        <div className="jud-car-body">
          <span className="jud-car-num">#{info.number}</span>
          <span className="jud-car-name">
            {info.racerName}
            <small>{[info.carName, info.groupName].filter(Boolean).join(' · ')}</small>
          </span>
        </div>
        {wins.length > 0 && <div className="jud-car-wins">Also: {wins.map((w) => w.name).join(', ')}</div>}
      </button>
      <div className="jud-car-tools">
        <label className={`jud-seen ${isSeen ? 'is-on' : ''}`}>
          <input type="checkbox" checked={isSeen} onChange={(e) => run('setCarSeen', { carId: info.car.id, seen: e.target.checked })} />
          Seen
        </label>
        {selected && (
          <button className={`jud-tool ${isNominee ? 'is-on' : ''}`} onClick={() => run('setAwardNominee', { awardId: selected.id, carId: info.car.id, nominated: !isNominee })} title="Shortlist for this award">
            {isNominee ? '★ Shortlisted' : '☆ Shortlist'}
          </button>
        )}
        {total && (
          <button className={`jud-tool ${total.scored ? 'is-on' : ''}`} onClick={onScore} title={total.judges > 1 ? `Average of ${total.judges} judges` : 'Score this car'}>
            {total.scored ? `${fmtScore(total.total)}/${total.max}` : 'Score'}
            {total.judges > 1 && <small> · {total.judges} judges</small>}
          </button>
        )}
        <button className="jud-tool" onClick={onPhoto} title="Take or replace photos">
          📷
        </button>
      </div>
    </div>
  );
}

/** "Scoring as" in the header: which judge this device is. */
function JudgePicker({ judges, judgeId, onChange }: { judges: Judge[]; judgeId: string | null; onChange: (id: string | null) => void }) {
  const { run } = useDerby();
  const add = async () => {
    const name = prompt('Judge name');
    if (!name?.trim()) return;
    const judge = await run<Judge>('addJudge', { name });
    if (judge) onChange(judge.id);
  };
  return (
    <label className={`jud-judge ${judgeId ? '' : 'is-unset'}`}>
      <span>Scoring as</span>
      <select
        value={judgeId ?? ''}
        onChange={(e) => {
          if (e.target.value === '__new') add();
          else onChange(e.target.value || null);
        }}
      >
        <option value="">choose…</option>
        {judges.map((j) => (
          <option key={j.id} value={j.id}>
            {j.name}
          </option>
        ))}
        <option value="__new">+ New judge…</option>
      </select>
    </label>
  );
}

/** The optional rubric: a few named criteria with a top score each, and the judges who score it. */
function RubricCard({ criteria, judges }: { criteria: JudgingCriterion[]; judges: Judge[] }) {
  const { run } = useDerby();
  const [name, setName] = useState('');
  const [max, setMax] = useState(10);
  const [judgeName, setJudgeName] = useState('');
  const save = (next: { id?: string; name: string; max: number }[]) => run('setJudgingCriteria', { criteria: next });
  const presetsLeft = JUDGING_CRITERIA_PRESETS.filter((p) => !criteria.some((c) => c.name.toLowerCase() === p.name.toLowerCase()));
  return (
    <div className="pit-card">
      <h3>Scoring (optional)</h3>
      <p className="jud-muted jud-help">A rubric gives every judge the same yardstick. Scores are a guide; winners are still picked by hand.</p>
      {criteria.length > 0 && (
        <ul className="jud-criteria">
          {criteria.map((c) => (
            <li key={c.id}>
              <span>
                {c.name} <small className="jud-muted">out of {c.max}</small>
              </span>
              <button title="Remove" onClick={() => confirm(`Remove "${c.name}" and its scores?`) && save(criteria.filter((x) => x.id !== c.id))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="jud-presets">
        {presetsLeft.map((p) => (
          <button key={p.name} className="pit-chip" onClick={() => save([...criteria, p])}>
            + {p.name}
          </button>
        ))}
      </div>
      <form
        className="jud-custom"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save([...criteria, { name: name.trim(), max }]).then(() => setName(''));
        }}
      >
        <input placeholder="Custom criterion" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="number" min={1} max={100} value={max} onChange={(e) => setMax(Number(e.target.value) || 10)} title="Top score" />
        <button className="pbtn pbtn-primary" disabled={!name.trim()}>
          Add
        </button>
      </form>
      {criteria.length > 0 && (
        <>
          <h4 className="jud-subhead">Judges</h4>
          <p className="jud-muted jud-help">Each judge scores on their own sheet; a car's total is the average. Pick who you are under "Scoring as" at the top.</p>
          {judges.length > 0 && (
            <ul className="jud-criteria">
              {judges.map((j) => (
                <li key={j.id}>
                  <span>{j.name}</span>
                  <button title="Remove" onClick={() => confirm(`Remove ${j.name} and their scores?`) && run('removeJudge', { id: j.id })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="jud-custom"
            onSubmit={(e) => {
              e.preventDefault();
              if (judgeName.trim()) run('addJudge', { name: judgeName.trim() }).then(() => setJudgeName(''));
            }}
          >
            <input placeholder="Judge name" value={judgeName} onChange={(e) => setJudgeName(e.target.value)} />
            <button className="pbtn pbtn-primary" disabled={!judgeName.trim()}>
              Add
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/** One car's score sheet for the judge this device is: a row of buttons per criterion, with the other judges' marks alongside. */
function ScoreSheet({
  info,
  criteria,
  judge,
  judges,
  onPickJudge,
  onClose,
}: {
  info: CarInfo;
  criteria: JudgingCriterion[];
  judge: Judge | null;
  judges: Judge[];
  onPickJudge: (id: string | null) => void;
  onClose: () => void;
}) {
  const { state, view, run } = useDerby();
  if (!state || !view) return null;
  const scores = judge ? state.judging.sheets[judge.id]?.[info.car.id] ?? {} : {};
  const total = view.judgingTotal(info.car.id);
  const others = view.judgeTotals(info.car.id).filter((t) => t.judge.id !== judge?.id && t.scored > 0);
  const setScore = (criterionId: string, value: number | null) => judge && run('setCarScore', { judgeId: judge.id, carId: info.car.id, criterionId, value });
  return (
    <div className="jud-modal-backdrop" onClick={onClose}>
      <div className="jud-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Score sheet">
        <div className="jud-modal-head">
          <div>
            <div className="pit-kicker">Score sheet</div>
            <h3>
              #{info.number} {info.carName || info.racerName}
            </h3>
          </div>
          <span className="jud-total">
            {fmtScore(total.total)}
            <small>/{total.max}</small>
            {total.judges > 1 && <small className="jud-total-note">average of {total.judges} judges</small>}
          </span>
        </div>
        <div className="jud-sheet-photo">
          <CarPortrait car={info.car} color="#c4c8d0" />
        </div>
        {!judge && (
          <div className="jud-sheet-who">
            <p>Who is scoring on this device?</p>
            <JudgePicker judges={judges} judgeId={null} onChange={onPickJudge} />
          </div>
        )}
        {criteria.map((c) => {
          const value = scores[c.id];
          const steps = c.max <= 12 ? Array.from({ length: c.max }, (_, i) => i + 1) : null;
          const marks = others.map((t) => ({ name: t.judge.name, value: state.judging.sheets[t.judge.id]?.[info.car.id]?.[c.id] })).filter((m) => m.value !== undefined);
          return (
            <div key={c.id} className={`jud-sheet-row ${judge ? '' : 'is-locked'}`}>
              <div className="jud-sheet-label">
                {c.name}
                <small className="jud-muted">{value === undefined ? 'not scored' : `${value} of ${c.max}`}</small>
              </div>
              {steps ? (
                <div className="jud-steps">
                  {steps.map((n) => (
                    <button key={n} className={`jud-step ${value === n ? 'is-on' : ''} ${value !== undefined && n < value ? 'is-under' : ''}`} disabled={!judge} onClick={() => setScore(c.id, value === n ? null : n)}>
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <input type="number" min={0} max={c.max} value={value ?? ''} disabled={!judge} onChange={(e) => setScore(c.id, e.target.value === '' ? null : Number(e.target.value))} />
              )}
              {marks.length > 0 && <div className="jud-sheet-others">{marks.map((m) => `${m.name} ${m.value}`).join(' · ')}</div>}
            </div>
          );
        })}
        <div className="jud-modal-actions">
          {!state.judging.seenCarIds.includes(info.car.id) && (
            <button className="pbtn" onClick={() => run('setCarSeen', { carId: info.car.id, seen: true })}>
              Mark as seen
            </button>
          )}
          <button className="pbtn pbtn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
