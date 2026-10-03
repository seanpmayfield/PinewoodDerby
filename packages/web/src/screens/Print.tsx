import { Link, useParams } from 'react-router-dom';
import { brandingUrl } from '../lib/branding.ts';
import { useDerby } from '../lib/derby.tsx';
import { carImage, carInfo, fmtEventDate, fmtTime, groupPath, ordinal, scoringLabel, type CarInfo } from '../lib/format.ts';
import { carCode, code128Svg } from '../print/code128.ts';
import type { Award, Round } from '@derby/core';
import '../print/print.css';

/**
 * Printable pages: heat sheets for the pit crew, standings and awards for
 * the wall, the roster for check-in. Plain black on white, one purpose each.
 */

export function PrintHeats() {
  const { state, view } = useDerby();
  const { roundId } = useParams();
  if (!state || !view) return null;
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round) return <Shell title="Heat sheet">Round not found.</Shell>;
  const order = view.heatOrder(round);
  return (
    <Shell title={`${round.name} — Heat sheet`} subtitle={`${order.length} heats · ${round.entries.length} cars`}>
      <table className="print-table">
        <thead>
          <tr>
            <th>Heat</th>
            {Array.from({ length: state.laneCount }, (_, i) => (
              <th key={i}>Lane {i + 1}</th>
            ))}
            <th className="print-wide">Notes</th>
          </tr>
        </thead>
        <tbody>
          {order.map((heat, i) => (
            <tr key={heat.id}>
              <td className="print-num">{i + 1}</td>
              {heat.lanes.map((carId, l) => {
                const info = carId ? carInfo(state, carId) : null;
                const result = heat.result?.lanes[l];
                return (
                  <td key={l}>
                    {info ? (
                      <>
                        <b>#{info.number}</b> {info.racerName}
                        {result && <div className="print-small">{result.dnf ? 'DNF' : `${fmtTime(result.timeSec)} ${result.place ? ordinal(result.place) : ''}`}</div>}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                );
              })}
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

export function PrintStandings() {
  const { state, view } = useDerby();
  const { roundId } = useParams();
  if (!state || !view) return null;
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round) return <Shell title="Standings">Round not found.</Shell>;
  return (
    <Shell title={`${round.name} — ${round.status === 'complete' ? 'Final standings' : 'Standings'}`} subtitle={groupPath(state, round.groupId)}>
      <RoundTable round={round} />
    </Shell>
  );
}

export function PrintAwards() {
  const { state } = useDerby();
  if (!state) return null;
  return (
    <Shell title="Awards" subtitle={state.name}>
      <AwardsTable />
    </Shell>
  );
}

/** Every award in ceremony order with its winner, if decided. */
function AwardsTable() {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  return (
    <table className="print-table">
      <thead>
        <tr>
          <th>Award</th>
          <th>Scope</th>
          <th>Winner</th>
        </tr>
      </thead>
      <tbody>
        {view.ceremonyOrder().map((a) => {
          const info = a.carId ? carInfo(state, a.carId) : null;
          return (
            <tr key={a.id}>
              <td>
                <b>{a.name}</b>
              </td>
              <td>{groupPath(state, a.groupId)}</td>
              <td>{info ? `#${info.number} ${info.racerName}${info.carName ? ` (${info.carName})` : ''}` : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function PrintRoster() {
  const { state } = useDerby();
  if (!state) return null;
  const rows = state.cars
    .map((c) => carInfo(state, c.id))
    .filter((i): i is CarInfo => !!i)
    .sort((a, b) => (a.groupName === b.groupName ? a.number - b.number : a.groupName.localeCompare(b.groupName)));
  return (
    <Shell title="Roster" subtitle={`${rows.length} cars`}>
      <table className="print-table">
        <thead>
          <tr>
            <th>Den</th>
            <th>Car</th>
            <th>Racer</th>
            <th>Car name</th>
            <th className="print-right">Weight</th>
            <th>Inspection</th>
            <th>Checked in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.car.id}>
              <td>{i.groupName}</td>
              <td className="print-num">#{i.number}</td>
              <td>{i.racerName}</td>
              <td>{i.carName}</td>
              <td className="print-right">{i.car.weightOz?.toFixed(2) ?? ''}</td>
              <td>{i.car.inspection.status === 'pending' ? '☐' : i.car.inspection.status}</td>
              <td>{i.racer?.checkedIn ? '✓' : '☐'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

/**
 * Car tags: one label per car with the number, racer, den and a barcode the
 * pit crew's scanner or phone reads to open the car. Sized for three-across
 * label sheets; plain paper and scissors work too.
 */
export function PrintLabels() {
  const { state } = useDerby();
  if (!state) return null;
  const rows = state.cars
    .filter((c) => !c.withdrawn)
    .map((c) => carInfo(state, c.id))
    .filter((i): i is CarInfo => !!i)
    .sort((a, b) => a.number - b.number);
  return (
    <Shell title="Car tags" subtitle={`${rows.length} tags · tape one to each car box or check-in card`}>
      <div className="labels">
        {rows.map((i) => (
          <div className="label" key={i.car.id}>
            <div className="label-event">{state.name}</div>
            <div className="label-num">#{i.number}</div>
            <div className="label-name">{i.racerName}</div>
            <div className="label-sub">{[i.carName, i.groupName].filter(Boolean).join(' · ')}</div>
            <div className="label-code" dangerouslySetInnerHTML={{ __html: code128Svg(carCode(i.number), { module: 2, height: 36 }) }} />
            <div className="label-text">{carCode(i.number)}</div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

/** Every round's standings and the awards on one document: the record of the day. Print to PDF from the browser. */
export function PrintResults() {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  const rounds = [...state.rounds].sort((a, b) => a.sequence - b.sequence);
  const awards = view.ceremonyOrder();
  const date = fmtEventDate(state.date);
  return (
    <Shell title="Results" subtitle={`${state.name}${date ? ` · ${date}` : ''}`}>
      {rounds.length === 0 && <p>No rounds have been scheduled.</p>}
      {rounds.map((round) => (
        <section key={round.id} className="print-section">
          <h2>{round.name}</h2>
          <RoundTable round={round} />
        </section>
      ))}
      {awards.length > 0 && (
        <section className="print-section">
          <h2>Awards</h2>
          <AwardsTable />
        </section>
      )}
    </Shell>
  );
}

function RoundTable({ round }: { round: Round }) {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  const standings = view.standings(round.id);
  const spec = view.roundSpec(round.specKey);
  return (
    <table className="print-table">
      <thead>
        <tr>
          <th className="print-num">Place</th>
          <th>Car</th>
          <th>Racer</th>
          <th>Den</th>
          <th className="print-right">{scoringLabel(spec.scoring, 'long')}</th>
          <th className="print-right">Best</th>
          <th className="print-right">Runs</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((s) => {
          const info = carInfo(state, s.carId);
          return (
            <tr key={s.carId}>
              <td className="print-num">{s.runs ? s.rank : '—'}</td>
              <td>
                <b>#{info?.number}</b> {info?.carName}
              </td>
              <td>{info?.racerName}</td>
              <td>{info?.groupName}</td>
              <td className="print-right">{s.scoreLabel}</td>
              <td className="print-right">{fmtTime(s.bestTime)}</td>
              <td className="print-right">
                {s.runs}/{s.expectedRuns}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** One certificate per award with a winner, a page each, with the car cutout when there is one. */
export function PrintCertificates() {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  const awards = view.ceremonyOrder().filter((a) => a.carId);
  const date = fmtEventDate(state.date);
  return (
    <div className="print certs">
      <div className="print-toolbar">
        <Link to="/coordinator">‹ Coordinator</Link>
        <span className="print-small">
          {awards.length} certificate{awards.length === 1 ? '' : 's'} · one page each · choose "Save as PDF" in the print dialog to keep a copy
        </span>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          Print
        </button>
      </div>
      {awards.length === 0 && <p>No awards have winners yet. Speed awards fill in from the results; design awards come from the Judges screen.</p>}
      {awards.map((a) => (
        <Certificate key={a.id} award={a} date={date} />
      ))}
    </div>
  );
}

function Certificate({ award, date }: { award: Award; date: string }) {
  const { state, view } = useDerby();
  if (!state || !view || !award.carId) return null;
  const info = carInfo(state, award.carId);
  if (!info) return null;
  const image = carImage(info.car);
  let stat: string | null = null;
  if (award.kind === 'speed' && award.speed) {
    const round = view.roundsForSpec(award.speed.roundKey).find((r) => !award.groupId || r.groupId === award.groupId);
    const standing = round ? view.standings(round.id).find((s) => s.carId === award.carId) : undefined;
    if (standing) stat = `${ordinal(award.speed.place)} place · ${standing.scoreLabel}${standing.bestTime ? ` · best ${fmtTime(standing.bestTime)} s` : ''}`;
  }
  return (
    <section className="cert">
      <div className="cert-frame">
        {state.branding.logo && <img className="cert-logo" src={brandingUrl(state.branding.logo)} alt="" />}
        <div className="cert-event">{state.name}</div>
        <div className="cert-kicker">{award.kind === 'speed' ? 'Speed award' : award.kind === 'design' ? 'Design award' : 'Award'}</div>
        <h2 className="cert-award">{award.name}</h2>
        <div className="cert-scope">{groupPath(state, award.groupId)}</div>
        <div className="cert-presented">presented to</div>
        <div className="cert-name">{info.racerName}</div>
        <div className="cert-car">
          {info.carName ? <span className="cert-carname">“{info.carName}”</span> : null} Car #{info.number}
          {info.groupName ? ` · ${info.groupName}` : ''}
        </div>
        {image && <img className={`cert-photo ${image.cutout ? 'is-cutout' : ''}`} src={image.url} alt="" />}
        {stat && <div className="cert-stat">{stat}</div>}
        <div className="cert-date">{date}</div>
        <div className="cert-sign">
          <span>Cubmaster</span>
          <span>Race coordinator</span>
        </div>
      </div>
    </section>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const { state } = useDerby();
  return (
    <div className="print">
      <div className="print-toolbar">
        <Link to="/coordinator">‹ Coordinator</Link>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <header className="print-header">
        <div className="print-event">{state?.name}</div>
        <h1>{title}</h1>
        {subtitle && <div className="print-sub">{subtitle}</div>}
      </header>
      {children}
      <footer className="print-footer">Printed {new Date().toLocaleString()}</footer>
    </div>
  );
}
