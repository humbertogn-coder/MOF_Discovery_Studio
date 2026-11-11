import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../app/DataContext';
import { PlotlyChart } from '../components/PlotlyChart';
import { Callout, DftBadge, ErrorState, InfoTip, Loading, Num } from '../components/ui';
import { applyEligibility, ELIGIBILITY_LABEL, eligibilityReason, rankPool, selectBatch, SKIP_LABEL, type Caps, type ScoredRow, type Weights } from '../lib/acquisition';
import { download, toCsv } from '../lib/csv';
import { candidatePath, loadActiveLearning } from '../lib/data';
import { G } from '../lib/guardrails';
import { SERIES } from '../lib/palette';
import type { AlFile, AlIteration } from '../lib/types';

interface Settings extends Weights, Caps {
  n: number;
  useForced: boolean;
  applyRules: boolean;
}

function defaultsFor(it: AlIteration): Settings {
  const r = it.rules;
  return { kappa: r.kappa, alpha: r.alpha, beta: r.beta, n: r.n, max_per_topology: r.max_per_topology, max_per_metal: r.max_per_metal, max_per_substituent: r.max_per_substituent, useForced: r.forced.length > 0, applyRules: true };
}

const LABELS: Record<keyof Settings, string> = { kappa: 'κ', alpha: 'α', beta: 'β', n: 'batch size', max_per_topology: 'topology cap', max_per_metal: 'metal cap', max_per_substituent: 'substituent cap', useForced: 'forced anchors', applyRules: 'eligibility rules' };

/** Run the acquisition for one iteration and settings. Exported for tests. */
export function runAcquisition(it: AlIteration, s: Settings) {
  const pool = it.mode === 'scenario' && s.applyRules ? applyEligibility(it.pool, it.rules) : it.pool;
  const ranked = rankPool(pool, it.n_topo, s, it.rules.sigma);
  const sel = selectBatch(ranked, s.n, s, s.useForced ? it.rules.forced : []);
  return { pool, ranked, sel };
}

function Slider({ id, label, value, min, max, step, onChange, tip, isDefault }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; tip: string; isDefault: boolean }) {
  return (
    <div className={`al-slider ${isDefault ? '' : 'changed'}`}>
      <label htmlFor={id}>
        <span className="al-sym">{label}</span> <InfoTip text={tip} label={`About ${label}`} />
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" aria-label={`${label} value`} min={min} max={max} step={step} value={value} onChange={(e) => e.target.value !== '' && onChange(Math.min(max, Math.max(min, Number(e.target.value))))} />
    </div>
  );
}

function IntField({ label, value, min, max, onChange, isDefault }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; isDefault: boolean }) {
  return (
    <label className={`field small-field ${isDefault ? '' : 'changed'}`}>
      <span>{label}</span>
      <input type="number" min={min} max={max} step={1} value={value} onChange={(e) => e.target.value !== '' && onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value)))))} />
    </label>
  );
}

