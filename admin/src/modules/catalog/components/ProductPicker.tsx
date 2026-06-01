import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

/**
 * Searchable product dropdown reusable across the Admin UI.
 *
 * - `mode="select"` picks one product; `value` is the product id (or null).
 * - `mode="multiselect"` picks many; `value` is an array of ids. Selected
 *   products render as removable chips above the picker and are hidden
 *   from the dropdown so the user can keep adding without re-opening.
 *
 * Search runs server-side against `GET /api/v1/admin/catalog/products`
 * with a 250 ms debounce; stale responses are discarded by sequence id.
 * Products that have been seen (via search results or per-id warm-up)
 * are cached locally so chip and selected-label rendering doesn't pay
 * an extra round-trip. Ids that haven't been seen yet render with a
 * short UUID placeholder until the cache fills in.
 */

interface AdminProductSummary {
  id: string;
  sku: string;
  slug: string;
  status: 'draft' | 'active' | 'inactive';
  name: Record<string, string>;
}

function pickName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

function productToOption(p: AdminProductSummary): ComboboxOption<string> {
  const statusSuffix = p.status === 'active' ? '' : ` · ${p.status}`;
  return {
    value: p.id,
    label: pickName(p.name, p.slug),
    description: `${p.sku}${statusSuffix}`,
  };
}

interface CommonProductPickerProps {
  excludeIds?: string[] | undefined;
  includeArchived?: boolean | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  ariaLabel?: string | undefined;
  pageSize?: number | undefined;
}

export type ProductPickerProps =
  | (CommonProductPickerProps & {
      mode: 'select';
      value: string | null;
      onChange: (next: string | null) => void;
    })
  | (CommonProductPickerProps & {
      mode: 'multiselect';
      value: string[];
      onChange: (next: string[]) => void;
    });

const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_PAGE_SIZE = 20;
const UUID_PREFIX_LENGTH = 8;

export function ProductPicker(props: ProductPickerProps): ReactNode {
  const {
    excludeIds,
    includeArchived = false,
    placeholder = 'Search products by name, SKU, or slug…',
    disabled = false,
    id,
    ariaLabel,
    pageSize = DEFAULT_PAGE_SIZE,
  } = props;

  const [productCache, setProductCache] = useState<Map<string, AdminProductSummary>>(
    () => new Map(),
  );
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valueKey =
    props.mode === 'select' ? props.value ?? '' : props.value.join(',');

  const excludeSet = useMemo(() => {
    const set = new Set<string>(excludeIds ?? []);
    if (props.mode === 'multiselect') for (const v of props.value) set.add(v);
    return set;
  }, [excludeIds, props.mode, valueKey]);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  useEffect(
    () => (): void => {
      if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
    },
    [],
  );

  const runSearch = useCallback(
    async (query: string, seq: number): Promise<void> => {
      setSearching(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('page', '0');
        params.set('pageSize', String(pageSize));
        if (includeArchived) params.set('includeArchived', '1');
        const trimmed = query.trim();
        if (trimmed.length > 0) params.set('q', trimmed);
        const res = await apiClient.get<{ data: AdminProductSummary[] }>(
          `/api/v1/admin/catalog/products?${params.toString()}`,
        );
        if (seq !== searchSeqRef.current) return;
        setProductCache((prev) => {
          const next = new Map(prev);
          for (const p of res.data) next.set(p.id, p);
          return next;
        });
        setOptions(res.data.map(productToOption));
      } catch (err) {
        if (seq !== searchSeqRef.current) return;
        setError(err instanceof ApiError ? err.envelope.error.message : 'Search failed.');
        setOptions([]);
      } finally {
        if (seq === searchSeqRef.current) setSearching(false);
      }
    },
    [includeArchived, pageSize],
  );

  const handleSearchChange = useCallback(
    (query: string): void => {
      if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
      const seq = ++searchSeqRef.current;
      searchTimerRef.current = setTimeout(() => {
        void runSearch(query, seq);
      }, SEARCH_DEBOUNCE_MS);
    },
    [runSearch],
  );

  // Warm the cache for ids in `value` that the user hasn't searched yet —
  // common when the picker is mounted with an existing selection.
  const fetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const valueIds =
      props.mode === 'select' ? (props.value ? [props.value] : []) : props.value;
    const missing = valueIds.filter(
      (vid) => !productCache.has(vid) && !fetchedRef.current.has(vid),
    );
    if (missing.length === 0) return;
    for (const vid of missing) fetchedRef.current.add(vid);
    let alive = true;
    void Promise.allSettled(
      missing.map((vid) =>
        apiClient.get<{ data: AdminProductSummary }>(`/api/v1/admin/catalog/products/${vid}`),
      ),
    ).then((results) => {
      if (!alive) return;
      setProductCache((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status === 'fulfilled') next.set(r.value.data.id, r.value.data);
        }
        return next;
      });
    });
    return (): void => {
      alive = false;
    };
  }, [valueKey, props.mode, productCache]);

  const visibleOptions = useMemo(
    () => options.filter((opt) => !excludeSet.has(opt.value)),
    [options, excludeSet],
  );

  const emptyMessage = error ?? (searching ? 'Searching…' : 'No matching products.');

  // exactOptionalPropertyTypes: only forward `id`/`ariaLabel` when defined.
  const optionalProps = {
    ...(id !== undefined ? { id } : {}),
    ...(ariaLabel !== undefined ? { ariaLabel } : {}),
  };

  if (props.mode === 'select') {
    const selectedProduct = props.value ? productCache.get(props.value) ?? null : null;
    return (
      <Combobox<string>
        {...optionalProps}
        options={visibleOptions}
        value={props.value}
        selectedLabel={
          selectedProduct ? pickName(selectedProduct.name, selectedProduct.slug) : ''
        }
        onChange={(next): void => props.onChange(next)}
        onSearchChange={handleSearchChange}
        manualFilter
        loading={searching}
        placeholder={placeholder}
        disabled={disabled}
        emptyMessage={emptyMessage}
      />
    );
  }

  const selectedIds = props.value;
  return (
    <div className="space-y-2">
      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" role="list">
          {selectedIds.map((sid) => {
            const p = productCache.get(sid);
            const label = p ? pickName(p.name, p.slug) : `${sid.slice(0, UUID_PREFIX_LENGTH)}…`;
            return (
              <Badge
                key={sid}
                variant="secondary"
                className="gap-1 pl-2 pr-1 font-normal"
                role="listitem"
              >
                <span className="max-w-[18rem] truncate">{label}</span>
                {p?.sku ? (
                  <span className="font-mono text-[10px] text-muted-foreground">{p.sku}</span>
                ) : null}
                <button
                  type="button"
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={(): void =>
                    props.onChange(selectedIds.filter((existing) => existing !== sid))
                  }
                  aria-label={`Remove ${label}`}
                  disabled={disabled}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            );
          })}
        </div>
      ) : null}
      <Combobox<string>
        {...optionalProps}
        options={visibleOptions}
        value={null}
        onChange={(next): void => {
          if (next === null) return;
          if (selectedIds.includes(next)) return;
          props.onChange([...selectedIds, next]);
        }}
        onSearchChange={handleSearchChange}
        manualFilter
        loading={searching}
        clearable={false}
        placeholder={placeholder}
        disabled={disabled}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
