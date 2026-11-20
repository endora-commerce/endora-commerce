import { useCallback, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileDown, Mail, RefreshCw } from 'lucide-react';
import type {
  InvoiceDetail as InvoiceDetailData,
  SendInvoiceEmailResult,
} from '@endora-commerce/contracts';
import { apiBaseUrl, apiClient, ApiError, cn, formatDateTime, formatMoney, sendInvoiceEmailMessage, useAuth, useDetailResource } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, DetailSkeleton, PageHeader, Section, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { DetailHeaderActions, RowActionMenuItem } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AdminZone } from '@endora-commerce/admin-kit/zones';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  pending: 'warning',
  ready: 'success',
  cancelled: 'destructive',
};

/** Single-invoice detail view: snapshot data, line items, VAT summary, PDF. */
export function InvoiceDetail(): ReactNode {
  const t = useTranslation('core');
  const { id = '' } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('invoices:write');
  const [error, setError] = useState<string | null>(null);
  // Issue #1499 (UX audit SALES-17, DEC-12 a) — "PDF regenerated" and "Invoice
  // sent" are said beside the header buttons, in a region mounted before it has
  // text, not as a success banner under the header.
  const { props: actionStatus, show: showStatus, clear: clearStatus } = useInlineStatus();
  const [busy, setBusy] = useState(false);

  /**
   * `apiBaseUrl` and not `import.meta.env`: this file compiles under `tsc`
   * inside its own package, where Vite's client types are not in scope, and the
   * kit publishes the resolved value for exactly this (feature 091). The
   * fallback moves with it — this read defaulted to `''` while the `apiClient`
   * beside it has always defaulted to `http://localhost:3001`, so the download
   * href now points where the fetch that lists it already went.
   */
  const baseUrl = apiBaseUrl;

  // Issue #1447 (DS-14, SALES-06) — a skeleton on the first load only; the
  // re-read after Regenerate keeps the invoice on screen, marked `aria-busy`.
  const resource = useDetailResource<InvoiceDetailData>(id, async () => {
    try {
      const res = await apiClient.get<{ data: InvoiceDetailData }>(`/api/v1/admin/invoices/${id}`);
      return res.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  });
  const invoice = resource.data;
  const reread = resource.refresh;
  // A re-read clears the previous action's error, as the old full reload did.
  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    await reread();
  }, [reread]);
  const loadError =
    resource.error === null
      ? null
      : resource.error instanceof ApiError
        ? resource.error.envelope.error.message
        : t('invoiceDetail.error.load');

  const regenerate = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    clearStatus();
    try {
      await apiClient.post(`/api/v1/admin/invoices/${id}/regenerate-pdf`, {});
      showStatus(t('invoiceDetail.regenerated'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('invoiceDetail.regenerateError'));
    } finally {
      setBusy(false);
    }
  }, [id, refresh, t, showStatus, clearStatus]);

  const resendEmail = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    clearStatus();
    try {
      const res = await apiClient.post<{ data: SendInvoiceEmailResult }>(
        `/api/v1/admin/invoices/${id}/send-email`,
        {},
      );
      // Issue #149 — the same answer the list surface now reads: a send that
      // was suppressed says so instead of being confirmed.
      const outcome = sendInvoiceEmailMessage(res.data, t);
      if (outcome.ok) showStatus(outcome.message);
      else setError(outcome.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('invoiceDetail.error.load'));
    } finally {
      setBusy(false);
    }
  }, [id, t, showStatus, clearStatus]);

  if (resource.initialLoading) return <DetailSkeleton />;
  if (!invoice)
    return loadError !== null ? (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          {loadError}
          <Button variant="outline" size="sm" onClick={(): void => void refresh()}>
            {t('common.action.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      <Alert variant="warning">
        <AlertDescription>{t('invoiceDetail.notFound')}</AlertDescription>
      </Alert>
    );

  const money = (n: number): string => formatMoney(n, invoice.currency);
  // The unit net price carries up to four places (owner ruling of 2026-10-25).
  const unitMoney = (n: number): string => formatMoney(n, invoice.currency, undefined, { unitPrice: true });
  // A pending invoice's next step is its PDF (the banner below asks for it).
  const regenerateIsPrimary = canWrite && invoice.status === 'pending';

  return (
    <>
      <PageHeader
        back={{ label: t('invoiceDetail.back'), to: '/invoices' }}
        title={
          <>
            {t('invoiceDetail.title', { number: invoice.number })}
            <Badge className="text-xs font-medium" variant={STATUS_VARIANT[invoice.status] ?? 'secondary'}>
              {t(`invoices.status.${invoice.status}`)}
            </Badge>
          </>
        }
        actions={
          // Issue #1547 (DS-07, the point #1683 left open) — one primary per
          // view: the invoice's next step is filled, the rest are in "More".
          // A ready invoice is there to be downloaded; a pending one needs its
          // PDF regenerated first (the "not ready" banner says so).
          <DetailHeaderActions
            status={actionStatus}
            moreBusy={busy}
            primary={
              invoice.status === 'ready' ? (
                <Button asChild>
                  <a href={`${baseUrl}/api/v1/admin/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
                    <FileDown aria-hidden="true" />
                    {t('invoiceDetail.action.downloadPdf')}
                  </a>
                </Button>
              ) : regenerateIsPrimary ? (
                <Button disabled={busy} aria-busy={busy} onClick={(): void => void regenerate()}>
                  <RefreshCw aria-hidden="true" />
                  {t('invoiceDetail.action.regeneratePdf')}
                </Button>
              ) : null
            }
          >
            {canWrite && !regenerateIsPrimary ? (
              <RowActionMenuItem onSelect={(): void => void regenerate()}>
                <RefreshCw aria-hidden="true" />
                {t('invoiceDetail.action.regeneratePdf')}
              </RowActionMenuItem>
            ) : null}
            {canWrite ? (
              <RowActionMenuItem onSelect={(): void => void resendEmail()}>
                <Mail aria-hidden="true" />
                {t('invoiceDetail.action.resendEmail')}
              </RowActionMenuItem>
            ) : null}
          </DetailHeaderActions>
        }
      />

      {/* At most one banner above the content (#1499): the error first, then
          the standing "PDF not ready" state. */}
      {(error ?? loadError) ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error ?? loadError}</AlertDescription>
        </Alert>
      ) : invoice.status !== 'ready' ? (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>{t('invoiceDetail.pdfNotReady')}</AlertDescription>
        </Alert>
      ) : null}

      {/*
        Issue #1547 (UX audit SALES-25) — one document, one card (Common
        Region): the parties and details under section headings, then the
        lines, with the VAT summary and the totals as the table's footer, as
        the order detail does.
      */}
      <div {...resource.busyProps}>
        <Card>
          <CardContent className="space-y-6">
            <div className="grid gap-6 md:grid-cols-3">
              <Section title={t('invoiceDetail.section.details')}>
                <dl className="space-y-1 text-sm">
                  <Row label={t('invoiceDetail.field.kind')} value={t(`invoices.kind.${invoice.kind}`)} />
                  <Row label={t('invoiceDetail.field.issuedAt')} value={formatDateTime(invoice.issuedAt)} />
                  <Row label={t('invoiceDetail.field.saleDate')} value={invoice.saleDate ?? '—'} />
                  <Row label={t('invoiceDetail.field.paymentDueDate')} value={invoice.paymentDueDate ?? '—'} />
                  <Row label={t('invoiceDetail.field.paymentMethod')} value={invoice.paymentMethod ?? '—'} />
                  {/*
                    The invoice's KSeF number is this module's own statutory data,
                    whichever path recorded it (`specs/134-paid-module-extraction/`
                    T137, D22 §3(a)); the KSeF module's zone below may show it again.
                  */}
                  {invoice.ksefReferenceNumber ? (
                    <Row
                      label={t('invoiceDetail.field.ksefNumber')}
                      value={<span className="font-mono text-xs">{invoice.ksefReferenceNumber}</span>}
                    />
                  ) : null}
                  <Row
                    label={t('invoiceDetail.field.order')}
                    value={
                      invoice.orderId ? (
                        <Link to={`/orders/${invoice.orderId}`} className="font-mono text-xs underline underline-offset-2">
                          {invoice.orderBusinessId ?? invoice.orderId.slice(0, 8)}
                        </Link>
                      ) : (
                        '—'
                      )
                    }
                  />
                </dl>
              </Section>

              <Section title={t('invoiceDetail.section.seller')}>
                <Party
                  name={invoice.seller.legalName}
                  addressLine1={invoice.seller.addressLine1}
                  addressLine2={invoice.seller.addressLine2}
                  postalCode={invoice.seller.postalCode}
                  city={invoice.seller.city}
                  taxId={invoice.seller.taxId}
                  taxIdLabel={t('invoiceDetail.field.taxId')}
                />
              </Section>

              <Section title={t('invoiceDetail.section.buyer')}>
                <Party
                  name={invoice.buyer.name}
                  addressLine1={invoice.buyer.addressLine1}
                  addressLine2={invoice.buyer.addressLine2}
                  postalCode={invoice.buyer.postalCode}
                  city={invoice.buyer.city}
                  taxId={invoice.buyer.taxId}
                  taxIdLabel={t('invoiceDetail.field.taxId')}
                />
              </Section>
            </div>

            <Section title={t('invoiceDetail.section.lines')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('invoiceDetail.col.no')}</TableHead>
                    <TableHead>{t('invoiceDetail.col.name')}</TableHead>
                    <TableHead>{t('invoiceDetail.col.unit')}</TableHead>
                    <TableHead className="text-right">{t('invoiceDetail.col.qty')}</TableHead>
                    <TableHead className="text-right">{t('invoiceDetail.col.unitNet')}</TableHead>
                    <TableHead className="text-right">{t('invoiceDetail.col.taxRate')}</TableHead>
                    <TableHead className="text-right">{t('invoiceDetail.col.net')}</TableHead>
                    <TableHead className="text-right">{t('invoiceDetail.col.gross')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.lines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={LINE_COLUMNS} className="text-center text-muted-foreground">
                        {t('common.state.empty')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    invoice.lines.map((l) => (
                      <TableRow key={l.ordinal}>
                        <TableCell>{l.ordinal}</TableCell>
                        <TableCell>{l.name}</TableCell>
                        <TableCell>{l.unit}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{unitMoney(l.unitNetPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums">{percent(l.taxRate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(l.netValue)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(l.grossValue)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {/*
                  The VAT summary per rate, its net and gross under the lines'
                  Net and Gross columns, then the document totals in the last
                  column — the order detail's footer (Jakob, Common Region).
                */}
                <tfoot className="border-t [&_td]:p-2 [&_th]:p-2">
                  {invoice.vatSummary.map((v) => (
                    <tr key={v.taxRate} className="text-muted-foreground">
                      <th scope="row" colSpan={LINE_COLUMNS - 2} className="text-right font-medium">
                        {t('invoiceDetail.vatRow', { rate: percent(v.taxRate), amount: money(v.vatAmount) })}
                      </th>
                      <td className="text-right tabular-nums">{money(v.netTotal)}</td>
                      <td className="text-right tabular-nums">{money(v.grossTotal)}</td>
                    </tr>
                  ))}
                  <TotalRow label={t('invoiceDetail.totals.net')} value={money(invoice.netTotal)} first />
                  <TotalRow label={t('invoiceDetail.totals.tax')} value={money(invoice.taxTotal)} />
                  <TotalRow label={t('invoiceDetail.totals.gross')} value={money(invoice.grossTotal)} strong />
                  <TotalRow label={t('invoiceDetail.totals.paid')} value={money(invoice.paidTotal)} />
                  <TotalRow label={t('invoiceDetail.totals.due')} value={money(invoice.amountDue)} strong />
                  {invoice.overpayment > 0 ? (
                    <TotalRow label={t('invoiceDetail.totals.overpayment')} value={money(invoice.overpayment)} />
                  ) : null}
                </tfoot>
              </Table>
            </Section>
          </CardContent>
        </Card>
        {/*
          The place another module may add to, below the document (feature 091,
          FR-007). It used to be `<InvoiceKsefPanel …>` imported from
          `@/modules/ksef/components/` — the single key in
          `backend/scripts/ledgers/cross-module-imports/invoices.ts`, whose
          recorded retiring condition is exactly this: the host publishes the
          place and the owner contributes into it, so neither module names the
          other.

          `<AdminZone>` and not `useAdminZone`: there is no chrome of this
          screen's to suppress when nothing contributes — the stack simply
          ends — which is the case the renderer alone covers. The presence
          axes, the permission and the ordering are all the renderer's, so
          nothing here asks whether `ksef` is switched on. A contribution
          brings its own card, so the stack keeps a gap above it.
        */}
        <div className="mt-4 space-y-4 empty:hidden">
          <AdminZone
            name="invoice.detail.after"
            props={{
              invoiceId: invoice.id,
              kind: invoice.kind,
              ksefReferenceNumber: invoice.ksefReferenceNumber,
            }}
          />
        </div>
      </div>
    </>
  );
}

/** The lines table's column count; the footer's labels span all but the last two. */
const LINE_COLUMNS = 8;

/** A tax rate stored as a fraction (`0.23`), shown as a whole percentage. */
function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** One term of the details description list. */
function Row({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

/** A seller or buyer block: the name, the address and the tax ID, as the invoice prints it. */
function Party(props: {
  name: string;
  addressLine1: string;
  addressLine2: string | null | undefined;
  postalCode: string;
  city: string;
  taxId: string | null | undefined;
  taxIdLabel: string;
}): ReactNode {
  return (
    <address className="space-y-0.5 text-sm not-italic">
      <p className="font-medium">{props.name}</p>
      <p>{props.addressLine1}</p>
      {props.addressLine2 ? <p>{props.addressLine2}</p> : null}
      <p>
        {props.postalCode} {props.city}
      </p>
      {props.taxId ? (
        <p className="text-muted-foreground">
          {props.taxIdLabel}: {props.taxId}
        </p>
      ) : null}
    </address>
  );
}

/** A document total in the lines table's footer: the label across the row, the amount in the last column. */
function TotalRow({
  label,
  value,
  strong = false,
  first = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  first?: boolean;
}): ReactNode {
  return (
    <tr className={cn(first && 'border-t')}>
      <th
        scope="row"
        colSpan={LINE_COLUMNS - 1}
        className={cn('text-right', strong ? 'font-semibold' : 'font-medium text-muted-foreground')}
      >
        {label}
      </th>
      <td className={cn('text-right tabular-nums', strong && 'font-semibold')}>{value}</td>
    </tr>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default InvoiceDetail;
