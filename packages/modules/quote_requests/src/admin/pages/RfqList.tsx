import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Columns3, FileText, Plus } from 'lucide-react';
import { apiClient, ApiError, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, EmptyState, Label, MultiSelect, Select, type MultiSelectOption } from '@endora-commerce/admin-kit/ui';
import {
  CustomFieldListFilters,
  customFieldDisplayName,
  customFieldFilterChips,
  customFieldFilterRefusal,
  emptyCustomFieldFilters,
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  OrganizationPicker,
  pruneRemovedOptions,
  readCustomFieldFilterParams,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  SavedViewsControl,
  sanitizeCustomFieldFilters,
  toCustomFieldFiltersParam,
  useCustomFieldListFilterFields,
  useListPagination,
  withCustomFieldFilter,
  writeCustomFieldFilterParams,
  type AppliedFilter,
  type ListPageLoad,
  type ResponsiveColumn,
  type SavedViewState,
} from '@endora-commerce/admin-kit/components';
import type { CustomFieldFilters } from '@endora-commerce/contracts';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { rfqStatusLabels } from '../lib/labels.js';
/**
 * Admin Quote Requests list (feature 008 / T042). The kit's `ListPage` with
 * the kit `ListToolbar`, as the Orders list (issue #1500, SALES-24): search +
 * status filter + sort, the long tail behind *More filters (n)*, a column
 * picker and saved views, removable applied-filter chips, and one results card
 * with the table, the two empty states and the pager. Order-only affordances that do not apply to a Quote Request — sales
 * channel / payment / delivery columns + filters, bulk status, invoice
 * printing, CSV export — are omitted. Every filter — visibility scope,
 * organization, status, search, the custom-field filters (feature 157) — the
 * sort and the page are applied by the server (issue #317): the list reads one
 * page and its total, and is re-read when any of them changes. Only column
 * visibility is the page's own.
 */

type RfqStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

const RFQ_STATUSES: readonly RfqStatus[] = rfqStatusLabels.values;

type AssignmentScope = 'mine' | 'unassigned' | 'all';

interface AdminRfqRow {
  id: string;
  businessId?: string;
  organizationId: string;
  organizationName?: string;
  customerAccountId: string;
  customerDisplayName?: string | null;
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  lineCount: number;
  /** Issue #456 — the one amount `quote_requests` publishes, two places; `null` without any price. */
  amount?: string | null;
  /** How far its lines are agreed. */
  agreement?: 'agreed' | 'partial' | 'none';
  currency: string;
  submittedAt: string | null;
  expiresAt: string | null;
  createdAt?: string;
  updatedAt: string;
  version: number;
}

interface AdminRfqListResponse {
  data: AdminRfqRow[];
  /** Issue #317 — the page the server read and how many requests match. */
  pagination?: { page: number; pageSize: number; total: number };
}

/** The largest page the list endpoint answers (`ADMIN_QUOTE_REQUEST_LIST_PAGE_SIZE_MAX`). */
const PAGE_SIZE_MAX = 200;
/** How long the search box waits for typing to settle before the list is re-read. */
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_VARIANT: Record<
  RfqStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  'Created from admin': 'warning',
  Pending: 'warning',
  Approved: 'success',
  Completed: 'default',
  Canceled: 'destructive',
  Expired: 'secondary',
};

// Pickable columns in display order. The actions column is structural and is
// always rendered, so it is not part of the picker.
const COLUMN_IDS = ['rfq', 'updated', 'org', 'customer', 'status', 'lines', 'total'] as const;
type ColumnId = (typeof COLUMN_IDS)[number];
const DEFAULT_VISIBLE: ColumnId[] = ['rfq', 'org', 'customer', 'status', 'lines', 'total'];

// The sort select's options, and the one allowlist a saved view's sort is
// checked against: a sort outside them loads as the first.
const SORT_OPTIONS = [
  { value: 'updatedAt:desc', labelKey: 'rfq.list.sort.newest' },
  { value: 'updatedAt:asc', labelKey: 'rfq.list.sort.oldest' },
  { value: 'total:desc', labelKey: 'rfq.list.sort.totalDesc' },
  { value: 'total:asc', labelKey: 'rfq.list.sort.totalAsc' },
] as const;
const SORT_VALUES: readonly string[] = SORT_OPTIONS.map((option) => option.value);
const DEFAULT_SORT = SORT_OPTIONS[0].value;

