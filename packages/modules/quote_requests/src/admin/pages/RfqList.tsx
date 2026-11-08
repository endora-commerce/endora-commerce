import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Columns3, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { apiClient, ApiError, formatDateTime, normalize, useAuth, usePageSizePreference } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, Label, MultiSelect, PageHeader, Select, type MultiSelectOption } from '@endora-commerce/admin-kit/ui';
import {
  CustomFieldListFilters,
  customFieldDisplayName,
  customFieldFilterChips,
  customFieldFilterRefusal,
  emptyCustomFieldFilters,
  OrganizationPicker,
  PaginationFooter,
  pruneRemovedOptions,
  readCustomFieldFilterParams,
  ResponsiveTable,
  SavedViewsControl,
  sanitizeCustomFieldFilters,
  toCustomFieldFiltersParam,
  useCustomFieldListFilterFields,
  withCustomFieldFilter,
  writeCustomFieldFilterParams,
  type ResponsiveColumn,
  type SavedViewState,
} from '@endora-commerce/admin-kit/components';
import type { CustomFieldFilters } from '@endora-commerce/contracts';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
/**
 * Admin Quote Requests list (feature 008 / T042). Restructured to mirror the
 * Orders list view: a PageHeader above a toolbar Card (search + status filter
 * + sort + a collapsible advanced-filters panel + a column picker, with
 * removable applied-filter chips) and a ResponsiveTable with a paginated
 * footer. Order-only affordances that do not apply to a Quote Request — sales
 * channel / payment / delivery columns + filters, bulk status, invoice
 * printing, CSV export — are omitted. Visibility scope, organization and the
 * custom-field filters (feature 157) are server-side filters — the first two
 * bound what the caller may see, the third narrows it on the server, so the
 * list is re-read when any of them changes; search, status, sort, column
 * visibility, and pagination are applied client-side over the returned set.
 */

type RfqStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

const RFQ_STATUSES: readonly RfqStatus[] = [
  'Created from admin',
  'Pending',
  'Canceled',
  'Approved',
  'Completed',
  'Expired',
];

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
}

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

function formatTotal(r: AdminRfqRow): string {
  const total = rowTotal(r);
  if (total === null) return '—';
  return `${total.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${r.currency}`;
}

