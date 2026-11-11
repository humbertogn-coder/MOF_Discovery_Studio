import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadCandidates, loadManifest } from '../lib/data';
import type { Candidate, Manifest } from '../lib/types';

interface DataState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  manifest: Manifest | null;
  candidates: Candidate[];
  byId: Map<string, Candidate>;
}

const Ctx = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<DataState, 'byId'>>({ status: 'loading', error: null, manifest: null, candidates: [] });
  useEffect(() => {
    let alive = true;
    Promise.all([loadManifest(), loadCandidates()])
      .then(([manifest, file]) => {
        if (!alive) return;
        if (file.schema_version !== manifest.schema_version) {
          throw new Error(`Schema mismatch: manifest ${manifest.schema_version}, candidates ${file.schema_version}`);
        }
        setState({ status: 'ready', error: null, manifest, candidates: file.records });
      })
      .catch((e: unknown) => alive && setState({ status: 'error', error: e instanceof Error ? e.message : String(e), manifest: null, candidates: [] }));
    return () => {
      alive = false;
    };
  }, []);
  const value = useMemo(() => ({ ...state, byId: new Map(state.candidates.map((c) => [c.id, c])) }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}
