import type { Heat, Round } from '@derby/core';
import { useDerby } from '../lib/derby.tsx';
import { carInfo, fmtTime, laneColor } from '../lib/format.ts';
import { CarPortrait } from './CarPortrait.tsx';
import { Callout } from './Callout.tsx';

/** Animated racing backdrop for the staging and countdown screens. */
function HypeBackdrop({ color }: { color?: string }) {
  return (
    <div className="aud-hype" style={color ? ({ ['--hype' as string]: color } as React.CSSProperties) : undefined}>
      <div className="aud-hype-stripes" />
      <div className="aud-hype-streaks" />
      <div className="aud-hype-flag" />
    </div>
  );
}

/**
 * Full-screen title card for a round (or the awards): a big number, the name,
 * and the cars in it parading across the bottom.
 */
export function IntroView({ round }: { round: Round | null }) {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  let kicker: string;
  let title: string;
  let subtitle: string;
  let carIds: string[];
  if (round) {
    const spec = view.roundSpec(round.specKey);
    const group = round.groupId ? state.groups.find((g) => g.id === round.groupId) : null;
    kicker = `Round ${round.sequence}`;
    title = group ? group.name : spec.name;
    const heats = view.heatOrder(round).length;
    subtitle = group ? `${spec.name} · ${round.entries.length} cars · ${heats} heats` : spec.entry.kind === 'advance' ? `The fastest from every den · ${round.entries.length} cars · ${heats} heats` : `${round.entries.length} cars · ${heats} heats`;
    carIds = round.entries;
  } else {
    kicker = 'And now';
    title = 'The Awards';
    subtitle = state.name;
    carIds = state.cars.filter((c) => !c.withdrawn).map((c) => c.id);
  }
  const parade = carIds.map((id) => carInfo(state, id)).filter((i): i is NonNullable<typeof i> => !!i);
  return (
    <div className="aud-intro">
      <HypeBackdrop color={round ? '#ff3b1f' : '#ffd60a'} />
      <div className="aud-intro-burst" />
      <div className="aud-intro-body">
        <div className="aud-intro-kicker">{kicker}</div>
        <h1 className="aud-intro-title">{title}</h1>
        <div className="aud-intro-sub">{subtitle}</div>
      </div>
      {parade.length > 0 && (
        <div className="aud-intro-parade">
          <div className="aud-intro-track" style={{ animationDuration: `${Math.max(18, parade.length * 2.2)}s` }}>
            {[...parade, ...parade].map((info, i) => (
              <div key={`${info.car.id}-${i}`} className="aud-intro-car">
                <CarPortrait car={info.car} color={laneColor((i % 4) + 1)} />
                <span>
                  <b>{info.carName || info.racerName}</b>
                  <small>{info.carName ? info.racerName : `#${info.number}`}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact lane list used beside the spotlight and under the light tree. */
function LaneStrip({ heat, highlightCarId, vertical = false }: { heat: Heat; highlightCarId?: string | null; vertical?: boolean }) {
  const { state } = useDerby();
  if (!state) return null;
  return (
    <div className={`aud-strip ${vertical ? 'is-vertical' : ''}`}>
      {heat.lanes.map((carId, i) => {
        const lane = i + 1;
        const info = carId ? carInfo(state, carId) : null;
        const dead = state.deadLanes.includes(lane);
        return (
          <div key={lane} className={`aud-strip-lane ${carId === highlightCarId ? 'is-spot' : ''} ${!info ? 'is-empty' : ''}`} style={{ ['--lane' as string]: laneColor(lane) }}>
            <span className="aud-strip-num">{lane}</span>
            {info ? (
              <span className="aud-strip-body">
                <b>{info.carName || info.racerName}</b>
                <small>
                  {info.carName ? `${info.racerName} · ` : ''}#{info.number}
                </small>
              </span>
            ) : (
              <span className="aud-strip-body aud-dim">{dead ? 'Lane closed' : 'Empty'}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** "Next up" screen with one racer in the spotlight. */
export function SpotlightView({ round, heat }: { round: Round; heat: Heat }) {
  const { state, view } = useDerby();
  if (!state || !view) return null;
  const position = view.heatPosition(heat.id);
  const spotId = heat.spotlightCarId ?? heat.lanes.find((c) => c !== null) ?? null;
  const info = spotId ? carInfo(state, spotId) : null;
  const lane = spotId ? heat.lanes.indexOf(spotId) + 1 : 0;
  const color = lane ? laneColor(lane) : '#ff3b1f';
  const standing = spotId ? view.standings(round.id).find((s) => s.carId === spotId) : undefined;
  const stat = !standing || standing.runs === 0 ? 'First run of this round' : standing.bestTime !== null ? `Best time so far ${fmtTime(standing.bestTime)}` : `${standing.runs} run${standing.runs === 1 ? '' : 's'} so far`;

  return (
    <div className="aud-stage-screen aud-spot">
      <HypeBackdrop color={color} />
      <Callout main="Next up" tag="Cars on the pins" sub={`Heat ${position.position} of ${position.total} · ${round.name}`} tone="armed" />
      <div className="aud-spot-body">
        {info && (
          <div className={`aud-spot-card ${info.racer?.headshot ? 'has-headshot' : ''}`} style={{ ['--lane' as string]: color }}>
            <span className="aud-kicker aud-spot-kicker">Racer spotlight</span>
            {info.racer?.headshot && (
              <div className="aud-headshot">
                {/* Silent here: the spotlight is for staging, the sound is saved for the award reveal. */}
                <video key={info.racer.headshot} src={`/api/headshots/${info.racer.headshot}`} autoPlay loop playsInline muted />
              </div>
            )}
            <div className="aud-spot-photo">
              <CarPortrait car={info.car} color={color} />
            </div>
            <div className="aud-spot-name">{info.carName || info.racerName}</div>
            <div className="aud-spot-car">
              {info.carName && <span className="aud-spot-carname">{info.racerName}</span>}
              <span className="aud-spot-number">#{info.number}</span>
            </div>
            <div className="aud-spot-meta">
              {info.groupName && <span>{info.groupName}</span>}
              {info.racer?.rank && <span>{info.racer.rank}</span>}
              <span>Lane {lane}</span>
            </div>
            <div className="aud-spot-stat">{stat}</div>
          </div>
        )}
        <div className="aud-spot-lanes">
          <span className="aud-kicker">Lanes</span>
          <LaneStrip heat={heat} highlightCarId={spotId} vertical />
          <div className="aud-spot-hint">Cars to the line</div>
        </div>
      </div>
    </div>
  );
}

/**
 * How many lights are on after `elapsed` ms: 0 while the staging lights hold,
 * 1..lights for the ambers, lights + 1 for green.
 */
export function countdownLit(elapsed: number, lights: number, intervalMs: number, stageMs: number): number {
  if (elapsed < stageMs) return 0;
  return Math.min(lights + 1, 1 + Math.floor((elapsed - stageMs) / intervalMs));
}

/**
 * Drag-race light tree. `startedAt` is the moment this screen saw the countdown
 * begin (local clock), so it does not depend on the server's clock agreeing.
 * The scout opens the gate on green.
 */
export function TreeView({ round, heat, startedAt, lights, intervalMs, stageMs, now }: { round: Round; heat: Heat; startedAt: number; lights: number; intervalMs: number; stageMs: number; now: number }) {
  const { view } = useDerby();
  if (!view) return null;
  const position = view.heatPosition(heat.id);
  const elapsed = Math.max(0, now - startedAt);
  const lit = countdownLit(elapsed, lights, intervalMs, stageMs);
  const go = lit > lights;

  return (
    <div className={`aud-stage-screen aud-tree-screen ${go ? 'is-go' : ''}`}>
      <HypeBackdrop color={go ? '#30e07a' : '#ffb000'} />
      <div className="aud-heat-title">
        <span className="aud-kicker">{round.name}</span>
        <h1 className="aud-heat-number">
          Heat {position.position} <span className="aud-of">of {position.total}</span>
        </h1>
      </div>
      <div className="aud-tree-body">
        <div className="aud-tree">
          <div className="aud-tree-row stage">
            <span className="aud-bulb white on" />
            <span className="aud-bulb white on" />
          </div>
          <div className="aud-tree-row stage">
            <span className={`aud-bulb white ${elapsed >= stageMs / 2 ? 'on' : ''}`} />
            <span className={`aud-bulb white ${elapsed >= stageMs / 2 ? 'on' : ''}`} />
          </div>
          {Array.from({ length: lights }, (_, i) => (
            <div key={i} className="aud-tree-row">
              <span className={`aud-bulb amber ${lit >= i + 1 && !go ? 'on' : ''}`} />
              <span className={`aud-bulb amber ${lit >= i + 1 && !go ? 'on' : ''}`} />
            </div>
          ))}
          <div className="aud-tree-row">
            <span className={`aud-bulb green ${go ? 'on' : ''}`} />
            <span className={`aud-bulb green ${go ? 'on' : ''}`} />
          </div>
        </div>
        <div className="aud-tree-word">{go ? 'GO!' : lit === 0 ? (elapsed >= stageMs / 2 ? 'Staged' : 'Ready') : 'Set'}</div>
      </div>
      <LaneStrip heat={heat} />
    </div>
  );
}
