/**
 * Reading a mofsift bundle: manifest.json + candidates.json + structures/<id>.cif.
 *
 * A bundle is the export of a mofsift run (https://github.com/humbertogn-coder/mofsift). Its
 * manifest carries a dictionary of the columns, so this viewer knows nothing about specific
 * columns: it shows what the manifest describes. Everything read from a bundle is treated as
 * untrusted text and numbers; nothing in it is executed or used to build a URL without a check.
 */

export type BundleValue = string | number | boolean | null;
export type BundleRecord = { id: string } & Record<string, BundleValue>;
export type ColumnType = 'string' | 'number' | 'integer' | 'boolean';

export interface BundleColumn {
  name: string;
  type: ColumnType;
  group: string | null;
  unit: string | null;
  description: string | null;
}

export interface BundleFilterReport {
  expression: string;
  passed: number | null;
  rejected: number | null;
  undecided: number | null;
}

export interface BundleManifest {
  kind: 'mofsift-bundle';
  schema_version: string;
  mofsift_version: string;
  project: string;
  created_utc: string;
  config_hash: string | null;
  config: Record<string, unknown> | null;
  counts: { enumerated: number | null; selected: number; structures: number };
  filters: BundleFilterReport[];
  stages: { stage: string; status_counts?: Record<string, number>; tools?: Record<string, string | null> }[];
  tools: Record<string, string | null>;
  columns: BundleColumn[];
  table: { path: string; format: string; n_rows: number; n_columns: number; sha256: string };
  records: { path: string; n_records: number; sha256: string } | null;
  structures: { directory: string; format: string; n_files: number } | null;
  files: Record<string, { bytes: number; sha256: string }>;
  sources: { project: string; mofsift_version: string; selected: number }[];
  notices: string[];
  third_party: { used_for?: string; source?: string; licence?: string; cite?: string }[];
  warnings: string[];
}

export class BundleError extends Error {}

export const SUPPORTED_MAJOR = '1';
/** Largest candidates.json this viewer reads; a browser tab cannot hold much more as objects. */
export const MAX_RECORDS_BYTES = 150 * 1024 * 1024;
export const MAX_STRUCTURE_BYTES = 2_000_000;
const COLUMN_TYPES: ColumnType[] = ['string', 'number', 'integer', 'boolean'];
const PART_RE = /^[A-Za-z0-9_.-]+$/;
const CIF_PATH_RE = /^structures\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.cif$/;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** A file name inside a bundle: plain characters, no "..", no absolute path, no drive letter. */
export function isSafeBundlePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.split('/').every((p) => PART_RE.test(p) && p !== '.' && p !== '..');
}

/** True for an id that can be part of a URL and of a file name. */
export function isSafeKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_RE.test(key);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BundleError(message);
}

