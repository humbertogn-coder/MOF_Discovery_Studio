// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BundleProvider } from '../../src/app/BundleContext';
import { G } from '../../src/lib/guardrails';
import BundleRecordPage from '../../src/pages/BundleRecord';
import Bundles from '../../src/pages/Bundles';
import BundleView from '../../src/pages/BundleView';

const PUBLIC = join(__dirname, '..', '..', 'public');
const DEMO = join(PUBLIC, 'bundles', 'pormake_small');
const SMALL = 'ms-678e931c571c8679'; // pcu__N16__E14, every value computed
const LARGE = 'ms-85df08093aa5d8a1'; // nbo__N409__E34, too large for xTB

beforeEach(() => {
  // jsdom has no SubtleCrypto; the pages verify checksums with it.
  if (!globalThis.crypto?.subtle) vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', async (input: string | URL) => {
    try {
      return new Response(readFileSync(join(PUBLIC, String(input))));
    } catch {
      return new Response('missing', { status: 404 });
    }
  });
  // jsdom has no canvas: the viewer then reports that WebGL is unavailable, as on a device without it
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function app(path: string) {
  return render(
    <BundleProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/bundles" element={<Bundles />} />
          <Route path="/bundles/:key" element={<BundleView />} />
          <Route path="/bundles/:key/:recordId" element={<BundleRecordPage />} />
        </Routes>
      </MemoryRouter>
    </BundleProvider>,
  );
}

const recordsTable = () => screen.getByRole('table', { name: /Records of the bundle/ });
const rowNames = () => within(recordsTable()).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0].textContent);

describe('Bundles page', () => {
  it('lists the bundles of the site and says what a bundle is', async () => {
    app('/bundles');
    expect(await screen.findByRole('link', { name: 'mofsift example: frameworks from PORMAKE building blocks' })).toHaveProperty('href', expect.stringContaining('/bundles/pormake_small'));
    expect(screen.getByText(G.bundle)).toBeTruthy();
    expect(screen.getByText(new RegExp(G.bundleLocal.slice(0, 40)))).toBeTruthy();
    expect(screen.getByLabelText('Bundle folder').hasAttribute('webkitdirectory')).toBe(true);
  });

  it('opens a folder chosen by the reader and keeps it out of the network', async () => {
    const fetched: string[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string | URL) => {
      fetched.push(String(input));
      return real(input as string);
    });
    const walk = (dir: string, prefix: string): File[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full, `${prefix}${name}/`);
        const body = readFileSync(full);
        const file = new File([body], name);
        Object.defineProperty(file, 'webkitRelativePath', { value: `${prefix}${name}` });
        // jsdom's File lacks arrayBuffer in some versions
        Object.defineProperty(file, 'arrayBuffer', { value: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
        return [file];
      });
    app('/bundles');
    fireEvent.change(screen.getByLabelText('Bundle folder'), { target: { files: walk(DEMO, 'my_export/') } });
    expect(await screen.findByRole('heading', { level: 1, name: 'pormake_small' })).toBeTruthy();
    expect(screen.getByText(/Opened from your computer/)).toBeTruthy();
    expect(screen.getByText('my_export')).toBeTruthy();
    expect(rowNames()).toHaveLength(4);
    expect(screen.queryByRole('link', { name: /Download the table/ })).toBeNull();
    expect(fetched.filter((u) => !u.endsWith('/bundles/index.json'))).toEqual([]);
  });

  it('explains a folder that is not a bundle', async () => {
    app('/bundles');
    const file = new File(['hello'], 'notes.txt');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'stuff/notes.txt' });
    fireEvent.change(screen.getByLabelText('Bundle folder'), { target: { files: [file] } });
    expect(await screen.findByText(/No manifest\.json in this folder/)).toBeTruthy();
  });
});

