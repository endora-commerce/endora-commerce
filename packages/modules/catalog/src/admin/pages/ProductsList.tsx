import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArchiveRestore,
  Package,
  PenSquare,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { ProductsBulkEditDialog } from '../components/ProductsBulkEditDialog.js';
import type { ProductLabel } from '../lib/product-labels.js';
import { ArchivedPill, ProductStatusPill } from '../components/ProductStatusPills.js';
import {
  BULK_EDIT_HARD_MAX,
  productListNarrowing,
  productListTabFromUrl,
  productListTabQuery,
  resolveProductSelection,
  type ListFilterSnapshot,
  type ProductListStockFilter,
  type ProductListTab,
} from '../lib/resolve-product-selection.js';
import { pickLocalized } from '../lib/scope-overview.js';
import { ApiError, apiClient, formatDate, useAuth } from '@endora-commerce/admin-kit/lib';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import {
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  ResponsiveTable,
  SavedViewsControl,
  useConfirmDialog,
  useListPagination,
} from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  EmptyState,
  Select,
  TabPanel,
  Tabs,
  type TabItem,
} from '@endora-commerce/admin-kit/ui';
import type { ListPageLoad, ResponsiveColumn, SavedViewState } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  type: string;
  status: 'active' | 'inactive';
  /** Archived is its own fact, independent of `status`. */
  archivedAt?: string | null;
  /** The Global name (feature 174: one text per product, no per-language map). */
  name: string;
  visibility: string;
  attributeValues: Record<string, unknown>;
  updatedAt: string;
}

type StatusFilter = ProductListTab;

/** The status strip's tabs, in reading order. */
const STATUS_TABS: readonly StatusFilter[] = ['all', 'active', 'inactive', 'archived'];
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

const TYPE_OPTIONS: TypeFilter[] = ['all', 'simple', 'configurable', 'grouped', 'bundle', 'virtual'];
const STOCK_OPTIONS: readonly ProductListStockFilter[] = ['low', 'out'];

/** A category as `GET /admin/catalog/categories` lists it — the fields the filter reads. */
interface CategoryOptionSource {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  sortOrder: number;
}

/** A sales channel as `GET /admin/sales-channels` lists it. */
interface ChannelOptionSource {
  id: string;
  code: string;
  name: Record<string, string> | string;
}

/**
 * The category tree as one flat option list, each child under its parent and
 * indented by its depth (issue #1624), whatever order the API answers in. A
 * category whose parent is not in the list is shown as a root.
 */
export function categoryFilterOptions(
  categories: readonly CategoryOptionSource[],
  language: string,
): Array<{ id: string; label: string }> {
  const known = new Set(categories.map((c) => c.id));
  const childrenOf = new Map<string | null, CategoryOptionSource[]>();
  for (const c of categories) {
    const parent = c.parentCategoryId !== null && known.has(c.parentCategoryId) ? c.parentCategoryId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), c]);
  }
  const out: Array<{ id: string; label: string }> = [];
  const walk = (parent: string | null, depth: number): void => {
    const level = [...(childrenOf.get(parent) ?? [])].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        pickLocalized(a.name, language).localeCompare(pickLocalized(b.name, language), language),
    );
    for (const c of level) {
      out.push({ id: c.id, label: `${'\u2014 '.repeat(depth)}${pickLocalized(c.name, language)}` });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** An answer that is not a category list is no category list (the select is left out). */
function categorySources(value: unknown): CategoryOptionSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is CategoryOptionSource =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as CategoryOptionSource).id === 'string' &&
      'parentCategoryId' in c &&
      typeof (c as CategoryOptionSource).name === 'object',
  );
}

function channelSources(value: unknown): ChannelOptionSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is ChannelOptionSource =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as ChannelOptionSource).id === 'string' &&
      typeof (c as ChannelOptionSource).code === 'string',
  );
}

function channelOptionLabel(channel: ChannelOptionSource, language: string): string {
  const name = typeof channel.name === 'string' ? channel.name : pickLocalized(channel.name, language);
  return name || channel.code;
}

function isStockFilter(value: unknown): value is ProductListStockFilter {
  return value === 'all' || (typeof value === 'string' && (STOCK_OPTIONS as readonly string[]).includes(value));
}

