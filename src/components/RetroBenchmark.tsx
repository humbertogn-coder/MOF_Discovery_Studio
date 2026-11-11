import { useEffect, useMemo, useState } from 'react';
import { loadRetro } from '../lib/data';
import { G } from '../lib/guardrails';
import { SERIES } from '../lib/palette';
import type { RetroFile, RetroPoint } from '../lib/types';
import { PlotlyChart } from './PlotlyChart';
import { Callout, InfoTip } from './ui';

type Metric = 'hits_lt_0p5' | 'hits_lt_1p0' | 'recall_top10';
const METRIC_LABEL: Record<Metric, string> = {
  hits_lt_0p5: 'Low-gap hits found (PBE < 0.5 eV)',
  hits_lt_1p0: 'Low-gap hits found (PBE < 1.0 eV)',
  recall_top10: 'Recall of the 10 lowest gaps in the pool',
};
// Fixed order and colour per strategy (colour follows the entity).
const STYLE: Record<string, { color: string; dash: string; width: number; label: string }> = {
  paper: { color: SERIES[0], dash: 'solid', width: 3, label: 'Study acquisition' },
  random: { color: SERIES[1], dash: 'solid', width: 3, label: 'Random' },
  greedy: { color: SERIES[2], dash: 'dash', width: 2, label: 'Greedy (lowest μ)' },
  lcb: { color: SERIES[6], dash: 'dot', width: 2, label: 'LCB (μ − σ)' },
  paper_static: { color: '#64748b', dash: 'dashdot', width: 2, label: 'Study acquisition, no retraining' },
  uncertainty: { color: SERIES[7], dash: 'longdash', width: 2, label: 'Highest σ (exploration)' },
};

