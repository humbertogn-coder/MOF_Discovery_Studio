/**
 * Client-side port of src/mofal/acquisition.py (MOF_3D_Generator), applied to FROZEN predictions.
 *
 *   score(x) = mu(x) - kappa*sigma(x) - alpha / max(1, N_topo(x)) + beta * I_ood(x)
 *
 * Lower is better. Ties keep the original pool order (stable sort); the exporter verifies that
 * the frozen snapshot contains no exact ties, so this matches the original pandas ordering.
 * Nothing here retrains a model or produces new DFT data.
 */
import type { AlPoolRow, AlRules } from './types';

export interface Weights {
  kappa: number;
  alpha: number;
  beta: number;
}

export interface Caps {
  max_per_topology: number;
  max_per_metal: number;
  max_per_substituent: number;
}

export interface ScoredRow extends AlPoolRow {
  score: number;
  /** score components, in eV */
  term_mu: number;
  term_sigma: number;
  term_novelty: number;
  term_ood: number;
  rank: number;
  order: number;
}

export type SkipReason = 'topology_cap' | 'metal_cap' | 'substituent_cap' | 'batch_full' | null;

export interface SelectionResult {
  selected: (ScoredRow & { selection_rank: number; forced: boolean })[];
  /** why each ranked candidate above the last pick (and below) was not selected */
  skipped: Map<string, SkipReason>;
  requested: number;
  filled: boolean;
  forcedMissing: string[];
  counts: { topology: Record<string, number>; metal: Record<string, number>; substituent: Record<string, number> };
}

export function novelty(topology: string, nTopo: Record<string, number>): number {
  return 1 / Math.max(1, nTopo[topology] ?? 0);
}

export function scoreRow(row: AlPoolRow, nTopo: Record<string, number>, w: Weights, sigmaKey: 'sigma_tree' | 'sigma_seed' = 'sigma_tree'): number {
  // Same operation order as the original pandas expression.
  return row.mu - w.kappa * row[sigmaKey] - w.alpha * novelty(row.topology, nTopo) + w.beta * (row.is_ood ? 1 : 0);
}

export function rankPool(pool: AlPoolRow[], nTopo: Record<string, number>, w: Weights, sigmaKey: 'sigma_tree' | 'sigma_seed' = 'sigma_tree'): ScoredRow[] {
  const scored = pool.map((r, order) => {
    const term_mu = r.mu;
    const term_sigma = -w.kappa * r[sigmaKey];
    const term_novelty = -w.alpha * novelty(r.topology, nTopo);
    const term_ood = w.beta * (r.is_ood ? 1 : 0);
    return { ...r, score: scoreRow(r, nTopo, w, sigmaKey), term_mu, term_sigma, term_novelty, term_ood, rank: 0, order };
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  scored.forEach((r, i) => (r.rank = i + 1));
  return scored;
}

export function selectBatch(ranked: ScoredRow[], n: number, caps: Caps, forced: string[] = []): SelectionResult {
  const topo: Record<string, number> = {};
  const metal: Record<string, number> = {};
  const sub: Record<string, number> = {};
  const inc = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
  const selected: SelectionResult['selected'] = [];
  const picked = new Set<string>();
  const skipped = new Map<string, SkipReason>();
  const byId = new Map(ranked.map((r) => [r.id, r]));
  const forcedMissing: string[] = [];

  for (const id of forced) {
    const r = byId.get(id);
    if (!r) {
      forcedMissing.push(id);
      continue;
    }
    selected.push({ ...r, selection_rank: 0, forced: true });
    picked.add(id);
    inc(topo, r.topology);
    inc(metal, r.metal);
    inc(sub, r.substituent);
  }
  for (const r of ranked) {
    if (picked.has(r.id)) continue;
    if (selected.length >= n) {
      skipped.set(r.id, 'batch_full');
      continue;
    }
    if ((topo[r.topology] ?? 0) >= caps.max_per_topology) {
      skipped.set(r.id, 'topology_cap');
      continue;
    }
    if ((metal[r.metal] ?? 0) >= caps.max_per_metal) {
      skipped.set(r.id, 'metal_cap');
      continue;
    }
    if ((sub[r.substituent] ?? 0) >= caps.max_per_substituent) {
      skipped.set(r.id, 'substituent_cap');
      continue;
    }
    selected.push({ ...r, selection_rank: 0, forced: false });
    picked.add(r.id);
    inc(topo, r.topology);
    inc(metal, r.metal);
    inc(sub, r.substituent);
  }
  selected.forEach((r, i) => (r.selection_rank = i + 1));
  return { selected, skipped, requested: n, filled: selected.length >= n, forcedMissing, counts: { topology: topo, metal, substituent: sub } };
}

export type EligibilityReason = 'excluded_family' | 'excluded_combo' | 'too_many_atoms';

export function eligibilityReason(r: AlPoolRow, rules: Pick<AlRules, 'exclude_family' | 'exclude_combo' | 'max_atoms'>): EligibilityReason | null {
  if (rules.exclude_family.includes(r.node_family)) return 'excluded_family';
  for (const c of rules.exclude_combo) {
    const [f, t, m] = c.split(':');
    if (r.node_family === f && r.topology === t && r.metal === m) return 'excluded_combo';
  }
  if (rules.max_atoms != null && r.n_atoms > rules.max_atoms) return 'too_many_atoms';
  return null;
}

export function applyEligibility(pool: AlPoolRow[], rules: Pick<AlRules, 'exclude_family' | 'exclude_combo' | 'max_atoms'>): AlPoolRow[] {
  return pool.filter((r) => eligibilityReason(r, rules) === null);
}

export const SKIP_LABEL: Record<Exclude<SkipReason, null>, string> = {
  topology_cap: 'Topology cap reached',
  metal_cap: 'Metal cap reached',
  substituent_cap: 'Substituent cap reached',
  batch_full: 'Batch already full',
};

export const ELIGIBILITY_LABEL: Record<EligibilityReason, string> = {
  excluded_family: 'Node family excluded by study rule',
  excluded_combo: 'Family/topology/metal combination excluded by study rule',
  too_many_atoms: 'Above the study atom-count limit',
};
