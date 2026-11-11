import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../app/DataContext';
import { FractionBar, FractionLegend } from '../components/ElectronicStructure';
import { PlotlyChart } from '../components/PlotlyChart';
import { Callout, ErrorState, InfoTip, Loading, Num } from '../components/ui';
import { candidatePath, loadCampaign, sourceBlob } from '../lib/data';
import { G } from '../lib/guardrails';
import { SERIES } from '../lib/palette';
import type { CampaignFile, Candidate } from '../lib/types';
import { ViewerPanel } from './CandidateDetail';

function familyOf(c: Candidate): string {
  const node = c.node_family ?? '';
  if (node.startsWith('Zn4O')) return 'Zn₄O pcu';
  if (node.startsWith('M4')) return `${c.metal}₄ bcu`;
  if (node.includes('paddlewheel')) return `${c.metal}₂ ${c.topology}`;
  return `${c.metal} ${c.topology}`;
}

export default function DftCampaign() {
  const { status, error, manifest, candidates, byId } = useData();
  const [camp, setCamp] = useState<CampaignFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [failId, setFailId] = useState<string | null>(null);
  useEffect(() => {
    loadCampaign().then((c) => {
      setCamp(c);
      setFailId(c.failures.find((f) => f.has_last_geometry && (f.outcome ?? '').includes('collapse'))?.id ?? c.failures[0]?.id ?? null);
    }).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  const labels = useMemo(
    () => candidates.filter((c) => c.dft.status === 'accepted' && c.electronic).sort((a, b) => familyOf(a).localeCompare(familyOf(b)) || (a.dft.gap_eV ?? 0) - (b.dft.gap_eV ?? 0)),
    [candidates],
  );
  if (status === 'loading' || (!camp && !err)) return <Loading what="DFT campaign" />;
  if (status === 'error' || err || !camp || !manifest) return <div className="wrap page"><ErrorState message={err ?? error ?? ''} /></div>;

  const totalCore = camp.compute.reduce((s, r) => s + (r.core_h ?? 0), 0);
  const failC = failId ? byId.get(failId) : undefined;
  const bars = [
    { name: 'Accepted (all criteria)', y: camp.iterations.map((i) => i.accepted - i.accepted_conditional), color: SERIES[0] },
    { name: 'Accepted (conditional rule)', y: camp.iterations.map((i) => i.accepted_conditional), color: SERIES[2] },
    { name: 'Not accepted', y: camp.iterations.map((i) => i.not_accepted), color: SERIES[1] },
  ].map((t) => ({ type: 'bar', name: t.name, x: camp.iterations.map((i) => `Iteration ${i.iteration}`), y: t.y, marker: { color: t.color, line: { width: 1, color: '#fcfcfb' } }, hovertemplate: `${t.name}: %{y}<extra></extra>` }));

  return (
    <div className="wrap page prose-page campaign">
      <header className="page-head">
        <h1>The DFT campaign</h1>
        <p className="lede-sm">What happened when the selected frameworks met DFT: which labels were accepted, what failed and why, what it cost, which rules the study learned, and where the band edges sit in the accepted frameworks.</p>
      </header>
      <Callout kind="science">{G.dftAccepted} {G.conditional}</Callout>

      <section aria-labelledby="sum-h">
        <h2 id="sum-h">1. Outcome per iteration</h2>
        <div className="grid-2">
          <PlotlyChart data={bars} layout={{ barmode: 'stack', yaxis: { title: { text: 'Frameworks sent to DFT' }, dtick: 2 }, xaxis: { type: 'category' } }} height={300}
            ariaLabel="Stacked bars of accepted and not accepted DFT calculations per iteration" description="Conditional acceptances are relaxations stopped by hand with Fmax ≤ 0.25 eV/Å, or the relax-SCF check by a converged static run." />
          <div>
            <table className="data-table compact">
              <thead><tr><th scope="col">Iteration</th><th scope="col" className="num">Submitted</th><th scope="col" className="num">Accepted</th><th scope="col" className="num">of which conditional</th><th scope="col" className="num">Not accepted</th></tr></thead>
              <tbody>
                {camp.iterations.map((i) => (
                  <tr key={i.iteration}><td>{i.iteration}</td><td className="num">{i.submitted}</td><td className="num">{i.accepted}</td><td className="num">{i.accepted_conditional}</td><td className="num">{i.not_accepted}</td></tr>
                ))}
              </tbody>
            </table>
            {camp.compute.length > 0 && (
              <>
                <h3 className="h5">Compute cost <span className="muted">(core-hours)</span></h3>
                <table className="data-table compact">
                  <thead><tr><th scope="col">Iteration</th><th scope="col">Cluster</th><th scope="col" className="num">Jobs</th><th scope="col" className="num">Core-h</th></tr></thead>
                  <tbody>
                    {camp.compute.map((r) => <tr key={`${r.iteration}-${r.cluster}`}><td>{r.iteration}</td><td>{r.cluster}</td><td className="num">{r.jobs}</td><td className="num">{Math.round(r.core_h).toLocaleString('en-US')}</td></tr>)}
                    <tr><th scope="row" colSpan={3}>Total</th><td className="num"><strong>{Math.round(totalCore).toLocaleString('en-US')}</strong></td></tr>
                  </tbody>
                </table>
                <p className="small muted">Source: <a href={sourceBlob(manifest, 'results/final/table_compute.csv')} target="_blank" rel="noopener noreferrer"><code>results/final/table_compute.csv</code></a> (reconstructed from the SLURM logs).</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="fail-h">
        <h2 id="fail-h">2. What failed, and why <InfoTip text={G.lastGeometry} /></h2>
        <p>{camp.failures.length} of {camp.iterations.reduce((s, i) => s + i.submitted, 0)} frameworks sent to DFT did not give an accepted label. Several QC-passed structures collapsed or sheared during relaxation: passing geometric QC is not the same as being mechanically stable.</p>
        <div className="table-wrap">
          <table className="data-table compact">
            <thead><tr><th scope="col">Candidate</th><th scope="col">Iter.</th><th scope="col">Outcome</th><th scope="col" className="num">ΔV (%)</th><th scope="col" className="num">Δangle (°)</th><th scope="col" className="num">Atoms</th><th scope="col">View</th></tr></thead>
            <tbody>
              {camp.failures.map((f) => (
                <tr key={f.id} className={f.id === failId ? 'selected' : undefined}>
                  <th scope="row" className="col-name"><Link to={candidatePath(f)}>{f.id}</Link></th>
                  <td>{f.iteration}</td>
                  <td>{f.outcome ?? f.reasons[0] ?? '—'}</td>
                  <td className="num"><Num v={f.vol_change_pct} digits={1} /></td>
                  <td className="num"><Num v={f.max_angle_change_deg} digits={1} /></td>
                  <td className="num">{f.n_atoms ?? '—'}</td>
                  <td>{f.has_last_geometry ? <button type="button" className="link-btn" aria-pressed={f.id === failId} onClick={() => setFailId(f.id)}>{f.id === failId ? 'shown' : 'show'}</button> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {failC && (
          <div className="card fail-viewer">
            <div className="card-head">
              <h3 className="h4 mono">{failC.id}</h3>
              <span className="small muted">Switch between the generated structure and the last DFT step to see the change.</span>
            </div>
            <ViewerPanel c={failC} prefer="dft_relaxation_last_step" />
            <ul className="reasons small">{(failC.dft.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
      </section>

      <section aria-labelledby="rules-h">
        <h2 id="rules-h">3. Rules learned from the failures</h2>
        <p>After each iteration the study excluded node families or family/topology/metal combinations that had collapsed, and capped the system size for cost. These rules shaped the next batches (see the <Link to="/active-learning">Active Learning Explorer</Link>).</p>
        <table className="data-table compact">
          <thead><tr><th scope="col">Applied from iteration</th><th scope="col">Excluded node families</th><th scope="col">Excluded family : topology : metal</th><th scope="col" className="num">Max. atoms</th><th scope="col" className="num">Eligible / not yet computed</th></tr></thead>
          <tbody>
            {camp.eligibility_rules.map((r) => (
              <tr key={r.iteration}>
                <td><a href={sourceBlob(manifest, r.source)} target="_blank" rel="noopener noreferrer">{r.iteration}</a></td>
                <td>{r.exclude_family.join(', ') || '—'}</td>
                <td className="wrap-cell">{r.exclude_combo.join('; ') || '—'}</td>
                <td className="num">{r.max_atoms ?? '—'}</td>
                <td className="num">{r.n_eligible ?? '—'} / {r.n_not_yet_computed ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="spin-h">
        <h2 id="spin-h">4. Spin solutions change the label <InfoTip text={G.spinSolutions} /></h2>
        <p>For paddlewheel frameworks the study compared several initial magnetic configurations on the same geometry. The table shows the gap from the standard ferromagnetic start and the gap of the lowest-energy converged solution that became the label.</p>
        <table className="data-table compact">
          <thead><tr><th scope="col">Label</th><th scope="col">Label solution</th><th scope="col" className="num">FM-start gap (eV)</th><th scope="col" className="num">Label gap (eV)</th></tr></thead>
          <tbody>
            {camp.spin_solutions.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="col-name"><Link to={candidatePath(s)}>{s.id}</Link></th>
                <td>{s.label_solution ?? '—'}</td>
                <td className="num"><Num v={s.fm_start_gap_eV} digits={3} /></td>
                <td className="num"><strong><Num v={s.label_gap_eV} digits={3} /></strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="be-h">
        <h2 id="be-h">5. Where the band edges sit <InfoTip text={G.bandEdge} /></h2>
        <p>Share of the states within 0.25 eV of each band edge on the metal, the μ4-O, the carboxylate O and the linker backbone, for all {labels.length} accepted labels, grouped by family. Where the metal dominates both edges, the metal sets the gap; where the linker dominates, substituents can tune it.</p>
        <FractionLegend />
        <div className="table-wrap">
          <table className="data-table compact be-table">
            <thead><tr><th scope="col">Family</th><th scope="col">Label</th><th scope="col" className="num">Gap (eV)</th><th scope="col">VBM character</th><th scope="col">CBM character</th></tr></thead>
            <tbody>
              {labels.map((c) => (
                <tr key={c.id}>
                  <td>{familyOf(c)}</td>
                  <th scope="row" className="col-name"><Link to={candidatePath(c)}>{c.linker_label}</Link></th>
                  <td className="num"><Num v={c.dft.gap_eV} digits={2} /></td>
                  <td className="be-cell"><FractionBar f={c.electronic!.vb} title="" /></td>
                  <td className="be-cell"><FractionBar f={c.electronic!.cb} title="" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{G.smallGap} Open a label for its full DOS.</p>
      </section>
    </div>
  );
}
