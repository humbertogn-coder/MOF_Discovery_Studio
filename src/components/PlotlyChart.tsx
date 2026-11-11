import { useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
type PlotlyLib = any;
let plotlyPromise: Promise<PlotlyLib> | null = null;
/** Plotly (basic bundle: scatter/bar) is loaded lazily, only when a chart is on screen. */
function loadPlotly(): Promise<PlotlyLib> {
  if (!plotlyPromise) plotlyPromise = import('plotly.js-basic-dist-min').then((m) => m.default ?? m);
  return plotlyPromise;
}

export const CHART_FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const baseLayout = {
  font: { family: CHART_FONT, size: 12, color: '#334155' },
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: '#fcfcfb',
  margin: { l: 56, r: 16, t: 16, b: 52 },
  hoverlabel: { bgcolor: '#0f2237', bordercolor: '#0f2237', font: { color: '#f8fafc', family: CHART_FONT } },
  legend: { orientation: 'h', y: -0.22, x: 0, font: { size: 12 } },
  xaxis: { gridcolor: '#e5e7eb', zerolinecolor: '#cbd5e1', linecolor: '#94a3b8', ticks: 'outside', tickcolor: '#94a3b8' },
  yaxis: { gridcolor: '#e5e7eb', zerolinecolor: '#cbd5e1', linecolor: '#94a3b8', ticks: 'outside', tickcolor: '#94a3b8' },
};

export function PlotlyChart({ data, layout, height = 380, onPointClick, ariaLabel, description }: {
  data: any[];
  layout?: any;
  height?: number;
  onPointClick?: (customdata: unknown) => void;
  ariaLabel: string;
  description?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const clickRef = useRef(onPointClick);
  clickRef.current = onPointClick;

  useEffect(() => {
    let alive = true;
    const el = ref.current;
    loadPlotly()
      .then((Plotly) => {
        if (!alive || !el) return;
        const merged = { ...baseLayout, ...layout, height, xaxis: { ...baseLayout.xaxis, ...(layout?.xaxis ?? {}) }, yaxis: { ...baseLayout.yaxis, ...(layout?.yaxis ?? {}) } };
        return Plotly.react(el, data, merged, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'], toImageButtonOptions: { format: 'png', scale: 2 } }).then(() => {
          if (!alive) return;
          setReady(true);
          const anyEl = el as any;
          anyEl.removeAllListeners?.('plotly_click');
          anyEl.on?.('plotly_click', (ev: any) => {
            const cd = ev?.points?.[0]?.customdata;
            if (cd !== undefined && clickRef.current) clickRef.current(cd);
          });
        });
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [data, layout, height]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) loadPlotly().then((P) => P.purge(el)).catch(() => undefined);
    };
  }, []);

  return (
    <figure className="chart" aria-label={ariaLabel}>
      {error ? <div className="state state-error">Chart unavailable: {error}</div> : null}
      {!ready && !error ? (
        <div className="chart-loading" style={{ height }} role="status">
          Loading chart…
        </div>
      ) : null}
      <div ref={ref} style={{ width: '100%', minHeight: ready ? height : 0 }} role="img" aria-label={ariaLabel} />
      {description ? <figcaption className="chart-caption">{description}</figcaption> : null}
    </figure>
  );
}
