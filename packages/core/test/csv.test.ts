import { describe, expect, it } from 'vitest';
import { detectColumns, importRosterCsv, parseCsv, splitName } from '../src/roster/csv.js';

describe('parseCsv', () => {
  it('handles quotes, embedded commas and CRLF', () => {
    const rows = parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n');
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('drops blank lines and a BOM', () => {
    expect(parseCsv('﻿x,y\n\n1,2\n')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });
});

describe('detectColumns', () => {
  it('maps common headers', () => {
    expect(detectColumns(['First Name', 'Last Name', 'Den', 'Car #'])).toEqual({
      firstName: 0,
      lastName: 1,
      den: 2,
      carNumber: 3,
    });
  });

  it('accepts a single name column', () => {
    expect(detectColumns(['Scout', 'Rank'])).toEqual({ fullName: 0, rank: 1 });
  });
});

describe('splitName', () => {
  it('splits both orders', () => {
    expect(splitName('Smith, Alex')).toEqual({ firstName: 'Alex', lastName: 'Smith' });
    expect(splitName('Alex J Smith')).toEqual({ firstName: 'Alex J', lastName: 'Smith' });
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
  });
});

describe('importRosterCsv', () => {
  it('imports a typical pack spreadsheet', () => {
    const csv = [
      'First Name,Last Name,Den,Rank,Car Number,Car Name',
      'Alex,Smith,Wolves,Wolf,12,Lightning',
      'Sam,Jones,Bears,Bear,,',
      '"Lee","O""Brien",Wolves,Wolf,7,"Red, White & Blue"',
    ].join('\n');
    const { roster } = importRosterCsv(csv);
    expect(roster).toEqual([
      { firstName: 'Alex', lastName: 'Smith', den: 'Wolves', rank: 'Wolf', carNumber: 12, carName: 'Lightning' },
      { firstName: 'Sam', lastName: 'Jones', den: 'Bears', rank: 'Bear', carNumber: undefined, carName: undefined },
      { firstName: 'Lee', lastName: 'O"Brien', den: 'Wolves', rank: 'Wolf', carNumber: 7, carName: 'Red, White & Blue' },
    ]);
  });

  it('falls back to name,den,number without a header', () => {
    const { roster } = importRosterCsv('Alex Smith,Wolves,3\nSam Jones,Bears,4');
    expect(roster.map((r) => [r.firstName, r.lastName, r.den, r.carNumber])).toEqual([
      ['Alex', 'Smith', 'Wolves', 3],
      ['Sam', 'Jones', 'Bears', 4],
    ]);
  });
});
