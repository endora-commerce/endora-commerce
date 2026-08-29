import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { Combobox, type ComboboxOption } from '../../ui/combobox.js';

/**
 * Searchable single-select customer-account picker.
 *
 * Wraps the generic <Combobox> over `GET /api/v1/admin/customers?q=…`
 * (250 ms debounce, stale responses discarded by sequence id). The
 * committed value is the customer-account UUID. Customers surfaced by a
 * search are cached locally so the selected label keeps rendering after
 * the matching row paginates out of the current result set.
 *
 * Replaces raw "paste a customer id" text inputs across the admin
 * (quick-order on-behalf, audit-log impersonated filter, …).
 */

interface AdminCustomerSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationName?: string | null;
}

function customerLabel(c: AdminCustomerSummary): string {
  const name = `${c.firstName} ${c.lastName}`.trim();
  return name.length > 0 ? name : c.email;
}

function customerDescription(c: AdminCustomerSummary): string {
  const name = `${c.firstName} ${c.lastName}`.trim();
  // When the label already shows the name, lead the description with the email.
  return name.length > 0
    ? c.organizationName
      ? `${c.email} · ${c.organizationName}`
      : c.email
    : (c.organizationName ?? '');
}

export interface CustomerPickerProps {
  value: string | null;
  onChange: (customerAccountId: string | null) => void;
  status?: 'active' | 'blocked' | 'deleted';
  /** When set, only accounts belonging to this organization are searched
   *  (feature 062 — distributor-binding service-account picker). */
  organizationId?: string;
  placeholder?: string;
  emptyMessage?: string;
  clearable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_PAGE_SIZE = 20;

export function CustomerPicker(props: CustomerPickerProps): ReactNode {
  const [cache, setCache] = useState<Map<string, AdminCustomerSummary>>(() => new Map());
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  useEffect(() => (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const runSearch = useCallback(
    async (query: string, seq: number): Promise<void> => {
      setSearching(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('pageSize', String(DEFAULT_PAGE_SIZE));
        if (props.status) params.set('status', props.status);
        if (props.organizationId) params.set('organizationId', props.organizationId);
        const trimmed = query.trim();
        if (trimmed.length > 0) params.set('q', trimmed);
        const res = await apiClient.get<{ data: AdminCustomerSummary[] }>(
          `/api/v1/admin/customers?${params.toString()}`,
        );
        if (seq !== seqRef.current) return;
        setCache((prev) => {
          const next = new Map(prev);
          for (const c of res.data) next.set(c.id, c);
          return next;
        });
        setOptions(
          res.data.map((c) => ({
            value: c.id,
            label: customerLabel(c),
            description: customerDescription(c),
          })),
        );
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof ApiError ? err.envelope.error.message : 'Search failed.');
        setOptions([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    },
    [props.status, props.organizationId],
  );

  const handleSearchChange = useCallback(
    (query: string): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      const seq = ++seqRef.current;
      timerRef.current = setTimeout(() => void runSearch(query, seq), SEARCH_DEBOUNCE_MS);
    },
    [runSearch],
  );

  const selectedLabel = useMemo(() => {
    if (!props.value) return '';
    const c = cache.get(props.value);
    return c ? customerLabel(c) : '';
  }, [props.value, cache]);

  const emptyMessage =
    props.emptyMessage ?? error ?? (searching ? 'Searching…' : 'No matching customers.');

  return (
    <Combobox<string>
      options={options}
      value={props.value}
      onChange={props.onChange}
      onSearchChange={handleSearchChange}
      manualFilter
      loading={searching}
      clearable={props.clearable ?? true}
      disabled={props.disabled ?? false}
      placeholder={props.placeholder ?? 'Search customers by name or email…'}
      emptyMessage={emptyMessage}
      ariaLabel={props.ariaLabel ?? 'Select customer'}
      id={props.id ?? ''}
      className={props.className ?? ''}
      selectedLabel={selectedLabel}
    />
  );
}
