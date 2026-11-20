import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  productListTabFromUrl,
  productListTabQuery,
  resolveProductSelection,
  type ListFilterSnapshot,
  type ProductListTab,
} from '../lib/resolve-product-selection.js';
import { ApiError, apiClient, useAuth, usePageSizePreference } from '@endora-commerce/admin-kit/lib';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import {
  ListToolbar,
  ListToolbarSearch,
  PaginationFooter,
  SavedViewsControl,
  adminLanguageToLocale,
  useConfirmDialog,
} from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Checkbox,
  EmptyState,
  PageHeader,
  Select,
  TabPanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  type TabItem,
} from '@endora-commerce/admin-kit/ui';
import type { SavedViewState } from '@endora-commerce/admin-kit/components';
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

/**
 * Products list (feature 008).
 *
 * Status-segmented tabs at the top mirror Shopify's catalog list. The
 * filter bar is the kit's `ListToolbar` (issue #1440, DS-06): a labelled
 * search box, a labelled Type select and the saved views. A bulk-action bar
 * appears when rows are selected. Table view only — the grid variant
 * was explicitly out of scope for this redesign.
 *
 * Issue #1455 (CAT-02) removed every control that looked live and was not:
 * the Category and Channel chips (no handler — the list's selection resolver
 * cannot narrow by either yet), the Stock chip (it emptied the list whatever
 * was in stock — the list payload carries no stock; the Inventory list filters
 * by it), the always-disabled *Edit price*, and a per-row "more" icon that
 * opened nothing. A control that looks like the working ones must work like
 * them (Law of Similarity).
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

  // Feature 147 (#289): a saved view stores status, type and search — the
  // list's only filters (FR-010).
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

  const filtered = rows;

  // The Archived tab's own empty copy is true only when nothing narrows it; a
  // filtered Archived tab gets the usual "try clearing filters".
  const filtersAtDefault = query.trim() === '' && typeFilter === 'all';
  const restoreFromBar = canWrite && statusFilter === 'archived';
  const archivedEmpty = statusFilter === 'archived' && filtersAtDefault;
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
      <PageHeader
        title={t('productsList.title')}
        actions={
          <>
            {/* CAT-02 — the dead Import / Export buttons became this place: the
                module that imports and exports contributes its own link, gated by
                its own presence and permission, so the list names no other module. */}
            <AdminZone name="product.list.actions" props={{}} />
            {canWrite ? (
              <Button type="button" onClick={(): void => { navigate('/catalog/products/new'); }}>
                <Plus aria-hidden="true" /> {t('productsList.action.newProduct')}
              </Button>
            ) : null}
          </>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Issue #1492 (CAT-17): the kit card, buttons, table and checkboxes, so the list and the
          product editor it opens draw one radius, one button and one heading scale. */}
      <Card className="overflow-hidden">
        <div className="overflow-hidden px-3 pt-1">
          <Tabs
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
        </div>

        {/* Everything below the strip is the selected status's list (issue #1491). */}
        <TabPanel idBase="products-list" value={statusFilter}>
          <ListToolbar
            label={t('productsList.toolbar.label')}
            className="border-b border-border px-3 py-2.5"
            search={
              <ListToolbarSearch
                label={t('productsList.search.label')}
                placeholder={t('productsList.search.placeholder')}
                value={query}
                onValueChange={setQuery}
              />
            }
            filters={
              // A labelled select, not a chip that cycles through six values on
              // each press: the operator sees every type and picks one (Jakob's Law).
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
            }
            actions={
              <SavedViewsControl
                endpoint="/api/v1/admin/catalog/products/list-views"
                current={toSavedViewState()}
                onApply={applySavedView}
                onError={setError}
              />
            }
          />

          {/* Mounted before it has text, so the note is announced when a view brings it. */}
          <div role="status">
            {legacyDraftView ? (
              <div
                data-testid="saved-view-draft-note"
                className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
              >
                <span className="flex-1">{t('productsList.savedView.draftRemoved')}</span>
                <Button type="button" variant="ghost" size="sm" onClick={(): void => setLegacyDraftView(false)}>
                  {t('productsList.savedView.dismiss')}
                </Button>
              </div>
            ) : null}
          </div>

          {showSelectAllBanner ? (
            <div className="border-b border-border bg-muted px-3 py-2 text-sm">
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
            <Alert variant="destructive" className="mx-3 my-2 w-auto">
              <AlertDescription>{selectionError}</AlertDescription>
            </Alert>
          ) : null}

          {selectedCount > 0 ? (
            <div className="mx-3 my-2 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-3 py-2 text-sm">
              <Checkbox
                aria-label={t('productsList.selection.selectPage')}
                checked={allVisibleSelected}
                ref={(el): void => {
                  if (el) el.indeterminate = someVisibleSelected;
                }}
                onChange={toggleAll}
              />
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
                  {resolvingSelection
                    ? t('productsList.selection.resolving')
                    : t('productsList.bulk.edit')}
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

          {loading ? (
            <p role="status" className="p-8 text-sm text-muted-foreground">
              {t('productsList.loading')}
            </p>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Package size={20} />}
              title={archivedEmpty ? t('productsList.empty.archivedTitle') : t('productsList.empty.title')}
              description={
                /*
                  The empty state's sentence is *"Try clearing filters, or use
                  + New product to create one."* — half advice, half affordance.
                  A read-only operator gets the advice and not the affordance:
                  the sentence degrades to its own key rather than losing the
                  button out of the middle of it, which would read as
                  *"Try clearing filters, or use  to create one."*
                */
                archivedEmpty ? (
                  t('productsList.empty.archivedSub')
                ) : canWrite ? (
                  <>
                    {t('productsList.empty.prefix')}{' '}
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0"
                      onClick={(): void => { navigate('/catalog/products/new'); }}
                    >
                      {t('productsList.empty.button')}
                    </Button>{' '}
                    {t('productsList.empty.suffix')}
                  </>
                ) : (
                  t('productsList.empty.readOnly')
                )
              }
              action={
                searchArchivedHint ? (
                  <Button type="button" variant="outline" size="sm" onClick={(): void => chooseTab('archived')}>
                    {t('productsList.empty.searchArchived')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pl-3.5">
                    <Checkbox
                      aria-label={t('productsList.selection.selectPage')}
                      checked={allVisibleSelected}
                      ref={(el): void => {
                        if (el) el.indeterminate = someVisibleSelected;
                      }}
                      onChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>{t('productsList.column.product')}</TableHead>
                  <TableHead>{t('productsList.column.sku')}</TableHead>
                  <TableHead>{t('productsList.column.status')}</TableHead>
                  <TableHead>{t('productsList.column.type')}</TableHead>
                  <TableHead>{t('productsList.column.visibility')}</TableHead>
                  <TableHead>{t('productsList.column.updated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    data-state={isRowSelected(r.id) ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={(): void => { navigate(`/catalog/products/${r.id}`); }}
                  >
                    <TableCell className="pl-3.5" onClick={(e): void => e.stopPropagation()}>
                      <Checkbox
                        aria-label={t('productsList.selection.selectRow', { name: r.name })}
                        checked={isRowSelected(r.id)}
                        onChange={(): void => toggleOne(r.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {/* A placeholder until the gallery's base image is listed: decorative, so
                            one neutral tile rather than a colour per id that means nothing. */}
                        <div
                          aria-hidden="true"
                          className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
                        >
                          <Package size={16} />
                        </div>
                        <div className="min-w-0 max-w-90 truncate font-medium">{r.name}</div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.sku}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <ProductStatusPill status={r.status} archived={Boolean(r.archivedAt)} />
                        {/* On the Archived tab every row is archived; the tab already says so. */}
                        {r.archivedAt && statusFilter !== 'archived' ? <ArchivedPill /> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{t(`productEditor.type.${r.type}`)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t(`productEditor.visibility.${r.visibility}`)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {relTime(r.updatedAt, t, language)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            onPageSizeChange={setPageSize}
            onPrev={(): void => setPage((p) => Math.max(0, p - 1))}
            onNext={(): void => setPage((p) => p + 1)}
          />
        </TabPanel>
      </Card>
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
  return d.toLocaleDateString(adminLanguageToLocale(language), { month: 'short', day: 'numeric' });
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default ProductsList;
