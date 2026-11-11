import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MAX_COMPARE, useCompare } from '../app/CompareContext';
import { useData } from '../app/DataContext';
import { PlotlyChart } from '../components/PlotlyChart';
import { Callout, DftBadge, ErrorState, InfoTip, Loading, MultiSelect, Num, OodBadge, RangeSlider } from '../components/ui';
import { candidatesCsv, candidatesJson, download } from '../lib/csv';
import { candidatePath, dataUrl } from '../lib/data';
import { activeFilterCount, applyFilters, EMPTY_FILTERS, extent, METRICS, RANGE_METRICS, sortCandidates, uniqueValues, type FilterState, type MetricKey, type SortKey, type SortState } from '../lib/filters';
import { G } from '../lib/guardrails';
import { categoryStyle, STATUS_COLOR } from '../lib/palette';
import type { Candidate } from '../lib/types';

const SKEY = 'mds.explorer.v1';
function readSession<T>(fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(SKEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

const METRIC_TIP: Partial<Record<MetricKey, string>> = { gap_ml: G.predictedGap, sigma_tree: G.sigmaTree, sigma_seed: G.sigmaSeed, pld: G.pldLcd, lcd: G.pldLcd, density: G.density, dft_gap: G.dftAccepted };

type ColorBy = 'topology' | 'metal' | 'dft' | 'ood';

function Scatter({ all, shown }: { all: Candidate[]; shown: Candidate[] }) {
  const navigate = useNavigate();
  const [x, setX] = useState<MetricKey>('pld');
  const [y, setY] = useState<MetricKey>('gap_ml');
  const [colorBy, setColorBy] = useState<ColorBy>('topology');
  const { data, layout, plotted } = useMemo(() => {
    const groupOf = (c: Candidate): string =>
      colorBy === 'topology' ? (c.topology ?? 'unknown') : colorBy === 'metal' ? (c.metal ?? 'unknown') : colorBy === 'dft' ? c.dft.status : c.prediction?.is_ood ? 'OOD' : 'In domain';
    const styles = categoryStyle(all.map(groupOf));
    const pts = shown.filter((c) => METRICS[x].get(c) !== null && METRICS[y].get(c) !== null);
    const groups = [...new Set(pts.map(groupOf))].sort();
    const dftName: Record<string, string> = { accepted: 'DFT accepted', rejected: 'DFT not accepted', not_available: 'Not evaluated', ambiguous: 'Ambiguous' };
    const traces = groups.map((g) => {
      const p = pts.filter((c) => groupOf(c) === g);
      const st = styles.get(g)!;
      const color = colorBy === 'dft' ? STATUS_COLOR[g as keyof typeof STATUS_COLOR] ?? st.color : st.color;
      return {
        type: 'scatter', mode: 'markers', name: colorBy === 'dft' ? dftName[g] ?? g : g,
        x: p.map((c) => METRICS[x].get(c)), y: p.map((c) => METRICS[y].get(c)), customdata: p.map((c) => c.slug),
        text: p.map((c) => `${c.id}<br>${METRICS[x].short} = ${METRICS[x].get(c)!.toFixed(METRICS[x].digits)} ${METRICS[x].unit}<br>${METRICS[y].short} = ${METRICS[y].get(c)!.toFixed(METRICS[y].digits)} ${METRICS[y].unit}`),
        hovertemplate: '%{text}<extra></extra>',
        marker: { size: 9, color, symbol: st.symbol, opacity: 0.85, line: { width: 1, color: '#fcfcfb' } },
      };
    });
    const ax = (k: MetricKey) => ({ title: { text: `${METRICS[k].label}${METRICS[k].unit ? ` (${METRICS[k].unit})` : ''}` } });
    return { data: traces, layout: { xaxis: ax(x), yaxis: ax(y) }, plotted: pts.length };
  }, [all, shown, x, y, colorBy]);
  const missing = shown.length - plotted;
  const kinds = [METRICS[x].kind, METRICS[y].kind];
  return (
    <section className="card" aria-labelledby="scatter-h">
      <div className="card-head">
        <h2 id="scatter-h" className="h3">Scatter plot</h2>
        <div className="controls-row">
          <label>
            x <select value={x} onChange={(e) => setX(e.target.value as MetricKey)}>{Object.values(METRICS).map((m) => <option key={m.key} value={m.key}>{m.short}</option>)}</select>
          </label>
          <label>
            y <select value={y} onChange={(e) => setY(e.target.value as MetricKey)}>{Object.values(METRICS).map((m) => <option key={m.key} value={m.key}>{m.short}</option>)}</select>
          </label>
          <label>
            colour <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}>
              <option value="topology">Topology</option>
              <option value="metal">Metal</option>
              <option value="dft">DFT status</option>
              <option value="ood">OOD flag</option>
            </select>
          </label>
        </div>
      </div>
      <PlotlyChart
        data={data}
        layout={layout}
        height={400}
        onPointClick={(slug) => navigate(candidatePath({ slug: String(slug) }))}
        ariaLabel={`Scatter plot of ${METRICS[y].label} against ${METRICS[x].label} for ${plotted} filtered candidates`}
        description={`${plotted} candidates plotted${missing ? `; ${missing} omitted because a value is missing` : ''}. ${kinds.includes('predicted') ? 'Predicted gaps are model estimates. ' : ''}${kinds.includes('computed') ? 'DFT gap axis shows accepted labels only. ' : ''}Click a point to open the candidate; the table below lists the same data.`}
      />
    </section>
  );
}

export default function Explorer() {
  const { status, error, manifest, candidates } = useData();
  const compare = useCompare();
  const [filters, setFilters] = useState<FilterState>(() => readSession({ ...EMPTY_FILTERS, sort: undefined } as FilterState));
  const [sort, setSort] = useState<SortState>(() => readSession<{ sort?: SortState }>({}).sort ?? { key: 'gap_ml', dir: 'asc' });
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(SKEY, JSON.stringify({ ...filters, sort }));
    } catch {
      /* ignore */
    }
  }, [filters, sort]);

  const options = useMemo(
    () => ({
      metals: uniqueValues(candidates, (c) => c.metal),
      topologies: uniqueValues(candidates, (c) => c.topology),
      nodeFamilies: uniqueValues(candidates, (c) => c.node_family),
      linkerFamilies: uniqueValues(candidates, (c) => c.linker_family),
      substituents: uniqueValues(candidates, (c) => c.substituent),
      extents: Object.fromEntries(RANGE_METRICS.map((k) => [k, extent(candidates, k)])),
    }),
    [candidates],
  );
  const filtered = useMemo(() => sortCandidates(applyFilters(candidates, filters), sort), [candidates, filters, sort]);
  const count = (get: (c: Candidate) => string | null) => {
    const m: Record<string, number> = {};
    for (const c of candidates) {
      const v = get(c);
      if (v) m[v] = (m[v] ?? 0) + 1;
    }
    return m;
  };

  if (status === 'loading') return <Loading />;
  if (status === 'error') return <div className="wrap page"><ErrorState message={error ?? ''} /></div>;

  const set = (patch: Partial<FilterState>) => setFilters((f) => ({ ...f, ...patch }));
  const setRange = (k: MetricKey, lo: number, hi: number, includeMissing?: boolean) => {
    const e = options.extents[k]!;
    setFilters((f) => {
      const ranges = { ...f.ranges };
      const inc = includeMissing ?? ranges[k]?.includeMissing ?? true;
      if (Math.abs(lo - e.min) < 1e-9 && Math.abs(hi - e.max) < 1e-9 && inc) delete ranges[k];
      else ranges[k] = { min: lo, max: hi, includeMissing: inc };
      return { ...f, ranges };
    });
  };
  const nActive = activeFilterCount(filters);
  const th = (key: SortKey, label: string, tip?: string, numeric = false) => {
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={numeric ? 'num' : undefined}>
        <button type="button" className="th-btn" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}>
          {label}
          <span className="sort-ind" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
        </button>
        {tip ? <InfoTip text={tip} label={`About ${label}`} /> : null}
      </th>
    );
  };

  return (
    <div className="wrap page explorer">
      <header className="page-head">
        <h1>Explorer</h1>
        <p className="lede-sm">Filter and sort the {candidates.length} QC-passed hypothetical frameworks. Predicted gaps come from the iteration-{manifest?.source_iteration} model; DFT values are shown only where a label was accepted.</p>
      </header>

      <div className="explorer-grid">
        <aside className={`filters ${showFilters ? 'open' : ''}`} aria-label="Filters" id="filters-panel">
          <div className="filters-head">
            <h2 className="h3">Filters {nActive ? <span className="pill">{nActive}</span> : null}</h2>
            <button type="button" className="link-btn" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!nActive}>
              Reset all
            </button>
          </div>
          <label className="field">
            <span>Search</span>
            <input type="search" placeholder="Name, formula, metal, linker, MOF-5…" value={filters.query} onChange={(e) => set({ query: e.target.value })} />
          </label>
          <MultiSelect label="Metal" options={options.metals} value={filters.metals} onChange={(v) => set({ metals: v })} counts={count((c) => c.metal)} />
          <MultiSelect label="Topology" options={options.topologies} value={filters.topologies} onChange={(v) => set({ topologies: v })} counts={count((c) => c.topology)} />
          <MultiSelect label="Node family" options={options.nodeFamilies} value={filters.nodeFamilies} onChange={(v) => set({ nodeFamilies: v })} counts={count((c) => c.node_family)} />
          <MultiSelect label="Linker family" options={options.linkerFamilies} value={filters.linkerFamilies} onChange={(v) => set({ linkerFamilies: v })} counts={count((c) => c.linker_family)} />
          <MultiSelect label="Substituent" options={options.substituents} value={filters.substituents} onChange={(v) => set({ substituents: v })} counts={count((c) => c.substituent)} />
          <fieldset className="radio-group">
            <legend>Metal d shell</legend>
            {(['any', 'open', 'closed'] as const).map((v) => (
              <label key={v}><input type="radio" name="os" checked={filters.openShell === v} onChange={() => set({ openShell: v })} /> {v === 'any' ? 'Any' : v === 'open' ? 'Open shell' : 'Closed shell'}</label>
            ))}
          </fieldset>
          <fieldset className="radio-group">
            <legend>Applicability domain <InfoTip text={G.ood} /></legend>
            {(['include', 'in_domain', 'ood_only'] as const).map((v) => (
              <label key={v}><input type="radio" name="ood" checked={filters.ood === v} onChange={() => set({ ood: v })} /> {v === 'include' ? 'Include OOD' : v === 'in_domain' ? 'Show only in-domain' : 'Only OOD'}</label>
            ))}
          </fieldset>
          <fieldset className="radio-group">
            <legend>DFT</legend>
            {(['any', 'accepted', 'computed', 'not_computed'] as const).map((v) => (
              <label key={v}><input type="radio" name="dft" checked={filters.dft === v} onChange={() => set({ dft: v })} /> {{ any: 'Any', accepted: 'DFT accepted only', computed: 'Any DFT run (incl. not accepted)', not_computed: 'Not evaluated by DFT' }[v]}</label>
            ))}
          </fieldset>
          {RANGE_METRICS.map((k) => {
            const e = options.extents[k];
            if (!e) return null;
            const m = METRICS[k];
            const r = filters.ranges[k];
            const step = m.digits >= 3 ? 0.001 : 0.01;
            const lo = Math.floor(e.min / step) * step;
            const hi = Math.ceil(e.max / step) * step;
            return (
              <RangeSlider key={k} label={m.short} unit={m.unit} tip={METRIC_TIP[k]} min={lo} max={hi} step={step} digits={m.digits}
                value={[r?.min ?? lo, r?.max ?? hi]} missing={e.missing} includeMissing={r?.includeMissing ?? true}
                onChange={([a, b]) => setRange(k, a, b)} onIncludeMissing={(inc) => setRange(k, r?.min ?? lo, r?.max ?? hi, inc)} />
            );
          })}
        </aside>

        <div className="results">
          <div className="results-bar">
            <button type="button" className="btn btn-ghost btn-sm filters-toggle" aria-expanded={showFilters} aria-controls="filters-panel" onClick={() => setShowFilters((s) => !s)}>
              {showFilters ? 'Hide filters' : 'Show filters'} {nActive ? `(${nActive})` : ''}
            </button>
            <p className="results-count" aria-live="polite">
              <strong>{filtered.length}</strong> of {candidates.length} candidates
            </p>
            <div className="results-actions">
              <button type="button" className="btn btn-sm" disabled={!filtered.length} onClick={() => download('mof_candidates_filtered.csv', candidatesCsv(filtered))}>Download CSV</button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={!filtered.length} onClick={() => download('mof_candidates_filtered.json', candidatesJson(filtered, manifest, filters), 'application/json')}>JSON</button>
              <a className="small" href={dataUrl('DATA_README.txt')} target="_blank" rel="noopener">Field dictionary</a>
            </div>
          </div>

          {compare.ids.length > 0 && (
            <div className="compare-tray" role="region" aria-label="Comparison selection">
              <span>{compare.ids.length}/{MAX_COMPARE} selected for comparison</span>
              <Link className="btn btn-sm btn-primary" to={`/compare?ids=${compare.ids.map(encodeURIComponent).join(',')}`}>Compare</Link>
              <button type="button" className="link-btn" onClick={compare.clear}>Clear</button>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="empty">
              <h2 className="h3">No candidates match these filters</h2>
              <p>
                {nActive} filter{nActive === 1 ? '' : 's'} active. The intersection is empty — for example, some topologies occur only with certain metals (cds and nbo use the paddlewheel node; Zn₄O exists only in pcu), and only {manifest?.records_with_accepted_dft} candidates have accepted DFT labels.
              </p>
              <button type="button" className="btn btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>Reset filters</button>
            </div>
          ) : (
            <>
              <Scatter all={candidates} shown={filtered} />
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Candidate table (scrolls horizontally)">
                <table className="data-table">
                  <caption className="sr-only">Filtered candidates; click a column header to sort.</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="col-sel"><span className="sr-only">Compare</span></th>
                      {th('id', 'Candidate')}
                      {th('metal', 'Metal')}
                      {th('topology', 'Topology')}
                      {th('linker', 'Linker')}
                      {th('gap_ml', 'Pred. gap (eV)', G.predictedGap, true)}
                      {th('sigma_tree', 'σ_tree (eV)', G.sigmaTree, true)}
                      {th('pld', 'PLD (Å)', G.pldLcd, true)}
                      {th('lcd', 'LCD (Å)', G.pldLcd, true)}
                      {th('density', 'Density (g/cm³)', G.density, true)}
                      <th scope="col">Domain</th>
                      {th('dft_gap', 'DFT', G.dftAccepted)}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => {
                      const sel = compare.has(c.id);
                      return (
                        <tr key={c.id} className={sel ? 'selected' : undefined}>
                          <td className="col-sel">
                            <input type="checkbox" aria-label={`Add ${c.id} to comparison`} checked={sel} disabled={!sel && compare.full} onChange={() => compare.toggle(c.id)} title={!sel && compare.full ? `At most ${MAX_COMPARE} candidates` : undefined} />
                          </td>
                          <th scope="row" className="col-name"><Link to={candidatePath(c)}>{c.id}</Link></th>
                          <td>{c.metal}</td>
                          <td>{c.topology}</td>
                          <td>{c.linker_label}</td>
                          <td className="num"><Num v={c.prediction?.mu_eV} /></td>
                          <td className="num"><Num v={c.prediction?.sigma_tree_eV} /></td>
                          <td className="num"><Num v={c.structure.pld_A} /></td>
                          <td className="num"><Num v={c.structure.lcd_A} /></td>
                          <td className="num"><Num v={c.structure.density_g_cm3} digits={3} /></td>
                          <td><OodBadge ood={c.prediction?.is_ood} /></td>
                          <td>
                            {c.dft.status === 'accepted' ? (
                              <span className="dft-cell"><Num v={c.dft.gap_eV} /> <DftBadge status="accepted" /></span>
                            ) : (
                              <DftBadge status={c.dft.status} compact />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Callout kind="note">{G.headline} σ_tree is model disagreement, not an error bar.</Callout>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