/** The endpoint naming the Quote Request custom fields this list offers as filters (feature 157). */
const CUSTOM_FIELD_FILTERS_ENDPOINT = '/api/v1/admin/quote-requests/custom-field-filters';

/**
 * A saved view's custom-field filters kept as saved, for when the offered
 * fields are not known (still loading, or failed): written to and read back
 * from the address form, which re-applies the key grammar, each filter's
 * schema and the caps — nothing more is judged until the fields are known.
 */
function savedCustomFieldFilters(saved: unknown): CustomFieldFilters {
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return emptyCustomFieldFilters();
  return readCustomFieldFilterParams(
    writeCustomFieldFilterParams(new URLSearchParams(), saved as CustomFieldFilters),
  );
}

/**
 * The amount the backend computed (issue #456): per line, the agreed price or
 * else the asked one. The list does not re-derive it from the two totals.
 */
function rowTotal(r: AdminRfqRow): number | null {
  if (r.amount === undefined || r.amount === null) return null;
  const amount = Number(r.amount);
  return Number.isFinite(amount) ? amount : null;
}

/** The number the operator reads a request by: its business ID, else the id's first eight characters. */
function rfqNumber(r: AdminRfqRow): string {
  return r.businessId ?? r.id.slice(0, 8);
}

function formatTotal(r: AdminRfqRow): string {
  const total = rowTotal(r);
  if (total === null) return '—';
  return `${total.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${r.currency}`;
}