/**
 * Products list (feature 008).
 *
 * Status-segmented tabs at the top mirror Shopify's catalog list. The
 * filter bar is the kit's `ListToolbar` (issue #1440, DS-06): a labelled
 * search box, a labelled Type select and the saved views. A bulk-action bar
 * appears when rows are selected. Table view only — the grid variant
 * was explicitly out of scope for this redesign.
 *
 * Issue #1455 (CAT-02) removed every control that looked live and was not,
 * among them the Category, Channel and Stock chips. Issue #1624 brings the three
 * back as real filters: labelled selects whose values the list endpoint applies
 * and "select all matching" resolves under, so a bulk action never reaches a
 * product the filtered list did not show. The Channel select appears only when
 * there is a choice to make; the Stock select only while the list says the
 * filter can be applied (`stockFilterAvailable` — false while the inventory
 * module is off).
 */
interface ProductsResponse {
  data: AdminProduct[];
  pagination: { page: number; pageSize: number; total: number };
  counts: ProductListCounts;
  /** Issue #1624 — whether a `stock` filter would be applied (false while inventory is off). */
  stockFilterAvailable?: boolean;
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
  return typeof value === 'string' && (TYPE_OPTIONS as readonly string[]).includes(value);
}

export function ProductsList(): ReactNode {
  const t = useTranslation('catalog');
  const { language } = useTranslationContext();
  const { confirm, confirmDialog } = useConfirmDialog();
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
  // Issue #1749 — a failed load is the list's state (the kit error with Retry);
  // a failed action on it (a bulk delete, a saved view) is a notice above the
  // rows, which stay.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The skeleton is for the first load only; a refresh over rows on screen is
  // `busy`, so the rows, the pager and the focus stay (ux-laws §6.1).
  const [loadedOnce, setLoadedOnce] = useState(false);
  const requestSeq = useRef(0);
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
  // Issue #1624 — `''` / `all` is no filter.
  const [categoryFilter, setCategoryFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<ProductListStockFilter>('all');
  const [stockFilterAvailable, setStockFilterAvailable] = useState(false);
  const [categories, setCategories] = useState<CategoryOptionSource[]>([]);
  const [channels, setChannels] = useState<ChannelOptionSource[]>([]);
  // A saved view that held the removed `draft` status opens on All (owner P-2 → A);
  // said once, when it is applied, until the operator picks a tab or dismisses it.
  const [legacyDraftView, setLegacyDraftView] = useState(false);
  const chooseTab = (tab: StatusFilter): void => {
    setStatusFilter(tab);
    setLegacyDraftView(false);
  };
  const [selection, setSelection] = useState<ProductListSelection>(emptySelection);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  // The Archived tab's bar Restore opens the dialog on its confirmation (owner P-4 → B).
  const [bulkInitialStep, setBulkInitialStep] = useState<'form' | 'confirmArchive'>('form');
  const [deleting, setDeleting] = useState(false);
  const [bulkEditProductIds, setBulkEditProductIds] = useState<string[]>([]);
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
  // The endpoint pages from zero and serves up to 500 rows (`listProducts`), so
  // the request takes the pager's zero-based `page`, not its one-based `query`.
  const pager = useListPagination({ scope: 'catalog-products', maxPageSize: 500 });
  const { page, pageSize, resetPage, syncTotal } = pager;

  // Debounce the text query so each keystroke doesn't fire a fetch. 250 ms
  // is fast enough to feel live and slow enough to coalesce typing bursts.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 250);
    return (): void => window.clearTimeout(id);
  }, [query]);

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
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
      for (const [key, value] of Object.entries(
        productListNarrowing({ categoryId: categoryFilter, salesChannelId: channelFilter, stock: stockFilter }),
      )) {
        params.set(key, value);
      }
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await apiClient.get<ProductsResponse>(
        `/api/v1/admin/catalog/products?${params.toString()}`,
      );
      // A slower answer to an older request does not overwrite a newer one.
      if (seq !== requestSeq.current) return;
      setRows(res.data);
      setTotal(res.pagination.total);
      setCounts(res.counts);
      setStockFilterAvailable(res.stockFilterAvailable === true);
      syncTotal(res.pagination.total);
      setLoadedOnce(true);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setLoadError(err instanceof ApiError ? err.envelope.error.message : t('productsList.error.load'));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [statusFilter, typeFilter, categoryFilter, channelFilter, stockFilter, debouncedQuery, page, pageSize, syncTotal, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Issue #1624 — the options of the Category and Channel filters, read once.
  // A list that cannot be read leaves its select out rather than empty.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const [categoryRes, channelRes] = await Promise.all([
        apiClient
          .get<{ data?: unknown }>('/api/v1/admin/catalog/categories')
          .catch((): { data?: unknown } => ({})),
        // The sales-channels list answers `{ items }`, not `{ data }`.
        apiClient
          .get<{ items?: unknown }>('/api/v1/admin/sales-channels')
          .catch((): { items?: unknown } => ({})),
      ]);
      if (cancelled) return;
      setCategories(categorySources(categoryRes?.data));
      setChannels(channelSources(channelRes?.items));
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  // A stock filter the list can no longer apply is dropped, not kept invisible.
  useEffect(() => {
    if (!loading && !stockFilterAvailable && stockFilter !== 'all') setStockFilter('all');
  }, [loading, stockFilterAvailable, stockFilter]);

  const categoryOptions = useMemo(() => categoryFilterOptions(categories, language), [categories, language]);

  // Reset to the first page whenever the result-shaping inputs change so
  // the user never lands on an out-of-range page. Page-size, status, type,
  // and the (debounced) text query all reshape the result set.
  // (A page-size change goes back to the first page inside the pager.)
  useEffect(() => {
    resetPage();
  }, [statusFilter, typeFilter, categoryFilter, channelFilter, stockFilter, debouncedQuery, resetPage]);

  // Feature 033 — changing filters invalidates collection-wide selection (FR-006).
  useEffect(() => {
    setSelection(emptySelection());
    setBulkEditOpen(false);
    setBulkEditProductIds([]);
    setSelectionError(null);
  }, [statusFilter, typeFilter, categoryFilter, channelFilter, stockFilter, debouncedQuery]);

  // Feature 147 (#289): a saved view stores the list's filters (FR-010) —
  // status, type and search, and since issue #1624 category, channel and stock.
  const toSavedViewState = (): SavedViewState => {
    const trimmed = query.trim();
    return {
      filters: {
        ...savedViewTabFilters(statusFilter),
        ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
        ...(trimmed ? { q: trimmed } : {}),
        ...productListNarrowing({ categoryId: categoryFilter, salesChannelId: channelFilter, stock: stockFilter }),
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
    setCategoryFilter(typeof f['categoryId'] === 'string' ? f['categoryId'] : '');
    setChannelFilter(typeof f['salesChannelId'] === 'string' ? f['salesChannelId'] : '');
    setStockFilter(isStockFilter(f['stock']) ? f['stock'] : 'all');
    setQuery(q);
    setDebouncedQuery(q);
    resetPage();
    setSelection(emptySelection());
    setSelectionError(null);
  };

  const filterSnapshot = useCallback(
    (): ListFilterSnapshot => ({
      status: statusFilter,
      type: typeFilter,
      q: debouncedQuery,
      categoryId: categoryFilter,
      salesChannelId: channelFilter,
      stock: stockFilter,
    }),
    [statusFilter, typeFilter, debouncedQuery, categoryFilter, channelFilter, stockFilter],
  );

  const filtered = rows;

  // Issue #1448 (DS-15): an empty list is either "nothing here yet" or "these
  // filters match nothing", and the two send the operator different ways. The
  // status strip is a set of tabs, not a filter: an empty tab says which status
  // it holds, and *Clear filters* resets the search and the type, never the tab.
  const filtersActive =
    debouncedQuery.trim() !== '' ||
    typeFilter !== 'all' ||
    categoryFilter !== '' ||
    channelFilter !== '' ||
    stockFilter !== 'all';
  const clearFilters = (): void => {
    setQuery('');
    setDebouncedQuery('');
    setTypeFilter('all');
    setCategoryFilter('');
    setChannelFilter('');
    setStockFilter('all');
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreFromBar = canWrite && statusFilter === 'archived';
  // No product at all: the empty state's *New product* is the view's one primary
  // action, and the header does not repeat it (Von Restorff).
  const catalogEmpty = !loading && !loadError && rows.length === 0 && !filtersActive && statusFilter === 'all';
  // A search that finds nothing among live products may be looking for an archived
  // one, which every other tab hides; one step takes the query there.
  const searchArchivedHint =
    statusFilter !== 'archived' && debouncedQuery.trim() !== '' && rows.length === 0;

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

  const handleBulkDelete = async (): Promise<void> => {
    if (deleting || selectedCount === 0) return;
    const ok = await confirm({
      message: t('productsList.bulk.deleteConfirm', { count: selectedCount }),
      confirmLabel: t('productsList.bulk.delete'),
      destructive: true,
    });
    if (!ok) return;

    setDeleting(true);
    setActionError(null);
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
        setActionError(failed.map((f) => f.message).join(' · '));
      } else {
        clearSelection();
      }
      await refresh();
    }).finally(() => {
      setDeleting(false);
    });
  };

  const newProductButton = (
    <Button type="button" onClick={(): void => { navigate('/catalog/products/new'); }}>
      <Plus aria-hidden="true" /> {t('productsList.action.newProduct')}
    </Button>
  );

  const emptyList = filtersActive ? (
    <EmptyState
      variant="no-results"
      title={t('productsList.empty.title')}
      description={
        // A search that finds nothing among live products may be looking for an
        // archived one; one step takes the query there.
        searchArchivedHint ? (
          <Button type="button" variant="link" className="h-auto p-0" onClick={(): void => chooseTab('archived')}>
            {t('productsList.empty.searchArchived')}
          </Button>
        ) : undefined
      }
      onClearFilters={clearFilters}
      focusAfterClear={searchRef}
    />
  ) : statusFilter === 'archived' ? (
    <EmptyState
      icon={<ArchiveRestore size={20} />}
      title={t('productsList.empty.archivedTitle')}
      description={t('productsList.empty.archivedSub')}
    />
  ) : statusFilter === 'active' || statusFilter === 'inactive' ? (
    <EmptyState
      icon={<Package size={20} />}
      title={statusFilter === 'active' ? t('productsList.empty.activeTitle') : t('productsList.empty.inactiveTitle')}
    />
  ) : (
    <EmptyState
      icon={<Package size={20} />}
      title={t('productsList.empty.noData.title')}
      description={canWrite ? t('productsList.empty.noData.body') : t('productsList.empty.noData.readOnly')}
      action={canWrite ? newProductButton : null}
    />
  );

  const pageCheckbox = (
    <Checkbox
      aria-label={t('productsList.selection.selectPage')}
      checked={allVisibleSelected}
      ref={(el): void => {
        if (el) el.indeterminate = someVisibleSelected;
      }}
      onChange={toggleAll}
    />
  );

  // The product's name is the way in (ListPage, issue #1749): a link, so the
  // keyboard reaches it too, where the clickable row before reached only a mouse.
  const columns: ResponsiveColumn<AdminProduct>[] = [
    {
      id: 'select',
      header: pageCheckbox,
      // Primary, so a phone's card keeps the row's checkbox beside the name.
      primary: true,
      className: 'w-8 pl-3.5',
      render: (r) => (
        <Checkbox
          aria-label={t('productsList.selection.selectRow', { name: r.name })}
          checked={isRowSelected(r.id)}
          onChange={(): void => toggleOne(r.id)}
        />
      ),
    },
    {
      id: 'product',
      header: t('productsList.column.product'),
      primary: true,
      render: (r) => (
        <div className="flex items-center gap-3">
          {/* A placeholder until the gallery's base image is listed: decorative, so
              one neutral tile rather than a colour per id that means nothing. */}
          <div
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
          >
            <Package size={16} />
          </div>
          <Link
            to={`/catalog/products/${r.id}`}
            className="min-w-0 max-w-90 truncate font-medium hover:underline focus-visible:underline"
          >
            {r.name}
          </Link>
        </div>
      ),
      meta: (r) => <span className="font-mono">{r.sku}</span>,
    },
    {
      id: 'sku',
      header: t('productsList.column.sku'),
      hideOnMobile: true,
      className: 'font-mono text-xs text-muted-foreground',
      render: (r) => r.sku,
    },
    {
      id: 'status',
      header: t('productsList.column.status'),
      render: (r) => (
        <span className="inline-flex flex-wrap gap-1">
          <ProductStatusPill status={r.status} archived={Boolean(r.archivedAt)} />
          {/* On the Archived tab every row is archived; the tab already says so. */}
          {r.archivedAt && statusFilter !== 'archived' ? <ArchivedPill /> : null}
        </span>
      ),
    },
    {
      id: 'type',
      header: t('productsList.column.type'),
      className: 'text-xs',
      render: (r) => t(`productEditor.type.${r.type}`),
    },
    {
      id: 'visibility',
      header: t('productsList.column.visibility'),
      hideOnMobile: true,
      className: 'text-xs text-muted-foreground',
      render: (r) => t(`productEditor.visibility.${r.visibility}`),
    },
    {
      id: 'updated',
      header: t('productsList.column.updated'),
      className: 'text-xs text-muted-foreground',
      render: (r) => relTime(r.updatedAt, t, language),
    },
  ];

  const load: ListPageLoad =
    loading && !loadedOnce
      ? { kind: 'loading' }
      : loadError !== null && !loading
        ? { kind: 'error', message: loadError }
        : { kind: 'ready' };

  // The kit list page (issue #1749, DS-05): the header with the one *New
  // product*, the status tabs, the toolbar as a plain row with the count at its
  // end, and one results card holding the bars, the table and the pager.
  return (
    <div className="b2b-page b2b-page--wide">
      <ListPage
        title={t('productsList.title')}
        actions={
          <>
            {/* CAT-02 — the dead Import / Export buttons became this place: the
                module that imports and exports contributes its own link, gated by
                its own presence and permission, so the list names no other module. */}
            <AdminZone name="product.list.actions" props={{}} />
            {canWrite && !catalogEmpty ? newProductButton : null}
          </>
        }
        tabs={
          <Tabs
            className="mb-4"
            items={STATUS_TABS.map((id): TabItem<StatusFilter> => ({
              value: id,
              label: t(`productsList.tab.${id}`),
              count: counts[id],
            }))}
            value={statusFilter}
            onValueChange={chooseTab}
            idBase="products-list"
            aria-label={t('productsList.tabs.label')}
          />
        }
        toolbar={
          <ListToolbar
            label={t('productsList.toolbar.label')}
            className="min-w-0 flex-1"
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('productsList.search.label')}
                placeholder={t('productsList.search.placeholder')}
                value={query}
                onValueChange={setQuery}
              />
            }
            filters={
              <>
                {/* Labelled selects, not chips that cycle through values on each
                    press: the operator sees every option and picks one (Jakob's Law). */}
                <Select
                  aria-label={t('productsList.filter.type')}
                  value={typeFilter === 'all' ? '' : typeFilter}
                  onChange={(e): void => setTypeFilter(isTypeFilter(e.target.value) ? e.target.value : 'all')}
                  className="w-auto"
                >
                  <option value="">{t('productsList.filter.typeAll')}</option>
                  {TYPE_OPTIONS.filter((type) => type !== 'all').map((type) => (
                    <option key={type} value={type}>
                      {t(`productEditor.type.${type}`)}
                    </option>
                  ))}
                </Select>
                {categoryOptions.length > 0 ? (
                  <Select
                    aria-label={t('productsList.filter.category')}
                    value={categoryFilter}
                    onChange={(e): void => setCategoryFilter(e.target.value)}
                    className="w-auto max-w-[16rem]"
                  >
                    <option value="">{t('productsList.filter.categoryAll')}</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                ) : null}
                {/* One channel is no choice (Hick's Law); a saved view's channel still shows. */}
                {channels.length > 1 || channelFilter !== '' ? (
                  <Select
                    aria-label={t('productsList.filter.channel')}
                    value={channelFilter}
                    onChange={(e): void => setChannelFilter(e.target.value)}
                    className="w-auto"
                  >
                    <option value="">{t('productsList.filter.channelAll')}</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {channelOptionLabel(c, language)}
                      </option>
                    ))}
                  </Select>
                ) : null}
                {stockFilterAvailable ? (
                  <Select
                    aria-label={t('productsList.filter.stock')}
                    value={stockFilter === 'all' ? '' : stockFilter}
                    onChange={(e): void => setStockFilter(isStockFilter(e.target.value) ? e.target.value : 'all')}
                    className="w-auto"
                  >
                    <option value="">{t('productsList.filter.stockAll')}</option>
                    <option value="low">{t('productsList.filter.stockLow')}</option>
                    <option value="out">{t('productsList.filter.stockOut')}</option>
                  </Select>
                ) : null}
              </>
            }
            actions={
              <SavedViewsControl
                endpoint="/api/v1/admin/catalog/products/list-views"
                current={toSavedViewState()}
                onApply={applySavedView}
                onError={setActionError}
              />
            }
          />
        }
        count={t('productsList.count', { count: total })}
        load={load}
        busy={loading}
        onRetry={(): void => void refresh()}
        notice={
          <>
            {actionError ? (
              <Alert variant="destructive">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            ) : null}

            {/* Mounted before it has text, so the note is announced when a view brings it. */}
            <div role="status">
              {legacyDraftView ? (
                <div
                  data-testid="saved-view-draft-note"
                  className="flex items-center gap-2 border-b border-border pb-2 text-xs text-muted-foreground"
                >
                  <span className="flex-1">{t('productsList.savedView.draftRemoved')}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={(): void => setLegacyDraftView(false)}>
                    {t('productsList.savedView.dismiss')}
                  </Button>
                </div>
              ) : null}
            </div>

            {showSelectAllBanner ? (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                {t('productsList.selection.allPageSelected', { pageCount: filtered.length })}{' '}
                <Button
                  type="button"
                  variant="link"
                  data-testid="select-all-matching"
                  className="h-auto p-0"
                  onClick={selectCollectionMode}
                >
                  {t('productsList.selection.selectAllMatching', { total })}
                </Button>
              </div>
            ) : null}

            {selectionError ? (
              <Alert variant="destructive">
                <AlertDescription>{selectionError}</AlertDescription>
              </Alert>
            ) : null}

            {/* The bulk bar is the results card's header row (the sales lists' pattern). */}
            {selectedCount > 0 ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-3 py-2 text-sm">
                {pageCheckbox}
                <span className="font-medium" data-testid="selection-summary">
                  {t('productsList.selection.selected', { count: selectedCount })}{' '}
                  {selection.mode === 'collection'
                    ? t('productsList.selection.scopeCollection')
                    : t('productsList.selection.scopePage')}
                </span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {/* On the Archived tab the one thing a selection is for is bringing it
                      back, so Restore leads as the primary and Bulk edit steps down (Von
                      Restorff), and Delete stays last (owner P-4 → B). */}
                  {restoreFromBar ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={resolvingSelection}
                      onClick={(): void => {
                        void openBulkEdit('confirmArchive');
                      }}
                    >
                      <ArchiveRestore aria-hidden="true" /> {t('productsList.bulk.restore')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant={restoreFromBar ? 'outline' : 'default'}
                    disabled={resolvingSelection}
                    aria-busy={resolvingSelection || undefined}
                    onClick={(): void => {
                      void openBulkEdit();
                    }}
                  >
                    <PenSquare aria-hidden="true" />{' '}
                    {resolvingSelection ? t('productsList.selection.resolving') : t('productsList.bulk.edit')}
                  </Button>
                  {/* Outline, in the destructive colour: it asks first, and a filled red button
                      would compete with the primary (Von Restorff). */}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={deleting || resolvingSelection}
                    aria-busy={deleting || undefined}
                    onClick={(): void => void handleBulkDelete()}
                  >
                    <Trash2 aria-hidden="true" /> {deleting ? '…' : t('productsList.bulk.delete')}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 max-lg:size-11"
                  aria-label={t('productsList.selection.clear')}
                  onClick={clearSelection}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </>
        }
        pagination={pager.footer(total)}
      >
        {/* Everything the strip selects is this panel's list (issue #1491). */}
        <TabPanel idBase="products-list" value={statusFilter}>
          <ResponsiveTable
            columns={columns}
            data={filtered}
            keyExtractor={(r) => r.id}
            isRowSelected={(r) => isRowSelected(r.id)}
            emptyState={emptyList}
          />
        </TabPanel>
      </ListPage>

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
      {confirmDialog}
    </div>
  );
}

/** The Updated cell, in the admin's language (issue #501: it was English in every language). */
function relTime(iso: string, t: ReturnType<typeof useTranslation>, language: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return t('productsList.updated.justNow');
  if (diff < 3600) return t('productsList.updated.minutesAgo', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('productsList.updated.hoursAgo', { count: Math.floor(diff / 3600) });
  // No plural rules in the catalogue: one day is its own word, and two to six
  // days take the same Polish form ("dni"), as on the dashboard's activity feed.
  if (diff < 86400 * 2) return t('productsList.updated.yesterday');
  if (diff < 86400 * 7) return t('productsList.updated.daysAgo', { count: Math.floor(diff / 86400) });
  return formatDate(iso, language);
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default ProductsList;