function count(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function text(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Check the manifest of a bundle and return it typed. Throws BundleError with a message for the reader. */
export function parseManifest(raw: unknown): BundleManifest {
  need(isObject(raw) && raw.kind === 'mofsift-bundle', 'manifest.json is not the manifest of a mofsift bundle.');
  need(raw.incomplete !== true, 'The export that wrote this bundle did not finish. Run "mofsift export" again.');
  const version = text(raw.schema_version) ?? '';
  need(version.split('.')[0] === SUPPORTED_MAJOR, `This viewer reads bundles of schema version ${SUPPORTED_MAJOR}.x; this one says "${version}".`);
  need(isObject(raw.counts) && count(raw.counts.selected) && count(raw.counts.structures), 'manifest.json: "counts" is missing or malformed.');
  need(Array.isArray(raw.columns) && raw.columns.length > 0, 'manifest.json: the column dictionary ("columns") is missing.');
  const columns = raw.columns.map((c, i): BundleColumn => {
    need(isObject(c) && typeof c.name === 'string' && c.name.length > 0, `manifest.json: column ${i + 1} has no name.`);
    need(COLUMN_TYPES.includes(c.type as ColumnType), `manifest.json: column "${c.name}" has an unknown type.`);
    return { name: c.name, type: c.type as ColumnType, group: text(c.group), unit: text(c.unit), description: text(c.description) };
  });
  need(columns[0].name === 'id', 'manifest.json: the first column must be "id".');
  need(new Set(columns.map((c) => c.name)).size === columns.length, 'manifest.json: a column is listed twice.');
  need(isObject(raw.files), 'manifest.json: the list of files ("files") is missing.');
  const files: BundleManifest['files'] = {};
  for (const [name, entry] of Object.entries(raw.files)) {
    need(isSafeBundlePath(name), `manifest.json: "${name}" is not a file name inside the bundle.`);
    need(isObject(entry) && count(entry.bytes) && typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256), `manifest.json: the entry of "${name}" is malformed.`);
    files[name] = { bytes: entry.bytes, sha256: entry.sha256 };
  }
  let records: BundleManifest['records'] = null;
  if (raw.records !== null && raw.records !== undefined) {
    const r = raw.records;
    need(isObject(r) && isSafeBundlePath(r.path) && count(r.n_records) && typeof r.sha256 === 'string', 'manifest.json: "records" is malformed.');
    need(files[r.path]?.sha256 === r.sha256, 'manifest.json: "records" does not match the list of files.');
    records = { path: r.path, n_records: r.n_records, sha256: r.sha256 };
  }
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);
  const optionalCount = (v: unknown): number | null => (count(v) ? v : null);
  const table = isObject(raw.table) ? raw.table : {};
  const structures = isObject(raw.structures) ? raw.structures : null;
  const tools: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(isObject(raw.tools) ? raw.tools : {})) tools[k] = text(v);
  return {
    kind: 'mofsift-bundle',
    schema_version: version,
    mofsift_version: text(raw.mofsift_version) ?? 'unknown',
    project: text(raw.project) ?? 'unnamed',
    created_utc: text(raw.created_utc) ?? '',
    config_hash: text(raw.config_hash),
    config: isObject(raw.config) ? raw.config : null,
    counts: { enumerated: optionalCount(raw.counts.enumerated), selected: raw.counts.selected, structures: raw.counts.structures },
    filters: objects(raw.filters).map((f) => ({
      expression: text(f.expression) ?? '',
      passed: optionalCount(f.passed),
      rejected: optionalCount(f.rejected),
      undecided: optionalCount(f.undecided),
    })),
    stages: objects(raw.stages).map((s) => ({
      stage: text(s.stage) ?? '?',
      status_counts: isObject(s.status_counts) ? (s.status_counts as Record<string, number>) : undefined,
      tools: isObject(s.tools) ? (s.tools as Record<string, string | null>) : undefined,
    })),
    tools,
    columns,
    table: {
      path: text(table.path) ?? '',
      format: text(table.format) ?? '',
      n_rows: optionalCount(table.n_rows) ?? 0,
      n_columns: optionalCount(table.n_columns) ?? 0,
      sha256: text(table.sha256) ?? '',
    },
    records,
    structures: structures ? { directory: text(structures.directory) ?? 'structures', format: text(structures.format) ?? 'cif', n_files: optionalCount(structures.n_files) ?? 0 } : null,
    files,
    sources: objects(raw.sources).map((s) => ({ project: text(s.project) ?? '?', mofsift_version: text(s.mofsift_version) ?? '?', selected: optionalCount(s.selected) ?? 0 })),
    notices: strings(raw.notices),
    third_party: objects(raw.third_party).map((t) => ({ used_for: text(t.used_for) ?? undefined, source: text(t.source) ?? undefined, licence: text(t.licence) ?? undefined, cite: text(t.cite) ?? undefined })),
    warnings: strings(raw.warnings),
  };
}

