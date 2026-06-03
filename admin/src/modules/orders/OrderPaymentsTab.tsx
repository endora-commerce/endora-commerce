import { useEffect, useState, type ReactNode } from 'react';
import { FileDown } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
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
import { Section } from './Section';

interface PaymentRow {
  id: string;
  status: 'awaiting_payment' | 'paid' | 'failed' | 'deferred' | 'refunded';
  amount: number;
  currency: string;
  paidAt: string | null;
  externalReference: string | null;
  failureReason: string | null;
  attemptNo: number;
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

const PAYMENT_STATUS_VARIANT: Record<PaymentRow['status'], BadgeProps['variant']> = {
  awaiting_payment: 'warning',
  paid: 'success',
  failed: 'destructive',
  deferred: 'secondary',
  refunded: 'outline',
};

const INVOICE_STATUS_VARIANT: Record<InvoiceRow['status'], BadgeProps['variant']> = {
  pending: 'warning',
  ready: 'success',
  cancelled: 'outline',
};

function money(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
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
                <TableHead>{t('orderDetail.payments.columns.paidAt')}</TableHead>
                <TableHead>{t('orderDetail.payments.columns.reference')}</TableHead>
                <TableHead>{t('orderDetail.payments.columns.failure')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>#{p.attemptNo}</TableCell>
                  <TableCell className="tabular-nums">{money(p.amount, p.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={PAYMENT_STATUS_VARIANT[p.status]}>
                      {t(`orderDetail.paymentStatus.${p.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>{p.paidAt ? formatDateTime(p.paidAt) : '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{p.externalReference ?? '—'}</TableCell>
                  <TableCell className="text-destructive">{p.failureReason ?? ''}</TableCell>
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
