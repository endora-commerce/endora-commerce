import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Mail } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { InvoiceSectionTabs } from './components/InvoiceSectionTabs';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
import type { SendInvoiceEmailResult } from '@endora-commerce/contracts';
import { sendInvoiceEmailMessage } from './email-outcome';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface AdminInvoice {
  id: string;
  orderId: string;
  orderBusinessId: string | null;
  kind: 'proforma' | 'invoice' | 'correction';
  number: string;
  issuedAt: string;
  currency: string;
  total: number;
  status: 'pending' | 'ready' | 'cancelled';
  pdfReady: boolean;
}

const STATUSES = ['pending', 'ready', 'cancelled'] as const;
const KINDS = ['proforma', 'invoice', 'correction'] as const;

const STATUS_VARIANT: Record<AdminInvoice['status'], 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  pending: 'warning',
  ready: 'success',
  cancelled: 'destructive',
};

export function InvoicesList(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<AdminInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | (typeof STATUSES)[number]>('');
  const [kind, setKind] = useState<'' | (typeof KINDS)[number]>('');
  const [orderNumber, setOrderNumber] = useState('');
  const [issuedFrom, setIssuedFrom] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [totalMin, setTotalMin] = useState('');
  const [totalMax, setTotalMax] = useState('');

  const hasFilters =
    status !== '' ||
    kind !== '' ||
    orderNumber.trim() !== '' ||
    issuedFrom !== '' ||
    issuedTo !== '' ||
    totalMin !== '' ||
    totalMax !== '';

  const clearFilters = useCallback((): void => {
    setStatus('');
    setKind('');
    setOrderNumber('');
    setIssuedFrom('');
    setIssuedTo('');
    setTotalMin('');
    setTotalMax('');
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('filter[status]', status);
      if (kind) params.set('filter[kind]', kind);
      if (orderNumber.trim()) params.set('filter[orderNumber]', orderNumber.trim());
      if (issuedFrom) params.set('filter[issuedFrom]', `${issuedFrom}T00:00:00.000Z`);
      if (issuedTo) params.set('filter[issuedTo]', `${issuedTo}T23:59:59.999Z`);
      if (totalMin.trim()) params.set('filter[totalMin]', totalMin.trim());
      if (totalMax.trim()) params.set('filter[totalMax]', totalMax.trim());
      const path =
        '/api/v1/admin/invoices' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AdminInvoice[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [status, kind, orderNumber, issuedFrom, issuedTo, totalMin, totalMax]);

  // Debounced so typing in the order-number / total inputs doesn't refetch
  // on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => void refresh(), 300);
    return (): void => clearTimeout(id);
  }, [refresh]);

  const baseUrl = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

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
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to send.');
      }
    },
    [t],
  );

  return (
    <>
      {/* The templates button is gone: it is a tab now. */}
      <PageHeader title={t('invoices.title')} description={t('invoices.description')} />

      <InvoiceSectionTabs />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert className="mb-4">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="iorder">{t('invoices.fields.orderNumber')}</Label>
              <Input
                id="iorder"
                value={orderNumber}
                onChange={(e): void => setOrderNumber(e.target.value)}
                placeholder={t('invoices.filters.orderNumberPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ikind">{t('invoices.fields.kind')}</Label>
              <Select
                id="ikind"
                value={kind}
                onChange={(e): void => setKind(e.target.value as typeof kind)}
              >
                <option value="">{t('invoices.kind.all')}</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`invoices.kind.${k}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="istatus">{t('invoices.fields.status')}</Label>
              <Select
                id="istatus"
                value={status}
                onChange={(e): void => setStatus(e.target.value as typeof status)}
              >
                <option value="">{t('invoices.status.all')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`invoices.status.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ifrom">{t('invoices.fields.issuedFrom')}</Label>
              <Input
                id="ifrom"
                type="date"
                value={issuedFrom}
                onChange={(e): void => setIssuedFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ito">{t('invoices.fields.issuedTo')}</Label>
              <Input
                id="ito"
                type="date"
                value={issuedTo}
                onChange={(e): void => setIssuedTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="itmin">{t('invoices.fields.totalMin')}</Label>
              <Input
                id="itmin"
                type="number"
                step="0.01"
                min="0"
                value={totalMin}
                onChange={(e): void => setTotalMin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="itmax">{t('invoices.fields.totalMax')}</Label>
              <Input
                id="itmax"
                type="number"
                step="0.01"
                min="0"
                value={totalMax}
                onChange={(e): void => setTotalMax(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button type="button" variant="outline" disabled={!hasFilters} onClick={clearFilters}>
                {t('invoices.filters.clear')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('invoices.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('invoices.columns.number')}</TableHead>
                  <TableHead>{t('invoices.columns.kind')}</TableHead>
                  <TableHead>{t('invoices.columns.issued')}</TableHead>
                  <TableHead>{t('invoices.columns.order')}</TableHead>
                  <TableHead>{t('invoices.columns.total')}</TableHead>
                  <TableHead>{t('invoices.columns.status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">
                      <Link to={`/invoices/${i.id}`} className="underline underline-offset-2">
                        {i.number}
                      </Link>
                    </TableCell>
                    <TableCell>{t(`invoices.kind.${i.kind}`)}</TableCell>
                    <TableCell>{formatDateTime(i.issuedAt)}</TableCell>
                    <TableCell>
                      <Link
                        to={`/orders/${i.orderId}`}
                        className="font-mono text-xs underline underline-offset-2"
                      >
                        {i.orderBusinessId ?? i.orderId.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(i.total, i.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[i.status]}>{t(`invoices.status.${i.status}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {i.pdfReady ? (
                          <Button asChild variant="outline" size="sm">
                            <a
                              href={`${baseUrl}/api/v1/admin/invoices/${i.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <FileDown />
                              PDF
                            </a>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t('invoices.pdfNotReady')}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(): void => void resendEmail(i.id)}
                          title={t('invoices.resendEmail')}
                        >
                          <Mail />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