/** Check candidates.json against the manifest and return the records. A value of the wrong kind is refused. */
export function parseRecords(raw: unknown, manifest: BundleManifest): BundleRecord[] {
  need(isObject(raw) && Array.isArray(raw.records), 'candidates.json has no list of records.');
  const list = raw.records as unknown[];
  need(manifest.records === null || list.length === manifest.records.n_records, `candidates.json holds ${list.length} records; the manifest says ${manifest.records?.n_records}.`);
  const types = new Map(manifest.columns.map((c) => [c.name, c.type]));
  const seen = new Set<string>();
  return list.map((r, i): BundleRecord => {
    need(isObject(r) && isSafeKey(r.id), `candidates.json: record ${i + 1} has no usable id.`);
    need(!seen.has(r.id), `candidates.json: the id "${r.id}" appears twice.`);
    seen.add(r.id);
    const out: BundleRecord = { id: r.id };
    for (const [key, value] of Object.entries(r)) {
      if (key === 'id') continue;
      const type = types.get(key);
      need(type !== undefined, `candidates.json: "${key}" of ${r.id} is not a column of the manifest.`);
      const ok =
        value === null ||
        (type === 'string' && typeof value === 'string') ||
        (type === 'boolean' && typeof value === 'boolean') ||
        (type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
        (type === 'integer' && typeof value === 'number' && Number.isInteger(value));
      need(ok, `candidates.json: "${key}" of ${r.id} is not a ${type} value.`);
      out[key] = value as BundleValue;
    }
    return out;
  });
}

/** SHA-256 of a text (as UTF-8) or of bytes, as lowercase hex. */
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new BundleError('This browser cannot compute checksums here (it needs a secure context: https or localhost).');
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The structure file of a record, when the bundle holds one and the path has the expected shape. */
export function structurePath(record: BundleRecord): string | null {
  const p = record.cif_path;
  return typeof p === 'string' && CIF_PATH_RE.test(p) && p === `structures/${record.id}.cif` ? p : null;
}

// ---------------------------------------------------------------- presentation

export const MISSING = '—';

const GROUP_LABELS: Record<string, string> = {
  generate: 'Identity and building blocks',
  qc: 'Structure and checks',
  'describe.composition': 'Composition',
  'describe.geometry': 'Pore geometry (Zeo++)',
  'describe.xtb': 'xTB electronic proxies',
  score: 'Synthetic-accessibility components',
  filter: 'Filters',
};
export const OTHER_GROUP = 'Other columns';

export interface ColumnGroup {
  key: string;
  label: string;
  columns: BundleColumn[];
}

/** Columns grouped by the stage that wrote them, in the order of the table. "id" is left out. */
export function groupColumns(columns: BundleColumn[]): ColumnGroup[] {
  const groups: ColumnGroup[] = [];
  for (const column of columns) {
    if (column.name === 'id') continue;
    const key = column.group ?? '';
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: GROUP_LABELS[key] ?? (key || OTHER_GROUP), columns: [] };
      groups.push(group);
    }
    group.columns.push(column);
  }
  return groups;
}

/** The status and reason columns of a stage, as mofsift names them ("describe.xtb" -> "describe_xtb_status"). */
export function statusColumns(group: string): { status: string; reason: string } {
  const key = group.replace(/\./g, '_');
  return { status: `${key}_status`, reason: `${key}_skip_reason` };
}

export function isStatusColumn(name: string): boolean {
  return name.endsWith('_status') || name.endsWith('_skip_reason');
}

const PREFERRED = ['topology', 'primary_metal', 'formula', 'n_atoms', 'qc_pass', 'density', 'lcd', 'pld', 'xtb_gap', 'xtb_unpaired_electrons', 'linker_sa', 'precedent_linker'];

/** Columns shown first: the usual ones when the bundle has them, otherwise the first few. */
export function defaultColumns(columns: BundleColumn[]): string[] {
  const names = new Set(columns.map((c) => c.name));
  const chosen = PREFERRED.filter((n) => names.has(n));
  if (chosen.length >= 3) return chosen;
  return columns.filter((c) => c.name !== 'id' && !isStatusColumn(c.name)).slice(0, 8).map((c) => c.name);
}

