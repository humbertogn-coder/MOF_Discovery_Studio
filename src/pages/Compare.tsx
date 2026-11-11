import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MAX_COMPARE, useCompare } from '../app/CompareContext';
import { useData } from '../app/DataContext';
import { DftBadge, ErrorState, Formula, InfoTip, Loading, Num, OodBadge } from '../components/ui';
import { candidatePath } from '../lib/data';
import { fmtBool } from '../lib/format';
import { G } from '../lib/guardrails';
import type { Candidate } from '../lib/types';
import { ViewerPanel } from './CandidateDetail';

interface Row {
  label: string;
  kind: 'id' | 'pred' | 'dft' | 'geo';
  tip?: string;
  value: (c: Candidate) => number | string | boolean | null | undefined;
  render?: (c: Candidate) => ReactNode;
  digits?: number;
  unit?: string;
}

const ROWS: { group: string; note?: string; rows: Row[] }[] = [
  {
    group: 'Identity',
    rows: [
      { label: 'Formula', kind: 'id', value: (c) => c.formula, render: (c) => <Formula f={c.formula} /> },
      { label: 'Metal', kind: 'id', value: (c) => c.metal },
      { label: 'Open d shell', kind: 'id', value: (c) => c.open_shell, render: (c) => fmtBool(c.open_shell) },
      { label: 'Node family', kind: 'id', value: (c) => c.node_family },
      { label: 'Topology', kind: 'id', value: (c) => c.topology },
      { label: 'Linker', kind: 'id', value: (c) => c.linker_label },
    ],
  },
  {
    group: 'Generated structure (PORMAKE)',
    rows: [
      { label: 'Atoms in cell', kind: 'geo', value: (c) => c.structure.n_atoms, digits: 0 },
      { label: 'Density', kind: 'geo', value: (c) => c.structure.density_g_cm3, digits: 3, unit: 'g/cm³', tip: G.density },
      { label: 'PLD', kind: 'geo', value: (c) => c.structure.pld_A, unit: 'Å', tip: G.pldLcd },
      { label: 'LCD', kind: 'geo', value: (c) => c.structure.lcd_A, unit: 'Å', tip: G.pldLcd },
      { label: 'Cell volume', kind: 'geo', value: (c) => c.structure.volume_A3, digits: 0, unit: 'Å³' },
    ],
  },
  {
    group: 'Model estimate (predicted)',
    note: 'Machine-learning predictions of the PBE reference gap — not measurements.',
    rows: [
      { label: 'Predicted gap μ', kind: 'pred', value: (c) => c.prediction?.mu_eV, unit: 'eV', tip: G.predictedGap },
      { label: 'σ_tree (ensemble spread)', kind: 'pred', value: (c) => c.prediction?.sigma_tree_eV, unit: 'eV', tip: G.sigmaTree },
      { label: 'σ_seed', kind: 'pred', value: (c) => c.prediction?.sigma_seed_eV, digits: 3, unit: 'eV', tip: G.sigmaSeed },
      { label: 'Applicability domain', kind: 'pred', value: (c) => c.prediction?.is_ood, render: (c) => <OodBadge ood={c.prediction?.is_ood} />, tip: G.ood },
    ],
  },
  {
    group: 'DFT (computed)',
    note: 'Only labels accepted under the study rules carry a gap.',
    rows: [
      { label: 'DFT status', kind: 'dft', value: (c) => c.dft.status, render: (c) => <DftBadge status={c.dft.status} /> },
      { label: 'Accepted DFT gap', kind: 'dft', value: (c) => (c.dft.status === 'accepted' ? c.dft.gap_eV : null), digits: 3, unit: 'eV', tip: G.dftAccepted },
      { label: 'DFT iteration', kind: 'dft', value: (c) => c.dft.iteration, digits: 0 },
      { label: 'Spin state', kind: 'dft', value: (c) => c.dft.spin_state },
    ],
  },
];

function differs(cs: Candidate[], r: Row): boolean {
  const vals = cs.map((c) => r.value(c));
  return new Set(vals.map((v) => (typeof v === 'number' ? v.toFixed(r.digits ?? 2) : String(v)))).size > 1;
}

