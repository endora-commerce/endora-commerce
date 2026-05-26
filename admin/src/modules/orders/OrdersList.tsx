import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ResponsiveTable } from '@/components/ResponsiveTable';
import { useTranslation } from '@/i18n/useTranslation';

interface AdminOrderRow {
  id: string;
  status: string;
  paymentStatus: string;
  organizationId: string;
  total: number;
  currency: string;
  placedAt: string;
}

const STATUSES = ['new', 'confirmed', 'in_fulfilment', 'shipped', 'completed', 'cancelled'] as const;

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  new: 'warning',
  confirmed: 'default',
  in_fulfilment: 'default',
  shipped: 'default',
  completed: 'success',
  cancelled: 'destructive',
};

export function OrdersList(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | (typeof STATUSES)[number]>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminOrderRow[] }>('/api/v1/admin/orders');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('orders.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

  return (
    <>
      <PageHeader title={t('orders.page.title')} description={t('orders.page.description')} />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="space-y-2 md:max-w-xs">
            <Label htmlFor="ostatus">{t('orders.field.status')}</Label>
            <Select
              id="ostatus"
              value={statusFilter}
              onChange={(e): void => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="">{t('orders.filter.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('orders.loading')}</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('orders.empty')}</p>
          ) : (
            <ResponsiveTable
              data={visible}
              keyExtractor={(o) => o.id}
              columns={[
                {
                  id: 'order',
                  header: t('orders.column.order'),
                  primary: true,
                  render: (o) => (
                    <Link
                      to={`/orders/${o.id}`}
                      className="font-mono text-xs underline underline-offset-2"
                    >
                      {o.id.slice(0, 8)}
                    </Link>
                  ),
                  meta: (o) => formatDateTime(o.placedAt),
                },
                {
                  id: 'org',
                  header: t('orders.column.org'),
                  render: (o) => (
                    <span className="font-mono text-xs text-muted-foreground">
                      {o.organizationId.slice(0, 8)}
                    </span>
                  ),
                },
                {
                  id: 'status',
                  header: t('orders.column.status'),
                  render: (o) => (
                    <Badge variant={STATUS_VARIANT[o.status] ?? 'secondary'}>{o.status}</Badge>
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
        </CardContent>
      </Card>
    </>
  );
}
