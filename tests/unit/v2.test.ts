import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { citations } from '../../src/components/Cite';
import { dominant } from '../../src/components/ElectronicStructure';
import type { CampaignFile, CandidatesFile, Manifest, RetroFile } from '../../src/lib/types';

const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));
const recs = read<CandidatesFile>('candidates.json').records;
const m = read<Manifest>('release-manifest.json');

describe('electronic structure data', () => {
  it('exists for every accepted label and only for them', () => {
    for (const c of recs) expect(Boolean(c.electronic)).toBe(c.dft.status === 'accepted');
  });
  it('identifies the dominant site group', () => {
    expect(dominant({ metal: 0.1, oxo: 0, Ocarb: 0.2, linker: 0.7 }).label).toBe('Linker backbone');
    const zn = recs.find((c) => c.id === 'pcu__Zn-N16__short-NH2')!;
    expect(dominant(zn.electronic!.vb).label).toBe('Linker backbone');
    const co = recs.find((c) => c.id === 'bcu__Co-N35__short-H')!;
    expect(dominant(co.electronic!.vb).label).toBe('Metal');
  });
  it('DOS files have consistent grids', () => {
    for (const c of recs.filter((r) => r.electronic?.dos_path)) {
      const d = read<{ E: number[]; series: Record<string, number[]> }>(c.electronic!.dos_path!);
      for (const v of Object.values(d.series)) expect(v.length).toBe(d.E.length);
    }
  });
});

describe('campaign and retrospective bundles', () => {
  const camp = read<CampaignFile>('campaign.json');
  it('counts agree with the candidate records', () => {
    expect(camp.iterations.reduce((s, i) => s + i.accepted, 0)).toBe(recs.filter((c) => c.dft.status === 'accepted').length);
    expect(camp.failures.length).toBe(recs.filter((c) => c.dft.status === 'rejected' || c.dft.status === 'ambiguous').length);
  });
  it('last DFT geometries exist only for non-accepted runs', () => {
    for (const c of recs) if (c.dft_last_geometry) expect(c.dft.status).not.toBe('accepted');
  });
  it('retrospective curves are ordered and include the study budget', () => {
    const r = read<RetroFile>('retro-al.json');
    const labels = r.curves.paper.map((p) => p.labels);
    expect(labels).toEqual([...labels].sort((a, b) => a - b));
    expect(labels).toContain(r.study_budget_labels);
  });
});

describe('citation', () => {
  it('pins the exported commit and lists the authors', () => {
    const c = citations(m);
    expect(c.bibtex).toContain(m.source_commit_hash.slice(0, 7));
    expect(c.bibtex).toContain('Balbuena, Perla B.');
    expect(c.ris).toMatch(/^TY {2}- COMP/);
    expect(c.text).not.toMatch(/doi\.org/i);
  });
});