describe('Bundle page', () => {
  it('shows the records, the counts, the filters and the warnings a reader needs', async () => {
    app('/bundles/pormake_small');
    expect(await screen.findByRole('heading', { level: 1, name: 'pormake_small' })).toBeTruthy();
    expect(rowNames()).toEqual(['pcu__N16__E14', 'pcu__N16__E34', 'nbo__N409__E14', 'nbo__N409__E34']);
    expect(screen.getByText('candidates before the filters').previousElementSibling?.textContent).toBe('6');
    expect(screen.getByText('records in the bundle').previousElementSibling?.textContent).toBe('4');
    for (const text of [G.xtbProxy, G.scoreComponents, G.noConductivity]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText('qc_pass == True').parentElement?.textContent).toContain('true for 4, false for 2');
    expect(screen.getByText(/candidates\.json matches the checksum/)).toBeTruthy();
    expect(screen.getByText(/Rosen et al\., Matter 2021/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Download the table \(csv\)/ }).getAttribute('href')).toBe('/bundles/pormake_small/candidates.csv');
  });

  it('shows a value that was not computed as a dash, never as zero', async () => {
    app('/bundles/pormake_small');
    const row = (await screen.findByRole('link', { name: 'nbo__N409__E34' })).closest('tr')!;
    const headers = within(recordsTable()).getAllByRole('columnheader').map((h) => h.textContent ?? '');
    const cell = within(row).getAllByRole('cell')[headers.findIndex((h) => h.startsWith('xtb_gap')) - 1];
    expect(cell.textContent).toBe('— not computed');
    const unpaired = within(screen.getByRole('link', { name: 'pcu__N16__E14' }).closest('tr')!).getAllByRole('cell')[headers.findIndex((h) => h.startsWith('xtb_unpaired_electrons')) - 1];
    expect(unpaired.textContent).toBe('0');
  });

  it('sorts by a column, with the record lacking the value last both ways', async () => {
    app('/bundles/pormake_small');
    const header = await screen.findByRole('columnheader', { name: /^xtb_gap/ });
    expect(header.getAttribute('aria-sort')).toBe('none');
    fireEvent.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(rowNames()).toEqual(['nbo__N409__E14', 'pcu__N16__E34', 'pcu__N16__E14', 'nbo__N409__E34']);
    fireEvent.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(rowNames()).toEqual(['pcu__N16__E14', 'pcu__N16__E34', 'nbo__N409__E14', 'nbo__N409__E34']);
    fireEvent.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('none');
  });

  it('searches, and says so when nothing matches', async () => {
    app('/bundles/pormake_small');
    const box = await screen.findByRole('searchbox');
    fireEvent.change(box, { target: { value: 'nbo' } });
    expect(rowNames()).toEqual(['nbo__N409__E14', 'nbo__N409__E34']);
    expect(screen.getByText('2', { selector: '.results-count strong' })).toBeTruthy();
    fireEvent.change(box, { target: { value: 'no such framework' } });
    expect(screen.getByRole('heading', { name: 'No record matches' })).toBeTruthy();
  });

  it('lets the reader choose columns and explains them', async () => {
    app('/bundles/pormake_small');
    await screen.findByRole('heading', { level: 1, name: 'pormake_small' });
    expect(screen.queryByRole('columnheader', { name: /^cell_a/ })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /^cell_a \(angstrom\)/ }));
    expect(screen.getByRole('columnheader', { name: /^cell_a \(angstrom\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /^lcd \(angstrom\)/ }));
    expect(screen.queryByRole('columnheader', { name: /^lcd/ })).toBeNull();
    expect(screen.getAllByText('Cell length a.').length).toBeGreaterThan(0);
  });

  it('says that a bundle from the computer is gone after a reload', async () => {
    app('/bundles/local');
    expect(await screen.findByRole('heading', { name: 'No bundle is open' })).toBeTruthy();
  });

  it('reports a bundle the site does not have', async () => {
    app('/bundles/not_here');
    expect(await screen.findByText(/This site has no bundle named "not_here"/)).toBeTruthy();
  });
});

describe('Record page', () => {
  it('shows every group with the meaning of each column', async () => {
    app(`/bundles/pormake_small/${SMALL}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'pcu__N16__E14' })).toBeTruthy();
    for (const group of ['Identity and building blocks', 'Structure and checks', 'Composition', 'Pore geometry (Zeo++)', 'xTB electronic proxies', 'Synthetic-accessibility components', 'Filters']) {
      expect(screen.getByRole('heading', { level: 3, name: group })).toBeTruthy();
    }
    const xtb = screen.getByRole('region', { name: 'xTB electronic proxies' });
    expect(within(xtb).getByText('computed')).toBeTruthy();
    expect(within(xtb).getByRole('row', { name: /^xtb_gap/ }).textContent).toContain('2.8622 eV');
    expect(screen.getByText('Structural checks passed')).toBeTruthy();
    for (const text of [G.xtbProxy, G.scoreComponents, G.noConductivity, G.bundleMissing]) expect(screen.getByText(text)).toBeTruthy();
  });

  it('says why a stage has no values for a record', async () => {
    app(`/bundles/pormake_small/${LARGE}`);
    const xtb = await screen.findByRole('region', { name: 'xTB electronic proxies' });
    expect(within(xtb).getByText('skipped')).toBeTruthy();
    expect(within(xtb).getByText(/Not computed for this record/).parentElement?.textContent).toMatch(/atoms/);
    expect(within(xtb).getByRole('row', { name: /^xtb_gap/ }).textContent).toContain('— not computed');
  });

  it('offers the structure file of the bundle', async () => {
    app(`/bundles/pormake_small/${SMALL}`);
    await screen.findByRole('heading', { level: 1, name: 'pcu__N16__E14' });
    // jsdom has no WebGL: the viewer falls back to a download link of the same file
    const links = screen.getAllByRole('link', { name: /Download/ }).map((a) => a.getAttribute('href'));
    expect(links).toContain(`/bundles/pormake_small/structures/${SMALL}.cif`);
  });

  it('reports a record the bundle does not have', async () => {
    app('/bundles/pormake_small/ms-0000000000000000');
    expect(await screen.findByRole('heading', { name: 'Record not found' })).toBeTruthy();
  });
});
