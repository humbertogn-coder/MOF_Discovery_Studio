import type { Candidate, Manifest } from './types';

/** RFC 4180 quoting; also neutralises spreadsheet formula injection (=, +, -, @ at cell start). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export const CANDIDATE_COLUMNS: { header: string; get: (c: Candidate) => unknown }[] = [
  { header: 'id', get: (c) => c.id },
  { header: 'formula', get: (c) => c.formula },
  { header: 'metal', get: (c) => c.metal },
  { header: 'open_shell', get: (c) => c.open_shell },
  { header: 'topology', get: (c) => c.topology },
  { header: 'node_family', get: (c) => c.node_family },
  { header: 'linker_label', get: (c) => c.linker_label },
  { header: 'linker_family', get: (c) => c.linker_family },
  { header: 'substituent', get: (c) => c.substituent },
  { header: 'n_atoms', get: (c) => c.structure.n_atoms },
  { header: 'density_g_cm3', get: (c) => c.structure.density_g_cm3 },
  { header: 'pld_A', get: (c) => c.structure.pld_A },
  { header: 'lcd_A', get: (c) => c.structure.lcd_A },
  { header: 'qc_passed', get: (c) => c.qc.passed },
  { header: 'gap_ml_eV', get: (c) => c.prediction?.mu_eV ?? null },
  { header: 'sigma_tree_eV', get: (c) => c.prediction?.sigma_tree_eV ?? null },
  { header: 'sigma_seed_eV', get: (c) => c.prediction?.sigma_seed_eV ?? null },
  { header: 'is_ood', get: (c) => c.prediction?.is_ood ?? null },
  { header: 'ood_reasons', get: (c) => (c.prediction?.ood_reasons ?? []).join(';') },
  { header: 'prediction_iteration', get: (c) => c.prediction?.iteration ?? null },
  { header: 'dft_status', get: (c) => c.dft.status },
  { header: 'dft_gap_eV', get: (c) => (c.dft.status === 'accepted' ? c.dft.gap_eV : null) },
  { header: 'dft_iteration', get: (c) => c.dft.iteration ?? null },
  { header: 'geometry_provenance', get: (c) => c.structure.geometry_provenance },
];

/** Plain RFC 4180 CSV (no comment lines, so any parser can read it); units are in the column names.
 *  Provenance and the field dictionary travel in the JSON export and DATA_README.txt. */
export function candidatesCsv(cs: Candidate[]): string {
  return toCsv(CANDIDATE_COLUMNS.map((c) => c.header), cs.map((c) => CANDIDATE_COLUMNS.map((col) => col.get(c))));
}

export function candidatesJson(cs: Candidate[], m: Manifest | null, filters: unknown): string {
  return JSON.stringify(
    {
      exported_from: 'MOF Discovery Studio',
      source_repository_url: m?.source_repository_url ?? null,
      source_commit_hash: m?.source_commit_hash ?? null,
      source_iteration: m?.source_iteration ?? null,
      schema_version: m?.schema_version ?? null,
      licence: m?.licenses_and_attributions.source_data ?? null,
      attribution: m?.licenses_and_attributions.attribution ?? null,
      citation_status: m?.citation_status ?? null,
      notes: [
        'All frameworks are hypothetical (PORMAKE-generated).',
        'prediction.mu_eV is a model estimate of the PBE reference gap, not a measurement.',
        'dft.gap_eV is present only for labels accepted under the study rules (dft.status = accepted).',
        'null means missing / not evaluated.',
      ],
      filters,
      record_count: cs.length,
      records: cs,
    },
    null,
    1,
  );
}

export function download(filename: string, content: string | Blob, type = 'text/csv;charset=utf-8'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
