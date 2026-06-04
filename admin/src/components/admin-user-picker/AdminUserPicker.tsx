import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

/**
 * Searchable single-select admin-user picker.
 *
 * Wraps <Combobox> over `GET /api/v1/admin/admin-users?q=…` (250 ms
 * debounce, stale responses discarded by sequence id). The committed
 * value is the admin-user UUID. Used for actor / assignee filters that
 * previously asked operators to paste a UUID.
 */

interface AdminUserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

function adminUserLabel(u: AdminUserSummary): string {
  const name = `${u.firstName} ${u.lastName}`.trim();
  return name.length > 0 ? name : u.email;
}

export interface AdminUserPickerProps {
  value: string | null;
  onChange: (adminUserId: string | null) => void;
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

export function AdminUserPicker(props: AdminUserPickerProps): ReactNode {
  const [cache, setCache] = useState<Map<string, AdminUserSummary>>(() => new Map());
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  useEffect(() => (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const runSearch = useCallback(async (query: string, seq: number): Promise<void> => {
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('pageSize', String(DEFAULT_PAGE_SIZE));
      const trimmed = query.trim();
      if (trimmed.length > 0) params.set('q', trimmed);
      const res = await apiClient.get<{ data: AdminUserSummary[] }>(
        `/api/v1/admin/admin-users?${params.toString()}`,
      );
      if (seq !== seqRef.current) return;
      setCache((prev) => {
        const next = new Map(prev);
        for (const u of res.data) next.set(u.id, u);
        return next;
      });
      setOptions(
        res.data.map((u) => ({ value: u.id, label: adminUserLabel(u), description: u.email })),
      );
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof ApiError ? err.envelope.error.message : 'Search failed.');
      setOptions([]);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }, []);

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
    const u = cache.get(props.value);
    return u ? adminUserLabel(u) : '';
  }, [props.value, cache]);

  const emptyMessage =
    props.emptyMessage ?? error ?? (searching ? 'Searching…' : 'No matching admin users.');

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
      placeholder={props.placeholder ?? 'Search admin users by name or email…'}
      emptyMessage={emptyMessage}
      ariaLabel={props.ariaLabel ?? 'Select admin user'}
      id={props.id ?? ''}
      className={props.className ?? ''}
      selectedLabel={selectedLabel}
    />
  );
}
