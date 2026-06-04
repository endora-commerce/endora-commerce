import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { cmsClient, type CmsPageSummary } from '@/modules/cms/api/cms-client';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

/**
 * Searchable single-select CMS-page picker.
 *
 * Wraps <Combobox> over `cmsClient.listPages({ q })` (cursor-paginated,
 * 250 ms debounce, stale responses discarded by sequence id). The
 * committed value is the page UUID. Pages seen via search are cached so
 * the selected label survives the matching row paginating away.
 */

export interface CmsPagePickerProps {
  value: string | null;
  onChange: (pageId: string | null) => void;
  salesChannelId?: string;
  placeholder?: string;
  emptyMessage?: string;
  clearable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_LIMIT = 20;

export function CmsPagePicker(props: CmsPagePickerProps): ReactNode {
  const [cache, setCache] = useState<Map<string, CmsPageSummary>>(() => new Map());
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
        const trimmed = query.trim();
        const res = await cmsClient.listPages({
          limit: DEFAULT_LIMIT,
          ...(trimmed.length > 0 ? { q: trimmed } : {}),
          ...(props.salesChannelId ? { salesChannelId: props.salesChannelId } : {}),
        });
        if (seq !== seqRef.current) return;
        setCache((prev) => {
          const next = new Map(prev);
          for (const p of res.data) next.set(p.id, p);
          return next;
        });
        setOptions(
          res.data.map((p) => ({
            value: p.id,
            label: p.name,
            description: `/${p.slug}${p.status === 'published' ? '' : ` · ${p.status}`}`,
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
    [props.salesChannelId],
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
    return cache.get(props.value)?.name ?? '';
  }, [props.value, cache]);

  const emptyMessage =
    props.emptyMessage ?? error ?? (searching ? 'Searching…' : 'No matching pages.');

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
      placeholder={props.placeholder ?? 'Search CMS pages…'}
      emptyMessage={emptyMessage}
      ariaLabel={props.ariaLabel ?? 'Select CMS page'}
      id={props.id ?? ''}
      className={props.className ?? ''}
      selectedLabel={selectedLabel}
    />
  );
}
