import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyFilters, EMPTY_FILTERS, extent, matchesRange, METRICS, sortCandidates } from '../../src/lib/filters';
import type { Candidate, CandidatesFile } from '../../src/lib/types';

const data: CandidatesFile = JSON.parse(readFileSync(new URL('../../public/data/candidates.json', import.meta.url), 'utf8'));
const cs = data.records;

function fake(id: string, pld: number | null, mu: number | null, ood: boolean | null = false): Candidate {
  const base = structuredClone(cs[0]);
  base.id = id;
  base.slug = id;
  base.structure.pld_A = pld;
  base.prediction = mu === null ? null : { ...base.prediction!, mu_eV: mu, is_ood: ood };
  return base;
}

describe('range filters', () => {
  it('treats null as missing, controlled by includeMissing', () => {
    expect(matchesRange(null, { min: 0, max: 1, includeMissing: true })).toBe(true);
    expect(matchesRange(null, { min: 0, max: 1, includeMissing: false })).toBe(false);
    expect(matchesRange(0, { min: 0.1, max: 1, includeMissing: true })).toBe(false);
  });
  it('never treats a missing value as zero', () => {
    const xs = [fake('a', null, 0.5), fake('b', 0, 0.5), fake('c', 5, 0.5)];
    const out = applyFilters(xs, { ...EMPTY_FILTERS, ranges: { pld: { min: 0, max: 1, includeMissing: false } } });
    expect(out.map((c) => c.id)).toEqual(['b']);
  });
});

describe('filters on the real export', () => {
  it('multi-filter intersection equals manual intersection', () => {
    const f = { ...EMPTY_FILTERS, metals: ['Co', 'Fe'], topologies: ['cds'], ranges: { gap_ml: { min: 0, max: 0.6, includeMissing: false } } };
    const manual = cs.filter((c) => ['Co', 'Fe'].includes(c.metal!) && c.topology === 'cds' && (c.prediction?.mu_eV ?? 99) <= 0.6);
    expect(applyFilters(cs, f).map((c) => c.id).sort()).toEqual(manual.map((c) => c.id).sort());
  });
  it('OOD filters partition the dataset', () => {
    const a = applyFilters(cs, { ...EMPTY_FILTERS, ood: 'in_domain' }).length;
    const b = applyFilters(cs, { ...EMPTY_FILTERS, ood: 'ood_only' }).length;
    expect(a + b).toBe(cs.length);
    expect(b).toBe(cs.filter((c) => c.prediction?.is_ood === true).length);
  });
  it('DFT filters use the accepted status, not mere presence of a run', () => {
    const acc = applyFilters(cs, { ...EMPTY_FILTERS, dft: 'accepted' });
    expect(acc.every((c) => c.dft.status === 'accepted' && typeof c.dft.gap_eV === 'number')).toBe(true);
    const any = applyFilters(cs, { ...EMPTY_FILTERS, dft: 'computed' });
    expect(any.length).toBeGreaterThan(acc.length);
    expect(any.some((c) => c.dft.status === 'rejected')).toBe(true);
  });
  it('the accepted-DFT metric is null for non-accepted runs', () => {
    for (const c of cs) if (c.dft.status !== 'accepted') expect(METRICS.dft_gap.get(c)).toBeNull();
  });
  it('search matches names with punctuation and known analogues', () => {
    expect(applyFilters(cs, { ...EMPTY_FILTERS, query: 'pcu__Zn-N16__short-H' }).map((c) => c.id)).toContain('pcu__Zn-N16__short-H');
    expect(applyFilters(cs, { ...EMPTY_FILTERS, query: 'mof-5' }).map((c) => c.id)).toEqual(['pcu__Zn-N16__short-H']);
  });
  it('extent reports missing counts', () => {
    const e = extent(cs, 'pld')!;
    expect(e.min).toBeLessThanOrEqual(e.max);
    expect(e.missing).toBe(cs.filter((c) => c.structure.pld_A === null).length);
  });
});

describe('sorting', () => {
  it('puts missing values last in both directions and is deterministic', () => {
    const xs = [fake('b', 2, null), fake('a', 1, 0.3), fake('c', 3, 0.1)];
    expect(sortCandidates(xs, { key: 'gap_ml', dir: 'asc' }).map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(sortCandidates(xs, { key: 'gap_ml', dir: 'desc' }).map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(sortCandidates(cs, { key: 'id', dir: 'asc' })[0].id <= sortCandidates(cs, { key: 'id', dir: 'asc' })[1].id).toBe(true);
  });
});
