import { useEffect, useMemo, useRef, useState } from 'react';
import {
  organizationsPickerClient,
  type OrganizationPickerListItem,
  type OrganizationStatusPickerFilter,
} from '@/modules/organizations/api/organizations-picker-client';

export interface UseOrganizationsQueryOptions {
  query: string;
  statusFilter?: OrganizationStatusPickerFilter[];
  salesRepAdminUserId?: string;
  /** Defaults to 25. Capped at 100 server-side. */
  limit?: number;
  /** Debounce delay in ms. Defaults to 200. */
  debounceMs?: number;
}

export interface UseOrganizationsQueryResult {
  items: OrganizationPickerListItem[];
  loading: boolean;
  error: string | null;
}

/**
 * Hook backing `<OrganizationPicker>` and `<OrganizationPickerMulti>`.
 *
 * Owns the debounce + abort-on-restart logic so the picker remains snappy
 * (≤ 200 ms p95 typeahead, per SC-008) even as the user types quickly.
 * The server is the source of truth for filtering — the Combobox primitive
 * runs in `manualFilter` mode for these pickers.
 */
export function useOrganizationsQuery(
  options: UseOrganizationsQueryOptions,
): UseOrganizationsQueryResult {
  const { query, statusFilter, salesRepAdminUserId, limit = 25, debounceMs = 200 } = options;
  const [items, setItems] = useState<OrganizationPickerListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stable string key so `useEffect` doesn't refire on every parent render.
  const statusKey = useMemo(
    () => (statusFilter && statusFilter.length > 0 ? [...statusFilter].sort().join(',') : ''),
    [statusFilter],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      const listOptions: Parameters<typeof organizationsPickerClient.list>[0] = {
        q: query.trim(),
        limit,
        signal: controller.signal,
      };
      if (statusKey) {
        listOptions.status = statusKey.split(',') as OrganizationStatusPickerFilter[];
      }
      if (salesRepAdminUserId) {
        listOptions.salesRepAdminUserId = salesRepAdminUserId;
      }
      organizationsPickerClient
        .list(listOptions)
        .then((page) => {
          if (controller.signal.aborted) return;
          setItems(page.items);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : 'Failed to load organizations.');
          setItems([]);
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          setLoading(false);
        });
    }, debounceMs);

    return (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [query, statusKey, salesRepAdminUserId, limit, debounceMs]);

  return { items, loading, error };
}
