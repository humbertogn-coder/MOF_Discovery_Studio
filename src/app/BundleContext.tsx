import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LoadedBundle } from '../lib/bundle';
import { openSiteBundle } from '../lib/bundleSource';

/**
 * Bundles that are open in this tab. A bundle of the site is fetched when its page is
 * visited; a bundle from the reader's computer lives in memory only and is gone after a reload.
 */
interface BundleStore {
  get: (key: string) => LoadedBundle | undefined;
  put: (bundle: LoadedBundle) => void;
  /** Changes whenever a bundle is opened, so that readers of the store render again. */
  version: number;
}

const Ctx = createContext<BundleStore | null>(null);

export function BundleProvider({ children }: { children: ReactNode }) {
  const bundles = useRef(new Map<string, LoadedBundle>());
  const [version, setVersion] = useState(0);
  const get = useCallback((key: string) => bundles.current.get(key), []);
  const put = useCallback((bundle: LoadedBundle) => {
    bundles.current.set(bundle.key, bundle);
    setVersion((v) => v + 1);
  }, []);
  const value = useMemo(() => ({ get, put, version }), [get, put, version]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBundleStore(): BundleStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBundleStore outside BundleProvider');
  return v;
}

export type BundleState =
  | { status: 'loading' }
  | { status: 'ready'; bundle: LoadedBundle }
  | { status: 'error'; message: string }
  /** The key is "local" and nothing is open: the page was reloaded, or the address was typed. */
  | { status: 'closed' };

/**
 * The bundle with this key: from the store, or fetched from the site.
 * The answer always belongs to the key that was asked for, also right after the key changed.
 */
export function useBundle(key: string | undefined): BundleState {
  const { get, put } = useBundleStore();
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    if (!key || key === 'local' || get(key)) return;
    let alive = true;
    openSiteBundle(key)
      .then((bundle) => alive && put(bundle))
      .catch((e: unknown) => alive && setFailure({ key, message: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [key, get, put]);
  if (!key) return { status: 'error', message: 'No bundle was named.' };
  const open = get(key);
  if (open) return { status: 'ready', bundle: open };
  if (key === 'local') return { status: 'closed' };
  if (failure?.key === key) return { status: 'error', message: failure.message };
  return { status: 'loading' };
}
