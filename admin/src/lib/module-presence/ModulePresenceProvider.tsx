import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AdminModulePresenceResponse, ModulePresence } from '@b2b/contracts';
import { getModulePresence } from './api.js';

/**
 * The effective enabled-set, fetched once and read by every admin surface —
 * feature 073, FR-031.
 *
 * Constitution XVII: a module that is off contributes no sidebar entry, palette
 * action, widget, tab or settings group. Both frontends resolve that from the
 * server's projection; nothing here recombines the two axes, because `present`
 * arrives precomputed. That is what makes "off means absent" one decision
 * rather than several implementations that can disagree.
 *
 * Mirrors `AdminActionsProvider`: fetched on mount, refreshable on demand, no
 * lifecycle pub/sub bridge on the admin side (there is none today). The one
 * caller that changes presence — the activation control — calls `refresh()`
 * itself, so an operator sees their own flip take effect immediately.
 *
 * **Fail-closed while unresolved.** Until the first response lands, `isPresent`
 * answers `false` for a module it has not heard of, so a surface belonging to a
 * switched-off module never flashes on screen before disappearing. The one
 * exception is a failed fetch: an admin whose presence request errored would
 * otherwise be left with an empty sidebar and no way to diagnose it, so a
 * failure degrades to "show everything" and the gated routes 503 honestly.
 */

export interface ModulePresenceContextValue {
  modules: ModulePresence[];
  /** `true` when the module is effectively present, i.e. safe to advertise. */
  isPresent: (moduleId: string) => boolean;
  /** The full record, for a surface that must render the two axes differently. */
  presenceOf: (moduleId: string) => ModulePresence | undefined;
  /**
   * The serving process is TTL-refreshing because its pub/sub link is
   * unhealthy, so this projection may lag a flip made elsewhere. Only the
   * platform screen renders it — every other surface would only be able to
   * report the staleness, not do anything about it.
   */
  degraded: boolean;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const ModulePresenceContext = createContext<ModulePresenceContextValue | null>(null);

export interface ModulePresenceProviderProps {
  /** Optional pre-supplied projection; tests use this to skip the boot fetch. */
  initial?: AdminModulePresenceResponse;
  children: ReactNode;
}

export function ModulePresenceProvider(props: ModulePresenceProviderProps): ReactNode {
  const { initial, children } = props;
  const [modules, setModules] = useState<ModulePresence[]>(initial?.modules ?? []);
  const [degraded, setDegraded] = useState(initial?.degraded ?? false);
  const [isLoading, setIsLoading] = useState(initial == null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (initial != null && tick === 0) return;
    let cancelled = false;
    setIsLoading(true);
    void (async () => {
      try {
        const res = await getModulePresence();
        if (cancelled) return;
        setModules(res.modules);
        setDegraded(res.degraded);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
        if (import.meta.env.DEV) {
          console.warn('[module-presence] fetch failed', err);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `initial` is a boot-time prop; re-running on its identity would refetch
    // on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const value = useMemo<ModulePresenceContextValue>(() => {
    const byId = new Map(modules.map((m) => [m.id, m]));
    // A failed fetch leaves an operator with no projection at all. Hiding
    // everything would be indistinguishable from a broken deployment, so this
    // one case degrades open and lets the gated routes answer for themselves.
    const unresolved = error !== null && modules.length === 0;
    return {
      modules,
      isPresent: (moduleId: string): boolean => byId.get(moduleId)?.present ?? unresolved,
      presenceOf: (moduleId: string): ModulePresence | undefined => byId.get(moduleId),
      degraded,
      isLoading,
      error,
      refresh,
    };
  }, [modules, degraded, isLoading, error, refresh]);

  return (
    <ModulePresenceContext.Provider value={value}>
      {children}
    </ModulePresenceContext.Provider>
  );
}

export function useModulePresence(): ModulePresenceContextValue {
  const ctx = useContext(ModulePresenceContext);
  if (!ctx) {
    throw new Error(
      '[module-presence] useModulePresence called outside <ModulePresenceProvider>; wrap your app tree first.',
    );
  }
  return ctx;
}
