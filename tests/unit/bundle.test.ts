/* eslint-disable @typescript-eslint/no-explicit-any -- the tests damage raw JSON in ways the types forbid */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BundleError,
  coverage,
  defaultColumns,
  formatValue,
  groupColumns,
  isSafeBundlePath,
  isSafeKey,
  isStatusColumn,
  MAX_STRUCTURE_BYTES,
  MISSING,
  openBundle,
  openLocalBundle,
  parseManifest,
  parseRecords,
  searchRecords,
  sha256Hex,
  sortRecords,
  statusColumns,
  structurePath,
  type BundleColumn,
  type BundleRecord,
  type LocalFile,
} from '../../src/lib/bundle';

const ROOT = join(__dirname, '..', '..', 'public', 'bundles');
const DEMO = join(ROOT, 'pormake_small');
const rawManifest = (): Record<string, any> => JSON.parse(readFileSync(join(DEMO, 'manifest.json'), 'utf8'));
const rawRecords = (): Record<string, any> => JSON.parse(readFileSync(join(DEMO, 'candidates.json'), 'utf8'));
const bytes = (path: string): ArrayBuffer => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const reader = (overrides: Record<string, ArrayBuffer> = {}) => async (path: string) => overrides[path] ?? bytes(join(DEMO, path));
const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
const open = (overrides: Record<string, ArrayBuffer> = {}) => openBundle({ key: 'pormake_small', origin: 'site', label: 'demo', read: reader(overrides) });

function allFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? allFiles(join(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`]));
}

describe('the bundle shipped with the site', () => {
  const index = JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8')) as { bundles: { id: string; title: string; description: string }[] };

  it('is listed in the index, and every listed bundle exists', () => {
    expect(index.bundles.map((b) => b.id)).toContain('pormake_small');
    for (const b of index.bundles) {
      expect(isSafeKey(b.id), b.id).toBe(true);
      expect(existsSync(join(ROOT, b.id, 'manifest.json')), b.id).toBe(true);
      expect(b.title.length).toBeGreaterThan(0);
    }
  });

  it('has exactly the files its manifest lists, with the listed size and checksum', () => {
    for (const b of index.bundles) {
      const dir = join(ROOT, b.id);
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      const listed = Object.keys(manifest.files).sort();
      expect(allFiles(dir).filter((f) => f !== 'manifest.json').sort()).toEqual(listed);
      for (const [name, entry] of Object.entries(manifest.files) as [string, { bytes: number; sha256: string }][]) {
        const body = readFileSync(join(dir, name));
        expect(body.length, name).toBe(entry.bytes);
        expect(createHash('sha256').update(body).digest('hex'), name).toBe(entry.sha256);
      }
    }
  });

  it('is protected from line-ending conversion in git', () => {
    expect(readFileSync(join(ROOT, '..', '..', '.gitattributes'), 'utf8')).toMatch(/^public\/bundles\/\*\* -text$/m);
  });

  it('holds no restricted file and no result of the study', () => {
    for (const name of allFiles(ROOT)) expect(name).not.toMatch(/POTCAR|WAVECAR|CHGCAR|\.pkl$|\.pickle$|qmof\.csv/i);
    const manifest = rawManifest();
    expect(manifest.project).toBe('pormake_small');
    for (const c of manifest.columns) expect(c.name).not.toMatch(/dft|pred_|acquisition|label/i);
  });

  it('opens with every record and every structure file verified', async () => {
    const bundle = await open();
    expect(bundle.manifest.counts).toEqual({ enumerated: 6, selected: 4, structures: 4 });
    expect(bundle.records).toHaveLength(4);
    expect(bundle.integrity).toEqual([{ file: 'candidates.json', ok: true }]);
    for (const record of bundle.records) {
      const path = structurePath(record);
      expect(path).toBe(`structures/${record.id}.cif`);
      const cif = await bundle.readText(path!);
      expect(cif).toContain('_cell_length_a');
      expect(cif).toContain('_atom_site_');
    }
  });

  it('keeps a value that was not computed as null', async () => {
    const bundle = await open();
    const large = bundle.records.find((r) => r.name === 'nbo__N409__E34')!;
    expect(large.xtb_gap).toBeNull();
    expect(large.describe_xtb_status).toBe('skipped');
    expect(typeof large.describe_xtb_skip_reason).toBe('string');
    const column = bundle.manifest.columns.find((c) => c.name === 'xtb_gap')!;
    expect(formatValue(column, large.xtb_gap)).toBe(MISSING);
  });
});

describe('parseManifest', () => {
  it('reads the manifest of the demo bundle', () => {
    const m = parseManifest(rawManifest());
    expect(m.columns[0]).toMatchObject({ name: 'id', type: 'string' });
    expect(m.columns.find((c) => c.name === 'lcd')).toMatchObject({ type: 'number', group: 'describe.geometry', unit: 'angstrom' });
    expect(m.filters).toEqual([{ expression: 'qc_pass == True', passed: 4, rejected: 2, undecided: 0 }]);
    expect(m.records).toMatchObject({ path: 'candidates.json', n_records: 4 });
    expect(m.notices.length).toBeGreaterThan(0);
    expect(m.third_party[0].cite).toContain('Rosen');
  });

  const broken: [string, (m: Record<string, any>) => void, RegExp][] = [
    ['another kind of file', (m) => (m.kind = 'something-else'), /not the manifest of a mofsift bundle/],
    ['an unfinished export', (m) => (m.incomplete = true), /did not finish/],
    ['a newer major schema version', (m) => (m.schema_version = '2.0.0'), /schema version 1\.x/],
    ['no schema version', (m) => delete m.schema_version, /schema version 1\.x/],
    ['no counts', (m) => delete m.counts, /"counts"/],
    ['a negative count', (m) => (m.counts.selected = -1), /"counts"/],
    ['no column dictionary', (m) => (m.columns = []), /column dictionary/],
    ['a column without a name', (m) => (m.columns[2] = { type: 'string' }), /column 3 has no name/],
    ['an unknown column type', (m) => (m.columns[2].type = 'date'), /unknown type/],
    ['a first column that is not id', (m) => m.columns.reverse(), /first column must be "id"/],
    ['a column listed twice', (m) => m.columns.push({ ...m.columns[1] }), /listed twice/],
    ['no list of files', (m) => delete m.files, /list of files/],
    ['a file outside the bundle', (m) => (m.files['../secret.txt'] = { bytes: 1, sha256: 'a'.repeat(64) }), /not a file name inside the bundle/],
    ['an absolute file name', (m) => (m.files['/etc/passwd'] = { bytes: 1, sha256: 'a'.repeat(64) }), /not a file name inside the bundle/],
    ['a drive letter', (m) => (m.files['C:/Windows/win.ini'] = { bytes: 1, sha256: 'a'.repeat(64) }), /not a file name inside the bundle/],
    ['a malformed checksum', (m) => (m.files['candidates.json'].sha256 = 'xyz'), /malformed/],
    ['records that do not match the files', (m) => (m.records.sha256 = 'b'.repeat(64)), /does not match the list of files/],
  ];
  for (const [what, damage, message] of broken) {
    it(`refuses ${what}`, () => {
      const m = rawManifest();
      damage(m);
      expect(() => parseManifest(m)).toThrow(BundleError);
      expect(() => parseManifest(m)).toThrow(message);
    });
  }

  it('refuses things that are not objects', () => {
    for (const v of [null, 3, 'text', [], undefined]) expect(() => parseManifest(v)).toThrow(BundleError);
  });

  it('accepts a later minor version and a manifest without the optional parts', () => {
    const m = rawManifest();
    m.schema_version = '1.4.0';
    for (const key of ['config', 'filters', 'stages', 'tools', 'notices', 'third_party', 'warnings', 'sources', 'structures']) delete m[key];
    const parsed = parseManifest(m);
    expect(parsed.filters).toEqual([]);
    expect(parsed.notices).toEqual([]);
    expect(parsed.config).toBeNull();
    expect(parsed.structures).toBeNull();
  });
});

describe('parseRecords', () => {
  const manifest = parseManifest(rawManifest());

  it('reads the records of the demo bundle', () => {
    const records = parseRecords(rawRecords(), manifest);
    expect(records.map((r) => r.name)).toEqual(['pcu__N16__E14', 'pcu__N16__E34', 'nbo__N409__E14', 'nbo__N409__E34']);
    expect(records[0].n_atoms).toBe(53);
    expect(records[0].qc_pass).toBe(true);
  });

  const broken: [string, (r: Record<string, any>) => void, RegExp][] = [
    ['a record count that differs from the manifest', (r) => r.records.pop(), /holds 3 records; the manifest says 4/],
    ['a record without an id', (r) => delete r.records[1].id, /record 2 has no usable id/],
    ['an id that could not be a file name', (r) => (r.records[1].id = '../x'), /record 2 has no usable id/],
    ['the same id twice', (r) => (r.records[1].id = r.records[0].id), /appears twice/],
    ['a key that is not a column', (r) => (r.records[0].surprise = 1), /"surprise".*not a column/],
    ['text where a number belongs', (r) => (r.records[0].lcd = '13.2'), /"lcd".*not a number value/],
    ['a decimal where a whole number belongs', (r) => (r.records[0].n_atoms = 53.5), /"n_atoms".*not a integer value/],
    ['a number where true or false belongs', (r) => (r.records[0].qc_pass = 1), /"qc_pass".*not a boolean value/],
    ['an object as a value', (r) => (r.records[0].name = { toString: 'x' }), /"name".*not a string value/],
    ['no list of records', (r) => delete r.records, /no list of records/],
  ];
  for (const [what, damage, message] of broken) {
    it(`refuses ${what}`, () => {
      const r = rawRecords();
      damage(r);
      expect(() => parseRecords(r, manifest)).toThrow(BundleError);
      expect(() => parseRecords(r, manifest)).toThrow(message);
    });
  }
});

describe('paths and keys', () => {
  it('accepts plain relative paths only', () => {
    for (const ok of ['manifest.json', 'structures/ms-1.cif', 'a/b/c.txt']) expect(isSafeBundlePath(ok), ok).toBe(true);
    for (const bad of ['', '/abs', '../up', 'a/../b', './a', 'a//b', 'C:/x', 'a\\b', 'a b', 'a?b', 'http://x/y', 3, null]) expect(isSafeBundlePath(bad), String(bad)).toBe(false);
  });
  it('accepts keys that can be part of an address', () => {
    for (const ok of ['pormake_small', 'ms-678e931c571c8679', 'a.b-c_1']) expect(isSafeKey(ok), ok).toBe(true);
    for (const bad of ['', '.hidden', '../x', 'a/b', 'a b', 'a%2Fb', 'x'.repeat(200), 7]) expect(isSafeKey(bad), String(bad)).toBe(false);
  });
  it('gives the structure path only when it is the file of that record', () => {
    expect(structurePath({ id: 'ms-1', cif_path: 'structures/ms-1.cif' })).toBe('structures/ms-1.cif');
    expect(structurePath({ id: 'ms-1', cif_path: 'structures/ms-2.cif' })).toBeNull();
    expect(structurePath({ id: 'ms-1', cif_path: '../ms-1.cif' })).toBeNull();
    expect(structurePath({ id: 'ms-1', cif_path: null })).toBeNull();
    expect(structurePath({ id: 'ms-1' })).toBeNull();
  });
  it('computes SHA-256 of text and of bytes', async () => {
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256Hex('abc')).toBe(abc);
    expect(await sha256Hex(encode('abc'))).toBe(abc);
    expect(await sha256Hex(new Uint8Array([97, 98, 99]))).toBe(abc);
  });
});

describe('presentation helpers', () => {
  const col = (name: string, type: BundleColumn['type'] = 'number', group: string | null = null): BundleColumn => ({ name, type, group, unit: null, description: null });

  it('groups columns by stage, in the order of the table, without id', () => {
    const groups = groupColumns([col('id', 'string', 'generate'), col('name', 'string', 'generate'), col('lcd', 'number', 'describe.geometry'), col('mine'), col('topology', 'string', 'generate'), col('x', 'number', 'future.stage')]);
    expect(groups.map((g) => [g.label, g.columns.map((c) => c.name)])).toEqual([
      ['Identity and building blocks', ['name', 'topology']],
      ['Pore geometry (Zeo++)', ['lcd']],
      ['Other columns', ['mine']],
      ['future.stage', ['x']],
    ]);
  });

  it('names the status columns of a stage the way mofsift does', () => {
    expect(statusColumns('describe.xtb')).toEqual({ status: 'describe_xtb_status', reason: 'describe_xtb_skip_reason' });
    expect(statusColumns('qc')).toEqual({ status: 'qc_status', reason: 'qc_skip_reason' });
    expect(isStatusColumn('qc_status')).toBe(true);
    expect(isStatusColumn('describe_xtb_skip_reason')).toBe(true);
    expect(isStatusColumn('qc_pass')).toBe(false);
  });

  it('chooses the usual columns, or the first ones of a table it does not know', () => {
    const manifest = parseManifest(rawManifest());
    const usual = defaultColumns(manifest.columns);
    expect(usual).toContain('xtb_gap');
    expect(usual).toContain('topology');
    expect(usual).not.toContain('id');
    const own = [col('id', 'string'), col('a'), col('a_status', 'string'), col('b'), col('c')];
    expect(defaultColumns(own)).toEqual(['a', 'b', 'c']);
  });

  it('never shows a missing value as zero or as empty text', () => {
    expect(formatValue(col('x'), null)).toBe(MISSING);
    expect(formatValue(col('x'), undefined)).toBe(MISSING);
    expect(formatValue(col('x'), 0)).toBe('0');
    expect(formatValue(col('x', 'boolean'), false)).toBe('No');
    expect(formatValue(col('x', 'boolean'), true)).toBe('Yes');
    expect(formatValue(col('x', 'string'), '')).toBe('');
  });

  it('formats numbers without inventing digits', () => {
    expect(formatValue(col('x'), 13.259)).toBe('13.259');
    expect(formatValue(col('x'), 0.550123456)).toBe('0.5501');
    expect(formatValue(col('x'), 2.5)).toBe('2.5');
    expect(formatValue(col('x', 'integer'), 324)).toBe('324');
    expect(formatValue(col('x'), 0.0000123)).toBe('1.230e-5');
    expect(formatValue(col('x'), 123456789.5)).toBe('1.235e+8');
    expect(formatValue(col('x'), -12.3987)).toBe('-12.3987');
  });

  const records: BundleRecord[] = [
    { id: 'r1', name: 'pcu__Zn', gap: 2.5, ok: true },
    { id: 'r2', name: 'nbo__Cu', gap: null, ok: false },
    { id: 'r3', name: 'dia__Zn', gap: 0.4, ok: true },
    { id: 'r4', name: 'pcu__Cu', gap: 0.4, ok: null },
    { id: 'r10', name: null, gap: 10, ok: true },
  ];

  it('sorts with missing values last in both directions and keeps ties in order', () => {
    expect(sortRecords(records, { column: 'gap', dir: 'asc' }).map((r) => r.id)).toEqual(['r3', 'r4', 'r1', 'r10', 'r2']);
    expect(sortRecords(records, { column: 'gap', dir: 'desc' }).map((r) => r.id)).toEqual(['r10', 'r1', 'r3', 'r4', 'r2']);
    expect(sortRecords(records, { column: 'ok', dir: 'asc' }).map((r) => r.id)).toEqual(['r2', 'r1', 'r3', 'r10', 'r4']);
    expect(sortRecords(records, { column: 'name', dir: 'asc' }).map((r) => r.id)).toEqual(['r3', 'r2', 'r4', 'r1', 'r10']);
    expect(sortRecords(records, { column: 'id', dir: 'desc' }).map((r) => r.id)).toEqual(['r10', 'r4', 'r3', 'r2', 'r1']);
    expect(sortRecords(records, null)).toBe(records);
    expect(records.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r10']);
  });

  it('searches the id and the text columns for every word', () => {
    const columns = [col('id', 'string'), col('name', 'string'), col('gap'), col('ok', 'boolean')];
    expect(searchRecords(records, 'zn', columns).map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(searchRecords(records, 'PCU zn', columns).map((r) => r.id)).toEqual(['r1']);
    expect(searchRecords(records, 'zn nbo', columns)).toEqual([]);
    expect(searchRecords(records, 'r10', columns).map((r) => r.id)).toEqual(['r10']);
    expect(searchRecords(records, '2.5', columns)).toEqual([]);
    expect(searchRecords(records, '   ', columns)).toBe(records);
  });

  it('counts the records that have a value in each column', () => {
    expect(coverage(records, [col('id', 'string'), col('name', 'string'), col('gap'), col('absent')])).toEqual({ id: 5, name: 4, gap: 4, absent: 0 });
  });
});

describe('openBundle', () => {
  it('refuses a candidates.json that was changed after the export', async () => {
    const text = readFileSync(join(DEMO, 'candidates.json'), 'utf8').replace('"n_atoms": 53', '"n_atoms": 54');
    await expect(open({ 'candidates.json': encode(text) })).rejects.toThrow(/checksum differs/);
  });

  it('refuses a candidates.json whose line endings were rewritten', async () => {
    const text = readFileSync(join(DEMO, 'candidates.json'), 'utf8').replace(/\n/g, '\r\n');
    await expect(open({ 'candidates.json': encode(text) })).rejects.toThrow(/line endings/);
  });

  it('refuses a structure file that was changed, when it is read', async () => {
    const path = 'structures/ms-678e931c571c8679.cif';
    const bundle = await open({ [path]: encode(`${readFileSync(join(DEMO, path), 'utf8')}\n# edited`) });
    await expect(bundle.readText(path)).rejects.toThrow(/checksum differs/);
    await expect(bundle.readText('structures/ms-a0678e0f108f6e4d.cif')).resolves.toContain('_cell_length_a');
  });

  it('reads only the files the manifest lists', async () => {
    const asked: string[] = [];
    const bundle = await openBundle({
      key: 'k',
      origin: 'site',
      label: 'demo',
      read: async (path) => {
        asked.push(path);
        return reader()(path);
      },
    });
    for (const path of ['../../data/candidates.json', 'structures/unknown.cif', 'manifest.json/../x', 'https://example.org/x.cif']) {
      await expect(bundle.readText(path)).rejects.toThrow(/not a file of this bundle/);
    }
    expect(asked).toEqual(['manifest.json', 'candidates.json']);
  });

  it('refuses a structure file too large to render', async () => {
    const path = 'structures/ms-678e931c571c8679.cif';
    const manifest = rawManifest();
    manifest.files[path].bytes = MAX_STRUCTURE_BYTES + 1;
    const bundle = await open({ 'manifest.json': encode(JSON.stringify(manifest)) });
    await expect(bundle.readText(path)).rejects.toThrow(/too large/);
  });

  it('explains a bundle exported without candidates.json', async () => {
    const manifest = rawManifest();
    delete manifest.files['candidates.json'];
    manifest.records = null;
    await expect(open({ 'manifest.json': encode(JSON.stringify(manifest)) })).rejects.toThrow(/viewer_bundle: true/);
  });

  it('explains a folder that is not a bundle', async () => {
    await expect(openBundle({ key: 'k', origin: 'local', label: 'x', read: async () => Promise.reject(new Error('HTTP 404')) })).rejects.toThrow(/manifest\.json could not be read \(HTTP 404\)/);
    await expect(open({ 'manifest.json': encode('{not json') })).rejects.toThrow(/not valid JSON/);
    await expect(open({ 'manifest.json': encode('{"kind": "other"}') })).rejects.toThrow(/not the manifest of a mofsift bundle/);
  });

  it('gives no download address unless the source provides one', async () => {
    expect((await open()).fileUrl('candidates.csv')).toBeNull();
  });
});

