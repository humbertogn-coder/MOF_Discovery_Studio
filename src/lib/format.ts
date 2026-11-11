/** Formatting helpers. Missing values are NEVER rendered as zero. */
export const MISSING = '—';

export function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return MISSING;
  return v.toFixed(digits);
}

export function fmtBool(v: boolean | null | undefined, yes = 'Yes', no = 'No'): string {
  if (v === null || v === undefined) return MISSING;
  return v ? yes : no;
}

export function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

/** Render chemical formulas with subscript digits, as text (no HTML injection). */
export function formulaParts(formula: string | null): { text: string; sub: boolean }[] {
  if (!formula) return [];
  const parts: { text: string; sub: boolean }[] = [];
  const re = /(\d+)|(\D+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) parts.push({ text: m[0], sub: Boolean(m[1]) });
  return parts;
}

export const TOPOLOGY_NOTE: Record<string, string> = {
  pcu: 'pcu — primitive cubic net (6-c)',
  nbo: 'nbo — NbO net (4-c, square planar)',
  cds: 'cds — CdSO4 net (4-c, square planar)',
  dia: 'dia — diamond net (4-c, tetrahedral)',
  bcu: 'bcu — body-centred cubic net (8-c)',
};

export const SUBSTITUENT_NOTE: Record<string, string> = {
  H: 'unsubstituted',
  NH2: 'amino',
  F4: 'tetrafluoro (BDC)',
  F8: 'octafluoro (BPDC)',
  Nring1: 'one ring N (pyridine / phenylpyridine)',
  Nring2: 'two ring N (bipyridine)',
};

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return MISSING;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