/** A value as text. A missing value is a dash, never zero or an empty string. */
export function formatValue(column: Pick<BundleColumn, 'type'>, value: BundleValue | undefined): string {
  if (value === null || value === undefined) return MISSING;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (column.type === 'integer' || Number.isInteger(value)) return String(value);
    const abs = Math.abs(value);
    if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) return value.toExponential(3);
    return String(Number(value.toFixed(4)));
  }
  return value;
}

export interface SortState {
  column: string;
  dir: 'asc' | 'desc';
}

/** Sorted copy. Rows without a value come last in both directions; ties keep the order of the bundle. */
export function sortRecords(records: BundleRecord[], sort: SortState | null): BundleRecord[] {
  if (!sort) return records;
  const sign = sort.dir === 'asc' ? 1 : -1;
  const value = (r: BundleRecord) => (sort.column === 'id' ? r.id : r[sort.column]);
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = value(a.r);
      const y = value(b.r);
      const xm = x === null || x === undefined;
      const ym = y === null || y === undefined;
      if (xm || ym) return xm && ym ? a.i - b.i : xm ? 1 : -1;
      let c = 0;
      if (typeof x === 'number' && typeof y === 'number') c = x - y;
      else if (typeof x === 'boolean' && typeof y === 'boolean') c = Number(x) - Number(y);
      else c = String(x).localeCompare(String(y), 'en', { numeric: true });
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((e) => e.r);
}