export default function Compare() {
  const { status, error, candidates, byId } = useData();
  const compare = useCompare();
  const [params, setParams] = useSearchParams();
  const urlIds = useMemo(() => (params.get('ids') ?? '').split(',').map((s) => decodeURIComponent(s.trim())).filter(Boolean), [params]);

  // On first load the URL wins (shareable links); afterwards the URL mirrors the selection.
  const synced = useRef(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  useEffect(() => {
    if (status !== 'ready' || synced.current) return;
    synced.current = true;
    setInvalid(urlIds.filter((id) => !byId.has(id)));
    if (urlIds.length) compare.set(urlIds.filter((id) => byId.has(id)).slice(0, MAX_COMPARE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => {
    if (status !== 'ready' || !synced.current) return;
    const cur = params.get('ids') ?? '';
    const next = compare.ids.join(',');
    if (cur !== next) setParams(next ? { ids: next } : {}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare.ids, status]);

  const [viewIdx, setViewIdx] = useState(0);
  const [adding, setAdding] = useState('');
  if (status === 'loading') return <Loading />;
  if (status === 'error') return <div className="wrap page"><ErrorState message={error ?? ''} /></div>;

  const cs = compare.ids.map((id) => byId.get(id)).filter((c): c is Candidate => Boolean(c));
  const viewC = cs[Math.min(viewIdx, cs.length - 1)];

  return (
    <div className="wrap page">
      <header className="page-head">
        <h1>Compare candidates</h1>
        <p className="lede-sm">Side-by-side view of up to {MAX_COMPARE} candidates. Rows whose values differ are highlighted. Predicted and computed quantities are kept in separate groups.</p>
      </header>
      {invalid.length > 0 && <p className="state state-error">Not in this data release: {invalid.join(', ')}</p>}

      <div className="compare-add">
        <label className="field inline">
          <span>Add candidate</span>
          <input list="cand-list" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Type a candidate name" disabled={compare.full} />
          <datalist id="cand-list">{candidates.map((c) => <option key={c.id} value={c.id} />)}</datalist>
        </label>
        <button type="button" className="btn btn-sm" disabled={compare.full || !byId.has(adding) || compare.has(adding)} onClick={() => { compare.toggle(adding); setAdding(''); }}>Add</button>
        {cs.length > 0 && <button type="button" className="link-btn" onClick={compare.clear}>Clear all</button>}
      </div>

      {cs.length === 0 ? (
        <div className="empty">
          <h2 className="h3">No candidates selected</h2>
          <p>Tick the checkboxes in the <Link to="/explore">Explorer</Link> or use “Add to comparison” on a candidate page.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Comparison table">
            <table className="data-table compare-table">
              <thead>
                <tr>
                  <th scope="col">Property</th>
                  {cs.map((c) => (
                    <th scope="col" key={c.id}>
                      <Link to={candidatePath(c)} className="mono">{c.id}</Link>
                      <button type="button" className="link-btn small" onClick={() => compare.remove(c.id)} aria-label={`Remove ${c.id}`}>remove</button>
                    </th>
                  ))}
                </tr>
              </thead>
              {ROWS.map((g) => (
                <tbody key={g.group} className={`group-${g.rows[0].kind}`}>
                  <tr className="group-row">
                    <th scope="colgroup" colSpan={cs.length + 1}>{g.group}{g.note ? <span className="muted small"> — {g.note}</span> : null}</th>
                  </tr>
                  {g.rows.map((r) => {
                    const diff = cs.length > 1 && differs(cs, r);
                    return (
                      <tr key={r.label} className={diff ? 'diff' : undefined}>
                        <th scope="row">{r.label}{r.tip ? <InfoTip text={r.tip} label={`About ${r.label}`} /> : null}{diff ? <span className="sr-only"> (values differ)</span> : null}</th>
                        {cs.map((c) => {
                          const v = r.value(c);
                          return (
                            <td key={c.id} className={typeof v === 'number' || v == null ? 'num' : undefined}>
                              {r.render ? r.render(c) : typeof v === 'number' || v == null ? <Num v={v as number | null} digits={r.digits ?? 2} unit={r.unit} /> : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>

          {viewC && (
            <section className="card" aria-labelledby="cmp-view-h">
              <div className="card-head">
                <h2 id="cmp-view-h" className="h3">Structure</h2>
                <div className="seg" role="group" aria-label="Candidate shown in the viewer">
                  {cs.map((c, i) => (
                    <button key={c.id} type="button" aria-pressed={c.id === viewC.id} onClick={() => setViewIdx(i)}>{c.metal} {c.topology} {c.linker_label}</button>
                  ))}
                </div>
              </div>
              <p className="small muted">One viewer with a switcher keeps the page responsive on small devices.</p>
              <ViewerPanel c={viewC} compact />
            </section>
          )}
        </>
      )}
    </div>
  );
}