export function RfqList(): ReactNode {
  const t = useTranslation('core');
  const { language } = useTranslationContext();
  const own = useTranslation('quote_requests');
  const { me } = useAuth();
  // Issue #1500 — the kit pager, fitted to what the endpoint serves.
  const pager = useListPagination({ scope: 'quote-requests', maxPageSize: PAGE_SIZE_MAX });
  const { resetPage, syncTotal } = pager;
  /** Prefix of the folded filters' ids, so each label names its control. */
  const filterId = useId();
  /** The search box, where focus goes once *Clear filters* empties the list's filters. */
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // A platform admin sees every organization's requests, so the per-user "mine"
  // scope would show them nothing — default their Visibility filter to "all".
  const isPlatformAdmin = me?.role?.code === 'platform_admin';

  const [rows, setRows] = useState<AdminRfqRow[]>([]);
  /** How many requests the filters match — the server's count, not the page's length. */
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Why the list could not be read — the list's own state, beside which *Retry* is offered. */
  const [error, setError] = useState<string | null>(null);
  /** A saved-views action that failed — a notice above the results. */
  const [notice, setNotice] = useState<string | null>(null);

  // Server-side filters (bound caller visibility / dataset size).
  const [scope, setScope] = useState<AssignmentScope>(() => {
    const fromUrl = searchParams.get('scope');
    if (fromUrl === 'all' || fromUrl === 'unassigned' || fromUrl === 'mine') return fromUrl;
    return isPlatformAdmin ? 'all' : 'mine';
  });
  const [organizationId, setOrganizationId] = useState<string>('');
  // Feature 157 — custom-field filters, applied by the server and deep-linkable
  // as `cf.<key>.<op>`.
  const customFieldFields = useCustomFieldListFilterFields(CUSTOM_FIELD_FILTERS_ENDPOINT);
  const [customFieldFilters, setCustomFieldFilters] = useState<CustomFieldFilters>(() =>
    readCustomFieldFilterParams(searchParams),
  );
  /** The key the server refused, until the operator removes it. */
  const [refusedCustomField, setRefusedCustomField] = useState<string | null>(null);
  /** The keys a loaded view carried that the list no longer offers. */
  const [droppedCustomFields, setDroppedCustomFields] = useState<string[]>([]);
  const customFieldParam = toCustomFieldFiltersParam(customFieldFilters);
  /** The results region, focused once a refused filter is removed. */
  const resultsRef = useRef<HTMLDivElement | null>(null);
  /** Set when a refused filter is removed: focus the results once they are back. */
  const focusResultsOnLoad = useRef(false);
  /** Numbers each list request, so a slower, older answer cannot land last. */
  const requestSequence = useRef(0);
  /**
   * The request last sent. StrictMode mounts effects twice in development, and
   * an unchanged request is not sent again.
   */
  const lastRequest = useRef<string | null>(null);

  /**
   * The custom-field filters changed: back to the first page in the same
   * update — so no request carries the new filters with the old page — and a
   * notice about the previous state is no longer news.
   */
  const changeCustomFieldFilters = useCallback((next: CustomFieldFilters): void => {
    setCustomFieldFilters(next);
    resetPage();
    setDroppedCustomFields([]);
  }, [resetPage]);

  const [statusCodes, setStatusCodes] = useState<string[]>(() => {
    const fromUrl = searchParams.get('status');
    return fromUrl !== null && RFQ_STATUSES.includes(fromUrl as RfqStatus) ? [fromUrl] : [];
  });
  /** What the search box shows, and the search the server was last asked for once typing settled. */
  const [q, setQ] = useState('');
  const [searchedQ, setSearchedQ] = useState('');
  const [sort, setSort] = useState<string>(DEFAULT_SORT);
  const [visibleColumnIds, setVisibleColumnIds] = useState<ColumnId[]>(DEFAULT_VISIBLE);

  // Each filter returns the list to its first page in the same update, so no
  // request pairs the new filter with the old page.
  const changeScope = (next: AssignmentScope): void => {
    setScope(next);
    resetPage();
  };
  const changeOrganization = (next: string): void => {
    setOrganizationId(next);
    resetPage();
  };
  const changeStatusCodes = (next: string[]): void => {
    setStatusCodes(next);
    resetPage();
  };
  const changeSort = (next: string): void => {
    setSort(next);
    resetPage();
  };

  // The search is sent once typing settles; a settled change is a new first page.
  useEffect(() => {
    const next = q.trim();
    if (next === searchedQ) return;
    const id = window.setTimeout(() => {
      setSearchedQ(next);
      resetPage();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [q, searchedQ, resetPage]);

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (scope) params.set('assignmentScope', scope);
    if (organizationId) params.set('organizationId', organizationId);
    if (statusCodes.length > 0) params.set('status', statusCodes.join(','));
    if (searchedQ) params.set('q', searchedQ);
    if (customFieldParam !== null) params.set('customFieldFilters', customFieldParam);
    params.set('sort', sort);
    params.set('page', String(pager.query.page));
    params.set('pageSize', String(pager.query.pageSize));
    return `/api/v1/admin/quote-requests?${params.toString()}`;
  }, [scope, organizationId, statusCodes, searchedQ, customFieldParam, sort, pager.query.page, pager.query.pageSize]);

  const refresh = useCallback(async (): Promise<void> => {
    const path = listPath;
    if (path === lastRequest.current) return;
    lastRequest.current = path;
    const current = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setRefusedCustomField(null);
    try {
      const res = await apiClient.get<AdminRfqListResponse>(path);
      if (current !== requestSequence.current) return;
      setRows(res.data);
      const matched = res.pagination?.total ?? res.data.length;
      setTotal(matched);
      syncTotal(matched);
    } catch (err) {
      if (current !== requestSequence.current) return;
      const refused = customFieldFilterRefusal(err);
      if (refused !== null) {
        setRows([]);
        setTotal(0);
        setRefusedCustomField(refused);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.list.error.load'));
      }
    } finally {
      if (current === requestSequence.current) setLoading(false);
    }
  }, [listPath, syncTotal, t]);

  /** *Retry* after a failed read: the same request again, past the unchanged-request guard. */
  const retry = (): void => {
    lastRequest.current = null;
    void refresh();
  };

  // Once the offered fields are known, options removed since a link was made
  // are dropped from it; an unknown key stays, for the server to refuse.
  useEffect(() => {
    if (customFieldFields.status !== 'ready') return;
    const pruned = pruneRemovedOptions(customFieldFilters, customFieldFields.fields);
    if (toCustomFieldFiltersParam(pruned) !== toCustomFieldFiltersParam(customFieldFilters)) {
      changeCustomFieldFilters(pruned);
    }
  }, [customFieldFields, customFieldFilters, changeCustomFieldFilters]);

  // The address follows the custom-field filters; every other parameter stays.
  useEffect(() => {
    setSearchParams(
      (current) => {
        const next = writeCustomFieldFilterParams(current, customFieldFilters);
        return next.toString() === current.toString() ? current : next;
      },
      { replace: true },
    );
  }, [customFieldFilters, setSearchParams]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading || !focusResultsOnLoad.current) return;
    focusResultsOnLoad.current = false;
    resultsRef.current?.focus();
  }, [loading]);

  const statusOptions: MultiSelectOption[] = rfqStatusLabels.options(t);
  const columnOptions: MultiSelectOption[] = COLUMN_IDS.map((id) => ({
    value: id,
    label: t(`rfq.list.column.${id}`),
  }));

  const advancedActiveCount =
    (scope !== 'mine' ? 1 : 0) + (organizationId ? 1 : 0) + Object.keys(customFieldFilters).length;

  const filterChips: AppliedFilter[] = [
    ...statusCodes.map((code) => ({
      key: `status:${code}`,
      label: `${t('rfq.list.field.status')}: ${rfqStatusLabels.label(t, code)}`,
      onRemove: (): void => changeStatusCodes(statusCodes.filter((c) => c !== code)),
    })),
    ...(organizationId
      ? [
          {
            key: 'org',
            label: `${t('rfq.list.field.organizationId')}: ${
              rows.find((r) => r.organizationId === organizationId)?.organizationName ??
              organizationId.slice(0, 8)
            }`,
            onRemove: (): void => changeOrganization(''),
          },
        ]
      : []),
    ...(scope !== 'mine'
      ? [
          {
            key: 'scope',
            label: `${t('rfq.list.field.visibility')}: ${t(`rfq.list.scope.${scope}`)}`,
            onRemove: (): void => changeScope('mine'),
          },
        ]
      : []),
    ...customFieldFilterChips(customFieldFields.fields, customFieldFilters, language, t).map((chip) => ({
      key: chip.id,
      label: chip.label,
      removeLabel: chip.removeLabel,
      onRemove: (): void => changeCustomFieldFilters(chip.remove()),
    })),
  ];

  // Feature 147 (#290): a saved view stores scope, organization, status,
  // search, sort and columns (FR-010) — the organization as an id only, so a
  // view never carries a name the loader could not resolve themselves (FR-017).
  const toSavedViewState = (): SavedViewState => {
    const trimmed = q.trim();
    const [field = 'updatedAt', dir] = sort.split(':');
    return {
      filters: {
        scope,
        ...(organizationId ? { organizationId } : {}),
        ...(statusCodes.length > 0 ? { status: statusCodes } : {}),
        ...(trimmed ? { q: trimmed } : {}),
        ...(Object.keys(customFieldFilters).length > 0 ? { customFields: { ...customFieldFilters } } : {}),
      },
      sort: { field, dir: dir === 'asc' ? 'asc' : 'desc' },
      visibleColumns: visibleColumnIds,
    };
  };

  // Loading replaces all six parts (FR-011); what the page no longer knows is
  // dropped and an absent scope is the viewer's own default (FR-012). The list
  // request that follows is the loader's, so `mine` means the loader and the
  // server narrows the rest (FR-016). The page is reset here as well as by the
  // effect above, which fires only when one of its inputs actually changes.
  const applySavedView = (state: SavedViewState): void => {
    const f = state.filters;
    const nextScope = f['scope'];
    setScope(
      nextScope === 'mine' || nextScope === 'unassigned' || nextScope === 'all'
        ? nextScope
        : isPlatformAdmin
          ? 'all'
          : 'mine',
    );
    setOrganizationId(typeof f['organizationId'] === 'string' ? f['organizationId'] : '');
    setStatusCodes(
      Array.isArray(f['status'])
        ? f['status'].filter((s): s is RfqStatus => RFQ_STATUSES.includes(s as RfqStatus))
        : [],
    );
    const savedQ = typeof f['q'] === 'string' ? f['q'] : '';
    setQ(savedQ);
    // Searched at once: a loaded view is one list request, not one now and one after the debounce.
    setSearchedQ(savedQ.trim());
    // FR-014: a saved custom-field filter the list no longer offers is dropped,
    // and the operator is told which — but only against fields that are known.
    // While they load, or after they failed to, the saved filters are kept as
    // saved, with no notice: nothing is known to be gone.
    if (customFieldFields.status === 'ready') {
      const { kept, dropped } = sanitizeCustomFieldFilters(f['customFields'], customFieldFields.fields);
      setCustomFieldFilters(kept);
      setDroppedCustomFields(dropped);
    } else {
      setCustomFieldFilters(savedCustomFieldFilters(f['customFields']));
      setDroppedCustomFields([]);
    }
    const nextSort = state.sort ? `${state.sort.field}:${state.sort.dir}` : '';
    setSort(SORT_VALUES.includes(nextSort) ? nextSort : DEFAULT_SORT);
    const columns = (state.visibleColumns ?? []).filter((c): c is ColumnId =>
      COLUMN_IDS.includes(c as ColumnId),
    );
    setVisibleColumnIds(columns.length > 0 ? columns : DEFAULT_VISIBLE);
    resetPage();
  };

  // The search narrows the list as much as a filter does, so *Clear all
  // filters* and the empty state's *Clear filters* empty it too.
  const filtersActive = filterChips.length > 0 || q.trim() !== '';
  /** Whether the rows on screen were read through a filter — what the empty state tells apart. */
  const resultsFiltered = filterChips.length > 0 || searchedQ !== '';
  const clearAllFilters = (): void => {
    setStatusCodes([]);
    setOrganizationId('');
    setScope('mine');
    setQ('');
    setSearchedQ('');
    changeCustomFieldFilters(emptyCustomFieldFilters());
  };

  const removeRefusedCustomField = (): void => {
    if (refusedCustomField === null) return;
    changeCustomFieldFilters(withCustomFieldFilter(customFieldFilters, refusedCustomField, null));
    setRefusedCustomField(null);
    // Focus follows the operator to what they are waiting for: the results,
    // once they are read again — the list page draws its skeleton meanwhile,
    // and the region it would have focused now is gone with it.
    focusResultsOnLoad.current = true;
  };

  const columnDefs: Record<ColumnId, ResponsiveColumn<AdminRfqRow>> = {
    rfq: {
      id: 'rfq',
      header: t('rfq.list.column.rfq'),
      primary: true,
      render: (r) => (
        <Link to={`/quote-requests/${r.id}`} className="font-mono text-xs underline underline-offset-2">
          #{rfqNumber(r)}
        </Link>
      ),
      meta: (r) => formatDateTime(r.updatedAt, language),
    },
    updated: {
      id: 'updated',
      header: t('rfq.list.column.updated'),
      render: (r) => formatDateTime(r.updatedAt, language),
    },
    org: {
      id: 'org',
      header: t('rfq.list.column.organization'),
      render: (r) => r.organizationName ?? r.organizationId.slice(0, 8),
    },
    customer: {
      id: 'customer',
      header: t('rfq.list.column.customer'),
      render: (r) => r.customerDisplayName ?? '—',
    },
    status: {
      id: 'status',
      header: t('rfq.list.column.status'),
      render: (r) => (
        <>
          <Badge variant={STATUS_VARIANT[r.status] ?? 'default'}>{rfqStatusLabels.label(t, r.status)}</Badge>
          {r.awaitingCustomerRevisionAcceptance ? (
            <Badge variant="warning" className="ml-1">
              {t('rfq.list.badge.awaitingCustomer')}
            </Badge>
          ) : null}
        </>
      ),
    },
    lines: {
      id: 'lines',
      header: t('rfq.list.column.lines'),
      hideOnMobile: true,
      render: (r) => r.lineCount,
    },
    total: {
      id: 'total',
      header: t('rfq.list.column.total'),
      render: (r) => (
        <>
          <span className="tabular-nums">{formatTotal(r)}</span>
          {rowTotal(r) !== null && r.agreement !== undefined && r.agreement !== 'agreed' ? (
            <Badge variant="outline" className="ml-2 font-normal">
              {t(r.agreement === 'partial' ? 'rfq.list.badge.partiallyAgreed' : 'rfq.list.badge.notYetAgreed')}
            </Badge>
          ) : null}
        </>
      ),
    },
  };

  const visibleSet = new Set(visibleColumnIds);
  const tableColumns: ResponsiveColumn<AdminRfqRow>[] = COLUMN_IDS.filter((id) =>
    visibleSet.has(id),
  ).map((id) => columnDefs[id]);

  const load: ListPageLoad = loading
    ? { kind: 'loading' }
    : error !== null
      ? { kind: 'error', message: error }
      : { kind: 'ready' };

  const create = (
    <Button asChild>
      <Link to="/quote-requests/new">
        <Plus aria-hidden="true" />
        {t('rfq.list.create')}
      </Link>
    </Button>
  );

  // The kit list page (issue #1500, SALES-24): the toolbar is a plain row, not
  // a card, and the results, the empty states and the pager share one card.
  return (
    <ListPage
      title={t('rfq.list.title')}
      actions={create}
      load={load}
      onRetry={retry}
      count={own('list.count', { count: total })}
      toolbar={
        <ListToolbar
          className="min-w-0 flex-1"
          label={own('list.toolbar.label')}
          search={
            <ListToolbarSearch
              ref={searchRef}
              label={t('rfq.list.field.search')}
              placeholder={t('rfq.list.search.placeholder')}
              value={q}
              onValueChange={setQ}
            />
          }
          filters={
            <>
              <MultiSelect
                className="w-44"
                ariaLabel={t('rfq.list.field.status')}
                placeholder={t('rfq.list.field.status')}
                options={statusOptions}
                selected={statusCodes}
                onChange={changeStatusCodes}
              />
              <Select
                aria-label={t('rfq.list.field.sort')}
                value={sort}
                onChange={(e): void => changeSort(e.target.value)}
                className="w-auto"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </Select>
            </>
          }
          actions={
            <>
              <MultiSelect
                className="w-40"
                ariaLabel={t('rfq.list.columns.label')}
                placeholder={t('rfq.list.columns.label')}
                icon={<Columns3 className="size-4 opacity-70" aria-hidden="true" />}
                options={columnOptions}
                selected={visibleColumnIds}
                onChange={(next): void =>
                  setVisibleColumnIds(next.filter((c): c is ColumnId => COLUMN_IDS.includes(c as ColumnId)))
                }
              />
              <SavedViewsControl
                endpoint="/api/v1/admin/quote-requests/list-views"
                current={toSavedViewState()}
                onApply={applySavedView}
                onError={setNotice}
              />
            </>
          }
          moreFiltersActiveCount={advancedActiveCount}
          moreFilters={
            <>
              <div className="space-y-1">
                <Label htmlFor={`${filterId}-scope`}>{t('rfq.list.field.visibility')}</Label>
                <Select
                  id={`${filterId}-scope`}
                  value={scope}
                  onChange={(e): void => changeScope(e.target.value as AssignmentScope)}
                >
                  <option value="mine">{t('rfq.list.scope.mine')}</option>
                  <option value="unassigned">{t('rfq.list.scope.unassigned')}</option>
                  <option value="all">{t('rfq.list.scope.all')}</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${filterId}-org`}>{t('rfq.list.field.organizationId')}</Label>
                <OrganizationPicker
                  id={`${filterId}-org`}
                  value={organizationId || null}
                  onChange={(v): void => changeOrganization(v ?? '')}
                />
              </div>
              <CustomFieldListFilters
                idPrefix="rfq"
                fields={customFieldFields.fields}
                value={customFieldFilters}
                language={language}
                status={customFieldFields.status}
                onRetry={customFieldFields.reload}
                onChange={(key, filter): void =>
                  changeCustomFieldFilters(withCustomFieldFilter(customFieldFilters, key, filter))
                }
              />
            </>
          }
          appliedFilters={filterChips}
          filtersActive={filtersActive}
          onClearFilters={clearAllFilters}
        />
      }
      notice={
        notice !== null || droppedCustomFields.length > 0 ? (
          <>
            {notice !== null ? (
              <Alert variant="destructive">
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
            {droppedCustomFields.length > 0 ? (
              <Alert variant="warning">
                <AlertDescription>
                  {t('customFieldFilters.notice.dropped', {
                    fields: droppedCustomFields
                      .map((key) => customFieldDisplayName(customFieldFields.fields, key, language))
                      .join(', '),
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null
      }
      pagination={refusedCustomField === null ? pager.footer(total) : null}
    >
      <div ref={resultsRef} tabIndex={-1} className="focus:outline-none">
        {refusedCustomField !== null ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                {t('customFieldFilters.error.unavailable', {
                  field: customFieldDisplayName(customFieldFields.fields, refusedCustomField, language),
                })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 sm:min-h-8"
                onClick={removeRefusedCustomField}
              >
                {t('customFieldFilters.error.remove')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <ResponsiveTable
            data={rows}
            keyExtractor={(r) => r.id}
            columns={tableColumns}
            emptyState={
              resultsFiltered ? (
                <EmptyState
                  variant="no-results"
                  title={t('rfq.list.empty')}
                  onClearFilters={clearAllFilters}
                  focusAfterClear={searchRef}
                />
              ) : (
                <EmptyState
                  icon={<FileText size={20} />}
                  title={own('list.emptyTitle')}
                  description={own('list.empty')}
                  action={create}
                />
              )
            }
            // The number is the way in; the menu holds where else a row leads.
            renderActions={(r) => (
              <RowActionMenu label={own('list.rowMenu.label', { number: rfqNumber(r) })}>
                <RowActionMenuItem asChild>
                  <Link to={`/organizations/${r.organizationId}`}>{own('list.rowMenu.organization')}</Link>
                </RowActionMenuItem>
              </RowActionMenu>
            )}
          />
        )}
      </div>
    </ListPage>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default RfqList;
