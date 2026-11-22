import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, FileText, Mail } from 'lucide-react';
import { apiBaseUrl, apiClient, ApiError, formatDateTime, formatMoney, sendInvoiceEmailMessage } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, EmptyState, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  OrganizationPicker,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  useCursorPagination,
  useDebouncedValue,
  type AppliedFilter,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { InvoiceSectionTabs } from '../components/InvoiceSectionTabs.js';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  invoiceKindSchema,
  type AdminInvoiceListItem,
  type AdminInvoiceListResponse,
  type SendInvoiceEmailResult,
} from '@endora-commerce/contracts';
import { INVOICE_LIST_MAX_LIMIT, invoiceListPath, type InvoiceListFilters } from '../lib/invoice-list-path.js';

type AdminInvoice = AdminInvoiceListItem;

const STATUSES = ['pending', 'ready', 'cancelled'] as const;
/** Every kind the list can answer, an ERP `wz` included (issue #1120). */
const KINDS = invoiceKindSchema.options;

const STATUS_VARIANT: Record<AdminInvoice['status'], 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  pending: 'warning',
  ready: 'success',
  cancelled: 'destructive',
};

/**
 * The invoices list (feature 047; issue #1664, UX audit SALES-24). The kit
 * `ListPage`, as every other sales list: the toolbar as a plain row, one
 * results card, and the kit pager — in cursor mode, because the endpoint pages
 * by cursor and answers no total (#1120).
 */
