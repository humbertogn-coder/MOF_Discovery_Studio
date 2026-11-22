/** Where bundles come from: the folder public/bundles of the site, or a folder on the reader's computer. */
import { BundleError, isSafeBundlePath, isSafeKey, openBundle, openLocalBundle, type LoadedBundle, type LocalFile } from './bundle';

export interface SiteBundleEntry {
  id: string;
  title: string;
  description: string;
}

function bundlesUrl(rel: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}bundles/${rel}`;
}

/** The bundles shipped with the site (public/bundles/index.json). An unreadable index means none. */
export async function loadSiteIndex(): Promise<SiteBundleEntry[]> {
  const res = await fetch(bundlesUrl('index.json'), { cache: 'no-cache' });
  if (!res.ok) return [];
  const raw: unknown = await res.json().catch(() => null);
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { bundles?: unknown }).bundles) ? (raw as { bundles: unknown[] }).bundles : [];
  return list
    .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
    .filter((b) => isSafeKey(b.id) && b.id !== 'local')
    .map((b) => ({ id: b.id as string, title: typeof b.title === 'string' ? b.title : (b.id as string), description: typeof b.description === 'string' ? b.description : '' }));
}

/** Open a bundle of the site. The id must be one of the index: nothing else is fetched. */
export async function openSiteBundle(id: string): Promise<LoadedBundle> {
  if (!isSafeKey(id) || id === 'local') throw new BundleError(`"${id}" is not the name of a bundle.`);
  const entry = (await loadSiteIndex()).find((b) => b.id === id);
  if (!entry) throw new BundleError(`This site has no bundle named "${id}".`);
  const url = (path: string) => (isSafeBundlePath(path) ? bundlesUrl(`${id}/${path}`) : null);
  return openBundle({
    key: id,
    origin: 'site',
    label: entry.title,
    fileUrl: url,
    read: async (path) => {
      const address = url(path);
      if (!address) throw new Error(`${path} is not a file name of a bundle`);
      const res = await fetch(address, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    },
  });
}

/** Files of a folder picked with <input type="file" webkitdirectory>; the first path segment is the folder. */
export function filesFromInput(list: FileList | File[]): LocalFile[] {
  return Array.from(list).map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file }));
}

const MAX_DROPPED_FILES = 200_000;

async function walk(entry: FileSystemEntry, out: LocalFile[]): Promise<void> {
  if (out.length > MAX_DROPPED_FILES) throw new BundleError('This folder holds too many files to open in the browser.');
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
    out.push({ path: entry.fullPath.replace(/^\/+/, ''), file });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      // readEntries returns the content in batches and an empty list at the end
      const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, out);
    }
  }
}

/** Files of a folder dropped on the page. Falls back to the dropped files when folders cannot be read. */
export async function filesFromDrop(data: DataTransfer): Promise<LocalFile[]> {
  const entries = Array.from(data.items ?? [])
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return filesFromInput(data.files);
  const out: LocalFile[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
}

export { openLocalBundle };
