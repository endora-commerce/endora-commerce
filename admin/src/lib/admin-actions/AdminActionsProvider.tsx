import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AdminActionView,
  GetAdminActionsResponse,
  SupportedAdminLanguage,
} from '@b2b/contracts';
import { getAdminActions } from './api.js';

/**
 * React Context provider for the Admin Command Palette action registry —
 * feature 020.
 *
 * Fetches the action list once on mount and again whenever the language
 * prop flips (so labels render in the operator's language). The
 * provider does not subscribe to lifecycle pub/sub on its own — there
 * is no admin-side bridge for that today (research §R4 lists this as a
 * known limitation; the mitigation is "refresh the page after enabling
 * a new module mid-session"). Refetch can be triggered explicitly via
 * the `refresh()` method exposed on the context.
 */

export interface AdminActionsContextValue {
  actions: AdminActionView[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const AdminActionsContext = createContext<AdminActionsContextValue | null>(null);

export interface AdminActionsProviderProps {
  language: SupportedAdminLanguage;
  /** Optional pre-supplied response; tests use this to skip the boot fetch. */
  initial?: GetAdminActionsResponse;
  children: ReactNode;
}

export function AdminActionsProvider(props: AdminActionsProviderProps): ReactNode {
  const { language, initial, children } = props;
  const [actions, setActions] = useState<AdminActionView[]>(initial?.data ?? []);
  const [isLoading, setIsLoading] = useState(initial == null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void (async () => {
      try {
        const res = await getAdminActions(language);
        if (cancelled) return;
        setActions(res.data);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
        if (import.meta.env.DEV) {
          console.warn('[admin-actions] fetch failed', err);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language, tick]);

  const value = useMemo<AdminActionsContextValue>(
    () => ({ actions, isLoading, error, refresh }),
    [actions, isLoading, error, refresh],
  );

  return (
    <AdminActionsContext.Provider value={value}>
      {children}
    </AdminActionsContext.Provider>
  );
}

export function useAdminActionsContext(): AdminActionsContextValue {
  const ctx = useContext(AdminActionsContext);
  if (!ctx) {
    throw new Error(
      '[admin-actions] useAdminActions called outside <AdminActionsProvider>; wrap your app tree first.',
    );
  }
  return ctx;
}
