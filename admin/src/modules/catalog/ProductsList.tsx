import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CircleDollarSign,
  Download,
  MoreHorizontal,
  Package,
  PenSquare,
  Plus,
  Search,
  Store,
  Tag,
  Trash2,
  Upload,
  Warehouse,
  X,
} from 'lucide-react';
import { ProductsBulkEditDialog } from './ProductsBulkEditDialog';
import {
  BULK_EDIT_MAX_BATCH_SIZE,
  resolveProductSelection,
  type ListFilterSnapshot,
} from './lib/resolve-product-selection';
import { ApiError, apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { PaginationFooter } from '@/components/PaginationFooter';
import { usePageSizePreference } from '@/lib/use-page-size-preference';
import { useTranslation } from '@/i18n/useTranslation';

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  type: string;
  status: 'draft' | 'active' | 'inactive';
  name: Record<string, string>;
  visibility: string;
  attributeValues: Record<string, unknown>;
  updatedAt: string;
}

type StatusFilter = 'all' | 'active' | 'draft' | 'inactive';
type StockFilter = 'all' | 'low' | 'out';
type TypeFilter = 'all' | 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
type SelectionMode = 'none' | 'page' | 'collection';

interface ProductListSelection {
  mode: SelectionMode;
  pageIds: Set<string>;
  collectionSnapshot: ListFilterSnapshot | null;
  collectionTotal: number;
}

function emptySelection(): ProductListSelection {
  return { mode: 'none', pageIds: new Set(), collectionSnapshot: null, collectionTotal: 0 };
}

const TYPE_CYCLE: TypeFilter[] = ['all', 'simple', 'configurable', 'grouped', 'bundle', 'virtual'];
const STOCK_CYCLE: StockFilter[] = ['all', 'low', 'out'];

/**
 * Products list (feature 008).
 *
 * Status-segmented tabs at the top mirror Shopify's catalog list. The
 * filter bar carries a search box, two cycle-style filter chips (Type,
 * Stock), and placeholders for Category / Channel. A bulk-action bar
 * appears when rows are selected. Table view only — the grid variant
 * was explicitly out of scope for this redesign.
 */
interface ProductsResponse {
  data: AdminProduct[];
  pagination: { page: number; pageSize: number; total: number };
  counts: { all: number; active: number; draft: number; inactive: number };
}

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'active', 'draft', 'inactive'];

function isStatusFilter(value: string | null): value is StatusFilter {
  return value !== null && (STATUS_FILTERS as readonly string[]).includes(value);
}

