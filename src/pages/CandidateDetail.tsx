import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MAX_COMPARE, useCompare } from '../app/CompareContext';
import { useData } from '../app/DataContext';
import type { StructureSource } from '../components/StructureViewer';
import { Callout, DftBadge, ErrorState, Formula, HypotheticalTag, InfoTip, KV, Loading, Num, OodBadge, PredictedTag } from '../components/ui';
import { download } from '../lib/csv';
import { dataUrl, findBySlug, safeStructureUrl, sourceBlob } from '../lib/data';
import { fmtBool, MISSING, TOPOLOGY_NOTE } from '../lib/format';
import { G } from '../lib/guardrails';
import type { Candidate, Manifest } from '../lib/types';

const StructureViewer = lazy(() => import('../components/StructureViewer'));

export function structureSources(c: Candidate): StructureSource[] {
  const s: StructureSource[] = [];
  if (c.structure.cif_path) s.push({ path: c.structure.cif_path, format: 'cif', label: 'PORMAKE-generated (CIF)', provenance: 'pormake_generated' });
  if (c.dft_geometry) s.push({ path: c.dft_geometry.path, format: 'vasp', label: 'DFT-relaxed (POSCAR)', provenance: 'dft_relaxed' });
  return s;
}

export function ViewerPanel({ c, compact = false }: { c: Candidate; compact?: boolean }) {
  const sources = structureSources(c);
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [c.id]);
  const src = sources[i];
  if (!src) {
    return (
      <div className="viewer viewer-missing">
        <p><strong>No structure file is available for this candidate in the current release.</strong> All other data on this page remain valid.</p>
      </div>
    );
  }
  return (
    <div className="viewer-panel">
      {sources.length > 1 && (
        <div className="seg geometry-switch" role="group" aria-label="Geometry">
          {sources.map((s, k) => (
            <button key={s.path} type="button" aria-pressed={k === i} onClick={() => setI(k)}>
              {s.provenance === 'dft_relaxed' ? 'DFT-relaxed' : 'PORMAKE-generated'}
            </button>
          ))}
        </div>
      )}
      <Suspense fallback={<div className="viewer"><div className="viewer-stage"><div className="viewer-overlay" role="status">Loading viewer…</div></div></div>}>
        <StructureViewer key={src.path} source={src} expectedAtoms={src.provenance === 'dft_relaxed' ? c.dft_geometry?.n_atoms : c.structure.n_atoms} title={c.id} />
      </Suspense>
      {!compact && (
        <p className="small muted geometry-note">
          {src.provenance === 'dft_relaxed' ? G.geometryDft : G.geometryPormake}
        </p>
      )}
    </div>
  );
}

function Provenance({ c, m }: { c: Candidate; m: Manifest }) {
  const refs = [c.provenance.catalogue, c.provenance.zeopp, c.provenance.prediction, c.structure.cif_source_file, c.dft_geometry?.source_file, ...(c.dft.source_rows ?? [])].filter(Boolean) as string[];
  return (
    <ul className="prov-list">
      {refs.map((r) => (
        <li key={r}>
          <a href={sourceBlob(m, r)} target="_blank" rel="noopener noreferrer"><code>{r}</code></a>
        </li>
      ))}
    </ul>
  );
}

