import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../app/DataContext';
import { PlotlyChart } from '../components/PlotlyChart';
import { ErrorState, InfoTip, Loading, Notice } from '../components/ui';
import { candidatePath } from '../lib/data';
import { G } from '../lib/guardrails';
import { shortDate } from '../lib/format';
import type { Candidate } from '../lib/types';

/** Deterministic jitter in [-0.28, 0.28] from the candidate id (stable across renders). */
function jitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 0.56;
}

function GapByTopology({ cs }: { cs: Candidate[] }) {
  const navigate = useNavigate();
  const { data, layout } = useMemo(() => {
    const topos = [...new Set(cs.map((c) => c.topology ?? '?'))].sort();
    const xi = (c: Candidate) => topos.indexOf(c.topology ?? '?') + jitter(c.id);
    const pred = cs.filter((c) => c.prediction?.mu_eV != null);
    const acc = cs.filter((c) => c.dft.status === 'accepted' && c.dft.gap_eV != null);
    return {
      data: [
        {
          type: 'scatter', mode: 'markers', name: 'Predicted μ (iteration-3 model)',
          x: pred.map(xi), y: pred.map((c) => c.prediction!.mu_eV), customdata: pred.map((c) => c.slug),
          text: pred.map((c) => `${c.id}<br>predicted μ = ${c.prediction!.mu_eV!.toFixed(2)} eV${c.prediction!.is_ood ? ' · OOD' : ''}`),
          hovertemplate: '%{text}<extra></extra>',
          marker: { size: 8, color: '#8e8e93', opacity: 0.55, line: { width: 1, color: '#ffffff' } },
        },
        {
          type: 'scatter', mode: 'markers', name: 'Accepted DFT label (PBE-D3)',
          x: acc.map(xi), y: acc.map((c) => c.dft.gap_eV), customdata: acc.map((c) => c.slug),
          text: acc.map((c) => `${c.id}<br>accepted DFT gap = ${c.dft.gap_eV!.toFixed(2)} eV (iteration ${c.dft.iteration})`),
          hovertemplate: '%{text}<extra></extra>',
          marker: { size: 11, symbol: 'diamond', color: '#500000', line: { width: 2, color: '#ffffff' } },
        },
      ],
      layout: {
        xaxis: { tickmode: 'array', tickvals: topos.map((_, i) => i), ticktext: topos, title: { text: 'Topology' }, range: [-0.6, topos.length - 0.4], showgrid: false, zeroline: false },
        yaxis: { title: { text: 'Band gap (eV)' }, rangemode: 'tozero' },
      },
    };
  }, [cs]);
  return (
    <PlotlyChart
      data={data}
      layout={layout}
      height={400}
      onPointClick={(slug) => navigate(candidatePath({ slug: String(slug) }))}
      ariaLabel="Scatter plot of predicted band gaps per topology, with accepted DFT gaps overlaid as diamonds"
      description="Each dot is one QC-passed candidate (horizontal spread within a topology is only for legibility). Diamonds are DFT gaps accepted under the study criteria; they are a separate, computed quantity. Click a point to open the candidate."
    />
  );
}

const STEPS = [
  { t: 'Assemble', d: 'PORMAKE builds hypothetical frameworks from audited nodes, linkers and nets.' },
  { t: 'Check', d: 'Structural QC and Zeo++ pore descriptors.' },
  { t: 'Predict', d: 'A model trained on QMOF PBE gaps estimates each band gap and flags extrapolation.' },
  { t: 'Select', d: 'Active learning picks which frameworks to compute next.' },
  { t: 'Compute', d: 'VASP PBE-D3(BJ); labels accepted only under explicit rules.' },
];

export default function Home() {
  const { status, error, manifest, candidates } = useData();
  if (status === 'loading') return <Loading />;
  if (status === 'error' || !manifest) return <div className="wrap page"><ErrorState message={error ?? 'Data unavailable'} /></div>;

  const topologies = new Set(candidates.map((c) => c.topology)).size;
  const metals = new Set(candidates.map((c) => c.metal)).size;
  const iterations = Object.keys(manifest.dft_by_iteration).length;

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <h1>Explore, compare, and prioritize 3D MOF candidates.</h1>
          <p className="lede">
            Data of an active-learning study of hypothetical three-dimensional metal–organic frameworks: {manifest.record_count} screened structures, their predicted band gaps, and {manifest.records_with_accepted_dft} DFT labels.
          </p>
          <div className="hero-cta">
            <Link className="btn btn-primary" to="/explore">
              Explore MOFs
            </Link>
            <Link className="btn btn-ghost" to="/active-learning">
              How candidates were chosen
            </Link>
          </div>
        </div>
      </section>

      <div className="wrap page">
        <Notice lead={G.headline}>
          <p>
            {G.hypothetical} Predicted values come from a machine-learning model; only the labelled DFT values were computed, and only for a small subset.
          </p>
        </Notice>

        <section aria-labelledby="snapshot-h" className="section">
          <h2 id="snapshot-h" className="sr-only">Dataset</h2>
          <div className="stats">
            <div className="stat"><span className="stat-n">{manifest.record_count}</span><span className="stat-l">frameworks passed QC <span className="muted">(of {manifest.catalogue_enumerated})</span></span></div>
            <div className="stat"><span className="stat-n">{manifest.records_with_dft_run}</span><span className="stat-l">sent to DFT in {iterations} rounds</span></div>
            <div className="stat"><span className="stat-n">{manifest.records_with_accepted_dft}</span><span className="stat-l">accepted DFT labels <InfoTip text={G.dftAccepted} /></span></div>
            <div className="stat"><span className="stat-n">{manifest.records_ood}</span><span className="stat-l">out of distribution <InfoTip text={G.ood} /></span></div>
          </div>
          <p className="small muted">
            {topologies} topologies, {metals} metals. Snapshot <code>{manifest.source_commit_hash.slice(0, 7)}</code> ({shortDate(manifest.source_commit_date)}), predictions of iteration {manifest.source_iteration}.
          </p>
        </section>

        <section aria-labelledby="workflow-h" className="section">
          <h2 id="workflow-h">How the study worked</h2>
          <ol className="workflow">
            {STEPS.map((s) => (
              <li key={s.t}>
                <strong>{s.t}</strong>
                <span className="wf-d">{s.d}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="dist-h" className="section">
          <h2 id="dist-h">Predicted band gaps by topology</h2>
          <GapByTopology cs={candidates} />
        </section>

        <details className="about section">
          <summary>About this data</summary>
          <div className="grid-2">
            <div>
              <h3>What this site does and does not do</h3>
              <ul className="ticks">
                <li>Shows the generated structures, their QC status, descriptors and model predictions.</li>
                <li>Keeps predictions, accepted DFT labels, non-accepted DFT runs and missing data apart.</li>
                <li>Replays the recorded active-learning selections on frozen predictions.</li>
              </ul>
              <ul className="crosses">
                <li>It does not run new DFT, retrain the model or generate new frameworks.</li>
                <li>It does not predict conductivity, stability or synthesisability.</li>
              </ul>
            </div>
            <div>
              <h3>Level of theory</h3>
              {manifest.context_statistics.map((s) => (
                <p key={s.id} className="small">
                  {s.text} <span className="muted">Source: {s.source}.</span>
                </p>
              ))}
              <p className="small">
                Source code and data:{' '}
                <a href={manifest.source_repository_url} target="_blank" rel="noopener noreferrer">
                  {manifest.source_repository_url.replace('https://', '')}
                </a>
                . {manifest.citation_status}
              </p>
            </div>
          </div>
        </details>
      </div>
    </>
  );
}