export function ProductsList(): ReactNode {
  const t = useTranslation('catalog');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<{ all: number; active: number; draft: number; inactive: number }>(
    { all: 0, active: 0, draft: 0, inactive: 0 },
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const fromUrl = searchParams.get('status');
    return isStatusFilter(fromUrl) ? fromUrl : 'all';
  });
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [selection, setSelection] = useState<ProductListSelection>(emptySelection);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bulkEditProductIds, setBulkEditProductIds] = useState<string[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [resolvingSelection, setResolvingSelection] = useState(false);
  const { pageSize, setPageSize } = usePageSizePreference('catalog-products');
  const [page, setPage] = useState(0);

  // Debounce the text query so each keystroke doesn't fire a fetch. 250 ms
  // is fast enough to feel live and slow enough to coalesce typing bursts.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 250);
    return (): void => window.clearTimeout(id);
  }, [query]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('includeArchived', '1');
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const trimmed = debouncedQuery.trim();
      if (trimmed) params.set('q', trimmed);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await apiClient.get<ProductsResponse>(
        `/api/v1/admin/catalog/products?${params.toString()}`,
      );
      setRows(res.data);
      setTotal(res.pagination.total);
      setCounts(res.counts);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productsList.error.load'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, debouncedQuery, page, pageSize, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset to the first page whenever the result-shaping inputs change so
  // the user never lands on an out-of-range page. Page-size, status, type,
  // and the (debounced) text query all reshape the result set.
  useEffect(() => {
    setPage(0);
  }, [statusFilter, typeFilter, debouncedQuery, pageSize]);

  // Feature 033 — changing filters invalidates collection-wide selection (FR-006).
  useEffect(() => {
    setSelection(emptySelection());
    setBulkEditOpen(false);
    setBulkEditProductIds([]);
    setSelectionError(null);
  }, [statusFilter, typeFilter, debouncedQuery]);

  const filterSnapshot = useCallback(
    (): ListFilterSnapshot => ({
      status: statusFilter,
      type: typeFilter,
      q: debouncedQuery,
    }),
    [statusFilter, typeFilter, debouncedQuery],
  );

  // The stock chip remains a placeholder until the list payload carries
  // stock numbers — apply it client-side as a kill-switch so the UI stays
  // honest (returns 0 rows when "Out"/"Low" is picked).
  const filtered = useMemo(() => {
    if (stockFilter !== 'all') return [];
    return rows;
  }, [rows, stockFilter]);

  const selectedCount =
    selection.mode === 'collection' ? selection.collectionTotal : selection.pageIds.size;

  const isRowSelected = (id: string): boolean =>
    selection.mode === 'collection' || selection.pageIds.has(id);

  const allVisibleSelected =
    filtered.length > 0 &&
    (selection.mode === 'collection' ||
      filtered.every((p) => selection.pageIds.has(p.id)));

  const someVisibleSelected =
    filtered.some((p) => isRowSelected(p.id)) && !allVisibleSelected;

  const showSelectAllBanner =
    filtered.length > 0 &&
    total > filtered.length &&
    selection.mode === 'page' &&
    filtered.every((p) => selection.pageIds.has(p.id));

  const clearSelection = (): void => {
    setSelection(emptySelection());
    setSelectionError(null);
  };

  const toggleAll = (): void => {
    if (selection.mode === 'collection' || allVisibleSelected) {
      clearSelection();
      return;
    }
    setSelection({
      mode: 'page',
      pageIds: new Set(filtered.map((p) => p.id)),
      collectionSnapshot: null,
      collectionTotal: 0,
    });
  };

  const toggleOne = (id: string): void => {
    setSelection((prev) => {
      if (prev.mode === 'collection') {
        const nextIds = new Set(filtered.map((p) => p.id));
        nextIds.delete(id);
        return {
          mode: nextIds.size === 0 ? 'none' : 'page',
          pageIds: nextIds,
          collectionSnapshot: null,
          collectionTotal: 0,
        };
      }
      const nextIds = new Set(prev.pageIds);
      if (nextIds.has(id)) nextIds.delete(id);
      else nextIds.add(id);
      return {
        mode: nextIds.size === 0 ? 'none' : 'page',
        pageIds: nextIds,
        collectionSnapshot: null,
        collectionTotal: 0,
      };
    });
  };

  const selectCollectionMode = (): void => {
    setSelection({
      mode: 'collection',
      pageIds: new Set(),
      collectionSnapshot: filterSnapshot(),
      collectionTotal: total,
    });
  };

  const resolveSelectedIds = async (): Promise<string[]> => {
    if (selection.mode === 'collection' && selection.collectionSnapshot) {
      const { productIds } = await resolveProductSelection(selection.collectionSnapshot);
      return productIds;
    }
    return Array.from(selection.pageIds);
  };

  const openBulkEdit = async (): Promise<void> => {
    setSelectionError(null);
    setResolvingSelection(true);
    try {
      const ids = await resolveSelectedIds();
      if (ids.length > BULK_EDIT_MAX_BATCH_SIZE) {
        setSelectionError(
          t('productsList.selection.bulkEditLimit', {
            total: ids.length,
            maxBatchSize: BULK_EDIT_MAX_BATCH_SIZE,
          }),
        );
        return;
      }
      setBulkEditProductIds(ids);
      setBulkEditOpen(true);
    } catch {
      setSelectionError(t('productsList.selection.resolveFailed'));
    } finally {
      setResolvingSelection(false);
    }
  };

  const runWithResolvedIds = async (
    action: (ids: string[]) => Promise<void>,
  ): Promise<void> => {
    setSelectionError(null);
    setResolvingSelection(true);
    try {
      const ids = await resolveSelectedIds();
      await action(ids);
    } catch {
      setSelectionError(t('productsList.selection.resolveFailed'));
    } finally {
      setResolvingSelection(false);
    }
  };

  const handleBulkDelete = (): void => {
    if (deleting || selectedCount === 0) return;
    if (!confirm(t('productsList.bulk.deleteConfirm', { count: selectedCount }))) return;

    setDeleting(true);
    setError(null);
    // Resolve the full selection (page or "all matching" collection scope —
    // feature 033) before deleting; collect per-item failures (feature 032).
    void runWithResolvedIds(async (ids) => {
      const failed: Array<{ id: string; message: string }> = [];
      for (const id of ids) {
        try {
          await apiClient.delete<void>(`/api/v1/admin/catalog/products/${id}`);
        } catch (err) {
          const message =
            err instanceof ApiError
              ? err.envelope.error.message
              : t('productsList.bulk.deleteFailed');
          failed.push({ id, message });
        }
      }
      if (failed.length > 0) {
        setError(failed.map((f) => f.message).join(' · '));
      } else {
        clearSelection();
      }
      await refresh();
    }).finally(() => {
      setDeleting(false);
    });
  };

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">{t('productsList.title')}</div>
          <div className="b2b-page-head__sub">
            {t('productsList.subtitle', { count: counts.all })}
          </div>
        </div>
        <div className="b2b-page-head__actions">
          <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
            <Upload size={13} /> {t('productsList.action.import')}
          </button>
          <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
            <Download size={13} /> {t('productsList.action.export')}
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            onClick={(): void => { navigate('/catalog/products/new'); }}
          >
            <Plus size={14} /> {t('productsList.action.newProduct')}
          </button>
        </div>
      </div>

      {error ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(8 80% 85%)',
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="b2b-card">
        <div style={{ padding: '4px 12px 0', overflow: 'hidden' }}>
          <div className="b2b-tabs-scroll">
          <div className="b2b-tabs" role="tablist">
            <Tab id="all" label={t('productsList.tab.all')} count={counts.all} active={statusFilter} onChange={setStatusFilter} />
            <Tab id="active" label={t('productsList.tab.active')} count={counts.active} active={statusFilter} onChange={setStatusFilter} />
            <Tab id="draft" label={t('productsList.tab.draft')} count={counts.draft} active={statusFilter} onChange={setStatusFilter} />
            <Tab id="inactive" label={t('productsList.tab.inactive')} count={counts.inactive} active={statusFilter} onChange={setStatusFilter} />
          </div>
          </div>
        </div>

        <div className="b2b-filterbar">
          <div className="b2b-filterbar__search">
            <div className="b2b-input-wrap">
              <Search size={16} className="lead" />
              <input
                className="b2b-field b2b-field--addon"
                placeholder={t('productsList.search.placeholder')}
                value={query}
                onChange={(e): void => setQuery(e.target.value)}
              />
            </div>
          </div>
          <Chip
            icon={<Package size={12} />}
            active={typeFilter !== 'all'}
            label={typeFilter === 'all' ? t('productsList.chip.type') : t('productsList.chip.typeWithValue', { value: typeFilter })}
            onClick={(): void => {
              const idx = TYPE_CYCLE.indexOf(typeFilter);
              setTypeFilter(TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length]!);
            }}
            {...(typeFilter !== 'all'
              ? { onRemove: (): void => setTypeFilter('all') }
              : {})}
          />
          <Chip
            icon={<Warehouse size={12} />}
            active={stockFilter !== 'all'}
            label={
              stockFilter === 'all'
                ? t('productsList.chip.stock')
                : stockFilter === 'out'
                  ? t('productsList.chip.outOfStock')
                  : t('productsList.chip.lowStock')
            }
            onClick={(): void => {
              const idx = STOCK_CYCLE.indexOf(stockFilter);
              setStockFilter(STOCK_CYCLE[(idx + 1) % STOCK_CYCLE.length]!);
            }}
            {...(stockFilter !== 'all'
              ? { onRemove: (): void => setStockFilter('all') }
              : {})}
          />
          <Chip icon={<Tag size={12} />} active={false} label={t('productsList.chip.category')} onClick={(): void => {}} />
          <Chip icon={<Store size={12} />} active={false} label={t('productsList.chip.channel')} onClick={(): void => {}} />
        </div>

        {showSelectAllBanner ? (
          <div
            style={{
              padding: '8px 12px',
              fontSize: 13,
              background: 'var(--bg-subtle, #f6f6f7)',
              borderBottom: '1px solid var(--border, #e5e7eb)',
            }}
          >
            {t('productsList.selection.allPageSelected', { pageCount: filtered.length })}{' '}
            <button
              type="button"
              data-testid="select-all-matching"
              className="b2b-btn b2b-btn--ghost"
              style={{ display: 'inline', height: 'auto', padding: 0, color: 'var(--primary-color)' }}
              onClick={selectCollectionMode}
            >
              {t('productsList.selection.selectAllMatching', { total })}
            </button>
          </div>
        ) : null}

        {selectionError ? (
          <div
            style={{
              padding: '8px 12px',
              fontSize: 13,
              color: 'var(--danger-soft-fg)',
              background: 'var(--danger-soft)',
              borderBottom: '1px solid hsl(8 80% 85%)',
            }}
          >
            {selectionError}
          </div>
        ) : null}

        {selectedCount > 0 ? (
          <div className="b2b-bulkbar">
            <input
              type="checkbox"
              className="b2b-cbx"
              checked={allVisibleSelected}
              ref={(el): void => {
                if (el) el.indeterminate = someVisibleSelected;
              }}
              onChange={toggleAll}
            />
            <span className="count" data-testid="selection-summary">
              {t('productsList.selection.selected', { count: selectedCount })}{' '}
              {selection.mode === 'collection'
                ? t('productsList.selection.scopeCollection')
                : t('productsList.selection.scopePage')}
            </span>
            <div className="actions">
              <button
                type="button"
                className="b2b-btn b2b-btn--primary"
                disabled={resolvingSelection}
                onClick={(): void => {
                  void openBulkEdit();
                }}
              >
                <PenSquare size={13} />{' '}
                {resolvingSelection
                  ? t('productsList.selection.resolving')
                  : t('productsList.bulk.edit')}
              </button>
              <button
                type="button"
                className="b2b-btn"
                disabled={resolvingSelection}
                onClick={(): void => {
                  void runWithResolvedIds(async () => {
                    /* Edit price — placeholder until dedicated flow ships */
                  });
                }}
              >
                <CircleDollarSign size={13} /> {t('productsList.bulk.editPrice')}
              </button>
              <button
                type="button"
                className="b2b-btn b2b-btn--danger"
                disabled={deleting || resolvingSelection}
                onClick={handleBulkDelete}
              >
                <Trash2 size={13} /> {deleting ? '…' : t('productsList.bulk.delete')}
              </button>
            </div>
            <button
              type="button"
              className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
              style={{ color: '#fff' }}
              onClick={clearSelection}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}

        {bulkEditOpen && bulkEditProductIds.length > 0 ? (
          <ProductsBulkEditDialog
            productIds={bulkEditProductIds}
            selectionScope={selection.mode === 'collection' ? 'collection' : 'page'}
            onClose={(): void => setBulkEditOpen(false)}
            onApplied={(): void => {
              void refresh();
              clearSelection();
              setBulkEditOpen(false);
              setBulkEditProductIds([]);
            }}
          />
        ) : null}

        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('productsList.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon">
                <Package size={20} />
              </div>
              <div className="b2b-empty__title">{t('productsList.empty.title')}</div>
              <div className="b2b-empty__sub">
                {t('productsList.empty.prefix')}{' '}
                <button
                  type="button"
                  className="b2b-btn b2b-btn--ghost"
                  onClick={(): void => { navigate('/catalog/products/new'); }}
                  style={{ display: 'inline-flex', height: 'auto', padding: 0, color: 'var(--primary-color)' }}
                >
                  {t('productsList.empty.button')}
                </button>{' '}
                {t('productsList.empty.suffix')}
              </div>
            </div>
          ) : (
            <div className="b2b-table-scroll">
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th className="col-cb">
                    <input
                      type="checkbox"
                      className="b2b-cbx"
                      checked={allVisibleSelected}
                      ref={(el): void => {
                        if (el) el.indeterminate = someVisibleSelected;
                      }}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>{t('productsList.column.product')}</th>
                  <th>{t('productsList.column.sku')}</th>
                  <th>{t('productsList.column.status')}</th>
                  <th>{t('productsList.column.type')}</th>
                  <th>{t('productsList.column.visibility')}</th>
                  <th>{t('productsList.column.updated')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className={cn('is-clickable', isRowSelected(r.id) && 'is-selected')}
                    onClick={(): void => { navigate(`/catalog/products/${r.id}`); }}
                  >
                    <td className="col-cb" onClick={(e): void => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="b2b-cbx"
                        checked={isRowSelected(r.id)}
                        onChange={(): void => toggleOne(r.id)}
                      />
                    </td>
                    <td>
                      <div className="b2b-row" style={{ gap: 12 }}>
                        <div
                          className="b2b-thumb"
                          style={{
                            width: 36,
                            height: 36,
                            background: hashColor(r.id),
                          }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 500,
                              color: 'var(--fg)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: 360,
                            }}
                          >
                            {pickName(r.name)}
                          </div>
                          {r.name['pl-PL'] && r.name['pl-PL'] !== r.name['en-US'] ? (
                            <div
                              className="b2b-muted"
                              style={{
                                fontSize: 12,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: 360,
                              }}
                            >
                              🇵🇱 {r.name['pl-PL']}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="b2b-mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {r.sku}
                      </span>
                    </td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td>
                      <span style={{ fontSize: 12, textTransform: 'capitalize' }}>{r.type}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {humanizeVisibility(r.visibility)}
                      </span>
                    </td>
                    <td>
                      <span className="b2b-muted" style={{ fontSize: 12 }}>{relTime(r.updatedAt)}</span>
                    </td>
                    <td className="actions" onClick={(e): void => e.stopPropagation()}>
                      <button type="button" className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm">
                        <MoreHorizontal size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <PaginationFooter
          page={page}
          pageSize={pageSize}
          total={total}
          onPageSizeChange={setPageSize}
          onPrev={(): void => setPage((p) => Math.max(0, p - 1))}
          onNext={(): void => setPage((p) => p + 1)}
        />
      </div>
    </div>
  );
}

function Tab(props: {
  id: StatusFilter;
  label: string;
  count: number;
  active: StatusFilter;
  onChange: (next: StatusFilter) => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active === props.id}
      className={cn('b2b-tab', props.active === props.id && 'is-active')}
      onClick={(): void => props.onChange(props.id)}
    >
      <span>{props.label}</span>
      <span className="b2b-badge b2b-badge--outline">{props.count}</span>
    </button>
  );
}

function Chip(props: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={cn('b2b-filterchip', props.active && 'is-on')}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
      {props.active && props.onRemove ? (
        <X
          size={12}
          onClick={(e): void => {
            e.stopPropagation();
            props.onRemove?.();
          }}
        />
      ) : null}
    </button>
  );
}

function StatusPill({ status }: { status: AdminProduct['status'] }): ReactNode {
  const map: Record<AdminProduct['status'], { cls: string; label: string }> = {
    active: { cls: 'b2b-badge--success', label: 'Active' },
    draft: { cls: 'b2b-badge--warn', label: 'Draft' },
    inactive: { cls: '', label: 'Inactive' },
  } as const;
  const v = map[status];
  return <span className={cn('b2b-badge', 'b2b-badge--dot', v.cls)}>{v.label}</span>;
}

function pickName(name: Record<string, string>): string {
  return name['en-US'] ?? Object.values(name)[0] ?? '';
}

function humanizeVisibility(v: string): string {
  if (v === 'logged_in_only') return 'Logged-in';
  if (v === 'organization_restricted') return 'Org-restricted';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/* Light fingerprint of an id → a stable Shopify-ish swatch for the
 * thumbnail placeholder. The real product page will swap this for the
 * gallery's base image. */
function hashColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i);
  const palette = [
    'linear-gradient(135deg, #94a3b8cc, #475569cc)',
    'linear-gradient(135deg, #a3a8b1cc, #5b6a78cc)',
    'linear-gradient(135deg, #b39ddbcc, #6750a4cc)',
    'linear-gradient(135deg, #fcd34dcc, #b54708cc)',
    'linear-gradient(135deg, #6ee7b7cc, #008060cc)',
    'linear-gradient(135deg, #ffafa3cc, #d72c0dcc)',
  ];
  const idx = Math.abs(hash) % palette.length;
  return palette[idx]!;
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Suppress unused: passed through cn() calls, kept for future use.
const _styleAvoidsUnusedImport: CSSProperties = {};
void _styleAvoidsUnusedImport;
