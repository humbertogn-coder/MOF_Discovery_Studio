import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BundleError } from '../../src/lib/bundle';
import { filesFromDrop, filesFromInput, loadSiteIndex, openSiteBundle } from '../../src/lib/bundleSource';

const PUBLIC = join(__dirname, '..', '..', 'public');

/** A fetch that serves the folder "public" and records what was asked for. */
function serve(overrides: Record<string, string | null> = {}): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    if (url in overrides) {
      const body = overrides[url];
      return body === null ? new Response('missing', { status: 404 }) : new Response(body);
    }
    try {
      return new Response(readFileSync(join(PUBLIC, url)));
    } catch {
      return new Response('missing', { status: 404 });
    }
  });
  return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('loadSiteIndex', () => {
  it('lists the bundles of the site', async () => {
    serve();
    const list = await loadSiteIndex();
    expect(list.map((b) => b.id)).toEqual(['pormake_small']);
    expect(list[0].description).toContain('no result of the study');
  });

  it('drops entries that could not be part of an address, and the reserved name', async () => {
    serve({ '/bundles/index.json': JSON.stringify({ bundles: [{ id: '../data' }, { id: 'local', title: 'x' }, { id: 'a/b' }, 7, null, { id: 'fine' }, { title: 'no id' }] }) });
    expect(await loadSiteIndex()).toEqual([{ id: 'fine', title: 'fine', description: '' }]);
  });

  it('means "no bundles" when the index is missing or unreadable', async () => {
    serve({ '/bundles/index.json': null });
    expect(await loadSiteIndex()).toEqual([]);
    serve({ '/bundles/index.json': '<!doctype html><title>fallback page</title>' });
    expect(await loadSiteIndex()).toEqual([]);
    serve({ '/bundles/index.json': JSON.stringify({ bundles: 'none' }) });
    expect(await loadSiteIndex()).toEqual([]);
  });
});

describe('openSiteBundle', () => {
  it('opens a listed bundle and fetches only inside its folder', async () => {
    const asked = serve();
    const bundle = await openSiteBundle('pormake_small');
    expect(bundle).toMatchObject({ key: 'pormake_small', origin: 'site', label: 'mofsift example: frameworks from PORMAKE building blocks' });
    expect(bundle.records).toHaveLength(4);
    expect(bundle.fileUrl('candidates.csv')).toBe('/bundles/pormake_small/candidates.csv');
    expect(bundle.fileUrl('../../data/candidates.json')).toBeNull();
    await bundle.readText('structures/ms-678e931c571c8679.cif');
    expect(asked).toEqual(['/bundles/index.json', '/bundles/pormake_small/manifest.json', '/bundles/pormake_small/candidates.json', '/bundles/pormake_small/structures/ms-678e931c571c8679.cif']);
  });

  it('refuses a name that is not in the index, before fetching anything of it', async () => {
    const asked = serve();
    await expect(openSiteBundle('other')).rejects.toThrow(/no bundle named "other"/);
    for (const bad of ['../data', 'local', 'a/b', '', 'pormake_small/..']) await expect(openSiteBundle(bad)).rejects.toThrow(BundleError);
    expect(asked.every((u) => u === '/bundles/index.json')).toBe(true);
  });

  it('reports a listed bundle whose files are missing', async () => {
    serve({ '/bundles/index.json': JSON.stringify({ bundles: [{ id: 'gone' }] }) });
    await expect(openSiteBundle('gone')).rejects.toThrow(/manifest\.json could not be read \(HTTP 404\)/);
  });
});

describe('files of a folder', () => {
  const file = (name: string, relative?: string) => Object.assign(new Blob(['x']), { name, webkitRelativePath: relative ?? '' }) as unknown as File;

  it('uses the path relative to the chosen folder', () => {
    expect(filesFromInput([file('manifest.json', 'demo/manifest.json'), file('a.cif', 'demo/structures/a.cif'), file('loose.txt')]).map((f) => f.path)).toEqual(['demo/manifest.json', 'demo/structures/a.cif', 'loose.txt']);
  });

  it('walks a dropped folder, batch by batch', async () => {
    const leaf = (fullPath: string) => ({ isFile: true, isDirectory: false, fullPath, file: (ok: (f: File) => void) => ok(file(fullPath.split('/').pop()!)) });
    const dir = (fullPath: string, batches: unknown[][]) => ({
      isFile: false,
      isDirectory: true,
      fullPath,
      createReader: () => {
        const left = [...batches, []];
        return { readEntries: (ok: (e: unknown[]) => void) => ok(left.shift() ?? []) };
      },
    });
    const tree = dir('/demo', [[leaf('/demo/manifest.json')], [leaf('/demo/candidates.json'), dir('/demo/structures', [[leaf('/demo/structures/a.cif')]])]]);
    const data = { items: [{ webkitGetAsEntry: () => tree }], files: [] } as unknown as DataTransfer;
    expect((await filesFromDrop(data)).map((f) => f.path)).toEqual(['demo/manifest.json', 'demo/candidates.json', 'demo/structures/a.cif']);
  });

  it('falls back to the dropped files when folders cannot be read', async () => {
    const data = { items: [{}], files: [file('manifest.json')] } as unknown as DataTransfer;
    expect((await filesFromDrop(data)).map((f) => f.path)).toEqual(['manifest.json']);
  });
});
