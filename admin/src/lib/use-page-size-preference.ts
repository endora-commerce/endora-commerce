import { useCallback, useState } from 'react';
import { PAGE_SIZE_OPTIONS, type PageSizeOption } from '@endora-commerce/admin-kit/lib';
import { useAuth } from './auth.js';

/**
 * Supported page-size options across paginated admin lists. Kept as a shared
 * constant so the dropdown and the validation match exactly — and since feature
 * 091 the constant is the kit's, so `PaginationFooter` (published) and this hook
 * (not published, because it reads the signed-in admin's id) read one array.
 * Re-exported here because every existing caller names it at this path.
 */
export { PAGE_SIZE_OPTIONS, type PageSizeOption };

const DEFAULT_PAGE_SIZE: PageSizeOption = 20;

/**
 * Per-user, per-scope page-size preference, persisted in localStorage so
 * each admin's choice survives across reloads in the same browser. The
 * key incorporates the admin user id so two operators sharing a browser
 * profile don't overwrite each other's preference.
 *
 * `scope` identifies the list (e.g. 'catalog-products', 'inventory-levels')
 * so different lists can have different preferences.
 *
 * The hook validates the persisted value against `PAGE_SIZE_OPTIONS` so
 * stale or hand-edited values fall back to the default rather than
 * yielding an option that's not in the dropdown.
 */
export function usePageSizePreference(scope: string): {
  pageSize: PageSizeOption;
  setPageSize: (next: PageSizeOption) => void;
} {
  const { me } = useAuth();
  const userId = me?.adminUser.id ?? 'anon';
  const storageKey = `b2b-admin.page-size.${scope}.${userId}`;

  const [pageSize, setPageSizeState] = useState<PageSizeOption>(() => {
    if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return DEFAULT_PAGE_SIZE;
      const parsed = Number.parseInt(raw, 10);
      return (PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed)
        ? (parsed as PageSizeOption)
        : DEFAULT_PAGE_SIZE;
    } catch {
      return DEFAULT_PAGE_SIZE;
    }
  });

  const setPageSize = useCallback(
    (next: PageSizeOption): void => {
      setPageSizeState(next);
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        /* storage full / disabled — keep the in-memory value */
      }
    },
    [storageKey],
  );

  return { pageSize, setPageSize };
}
