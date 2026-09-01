import { useEffect, useState, type ReactNode } from 'react';
import { FileDown } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { formatMoney as formatMoneyShared } from '@/lib/money';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { Section } from '@endora-commerce/admin-kit/ui';

type PaymentStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'failed'
  | 'deferred'
  | 'refunded'
  | 'partially_refunded';

interface PaymentRow {
  id: string;
  status: PaymentStatus;
  amount: number;
  refundedAmount: number;
  currency: string;
  paidAt: string | null;
  refundedAt: string | null;
  updatedAt: string | null;
  externalReference: string | null;
  refundReference: string | null;
  failureReason: string | null;
  attemptNo: number;
}

/**
 * One money-movement entry in the payment ledger: a charge (the payment) or a
 * refund. A refunded payment expands into two entries — the original "paid"
 * charge and the "refunded" line — so the order keeps its full payment history.
 */
interface LedgerEntry {
  key: string;
  attemptNo: number;
  amount: number;
  currency: string;
  status: PaymentStatus;
  at: string | null;
  reference: string | null;
  failure: string | null;
}

function toLedger(payments: PaymentRow[]): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const p of payments) {
    const wasPaid = p.paidAt != null || p.status === 'refunded' || p.status === 'partially_refunded';
    entries.push({
      key: `${p.id}-charge`,
      attemptNo: p.attemptNo,
      amount: p.amount,
      currency: p.currency,
      // Keep the charge shown as "paid" even after a later refund.
      status: wasPaid ? 'paid' : p.status,
      at: p.paidAt,
      reference: p.externalReference,
      failure: p.failureReason,
    });
    if (p.refundedAmount > 0) {
      entries.push({
        key: `${p.id}-refund`,
        attemptNo: p.attemptNo,
        amount: -p.refundedAmount,
        currency: p.currency,
        status: p.refundedAmount >= p.amount ? 'refunded' : 'partially_refunded',
        // Exact refund time when recorded; else the payment's last-updated time
        // (when the refund was reflected) so pre-existing refunds still show a date.
        at: p.refundedAt ?? p.updatedAt,
        reference: p.refundReference ?? p.externalReference,
        failure: null,
      });
    }
  }
  return entries;
}

interface InvoiceRow {
  id: string;
  kind: 'proforma' | 'invoice' | 'correction';
  number: string;
  issuedAt: string;
  currency: string;
  total: number;
  status: 'pending' | 'ready' | 'cancelled';
  pdfReady: boolean;
}

const PAYMENT_STATUS_VARIANT: Record<PaymentStatus, BadgeProps['variant']> = {
  awaiting_payment: 'warning',
  paid: 'success',
  failed: 'destructive',
  deferred: 'secondary',
  refunded: 'outline',
  partially_refunded: 'outline',
};

const INVOICE_STATUS_VARIANT: Record<InvoiceRow['status'], BadgeProps['variant']> = {
  pending: 'warning',
  ready: 'success',
  cancelled: 'outline',
};

function money(amount: number, currency: string): string {
  return formatMoneyShared(amount, currency);
}

/**
 * Payment tab — the order's payment attempts
 * (`GET /api/v1/admin/orders/:id/payments`) plus the invoices generated for it
 * (`GET /api/v1/admin/invoices?filter[orderId]=…`). The PDF download reuses the
 * order invoice endpoint already linked from the page header; it serves the
 * most recent ready invoice, so the link is offered only for ready invoices.
 */
export function OrderPaymentsTab(props: { orderId: string }): ReactNode {
  const t = useTranslation('core');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    void Promise.all([
      apiClient.get<{ data: PaymentRow[] }>(`/api/v1/admin/orders/${props.orderId}/payments`),
      apiClient.get<{ data: InvoiceRow[] }>(
        `/api/v1/admin/invoices?filter[orderId]=${props.orderId}`,
      ),
    ])
      .then(([p, inv]) => {
        if (!alive) return;
        setPayments(p.data);
        setInvoices(inv.data);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setPayments([]);
        setInvoices([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, [props.orderId]);

  const invoiceHref = `${import.meta.env['VITE_API_BASE_URL'] ?? ''}/api/v1/orders/${props.orderId}/invoice`;

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>;
  }
  if (error) {
    return <p className="text-sm text-destructive">{t('common.state.error')}</p>;
  }

  return (
    <>
      <Section title={t('orderDetail.payments.title')}>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('orderDetail.payments.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orderDetail.payments.columns.attempt')}</TableHead>
                <TableHead>{t('orderDetail.payments.columns.amount')}</TableHead>
                <TableHead>{t('orderDetail.payments.columns.status')}</TableHead>
                <TableHead>{t('orderDetail.payments.columns.actionDate')}</TableHead>
                <TableHead>{t('orderDetail.payments.columns.reference')}</TableHead>
                <TableHead>{t('orderDetail.payments.columns.failure')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {toLedger(payments).map((e) => (
                <TableRow key={e.key}>
                  <TableCell>#{e.attemptNo}</TableCell>
                  <TableCell className="tabular-nums">{money(e.amount, e.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={PAYMENT_STATUS_VARIANT[e.status]}>
                      {t(`orderDetail.paymentStatus.${e.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>{e.at ? formatDateTime(e.at) : '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{e.reference ?? '—'}</TableCell>
                  <TableCell className="text-destructive">{e.failure ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title={t('orderDetail.invoices.title')}>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('orderDetail.invoices.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orderDetail.invoices.columns.number')}</TableHead>
                <TableHead>{t('orderDetail.invoices.columns.kind')}</TableHead>
                <TableHead>{t('orderDetail.invoices.columns.issuedAt')}</TableHead>
                <TableHead>{t('orderDetail.invoices.columns.total')}</TableHead>
                <TableHead>{t('orderDetail.invoices.columns.status')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.number}</TableCell>
                  <TableCell>{t(`orderDetail.invoices.kind.${inv.kind}`)}</TableCell>
                  <TableCell>{formatDateTime(inv.issuedAt)}</TableCell>
                  <TableCell className="tabular-nums">{money(inv.total, inv.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={INVOICE_STATUS_VARIANT[inv.status]}>
                      {t(`orderDetail.invoices.status.${inv.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {inv.pdfReady ? (
                      <Button asChild variant="outline" size="sm" className="bg-card">
                        <a href={invoiceHref} target="_blank" rel="noreferrer">
                          <FileDown />
                          {t('orderDetail.invoices.download')}
                        </a>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </>
  );
}
