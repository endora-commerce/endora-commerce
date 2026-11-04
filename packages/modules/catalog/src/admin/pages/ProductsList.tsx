import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArchiveRestore,
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
import { ProductsBulkEditDialog } from '../components/ProductsBulkEditDialog.js';
import type { ProductLabel } from '../lib/product-labels.js';
import { ArchivedPill, ProductStatusPill } from '../components/ProductStatusPills.js';
import {
  BULK_EDIT_HARD_MAX,
  productListTabFromUrl,
  productListTabQuery,
  resolveProductSelection,
  type ListFilterSnapshot,
  type ProductListTab,
} from '../lib/resolve-product-selection.js';
import { ApiError, apiClient, cn, useAuth, usePageSizePreference } from '@endora-commerce/admin-kit/lib';
import { PaginationFooter, SavedViewsControl } from '@endora-commerce/admin-kit/components';
import type { SavedViewState } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  type: string;
  status: 'active' | 'inactive';
  /** Archived is its own fact, independent of `status`. */
  archivedAt?: string | null;
  /** The Global name (feature 172: one text per product, no per-language map). */
  name: string;
  visibility: string;
  attributeValues: Record<string, unknown>;
  updatedAt: string;
}

type StatusFilter = ProductListTab;
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
  counts: ProductListCounts;
}

/** `all` / `active` / `inactive` count non-archived products. */
interface ProductListCounts {
  all: number;
  active: number;
  inactive: number;
  archived: number;
}

/**
 * A saved view's filters → the tab it opens on (FR-012). The Archived tab is saved
 * as its own key, `archived: 'only'`, never as a status (R30.4 rejects an
 * "archived" pseudo-status). A `status` the page no longer offers — `draft` among
 * them — opens as *All* (owner decision P-2 → A, 2026-10-26: not mapped onto
 * `inactive`); the list says so once, when such a view is applied.
 */
export function savedViewTab(filters: Record<string, unknown>): StatusFilter {
  if (filters['archived'] === 'only') return 'archived';
  const status = filters['status'];
  return status === 'active' || status === 'inactive' ? status : 'all';
}

/** The tab → the saved view's filter keys; the inverse of {@link savedViewTab}. */
export function savedViewTabFilters(tab: StatusFilter): Record<string, unknown> {
  if (tab === 'archived') return { archived: 'only' };
  if (tab === 'active' || tab === 'inactive') return { status: tab };
  return {};
}

function isTypeFilter(value: unknown): value is TypeFilter {
  return typeof value === 'string' && (TYPE_CYCLE as readonly string[]).includes(value);
}

