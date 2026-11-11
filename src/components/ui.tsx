import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { G } from '../lib/guardrails';
import { fmt, formulaParts, MISSING } from '../lib/format';
import type { Candidate, DftStatus } from '../lib/types';

/** Accessible info tooltip: a button that toggles a popover; also opens on hover/focus. */
export function InfoTip({ text, label = 'More information' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);
  return (
    <span className="infotip" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="infotip-btn" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        i
      </button>
      {open && (
        <span role="tooltip" id={id} className="infotip-pop">
          {text}
        </span>
      )}
    </span>
  );
}

export function Formula({ f }: { f: string | null }) {
  if (!f) return <span className="missing">{MISSING}</span>;
  return (
    <span className="formula">
      {formulaParts(f).map((p, i) => (p.sub ? <sub key={i}>{p.text}</sub> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

/** A number with unit; null renders as an explicit "missing" marker, never 0. */
export function Num({ v, digits = 2, unit }: { v: number | null | undefined; digits?: number; unit?: string }) {
  if (v === null || v === undefined || Number.isNaN(v)) {
    return (
      <span className="missing" title="Missing data">
        {MISSING}
        <span className="sr-only"> missing</span>
      </span>
    );
  }
  return (
    <span className="num">
      {fmt(v, digits)}
      {unit ? <span className="unit"> {unit}</span> : null}
    </span>
  );
}

const DFT_LABEL: Record<DftStatus, string> = {
  accepted: 'DFT accepted',
  rejected: 'DFT not accepted',
  not_available: 'Not evaluated',
  ambiguous: 'DFT ambiguous',
};
const DFT_TIP: Record<DftStatus, string> = {
  accepted: G.dftAccepted,
  rejected: G.dftRejected,
  not_available: G.dftNotAvailable,
  ambiguous: 'Several DFT records exist for this candidate and no single validated label could be assigned.',
};

export function DftBadge({ status, compact = false }: { status: DftStatus; compact?: boolean }) {
  return (
    <span className={`badge badge-dft-${status}`} title={DFT_TIP[status]}>
      {compact && status === 'not_available' ? '—' : DFT_LABEL[status]}
    </span>
  );
}

export function OodBadge({ ood }: { ood: boolean | null | undefined }) {
  if (ood === null || ood === undefined) return <span className="badge badge-muted">OOD unknown</span>;
  return ood ? (
    <span className="badge badge-ood" title={G.ood}>
      OOD
    </span>
  ) : (
    <span className="badge badge-indomain" title={G.ood}>
      In domain
    </span>
  );
}

export function PredictedTag() {
  return (
    <span className="badge badge-pred" title={G.predictedGap}>
      Predicted
    </span>
  );
}

export function HypotheticalTag() {
  return (
    <span className="badge badge-muted" title={G.hypothetical}>
      Hypothetical
    </span>
  );
}

export function Callout({ kind = 'note', title, children }: { kind?: 'note' | 'warn' | 'science'; title?: string; children: ReactNode }) {
  return (
    <div className={`callout callout-${kind}`} role={kind === 'warn' ? 'note' : undefined}>
      {title ? <strong className="callout-title">{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export function Loading({ what = 'data' }: { what?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> Loading {what}…
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state state-error" role="alert">
      <strong>Something went wrong.</strong> {message}
    </div>
  );
}

export function candidateTitle(c: Candidate): string {
  return `${c.metal ?? '?'} · ${c.topology ?? '?'} · ${c.linker_label ?? '?'}`;
}

/** Simple checkbox multi-select in a disclosure, keyboard-accessible. */
export function MultiSelect({ label, options, value, onChange, counts }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; counts?: Record<string, number> }) {
  const summary = value.length === 0 ? 'Any' : value.length <= 2 ? value.join(', ') : `${value.length} selected`;
  return (
    <details className="multiselect">
      <summary>
        <span className="ms-label">{label}</span>
        <span className="ms-value">{summary}</span>
      </summary>
      <fieldset>
        <legend className="sr-only">{label}</legend>
        {options.map((o) => (
          <label key={o} className="ms-opt">
            <input type="checkbox" aria-label={counts ? `${o} (${counts[o] ?? 0})` : o} checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))} />
            <span>{o}</span>
            {counts ? <span className="ms-count">{counts[o] ?? 0}</span> : null}
          </label>
        ))}
        {value.length > 0 && (
          <button type="button" className="link-btn" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </fieldset>
    </details>
  );
}

/** Two-thumb range built from two native range inputs (each labelled). */
export function RangeSlider({ label, unit, min, max, step, value, onChange, digits = 2, missing = 0, includeMissing, onIncludeMissing, tip }: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  digits?: number;
  missing?: number;
  includeMissing?: boolean;
  onIncludeMissing?: (v: boolean) => void;
  tip?: string;
}) {
  const id = useId();
  const [lo, hi] = value;
  const pct = (v: number) => (max === min ? 0 : ((v - min) / (max - min)) * 100);
  return (
    <div className="range">
      <div className="range-head">
        <span id={id} className="range-label">
          {label} {unit ? <span className="unit">({unit})</span> : null}
          {tip ? <InfoTip text={tip} label={`About ${label}`} /> : null}
        </span>
        <span className="range-val">
          {lo.toFixed(digits)} – {hi.toFixed(digits)}
        </span>
      </div>
      <div className="range-track" style={{ ['--lo' as string]: `${pct(lo)}%`, ['--hi' as string]: `${pct(hi)}%` }}>
        <input type="range" aria-label={`${label} minimum`} min={min} max={max} step={step} value={lo} onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])} />
        <input type="range" aria-label={`${label} maximum`} min={min} max={max} step={step} value={hi} onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])} />
      </div>
      {missing > 0 && onIncludeMissing ? (
        <label className="check small">
          <input type="checkbox" checked={includeMissing} onChange={(e) => onIncludeMissing(e.target.checked)} /> include {missing} with missing value
        </label>
      ) : null}
    </div>
  );
}

export function KV({ k, children, tip }: { k: ReactNode; children: ReactNode; tip?: string }) {
  return (
    <div className="kv">
      <dt>
        {k}
        {tip ? <InfoTip text={tip} label={`About ${typeof k === 'string' ? k : 'this field'}`} /> : null}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