describe('openLocalBundle', () => {
  const local = (prefix: string, skip: (name: string) => boolean = () => false): LocalFile[] =>
    ['manifest.json', ...allFiles(DEMO).filter((f) => f !== 'manifest.json')]
      .filter((name) => !skip(name))
      .map((name) => {
        const body = bytes(join(DEMO, name));
        return { path: `${prefix}${name}`, file: { size: body.byteLength, arrayBuffer: async () => body } };
      });

  it('opens the folder that was chosen', async () => {
    const bundle = await openLocalBundle(local('pormake_small/'));
    expect(bundle).toMatchObject({ key: 'local', origin: 'local', label: 'pormake_small' });
    expect(bundle.records).toHaveLength(4);
    expect(await bundle.readText('structures/ms-76e2e784339a5138.cif')).toContain('_cell_length_a');
    expect(bundle.fileUrl('candidates.csv')).toBeNull();
  });

  it('opens a bundle one level below the chosen folder, and with Windows separators', async () => {
    const files = [...local('export/pormake_small/'), { path: 'export/notes.txt', file: { size: 2, arrayBuffer: async () => encode('hi') } }];
    expect((await openLocalBundle(files)).label).toBe('pormake_small');
    const windows = local('export/pormake_small/').map((f) => ({ ...f, path: f.path.replace(/\//g, '\\') }));
    expect((await openLocalBundle(windows)).records).toHaveLength(4);
  });

  it('opens files given without a folder name', async () => {
    expect((await openLocalBundle(local(''))).label).toBe('bundle');
  });

  it('explains a folder without a manifest, and a folder with several bundles', async () => {
    await expect(openLocalBundle(local('x/', (n) => n === 'manifest.json'))).rejects.toThrow(/No manifest\.json in this folder/);
    await expect(openLocalBundle([...local('export/a/'), ...local('export/b/')])).rejects.toThrow(/several bundles/);
    await expect(openLocalBundle([])).rejects.toThrow(/No manifest\.json/);
  });

  it('reports a file the manifest lists but the folder lacks', async () => {
    await expect(openLocalBundle(local('x/', (n) => n === 'candidates.json'))).rejects.toThrow(/candidates\.json is not in the folder/);
    const bundle = await openLocalBundle(local('x/', (n) => n.endsWith('ms-76e2e784339a5138.cif')));
    await expect(bundle.readText('structures/ms-76e2e784339a5138.cif')).rejects.toThrow(/not in the folder/);
  });
});
