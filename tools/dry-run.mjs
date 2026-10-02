/**
 * Runs a whole derby against a server through the same commands the
 * coordinator screen uses: demo roster, every round and heat on the
 * simulated timer, DNFs confirmed, undo and redo, speed awards, a design
 * award, the ceremony, then an export and re-import. It prints what it did
 * and exits non-zero on the first thing that looks wrong.
 *
 * It creates and switches to a new event, so run it against a throwaway
 * server, fast:
 *
 *   cd packages/server
 *   DERBY_PORT=8090 DERBY_HTTPS_PORT=0 DERBY_DATA_DIR=/tmp/derby-dry DERBY_USB_BACKUP=0 DERBY_SIM_SPEED=0.02 DERBY_SIM_DNF=0.08 npx tsx src/index.ts
 *   DERBY_URL=http://localhost:8090 npm run dry-run
 *
 * It refuses the default address (the race laptop's live server) unless
 * --live is passed.
 */

import { api, BASE, sleep, state } from './lib.mjs';

if (BASE === 'http://localhost:8080' && !process.argv.includes('--live')) {
  console.error('Refusing to run against the default server; set DERBY_URL to a throwaway server or pass --live.');
  process.exit(2);
}

// --format <preset id> and --lanes <n> vary the event; defaults match the demo.
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const FORMAT = option('--format', 'den-then-final');
const LANES = Number(option('--lanes', '4'));

const startedAt = Date.now();
let checks = 0;
function check(condition, what) {
  checks++;
  if (!condition) {
    console.error(`FAILED: ${what}`);
    process.exit(1);
  }
}
const log = (text) => console.log(`${((Date.now() - startedAt) / 1000).toFixed(1).padStart(6)}s  ${text}`);

const timer = async () => (await (await fetch(`${BASE}/api/info`)).json()).timer;

// ---- Event -------------------------------------------------------------------------
const created = await api('newDerby', { name: `Dry run ${FORMAT} ${LANES} lanes`, laneCount: LANES, formatId: FORMAT });
check(typeof created === 'string', 'newDerby returns the new id');
await api('seedDemo');
let s = await state();
check(s.id === created, 'the new event is active');
check(s.racers.length > 20 && s.cars.length === s.racers.length, 'demo roster seeded');
check(s.format.id === FORMAT && s.laneCount === LANES, `format ${FORMAT} with ${LANES} lanes`);
log(`event "${s.name}": ${s.racers.length} racers, ${s.groups.length} groups, format ${s.format.id}`);