export function ProductsList(): ReactNode {
  const t = useTranslation('catalog');
  const navigate = useNavigate();
  // The create route this screen links to takes the **write** code (D-221), so
  // both buttons that navigate there are gated on the same one. A link whose
  // destination the operator's codes cannot open answers the admin's own
  // not-found page, which says nothing about permissions at all — so the
  // affordance moves with the route, or the tightening relocates the dead end
  // instead of closing it. `sales_channels`' `+ New channel` and `blog`'s
  // `New post` are the same shape.
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const location = useLocation();
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<ProductListCounts>({ all: 0, active: 0, inactive: 0, archived: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    productListTabFromUrl(location.pathname, location.search),
  );
  // The list follows the URL after its first load too: every navigation — the palette's
  // "Archived products" while the list is already open, a link to `?status=…`, Back —
  // has a new location key and re-reads the tab. A tab click does not navigate.
  useEffect(() => {
    setStatusFilter(productListTabFromUrl(location.pathname, location.search));
    setLegacyDraftView(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the navigation itself
  }, [location.key]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  // A saved view that held the removed `draft` status opens on All (owner P-2 → A);
  // said once, when it is applied, until the operator picks a tab or dismisses it.
  const [legacyDraftView, setLegacyDraftView] = useState(false);
  const chooseTab = (tab: StatusFilter): void => {
    setStatusFilter(tab);
    setLegacyDraftView(false);
  };
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [selection, setSelection] = useState<ProductListSelection>(emptySelection);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  // The Archived tab's bar Restore opens the dialog on its confirmation (owner P-4 → B).
  const [bulkInitialStep, setBulkInitialStep] = useState<'form' | 'confirmArchive'>('form');
  const [deleting, setDeleting] = useState(false);
  const [bulkEditProductIds, setBulkEditProductIds] = useState<string[]>([]);
  const editPriceReasonId = useId();
  // D3 — the names and SKUs of the selected rows on this page, so the dialog's result
  // names them without a lookup; a "select all N" selection's other rows are looked up there.
  const bulkEditLabels = useMemo(() => {
    const wanted = new Set(bulkEditProductIds);
    const labels: Record<string, ProductLabel> = {};
    for (const r of rows) if (wanted.has(r.id)) labels[r.id] = { name: r.name, sku: r.sku };
    return labels;
  }, [bulkEditProductIds, rows]);
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
      // Archived products are hidden by the list's default
      // (`archived=exclude`); only the Archived tab asks for them.
      const tabQuery = productListTabQuery(statusFilter);
      if (tabQuery.archived === 'only') params.set('archived', 'only');
      if (tabQuery.status) params.set('status', tabQuery.status);
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

  // Feature 147 (#289): a saved view stores status, type and search only — the
  // Stock chip is a client-side placeholder and Category / Channel do nothing
  // yet, so none of them is saved (FR-010).
  const toSavedViewState = (): SavedViewState => {
    const trimmed = query.trim();
    return {
      filters: {
        ...savedViewTabFilters(statusFilter),
        ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
        ...(trimmed ? { q: trimmed } : {}),
      },
    };
  };

  // A value the page no longer offers loads as *All*, and a key it never knew
  // is ignored (FR-012). The query skips the debounce so the list reloads
  // once, already on the view's search. Page and selection are reset here as
  // well as by the effects above: those fire only when a filter changes, and
  // in the same batch the first request already carries page 0 (FR-011).
  const applySavedView = (state: SavedViewState): void => {
    const f = state.filters;
    const q = typeof f['q'] === 'string' ? f['q'] : '';
    setStatusFilter(savedViewTab(f));
    setLegacyDraftView(f['status'] === 'draft');
    setTypeFilter(isTypeFilter(f['type']) ? f['type'] : 'all');
    setQuery(q);
    setDebouncedQuery(q);
    setStockFilter('all');
    setPage(0);
    setSelection(emptySelection());
    setSelectionError(null);
  };

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

  // The Archived tab's own empty copy is true only when nothing narrows it; a
  // filtered Archived tab gets the usual "try clearing filters".
  const filtersAtDefault = query.trim() === '' && typeFilter === 'all' && stockFilter === 'all';
  const restoreFromBar = canWrite && statusFilter === 'archived';
  const archivedEmpty = statusFilter === 'archived' && filtersAtDefault;
  // A search that finds nothing among live products may be looking for an archived
  // one, which every other tab hides; one step takes the query there.
  const searchArchivedHint =
    statusFilter !== 'archived' && debouncedQuery.trim() !== '' && stockFilter === 'all' && rows.length === 0;

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

  const openBulkEdit = async (step: 'form' | 'confirmArchive' = 'form'): Promise<void> => {
    setSelectionError(null);
    setResolvingSelection(true);
    try {
      const ids = await resolveSelectedIds();
      // Large selections are no longer rejected — above the backend's
      // async threshold they are delegated to a background bulk operation
      // (the dialog surfaces a "queued" acknowledgement). Only the
      // contract hard maximum is enforced client-side.
      if (ids.length > BULK_EDIT_HARD_MAX) {
        setSelectionError(
          t('productsList.selection.bulkEditHardLimit', {
            total: ids.length,
            maxBatchSize: BULK_EDIT_HARD_MAX,
          }),
        );
        return;
      }
      setBulkEditProductIds(ids);
      setBulkInitialStep(step);
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
          {canWrite ? (
            <button
              type="button"
              className="b2b-btn b2b-btn--primary"
              onClick={(): void => { navigate('/catalog/products/new'); }}
            >
              <Plus size={14} /> {t('productsList.action.newProduct')}
            </button>
          ) : null}
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
            <Tab id="all" label={t('productsList.tab.all')} count={counts.all} active={statusFilter} onChange={chooseTab} />
            <Tab id="active" label={t('productsList.tab.active')} count={counts.active} active={statusFilter} onChange={chooseTab} />
            <Tab id="inactive" label={t('productsList.tab.inactive')} count={counts.inactive} active={statusFilter} onChange={chooseTab} />
            <Tab id="archived" label={t('productsList.tab.archived')} count={counts.archived} active={statusFilter} onChange={chooseTab} />
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
          <div style={{ marginLeft: 'auto', minWidth: 0, maxWidth: '100%' }}>
            <SavedViewsControl
              endpoint="/api/v1/admin/catalog/products/list-views"
              current={toSavedViewState()}
              onApply={applySavedView}
              onError={setError}
            />
          </div>
        </div>

        {/* Mounted before it has text, so the note is announced when a view brings it. */}
        <div role="status">
          {legacyDraftView ? (
            <div
              className="b2b-help"
              data-testid="saved-view-draft-note"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderBottom: '1px solid var(--border, #e5e7eb)',
              }}
            >
              <span style={{ flex: 1 }}>{t('productsList.savedView.draftRemoved')}</span>
              <button
                type="button"
                className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                onClick={(): void => setLegacyDraftView(false)}
              >
                {t('productsList.savedView.dismiss')}
              </button>
            </div>
          ) : null}
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
              {/* On the Archived tab the one thing a selection is for is bringing it
                  back, so Restore leads as the primary and Bulk edit steps down (Von
                  Restorff); the placeholder Edit price goes, keeping three actions (Hick),
                  and Delete stays last (owner P-4 → B). */}
              {restoreFromBar ? (
                <button
                  type="button"
                  className="b2b-btn b2b-btn--primary"
                  disabled={resolvingSelection}
                  onClick={(): void => {
                    void openBulkEdit('confirmArchive');
                  }}
                >
                  <ArchiveRestore size={13} aria-hidden="true" /> {t('productsList.bulk.restore')}
                </button>
              ) : null}
              <button
                type="button"
                className={restoreFromBar ? 'b2b-btn' : 'b2b-btn b2b-btn--primary'}
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
              {statusFilter !== 'archived' ? (
                // D17 — no bulk price flow exists (prices are set in price books), so the
                // button is disabled and says why instead of doing nothing on click.
                <>
                  <button
                    type="button"
                    className="b2b-btn"
                    disabled
                    aria-describedby={editPriceReasonId}
                    title={t('productsList.bulk.editPriceUnavailable')}
                  >
                    <CircleDollarSign size={13} aria-hidden="true" /> {t('productsList.bulk.editPrice')}
                  </button>
                  <span id={editPriceReasonId} className="sr-only">
                    {t('productsList.bulk.editPriceUnavailable')}
                  </span>
                </>
              ) : null}
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
            productLabels={bulkEditLabels}
            selectionScope={selection.mode === 'collection' ? 'collection' : 'page'}
            // One archive action, the one that changes something: the Archived tab
            // holds only archived products, every other tab only products that are
            // not. On the Archived tab Restore lives on the bar (P-4 → B), so the
            // form opened by Bulk edit offers none.
            archiveAction={
              !canWrite
                ? null
                : statusFilter !== 'archived'
                  ? 'archive'
                  : bulkInitialStep === 'confirmArchive'
                    ? 'restore'
                    : null
            }
            initialStep={bulkInitialStep}
            onClose={(): void => {
              setBulkEditOpen(false);
              setBulkEditProductIds([]);
            }}
            onApplied={(): void => {
              // Refresh the list and drop the selection in the background, but
              // keep the dialog open: it now shows the queued-acknowledgement
              // ("sent to the queue, you'll be notified when it finishes") or
              // the synchronous summary. The user dismisses it via the dialog's
              // own Close / "View bulk actions" buttons.
              void refresh();
              clearSelection();
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
              <div className="b2b-empty__title">
                {archivedEmpty ? t('productsList.empty.archivedTitle') : t('productsList.empty.title')}
              </div>
              {/*
                The empty state's sentence is *"Try clearing filters, or use
                + New product to create one."* — half advice, half affordance.
                A read-only operator gets the advice and not the affordance:
                the sentence degrades to its own key rather than losing the
                button out of the middle of it, which would read as
                *"Try clearing filters, or use  to create one."*
              */}
              <div className="b2b-empty__sub">
                {archivedEmpty ? (
                  t('productsList.empty.archivedSub')
                ) : canWrite ? (
                  <>
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
                  </>
                ) : (
                  t('productsList.empty.readOnly')
                )}
              </div>
              {searchArchivedHint ? (
                <button
                  type="button"
                  className="b2b-btn b2b-btn--ghost"
                  style={{ marginTop: 8, color: 'var(--primary-color)' }}
                  onClick={(): void => chooseTab('archived')}
                >
                  {t('productsList.empty.searchArchived')}
                </button>
              ) : null}
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
                            {r.name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="b2b-mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {r.sku}
                      </span>
                    </td>
                    <td>
                      <span className="b2b-row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        <ProductStatusPill status={r.status} archived={Boolean(r.archivedAt)} />
                        {/* On the Archived tab every row is archived; the tab already says so. */}
                        {r.archivedAt && statusFilter !== 'archived' ? <ArchivedPill /> : null}
                      </span>
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

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default ProductsList;
