import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PackageX } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
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
import { useAuth } from '@/lib/auth';
import { Section } from './Section';
import { inpostAdminClient } from '../inpost/api/inpost-client';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

interface ShipmentRow {
  id: string;
  status: 'pending' | 'pending_manual' | 'success' | 'failure';
  externalReference: string | null;
  providerDetails: Record<string, unknown> | null;
  failureReason: string | null;
  attemptNo: number;
  createdAt: string;
}

const STATUS_VARIANT: Record<ShipmentRow['status'], BadgeProps['variant']> = {
  pending: 'warning',
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
 * Delivery tab — lists shipment generation attempts for an order
 * (`GET /api/v1/admin/orders/:id/shipments`). Generate and retry both call
 * `POST .../shipments` (issue #257); InPost label download stays on success rows.
 */
export function OrderShipmentsTab(props: { orderId: string }): ReactNode {
  const t = useTranslation('core');
  const tinpost = useTranslation('inpost');
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      const res = await apiClient.get<{ data: ShipmentRow[] }>(
        `/api/v1/admin/orders/${props.orderId}/shipments`,
      );
      setRows(res.data);
    } catch {
      setError(true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [props.orderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generatePath = `/api/v1/admin/orders/${props.orderId}/shipments`;

  const runGenerate = async (): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.post(generatePath, {});
      await refresh();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.envelope.error.message : t('orderDetail.shipments.actionError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const canWrite = hasPermission('orders:write');
  const canDownloadLabel = hasPermission('inpost:manage');
  const latest = latestAttempt(rows);
  const hasSuccess = rows.some((r) => r.status === 'success');
  const hasPending = rows.some((r) => r.status === 'pending');
  const showGenerate = canWrite && !hasSuccess && !hasPending && rows.length === 0;
  const showRetry =
    canWrite && latest?.status === 'failure' && !hasSuccess && !hasPending && latest !== undefined;
  const stalled = latest?.status === 'pending_manual' ? latest : undefined;

  const downloadLabel = async (shipmentId: string): Promise<void> => {
    const res = await fetch(
      `${API_BASE.replace(/\/+$/, '')}${inpostAdminClient.labelUrl(shipmentId)}`,
      {
        credentials: 'include',
        headers: { Accept: 'application/pdf' },
      },
    );
    if (!res.ok) {
      window.alert(tinpost('label.notReady'));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <Section title={t('orderDetail.shipments.title')}>
      {(showGenerate || showRetry) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {showGenerate ? (
            <Button type="button" size="sm" disabled={busy} onClick={() => void runGenerate()}>
              {t('orderDetail.shipments.generate')}
            </Button>
          ) : null}
          {showRetry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runGenerate()}
            >
              {t('orderDetail.shipments.retry')}
            </Button>
          ) : null}
        </div>
      )}
      {actionError ? <p className="mb-3 text-sm text-destructive">{actionError}</p> : null}
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
                  disabled={busy}
                  onClick={() => void runGenerate()}
                >
                  {busy
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
                {canDownloadLabel ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const isInpost = s.providerDetails?.provider === 'inpost';
                return (
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
                    {canDownloadLabel ? (
                      <TableCell>
                        {isInpost && s.status === 'success' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => void downloadLabel(s.id)}
                          >
                            {tinpost('label.download')}
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </Section>
  );
}
