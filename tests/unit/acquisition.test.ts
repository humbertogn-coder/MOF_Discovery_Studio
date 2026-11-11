import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyEligibility, eligibilityReason, rankPool, scoreRow, selectBatch } from '../../src/lib/acquisition';
import type { AlFile, AlPoolRow } from '../../src/lib/types';

const al: AlFile = JSON.parse(readFileSync(new URL('../../public/data/active-learning.json', import.meta.url), 'utf8'));

function row(id: string, p: Partial<AlPoolRow>): AlPoolRow {
  return { id, topology: 'pcu', metal: 'Zn', substituent: 'H', node_family: 'F', n_atoms: 50, mu: 1, sigma_tree: 0.2, sigma_seed: 0.01, is_ood: false, ood_reasons: [], ...p };
}

describe('acquisition score (frozen research data)', () => {
  for (const iter of al.iterations.filter((i) => i.mode === 'replay')) {
    it(`iteration ${iter.iteration}: reproduces recorded scores, ranking and batch`, () => {
      const r = iter.rules;
      const ranked = rankPool(iter.pool, iter.n_topo, r, r.sigma);
      for (const x of ranked) expect(Math.abs(x.score - (x.ref_score as number))).toBeLessThan(1e-12);
      expect(ranked.map((x) => x.id)).toEqual(iter.reference_ranking);
      const sel = selectBatch(ranked, r.n, r, r.forced);
      expect(sel.selected.map((x) => x.id)).toEqual(iter.reference_selection);
      expect(sel.filled).toBe(true);
    });
  }
  const sc = al.iterations.find((i) => i.mode === 'scenario')!;
  it('scenario: matches the Python reference computed at export', () => {
    const pool = applyEligibility(sc.pool, sc.rules);
    const ranked = rankPool(pool, sc.n_topo, sc.rules, 'sigma_tree');
    expect(ranked.map((x) => x.id)).toEqual(sc.reference_ranking);
    for (const x of ranked) expect(Math.abs(x.score - sc.reference_scores![x.id])).toBeLessThan(1e-12);
    const sel = selectBatch(ranked, sc.rules.n, sc.rules, []);
    expect(sel.selected.map((x) => x.id)).toEqual(sc.reference_selection);
  });
  it('study defaults come from the source code constants', () => {
    expect(al.code_defaults).toMatchObject({ kappa: 1, alpha: 0.3, beta: 0.5 });
  });
  it('does not rank already-computed candidates as prospective suggestions', () => {
    const done = new Set(sc.excluded_already_computed);
    expect(sc.pool.some((r) => done.has(r.id))).toBe(false);
  });
});

describe('acquisition logic (synthetic)', () => {
  const w = { kappa: 1, alpha: 0.3, beta: 0.5 };
  it('implements the documented formula, including max(1, N_topo)', () => {
    const r = row('a', { mu: 0.5, sigma_tree: 0.1, is_ood: true, topology: 'pcu' });
    expect(scoreRow(r, { pcu: 2 }, w)).toBeCloseTo(0.5 - 0.1 - 0.15 + 0.5, 12);
    expect(scoreRow(r, {}, w)).toBeCloseTo(0.5 - 0.1 - 0.3 + 0.5, 12);
  });
  it('breaks exact ties by original pool order (deterministic)', () => {
    const pool = [row('z', {}), row('a', {}), row('m', {})];
    expect(rankPool(pool, {}, w).map((r) => r.id)).toEqual(['z', 'a', 'm']);
    expect(rankPool(pool, {}, w).map((r) => r.id)).toEqual(rankPool(pool, {}, w).map((r) => r.id));
  });
  it('larger kappa promotes high-spread candidates', () => {
    const pool = [row('low', { mu: 0.5, sigma_tree: 0.1 }), row('high', { mu: 0.7, sigma_tree: 0.6 })];
    expect(rankPool(pool, {}, { ...w, kappa: 0 })[0].id).toBe('low');
    expect(rankPool(pool, {}, { ...w, kappa: 2 })[0].id).toBe('high');
  });
  it('enforces topology, metal and substituent caps and reports skip reasons', () => {
    const pool = [
      row('a', { mu: 0.1, topology: 'pcu', metal: 'Zn', substituent: 'H' }),
      row('b', { mu: 0.2, topology: 'pcu', metal: 'Co', substituent: 'F4' }),
      row('c', { mu: 0.3, topology: 'cds', metal: 'Zn', substituent: 'NH2' }),
      row('d', { mu: 0.4, topology: 'cds', metal: 'Cu', substituent: 'H' }),
    ];
    const res = selectBatch(rankPool(pool, {}, w), 4, { max_per_topology: 1, max_per_metal: 1, max_per_substituent: 1 });
    expect(res.selected.map((r) => r.id)).toEqual(['a']);
    expect(res.skipped.get('b')).toBe('topology_cap');
    expect(res.skipped.get('c')).toBe('metal_cap');
    expect(res.filled).toBe(false);
    const res2 = selectBatch(rankPool(pool, {}, w), 4, { max_per_topology: 9, max_per_metal: 9, max_per_substituent: 1 });
    expect(res2.skipped.get('d')).toBe('substituent_cap');
  });
  it('takes forced candidates first, counts them toward caps, and reports missing ones', () => {
    const pool = [row('a', { mu: 0.1 }), row('b', { mu: 0.9, topology: 'cds' }), row('c', { mu: 0.2 })];
    const res = selectBatch(rankPool(pool, {}, w), 2, { max_per_topology: 1, max_per_metal: 5, max_per_substituent: 5 }, ['b', 'nope']);
    expect(res.selected.map((r) => [r.id, r.forced])).toEqual([['b', true], ['a', false]]);
    expect(res.forcedMissing).toEqual(['nope']);
  });
  it('applies eligibility rules like scripts/06_select_batch.py', () => {
    const rules = { exclude_family: ['M3(CO2)6'], exclude_combo: ['P:cds:Zn'], max_atoms: 160 };
    expect(eligibilityReason(row('x', { node_family: 'M3(CO2)6' }), rules)).toBe('excluded_family');
    expect(eligibilityReason(row('y', { node_family: 'P', topology: 'cds', metal: 'Zn' }), rules)).toBe('excluded_combo');
    expect(eligibilityReason(row('z', { n_atoms: 161 }), rules)).toBe('too_many_atoms');
    expect(eligibilityReason(row('ok', { n_atoms: 160 }), rules)).toBeNull();
  });
});
