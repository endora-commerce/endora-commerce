import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PackageX } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

interface ShipmentRow {
  id: string;
  status: 'pending' | 'pending_manual' | 'success' | 'failure';
  externalReference: string | null;
  failureReason: string | null;
  attemptNo: number;
  createdAt: string;
}

const STATUS_VARIANT: Record<ShipmentRow['status'], BadgeProps['variant']> = {
  pending: 'warning',
  // Its own variant, not `warning`: a `pending` shipment is waiting for a
  // carrier that knows about it, and a `pending_manual` one is waiting for a
  // person. Two rows that read the same are the defect this state exists to
  // remove (issue #250).
  pending_manual: 'destructive',
  success: 'success',
  failure: 'destructive',
};

/** The most recent attempt — the only one an operator can still act on. */
function latestAttempt(rows: readonly ShipmentRow[]): ShipmentRow | undefined {
  return rows.reduce<ShipmentRow | undefined>(
    (best, row) => (best === undefined || row.attemptNo > best.attemptNo ? row : best),
    undefined,
  );
}

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
  const [regenerating, setRegenerating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

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
  }, [props.orderId, reloadToken]);

  /**
   * The recovery path, and it is the *generate* endpoint rather than the retry
   * one on purpose: opening a retry attempt does not contact the carrier, and
   * a second row nobody asked for would be the same silence again. Generating
   * appends a new attempt and asks the adapter, which is exactly what has to
   * happen once the operator has switched the module back on.
   */
  const generateAgain = useCallback(() => {
    setRegenerating(true);
    void apiClient
      .post(`/api/v1/admin/orders/${props.orderId}/shipments`, {})
      .catch(() => setError(true))
      .finally(() => {
        setRegenerating(false);
        setReloadToken((token) => token + 1);
      });
  }, [props.orderId]);

  const stalled =
    latestAttempt(rows)?.status === 'pending_manual' ? latestAttempt(rows) : undefined;

  return (
    <Section title={t('orderDetail.shipments.title')}>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
      ) : error ? (
        <p className="text-sm text-destructive">{t('common.state.error')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('orderDetail.shipments.empty')}</p>
      ) : (
        <>
          {stalled ? (
            <Alert variant="destructive" className="mb-4">
              <PackageX aria-hidden="true" />
              <AlertTitle>{t('orderDetail.shipments.carrierNotContacted.title')}</AlertTitle>
              <AlertDescription>
                <p>{t('orderDetail.shipments.carrierNotContacted.body')}</p>
                {stalled.failureReason ? (
                  <p className="mt-1 text-xs opacity-80">{stalled.failureReason}</p>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={regenerating}
                  onClick={generateAgain}
                >
                  {regenerating
                    ? t('orderDetail.shipments.carrierNotContacted.actionBusy')
                    : t('orderDetail.shipments.carrierNotContacted.action')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
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
        </>
      )}
    </Section>
  );
}
