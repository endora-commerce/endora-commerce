import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Download, ListChecks, Search, Settings, X } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { returnsClient } from './api/returns-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { PageHeader } from '@/components/ui/page-header';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ResponsiveTable';
import { PaginationFooter } from '@/components/PaginationFooter';
import { usePageSizePreference } from '@/lib/use-page-size-preference';
import { orderStatusBadgeStyle } from '@/modules/orders/orderStatusColor';
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { useTranslation } from '@/i18n/useTranslation';
import type { AdminReturnRow, ReturnStatusDto } from '@b2b/contracts';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:3001';

/** Resolve the admin-facing label for a status: default name → English → first → code. */
function statusName(s: ReturnStatusDto): string {
  return s.defaultName || s.name['en'] || Object.values(s.name)[0] || s.code;
}

/** Returns / RMA admin list (feature 046, US8). */
export function ReturnsList(): ReactNode {
  const t = useTranslation('core');
  const { pageSize, setPageSize } = usePageSizePreference('returns');

  const [rows, setRows] = useState<AdminReturnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<ReturnStatusDto[]>([]);
  const [page, setPage] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Filters.
  const [statusCodes, setStatusCodes] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState('');
  const [rma, setRma] = useState('');
  const [debouncedRma, setDebouncedRma] = useState('');
  const [sort, setSort] = useState('submittedAt:desc');

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Debounce the RMA free-text filter.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedRma(rma), 300);
    return () => window.clearTimeout(id);
  }, [rma]);

  // Load the configured status graph once for labels + badge colours.
  useEffect(() => {
    void returnsClient
      .statuses()
      .then((graph) => setStatuses(graph.statuses))
      .catch(() => setStatuses([]));
  }, []);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page + 1));
    p.set('pageSize', String(Math.min(pageSize, 200)));
    p.set('sort', sort);
    if (statusCodes.length) p.set('status', statusCodes.join(','));
    if (kindFilter) p.set('kind', kindFilter);
    if (debouncedRma.trim()) p.set('rmaNumber', debouncedRma.trim());
    return `?${p.toString()}`;
  }, [page, pageSize, sort, statusCodes, kindFilter, debouncedRma]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await returnsClient.list(queryString);
      setRows(res.rows);
      setTotal(res.total);
      setCounts(res.counts);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('returns.error.load'));
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
  }, [statusCodes, kindFilter, debouncedRma, sort, pageSize]);

  const statusLabel = useCallback(
    (code: string): string => {
      const s = statuses.find((x) => x.code === code);
      return s ? statusName(s) : code;
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

  const bulkAuthorize = useCallback(async (): Promise<void> => {
    setError(null);
    setInfo(null);
    try {
      const res = await returnsClient.bulkTransition([...selected], 'authorized');
      setInfo(t('returns.bulk.result', { authorized: res.moved.length, skipped: res.skipped.length }));
      setSelected(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('returns.error.bulk'));
    }
  }, [selected, refresh, t]);

  // Status filter options carry the live per-status counts from the list payload.
  const statusOptions: MultiSelectOption[] = statuses.map((s) => ({
    value: s.code,
    label: `${statusName(s)}${counts[s.code] !== undefined ? ` (${counts[s.code]})` : ''}`,
  }));

  // Removable summary chips for every applied filter (the search box is always
  // visible, so it gets a chip too — driven by the live state for instant removal).
  type FilterChip = { key: string; label: string; onRemove: () => void };
  const filterChips: FilterChip[] = [
    ...statusCodes.map((code) => ({
      key: `status:${code}`,
      label: `${t('returns.filter.status')}: ${statusLabel(code)}`,
      onRemove: (): void => setStatusCodes((prev) => prev.filter((c) => c !== code)),
    })),
    ...(kindFilter
      ? [
          {
            key: 'kind',
            label: `${t('returns.filter.kind')}: ${t(`returns.kind.${kindFilter}`)}`,
            onRemove: (): void => setKindFilter(''),
          },
        ]
      : []),
    ...(rma.trim()
      ? [{ key: 'rma', label: `${t('returns.filter.rmaNumber')}: ${rma.trim()}`, onRemove: (): void => setRma('') }]
      : []),
  ];

  const clearAllFilters = (): void => {
    setStatusCodes([]);
    setKindFilter('');
    setRma('');
  };

  const selectColumn: ResponsiveColumn<AdminReturnRow> = {
    id: 'select',
    header: (
      <input type="checkbox" aria-label="select-all" checked={allSelected} onChange={toggleAll} />
    ),
    render: (r) => (
      <input
        type="checkbox"
        aria-label={`select-${r.rmaNumber ?? r.id}`}
        checked={selected.has(r.id)}
        onChange={(): void => toggleOne(r.id)}
      />
    ),
  };

  const columns: ResponsiveColumn<AdminReturnRow>[] = [
    selectColumn,
    {
      id: 'rma',
      header: t('returns.col.rma'),
      primary: true,
      render: (r) => (
        <Link to={`/returns/${r.id}`} className="font-mono text-xs underline underline-offset-2">
          {r.rmaNumber ?? '—'}
        </Link>
      ),
      meta: (r) => formatDateTime(r.submittedAt),
    },
    {
      id: 'kind',
      header: t('returns.col.kind'),
      render: (r) => t(`returns.kind.${r.kind}`),
    },
    {
      id: 'status',
      header: t('returns.col.status'),
      render: (r) => (
        <Badge style={orderStatusBadgeStyle(statusColor(r.statusCode))}>
          {r.statusLabel || statusLabel(r.statusCode)}
        </Badge>
      ),
    },
    {
      id: 'refund',
      header: t('returns.col.refund'),
      render: (r) => (
        <span className="tabular-nums">
          {formatMoney(r.totalRefundAmount, r.currency)}
        </span>
      ),
    },
    {
      id: 'customer',
      header: t('returns.col.customer'),
      render: (r) => r.customerName ?? '—',
    },
    {
      id: 'org',
      header: t('returns.col.org'),
      hideOnMobile: true,
      render: (r) => r.organizationName ?? '—',
    },
    {
      id: 'submitted',
      header: t('returns.col.submitted'),
      hideOnMobile: true,
      render: (r) => formatDateTime(r.submittedAt),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('returns.title')}
        description={t('returns.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/returns/statuses">
                <Settings />
                {t('returns.nav.workflow')}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/returns/reasons">{t('returns.nav.reasons')}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/returns/delivery-methods">{t('returns.nav.returnMethods')}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`${API_BASE}/api/v1/admin/returns/export${queryString}`}>
                <Download />
                {t('returns.action.exportCsv')}
              </a>
            </Button>
          </div>
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
          {/* Primary toolbar: RMA search + status / kind filters + sort. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="rsearch"
                className="h-9 w-full rounded-md border pl-8 pr-3 text-sm"
                value={rma}
                onChange={(e): void => setRma(e.target.value)}
                placeholder={t('returns.search.placeholder')}
                aria-label={t('returns.filter.rmaNumber')}
              />
            </div>
            <MultiSelect
              className="w-44"
              ariaLabel={t('returns.filter.status')}
              placeholder={t('returns.filter.status')}
              options={statusOptions}
              selected={statusCodes}
              onChange={setStatusCodes}
            />
            <Select
              id="kind"
              aria-label={t('returns.filter.kind')}
              value={kindFilter}
              onChange={(e): void => setKindFilter(e.target.value)}
              className="w-auto"
            >
              <option value="">{t('returns.filter.kind')}</option>
              <option value="return">{t('returns.kind.return')}</option>
              <option value="complaint">{t('returns.kind.complaint')}</option>
            </Select>
            <Select
              id="rsort"
              aria-label={t('returns.field.sort')}
              value={sort}
              onChange={(e): void => setSort(e.target.value)}
              className="w-auto"
            >
              <option value="submittedAt:desc">{t('returns.sort.newest')}</option>
              <option value="submittedAt:asc">{t('returns.sort.oldest')}</option>
              <option value="rmaNumber:asc">{t('returns.sort.rmaAsc')}</option>
              <option value="rmaNumber:desc">{t('returns.sort.rmaDesc')}</option>
            </Select>
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
                {t('returns.filter.clearAll')}
              </button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <span className="text-sm text-muted-foreground">
              {t('returns.bulk.selected', { count: selected.size })}
            </span>
            <Button size="sm" onClick={(): void => void bulkAuthorize()}>
              <ListChecks />
              {t('returns.bulk.authorize', { count: selected.size })}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('returns.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('returns.empty')}</p>
          ) : (
            <ResponsiveTable
              data={rows}
              keyExtractor={(r) => r.id}
              columns={columns}
              renderActions={(r) => (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link to={`/returns/${r.id}`}>
                    {t('returns.action.open')}
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
