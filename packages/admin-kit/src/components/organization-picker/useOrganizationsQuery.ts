import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  OrganizationPickerListItem,
  OrganizationPickerPage,
  OrganizationStatus,
} from '@endora-commerce/contracts';
// `apiClient` comes through the kit's published `lib` **barrel** rather than
// through `../../lib/api-client.js` — see the note in
// `../sales-channel-picker/SalesChannelPicker.tsx`: the barrel is the only
// spelling `vi.mock` can name from outside the package.
import { apiClient } from '../../lib/index.js';

/**
 * The request the picker makes, built here (feature 091, P2).
 *
 * Until this hook moved into the kit it called `organizations`' own admin API
 * client, which is a reach out of the platform's frontend into a module's admin
 * code — four of the ten keys
 * `backend/scripts/ledgers/cross-module-imports/host.ts` opened with, and the
 * only one of the group that was **type-only**: the picker named
 * `OrganizationStatusPickerFilter` and `OrganizationPickerListItem`, which were
 * declared in `admin/src` and published nowhere. Both now have contract
 * answers, so the reach is gone in both directions: the row shape is
 * `organizationPickerListItemSchema` and the filter is the one published
 * `organizationStatusSchema`, whose four members are exactly the ones the
 * picker filtered on.
 *
 * The mapping below is the projection the module's client used to do. The admin
 * organizations endpoint answers a `{ data, pagination }` envelope over the full
 * Organization, and the picker wants a label, a status pill and the version; the
 * endpoint takes a **single** `filter[status]`, so a multi-status filter passes
 * its first member, exactly as before.
 */
interface AdminOrganizationListResponse {
  data: Array<{
    id: string;
    name: string;
    legalName?: string | null;
    status: OrganizationStatus;
    version?: number;
    registeredAddress?: { country?: string };
  }>;
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

async function listOrganizationsForPicker(options: {
  q?: string;
  status?: OrganizationStatus[];
  limit?: number;
  signal?: AbortSignal;
}): Promise<OrganizationPickerPage> {
  const qs = new URLSearchParams();
  if (options.q !== undefined && options.q.length > 0) qs.set('q', options.q);
  if (options.status && options.status.length > 0) {
    qs.set('filter[status]', options.status[0]!);
  }
  if (options.limit !== undefined) qs.set('limit', String(options.limit));
  const tail = qs.toString();
  const res = await apiClient.get<AdminOrganizationListResponse>(
    `/api/v1/admin/organizations${tail ? `?${tail}` : ''}`,
    options.signal ? { signal: options.signal } : undefined,
  );
  return {
    items: res.data.map((o) => ({
      id: o.id,
      name: o.name,
      legalName: o.legalName ?? null,
      status: o.status,
      countryCode: o.registeredAddress?.country ?? null,
      version: o.version ?? 0,
    })),
    nextCursor: res.pagination.cursor ?? null,
  };
}

export interface UseOrganizationsQueryOptions {
  query: string;
  statusFilter?: OrganizationStatus[];
  /**
   * Accepted and **never sent**. `organizations`' picker client declared it on
   * its options type and serialized `q`, `filter[status]` and `limit` only, so
   * the value has reached no server since the option existed. The behaviour is
   * preserved verbatim here rather than repaired, because a publication merge
   * request must not quietly change what a picker returns; it is reported to
   * the defect register instead.
   */
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

      const listOptions: Parameters<typeof listOrganizationsForPicker>[0] = {
        q: query.trim(),
        limit,
        signal: controller.signal,
      };
      if (statusKey) {
        listOptions.status = statusKey.split(',') as OrganizationStatus[];
      }
      listOrganizationsForPicker(listOptions)
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
