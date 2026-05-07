import { useMemo } from 'react';
import type { AdminActionView } from '@b2b/contracts';
import { useAdminActionsContext } from './AdminActionsProvider.js';
import { normalize } from './normalize.js';

/**
 * Read the operator-visible action list from the registry context, with
 * an optional client-side substring filter.
 *
 * The list is already permission-filtered, language-resolved, and
 * sorted by (weight, label) by the server. Client-side we only:
 *   - apply the user's typed query against label / description /
 *     keywords (diacritic-insensitive, case-insensitive substring).
 *   - return the same list verbatim when the query is empty.
 */
export function useAdminActions(query?: string): {
  actions: AdminActionView[];
  isLoading: boolean;
  error: Error | null;
} {
  const ctx = useAdminActionsContext();
  const filtered = useMemo<AdminActionView[]>(() => {
    if (!query || query.trim().length === 0) return ctx.actions;
    const needle = normalize(query);
    return ctx.actions.filter((a) => {
      if (normalize(a.label).includes(needle)) return true;
      if (a.description && normalize(a.description).includes(needle)) return true;
      for (const kw of a.keywords) {
        if (normalize(kw).includes(needle)) return true;
      }
      return false;
    });
  }, [ctx.actions, query]);
  return { actions: filtered, isLoading: ctx.isLoading, error: ctx.error };
}
