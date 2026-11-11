import { useEffect, useMemo, useState } from 'react';
import { loadDos, sourceBlob } from '../lib/data';
import { G } from '../lib/guardrails';
import { SERIES } from '../lib/palette';
import type { Candidate, DosFile, Manifest, SiteFractions } from '../lib/types';
import { PlotlyChart } from './PlotlyChart';
import { InfoTip } from './ui';

export const GROUPS: { key: keyof SiteFractions; label: string; color: string }[] = [
  { key: 'metal', label: 'Metal', color: SERIES[0] },
  { key: 'oxo', label: 'μ4-O', color: SERIES[1] },
  { key: 'Ocarb', label: 'Carboxylate O', color: SERIES[2] },
  { key: 'linker', label: 'Linker backbone', color: SERIES[3] },
];

export function dominant(f: SiteFractions): { label: string; value: number } {
  let best = GROUPS[0];
  for (const g of GROUPS) if ((f[g.key] ?? 0) > (f[best.key] ?? 0)) best = g;
  return { label: best.label, value: f[best.key] ?? 0 };
}

/** Horizontal 100 % bar of site fractions, with an accessible text equivalent. */
export function FractionBar({ f, title }: { f: SiteFractions; title: string }) {
  const text = GROUPS.map((g) => `${g.label} ${Math.round((f[g.key] ?? 0) * 100)} %`).join(', ');
  return (
    <div className="fbar-row">
      <span className="fbar-title">{title}</span>
      <div className="fbar" role="img" aria-label={`${title}: ${text}`}>
        {GROUPS.map((g) => {
          const v = f[g.key] ?? 0;
          return v > 0.001 ? <span key={g.key} style={{ width: `${v * 100}%`, background: g.color }} title={`${g.label}: ${(v * 100).toFixed(1)} %`} /> : null;
        })}
      </div>
    </div>
  );
}

export function FractionLegend() {
  return (
    <div className="fbar-legend" aria-hidden="true">
      {GROUPS.map((g) => (
        <span key={g.key}><i style={{ background: g.color }} />{g.label}</span>
      ))}
    </div>
  );
}

function DosChart({ path, gap }: { path: string; gap: number | null }) {
  const [dos, setDos] = useState<DosFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadDos(path).then((d) => alive && setDos(d)).catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [path]);
  const { data, layout } = useMemo(() => {
    if (!dos) return { data: [], layout: {} };
    const tr: object[] = [];
    const total = (s: 'up' | 'down') => dos.series[`total_${s}`]?.map((v) => (s === 'down' ? -v : v));
    tr.push({ type: 'scatter', mode: 'lines', name: 'Total', x: dos.E, y: total('up'), line: { color: '#94a3b8', width: 1.5 }, fill: 'tozeroy', fillcolor: 'rgba(148,163,184,0.18)', hovertemplate: 'E − E<sub>VBM</sub> %{x:.2f} eV<br>total %{y:.2f}<extra></extra>' });
    tr.push({ type: 'scatter', mode: 'lines', name: 'Total (spin down)', showlegend: false, x: dos.E, y: total('down'), line: { color: '#94a3b8', width: 1.5 }, fill: 'tozeroy', fillcolor: 'rgba(148,163,184,0.18)', hoverinfo: 'skip' });
    for (const g of GROUPS) {
      const up = dos.series[`${g.key}_up`];
      const dn = dos.series[`${g.key}_down`];
      if (!up) continue;
      tr.push({ type: 'scatter', mode: 'lines', name: g.label, legendgroup: g.key, x: dos.E, y: up, line: { color: g.color, width: 2 }, hovertemplate: `${g.label} %{y:.2f}<extra></extra>` });
      if (dn) tr.push({ type: 'scatter', mode: 'lines', name: g.label, legendgroup: g.key, showlegend: false, x: dos.E, y: dn.map((v) => -v), line: { color: g.color, width: 2 }, hoverinfo: 'skip' });
    }
    const shapes: object[] = [{ type: 'line', x0: 0, x1: 0, yref: 'paper', y0: 0, y1: 1, line: { color: '#0f2237', width: 1, dash: 'dot' } }];
    if (gap != null) shapes.push({ type: 'line', x0: gap, x1: gap, yref: 'paper', y0: 0, y1: 1, line: { color: '#0f2237', width: 1, dash: 'dot' } });
    return {
      data: tr,
      layout: {
        shapes,
        annotations: [
          { x: 0, y: 1, yref: 'paper', text: 'VBM', showarrow: false, xanchor: 'right', font: { size: 11 } },
          ...(gap != null ? [{ x: gap, y: 1, yref: 'paper', text: 'CBM', showarrow: false, xanchor: 'left', font: { size: 11 } }] : []),
        ],
        xaxis: { title: { text: 'E − E_VBM (eV)' }, zeroline: false },
        yaxis: { title: { text: 'DOS (states/eV), ↑ / ↓' }, zeroline: true },
        legend: { orientation: 'h', x: 0, y: 1.18, font: { size: 11 } },
        margin: { l: 60, r: 12, t: 56, b: 48 },
      },
    };
  }, [dos, gap]);
  if (err) return <p className="state state-error small">DOS unavailable: {err}</p>;
  if (!dos) return <div className="chart-loading" style={{ height: 300 }} role="status">Loading DOS…</div>;
  return (
    <PlotlyChart data={data} layout={layout} height={320}
      ariaLabel="Spin-resolved total and site-projected density of states relative to the valence-band maximum"
      description={`${G.dos} Source: ${dos.source}.`} />
  );
}

export default function ElectronicStructure({ c, m }: { c: Candidate; m: Manifest }) {
  const el = c.electronic;
  if (!el) return null;
  const vb = dominant(el.vb);
  const cb = dominant(el.cb);
  return (
    <section className="card" aria-labelledby="el-h">
      <h2 id="el-h" className="h3">Electronic structure (DFT) <InfoTip text={G.bandEdge} /></h2>
      <p className="small">
        Band-edge character within ±{el.window_eV} eV of each edge. The valence-band maximum is mostly on the <strong>{vb.label.toLowerCase()}</strong> ({Math.round(vb.value * 100)} %), the conduction-band minimum mostly on the <strong>{cb.label.toLowerCase()}</strong> ({Math.round(cb.value * 100)} %).
      </p>
      <FractionBar f={el.vb} title="VBM" />
      <FractionBar f={el.cb} title="CBM" />
      <FractionLegend />
      <p className="small muted">Metal d share: VBM {el.vb_metal_d != null ? `${Math.round(el.vb_metal_d * 100)} %` : '—'}, CBM {el.cb_metal_d != null ? `${Math.round(el.cb_metal_d * 100)} %` : '—'}. Spin solution: {el.spin_solution ?? '—'}.</p>
      {el.dos_path ? <DosChart path={el.dos_path} gap={c.dft.status === 'accepted' ? (c.dft.gap_eV ?? null) : null} /> : null}
      <p className="small muted">
        Source: <a href={sourceBlob(m, el.source_row)} target="_blank" rel="noopener noreferrer"><code>{el.source_row}</code></a> (scripts 17 and 19 of the research repository).
      </p>
    </section>
  );
}
