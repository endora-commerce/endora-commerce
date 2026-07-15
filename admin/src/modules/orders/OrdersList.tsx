import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Columns3,
  Download,
  ListChecks,
  Printer,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { orderStatusBadgeStyle } from './orderStatusColor';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ResponsiveTable';
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
  createdAt: string;
  salesChannelId: string;
  salesChannelName: string | null;
  deliveryMethodName: string | null;
  paymentMethodName: string | null;
  shipToName: string | null;
  billToName: string | null;
}
interface StatusDef {
  code: string;
  name: Record<string, string>;
  color: string;
}
interface MethodOption {
  id: string;
  code: string;
  name: Record<string, string>;
}
interface ListResponse {
  data: AdminOrderRow[];
  pagination: { page: number; pageSize: number; total: number };
  counts?: Record<string, number>;
}

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

// Pickable columns in display order. `select` (bulk checkbox) and the actions
// column are structural and always rendered, so they are not in the picker.
const COLUMN_IDS = [
  'order',
  'placedAt',
  'salesChannel',
  'customer',
  'org',
  'status',
  'payment',
  'paymentMethod',
  'deliveryMethod',
  'shipTo',
  'billTo',
  'total',
] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

// Default-visible set (the rest start hidden, toggled via the column picker).
const DEFAULT_VISIBLE: ColumnId[] = [
  'order',
  'placedAt',
  'salesChannel',
  'customer',
  'org',
  'status',
  'total',
];

function pickName(name: Record<string, string> | undefined | null): string {
  if (!name) return '';
  return name['en'] ?? name['en-US'] ?? Object.values(name)[0] ?? '';
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v) return [v];
  return [];
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const EMPTY_TEXT = { q: '', orgName: '', customerName: '', totalMin: '', totalMax: '' };

