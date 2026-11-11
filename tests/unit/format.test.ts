import { describe, expect, it } from 'vitest';
import { csvCell, toCsv, candidatesCsv } from '../../src/lib/csv';
import { candidatePath, findBySlug, safeStructureUrl } from '../../src/lib/data';
import { fmt, formulaParts, MISSING } from '../../src/lib/format';
import { readFileSync } from 'node:fs';
import type { CandidatesFile } from '../../src/lib/types';

const cs = (JSON.parse(readFileSync(new URL('../../public/data/candidates.json', import.meta.url), 'utf8')) as CandidatesFile).records;

describe('formatting', () => {
  it('renders null/undefined/NaN as missing, never 0', () => {
    expect(fmt(null)).toBe(MISSING);
    expect(fmt(undefined)).toBe(MISSING);
    expect(fmt(NaN)).toBe(MISSING);
    expect(fmt(0)).toBe('0.00');
  });
  it('splits formulas into subscript parts', () => {
    expect(formulaParts('C24H12O13Zn4').filter((p) => p.sub).map((p) => p.text)).toEqual(['24', '12', '13', '4']);
  });
});

describe('CSV export', () => {
  it('quotes, escapes and neutralises formula injection', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(null)).toBe('');
    expect(csvCell(-0.5)).toBe('-0.5');
  });
  it('writes empty cells for missing values', () => {
    expect(toCsv(['a', 'b'], [[1, null]])).toBe('a,b\r\n1,\r\n');
  });
  it('exports DFT gaps only for accepted labels', () => {
    const lines = candidatesCsv(cs).trim().split('\r\n');
    const h = lines[0].split(',');
    const iStatus = h.indexOf('dft_status');
    const iGap = h.indexOf('dft_gap_eV');
    for (const l of lines.slice(1)) {
      const cells = l.split(',');
      if (cells[iStatus] !== 'accepted') expect(cells[iGap]).toBe('');
    }
    expect(lines.length - 1).toBe(cs.length);
  });
});

describe('paths and routes', () => {
  it('rejects unsafe structure paths', () => {
    expect(safeStructureUrl('structures/pormake/pcu__Zn-N16__short-H.cif')).toBe('/data/structures/pormake/pcu__Zn-N16__short-H.cif');
    for (const bad of ['../secret.cif', '/etc/passwd', 'https://evil/x.cif', 'structures/../../x.cif', 'structures/pormake/a.cif?x', null]) {
      expect(safeStructureUrl(bad)).toBeNull();
    }
  });
  it('encodes candidate routes with special characters and finds them again', () => {
    const odd = { ...cs[0], id: 'odd name/(x)', slug: 'odd-name-x' };
    expect(candidatePath(odd)).toBe('/candidate/odd-name-x');
    expect(candidatePath({ slug: 'a b#c' })).toBe('/candidate/a%20b%23c');
    expect(findBySlug([odd, ...cs], 'odd-name-x')?.id).toBe('odd name/(x)');
    expect(findBySlug(cs, 'pcu__Zn-N16__short-H')?.id).toBe('pcu__Zn-N16__short-H');
    expect(findBySlug(cs, 'does-not-exist')).toBeUndefined();
  });
});