// ---- Racing ----------------------------------------------------------------------------
let heatsRun = 0;
let dnfs = 0;
let undone = false;
for (let guard = 0; guard < 40; guard++) {
  const step = await api('flowNext');
  if (step.stage === 'awards') break;
  if (step.stage === 'round-intro') {
    s = await state();
    log(`round intro: ${s.rounds.find((r) => r.id === step.roundId)?.name}`);
    continue;
  }
  check(step.stage === 'racing' && step.roundId, `flowNext moved to racing (got ${step.stage})`);
  const roundId = step.roundId;
  for (;;) {
    s = await state();
    const round = s.rounds.find((r) => r.id === roundId);
    const heat = round.heats.find((h) => h.status === 'pending' || h.status === 'staged');
    if (!heat) break;
    await api('armHeat', { heatId: heat.id });
    await api('simulateGate');
    const finishedHeat = (st) => {
      const h = st.rounds.find((r) => r.id === roundId).heats.find((x) => x.id === heat.id);
      return h.status === 'finished' ? h : null;
    };
    // A lane that never finishes: after the heat timeout the timer waits for the coordinator's say-so.
    const until = Date.now() + 60_000;
    let result = null;
    while (!result) {
      if (Date.now() > until) throw new Error(`Timed out waiting for heat ${heat.number} of ${round.name}`);
      result = finishedHeat(await state());
      if (result) break;
      const t = await timer();
      if (t.missingLanes.length) {
        dnfs += t.missingLanes.length;
        await api('confirmDnf');
      }
      await sleep(150);
    }
    check(result.result && result.result.lanes.filter((l) => l.carId).length === result.lanes.filter(Boolean).length, `heat ${heat.number} recorded a result for every occupied lane`);
    heatsRun++;
    if (!undone) {
      // Undo the first finished heat, check it is pending again, redo it.
      await api('undo');
      s = await state();
      const h = s.rounds.find((r) => r.id === roundId).heats.find((x) => x.id === heat.id);
      check(h.status !== 'finished', 'undo reopened the heat');
      await api('redo');
      s = await state();
      const h2 = s.rounds.find((r) => r.id === roundId).heats.find((x) => x.id === heat.id);
      check(h2.status === 'finished', 'redo restored the heat');
      undone = true;
      log('undo and redo of a finished heat work');
    }
  }
  s = await state();
  const round = s.rounds.find((r) => r.id === roundId);
  check(round.status === 'complete', `${round.name} is complete after its heats`);
  const standings = await (await fetch(`${BASE}/api/state`)).json().then((st) => st.rounds.find((r) => r.id === roundId));
  check(standings.heats.filter((h) => h.status === 'finished').length === round.heats.filter((h) => h.status !== 'voided').length, `${round.name}: every heat finished`);
  log(`${round.name}: ${round.heats.length} heats done`);
}
s = await state();
check(s.presentation.stage === 'awards', 'the show reached the awards');
check(s.rounds.length > 0 && s.rounds.every((r) => r.status === 'complete'), 'every round complete');
log(`${heatsRun} heats run across ${s.rounds.length} rounds, ${dnfs} DNF lanes confirmed`);

// ---- Awards ------------------------------------------------------------------------------
if (!s.awards.some((a) => a.kind === 'speed')) await api('generateSpeedAwards');
await api('computeSpeedAwards');
s = await state();
const speed = s.awards.filter((a) => a.kind === 'speed');
check(speed.length > 0 && speed.every((a) => a.carId), 'every speed award has a winner');
const design = s.awards.find((a) => a.kind === 'design') ?? (await api('addAward', { name: 'Best in Show', kind: 'design' }));
await api('setAwardNominee', { awardId: design.id, carId: s.cars[0].id, nominated: true });
await api('setAwardNominee', { awardId: design.id, carId: s.cars[1].id, nominated: true });
await api('setAwardWinner', { awardId: design.id, carId: s.cars[1].id });
let revealed = 0;
let nomineeMoments = 0;
for (let guard = 0; guard < 60; guard++) {
  const step = await api('flowNext');
  if (step.nominees) nomineeMoments++;
  else if (step.awardId) revealed++;
  else break;
}
s = await state();
check(revealed === s.awards.filter((a) => a.carId).length, `every award with a winner was revealed (${revealed})`);
check(nomineeMoments >= 1, 'the design award had its nominees moment');
log(`${revealed} awards revealed, ${nomineeMoments} nominee moment(s)`);

// ---- Export and import ---------------------------------------------------------------------
const exported = await fetch(`${BASE}/api/export`);
check(exported.ok && exported.headers.get('content-type')?.includes('zip'), 'export is a zip');
const zip = Buffer.from(await exported.arrayBuffer());
const imported = await (await fetch(`${BASE}/api/import?mode=copy`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip })).json();
check(imported.ok && imported.result.id !== s.id, 'import as a copy made a second event');
const copy = await state();
check(copy.rounds.length === s.rounds.length && copy.awards.length === s.awards.length, 'the copy has the same rounds and awards');
await api('loadDerby', { id: s.id });
await api('deleteDerby', { id: imported.result.id });
log(`export ${(zip.length / 1024).toFixed(0)} KB round-tripped`);

// ---- Reset -----------------------------------------------------------------------------------
await api('resetRaces');
s = await state();
check(s.rounds.length === 0 && s.awards.every((a) => a.kind !== 'speed' || !a.carId), 'reset cleared rounds and speed winners');
log(`reset races OK; ${checks} checks passed`);
