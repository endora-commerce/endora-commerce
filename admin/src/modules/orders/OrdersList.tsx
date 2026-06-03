import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Download, ListChecks, Printer } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { orderStatusBadgeStyle } from './orderStatusColor';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ResponsiveTable } from '@/components/ResponsiveTable';
import { PaginationFooter } from '@/components/PaginationFooter';
import { usePageSizePreference } from '@/lib/use-page-size-preference';
import { useTranslation } from '@/i18n/useTranslation';
import { OrdersBulkStatusDialog } from './OrdersBulkStatusDialog';
import { OrderSavedViews, type SavedViewState } from './OrderSavedViews';

interface AdminOrderRow {
  id: string;
  businessId: string;
  customerName: string | null;
  organizationId: string;
  organizationName: string | null;
  status: string;
  statusName: Record<string, string>;
  paymentStatus: string;
  total: number;
  currency: string;
  placedAt: string;
}
interface StatusDef {
  code: string;
  name: Record<string, string>;
  color: string;
}
interface ListResponse {
  data: AdminOrderRow[];
  pagination: { page: number; pageSize: number; total: number };
  counts?: Record<string, number>;
}

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

export function OrdersList(): ReactNode {
  const t = useTranslation('core');
  const { pageSize, setPageSize } = usePageSizePreference('orders');

  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<StatusDef[]>([]);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState('placedAt:desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Debounce the free-text search.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    void apiClient
      .get<{ data: { statuses: StatusDef[] } }>('/api/v1/admin/orders/statuses')
      .then((res) => setStatuses(res.data.statuses))
      .catch(() => setStatuses([]));
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page + 1));
    params.set('pageSize', String(Math.min(pageSize, 200)));
    params.set('sort', sort);
    if (statusFilter) params.set('status', statusFilter);
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
    return params.toString();
  }, [page, pageSize, sort, statusFilter, debouncedQuery]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ListResponse>(`/api/v1/admin/orders?${queryString}`);
      setRows(res.data);
      setTotal(res.pagination.total);
      setCounts(res.counts ?? {});
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('orders.error.load'));
    } finally {
      setLoading(false);
    }
  }, [queryString, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset to the first page whenever a filter narrows the result set.
  useEffect(() => {
    setPage(0);
  }, [statusFilter, debouncedQuery, sort, pageSize]);

  const statusLabel = useCallback(
    (code: string): string => {
      const s = statuses.find((x) => x.code === code);
      return s?.name['en'] ?? Object.values(s?.name ?? {})[0] ?? code;
    },
    [statuses],
  );

  const statusColor = useCallback(
    (code: string): string => statuses.find((x) => x.code === code)?.color ?? '#64748b',
    [statuses],
  );

  const toggleOne = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = (): void => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const printInvoices = async (): Promise<void> => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/orders/bulk/print-invoices`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderIds: [...selected] }),
      });
      if (!res.ok) throw new Error('print failed');
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch {
      setError(t('orders.error.print'));
    }
  };

  const applyView = (view: SavedViewState): void => {
    setStatusFilter(typeof view.filters['status'] === 'string' ? (view.filters['status'] as string) : '');
    setQuery(typeof view.filters['q'] === 'string' ? (view.filters['q'] as string) : '');
    setSort(`${view.sort.field}:${view.sort.dir}`);
  };

  const currentView: SavedViewState = {
    filters: { ...(statusFilter ? { status: statusFilter } : {}), ...(debouncedQuery ? { q: debouncedQuery } : {}) },
    sort: { field: sort.split(':')[0] ?? 'placedAt', dir: sort.endsWith(':asc') ? 'asc' : 'desc' },
  };

  return (
    <>
      <PageHeader
        title={t('orders.page.title')}
        description={t('orders.page.description')}
        actions={
          <Button asChild variant="outline">
            <a href={`${API_BASE}/api/v1/admin/orders/export?${queryString}`}>
              <Download />
              {t('orders.action.exportCsv')}
            </a>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <Label htmlFor="osearch">{t('orders.field.search')}</Label>
            <input
              id="osearch"
              className="h-9 w-64 rounded-md border px-3 text-sm"
              value={query}
              onChange={(e): void => setQuery(e.target.value)}
              placeholder={t('orders.search.placeholder')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ostatus">{t('orders.field.status')}</Label>
            <Select id="ostatus" value={statusFilter} onChange={(e): void => setStatusFilter(e.target.value)}>
              <option value="">{t('orders.filter.all')}</option>
              {statuses.map((s) => (
                <option key={s.code} value={s.code}>
                  {statusLabel(s.code)}
                  {counts[s.code] !== undefined ? ` (${counts[s.code]})` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="osort">{t('orders.field.sort')}</Label>
            <Select id="osort" value={sort} onChange={(e): void => setSort(e.target.value)}>
              <option value="placedAt:desc">{t('orders.sort.newest')}</option>
              <option value="placedAt:asc">{t('orders.sort.oldest')}</option>
              <option value="total:desc">{t('orders.sort.totalDesc')}</option>
              <option value="businessId:asc">{t('orders.sort.idAsc')}</option>
            </Select>
          </div>
          <OrderSavedViews current={currentView} onLoad={applyView} onError={setError} />
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <span className="text-sm text-muted-foreground">
              {t('orders.bulk.selected', { count: selected.size })}
            </span>
            <Button size="sm" onClick={(): void => setBulkOpen(true)}>
              <ListChecks />
              {t('orders.bulk.changeStatus')}
            </Button>
            <Button size="sm" variant="outline" onClick={(): void => void printInvoices()}>
              <Printer />
              {t('orders.bulk.printInvoices')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('orders.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('orders.empty')}</p>
          ) : (
            <ResponsiveTable
              data={rows}
              keyExtractor={(o) => o.id}
              columns={[
                {
                  id: 'select',
                  header: (
                    <input
                      type="checkbox"
                      aria-label="select-all"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  ),
                  render: (o) => (
                    <input
                      type="checkbox"
                      aria-label={`select-${o.businessId}`}
                      checked={selected.has(o.id)}
                      onChange={(): void => toggleOne(o.id)}
                    />
                  ),
                },
                {
                  id: 'order',
                  header: t('orders.column.order'),
                  primary: true,
                  render: (o) => (
                    <Link to={`/orders/${o.id}`} className="font-mono text-xs underline underline-offset-2">
                      {o.businessId}
                    </Link>
                  ),
                  meta: (o) => formatDateTime(o.placedAt),
                },
                {
                  id: 'customer',
                  header: t('orders.column.customer'),
                  render: (o) => o.customerName ?? '—',
                },
                {
                  id: 'org',
                  header: t('orders.column.org'),
                  render: (o) => o.organizationName ?? o.organizationId.slice(0, 8),
                },
                {
                  id: 'status',
                  header: t('orders.column.status'),
                  render: (o) => (
                    <Badge style={orderStatusBadgeStyle(statusColor(o.status))}>
                      {statusLabel(o.status)}
                    </Badge>
                  ),
                },
                {
                  id: 'payment',
                  header: t('orders.column.payment'),
                  hideOnMobile: true,
                  render: (o) => o.paymentStatus,
                },
                {
                  id: 'total',
                  header: t('orders.column.total'),
                  render: (o) => (
                    <span className="tabular-nums">
                      {o.total.toFixed(2)} {o.currency}
                    </span>
                  ),
                },
              ]}
              renderActions={(o) => (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link to={`/orders/${o.id}`}>
                    {t('orders.open')}
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

      <OrdersBulkStatusDialog
        open={bulkOpen}
        orderIds={[...selected]}
        statuses={statuses}
        onClose={(): void => setBulkOpen(false)}
        onDone={(summary): void => {
          setBulkOpen(false);
          setInfo(t('orders.bulk.result', { changed: summary.changed, skipped: summary.skipped }));
          void refresh();
        }}
      />
    </>
  );
}