export function OrdersList(): ReactNode {
  const t = useTranslation('core');
  const { pageSize, setPageSize } = usePageSizePreference('orders');
  const [searchParams] = useSearchParams();

  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<StatusDef[]>([]);
  const [channels, setChannels] = useState<MethodOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<MethodOption[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<MethodOption[]>([]);
  const [page, setPage] = useState(0);

  // Filters.
  const [statusCodes, setStatusCodes] = useState<string[]>(() => searchParams.getAll('status'));
  const [salesChannelIds, setSalesChannelIds] = useState<string[]>([]);
  const [paymentMethodIds, setPaymentMethodIds] = useState<string[]>([]);
  const [deliveryMethodIds, setDeliveryMethodIds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [textFilters, setTextFilters] = useState(EMPTY_TEXT);
  const [debouncedText, setDebouncedText] = useState(EMPTY_TEXT);

  const [sort, setSort] = useState('placedAt:desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleColumnIds, setVisibleColumnIds] = useState<ColumnId[]>(DEFAULT_VISIBLE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Debounce the free-text / numeric filters.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedText(textFilters), 300);
    return () => window.clearTimeout(id);
  }, [textFilters]);

  useEffect(() => {
    // Coerce each list with `?? []` so a malformed/missing payload can never
    // leave the state `undefined` — the filter controls map over these arrays
    // on every render and would otherwise crash.
    void apiClient
      .get<{ data: { statuses: StatusDef[] } }>('/api/v1/admin/orders/statuses')
      .then((res) => setStatuses(res.data?.statuses ?? []))
      .catch(() => setStatuses([]));
    void apiClient
      .get<{ items: MethodOption[] }>('/api/v1/admin/sales-channels?pageSize=100')
      .then((res) => setChannels(res.items ?? []))
      .catch(() => setChannels([]));
    void apiClient
      .get<{ data: MethodOption[] }>('/api/v1/admin/payment-methods')
      .then((res) => setPaymentMethods(res.data ?? []))
      .catch(() => setPaymentMethods([]));
    void apiClient
      .get<{ data: MethodOption[] }>('/api/v1/admin/delivery-methods')
      .then((res) => setDeliveryMethods(res.data ?? []))
      .catch(() => setDeliveryMethods([]));
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page + 1));
    params.set('pageSize', String(Math.min(pageSize, 200)));
    params.set('sort', sort);
    for (const s of statusCodes) params.append('status', s);
    for (const id of salesChannelIds) params.append('salesChannelId', id);
    for (const id of paymentMethodIds) params.append('paymentMethodId', id);
    for (const id of deliveryMethodIds) params.append('deliveryMethodId', id);
    if (dateFrom) params.set('placedFrom', `${dateFrom}T00:00:00.000Z`);
    if (dateTo) params.set('placedTo', `${dateTo}T23:59:59.999Z`);
    const { q, orgName, customerName, totalMin, totalMax } = debouncedText;
    if (q.trim()) params.set('q', q.trim());
    if (orgName.trim()) params.set('orgName', orgName.trim());
    if (customerName.trim()) params.set('customerName', customerName.trim());
    if (totalMin.trim()) params.set('totalMin', totalMin.trim());
    if (totalMax.trim()) params.set('totalMax', totalMax.trim());
    return params.toString();
  }, [
    page,
    pageSize,
    sort,
    statusCodes,
    salesChannelIds,
    paymentMethodIds,
    deliveryMethodIds,
    dateFrom,
    dateTo,
    debouncedText,
  ]);

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
  }, [
    statusCodes,
    salesChannelIds,
    paymentMethodIds,
    deliveryMethodIds,
    dateFrom,
    dateTo,
    debouncedText,
    sort,
    pageSize,
  ]);

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
    const f = view.filters;
    setStatusCodes(asStringArray(f['status']));
    setSalesChannelIds(asStringArray(f['salesChannelId']));
    setPaymentMethodIds(asStringArray(f['paymentMethodId']));
    setDeliveryMethodIds(asStringArray(f['deliveryMethodId']));
    setDateFrom(asString(f['dateFrom']));
    setDateTo(asString(f['dateTo']));
    setTextFilters({
      q: asString(f['q']),
      orgName: asString(f['orgName']),
      customerName: asString(f['customerName']),
      totalMin: asString(f['totalMin']),
      totalMax: asString(f['totalMax']),
    });
    setSort(`${view.sort.field}:${view.sort.dir}`);
    if (view.visibleColumns && view.visibleColumns.length) {
      setVisibleColumnIds(view.visibleColumns.filter((c): c is ColumnId => COLUMN_IDS.includes(c as ColumnId)));
    } else {
      setVisibleColumnIds(DEFAULT_VISIBLE);
    }
  };

  const currentView: SavedViewState = {
    filters: {
      ...(statusCodes.length ? { status: statusCodes } : {}),
      ...(salesChannelIds.length ? { salesChannelId: salesChannelIds } : {}),
      ...(paymentMethodIds.length ? { paymentMethodId: paymentMethodIds } : {}),
      ...(deliveryMethodIds.length ? { deliveryMethodId: deliveryMethodIds } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(debouncedText.q ? { q: debouncedText.q } : {}),
      ...(debouncedText.orgName ? { orgName: debouncedText.orgName } : {}),
      ...(debouncedText.customerName ? { customerName: debouncedText.customerName } : {}),
      ...(debouncedText.totalMin ? { totalMin: debouncedText.totalMin } : {}),
      ...(debouncedText.totalMax ? { totalMax: debouncedText.totalMax } : {}),
    },
    sort: { field: sort.split(':')[0] ?? 'placedAt', dir: sort.endsWith(':asc') ? 'asc' : 'desc' },
    visibleColumns: visibleColumnIds,
  };

  const setText = (key: keyof typeof EMPTY_TEXT, value: string): void =>
    setTextFilters((prev) => ({ ...prev, [key]: value }));

  const methodOptions = (list: MethodOption[]): MultiSelectOption[] =>
    list.map((m) => ({ value: m.id, label: pickName(m.name) || m.code }));

  const statusOptions: MultiSelectOption[] = statuses.map((s) => ({
    value: s.code,
    label: `${statusLabel(s.code)}${counts[s.code] !== undefined ? ` (${counts[s.code]})` : ''}`,
  }));

  const columnOptions: MultiSelectOption[] = COLUMN_IDS.map((id) => ({
    value: id,
    label: t(`orders.column.${id}`),
  }));

  // Filters that live in the collapsible "advanced" panel — used to badge the
  // toggle and decide whether to auto-open it.
  const advancedActiveCount =
    paymentMethodIds.length +
    deliveryMethodIds.length +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (textFilters.orgName.trim() ? 1 : 0) +
    (textFilters.customerName.trim() ? 1 : 0) +
    (textFilters.totalMin.trim() ? 1 : 0) +
    (textFilters.totalMax.trim() ? 1 : 0);

  // Removable summary chips for every applied filter (search box excluded — it
  // is always visible). Operates on the live (un-debounced) text state so a
  // chip removal takes effect immediately.
  type FilterChip = { key: string; label: string; onRemove: () => void };
  const methodName = (list: MethodOption[], id: string): string =>
    pickName(list.find((m) => m.id === id)?.name) || id;
  const filterChips: FilterChip[] = [
    ...statusCodes.map((code) => ({
      key: `status:${code}`,
      label: `${t('orders.field.status')}: ${statusLabel(code)}`,
      onRemove: (): void => setStatusCodes((p) => p.filter((c) => c !== code)),
    })),
    ...salesChannelIds.map((id) => ({
      key: `ch:${id}`,
      label: `${t('orders.field.salesChannel')}: ${methodName(channels, id)}`,
      onRemove: (): void => setSalesChannelIds((p) => p.filter((x) => x !== id)),
    })),
    ...paymentMethodIds.map((id) => ({
      key: `pay:${id}`,
      label: `${t('orders.field.paymentMethod')}: ${methodName(paymentMethods, id)}`,
      onRemove: (): void => setPaymentMethodIds((p) => p.filter((x) => x !== id)),
    })),
    ...deliveryMethodIds.map((id) => ({
      key: `del:${id}`,
      label: `${t('orders.field.deliveryMethod')}: ${methodName(deliveryMethods, id)}`,
      onRemove: (): void => setDeliveryMethodIds((p) => p.filter((x) => x !== id)),
    })),
    ...(dateFrom
      ? [{ key: 'from', label: `${t('orders.field.dateFrom')}: ${dateFrom}`, onRemove: (): void => setDateFrom('') }]
      : []),
    ...(dateTo
      ? [{ key: 'to', label: `${t('orders.field.dateTo')}: ${dateTo}`, onRemove: (): void => setDateTo('') }]
      : []),
    ...(textFilters.orgName.trim()
      ? [{ key: 'org', label: `${t('orders.field.orgName')}: ${textFilters.orgName.trim()}`, onRemove: (): void => setText('orgName', '') }]
      : []),
    ...(textFilters.customerName.trim()
      ? [{ key: 'cust', label: `${t('orders.field.customerName')}: ${textFilters.customerName.trim()}`, onRemove: (): void => setText('customerName', '') }]
      : []),
    ...(textFilters.totalMin.trim()
      ? [{ key: 'tmin', label: `≥ ${textFilters.totalMin.trim()}`, onRemove: (): void => setText('totalMin', '') }]
      : []),
    ...(textFilters.totalMax.trim()
      ? [{ key: 'tmax', label: `≤ ${textFilters.totalMax.trim()}`, onRemove: (): void => setText('totalMax', '') }]
      : []),
  ];

  const clearAllFilters = (): void => {
    setStatusCodes([]);
    setSalesChannelIds([]);
    setPaymentMethodIds([]);
    setDeliveryMethodIds([]);
    setDateFrom('');
    setDateTo('');
    setTextFilters(EMPTY_TEXT);
  };

  // Build the visible columns in canonical order.
  const columnDefs: Record<ColumnId, ResponsiveColumn<AdminOrderRow>> = {
    order: {
      id: 'order',
      header: t('orders.column.order'),
      primary: true,
      render: (o) => (
        <Link to={`/orders/${o.id}`} className="font-mono text-xs underline underline-offset-2">
          #{o.businessId}
        </Link>
      ),
      meta: (o) => formatDateTime(o.placedAt),
    },
    placedAt: {
      id: 'placedAt',
      header: t('orders.column.placedAt'),
      render: (o) => formatDateTime(o.placedAt),
    },
    salesChannel: {
      id: 'salesChannel',
      header: t('orders.column.salesChannel'),
      render: (o) => o.salesChannelName ?? '—',
    },
    customer: {
      id: 'customer',
      header: t('orders.column.customer'),
      render: (o) => o.customerName ?? '—',
    },
    org: {
      id: 'org',
      header: t('orders.column.org'),
      render: (o) => o.organizationName ?? o.organizationId.slice(0, 8),
    },
    status: {
      id: 'status',
      header: t('orders.column.status'),
      render: (o) => (
        <Badge style={orderStatusBadgeStyle(statusColor(o.status))}>{statusLabel(o.status)}</Badge>
      ),
    },
    payment: {
      id: 'payment',
      header: t('orders.column.payment'),
      hideOnMobile: true,
      render: (o) => o.paymentStatus,
    },
    paymentMethod: {
      id: 'paymentMethod',
      header: t('orders.column.paymentMethod'),
      hideOnMobile: true,
      render: (o) => o.paymentMethodName ?? '—',
    },
    deliveryMethod: {
      id: 'deliveryMethod',
      header: t('orders.column.deliveryMethod'),
      render: (o) => o.deliveryMethodName ?? '—',
    },
    shipTo: {
      id: 'shipTo',
      header: t('orders.column.shipTo'),
      render: (o) => o.shipToName ?? '—',
    },
    billTo: {
      id: 'billTo',
      header: t('orders.column.billTo'),
      render: (o) => o.billToName ?? '—',
    },
    total: {
      id: 'total',
      header: t('orders.column.total'),
      render: (o) => (
        <span className="tabular-nums">
          {formatMoney(o.total, o.currency)}
        </span>
      ),
    },
  };

  const visibleSet = new Set(visibleColumnIds);
  const selectColumn: ResponsiveColumn<AdminOrderRow> = {
    id: 'select',
    header: (
      <input type="checkbox" aria-label="select-all" checked={allSelected} onChange={toggleAll} />
    ),
    render: (o) => (
      <input
        type="checkbox"
        aria-label={`select-${o.businessId}`}
        checked={selected.has(o.id)}
        onChange={(): void => toggleOne(o.id)}
      />
    ),
  };
  const tableColumns: ResponsiveColumn<AdminOrderRow>[] = [
    selectColumn,
    ...COLUMN_IDS.filter((id) => visibleSet.has(id)).map((id) => columnDefs[id]),
  ];

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
        <CardContent className="space-y-3 pt-6">
          {/* Primary toolbar: search + the two most-used filters + sort, with
              the saved-views / column-picker / advanced-filters controls
              grouped to the right. The long tail of filters moves into the
              collapsible "Filters" panel below to keep this bar uncluttered. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="osearch"
                className="h-9 w-full rounded-md border pl-8 pr-3 text-sm"
                value={textFilters.q}
                onChange={(e): void => setText('q', e.target.value)}
                placeholder={t('orders.search.placeholder')}
                aria-label={t('orders.field.search')}
              />
            </div>
            <MultiSelect
              className="w-44"
              ariaLabel={t('orders.field.status')}
              placeholder={t('orders.field.status')}
              options={statusOptions}
              selected={statusCodes}
              onChange={setStatusCodes}
            />
            <MultiSelect
              className="w-44"
              ariaLabel={t('orders.field.salesChannel')}
              placeholder={t('orders.field.salesChannel')}
              options={methodOptions(channels)}
              selected={salesChannelIds}
              onChange={setSalesChannelIds}
            />
            <Select
              id="osort"
              aria-label={t('orders.field.sort')}
              value={sort}
              onChange={(e): void => setSort(e.target.value)}
              className="w-auto"
            >
              <option value="placedAt:desc">{t('orders.sort.newest')}</option>
              <option value="placedAt:asc">{t('orders.sort.oldest')}</option>
              <option value="total:desc">{t('orders.sort.totalDesc')}</option>
              <option value="businessId:asc">{t('orders.sort.idAsc')}</option>
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
                {t('orders.filter.toggle')}
                {advancedActiveCount > 0 ? ` (${advancedActiveCount})` : ''}
              </Button>
              <MultiSelect
                className="w-40"
                ariaLabel={t('orders.columns.label')}
                placeholder={t('orders.columns.label')}
                icon={<Columns3 className="size-4 opacity-70" />}
                options={columnOptions}
                selected={visibleColumnIds}
                onChange={(next): void =>
                  setVisibleColumnIds(next.filter((c): c is ColumnId => COLUMN_IDS.includes(c as ColumnId)))
                }
              />
              <OrderSavedViews current={currentView} onLoad={applyView} onError={setError} />
            </div>
          </div>

          {/* Applied-filter chips — each removable, with a one-click clear-all. */}
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
                {t('orders.filter.clearAll')}
              </button>
            </div>
          ) : null}

          {/* Collapsible advanced filters. */}
          {filtersOpen ? (
            <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-3 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="opay">{t('orders.field.paymentMethod')}</Label>
                <MultiSelect
                  ariaLabel={t('orders.field.paymentMethod')}
                  placeholder={t('orders.filter.all')}
                  options={methodOptions(paymentMethods)}
                  selected={paymentMethodIds}
                  onChange={setPaymentMethodIds}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="odelivery">{t('orders.field.deliveryMethod')}</Label>
                <MultiSelect
                  ariaLabel={t('orders.field.deliveryMethod')}
                  placeholder={t('orders.filter.all')}
                  options={methodOptions(deliveryMethods)}
                  selected={deliveryMethodIds}
                  onChange={setDeliveryMethodIds}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="oorg">{t('orders.field.orgName')}</Label>
                <input
                  id="oorg"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                  value={textFilters.orgName}
                  onChange={(e): void => setText('orgName', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ocust">{t('orders.field.customerName')}</Label>
                <input
                  id="ocust"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                  value={textFilters.customerName}
                  onChange={(e): void => setText('customerName', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="odatefrom">{t('orders.field.dateFrom')}</Label>
                <input
                  id="odatefrom"
                  type="date"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                  value={dateFrom}
                  onChange={(e): void => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="odateto">{t('orders.field.dateTo')}</Label>
                <input
                  id="odateto"
                  type="date"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                  value={dateTo}
                  onChange={(e): void => setDateTo(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="otmin">{t('orders.field.totalMin')}</Label>
                <input
                  id="otmin"
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                  value={textFilters.totalMin}
                  onChange={(e): void => setText('totalMin', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="otmax">{t('orders.field.totalMax')}</Label>
                <input
                  id="otmax"
                  type="number"
                  min="0"
                  step="0.01"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                  value={textFilters.totalMax}
                  onChange={(e): void => setText('totalMax', e.target.value)}
                />
              </div>
            </div>
          ) : null}
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
              columns={tableColumns}
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