function DftSection({ c }: { c: Candidate }) {
  const d = c.dft;
  if (d.status === 'not_available') {
    return (
      <>
        <p><DftBadge status="not_available" /> {G.dftNotAvailable}</p>
      </>
    );
  }
  if (d.status !== 'accepted') {
    return (
      <>
        <p><DftBadge status={d.status} /> Calculated in iteration {d.iteration ?? MISSING}. {G.dftRejected}</p>
        {d.outcome ? <p><strong>Outcome:</strong> {d.outcome}</p> : null}
        <h4 className="h5">Reasons recorded by the study parser</h4>
        <ul className="reasons">{(d.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
        <dl className="kv-grid">
          <KV k="Volume change">{d.vol_change_pct != null ? <Num v={d.vol_change_pct} digits={1} unit="%" /> : MISSING}</KV>
          <KV k="Max. cell-angle change">{d.max_angle_change_deg != null ? <Num v={d.max_angle_change_deg} digits={1} unit="°" /> : MISSING}</KV>
          <KV k="Relaxation converged (ionic)">{fmtBool(d.relax_converged_ionic)}</KV>
          <KV k="Final max. force"><Num v={d.relax_fmax_final_eV_A} digits={3} unit="eV/Å" /></KV>
        </dl>
        {d.diagnostic_gap_eV != null ? <p className="small muted">The source table contains a gap value from this run; it is not shown because the run did not meet the acceptance criteria.</p> : null}
      </>
    );
  }
  return (
    <>
      <div className="big-value">
        <span className="bv-n"><Num v={d.gap_eV} digits={3} /></span>
        <span className="bv-u">eV</span>
        <DftBadge status="accepted" />
      </div>
      <p className="small">{d.method}. Iteration {d.iteration}. <InfoTip text={G.dftAccepted} /></p>
      {d.known_mof ? <p><strong>Known analogue:</strong> composition corresponds to {d.known_mof} (as identified in the study tables).</p> : null}
      {(d.acceptance_notes ?? []).length > 0 && (
        <Callout kind="warn" title="Acceptance notes">
          <ul>{d.acceptance_notes!.map((n) => <li key={n}>{n}</li>)}</ul>
        </Callout>
      )}
      <dl className="kv-grid">
        <KV k="Direct gap">{fmtBool(d.is_direct)}</KV>
        <KV k="Spin state (study table)">{d.spin_state ?? MISSING}</KV>
        <KV k="Total magnetization"><Num v={d.total_magnetization_muB} digits={2} unit="μB" /></KV>
        <KV k="Relaxation converged (ionic)">{fmtBool(d.relax_converged_ionic)}{d.relax_stopped ? ' (stopped by hand)' : ''}</KV>
        <KV k="Final max. force"><Num v={d.relax_fmax_final_eV_A} digits={3} unit="eV/Å" /></KV>
        <KV k="Static SCF converged">{fmtBool(d.static_converged_electronic)}</KV>
        <KV k="Final-structure QC">{fmtBool(d.final_qc_passed, 'Passed', 'Failed')}</KV>
        <KV k="Volume change vs generated"><Num v={d.vol_change_pct} digits={1} unit="%" /></KV>
        <KV k="Max. cell-angle change"><Num v={d.max_angle_change_deg} digits={1} unit="°" /></KV>
      </dl>
      {(d.spin_solutions ?? []).length > 0 && (
        <details className="disclosure">
          <summary>Spin-solution comparison ({d.spin_solutions!.length} runs on the same geometry)</summary>
          <p className="small">The label uses the lowest-energy spin solution among the runs whose SCF converged. Gaps of the other solutions are diagnostics, not labels.</p>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr><th scope="col">Initial moments</th><th scope="col" className="num">Energy (eV)</th><th scope="col" className="num">Gap (eV)</th><th scope="col">SCF converged</th></tr></thead>
              <tbody>
                {d.spin_solutions!.map((s) => (
                  <tr key={s.start} className={s.start === d.spin_solution ? 'selected' : undefined}>
                    <td>{s.start}{s.start === d.spin_solution ? ' (label)' : ''}</td>
                    <td className="num"><Num v={s.energy_eV} digits={4} /></td>
                    <td className="num"><Num v={s.gap_eV} digits={3} /></td>
                    <td>{fmtBool(s.scf_converged)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="small muted">{G.smallGap}</p>
    </>
  );
}

export default function CandidateDetail() {
  const { slug } = useParams();
  const { status, error, manifest, candidates } = useData();
  const compare = useCompare();
  const c = useMemo(() => findBySlug(candidates, slug), [candidates, slug]);
  useEffect(() => {
    if (c) document.title = `${c.id} · MOF Discovery Studio`;
  }, [c]);

  if (status === 'loading') return <Loading what="candidate" />;
  if (status === 'error' || !manifest) return <div className="wrap page"><ErrorState message={error ?? ''} /></div>;
  if (!c) {
    return (
      <div className="wrap page">
        <h1>Candidate not found</h1>
        <p>No candidate named <code>{slug}</code> exists in this data release (snapshot {manifest.source_commit_hash.slice(0, 7)}).</p>
        <Link className="btn" to="/explore">Back to the Explorer</Link>
      </div>
    );
  }
  const p = c.prediction;
  const s = c.structure;
  const sel = compare.has(c.id);
  const cifUrl = safeStructureUrl(s.cif_path);
  const dftUrl = safeStructureUrl(c.dft_geometry?.path);

  return (
    <div className="wrap page detail">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/explore">Explorer</Link> <span aria-hidden="true">/</span> <span>{c.id}</span></nav>
      <header className="detail-head">
        <div>
          <h1 className="mono-title">{c.id}</h1>
          <p className="detail-sub"><Formula f={c.formula} /> · {c.metal} · {c.topology} · {c.linker_desc ?? c.linker_label}</p>
          <div className="badges">
            <HypotheticalTag />
            <OodBadge ood={p?.is_ood} />
            <DftBadge status={c.dft.status} />
            {c.qc.passed ? <span className="badge badge-muted" title={G.qc}>QC passed</span> : null}
          </div>
        </div>
        <div className="detail-actions">
          <button type="button" className={`btn btn-sm ${sel ? '' : 'btn-primary'}`} onClick={() => compare.toggle(c.id)} disabled={!sel && compare.full} aria-pressed={sel}>
            {sel ? 'Remove from comparison' : compare.full ? `Comparison full (${MAX_COMPARE})` : 'Add to comparison'}
          </button>
          {compare.ids.length > 0 && <Link className="btn btn-sm btn-ghost" to={`/compare?ids=${compare.ids.map(encodeURIComponent).join(',')}`}>Open comparison ({compare.ids.length})</Link>}
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-col">
          <section className="card viewer-card" aria-labelledby="struct-h">
            <h2 id="struct-h" className="h3">Structure</h2>
            <ViewerPanel c={c} />
            <div className="downloads">
              {cifUrl ? <a className="btn btn-sm" href={cifUrl} download={`${c.slug}.cif`}>Download CIF (generated)</a> : <span className="muted small">No CIF available</span>}
              {dftUrl ? <a className="btn btn-sm btn-ghost" href={dftUrl} download={`${c.slug}_DFT-relaxed.vasp`}>Download DFT-relaxed POSCAR</a> : null}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => download(`${c.slug}.json`, JSON.stringify({ source_repository_url: manifest.source_repository_url, source_commit_hash: manifest.source_commit_hash, licence: manifest.licenses_and_attributions.source_data, attribution: manifest.licenses_and_attributions.attribution, record: c }, null, 1), 'application/json')}>Metadata (JSON)</button>
            </div>
          </section>
          <section className="card" aria-labelledby="geo-h">
            <h2 id="geo-h" className="h3">Generated structure</h2>
            <dl className="kv-grid">
              <KV k="Cell a, b, c">{[s.a_A, s.b_A, s.c_A].map((v, i) => <span key={i}><Num v={v} digits={3} />{i < 2 ? ', ' : ' Å'}</span>)}</KV>
              <KV k="Cell α, β, γ">{[s.alpha_deg, s.beta_deg, s.gamma_deg].map((v, i) => <span key={i}><Num v={v} digits={2} />{i < 2 ? ', ' : '°'}</span>)}</KV>
              <KV k="Cell volume"><Num v={s.volume_A3} digits={0} unit="Å³" /></KV>
              <KV k="Atoms in cell">{s.n_atoms ?? MISSING}</KV>
              <KV k="Density" tip={G.density}><Num v={s.density_g_cm3} digits={3} unit="g/cm³" /></KV>
              <KV k="PLD" tip={G.pldLcd}><Num v={s.pld_A} unit="Å" /></KV>
              <KV k="LCD" tip={G.pldLcd}><Num v={s.lcd_A} unit="Å" /></KV>
            </dl>
            {c.dft_geometry ? (
              <p className="small">DFT-relaxed cell: a, b, c = {c.dft_geometry.cell.a_A.toFixed(3)}, {c.dft_geometry.cell.b_A.toFixed(3)}, {c.dft_geometry.cell.c_A.toFixed(3)} Å; α, β, γ = {c.dft_geometry.cell.alpha_deg.toFixed(2)}, {c.dft_geometry.cell.beta_deg.toFixed(2)}, {c.dft_geometry.cell.gamma_deg.toFixed(2)}°.</p>
            ) : null}
          </section>
          <section className="card" aria-labelledby="qc-h">
            <h2 id="qc-h" className="h3">Structural QC <InfoTip text={G.qc} /></h2>
            <dl className="kv-grid">
              <KV k="QC result">{fmtBool(c.qc.passed, 'Passed', 'Failed')}</KV>
              <KV k="Minimum interatomic distance"><Num v={c.qc.min_distance_A} digits={3} unit="Å" /></KV>
              <KV k="Overlaps / short contacts">{c.qc.n_overlaps ?? MISSING} / {c.qc.n_nonbonded_contacts ?? MISSING}</KV>
              <KV k="Connected components">{c.qc.n_components ?? MISSING}</KV>
              <KV k="Composition matches blocks">{fmtBool(c.qc.composition_ok)}</KV>
              <KV k="Node RMSD"><Num v={c.qc.node_rmsd_A} digits={3} unit="Å" /></KV>
            </dl>
          </section>
          <section className="card" aria-labelledby="al-h">
            <h2 id="al-h" className="h3">Active-learning history</h2>
            {c.al_history.length === 0 ? (
              <p className="muted">Not part of any recorded selection pool.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead><tr><th scope="col">Iteration</th><th scope="col" className="num">Rank in eligible pool</th><th scope="col" className="num">Score</th><th scope="col">Selected</th></tr></thead>
                  <tbody>
                    {c.al_history.map((h) => (
                      <tr key={h.iteration}>
                        <td>{h.iteration}</td>
                        <td className="num">{h.rank_in_pool} / {h.pool_size}</td>
                        <td className="num"><Num v={h.acquisition_score} digits={3} /></td>
                        <td>{h.selected ? `Yes (#${h.selection_rank}${h.forced ? ', forced anchor' : ''})` : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted">Iterations in which the candidate was not eligible (already computed or excluded by a study rule) are not listed. <Link to="/active-learning">Explore the acquisition</Link>.</p>
          </section>
        </div>
        <div className="detail-col">
          <section className="card" aria-labelledby="pred-h">
            <h2 id="pred-h" className="h3">Model estimate <PredictedTag /></h2>
            {p ? (
              <>
                <div className="big-value">
                  <span className="bv-n"><Num v={p.mu_eV} /></span>
                  <span className="bv-u">eV predicted</span>
                </div>
                <p className="small">Target: PBE reference band gap · model of iteration {p.iteration ?? MISSING}. <InfoTip text={G.predictedGap} /></p>
                <dl className="kv-grid">
                  <KV k="Model ensemble spread (σ_tree)" tip={G.sigmaTree}><Num v={p.sigma_tree_eV} unit="eV" /></KV>
                  <KV k="Seed disagreement (σ_seed)" tip={G.sigmaSeed}><Num v={p.sigma_seed_eV} digits={3} unit="eV" /></KV>
                  <KV k="Applicability domain" tip={G.ood}><OodBadge ood={p.is_ood} /></KV>
                </dl>
                {p.is_ood && p.ood_reasons.length > 0 && (
                  <Callout kind="warn" title="Out of distribution">
                    Outside the 5–95 % QMOF range for: {p.ood_reasons.map((r) => <code key={r} className="chip">{r}</code>)}. The prediction is an extrapolation.
                  </Callout>
                )}
                {c.dft.prediction_at_selection ? (
                  <p className="small">
                    At selection (iteration {c.dft.prediction_at_selection.iteration} model) the estimate was <Num v={c.dft.prediction_at_selection.mu_eV} /> eV with σ_tree <Num v={c.dft.prediction_at_selection.sigma_tree_eV} /> eV.
                    {c.dft.status === 'accepted' ? ' The iteration-3 model above was trained with this label, so it is not an independent prediction for this candidate.' : ''}
                  </p>
                ) : null}
              </>
            ) : (
              <p>No prediction is available for this candidate in iteration {manifest.source_iteration}.</p>
            )}
          </section>
          <section className="card" aria-labelledby="dft-h">
            <h2 id="dft-h" className="h3">DFT evidence</h2>
            <DftSection c={c} />
          </section>
          <section className="card" aria-labelledby="id-h">
            <h2 id="id-h" className="h3">Identity and building blocks</h2>
            <dl className="kv-grid">
              <KV k="Metal">{c.metal} {c.metal_ox_state != null ? `(+${c.metal_ox_state}, d${c.d_electrons ?? '?'})` : ''}</KV>
              <KV k="Open d shell">{fmtBool(c.open_shell)}</KV>
              <KV k="Node family">{c.node_family} <span className="muted">({c.node_desc}; PORMAKE {c.node_id})</span></KV>
              <KV k="Topology">{c.topology ? TOPOLOGY_NOTE[c.topology] ?? c.topology : MISSING}</KV>
              <KV k="Linker">{c.linker_desc} <span className="muted">({c.linker_label}; PORMAKE edge {c.edge_id})</span></KV>
              <KV k="Linker family / substituent">{c.linker_family} / {c.substituent}</KV>
            </dl>
          </section>
          <section className="card" aria-labelledby="prov-h">
            <h2 id="prov-h" className="h3">Provenance</h2>
            <p className="small">Source rows at commit <code>{manifest.source_commit_hash.slice(0, 7)}</code> of the research repository:</p>
            <Provenance c={c} m={manifest} />
            <p className="small muted">Data licence {manifest.licenses_and_attributions.source_data}. {manifest.licenses_and_attributions.attribution} <a href={dataUrl('DATA_README.txt')} target="_blank" rel="noopener">Field dictionary</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
