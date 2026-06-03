import { useEffect, useState, type ReactNode } from 'react';
import { apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';

interface ShipmentRow {
  id: string;
  status: 'pending' | 'success' | 'failure';
  externalReference: string | null;
  failureReason: string | null;
  attemptNo: number;
  createdAt: string;
}

const STATUS_VARIANT: Record<ShipmentRow['status'], BadgeProps['variant']> = {
  pending: 'warning',
  success: 'success',
  failure: 'destructive',
};

/**
 * Delivery tab — lists the shipment generation attempts tied to an order
 * (`GET /api/v1/admin/orders/:id/shipments`). A new attempt is appended on
 * each retry, so the most recent attempt has the highest `attemptNo`.
 */
export function OrderShipmentsTab(props: { orderId: string }): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    void apiClient
      .get<{ data: ShipmentRow[] }>(`/api/v1/admin/orders/${props.orderId}/shipments`)
      .then((res) => {
        if (alive) setRows(res.data);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, [props.orderId]);

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('orderDetail.shipments.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{t('common.state.error')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('orderDetail.shipments.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orderDetail.shipments.columns.attempt')}</TableHead>
                <TableHead>{t('orderDetail.shipments.columns.status')}</TableHead>
                <TableHead>{t('orderDetail.shipments.columns.tracking')}</TableHead>
                <TableHead>{t('orderDetail.shipments.columns.createdAt')}</TableHead>
                <TableHead>{t('orderDetail.shipments.columns.failure')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>#{s.attemptNo}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[s.status]}>
                      {t(`orderDetail.shipments.status.${s.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.externalReference ?? '—'}</TableCell>
                  <TableCell>{formatDateTime(s.createdAt)}</TableCell>
                  <TableCell className="text-destructive">{s.failureReason ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
