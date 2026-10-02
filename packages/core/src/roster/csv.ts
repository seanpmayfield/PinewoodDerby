/**
 * Roster import from CSV. Column detection is forgiving: a sheet exported from
 * Scoutbook, a pack spreadsheet, or a hand-typed list should all just work.
 */

export interface RosterRow {
  firstName: string;
  lastName: string;
  den?: string;
  rank?: string;
  carNumber?: number;
  carName?: string;
}

export type RosterField = 'firstName' | 'lastName' | 'fullName' | 'den' | 'rank' | 'carNumber' | 'carName';

export type ColumnMapping = Partial<Record<RosterField, number>>;

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_ALIASES: Record<RosterField, string[]> = {
  firstName: ['first name', 'firstname', 'first', 'given name', 'scout first name'],
  lastName: ['last name', 'lastname', 'last', 'surname', 'family name', 'scout last name'],
  fullName: ['name', 'scout', 'scout name', 'racer', 'racer name', 'full name'],
  den: ['den', 'group', 'den name', 'patrol', 'class', 'division'],
  rank: ['rank', 'level', 'grade'],
  carNumber: ['car number', 'car #', 'car no', 'number', '#', 'car', 'no.', 'no'],
  carName: ['car name', 'vehicle', 'vehicle name', 'nickname'],
};

export function detectColumns(header: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalized = header.map((h) => h.trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' '));
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [RosterField, string[]][]) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx >= 0 && !Object.values(mapping).includes(idx)) {
        mapping[field] = idx;
        break;
      }
    }
  }
  return mapping;
}

export function looksLikeHeader(row: string[]): boolean {
  const mapping = detectColumns(row);
  return Object.keys(mapping).length > 0 && !row.some((c) => /^\d+$/.test(c.trim()));
}

export function rowsToRoster(rows: string[][], mapping: ColumnMapping): RosterRow[] {
  const cell = (row: string[], field: RosterField): string | undefined => {
    const idx = mapping[field];
    if (idx === undefined) return undefined;
    const value = row[idx]?.trim();
    return value === '' ? undefined : value;
  };

  const roster: RosterRow[] = [];
  for (const row of rows) {
    let firstName = cell(row, 'firstName') ?? '';
    let lastName = cell(row, 'lastName') ?? '';
    const fullName = cell(row, 'fullName');
    if (!firstName && !lastName && fullName) {
      const split = splitName(fullName);
      firstName = split.firstName;
      lastName = split.lastName;
    }
    if (!firstName && !lastName) continue;
    const carNumberText = cell(row, 'carNumber');
    const carNumber = carNumberText ? Number(carNumberText.replace(/[^\d]/g, '')) : undefined;
    roster.push({
      firstName,
      lastName,
      den: cell(row, 'den'),
      rank: cell(row, 'rank'),
      carNumber: carNumber && Number.isFinite(carNumber) && carNumber > 0 ? carNumber : undefined,
      carName: cell(row, 'carName'),
    });
  }
  return roster;
}

/** "Last, First" or "First Last" (last word is the surname). */
export function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (trimmed.includes(',')) {
    const [last = '', first = ''] = trimmed.split(',').map((s) => s.trim());
    return { firstName: first, lastName: last };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1]! };
}

/** One-call convenience: text in, roster rows out, header auto-detected. */
export function importRosterCsv(text: string, mappingOverride?: ColumnMapping): { roster: RosterRow[]; mapping: ColumnMapping } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { roster: [], mapping: {} };
  const first = rows[0]!;
  const hasHeader = looksLikeHeader(first);
  const mapping = mappingOverride ?? (hasHeader ? detectColumns(first) : { fullName: 0, den: 1, carNumber: 2 });
  const body = hasHeader ? rows.slice(1) : rows;
  return { roster: rowsToRoster(body, mapping), mapping };
}
