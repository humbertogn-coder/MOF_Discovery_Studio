/** Types of the static data bundle written by scripts/export_research_data.py (schema 1.0.0). */

export type DftStatus = 'accepted' | 'rejected' | 'not_available' | 'ambiguous';

export interface Structure {
  n_atoms: number | null;
  density_g_cm3: number | null;
  a_A: number | null;
  b_A: number | null;
  c_A: number | null;
  alpha_deg: number | null;
  beta_deg: number | null;
  gamma_deg: number | null;
  volume_A3: number | null;
  pld_A: number | null;
  lcd_A: number | null;
  lcd_along_path_A: number | null;
  qc_passed: boolean | null;
  cif_path: string | null;
  cif_source_file: string | null;
  geometry_provenance: 'pormake_generated';
}

export interface Qc {
  passed: boolean | null;
  reasons: string[];
  min_distance_A: number | null;
  n_overlaps: number | null;
  n_nonbonded_contacts: number | null;
  n_components: number | null;
  n_bad_H: number | null;
  n_bad_C: number | null;
  composition_ok: boolean | null;
  node_rmsd_A: number | null;
}

export interface Prediction {
  target: 'PBE_reference_band_gap';
  mu_eV: number | null;
  sigma_seed_eV: number | null;
  sigma_tree_eV: number | null;
  is_ood: boolean | null;
  ood_reasons: string[];
  iteration: number | null;
}

export interface SpinSolution {
  start: string;
  energy_eV: number | null;
  gap_eV: number | null;
  scf_converged: boolean | null;
  mag_sum_abs_metal_muB: number | null;
}

export interface DftRecord {
  status: DftStatus;
  method?: string;
  gap_eV?: number | null;
  diagnostic_gap_eV?: number | null;
  iteration?: number | null;
  is_direct?: boolean | null;
  vbm_eV?: number | null;
  cbm_eV?: number | null;
  reasons?: string[];
  acceptance_notes?: string[];
  relax_converged_ionic?: boolean | null;
  relax_converged_electronic?: boolean | null;
  relax_stopped?: boolean | null;
  relax_fmax_final_eV_A?: number | null;
  relax_ionic_steps?: number | null;
  static_converged_electronic?: boolean | null;
  final_qc_passed?: boolean | null;
  final_qc_reasons?: string[];
  vol_change_pct?: number | null;
  max_angle_change_deg?: number | null;
  total_magnetization_muB?: number | null;
  spin_solution?: string | null;
  spin_state?: string | null;
  known_mof?: string | null;
  outcome?: string | null;
  prediction_at_selection?: { iteration: number; mu_eV: number | null; sigma_tree_eV: number | null; source_table: string } | null;
  spin_solutions?: SpinSolution[];
  sensitivity_runs?: { run: string; gap_eV: number | null; note: string | null }[];
  source_rows?: string[];
}

export interface DftGeometry {
  path: string;
  format: 'vasp';
  geometry_provenance: 'dft_relaxed';
  description: string;
  source_file: string;
  cell: { a_A: number; b_A: number; c_A: number; alpha_deg: number; beta_deg: number; gamma_deg: number };
  n_atoms: number;
}

export interface AlHistoryEntry {
  iteration: number;
  rank_in_pool: number;
  pool_size: number;
  acquisition_score: number | null;
  selected: boolean;
  selection_rank: number | null;
  forced: boolean;
}

export interface Candidate {
  id: string;
  slug: string;
  formula: string | null;
  metal: string | null;
  metal_ox_state: number | null;
  d_electrons: number | null;
  open_shell: boolean | null;
  node_family: string | null;
  node_id: string | null;
  node_desc: string | null;
  linker_label: string | null;
  linker_family: string | null;
  linker_desc: string | null;
  edge_id: string | null;
  n_rings: number | null;
  substituent: string | null;
  topology: string | null;
  structure: Structure;
  qc: Qc;
  prediction: Prediction | null;
  dft: DftRecord;
  dft_geometry: DftGeometry | null;
  al_history: AlHistoryEntry[];
  provenance: { catalogue: string; zeopp: string | null; prediction: string | null };
}

export interface CandidatesFile {
  schema_version: string;
  source_iteration: number;
  records: Candidate[];
}

export interface Manifest {
  app_release: string;
  schema_version: string;
  export_script_version: string;
  export_timestamp_utc: string;
  source_repository_url: string;
  source_commit_hash: string;
  source_commit_date: string | null;
  source_iteration: number;
  model_info: Record<string, unknown>;
  record_count: number;
  catalogue_enumerated: number;
  records_with_cif: number;
  records_with_prediction: number;
  records_with_dft_run: number;
  records_with_accepted_dft: number;
  records_with_rejected_dft: number;
  records_with_ambiguous_dft: number;
  records_with_dft_geometry: number;
  records_ood: number;
  dft_rows_in_source: number;
  dft_sensitivity_runs: number;
  dft_by_iteration: Record<string, Partial<Record<DftStatus, number>>>;
  active_learning_replay: Record<string, { max_abs_score_diff: number; ranking_order_matches: boolean; batch_matches: boolean; exact_ties: number }>;
  context_statistics: { id: string; text: string; source: string }[];
  licenses_and_attributions: {
    source_code: string;
    source_data: string;
    copyright: string | null;
    data_statement_source: string;
    attribution: string;
    not_redistributed: string[];
    third_party: string[];
  };
  citation_status: string;
  source_checksums_sha256: Record<string, string>;
  output_checksums_sha256: Record<string, string>;
  decisions: string[];
  warnings: string[];
}

export interface AlPoolRow {
  id: string;
  topology: string;
  metal: string;
  substituent: string;
  node_family: string;
  n_atoms: number;
  mu: number;
  sigma_tree: number;
  sigma_seed: number;
  is_ood: boolean;
  ood_reasons: string[];
  ref_score?: number;
}

export interface AlRules {
  n: number;
  kappa: number;
  alpha: number;
  beta: number;
  sigma: 'sigma_tree' | 'sigma_seed';
  max_per_topology: number;
  max_per_metal: number;
  max_per_substituent: number;
  forced: string[];
  exclude_family: string[];
  exclude_combo: string[];
  max_atoms: number | null;
}

export interface AlIteration {
  iteration: number;
  mode: 'replay' | 'scenario';
  description: string;
  rules: AlRules;
  rules_source: string;
  n_topo: Record<string, number>;
  n_topo_recomputed_from_final_dft?: Record<string, number>;
  n_not_yet_computed: number | null;
  pool_is_prefiltered: boolean;
  excluded_already_computed?: string[];
  pool: AlPoolRow[];
  reference_ranking: string[];
  reference_selection: string[];
  reference_scores?: Record<string, number>;
  reference_sources: string[];
  replay_check: { max_abs_score_diff: number; ranking_order_matches: boolean; batch_matches: boolean; exact_ties: number } | null;
}

export interface AlFile {
  schema_version: string;
  equation: string;
  lower_is_better: boolean;
  code_defaults: { alpha: number; beta: number; kappa: number; max_per_metal: number; max_per_substituent: number; max_per_topology: number };
  code_defaults_source: string;
  tie_break: string;
  iterations: AlIteration[];
}
