import { useCallback, useEffect, useRef, useState } from 'react';
import { loadStructureText, safeStructureUrl } from '../lib/data';
import { G } from '../lib/guardrails';
import { InfoTip } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
let molPromise: Promise<any> | null = null;
/** 3Dmol.js 2.5.5 (pinned, BSD-3-Clause), loaded only when a structure is opened. */
function load3Dmol(): Promise<any> {
  if (!molPromise) molPromise = import('3dmol/build/3Dmol-min.js').then((m: any) => m.createViewer ? m : (m.default ?? (window as any).$3Dmol));
  return molPromise;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export type ViewStyle = 'ballstick' | 'stick' | 'spheres';
const STYLE_SPEC: Record<ViewStyle, object> = {
  ballstick: { stick: { radius: 0.11, colorscheme: 'Jmol' }, sphere: { scale: 0.26, colorscheme: 'Jmol' } },
  stick: { stick: { radius: 0.16, colorscheme: 'Jmol' } },
  spheres: { sphere: { scale: 0.9, colorscheme: 'Jmol' } },
};

export interface StructureSource {
  path: string;
  format: 'cif' | 'vasp';
  label: string;
  provenance: 'pormake_generated' | 'dft_relaxed' | 'dft_relaxation_last_step';
}

export default function StructureViewer({ source, expectedAtoms, title }: { source: StructureSource; expectedAtoms?: number | null; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<any>(null);
  const model = useRef<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'nowebgl'>('loading');
  const [error, setError] = useState<string>('');
  const [style, setStyle] = useState<ViewStyle>('ballstick');
  const [showCell, setShowCell] = useState(true);
  const [showH, setShowH] = useState(true);
  const [nAtoms, setNAtoms] = useState<number | null>(null);
  const [supercell, setSupercell] = useState(false);
  const mol = useRef<any>(null);
  const text = useRef<string>('');

  /** (Re)build the model from the original file text; the 2×2×2 option replicates atoms for display only. */
  const buildModel = useCallback((replicate: boolean) => {
    const v = viewer.current;
    if (!v) return 0;
    v.removeAllModels();
    v.removeAllShapes?.();
    const m = v.addModel(text.current, source.format, { doAssembly: false, duplicateAssemblyAtoms: false });
    const n = m.selectedAtoms({}).length;
    if (replicate) v.replicateUnitCell(2, 2, 2, m);
    model.current = m;
    return n;
  }, [source.format]);

  const applyStyle = useCallback(() => {
    const v = viewer.current;
    if (!v || !model.current) return;
    v.setStyle({}, STYLE_SPEC[style]);
    if (!showH) v.setStyle({ elem: 'H' }, {});
    v.removeUnitCell?.(model.current);
    if (showCell) v.addUnitCell(model.current, { box: { color: '#0f766e', linewidth: 1.5 }, astyle: { hidden: true }, bstyle: { hidden: true }, cstyle: { hidden: true } });
    v.render();
  }, [style, showCell, showH]);

  useEffect(() => {
    let alive = true;
    if (!webglAvailable()) {
      setState('nowebgl');
      return;
    }
    setState('loading');
    Promise.all([load3Dmol(), loadStructureText(source.path)])
      .then(([lib, txt]) => {
        if (!alive || !host.current) return;
        host.current.innerHTML = '';
        mol.current = lib;
        text.current = txt;
        viewer.current = lib.createViewer(host.current, { backgroundColor: '#ffffff', antialias: true });
        const n = buildModel(false);
        if (!n) throw new Error('The file was read but contained no atoms the viewer could parse.');
        setNAtoms(n);
        setSupercell(false);
        viewer.current.zoomTo();
        viewer.current.zoom(1.15);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setState('error');
      });
    return () => {
      alive = false;
      try {
        viewer.current?.clear?.();
      } catch {
        /* ignore */
      }
      viewer.current = null;
      model.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.path, source.format]);

  useEffect(() => {
    if (state === 'ready') applyStyle();
  }, [state, applyStyle]);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => viewer.current?.resize?.());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleSupercell = (on: boolean) => {
    setSupercell(on);
    buildModel(on);
    applyStyle();
    viewer.current?.zoomTo();
    viewer.current?.render();
  };
  const reset = () => {
    viewer.current?.zoomTo();
    viewer.current?.render();
  };
  const url = safeStructureUrl(source.path);
  const mismatch = nAtoms !== null && expectedAtoms != null && nAtoms !== expectedAtoms;

  return (
    <div className="viewer" data-state={state} data-atoms={nAtoms ?? ''} data-format={source.format}>
      <div className="viewer-toolbar" role="toolbar" aria-label="3D viewer controls">
        <div className="seg" role="group" aria-label="Rendering style">
          {(['ballstick', 'stick', 'spheres'] as ViewStyle[]).map((s) => (
            <button key={s} type="button" aria-pressed={style === s} onClick={() => setStyle(s)} disabled={state !== 'ready'}>
              {s === 'ballstick' ? 'Ball & stick' : s === 'stick' ? 'Stick' : 'Spheres'}
            </button>
          ))}
        </div>
        <label className="check small">
          <input type="checkbox" checked={showCell} onChange={(e) => setShowCell(e.target.checked)} disabled={state !== 'ready'} /> Unit cell
        </label>
        <label className="check small">
          <input type="checkbox" checked={showH} onChange={(e) => setShowH(e.target.checked)} disabled={state !== 'ready'} /> Hydrogens
        </label>
        <label className="check small" title="Replicates the cell for display only; the downloadable file is unchanged.">
          <input type="checkbox" checked={supercell} onChange={(e) => toggleSupercell(e.target.checked)} disabled={state !== 'ready'} /> 2×2×2 cells (display)
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={state !== 'ready'}>
          Reset view
        </button>
      </div>
      <div className="viewer-stage">
        <div ref={host} className="viewer-canvas" aria-label={`Interactive 3D model of ${title} (${source.label}). Drag to rotate, scroll or pinch to zoom.`} role="img" />
        {state === 'loading' && (
          <div className="viewer-overlay" role="status">
            <span className="spinner" aria-hidden="true" /> Loading structure…
          </div>
        )}
        {state === 'nowebgl' && (
          <div className="viewer-overlay viewer-fallback">
            <p>
              <strong>3D view unavailable.</strong> Your browser or device does not provide WebGL, which the viewer needs.
            </p>
            {url ? (
              <a className="btn btn-sm" href={url} download>
                Download the structure file
              </a>
            ) : null}
          </div>
        )}
        {state === 'error' && (
          <div className="viewer-overlay viewer-fallback" role="alert">
            <p>
              <strong>The structure could not be displayed.</strong> {error}
            </p>
            <p className="small">The candidate data on this page are unaffected.</p>
            {url ? (
              <a className="btn btn-sm" href={url} download>
                Download the original file
              </a>
            ) : null}
          </div>
        )}
      </div>
      <div className="viewer-foot small">
        <span>
          {source.label}
          {nAtoms !== null ? ` · ${nAtoms} atoms parsed` : ''}
          {supercell ? ' · showing 2×2×2 replicated cells' : ''}
          {mismatch ? ` (expected ${expectedAtoms})` : ''}
        </span>
        <span className="muted">
          Bonds are a visualization heuristic <InfoTip text={G.bonds} label="About bonds in the viewer" />
        </span>
      </div>
    </div>
  );
}