/** Records in which every word of the query occurs in the id or in a text column. */
export function searchRecords(records: BundleRecord[], query: string, columns: BundleColumn[]): BundleRecord[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return records;
  const textColumns = columns.filter((c) => c.type === 'string' && !isStatusColumn(c.name)).map((c) => c.name);
  return records.filter((r) => {
    const hay = textColumns.map((n) => (n === 'id' ? r.id : r[n])).filter((v): v is string => typeof v === 'string').join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** How many records have a value in each column: used to tell "not computed" from "empty by chance". */
export function coverage(records: BundleRecord[], columns: BundleColumn[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of columns) out[c.name] = 0;
  for (const r of records) for (const c of columns) if (c.name === 'id' || (r[c.name] !== null && r[c.name] !== undefined)) out[c.name] += 1;
  return out;
}

// ------------------------------------------------------------------- sources

export interface IntegrityCheck {
  file: string;
  ok: boolean;
}

export interface LoadedBundle {
  /** Key in the URL: the id of a bundle of the site, or "local". */
  key: string;
  origin: 'site' | 'local';
  /** For a local bundle the name of the folder; for a site bundle its title. */
  label: string;
  manifest: BundleManifest;
  records: BundleRecord[];
  /** Files whose checksum was compared with the manifest when the bundle was opened. */
  integrity: IntegrityCheck[];
  /** Text of a file of the bundle; verifies its checksum against the manifest. */
  readText(path: string): Promise<string>;
  /** Address of a file for a download link, when there is one (bundles of the site). */
  fileUrl(path: string): string | null;
}

/** Returns the bytes of a file of the bundle, given its path inside the bundle. */
export type BytesReader = (path: string) => Promise<ArrayBuffer>;

const decode = (bytes: ArrayBuffer): string => new TextDecoder('utf-8').decode(bytes);

/**
 * Open a bundle given a function that returns the bytes of its files.
 * The checksum of candidates.json is compared with the manifest, and so is the checksum of
 * every structure file when it is read.
 */
export async function openBundle(opts: { key: string; origin: 'site' | 'local'; label: string; read: BytesReader; fileUrl?: (path: string) => string | null }): Promise<LoadedBundle> {
  let manifestText: string;
  try {
    manifestText = decode(await opts.read('manifest.json'));
  } catch (e) {
    throw new BundleError(`manifest.json could not be read (${e instanceof Error ? e.message : String(e)}). Is this the folder of a mofsift bundle?`);
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch {
    throw new BundleError('manifest.json is not valid JSON.');
  }
  const manifest = parseManifest(manifestJson);
  need(manifest.records !== null, 'This bundle was exported without candidates.json (export.viewer_bundle: false), so there is nothing to show. Export it again with viewer_bundle: true.');
  const entry = manifest.files[manifest.records.path];
  need(entry.bytes <= MAX_RECORDS_BYTES, `candidates.json is ${(entry.bytes / 1e6).toFixed(0)} MB, more than this viewer can hold in a browser tab. Use the table file with other tools.`);
  const recordsBytes = await opts.read(manifest.records.path);
  need(recordsBytes.byteLength <= MAX_RECORDS_BYTES, 'candidates.json is larger than this viewer can hold in a browser tab.');
  const ok = (await sha256Hex(recordsBytes)) === manifest.records.sha256;
  need(ok, 'candidates.json is not the file the manifest describes (its checksum differs). The bundle was changed after it was exported, or a program rewrote its line endings.');
  let recordsJson: unknown;
  try {
    recordsJson = JSON.parse(decode(recordsBytes));
  } catch {
    throw new BundleError('candidates.json is not valid JSON.');
  }
  const records = parseRecords(recordsJson, manifest);
  const readText = async (path: string): Promise<string> => {
    const listed = isSafeBundlePath(path) ? manifest.files[path] : undefined;
    if (!listed) throw new BundleError(`${path} is not a file of this bundle.`);
    if (listed.bytes > MAX_STRUCTURE_BYTES) throw new BundleError('The structure file is too large to render safely.');
    const body = await opts.read(path);
    if (body.byteLength > MAX_STRUCTURE_BYTES) throw new BundleError('The structure file is too large to render safely.');
    if ((await sha256Hex(body)) !== listed.sha256) throw new BundleError(`${path} is not the file the manifest describes (its checksum differs).`);
    return decode(body);
  };
  return {
    key: opts.key,
    origin: opts.origin,
    label: opts.label,
    manifest,
    records,
    integrity: [{ file: manifest.records.path, ok: true }],
    readText,
    fileUrl: opts.fileUrl ?? (() => null),
  };
}

/** One file of a folder the reader chose: its path relative to the chosen folder, and its content. */
export interface LocalFile {
  path: string;
  file: { arrayBuffer(): Promise<ArrayBuffer>; size: number };
}

/**
 * Open a bundle from the files of a folder. The folder may be the bundle itself or contain
 * it one level down (people often pick the parent folder).
 */
export async function openLocalBundle(files: LocalFile[]): Promise<LoadedBundle> {
  const clean = files.map((f) => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\/+/, '') }));
  const manifests = clean.filter((f) => f.path.split('/').pop() === 'manifest.json').sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  need(manifests.length > 0, 'No manifest.json in this folder. Choose the folder that "mofsift export" wrote (it holds manifest.json and candidates.json).');
  const depth = manifests[0].path.split('/').length;
  need(manifests.filter((m) => m.path.split('/').length === depth).length === 1, 'This folder holds several bundles. Choose the folder of one of them.');
  const prefix = manifests[0].path.slice(0, -'manifest.json'.length);
  const inside = new Map(clean.filter((f) => f.path.startsWith(prefix)).map((f) => [f.path.slice(prefix.length), f.file]));
  const label = prefix.replace(/\/$/, '').split('/').pop() || 'bundle';
  return openBundle({
    key: 'local',
    origin: 'local',
    label,
    read: async (path) => {
      const file = inside.get(path);
      if (!file) throw new Error(`${path} is not in the folder`);
      if (file.size > MAX_RECORDS_BYTES) throw new Error(`${path} is too large to read in the browser`);
      return file.arrayBuffer();
    },
  });
}
