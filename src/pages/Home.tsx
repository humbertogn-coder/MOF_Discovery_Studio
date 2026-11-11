import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../app/DataContext';
import { PlotlyChart } from '../components/PlotlyChart';
import { Callout, ErrorState, InfoTip, Loading } from '../components/ui';
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
          marker: { size: 8, color: '#2a78d6', opacity: 0.55, line: { width: 1, color: '#fcfcfb' } },
        },
        {
          type: 'scatter', mode: 'markers', name: 'Accepted DFT label (PBE-D3)',
          x: acc.map(xi), y: acc.map((c) => c.dft.gap_eV), customdata: acc.map((c) => c.slug),
          text: acc.map((c) => `${c.id}<br>accepted DFT gap = ${c.dft.gap_eV!.toFixed(2)} eV (iteration ${c.dft.iteration})`),
          hovertemplate: '%{text}<extra></extra>',
          marker: { size: 11, symbol: 'diamond', color: '#eb6834', line: { width: 2, color: '#fcfcfb' } },
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
  { t: 'PORMAKE assembly', d: 'Hypothetical frameworks built from audited carboxylate nodes, carboxylate-free linkers and five nets.' },
  { t: 'Structural QC', d: 'Overlaps, short contacts, connectivity, H/C coordination, composition and cell checks.' },
  { t: 'Zeo++ descriptors', d: 'Pore limiting and largest cavity diameters (PLD, LCD) plus density.' },
  { t: 'ML prediction', d: 'ExtraTrees ensemble trained on QMOF PBE gaps predicts μ, σ_tree, σ_seed and an OOD flag.' },
  { t: 'Active learning', d: 'Acquisition score with topology novelty, OOD penalty and diversity caps selects DFT batches.' },
  { t: 'DFT validation', d: 'VASP PBE-D3(BJ) relaxations and statics; labels accepted only under explicit rules.' },
];

export default function Home() {
  const { status, error, manifest, candidates } = useData();
  if (status === 'loading') return <Loading />;
  if (status === 'error' || !manifest) return <div className="wrap page"><ErrorState message={error ?? 'Data unavailable'} /></div>;

  const topologies = new Set(candidates.map((c) => c.topology)).size;
  const metals = new Set(candidates.map((c) => c.metal)).size;
  const iterations = Object.keys(manifest.dft_by_iteration).length;
  const counts = [manifest.catalogue_enumerated, manifest.record_count, candidates.filter((c) => c.structure.pld_A != null).length, manifest.records_with_prediction, manifest.records_with_dft_run, manifest.records_with_accepted_dft];
  const countLabel = ['enumerated', 'passed QC', 'with PLD/LCD', 'predicted', 'sent to DFT', 'accepted labels'];

  return (
    <>
      <section className="hero">
        <div className="wrap hero-inner">
          <p className="eyebrow">Research data explorer · v{manifest.app_release}</p>
          <h1>Explore, compare, and prioritize 3D MOF candidates.</h1>
          <p className="lede">
            MOF Discovery Studio opens up the data of an active-learning study of hypothetical three-dimensional metal–organic frameworks: {manifest.record_count} QC-passed structures with predicted PBE band gaps, model spread and out-of-distribution flags, {manifest.records_with_accepted_dft} DFT labels accepted under the study criteria, and the acquisition logic that chose which frameworks to compute.
          </p>
          <div className="hero-cta">
            <Link className="btn btn-primary" to="/explore">
              Explore MOFs
            </Link>
            <Link className="btn btn-ghost-light" to="/active-learning">
              How candidates were prioritized
            </Link>
          </div>
        </div>
      </section>

      <div className="wrap page">
        <Callout kind="science" title="Read this first">
          {G.headline} {G.hypothetical} Predicted values come from a machine-learning model; only the labelled DFT values were computed, and only for a small subset.
        </Callout>

        <section aria-labelledby="snapshot-h" className="section">
          <h2 id="snapshot-h">Dataset snapshot</h2>
          <div className="stats">
            <div className="stat"><span className="stat-n">{manifest.record_count}</span><span className="stat-l">QC-passed hypothetical frameworks <span className="muted">(of {manifest.catalogue_enumerated} enumerated)</span></span></div>
            <div className="stat"><span className="stat-n">{topologies} · {metals}</span><span className="stat-l">topologies · metals</span></div>
            <div className="stat"><span className="stat-n">{manifest.records_with_dft_run}</span><span className="stat-l">frameworks sent to DFT in {iterations} iterations</span></div>
            <div className="stat stat-accent"><span className="stat-n">{manifest.records_with_accepted_dft}</span><span className="stat-l">accepted DFT labels <InfoTip text={G.dftAccepted} /></span></div>
            <div className="stat"><span className="stat-n">{manifest.records_ood}</span><span className="stat-l">flagged out of distribution <InfoTip text={G.ood} /></span></div>
          </div>
          <p className="small muted">
            Counts are computed from the exported data (snapshot <code>{manifest.source_commit_hash.slice(0, 7)}</code>, {shortDate(manifest.source_commit_date)}; predictions from iteration {manifest.source_iteration}).
          </p>
        </section>

        <section aria-labelledby="workflow-h" className="section">
          <h2 id="workflow-h">Research workflow</h2>
          <ol className="workflow">
            {STEPS.map((s, i) => (
              <li key={s.t}>
                <span className="wf-n">{counts[i]}</span>
                <span className="wf-c">{countLabel[i]}</span>
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

        <section className="section grid-2">
          <div>
            <h2>What this site does — and does not do</h2>
            <ul className="ticks">
              <li>Shows the real generated structures, their QC status, descriptors and model predictions.</li>
              <li>Separates predictions, accepted DFT labels, non-accepted DFT runs and missing data.</li>
              <li>Replays the recorded active-learning selections and lets you explore the acquisition weights on frozen predictions.</li>
            </ul>
            <ul className="crosses">
              <li>It does not run new DFT, retrain the model or generate new frameworks.</li>
              <li>It does not predict conductivity, stability or synthesisability.</li>
            </ul>
          </div>
          <div>
            <h2>Level-of-theory context</h2>
            {manifest.context_statistics.map((s) => (
              <Callout key={s.id} kind="note">
                {s.text} <span className="small muted">Source: {s.source}.</span>
              </Callout>
            ))}
            <p className="small">
              Source code and data:{' '}
              <a href={manifest.source_repository_url} target="_blank" rel="noopener noreferrer">
                {manifest.source_repository_url.replace('https://', '')}
              </a>
              . {manifest.citation_status}
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