export function InvoicesList(): ReactNode {
  const t = useTranslation('core');
  const ti = useTranslation('invoices');
  const filterId = useId();
  const pager = useCursorPagination({ scope: 'invoices', maxPageSize: INVOICE_LIST_MAX_LIMIT });
  const { resetPage, syncPage } = pager;
  /** The search box, where focus goes once *Clear filters* empties the list's filters. */
  const searchRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<AdminInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  /** Why the list could not be read — the list's own state, beside which *Retry* is offered. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** An action on a row that failed, or what it did — a notice above the results. */
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped by every request, so a page answering after a newer one was asked
  // for does not replace its rows.
  const generation = useRef(0);

  const [status, setStatus] = useState<InvoiceListFilters['status']>('');
  const [kind, setKind] = useState<InvoiceListFilters['kind']>('');
  const [orderNumber, setOrderNumber] = useState('');
  const [issuedFrom, setIssuedFrom] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [totalMin, setTotalMin] = useState('');
  const [totalMax, setTotalMax] = useState('');
  // `specs/182-related-payers/` RP-17 (e) — the Organization the invoices bill.
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  // The typed filters are debounced so typing does not refetch on every keystroke.
  const debouncedOrderNumber = useDebouncedValue(orderNumber.trim());
  const debouncedTotalMin = useDebouncedValue(totalMin.trim());
  const debouncedTotalMax = useDebouncedValue(totalMax.trim());

  /** Every filter change goes back to the first page, before the request that reads it. */
  const change =
    <T,>(set: (next: T) => void) =>
    (next: T): void => {
      set(next);
      resetPage();
    };

  const { cursor, limit } = pager.query;
  const refresh = useCallback(async (): Promise<void> => {
    const current = ++generation.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<AdminInvoiceListResponse>(
        invoiceListPath(
          {
            status,
            kind,
            orderNumber: debouncedOrderNumber,
            issuedFrom,
            issuedTo,
            totalMin: debouncedTotalMin,
            totalMax: debouncedTotalMax,
            organizationId,
          },
          cursor,
          limit,
        ),
      );
      if (current !== generation.current) return;
      setRows(res.data);
      syncPage(res.pagination, res.data.length);
    } catch (err) {
      if (current !== generation.current) return;
      setLoadError(err instanceof ApiError ? err.envelope.error.message : ti('list.error.load'));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [status, kind, debouncedOrderNumber, issuedFrom, issuedTo, debouncedTotalMin, debouncedTotalMax, organizationId, cursor, limit, syncPage, ti]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * `apiBaseUrl` and not `import.meta.env`: this file compiles under `tsc`
   * inside its own package, where Vite's client types are not in scope, and the
   * kit publishes the resolved value for exactly this (feature 091). The
   * fallback moves with it — this read defaulted to `''` while the `apiClient`
   * beside it has always defaulted to `http://localhost:3001`, so the download
   * href now points where the fetch that lists it already went.
   */
  const baseUrl = apiBaseUrl;

  const resendEmail = useCallback(
    async (invoiceId: string): Promise<void> => {
      setError(null);
      setNotice(null);
      try {
        const res = await apiClient.post<{ data: SendInvoiceEmailResult }>(
          `/api/v1/admin/invoices/${invoiceId}/send-email`,
          {},
        );
        // Issue #149 — the route has named the reason since #103; announcing
        // "sent" over an answer that says otherwise is the same defect the
        // issue route had, on the surface next door.
        const outcome = sendInvoiceEmailMessage(res.data, t);
        if (outcome.ok) setNotice(outcome.message);
        else setError(outcome.message);
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : ti('list.error.send'));
      }
    },
    [t, ti],
  );

  const clearAllFilters = (): void => {
    setStatus('');
    setKind('');
    setOrderNumber('');
    setIssuedFrom('');
    setIssuedTo('');
    setTotalMin('');
    setTotalMax('');
    setOrganizationId(null);
    resetPage();
  };

  // Removable summary chips for every applied filter. The search box is not
  // one: it is always visible, and *Clear all filters* empties it too.
  const chip = (key: string, label: string, value: string, clear: () => void): AppliedFilter[] =>
    value
      ? [
          {
            key,
            label: `${label}: ${value}`,
            onRemove: (): void => {
              clear();
              resetPage();
            },
          },
        ]
      : [];
  const filterChips: AppliedFilter[] = [
    ...chip('kind', t('invoices.fields.kind'), kind ? t(`invoices.kind.${kind}`) : '', () => setKind('')),
    ...chip('status', t('invoices.fields.status'), status ? t(`invoices.status.${status}`) : '', () => setStatus('')),
    ...chip('issuedFrom', t('invoices.fields.issuedFrom'), issuedFrom, () => setIssuedFrom('')),
    ...chip('issuedTo', t('invoices.fields.issuedTo'), issuedTo, () => setIssuedTo('')),
    ...chip('totalMin', t('invoices.fields.totalMin'), totalMin.trim(), () => setTotalMin('')),
    ...chip('totalMax', t('invoices.fields.totalMax'), totalMax.trim(), () => setTotalMax('')),
    ...(organizationId
      ? [
          {
            key: 'organization',
            label: t('invoices.filters.organization'),
            onRemove: (): void => {
              setOrganizationId(null);
              resetPage();
            },
          },
        ]
      : []),
  ];
  const advancedActiveCount = [issuedFrom, issuedTo, totalMin.trim(), totalMax.trim(), organizationId].filter(Boolean).length;
  const filtersActive = filterChips.length > 0 || orderNumber.trim() !== '';
  /** Whether the rows on screen were read through a filter — what the empty state tells apart. */
  const resultsFiltered =
    status !== '' ||
    kind !== '' ||
    issuedFrom !== '' ||
    issuedTo !== '' ||
    debouncedOrderNumber !== '' ||
    debouncedTotalMin !== '' ||
    debouncedTotalMax !== '' ||
    organizationId !== null;

  const columns: ResponsiveColumn<AdminInvoice>[] = [
    {
      id: 'number',
      header: t('invoices.columns.number'),
      primary: true,
      render: (i) => (
        <Link to={`/invoices/${i.id}`} className="font-medium underline underline-offset-2">
          {i.number}
        </Link>
      ),
      meta: (i) => formatDateTime(i.issuedAt),
    },
    { id: 'kind', header: t('invoices.columns.kind'), render: (i) => t(`invoices.kind.${i.kind}`) },
    {
      id: 'issued',
      header: t('invoices.columns.issued'),
      hideOnMobile: true,
      render: (i) => formatDateTime(i.issuedAt),
    },
    {
      id: 'order',
      header: t('invoices.columns.order'),
      render: (i) =>
        i.orderId === null ? (
          // An ERP-imported sale document may have no order.
          <span className="text-muted-foreground">—</span>
        ) : (
          <Link to={`/orders/${i.orderId}`} className="font-mono text-xs underline underline-offset-2">
            {i.orderBusinessId ?? i.orderId.slice(0, 8)}
          </Link>
        ),
    },
    {
      id: 'total',
      header: t('invoices.columns.total'),
      render: (i) => <span className="tabular-nums">{formatMoney(i.total, i.currency)}</span>,
    },
    {
      id: 'status',
      header: t('invoices.columns.status'),
      render: (i) => <Badge variant={STATUS_VARIANT[i.status]}>{t(`invoices.status.${i.status}`)}</Badge>,
    },
  ];

  const load: ListPageLoad = loading
    ? { kind: 'loading' }
    : loadError !== null
      ? { kind: 'error', message: loadError }
      : { kind: 'ready' };

  return (
    <ListPage
      title={t('invoices.title')}
      // The templates button is gone: it is a tab now.
      tabs={<InvoiceSectionTabs />}
      load={load}
      onRetry={(): void => void refresh()}
      toolbar={
        <ListToolbar
          className="min-w-0 flex-1"
          label={ti('list.toolbar.label')}
          search={
            <ListToolbarSearch
              ref={searchRef}
              label={t('invoices.fields.orderNumber')}
              placeholder={t('invoices.filters.orderNumberPlaceholder')}
              value={orderNumber}
              onValueChange={change(setOrderNumber)}
            />
          }
          filters={
            <>
              <Select
                aria-label={t('invoices.fields.kind')}
                className="w-auto"
                value={kind}
                onChange={(e): void => change(setKind)(e.target.value as InvoiceListFilters['kind'])}
              >
                <option value="">{ti('list.filter.allKinds')}</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`invoices.kind.${k}`)}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('invoices.fields.status')}
                className="w-auto"
                value={status}
                onChange={(e): void => change(setStatus)(e.target.value as InvoiceListFilters['status'])}
              >
                <option value="">{ti('list.filter.allStatuses')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`invoices.status.${s}`)}
                  </option>
                ))}
              </Select>
            </>
          }
          moreFiltersActiveCount={advancedActiveCount}
          moreFilters={
            <>
              <div className="space-y-1">
                <Label htmlFor={`${filterId}-organization`}>{t('invoices.filters.organization')}</Label>
                <OrganizationPicker
                  id={`${filterId}-organization`}
                  ariaLabel={t('invoices.filters.organization')}
                  value={organizationId}
                  onChange={change(setOrganizationId)}
                  clearable
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${filterId}-from`}>{t('invoices.fields.issuedFrom')}</Label>
                <Input
                  id={`${filterId}-from`}
                  type="date"
                  value={issuedFrom}
                  onChange={(e): void => change(setIssuedFrom)(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${filterId}-to`}>{t('invoices.fields.issuedTo')}</Label>
                <Input
                  id={`${filterId}-to`}
                  type="date"
                  value={issuedTo}
                  onChange={(e): void => change(setIssuedTo)(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${filterId}-tmin`}>{t('invoices.fields.totalMin')}</Label>
                <Input
                  id={`${filterId}-tmin`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={totalMin}
                  onChange={(e): void => change(setTotalMin)(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${filterId}-tmax`}>{t('invoices.fields.totalMax')}</Label>
                <Input
                  id={`${filterId}-tmax`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={totalMax}
                  onChange={(e): void => change(setTotalMax)(e.target.value)}
                />
              </div>
            </>
          }
          appliedFilters={filterChips}
          filtersActive={filtersActive}
          onClearFilters={clearAllFilters}
        />
      }
      notice={
        error || notice ? (
          <>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {notice ? (
              <Alert live="polite">
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null
      }
      pagination={pager.footer(rows.length)}
    >
      <ResponsiveTable
        data={rows}
        keyExtractor={(i) => i.id}
        columns={columns}
        // "No invoices yet" and "these filters match nothing" are two situations (#1448,
        // DS-15). Invoices are issued from orders, so the no-data state offers no create action.
        emptyState={
          resultsFiltered ? (
            <EmptyState
              variant="no-results"
              title={t('invoices.empty')}
              onClearFilters={clearAllFilters}
              focusAfterClear={searchRef}
            />
          ) : (
            <EmptyState
              icon={<FileText size={20} />}
              title={t('invoices.emptyState.title')}
              description={t('invoices.emptyState.body')}
            />
          )
        }
        // The number is the way in; the menu holds the document's own actions.
        renderActions={(i) => (
          <RowActionMenu label={ti('list.rowMenu.label', { number: i.number })}>
            {i.pdfReady ? (
              <RowActionMenuItem asChild>
                <a href={`${baseUrl}/api/v1/admin/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer">
                  <FileDown aria-hidden="true" />
                  {ti('list.rowMenu.pdf')}
                </a>
              </RowActionMenuItem>
            ) : (
              <RowActionMenuItem disabled>
                <FileDown aria-hidden="true" />
                {ti('list.rowMenu.pdfNotReady')}
              </RowActionMenuItem>
            )}
            <RowActionMenuItem onSelect={(): void => void resendEmail(i.id)}>
              <Mail aria-hidden="true" />
              {ti('list.rowMenu.resendEmail')}
            </RowActionMenuItem>
          </RowActionMenu>
        )}
      />
    </ListPage>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export is kept: it is
 * the spelling this module's own code and its tests use.
 */
export default InvoicesList;
