import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../app/DataContext';
import Cite from '../components/Cite';
import { Callout, ErrorState, Loading } from '../components/ui';
import { dataUrl, sourceBlob } from '../lib/data';
import { shortDate } from '../lib/format';
import { G } from '../lib/guardrails';

export default function Methods() {
  const { status, error, manifest: m, candidates } = useData();
  const oodThresholds = useMemo(() => {
    const set = new Set<string>();
    candidates.forEach((c) => c.prediction?.ood_reasons.forEach((r) => set.add(r)));
    return [...set].sort();
  }, [candidates]);
  if (status === 'loading') return <Loading />;
  if (status === 'error' || !m) return <div className="wrap page"><ErrorState message={error ?? ''} /></div>;
  const L = m.licenses_and_attributions;
  const src = (f: string) => <a href={sourceBlob(m, f)} target="_blank" rel="noopener noreferrer"><code>{f}</code></a>;
  const mi = m.model_info as { n_qmof?: number; n_dft?: number; seeds?: number[]; et_params?: Record<string, unknown>; features?: string; sklearn?: string };

  return (
    <div className="wrap page prose-page">
      <header className="page-head">
        <h1>Methods, data and research integrity</h1>
        <p className="lede-sm">What the numbers on this site are, where they come from, and what they do not mean.</p>
      </header>
      <nav className="toc" aria-label="On this page">
        <a href="#generation">1. Generation & QC</a><a href="#descriptors">2. Descriptors</a><a href="#model">3. Model</a><a href="#dft">4. DFT</a><a href="#al">5. Active learning</a><a href="#distinctions">6. Distinctions</a><a href="#citation">7. Sources & citation</a><a href="#snapshot">8. Snapshot</a>
      </nav>

      <section id="generation">
        <h2>1. Candidate generation and QC scope</h2>
        <p>Hypothetical 3D frameworks were assembled with PORMAKE from native, charge-balanced carboxylate nodes (M₃(CO₂)₆, Zn₄O(CO₂)₆, M₂(CO₂)₄ paddlewheel and tetrahedral, M₄(CO₂)₈) and carboxylate-free spacers that give BDC, NH₂-BDC, F₄-BDC, pyridine-dicarboxylate, BPDC, F₈-BPDC, phenylpyridine- and bipyridine-dicarboxylate linkers, on the pcu, nbo, cds, dia and bcu nets. Of {m.catalogue_enumerated} enumerated combinations, {m.record_count} passed QC and are shown here.</p>
        <p>{G.qc} QC code: {src('src/mofal/qc.py')}.</p>
        <p>{G.hypothetical}</p>
      </section>

      <section id="descriptors">
        <h2>2. Descriptor sources and units</h2>
        <ul>
          <li>{G.pldLcd} Source table: {src('data/catalogue/zeopp.csv')}.</li>
          <li>{G.density}</li>
          <li>Cell lengths (Å) come from the catalogue table; cell angles (°) are parsed from the exported CIF.</li>
          <li>Missing values are shown as “—” and exported as empty cells / <code>null</code>, never as zero. In this snapshot {candidates.filter((c) => c.structure.pld_A == null).length} candidates lack PLD.</li>
        </ul>
      </section>

      <section id="model">
        <h2>3. What the model predicts</h2>
        <p>{G.predictedGap}</p>
        <p>Model of iteration {m.source_iteration}: {mi.n_qmof ?? '?'} QMOF structures plus {mi.n_dft ?? '?'} accepted DFT labels; five ExtraTrees regressors (seeds {(mi.seeds ?? []).join(', ')}; {mi.et_params ? Object.entries(mi.et_params).map(([k, v]) => `${k}=${v}`).join(', ') : ''}); feature set {mi.features ?? '?'}; scikit-learn {mi.sklearn ?? '?'}. Trained models are not distributed (they are rebuilt deterministically by the research scripts) and are not used by this site.</p>
        <ul>
          <li>{G.sigmaTree}</li>
          <li>{G.sigmaSeed}</li>
          <li>{G.ood} Thresholds appearing in this snapshot: {oodThresholds.map((t) => <code key={t} className="chip">{t}</code>)}. Code: {src('src/mofal/surrogate.py')}.</li>
        </ul>
        <p>For candidates with an accepted label, the iteration-{m.source_iteration} model was trained on that label, so its prediction for that candidate is not independent. The candidate page also shows the estimate of the model that selected it. No accuracy metrics are recomputed on this site.</p>
      </section>

      <section id="dft">
        <h2>4. DFT validation protocol and label acceptance</h2>
        <p>VASP 6.3.2, PBE-D3(BJ), 520 eV cutoff, spin polarised with a high-spin ferromagnetic initial guess, Γ-centred k-mesh; full-cell relaxation (ISIF = 3) followed by a static calculation; M₂ paddlewheels also received broken-symmetry statics and the lowest-energy converged spin solution gives the label (protocol v2; see {src('hpc/README.md')}).</p>
        <p>A label is accepted (<code>label_ok</code>) only if the relaxation and static SCF converged, the final structure passes QC, no ligand atom carries a moment above 0.3 μB and the framework did not collapse (|ΔV| ≤ 20 %, Δangle ≤ 10°). Rules are implemented in {src('scripts/08_parse_dft.py')}.</p>
        <Callout kind="warn">{G.conditional}</Callout>
        <p>Of {m.records_with_dft_run} frameworks computed, {m.records_with_accepted_dft} labels were accepted and {m.records_with_rejected_dft} were not ({m.dft_sensitivity_runs} additional spin-state sensitivity runs are attached to their parent candidate as diagnostics). Raw VASP outputs are not part of this site.</p>
        <p>For the accepted labels the site also shows the band-edge character (states within 0.25 eV of the VBM and CBM, split into metal, μ4-O, carboxylate O and linker) and the broadened, site-projected DOS computed by the study (scripts 17 and 19). Failed calculations, compute cost, learned eligibility rules and spin-solution comparisons are summarised on the <Link to="/dft-campaign">DFT campaign</Link> page. {G.spinSolutions}</p>
      </section>

      <section id="al">
        <h2>5. Active learning</h2>
        <p>{G.acquisition} Score: <code>score = μ − κ·σ_tree − α / max(1, N_topo) + β·I_ood</code>, from {src('src/mofal/acquisition.py')}; batches were selected with {src('scripts/06_select_batch.py')}, which also excludes everything already sent to DFT and applies eligibility rules learned from failed calculations.</p>
        <p>The <Link to="/active-learning">Active Learning Explorer</Link> replays iterations {Object.keys(m.active_learning_replay).join(', ')} from the recorded pools and checks in the browser that the recorded batches are reproduced exactly (export-time check: {Object.entries(m.active_learning_replay).map(([k, v]) => `iteration ${k} ${v.batch_matches ? 'reproduced' : 'NOT reproduced'}`).join('; ')}). Iteration 0 has no recorded rules file; its settings (caps 3/2/3, two forced closed-shell anchors) come from the project notes and are confirmed only by the exact replay. {G.replay}</p>
        <p>{G.retro} Its summary statistics, computed by the study with <code>scripts/15_retrospective_al.py</code>, are shown at the bottom of the Active Learning Explorer.</p>
      </section>

      <section id="distinctions">
        <h2>6. Important distinctions</h2>
        <ul className="crosses">
          <li>{G.headline}</li>
          <li>QC passed ≠ synthesisable or thermodynamically stable.</li>
          <li>DFT gap ≠ experimental optical gap or transport gap.</li>
          <li>{G.smallGap}</li>
          <li>{G.noConductivity}</li>
          <li>OOD ≠ invalid structure.</li>
          <li>xTB results in the research repository use a different method and are not mixed into any value shown here.</li>
        </ul>
        {m.context_statistics.map((c) => <Callout key={c.id} kind="note">{c.text} <span className="small muted">({c.source})</span></Callout>)}
      </section>

      <section id="citation">
        <h2>7. Sources, attribution, licences and citation</h2>
        <p><strong>Research team:</strong> {L.attribution}</p>
        <p><strong>Publication status:</strong> {m.citation_status}</p>
        <h3 className="h4">How to cite</h3>
        <Cite m={m} />
        <p><strong>Repository:</strong> <a href={m.source_repository_url} target="_blank" rel="noopener noreferrer">{m.source_repository_url}</a> ({src('CITATION.cff')}).</p>
        <p><strong>Licences:</strong> study data {L.source_data}; research code {L.source_code}{L.copyright ? ` (© ${L.copyright})` : ''}. Statement: {L.data_statement_source}. This website’s own code is MIT-licensed.</p>
        <p><strong>Third-party tools and data used by the study:</strong></p>
        <ul>{L.third_party.map((t) => <li key={t}>{t}</li>)}</ul>
        <p><strong>Not redistributed here:</strong></p>
        <ul>{L.not_redistributed.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>

      <section id="snapshot">
        <h2>8. Dataset snapshot and reproducibility</h2>
        <table className="data-table compact kv-table">
          <tbody>
            <tr><th scope="row">Source commit</th><td><a href={`${m.source_repository_url}/tree/${m.source_commit_hash.replace(/-dirty$/, '')}`} target="_blank" rel="noopener noreferrer"><code>{m.source_commit_hash}</code></a> ({shortDate(m.source_commit_date)})</td></tr>
            <tr><th scope="row">Prediction iteration</th><td>{m.source_iteration}</td></tr>
            <tr><th scope="row">Export script / schema</th><td>{m.export_script_version} / {m.schema_version}</td></tr>
            <tr><th scope="row">Exported (UTC)</th><td>{m.export_timestamp_utc}</td></tr>
            <tr><th scope="row">App release</th><td>{m.app_release}</td></tr>
            <tr><th scope="row">Source files checksummed</th><td>{Object.keys(m.source_checksums_sha256).length} (SHA-256 in the manifest)</td></tr>
          </tbody>
        </table>
        <p>Download: <a href={dataUrl('release-manifest.json')}>release-manifest.json</a> · <a href={dataUrl('candidates.json')}>candidates.json</a> · <a href={dataUrl('active-learning.json')}>active-learning.json</a> · <a href={dataUrl('DATA_README.txt')}>DATA_README.txt</a></p>
        {m.warnings.length > 0 && (
          <>
            <h3 className="h4">Export warnings</h3>
            <ul className="small">{m.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </>
        )}
        <h3 className="h4">Processing decisions</h3>
        <ul className="small">{m.decisions.map((d) => <li key={d}>{d}</li>)}</ul>
      </section>
    </div>
  );
}
