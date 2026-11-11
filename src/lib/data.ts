import type { AlFile, CampaignFile, Candidate, CandidatesFile, DosFile, Manifest, RetroFile } from './types';

const SAFE_PATH = /^structures\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(cif|vasp)$/;

/** Resolve a path inside public/data respecting the deployment base path. */
export function dataUrl(rel: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}data/${rel}`;
}

/** Only allow structure paths of the exact exported shape (no traversal, no absolute URLs). */
export function safeStructureUrl(rel: string | null | undefined): string | null {
  if (!rel || !SAFE_PATH.test(rel)) return null;
  return dataUrl(rel);
}

async function getJson<T>(rel: string): Promise<T> {
  const res = await fetch(dataUrl(rel), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${rel} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export const loadManifest = () => getJson<Manifest>('release-manifest.json');
export const loadCandidates = () => getJson<CandidatesFile>('candidates.json');
export const loadActiveLearning = () => getJson<AlFile>('active-learning.json');
export const loadCampaign = () => getJson<CampaignFile>('campaign.json');
export const loadRetro = () => getJson<RetroFile>('retro-al.json');

const SAFE_DOS = /^electronic\/[A-Za-z0-9_-]+\.json$/;
export function loadDos(rel: string): Promise<DosFile> {
  if (!SAFE_DOS.test(rel)) return Promise.reject(new Error('Invalid DOS path'));
  return getJson<DosFile>(rel);
}

export async function loadStructureText(rel: string): Promise<string> {
  const url = safeStructureUrl(rel);
  if (!url) throw new Error('Invalid structure path');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Structure file not available (HTTP ${res.status})`);
  const text = await res.text();
  if (text.length > 2_000_000) throw new Error('Structure file too large to render safely');
  return text;
}

export function findBySlug(cs: Candidate[], slug: string | undefined): Candidate | undefined {
  if (!slug) return undefined;
  return cs.find((c) => c.slug === slug) ?? cs.find((c) => c.id === slug);
}

export function candidatePath(c: Pick<Candidate, 'slug'>): string {
  return `/candidate/${encodeURIComponent(c.slug)}`;
}

/** Link to a file (optionally `path:line`) at the exact source commit on GitHub. */
export function sourceBlob(m: Manifest, ref: string): string {
  const [file, line] = ref.split(':');
  const base = `${m.source_repository_url}/blob/${m.source_commit_hash.replace(/-dirty$/, '')}/${file}`;
  return line ? `${base}?plain=1#L${line}` : base;
}
