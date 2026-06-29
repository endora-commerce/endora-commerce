import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Mail } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
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

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('filter[status]', status);
      const path =
        '/api/v1/admin/invoices' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AdminInvoice[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const baseUrl = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

  const resendEmail = useCallback(
    async (invoiceId: string): Promise<void> => {
      setError(null);
      setNotice(null);
      try {
        await apiClient.post(`/api/v1/admin/invoices/${invoiceId}/send-email`, {});
        setNotice(t('invoices.emailSent'));
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to send.');
      }
    },
    [t],
  );

  return (
    <>
      <PageHeader
        title={t('invoices.title')}
        description={t('invoices.description')}
      />

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
          <div className="space-y-2 md:max-w-xs">
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
                    <TableCell className="font-medium">{i.number}</TableCell>
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
                      {i.total.toFixed(2)} {i.currency}
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