export default function ActiveLearning() {
  const { byId, manifest } = useData();
  const [al, setAl] = useState<AlFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState<number>(-1);
  const [s, setS] = useState<Settings | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    loadActiveLearning()
      .then((f) => {
        setAl(f);
        const start = Math.max(0, f.iterations.findIndex((i) => i.iteration === 1));
        setIdx(start);
        setS(defaultsFor(f.iterations[start]));
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const it = al && idx >= 0 ? al.iterations[idx] : null;
  const defaults = useMemo(() => (it ? defaultsFor(it) : null), [it]);
  const result = useMemo(() => (it && s ? runAcquisition(it, s) : null), [it, s]);
  const defResult = useMemo(() => (it && defaults ? runAcquisition(it, defaults) : null), [it, defaults]);

  if (err) return <div className="wrap page"><ErrorState message={err} /></div>;
  if (!al || !it || !s || !defaults || !result || !defResult) return <Loading what="active-learning data" />;

  const changed = (Object.keys(defaults) as (keyof Settings)[]).filter((k) => defaults[k] !== s[k]);
  const isDefault = changed.length === 0;
  const defRank = new Map(defResult.ranked.map((r) => [r.id, r.rank]));
  const selIds = new Set(result.sel.selected.map((r) => r.id));
  const defIds = defResult.sel.selected.map((r) => r.id);
  const reproduces = defIds.join('|') === it.reference_selection.join('|');
  const scoreDiff = it.mode === 'replay'
    ? Math.max(...defResult.ranked.map((r) => Math.abs(r.score - (r.ref_score ?? NaN))))
    : Math.max(...defResult.ranked.map((r) => Math.abs(r.score - (it.reference_scores?.[r.id] ?? NaN))));
  const excluded = it.mode === 'scenario' && s.applyRules ? it.pool.filter((r) => eligibilityReason(r, it.rules)) : [];
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });
  const choose = (i: number) => {
    setIdx(i);
    setS(defaultsFor(al.iterations[i]));
    setShowAll(false);
  };
  const rows = showAll ? result.ranked : result.ranked.slice(0, 25);
  const rowStatus = (r: ScoredRow) => {
    const sel = result.sel.selected.find((x) => x.id === r.id);
    if (sel) return <span className="badge badge-sel">Selected #{sel.selection_rank}{sel.forced ? ' (forced)' : ''}</span>;
    const why = result.sel.skipped.get(r.id);
    return why ? <span className="muted small">{SKIP_LABEL[why]}</span> : null;
  };

  const exportBatch = () => {
    const header = ['selection_rank', 'id', 'acquisition_score', 'mu_eV', 'sigma_tree_eV', 'is_ood', 'ood_reasons', 'topology', 'metal', 'substituent', 'forced', 'iteration', 'mode', 'kappa', 'alpha', 'beta', 'max_per_topology', 'max_per_metal', 'max_per_substituent', 'batch_size_requested', 'source_commit'];
    const body = result.sel.selected.map((r) => [r.selection_rank, r.id, r.score, r.mu, r.sigma_tree, r.is_ood, r.ood_reasons.join(';'), r.topology, r.metal, r.substituent, r.forced, it.iteration, it.mode, s.kappa, s.alpha, s.beta, s.max_per_topology, s.max_per_metal, s.max_per_substituent, s.n, manifest?.source_commit_hash ?? '']);
    download(`acquisition_iter${it.iteration}_${isDefault ? 'study-defaults' : 'custom'}.csv`, toCsv(header, body));
  };

  const scatter = [
    {
      type: 'scatter', mode: 'markers', name: 'Not selected',
      x: result.ranked.filter((r) => !selIds.has(r.id)).map((r) => r.sigma_tree), y: result.ranked.filter((r) => !selIds.has(r.id)).map((r) => r.mu),
      customdata: result.ranked.filter((r) => !selIds.has(r.id)).map((r) => byId.get(r.id)?.slug ?? r.id),
      text: result.ranked.filter((r) => !selIds.has(r.id)).map((r) => `${r.id}<br>rank ${r.rank} · score ${r.score.toFixed(3)}${r.is_ood ? ' · OOD' : ''}`),
      hovertemplate: '%{text}<extra></extra>', marker: { size: 8, color: '#94a3b8', opacity: 0.7, symbol: result.ranked.filter((r) => !selIds.has(r.id)).map((r) => (r.is_ood ? 'circle-open' : 'circle')), line: { width: 1.5, color: '#94a3b8' } },
    },
    {
      type: 'scatter', mode: 'markers', name: 'Selected batch',
      x: result.sel.selected.map((r) => r.sigma_tree), y: result.sel.selected.map((r) => r.mu), customdata: result.sel.selected.map((r) => byId.get(r.id)?.slug ?? r.id),
      text: result.sel.selected.map((r) => `#${r.selection_rank} ${r.id}<br>score ${r.score.toFixed(3)}${r.forced ? ' · forced' : ''}${r.is_ood ? ' · OOD' : ''}`),
      hovertemplate: '%{text}<extra></extra>', marker: { size: 12, color: SERIES[1], symbol: result.sel.selected.map((r) => (r.is_ood ? 'diamond-open' : 'diamond')), line: { width: 2, color: SERIES[1] } },
    },
  ];
  const sel = result.sel.selected;
  const decomposition = [
    { name: 'μ (predicted gap)', y: sel.map((r) => r.term_mu), color: SERIES[0] },
    { name: '−κ·σ_tree', y: sel.map((r) => r.term_sigma), color: SERIES[1] },
    { name: '−α / max(1, N_topo)', y: sel.map((r) => r.term_novelty), color: SERIES[2] },
    { name: '+β·I_ood', y: sel.map((r) => r.term_ood), color: SERIES[3] },
  ].map((t): Record<string, unknown> => ({ type: 'bar', name: t.name, x: sel.map((r) => `#${r.selection_rank}`), y: t.y, marker: { color: t.color, line: { width: 1, color: '#fcfcfb' } }, hovertext: sel.map((r) => r.id), textposition: 'none', hovertemplate: `%{hovertext}<br>${t.name}: %{y:.3f}<extra></extra>` }));
  decomposition.push({ type: 'scatter', mode: 'markers', name: 'Score (sum of segments)', x: sel.map((r) => `#${r.selection_rank}`), y: sel.map((r) => r.score), hovertext: sel.map((r) => r.id), hovertemplate: '%{hovertext}<br>score: %{y:.3f}<extra></extra>', marker: { symbol: 'diamond', size: 11, color: '#0f2237', line: { width: 2, color: '#fcfcfb' } } });

  return (
    <div className="wrap page al">
      <header className="page-head">
        <h1>Active Learning Explorer</h1>
        <p className="lede-sm">How the study chose which frameworks to send to DFT — replayed from the recorded inputs, and open for what-if exploration on frozen predictions.</p>
      </header>
      <Callout kind="science" title="Interactive replay, not new science">{G.replay} {G.acquisition}</Callout>

      <div className="tabs" role="tablist" aria-label="Iteration">
        {al.iterations.map((x, i) => (
          <button key={x.iteration} role="tab" type="button" aria-selected={i === idx} onClick={() => choose(i)} className={i === idx ? 'active' : undefined}>
            {x.mode === 'replay' ? `Iteration ${x.iteration} · recorded` : `Iteration ${x.iteration} · scenario`}
          </button>
        ))}
      </div>

      <section className="card al-context">
        <p>{it.description}</p>
        <div className="al-facts">
          <span><strong>{it.pool.length}</strong> candidates in the {it.mode === 'replay' ? 'recorded eligible pool' : 'not-yet-computed pool'}</span>
          {it.n_not_yet_computed != null && it.mode === 'replay' ? <span>{it.n_not_yet_computed} not yet computed before eligibility rules</span> : null}
          {excluded.length > 0 ? <span>{excluded.length} excluded by eligibility rules</span> : null}
          <span>Rules: <span className="small">{it.rules_source}</span></span>
        </div>
        {it.mode === 'replay' ? (
          <p className={`check-line ${reproduces && scoreDiff < 1e-9 ? 'ok' : 'bad'}`}>
            {reproduces && scoreDiff < 1e-9 ? '✓' : '✗'} With the recorded settings, this browser reproduces the recorded batch ({it.reference_selection.length} candidates, same order) and the recorded scores (max |Δ| = {scoreDiff.toExponential(1)}).
          </p>
        ) : (
          <p className={`check-line ${reproduces ? 'ok' : 'bad'}`}>
            {reproduces ? '✓' : '✗'} With the default settings, this browser matches the Python reference computed at export (max |Δscore| = {scoreDiff.toExponential(1)}). No iteration-3 batch exists in the study to compare against.
          </p>
        )}
      </section>

      <div className="al-grid">
        <section className="card al-controls" aria-labelledby="ctrl-h">
          <div className="card-head">
            <h2 id="ctrl-h" className="h3">Settings</h2>
            <button type="button" className="btn btn-sm" onClick={() => setS(defaults)} disabled={isDefault}>Reset to study defaults</button>
          </div>
          <div className="equation" aria-label="Acquisition score equation">
            score = μ − <span className="al-sym">κ</span>·σ<sub>tree</sub> − <span className="al-sym">α</span> / max(1, N<sub>topo</sub>) + <span className="al-sym">β</span>·I<sub>ood</sub>
            <span className="small muted"> · lower ranks first</span>
          </div>
          <Slider id="k" label="κ" value={s.kappa} min={0} max={3} step={0.05} onChange={(v) => set({ kappa: v })} tip={G.kappa} isDefault={s.kappa === defaults.kappa} />
          <Slider id="a" label="α" value={s.alpha} min={0} max={1.5} step={0.01} onChange={(v) => set({ alpha: v })} tip={G.alpha} isDefault={s.alpha === defaults.alpha} />
          <Slider id="b" label="β" value={s.beta} min={0} max={2} step={0.05} onChange={(v) => set({ beta: v })} tip={G.beta} isDefault={s.beta === defaults.beta} />
          <div className="int-row">
            <IntField label="Batch size" value={s.n} min={1} max={40} onChange={(v) => set({ n: v })} isDefault={s.n === defaults.n} />
            <IntField label="Max / topology" value={s.max_per_topology} min={1} max={20} onChange={(v) => set({ max_per_topology: v })} isDefault={s.max_per_topology === defaults.max_per_topology} />
            <IntField label="Max / metal" value={s.max_per_metal} min={1} max={20} onChange={(v) => set({ max_per_metal: v })} isDefault={s.max_per_metal === defaults.max_per_metal} />
            <IntField label="Max / substituent" value={s.max_per_substituent} min={1} max={20} onChange={(v) => set({ max_per_substituent: v })} isDefault={s.max_per_substituent === defaults.max_per_substituent} />
          </div>
          {it.mode === 'scenario' && (
            <button type="button" className="link-btn small" onClick={() => set({ max_per_topology: 4, max_per_metal: 2, max_per_substituent: 4 })}>Use the caps applied in iterations 1–2 (4 / 2 / 4)</button>
          )}
          {it.rules.forced.length > 0 ? (
            <label className="check">
              <input type="checkbox" checked={s.useForced} onChange={(e) => set({ useForced: e.target.checked })} /> Force the study’s anchor candidate{it.rules.forced.length > 1 ? 's' : ''} ({it.rules.forced.join(', ')}); taken first and counted toward the caps
            </label>
          ) : (
            <p className="small muted">No forced candidates were used in this iteration; forced selection is therefore not offered.</p>
          )}
          {it.mode === 'scenario' && (
            <label className="check">
              <input type="checkbox" checked={s.applyRules} onChange={(e) => set({ applyRules: e.target.checked })} /> Apply the latest study eligibility rules (exclude {it.rules.exclude_family.join(', ') || 'no family'}; {it.rules.exclude_combo.length} family/topology/metal combinations; ≤ {it.rules.max_atoms ?? '∞'} atoms)
            </label>
          )}
          {!isDefault && (
            <Callout kind="warn" title="Custom settings">Differs from the study defaults in: {changed.map((k) => LABELS[k]).join(', ')}. Results below are a what-if exploration, not a recorded selection.</Callout>
          )}
          <details className="disclosure">
            <summary>Variables explained</summary>
            <dl className="defs">
              <dt>μ</dt><dd>{G.predictedGap}</dd>
              <dt>σ_tree</dt><dd>{G.sigmaTree}</dd>
              <dt>κ</dt><dd>{G.kappa}</dd>
              <dt>N_topo, α</dt><dd>{G.alpha}</dd>
              <dt>I_ood, β</dt><dd>{G.beta} {G.ood}</dd>
              <dt>Caps</dt><dd>The ranked list is walked from the lowest score; a candidate is skipped if its topology, metal or substituent already reached its cap in the batch.</dd>
            </dl>
          </details>
          <div className="ntopo">
            <h3 className="h5">N_topo used for this iteration</h3>
            <div className="chips">
              {[...new Set([...Object.keys(it.n_topo), ...it.pool.map((r) => r.topology)])].sort().map((t) => (
                <span key={t} className="chip">{t}: {it.n_topo[t] ?? 0} → novelty {(1 / Math.max(1, it.n_topo[t] ?? 0)).toFixed(2)}</span>
              ))}
            </div>
            {it.n_topo_recomputed_from_final_dft && JSON.stringify(it.n_topo_recomputed_from_final_dft) !== JSON.stringify(it.n_topo) ? (
              <p className="small muted">Recorded at selection time. Recomputing from the final DFT table gives {Object.entries(it.n_topo_recomputed_from_final_dft).map(([k, v]) => `${k} ${v}`).join(', ')}, because a label was accepted after this batch was chosen.</p>
            ) : null}
          </div>
        </section>

        <div className="al-results">
          <section className="card" aria-labelledby="batch-h">
            <div className="card-head">
              <h2 id="batch-h" className="h3">Selected batch {isDefault ? '(study defaults)' : '(custom)'}</h2>
              <button type="button" className="btn btn-sm" onClick={exportBatch} disabled={!sel.length}>Download CSV</button>
            </div>
            {!result.sel.filled && (
              <Callout kind="warn" title="Batch not filled">Only {sel.length} of {s.n} requested candidates could be selected: every remaining candidate violates a diversity cap{it.mode === 'scenario' && s.applyRules ? ' or was excluded by the eligibility rules' : ''}. Relax a cap or reduce the batch size.</Callout>
            )}
            {result.sel.forcedMissing.length > 0 && <Callout kind="warn">Forced candidate(s) not in the pool: {result.sel.forcedMissing.join(', ')}</Callout>}
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th scope="col">#</th><th scope="col">Candidate</th><th scope="col" className="num">Score</th><th scope="col" className="num">μ (eV)</th><th scope="col" className="num">σ_tree (eV)</th><th scope="col">OOD</th><th scope="col">Topology</th><th scope="col">Metal</th><th scope="col">Subst.</th>
                    {it.mode === 'replay' ? <th scope="col">DFT outcome <InfoTip text="Known only after this batch was computed; it was not available to the selection. Shown for retrospective context." /></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {sel.map((r) => {
                    const c = byId.get(r.id);
                    return (
                      <tr key={r.id}>
                        <td>{r.selection_rank}{r.forced ? <span className="badge badge-muted small" title="Forced anchor">F</span> : null}</td>
                        <th scope="row" className="col-name">{c ? <Link to={candidatePath(c)}>{r.id}</Link> : r.id}</th>
                        <td className="num">{r.score.toFixed(3)}</td>
                        <td className="num">{r.mu.toFixed(2)}</td>
                        <td className="num">{r.sigma_tree.toFixed(2)}</td>
                        <td>{r.is_ood ? <span className="badge badge-ood" title={r.ood_reasons.join('; ')}>OOD</span> : <span className="muted">—</span>}</td>
                        <td>{r.topology}</td><td>{r.metal}</td><td>{r.substituent}</td>
                        {it.mode === 'replay' ? (
                          <td>{c && c.dft.status !== 'not_available' && c.dft.iteration === it.iteration ? (c.dft.status === 'accepted' ? <span className="dft-cell"><Num v={c.dft.gap_eV} /> eV <DftBadge status="accepted" /></span> : <DftBadge status={c.dft.status} />) : <span className="muted small">{isDefault ? '—' : 'not computed in this iteration'}</span>}</td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="diversity">
              {(['topology', 'metal', 'substituent'] as const).map((k) => {
                const cap = k === 'topology' ? s.max_per_topology : k === 'metal' ? s.max_per_metal : s.max_per_substituent;
                return (
                  <div key={k}>
                    <h3 className="h5">Per {k} (cap {cap})</h3>
                    <div className="chips">
                      {Object.entries(result.sel.counts[k]).sort().map(([v, n]) => <span key={v} className={`chip ${n >= cap ? 'chip-full' : ''}`}>{v} {n}/{cap}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card" aria-labelledby="dec-h">
            <h2 id="dec-h" className="h3">Score decomposition of the selected batch</h2>
            <PlotlyChart data={decomposition} layout={{ barmode: 'relative', xaxis: { title: { text: 'Selection rank' }, type: 'category' }, yaxis: { title: { text: 'Contribution to score (eV)' } } }} height={320}
              ariaLabel="Stacked bar chart of the four score terms for each selected candidate"
              description="Positive terms stack above zero and negative terms below; the dark diamond is their sum, the acquisition score (lower ranks first). Hover for candidate names." />
          </section>

          <section className="card" aria-labelledby="sc-h">
            <h2 id="sc-h" className="h3">Pool: predicted gap vs ensemble spread</h2>
            <PlotlyChart data={scatter} layout={{ xaxis: { title: { text: 'σ_tree (eV) — model disagreement' } }, yaxis: { title: { text: 'Predicted gap μ (eV)' } } }} height={340}
              ariaLabel="Scatter of predicted gap against ensemble spread for the pool; selected candidates highlighted"
              description="Open markers are out-of-distribution candidates. Larger κ moves selection to the right (higher spread); this is exploration, not better performance." />
          </section>

          <section className="card" aria-labelledby="rank-h">
            <div className="card-head">
              <h2 id="rank-h" className="h3">Full ranking ({result.ranked.length})</h2>
              {result.ranked.length > 25 && <button type="button" className="link-btn" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show top 25' : `Show all ${result.ranked.length}`}</button>}
            </div>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>{!isDefault ? <th scope="col" className="num">Δ vs default</th> : null}<th scope="col">Candidate</th><th scope="col" className="num">Score</th><th scope="col" className="num">μ</th><th scope="col" className="num">−κσ</th><th scope="col" className="num">−α/N</th><th scope="col" className="num">+βI</th><th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = (defRank.get(r.id) ?? r.rank) - r.rank;
                    const c = byId.get(r.id);
                    return (
                      <tr key={r.id} className={selIds.has(r.id) ? 'selected' : undefined}>
                        <td>{r.rank}</td>
                        {!isDefault ? <td className="num">{d === 0 ? '·' : d > 0 ? `↑${d}` : `↓${-d}`}</td> : null}
                        <th scope="row" className="col-name">{c ? <Link to={candidatePath(c)}>{r.id}</Link> : r.id}</th>
                        <td className="num">{r.score.toFixed(3)}</td>
                        <td className="num">{r.term_mu.toFixed(3)}</td>
                        <td className="num">{r.term_sigma.toFixed(3)}</td>
                        <td className="num">{r.term_novelty.toFixed(3)}</td>
                        <td className="num" title={r.ood_reasons.join('; ')}>{r.term_ood.toFixed(2)}</td>
                        <td>{rowStatus(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {excluded.length > 0 && (
              <details className="disclosure">
                <summary>Excluded by the eligibility rules ({excluded.length})</summary>
                <ul className="excluded-list">
                  {excluded.map((r) => <li key={r.id}><code>{r.id}</code> — {ELIGIBILITY_LABEL[eligibilityReason(r, it.rules)!]}</li>)}
                </ul>
              </details>
            )}
            {it.mode === 'scenario' && it.excluded_already_computed ? <p className="small muted">{it.excluded_already_computed.length} candidates already sent to DFT are excluded from this pool, as in the study’s selection script.</p> : null}
          </section>
        </div>
      </div>
    </div>
  );
}
