import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const MAX_COMPARE = 3;
const KEY = 'mds.compare.v1';

interface CompareState {
  ids: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  set: (ids: string[]) => void;
  full: boolean;
}

const Ctx = createContext<CompareState | null>(null);

function readStored(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>(readStored);
  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(ids));
    } catch {
      /* storage unavailable: keep in memory only */
    }
  }, [ids]);
  const toggle = useCallback(
    (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_COMPARE ? cur : [...cur, id])),
    [],
  );
  const remove = useCallback((id: string) => setIds((cur) => cur.filter((x) => x !== id)), []);
  const clear = useCallback(() => setIds([]), []);
  const set = useCallback((next: string[]) => setIds([...new Set(next)].slice(0, MAX_COMPARE)), []);
  const value = useMemo(
    () => ({ ids, has: (id: string) => ids.includes(id), toggle, remove, clear, set, full: ids.length >= MAX_COMPARE }),
    [ids, toggle, remove, clear, set],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompare(): CompareState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCompare outside CompareProvider');
  return v;
}
