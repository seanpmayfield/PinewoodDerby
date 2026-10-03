import type { Award, Heat, Round, Standing } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { carInfo, fmtTime, laneColor, ordinal, fmtEventDate, scoringLabel } from '../lib/format.ts';
import type { TimerStatus } from '../lib/types.ts';
import { CarPortrait } from './CarPortrait.tsx';
import { Callout } from './Callout.tsx';
import { IntroView } from './stage.tsx';
import { CarCarousel } from './Carousel.tsx';
import { brandingUrl } from '../lib/branding.ts';
import { VoteQr } from '../components/VoteQr.tsx';

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

export function WelcomeView() {
  const { state } = useDerby();
  if (!state) return null;
  const date = fmtEventDate(state.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <div className="aud-welcome">
      <div className="aud-welcome-flag" />
      <div className="aud-welcome-body">
        {state.branding.logo && <img className="aud-logo" src={brandingUrl(state.branding.logo)} alt="" />}
        <div className="aud-kicker">Welcome to the</div>
        <h1 className="aud-title">{state.name}</h1>
        <div className="aud-subtitle">{date}</div>
        {state.presentation.message && <div className="aud-message">{state.presentation.message}</div>}
      </div>
      <CarCarousel />
      {state.ballot.open && state.ballot.awardIds.length > 0 && <VoteQr />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heat: lineup, racing, result
// ---------------------------------------------------------------------------

export function HeatView({ round, heat, phase, timer }: { round: Round; heat: Heat; phase: 'lineup' | 'racing' | 'result'; timer: TimerStatus | null }) {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  const position = view.heatPosition(heat.id);
  const live = phase === 'result' ? heat.result?.lanes ?? [] : timer?.heatId === heat.id ? timer.liveLanes : [];
  const winnerLane = live.find((l) => l.place === 1);
  const winner = winnerLane ? heat.lanes[winnerLane.lane - 1] : null;
  const winnerInfo = winner ? carInfo(state, winner) : null;
  const onDeck = phase === 'lineup' ? view.onDeck(round.id, 2) : [];

  return (
    <div className={`aud-heat aud-heat-${phase}`}>
      {phase === 'lineup' ? (
        <Callout main="Now staging" tag="Racers to the start line" sub={`Heat ${position.position} of ${position.total} · ${round.name}`} />
      ) : (
        <div className="aud-heat-title">
          <span className="aud-kicker">
            {phase === 'racing' ? 'Racing' : 'Result'} · {round.name}
          </span>
          <h1 className="aud-heat-number">
            Heat {position.position} <span className="aud-of">of {position.total}</span>
          </h1>
        </div>
      )}

      <div className="aud-lanes" style={{ gridTemplateColumns: `repeat(${heat.lanes.length}, minmax(0, 1fr))` }}>
        {heat.lanes.map((carId, i) => {
          const lane = i + 1;
          const info = carId ? carInfo(state, carId) : null;
          const result = live.find((l) => l.lane === lane);
          const dead = state.deadLanes.includes(lane);
          const isWinner = result?.place === 1;
          return (
            <div key={lane} className={`aud-lane ${isWinner ? 'is-winner' : ''} ${!info ? 'is-empty' : ''} ${result ? 'has-result' : ''}`} style={{ ['--lane' as string]: laneColor(lane) }}>
              <div className="aud-lane-band">
                <span className="aud-lane-num">{lane}</span>
                <span className="aud-lane-word">Lane</span>
              </div>
              {info ? (
                <>
                  <CarPortrait car={info.car} color={laneColor(lane)} className="aud-lane-car" />
                  <div className="aud-car-name">{info.carName || info.racerName}</div>
                  {info.carName && <div className="aud-racer">{info.racerName}</div>}
                  <div className="aud-car-number">#{info.number}</div>
                  <div className="aud-meta">{info.groupName && <span>{info.groupName}</span>}</div>
                </>
              ) : (
                <div className="aud-empty-lane">{dead ? 'Lane closed' : 'Empty'}</div>
              )}
              <div className="aud-lane-result">
                {result ? (
                  <>
                    <span className="aud-place">{result.timeSec === null ? 'DNF' : ordinal(result.place ?? 0)}</span>
                    <span className="aud-time">{result.timeSec === null ? '' : fmtTime(result.timeSec)}</span>
                  </>
                ) : phase === 'racing' && info ? (
                  <span className="aud-time aud-time-pending">···</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {phase === 'result' && winnerInfo && (
        <div className="aud-winner-banner">
          <span className="aud-kicker">Heat winner</span>
          <span className="aud-winner-name">
            #{winnerInfo.number} {winnerInfo.racerName}
          </span>
        </div>
      )}

      {phase === 'lineup' && onDeck.length > 0 && (
        <div className="aud-ondeck">
          {onDeck.map((next, idx) => (
            <div key={next.id} className="aud-ondeck-row">
              <span className="aud-ondeck-label">{idx === 0 ? 'On deck' : 'Then'}</span>
              {next.lanes.map((carId, i) => {
                const info = carId ? carInfo(state, carId) : null;
                return (
                  <span key={i} className="aud-ondeck-car">
                    <span className="aud-ondeck-lane" style={{ background: laneColor(i + 1) }}>
                      {i + 1}
                    </span>
                    {info ? (
                      <>
                        <strong>{info.carName || info.racerName}</strong>
                        <span className="aud-dim"> {info.carName ? `${info.racerName} ` : ''}#{info.number}</span>
                      </>
                    ) : (
                      <span className="aud-dim">—</span>
                    )}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instant replay
// ---------------------------------------------------------------------------

export function ReplayView({ round, heat }: { round: Round; heat: Heat }) {
  const { state, view } = useDerby();
  if (!state || !view || !heat.replay || !heat.result) return null;
  const speed = state.presentation.replaySpeed;
  const position = view.heatPosition(heat.id);
  const placed = [...heat.result.lanes].filter((l) => l.carId).sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  return (
    <div className="aud-replay-screen">
      <div className="aud-replay-head">
        <span className="aud-replay-badge">
          <span className="aud-replay-dot" /> Instant replay
        </span>
        <span className="aud-replay-meta">
          Heat {position.position} · {round.name} · {speed}× speed
        </span>
      </div>
      <div className="aud-replay-video">
        <video
          key={heat.replay}
          src={`/api/replays/${heat.replay}`}
          autoPlay
          loop
          muted
          playsInline
          ref={(el) => {
            if (el) el.playbackRate = speed;
          }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            el.playbackRate = speed;
            // An unconverted WebM from Chrome has no duration until the element is pushed to its end once.
            if (el.duration === Infinity) {
              el.currentTime = 1e9;
              el.addEventListener('timeupdate', () => (el.currentTime = 0), { once: true });
            }
          }}
        />
      </div>
      <div className="aud-replay-results">
        {placed.map((l) => {
          const info = carInfo(state, l.carId!);
          return (
            <div key={l.lane} className={`aud-replay-result ${l.place === 1 ? 'is-winner' : ''}`} style={{ ['--lane' as string]: laneColor(l.lane) }}>
              <span className="aud-replay-place">{l.dnf ? 'DNF' : ordinal(l.place!)}</span>
              <span className="aud-replay-who">
                <b>{info?.carName || info?.racerName}</b>
                <small>
                  {info?.carName ? `${info.racerName} · ` : ''}#{info?.number} · lane {l.lane}
                </small>
              </span>
              <span className="aud-replay-time">{fmtTime(l.timeSec)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export function StandingsView({ round, final }: { round: Round; final: boolean }) {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  const standings = view.standings(round.id);
  const spec = view.roundSpec(round.specKey);
  const rows = standings.slice(0, 12);
  const label = scoringLabel(spec.scoring);
  return (
    <div className="aud-standings">
      <div className="aud-heat-title">
        <span className="aud-kicker">{final ? 'Final standings' : 'Standings so far'}</span>
        <h1 className="aud-heat-number">{round.name}</h1>
      </div>
      <ol className="aud-board">
        {rows.map((s, i) => (
          <StandingRow key={s.carId} standing={s} index={i} label={label} />
        ))}
      </ol>
      {standings.length > rows.length && <div className="aud-dim aud-more">and {standings.length - rows.length} more</div>}
    </div>
  );
}

function StandingRow({ standing, index, label }: { standing: Standing; index: number; label: string }) {
  const { state } = useDerby();
  if (!state) return null;
  const info = carInfo(state, standing.carId);
  return (
    <li className={`aud-board-row rank-${standing.rank}`} style={{ animationDelay: `${index * 70}ms` }}>
      <span className="aud-rank">{standing.runs ? standing.rank : '–'}</span>
      <span className="aud-board-thumbs">
        {info?.racer?.headshot ? (
          <video
            className="aud-board-face"
            src={`/api/headshots/${info.racer.headshot}`}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              // Show a still frame rather than looping a dozen videos at once.
              e.currentTarget.currentTime = 0.5;
            }}
          />
        ) : (
          <span className="aud-board-face is-empty" />
        )}
      </span>
      <span className="aud-board-name">
        {info?.racerName}
        <small>{[info?.carName, info?.groupName].filter(Boolean).join(' · ')}</small>
      </span>
      <span className="aud-board-score">
        {standing.scoreLabel}
        <small>{label}</small>
      </span>
      <span className="aud-board-runs">
        {standing.runs}/{standing.expectedRuns}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Awards ceremony
// ---------------------------------------------------------------------------

export function AwardsView() {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  const order = view.ceremonyOrder();
  const revealedIds = state.presentation.revealedAwardIds;
  const revealed = revealedIds.map((id) => order.find((a) => a.id === id)).filter((a): a is Award => !!a);
  const latest = revealed[revealed.length - 1];
  const podium = [1, 2, 3].map((place) => revealed.find((a) => a.kind === 'speed' && a.groupId === null && a.speed?.place === place));
  const showPodium = podium.some(Boolean);
  const nomineesFor = state.presentation.nomineesAwardId ? order.find((a) => a.id === state.presentation.nomineesAwardId && !revealedIds.includes(a.id)) : undefined;

  return (
    <div className={`aud-awards ${showPodium ? 'has-podium' : ''}`}>
      <div className="aud-awards-main">
        {nomineesFor ? <NomineesCard key={`n-${nomineesFor.id}`} award={nomineesFor} /> : latest ? <AwardCard key={latest.id} award={latest} big /> : <IntroView round={null} />}
        {revealed.length > 1 && (
          <div className="aud-awards-strip">
            {revealed
              .slice(0, -1)
              .reverse()
              .slice(0, 5)
              .map((a) => (
                <AwardCard key={a.id} award={a} />
              ))}
          </div>
        )}
      </div>
      {showPodium && (
        <div className="aud-podium">
          {[2, 1, 3].map((place) => {
            const award = podium[place - 1];
            const info = award?.carId ? carInfo(state, award.carId) : null;
            return (
              <div key={place} className={`aud-podium-slot place-${place} ${award ? 'revealed' : ''}`}>
                <div className="aud-podium-car">
                  {info && (
                    <>
                      <CarPortrait car={info.car} color={place === 1 ? '#ffd60a' : place === 2 ? '#d7dbe3' : '#d08a4b'} />
                      <div className="aud-podium-name">
                        #{info.number} {info.racerName}
                      </div>
                    </>
                  )}
                </div>
                <div className="aud-podium-block">
                  <span>{ordinal(place)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "And the nominees are": the shortlist, shown before the winner. */
function NomineesCard({ award }: { award: Award }) {
  const { state } = useDerby();
  if (!state) return null;
  const nominees = (award.nominees ?? []).map((id) => carInfo(state, id)).filter((i): i is NonNullable<typeof i> => !!i && !i.car.withdrawn);
  return (
    <div className={`aud-award is-big aud-nominees kind-${award.kind}`}>
      <span className="aud-kicker">{award.kind === 'speed' ? 'Speed award' : award.kind === 'custom' ? 'Special award' : 'Design award'}</span>
      <div className="aud-award-name">{award.name}</div>
      <div className="aud-nominees-kicker">And the nominees are…</div>
      <div className={`aud-nominees-grid count-${Math.min(nominees.length, 6)}`}>
        {nominees.map((info, i) => (
          <div key={info.car.id} className="aud-nominee" style={{ animationDelay: `${0.25 + i * 0.35}s` }}>
            <CarPortrait car={info.car} color="#c4c8d0" />
            <div className="aud-nominee-name">{info.carName || `Car #${info.number}`}</div>
            <div className="aud-nominee-racer">
              {info.racerName}
              {info.groupName ? ` · ${info.groupName}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AwardCard({ award, big = false }: { award: Award; big?: boolean }) {
  const { state } = useDerby();
  if (!state) return null;
  const info = award.carId ? carInfo(state, award.carId) : null;
  return (
    <div className={`aud-award ${big ? 'is-big' : ''} kind-${award.kind}`}>
      <span className="aud-kicker">{award.kind === 'speed' ? 'Speed award' : award.kind === 'custom' ? 'Special award' : 'Design award'}</span>
      <div className="aud-award-name">{award.name}</div>
      {info ? (
        <div className={`aud-award-winner ${big && info.racer?.headshot ? 'has-headshot' : ''}`}>
          {big && info.racer?.headshot && (
            <div className="aud-headshot aud-award-headshot">
              <video key={info.racer.headshot} src={`/api/headshots/${info.racer.headshot}`} autoPlay loop playsInline muted />
            </div>
          )}
          {big && <CarPortrait car={info.car} color="#ffd60a" className="aud-award-car" />}
          <div>
            <div className="aud-car-number">#{info.number}</div>
            <div className="aud-racer">{info.racerName}</div>
            <div className="aud-meta">
              {info.carName && <span>{info.carName}</span>}
              {info.groupName && <span>{info.groupName}</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="aud-dim">Winner not yet chosen</div>
      )}
    </div>
  );
}
