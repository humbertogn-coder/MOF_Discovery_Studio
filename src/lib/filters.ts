import type { Candidate, DftStatus } from './types';

/** Numeric metrics available for range filters, sorting, and scatter axes. */
export type MetricKey = 'gap_ml' | 'sigma_tree' | 'sigma_seed' | 'pld' | 'lcd' | 'density' | 'n_atoms' | 'dft_gap';

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  unit: string;
  digits: number;
  kind: 'predicted' | 'geometry' | 'computed' | 'model';
  get: (c: Candidate) => number | null;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  gap_ml: { key: 'gap_ml', label: 'Predicted band gap (μ)', short: 'Pred. gap', unit: 'eV', digits: 2, kind: 'predicted', get: (c) => c.prediction?.mu_eV ?? null },
  sigma_tree: { key: 'sigma_tree', label: 'Model ensemble spread (σ_tree)', short: 'σ_tree', unit: 'eV', digits: 2, kind: 'model', get: (c) => c.prediction?.sigma_tree_eV ?? null },
  sigma_seed: { key: 'sigma_seed', label: 'Seed disagreement (σ_seed)', short: 'σ_seed', unit: 'eV', digits: 3, kind: 'model', get: (c) => c.prediction?.sigma_seed_eV ?? null },
  pld: { key: 'pld', label: 'Pore limiting diameter (PLD)', short: 'PLD', unit: 'Å', digits: 2, kind: 'geometry', get: (c) => c.structure.pld_A },
  lcd: { key: 'lcd', label: 'Largest cavity diameter (LCD)', short: 'LCD', unit: 'Å', digits: 2, kind: 'geometry', get: (c) => c.structure.lcd_A },
  density: { key: 'density', label: 'Density (generated cell)', short: 'Density', unit: 'g/cm³', digits: 3, kind: 'geometry', get: (c) => c.structure.density_g_cm3 },
  n_atoms: { key: 'n_atoms', label: 'Atoms in unit cell', short: 'Atoms', unit: '', digits: 0, kind: 'geometry', get: (c) => c.structure.n_atoms },
  dft_gap: { key: 'dft_gap', label: 'Accepted DFT gap (PBE-D3)', short: 'DFT gap', unit: 'eV', digits: 2, kind: 'computed', get: (c) => (c.dft.status === 'accepted' ? (c.dft.gap_eV ?? null) : null) },
};

export const RANGE_METRICS: MetricKey[] = ['gap_ml', 'sigma_tree', 'pld', 'lcd', 'density'];

export interface Range {
  min: number;
  max: number;
  /** keep candidates whose value is missing (null) */
  includeMissing: boolean;
}

export interface FilterState {
  query: string;
  metals: string[];
  topologies: string[];
  nodeFamilies: string[];
  linkerFamilies: string[];
  substituents: string[];
  openShell: 'any' | 'open' | 'closed';
  ood: 'include' | 'in_domain' | 'ood_only';
  dft: 'any' | 'accepted' | 'computed' | 'not_computed';
  ranges: Partial<Record<MetricKey, Range>>;
}

export const EMPTY_FILTERS: FilterState = {
  query: '',
  metals: [],
  topologies: [],
  nodeFamilies: [],
  linkerFamilies: [],
  substituents: [],
  openShell: 'any',
  ood: 'include',
  dft: 'any',
  ranges: {},
};

export function searchText(c: Candidate): string {
  return [c.id, c.formula, c.metal, c.topology, c.linker_label, c.linker_desc, c.linker_family, c.node_family, c.node_desc, c.dft.known_mof]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function matchesRange(v: number | null, r: Range | undefined): boolean {
  if (!r) return true;
  if (v === null || v === undefined || Number.isNaN(v)) return r.includeMissing;
  return v >= r.min - 1e-12 && v <= r.max + 1e-12;
}

const inSet = (v: string | null, set: string[]) => set.length === 0 || (v !== null && set.includes(v));

export function matches(c: Candidate, f: FilterState): boolean {
  if (f.query.trim()) {
    const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = searchText(c);
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  if (!inSet(c.metal, f.metals)) return false;
  if (!inSet(c.topology, f.topologies)) return false;
  if (!inSet(c.node_family, f.nodeFamilies)) return false;
  if (!inSet(c.linker_family, f.linkerFamilies)) return false;
  if (!inSet(c.substituent, f.substituents)) return false;
  if (f.openShell === 'open' && c.open_shell !== true) return false;
  if (f.openShell === 'closed' && c.open_shell !== false) return false;
  const ood = c.prediction?.is_ood;
  if (f.ood === 'in_domain' && ood !== false) return false;
  if (f.ood === 'ood_only' && ood !== true) return false;
  const s: DftStatus = c.dft.status;
  if (f.dft === 'accepted' && s !== 'accepted') return false;
  if (f.dft === 'computed' && s === 'not_available') return false;
  if (f.dft === 'not_computed' && s !== 'not_available') return false;
  for (const [k, r] of Object.entries(f.ranges) as [MetricKey, Range][]) {
    if (!matchesRange(METRICS[k].get(c), r)) return false;
  }
  return true;
}

export function applyFilters(cs: Candidate[], f: FilterState): Candidate[] {
  return cs.filter((c) => matches(c, f));
}

export function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.query.trim()) n++;
  n += [f.metals, f.topologies, f.nodeFamilies, f.linkerFamilies, f.substituents].filter((a) => a.length).length;
  if (f.openShell !== 'any') n++;
  if (f.ood !== 'include') n++;
  if (f.dft !== 'any') n++;
  n += Object.keys(f.ranges).length;
  return n;
}

export type SortKey = MetricKey | 'id' | 'metal' | 'topology' | 'linker';
export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

function sortValue(c: Candidate, key: SortKey): number | string | null {
  if (key === 'id') return c.id;
  if (key === 'metal') return c.metal;
  if (key === 'topology') return c.topology;
  if (key === 'linker') return c.linker_label;
  return METRICS[key].get(c);
}

/** Sort with missing values always last, ties broken by id for determinism. */
export function sortCandidates(cs: Candidate[], s: SortState): Candidate[] {
  const sign = s.dir === 'asc' ? 1 : -1;
  return [...cs].sort((a, b) => {
    const va = sortValue(a, s.key);
    const vb = sortValue(b, s.key);
    if (va === null && vb === null) return a.id.localeCompare(b.id);
    if (va === null) return 1;
    if (vb === null) return -1;
    const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return d !== 0 ? sign * d : a.id.localeCompare(b.id);
  });
}

export function uniqueValues(cs: Candidate[], get: (c: Candidate) => string | null): string[] {
  return [...new Set(cs.map(get).filter((v): v is string => v !== null))].sort();
}

export function extent(cs: Candidate[], key: MetricKey): { min: number; max: number; missing: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let missing = 0;
  for (const c of cs) {
    const v = METRICS[key].get(c);
    if (v === null) {
      missing++;
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max, missing } : null;
}