export default function RetroBenchmark() {
  const [r, setR] = useState<RetroFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('hits_lt_0p5');
  useEffect(() => {
    loadRetro().then(setR).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  const { data, layout } = useMemo(() => {
    if (!r) return { data: [], layout: {} };
    const tr: object[] = [];
    const get = (p: RetroPoint, k: 'mean' | 'sd') => p[`${metric}_${k}` as keyof RetroPoint] as number;
    for (const key of Object.keys(STYLE)) {
      const pts = r.curves[key];
      if (!pts) continue;
      const st = STYLE[key];
      const x = pts.map((p) => p.labels);
      if (key === 'paper' || key === 'random') {
        const hi = pts.map((p) => get(p, 'mean') + get(p, 'sd'));
        const lo = pts.map((p) => Math.max(0, get(p, 'mean') - get(p, 'sd')));
        tr.push({ type: 'scatter', mode: 'lines', x: [...x, ...[...x].reverse()], y: [...hi, ...[...lo].reverse()], fill: 'toself', fillcolor: key === 'paper' ? 'rgba(42,120,214,0.12)' : 'rgba(235,104,52,0.12)', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
      }
      tr.push({ type: 'scatter', mode: 'lines+markers', name: st.label, x, y: pts.map((p) => get(p, 'mean')), line: { color: st.color, dash: st.dash, width: st.width }, marker: { size: 6, color: st.color }, customdata: pts.map((p) => get(p, 'sd')), hovertemplate: `${st.label}<br>%{x} labels: %{y:.2f} ± %{customdata:.2f}<extra></extra>` });
    }
    return {
      data: tr,
      layout: {
        xaxis: { title: { text: 'Labels acquired (simulated DFT budget)' } },
        yaxis: { title: { text: METRIC_LABEL[metric] }, rangemode: 'tozero' },
        shapes: [{ type: 'line', x0: r.study_budget_labels, x1: r.study_budget_labels, yref: 'paper', y0: 0, y1: 1, line: { color: '#0f2237', width: 1, dash: 'dot' } }],
        annotations: [{ x: r.study_budget_labels, y: 1, yref: 'paper', text: `study budget (${r.study_budget_labels})`, showarrow: false, xanchor: 'left', font: { size: 11 } }],
        legend: { orientation: 'h', y: -0.25, x: 0 },
      },
    };
  }, [r, metric]);
  if (err) return null;
  if (!r) return <div className="card"><p className="muted">Loading retrospective benchmark…</p></div>;
  const at = (strategy: string, labels: number) => r.headline.find((h) => h.strategy === strategy && h.labels === labels);
  const paper = at('paper', r.study_budget_labels);
  const rnd = at('random', r.study_budget_labels);
  const ratio = paper?.hits_lt_0p5 && rnd?.hits_lt_0p5 ? paper.hits_lt_0p5 / rnd.hits_lt_0p5 : null;
  const budgets = [...new Set(r.headline.map((h) => h.labels))].sort((a, b) => a - b);
  return (
    <section className="card" aria-labelledby="retro-h">
      <div className="card-head">
        <h2 id="retro-h" className="h3">Does the acquisition help? Retrospective benchmark on QMOF <InfoTip text={G.retro} /></h2>
        <label className="small">metric <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>{(Object.keys(METRIC_LABEL) as Metric[]).map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}</select></label>
      </div>
      <Callout kind="note">{G.retro}</Callout>
      {ratio ? (
        <p>At the study budget of {r.study_budget_labels} labels, the study acquisition found <strong>{paper!.hits_lt_0p5!.toFixed(1)} ± {paper!.hits_lt_0p5_sd!.toFixed(1)}</strong> frameworks with PBE gap &lt; 0.5 eV, against <strong>{rnd!.hits_lt_0p5!.toFixed(1)} ± {rnd!.hits_lt_0p5_sd!.toFixed(1)}</strong> for random selection (about {ratio.toFixed(1)}×), mean ± s.d. over {r.repeats ?? '?'} repeats.</p>
      ) : null}
      <p className="small">Reading the table: ranking purely by the lowest predicted gap (greedy, LCB) finds slightly more hits at this budget; the study's diversity caps trade some hits for coverage of more metals and topologies, and the rows with and without retraining are close, i.e. the gain comes from the ranking rather than from model updates.</p>
      <PlotlyChart data={data} layout={layout} height={380} ariaLabel={`Line chart of ${METRIC_LABEL[metric]} against number of labels for six selection strategies`}
        description="Shaded bands: ± one standard deviation for the study acquisition and for random selection. The dotted line marks the 27 labels of the real campaign." />
      <div className="table-wrap">
        <table className="data-table compact">
          <thead>
            <tr><th scope="col">Strategy</th>{budgets.map((b) => <th key={b} scope="col" className="num">Hits &lt; 0.5 eV @ {b}</th>)}{budgets.map((b) => <th key={`r${b}`} scope="col" className="num">Top-10 recall @ {b}</th>)}</tr>
          </thead>
          <tbody>
            {Object.keys(r.strategies).map((s) => (
              <tr key={s}>
                <th scope="row">{STYLE[s]?.label ?? r.strategies[s]}</th>
                {budgets.map((b) => { const h = at(s, b); return <td key={b} className="num">{h?.hits_lt_0p5 != null ? `${h.hits_lt_0p5.toFixed(1)}${h.hits_lt_0p5_sd != null ? ` ± ${h.hits_lt_0p5_sd.toFixed(1)}` : ''}` : '—'}</td>; })}
                {budgets.map((b) => { const h = at(s, b); return <td key={`r${b}`} className="num">{h?.recall_top10 != null ? h.recall_top10.toFixed(2) : '—'}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="disclosure">
        <summary>Set-up and strategies</summary>
        <p className="small">{r.setup}</p>
        <ul className="small">{Object.entries(r.strategies).map(([k, v]) => <li key={k}><strong>{STYLE[k]?.label ?? k}</strong>: {v}</li>)}</ul>
        <p className="small muted">Source: {r.source}. {r.note}</p>
      </details>
    </section>
  );
}
