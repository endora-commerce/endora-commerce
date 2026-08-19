import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Columns3, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { OrganizationPicker } from '@/components/organization-picker/OrganizationPicker';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ResponsiveTable';
import { PaginationFooter } from '@/components/PaginationFooter';
import { usePageSizePreference } from '@/lib/use-page-size-preference';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/i18n/useTranslation';
import { normalize } from '@/lib/text-normalization';

/**
 * Admin Quote Requests list (feature 008 / T042). Restructured to mirror the
 * Orders list view: a PageHeader above a toolbar Card (search + status filter
 * + sort + a collapsible advanced-filters panel + a column picker, with
 * removable applied-filter chips) and a ResponsiveTable with a paginated
 * footer. Order-only affordances that do not apply to a Quote Request — sales
 * channel / payment / delivery columns + filters, saved views, bulk status,
 * invoice printing, CSV export — are omitted. Visibility scope + organization
 * remain server-side filters (they bound what the caller may see); search,
 * status, sort, column visibility, and pagination are applied client-side over
 * the returned set.
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
  totalAtCustomerPrice: number | null;
  totalAtAgreedPrice: number | null;
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

function rowTotal(r: AdminRfqRow): number | null {
  return r.totalAtAgreedPrice ?? r.totalAtCustomerPrice;
}

function formatTotal(r: AdminRfqRow): string {
  const total = rowTotal(r);
  if (total === null) return '—';
  return `${total.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${r.currency}`;
}

export function RfqList(): ReactNode {
  const t = useTranslation('core');
  const { me } = useAuth();
  const { pageSize, setPageSize } = usePageSizePreference('quote-requests');
  const [searchParams] = useSearchParams();

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

  // Client-side filters.
  const [statusCodes, setStatusCodes] = useState<string[]>(() => {
    const fromUrl = searchParams.get('status');
    return fromUrl !== null && RFQ_STATUSES.includes(fromUrl as RfqStatus) ? [fromUrl] : [];
  });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('updatedAt:desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleColumnIds, setVisibleColumnIds] = useState<ColumnId[]>(DEFAULT_VISIBLE);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (scope) params.set('assignmentScope', scope);
      if (organizationId) params.set('organizationId', organizationId);
      const path =
        '/api/v1/admin/quote-requests' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<AdminRfqListResponse>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.list.error.load'));
    } finally {
      setLoading(false);
    }
  }, [scope, organizationId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset to the first page whenever a filter narrows the result set.
  useEffect(() => {
    setPage(0);
  }, [scope, organizationId, statusCodes, q, sort, pageSize]);

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

  const advancedActiveCount = (scope !== 'mine' ? 1 : 0) + (organizationId ? 1 : 0);

  type FilterChip = { key: string; label: string; onRemove: () => void };
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
  ];

  const clearAllFilters = (): void => {
    setStatusCodes([]);
    setOrganizationId('');
    setScope('mine');
    setQ('');
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
      render: (r) => <span className="tabular-nums">{formatTotal(r)}</span>,
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
              <option value="updatedAt:desc">{t('rfq.list.sort.newest')}</option>
              <option value="updatedAt:asc">{t('rfq.list.sort.oldest')}</option>
              <option value="total:desc">{t('rfq.list.sort.totalDesc')}</option>
            </Select>
            <div className="ml-auto flex items-center gap-2">
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
            </div>
          </div>

          {filterChips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {filterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
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
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
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
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            onPageSizeChange={setPageSize}
            onPrev={(): void => setPage((p) => Math.max(0, p - 1))}
            onNext={(): void => setPage((p) => p + 1)}
          />
        </CardContent>
      </Card>
    </>
  );
}
