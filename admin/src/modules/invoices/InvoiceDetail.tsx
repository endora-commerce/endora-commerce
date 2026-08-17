import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileDown, Mail, RefreshCw } from 'lucide-react';
import type {
  InvoiceDetail as InvoiceDetailData,
  SendInvoiceEmailResult,
} from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { useAuth } from '@/lib/auth';
import { InvoiceKsefPanel } from '@/modules/ksef/components/InvoiceKsefPanel';
import { sendInvoiceEmailMessage } from './email-outcome';

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
  const [invoice, setInvoice] = useState<InvoiceDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseUrl = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: InvoiceDetailData }>(`/api/v1/admin/invoices/${id}`);
      setInvoice(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setInvoice(null);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : t('invoiceDetail.error.load'));
      }
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const regenerate = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/v1/admin/invoices/${id}/regenerate-pdf`, {});
      setNotice(t('invoiceDetail.regenerated'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('invoiceDetail.regenerateError'));
    } finally {
      setBusy(false);
    }
  }, [id, refresh, t]);

  const resendEmail = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ data: SendInvoiceEmailResult }>(
        `/api/v1/admin/invoices/${id}/send-email`,
        {},
      );
      // Issue #149 — the same answer the list surface now reads: a send that
      // was suppressed says so instead of being confirmed.
      const outcome = sendInvoiceEmailMessage(res.data, t);
      if (outcome.ok) setNotice(outcome.message);
      else setError(outcome.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('invoiceDetail.error.load'));
    } finally {
      setBusy(false);
    }
  }, [id, t]);

  if (loading) return <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>;
  if (!invoice)
    return (
      <Alert variant="warning">
        <AlertDescription>{t('invoiceDetail.notFound')}</AlertDescription>
      </Alert>
    );

  const money = (n: number): string => formatMoney(n, invoice.currency);

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
          <>
            {invoice.status === 'ready' ? (
              <Button asChild variant="outline" size="sm" className="bg-card">
                <a
                  href={`${baseUrl}/api/v1/admin/invoices/${invoice.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileDown />
                  {t('invoiceDetail.action.downloadPdf')}
                </a>
              </Button>
            ) : null}
            {canWrite ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-card"
                  disabled={busy}
                  onClick={(): void => void regenerate()}
                >
                  <RefreshCw />
                  {t('invoiceDetail.action.regeneratePdf')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-card"
                  disabled={busy}
                  onClick={(): void => void resendEmail()}
                >
                  <Mail />
                  {t('invoiceDetail.action.resendEmail')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {invoice.status !== 'ready' ? (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>{t('invoiceDetail.pdfNotReady')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t('invoiceDetail.section.details')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label={t('invoiceDetail.field.kind')} value={t(`invoices.kind.${invoice.kind}`)} />
            <Row label={t('invoiceDetail.field.issuedAt')} value={formatDateTime(invoice.issuedAt)} />
            <Row label={t('invoiceDetail.field.saleDate')} value={invoice.saleDate ?? '—'} />
            <Row label={t('invoiceDetail.field.paymentDueDate')} value={invoice.paymentDueDate ?? '—'} />
            <Row label={t('invoiceDetail.field.paymentMethod')} value={invoice.paymentMethod ?? '—'} />
            <Row
              label={t('invoiceDetail.field.order')}
              value={
                <Link to={`/orders/${invoice.orderId}`} className="font-mono text-xs underline underline-offset-2">
                  {invoice.orderBusinessId ?? invoice.orderId.slice(0, 8)}
                </Link>
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('invoiceDetail.section.seller')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5 text-sm">
            <p className="font-medium">{invoice.seller.legalName}</p>
            <p>{invoice.seller.addressLine1}</p>
            {invoice.seller.addressLine2 ? <p>{invoice.seller.addressLine2}</p> : null}
            <p>
              {invoice.seller.postalCode} {invoice.seller.city}
            </p>
            {invoice.seller.taxId ? (
              <p className="text-muted-foreground">
                {t('invoiceDetail.field.taxId')}: {invoice.seller.taxId}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('invoiceDetail.section.buyer')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5 text-sm">
            <p className="font-medium">{invoice.buyer.name}</p>
            <p>{invoice.buyer.addressLine1}</p>
            {invoice.buyer.addressLine2 ? <p>{invoice.buyer.addressLine2}</p> : null}
            <p>
              {invoice.buyer.postalCode} {invoice.buyer.city}
            </p>
            {invoice.buyer.taxId ? (
              <p className="text-muted-foreground">
                {t('invoiceDetail.field.taxId')}: {invoice.buyer.taxId}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('invoiceDetail.section.lines')}</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
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
                    <TableCell className="text-right tabular-nums">{money(l.unitNetPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.round(l.taxRate * 100)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.netValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.grossValue)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('invoiceDetail.section.vatSummary')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">{t('invoiceDetail.col.taxRate')}</TableHead>
                  <TableHead className="text-right">{t('invoiceDetail.col.net')}</TableHead>
                  <TableHead className="text-right">{t('invoiceDetail.totals.tax')}</TableHead>
                  <TableHead className="text-right">{t('invoiceDetail.col.gross')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.vatSummary.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      {t('common.state.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  invoice.vatSummary.map((v) => (
                    <TableRow key={v.taxRate}>
                      <TableCell className="text-right tabular-nums">{Math.round(v.taxRate * 100)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{money(v.netTotal)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(v.vatAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(v.grossTotal)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('invoiceDetail.section.totals')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Row label={t('invoiceDetail.totals.net')} value={money(invoice.netTotal)} />
              <Row label={t('invoiceDetail.totals.tax')} value={money(invoice.taxTotal)} />
              <Row label={t('invoiceDetail.totals.gross')} value={<strong>{money(invoice.grossTotal)}</strong>} />
              <Row label={t('invoiceDetail.totals.paid')} value={money(invoice.paidTotal)} />
              <Row label={t('invoiceDetail.totals.due')} value={money(invoice.amountDue)} />
            </CardContent>
          </Card>
          {/* KSeF state rendered next to the payment fields (feature 059 US5). */}
          <InvoiceKsefPanel
            invoiceId={invoice.id}
            kind={invoice.kind}
            ksefReferenceNumber={invoice.ksefReferenceNumber}
          />
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
