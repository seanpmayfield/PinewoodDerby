import type { DerbyEngine } from '@derby/core';
import { DerbyError, seededRandom } from '@derby/core';

const FIRST = ['Liam', 'Noah', 'Oliver', 'Elijah', 'Mateo', 'Lucas', 'Levi', 'Ezra', 'Asher', 'Leo', 'Ava', 'Mia', 'Luna', 'Zoe', 'Nora', 'Ivy', 'Ella', 'Maya', 'Ruby', 'Isla', 'Owen', 'Wyatt', 'Jack', 'Theo', 'Miles', 'Hazel', 'Wren', 'Cora', 'June', 'Sadie'];
const LAST = ['Nguyen', 'Garcia', 'Patel', 'Kim', 'Okafor', 'Smith', 'Johnson', 'Rivera', 'Brown', 'Cohen', 'Walsh', 'Sato', 'Lopez', 'Ali', 'Murphy', 'Novak', 'Reyes', 'Fischer', 'Hughes', 'Dubois'];
const CAR_NAMES = ['Lightning', 'Blue Streak', 'The Wedge', 'Rocket', 'Ghost', 'Shark Bite', 'Thunder', 'Banana Split', 'Night Fury', 'Red Baron', 'Wildcat', 'Pickle', 'Comet', 'Sub Zero', 'Hot Rod', 'Tornado', 'Batmobile', 'Golden Arrow', 'Iceberg', 'Firefly', 'Nitro', 'Slingshot', 'Glacier', 'Bumblebee'];

const DENS: { name: string; rank: string; size: number }[] = [
  { name: 'Lions', rank: 'Lion', size: 4 },
  { name: 'Tigers', rank: 'Tiger', size: 6 },
  { name: 'Wolves', rank: 'Wolf', size: 7 },
  { name: 'Bears', rank: 'Bear', size: 5 },
  { name: 'Webelos', rank: 'Webelos', size: 6 },
];

/** Populate an empty derby with a believable pack for demos and testing. */
export function seedDemo(engine: DerbyEngine): void {
  if (engine.state.racers.length > 0) throw new DerbyError('Demo data can only be loaded into an empty roster.', 'bad-state');
  const random = seededRandom(2027);
  const pick = <T>(list: T[], i: number) => list[i % list.length]!;
  engine.updateDerby({ name: 'Pack 123 Pinewood Derby' });
  const pack = engine.pack();
  engine.updateGroup(pack.id, { name: 'Pack 123' });
  let n = 0;
  for (const den of DENS) {
    const group = engine.addGroup({ name: den.name, kind: 'den', parentId: pack.id });
    for (let i = 0; i < den.size; i++) {
      const racer = engine.addRacer({
        firstName: pick(FIRST, n * 7),
        lastName: pick(LAST, n * 3),
        groupId: group.id,
        rank: den.rank,
      });
      const car = engine.addCar({ racerId: racer.id, name: pick(CAR_NAMES, n * 5) });
      engine.setWeight(car.id, Math.round((4.6 + random() * 0.45) * 100) / 100);
      engine.setInspection(car.id, { status: 'passed' });
      engine.setCheckedIn(racer.id, random() > 0.08);
      n++;
    }
  }
  const open = engine.addGroup({ name: 'Open Class', kind: 'class', parentId: pack.id });
  for (let i = 0; i < 3; i++) {
    const racer = engine.addRacer({ firstName: pick(FIRST, 11 + i), lastName: pick(LAST, 5 + i), groupId: open.id, rank: 'Adult' });
    const car = engine.addCar({ racerId: racer.id, name: pick(CAR_NAMES, 17 + i) });
    engine.setWeight(car.id, 4.99);
    engine.setInspection(car.id, { status: 'passed' });
    engine.setCheckedIn(racer.id, true);
  }
}