export function RfqList(): ReactNode {
  const t = useTranslation('core');
  const { language } = useTranslationContext();
  const { me } = useAuth();
  const { pageSize, setPageSize } = usePageSizePreference('quote-requests');
  const [searchParams, setSearchParams] = useSearchParams();

  // A platform admin sees every organization's requests, so the per-user "mine"
  // scope would show them nothing — default their Visibility filter to "all".
  const isPlatformAdmin = me?.role?.code === 'platform_admin';

  const [rows, setRows] = useState<AdminRfqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

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
  /** Numbers each list request, so a slower, older answer cannot land last. */
  const requestSequence = useRef(0);
  /**
   * The request last sent. StrictMode mounts effects twice in development, and
   * an unchanged request is not sent again.
   */
  const lastRequest = useRef<string | null>(null);

  /** The custom-field filters changed: a notice about the previous state is no longer news. */
  const changeCustomFieldFilters = useCallback((next: CustomFieldFilters): void => {
    setCustomFieldFilters(next);
    setDroppedCustomFields([]);
  }, []);

  // Client-side filters.
  const [statusCodes, setStatusCodes] = useState<string[]>(() => {
    const fromUrl = searchParams.get('status');
    return fromUrl !== null && RFQ_STATUSES.includes(fromUrl as RfqStatus) ? [fromUrl] : [];
  });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<string>(DEFAULT_SORT);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleColumnIds, setVisibleColumnIds] = useState<ColumnId[]>(DEFAULT_VISIBLE);

  const refresh = useCallback(async (): Promise<void> => {
    const params = new URLSearchParams();
    if (scope) params.set('assignmentScope', scope);
    if (organizationId) params.set('organizationId', organizationId);
    if (customFieldParam !== null) params.set('customFieldFilters', customFieldParam);
    const path =
      '/api/v1/admin/quote-requests' + (params.toString() ? `?${params.toString()}` : '');
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
    } catch (err) {
      if (current !== requestSequence.current) return;
      const refused = customFieldFilterRefusal(err);
      if (refused !== null) {
        setRows([]);
        setRefusedCustomField(refused);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.list.error.load'));
      }
    } finally {
      if (current === requestSequence.current) setLoading(false);
    }
  }, [scope, organizationId, customFieldParam, t]);

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

  // Reset to the first page whenever a filter narrows the result set.
  useEffect(() => {
    setPage(0);
  }, [scope, organizationId, customFieldParam, statusCodes, q, sort, pageSize]);

  // Apply the client-side filters + sort, then paginate.
  const filtered = useMemo(() => {
    const needle = normalize(q);
    const statusSet = new Set(statusCodes);
    let out = rows.filter((r) => {
      if (statusSet.size > 0 && !statusSet.has(r.status)) return false;
      if (needle) {
        const hay = [
          r.businessId ?? '',
          r.id,
          r.organizationName ?? '',
          r.customerDisplayName ?? '',
        ]
          .map(normalize)
          .join(' ');
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const [field, dir] = sort.split(':');
    const mul = dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (field === 'total') return ((rowTotal(a) ?? 0) - (rowTotal(b) ?? 0)) * mul;
      return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * mul;
    });
    return out;
  }, [rows, q, statusCodes, sort]);

  const total = filtered.length;
  const pageRows = useMemo(
    () => filtered.slice(page * pageSize, page * pageSize + pageSize),
    [filtered, page, pageSize],
  );

  const statusOptions: MultiSelectOption[] = RFQ_STATUSES.map((s) => ({ value: s, label: s }));
  const columnOptions: MultiSelectOption[] = COLUMN_IDS.map((id) => ({
    value: id,
    label: t(`rfq.list.column.${id}`),
  }));

  const advancedActiveCount =
    (scope !== 'mine' ? 1 : 0) + (organizationId ? 1 : 0) + Object.keys(customFieldFilters).length;

  type FilterChip = { key: string; label: string; onRemove: () => void; removeLabel?: string };
  const filterChips: FilterChip[] = [
    ...statusCodes.map((code) => ({
      key: `status:${code}`,
      label: `${t('rfq.list.field.status')}: ${code}`,
      onRemove: (): void => setStatusCodes((p) => p.filter((c) => c !== code)),
    })),
    ...(organizationId
      ? [
          {
            key: 'org',
            label: `${t('rfq.list.field.organizationId')}: ${
              rows.find((r) => r.organizationId === organizationId)?.organizationName ??
              organizationId.slice(0, 8)
            }`,
            onRemove: (): void => setOrganizationId(''),
          },
        ]
      : []),
    ...(scope !== 'mine'
      ? [
          {
            key: 'scope',
            label: `${t('rfq.list.field.visibility')}: ${t(`rfq.list.scope.${scope}`)}`,
            onRemove: (): void => setScope('mine'),
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
    setQ(typeof f['q'] === 'string' ? f['q'] : '');
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
    setPage(0);
  };

  const clearAllFilters = (): void => {
    setStatusCodes([]);
    setOrganizationId('');
    setScope('mine');
    setQ('');
    changeCustomFieldFilters(emptyCustomFieldFilters());
  };

  const removeRefusedCustomField = (): void => {
    if (refusedCustomField === null) return;
    changeCustomFieldFilters(withCustomFieldFilter(customFieldFilters, refusedCustomField, null));
    setRefusedCustomField(null);
    // Focus follows the operator to what they are waiting for: the results.
    resultsRef.current?.focus();
  };

  const columnDefs: Record<ColumnId, ResponsiveColumn<AdminRfqRow>> = {
    rfq: {
      id: 'rfq',
      header: t('rfq.list.column.rfq'),
      primary: true,
      render: (r) => (
        <Link to={`/quote-requests/${r.id}`} className="font-mono text-xs underline underline-offset-2">
          #{r.businessId ?? r.id.slice(0, 8)}
        </Link>
      ),
      meta: (r) => formatDateTime(r.updatedAt),
    },
    updated: {
      id: 'updated',
      header: t('rfq.list.column.updated'),
      render: (r) => formatDateTime(r.updatedAt),
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
          <Badge variant={STATUS_VARIANT[r.status] ?? 'default'}>{r.status}</Badge>
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

  return (
    <>
      <PageHeader
        title={t('rfq.list.title')}
        description={t('rfq.list.description')}
        actions={
          <Button asChild>
            <Link to="/quote-requests/new">
              <Plus />
              {t('rfq.list.create')}
            </Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {droppedCustomFields.length > 0 ? (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>
            {t('customFieldFilters.notice.dropped', {
              fields: droppedCustomFields
                .map((key) => customFieldDisplayName(customFieldFields.fields, key, language))
                .join(', '),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="rfqsearch"
                className="h-9 w-full rounded-md border pl-8 pr-3 text-sm"
                value={q}
                onChange={(e): void => setQ(e.target.value)}
                placeholder={t('rfq.list.search.placeholder')}
                aria-label={t('rfq.list.field.search')}
              />
            </div>
            <MultiSelect
              className="w-44"
              ariaLabel={t('rfq.list.field.status')}
              placeholder={t('rfq.list.field.status')}
              options={statusOptions}
              selected={statusCodes}
              onChange={setStatusCodes}
            />
            <Select
              id="rfqsort"
              aria-label={t('rfq.list.field.sort')}
              value={sort}
              onChange={(e): void => setSort(e.target.value)}
              className="w-auto"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </Select>
            <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={filtersOpen || advancedActiveCount > 0 ? 'default' : 'outline'}
                aria-expanded={filtersOpen}
                onClick={(): void => setFiltersOpen((o) => !o)}
              >
                <SlidersHorizontal />
                {t('rfq.list.filter.toggle')}
                {advancedActiveCount > 0 ? ` (${advancedActiveCount})` : ''}
              </Button>
              <MultiSelect
                className="w-40"
                ariaLabel={t('rfq.list.columns.label')}
                placeholder={t('rfq.list.columns.label')}
                icon={<Columns3 className="size-4 opacity-70" />}
                options={columnOptions}
                selected={visibleColumnIds}
                onChange={(next): void =>
                  setVisibleColumnIds(
                    next.filter((c): c is ColumnId => COLUMN_IDS.includes(c as ColumnId)),
                  )
                }
              />
              <SavedViewsControl
                endpoint="/api/v1/admin/quote-requests/list-views"
                current={toSavedViewState()}
                onApply={applySavedView}
                onError={setError}
              />
            </div>
          </div>

          {filterChips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {filterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  aria-label={chip.removeLabel}
                  onClick={chip.onRemove}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted"
                >
                  <span>{chip.label}</span>
                  <X className="size-3 opacity-70" />
                </button>
              ))}
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {t('rfq.list.filter.clearAll')}
              </button>
            </div>
          ) : null}

          {filtersOpen ? (
            <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-3 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="rfq-scope">{t('rfq.list.field.visibility')}</Label>
                <Select
                  id="rfq-scope"
                  value={scope}
                  onChange={(e): void => setScope(e.target.value as AssignmentScope)}
                >
                  <option value="mine">{t('rfq.list.scope.mine')}</option>
                  <option value="unassigned">{t('rfq.list.scope.unassigned')}</option>
                  <option value="all">{t('rfq.list.scope.all')}</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rfq-org">{t('rfq.list.field.organizationId')}</Label>
                <OrganizationPicker
                  id="rfq-org"
                  value={organizationId || null}
                  onChange={(v): void => setOrganizationId(v ?? '')}
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
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent ref={resultsRef} tabIndex={-1} className="pt-6 focus:outline-none" aria-busy={loading}>
          {/* Mounted before it has text, so a reload is announced (WCAG 4.1.3). */}
          <p role="status" className="sr-only">
            {loading ? t('rfq.list.loading') : ''}
          </p>
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
          ) : loading ? (
            <p className="text-sm text-muted-foreground">{t('rfq.list.loading')}</p>
          ) : total === 0 ? (
            <p className="text-sm text-muted-foreground">{t('rfq.list.empty')}</p>
          ) : (
            <ResponsiveTable
              data={pageRows}
              keyExtractor={(r) => r.id}
              columns={tableColumns}
              renderActions={(r) => (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link to={`/quote-requests/${r.id}`}>
                    {t('rfq.list.open')}
                    <ArrowRight />
                  </Link>
                </Button>
              )}
            />
          )}
          {refusedCustomField === null ? (
            <PaginationFooter
              page={page}
              pageSize={pageSize}
              total={total}
              onPageSizeChange={setPageSize}
              onPrev={(): void => setPage((p) => Math.max(0, p - 1))}
              onNext={(): void => setPage((p) => p + 1)}
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default RfqList;
