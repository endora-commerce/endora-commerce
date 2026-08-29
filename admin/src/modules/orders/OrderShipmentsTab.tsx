import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PackageX } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { dhlParcelAdminClient } from '@/modules/dhl_parcel/api/dhl-parcel-client';
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
import { useSurfaceVisibility } from '@/lib/surface-visibility';
import { inpostAdminClient } from '@/modules/inpost/api/inpost-client';
import { Section } from './Section';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

interface ShipmentRow {
  id: string;
  status: 'pending' | 'pending_manual' | 'success' | 'failure';
  externalReference: string | null;
  /**
   * The carrier envelope the adapter deposited on the attempt. Read here for
   * one thing only: which carrier opened this row, so a per-carrier affordance
   * (the InPost label below) can be offered on the attempt it belongs to rather
   * than on whichever delivery-method code the order happens to carry.
   */
  providerDetails: Record<string, unknown> | null;
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
export function OrderShipmentsTab(props: {
  orderId: string;
  deliveryMethodCode: string;
}): ReactNode {
  const t = useTranslation('core');
  const tinpost = useTranslation('inpost');
  /**
   * Both axes at once, as `DeliveryMethodsPage` asks them: the operator's
   * `inpost:manage` permission and `inpost`'s effective presence. A label
   * button offered while the module is off is a 503 the operator cannot act on.
   */
  const isVisible = useSurfaceVisibility();
  const showInpostLabel = isVisible({ module: 'inpost', requiredPermission: 'inpost:manage' });
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [busyAction, setBusyAction] = useState<'label' | 'protocol' | 'courier' | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // DHL admin actions were wired without an adapter check — Book courier / PnP
  // only apply to door courier; POP/BOX uses Parcelshop createShipment alone.
  const isDhlCourier = props.deliveryMethodCode === 'dhl_parcel_courier';
  const isDhlPickup = props.deliveryMethodCode === 'dhl_parcel_pickup';
  const showDhlLabel = isDhlCourier || isDhlPickup;
  const showDhlCourierOps = isDhlCourier;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    void apiClient
      .get<{ data: ShipmentRow[] }>(`/api/v1/admin/orders/${props.orderId}/shipments`)
      .then((res) => {
        if (alive) setRows(res.data);
      })
      .catch(() => {
        if (!alive) return;
        setLoadError(true);
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
    setActionError(null);
    void apiClient
      .post(`/api/v1/admin/orders/${props.orderId}/shipments`, {})
      .then(() => {
        setReloadToken((token) => token + 1);
      })
      .catch((err: unknown) => {
        setActionError(
          err instanceof ApiError
            ? err.envelope.error.message
            : t('orderDetail.shipments.generate.error'),
        );
      })
      .finally(() => {
        setRegenerating(false);
      });
  }, [props.orderId, t]);

  const stalled =
    latestAttempt(rows)?.status === 'pending_manual' ? latestAttempt(rows) : undefined;
  const latest = latestAttempt(rows);
  const canGenerate =
    rows.length === 0 || latest?.status === 'failure' || latest?.status === 'pending_manual';

  const downloadBase64 = (filename: string, content: string): void => {
    const anchor = document.createElement('a');
    anchor.href = `data:application/pdf;base64,${content}`;
    anchor.download = filename;
    anchor.click();
  };

  const downloadInpostLabel = useCallback(
    async (shipmentId: string): Promise<void> => {
      setActionError(null);
      const res = await fetch(
        `${API_BASE.replace(/\/+$/, '')}${inpostAdminClient.labelUrl(shipmentId)}`,
        { credentials: 'include', headers: { Accept: 'application/pdf' } },
      );
      if (!res.ok) {
        setActionError(tinpost('label.notReady'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    [tinpost],
  );

  const downloadLabel = useCallback(async () => {
    if (!latest) return;
    setBusyAction('label');
    setActionError(null);
    try {
      const data = await dhlParcelAdminClient.getLabel(latest.id);
      if (data.labelBase64) downloadBase64(`dhl-label-${latest.id}.pdf`, data.labelBase64);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('orderDetail.shipments.actions.error'),
      );
    } finally {
      setBusyAction(null);
    }
  }, [latest, t]);

  const downloadProtocol = useCallback(async () => {
    if (!latest) return;
    setBusyAction('protocol');
    setActionError(null);
    try {
      const data = await dhlParcelAdminClient.getProtocol(latest.id);
      if (!data.protocolBase64) {
        setActionError(t('orderDetail.shipments.actions.protocolMissing'));
        return;
      }
      downloadBase64(`dhl-protocol-${latest.id}.pdf`, data.protocolBase64);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('orderDetail.shipments.actions.error'),
      );
    } finally {
      setBusyAction(null);
    }
  }, [latest, t]);

  const bookCourier = useCallback(async () => {
    if (!latest) return;
    setBusyAction('courier');
    setActionError(null);
    try {
      const data = await dhlParcelAdminClient.bookCourier({ shipmentIds: [latest.id] });
      if (data.protocolBase64) {
        downloadBase64(`dhl-protocol-${latest.id}.pdf`, data.protocolBase64);
      }
      setReloadToken((token) => token + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('orderDetail.shipments.actions.error'),
      );
    } finally {
      setBusyAction(null);
    }
  }, [latest, t]);

  return (
    <Section title={t('orderDetail.shipments.title')}>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
      ) : loadError ? (
        <p className="text-sm text-destructive">{t('common.state.error')}</p>
      ) : (
        <>
          {actionError ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          {rows.length === 0 ? (
            <p className="mb-4 text-sm text-muted-foreground">{t('orderDetail.shipments.empty')}</p>
          ) : null}
          {stalled ? (
            <Alert variant="destructive" className="mb-4">
              <PackageX aria-hidden="true" />
              <AlertTitle>{t('orderDetail.shipments.carrierNotContacted.title')}</AlertTitle>
              <AlertDescription>
                <p>{t('orderDetail.shipments.carrierNotContacted.body')}</p>
                {stalled.failureReason ? (
                  <p className="mt-1 text-xs opacity-80">{stalled.failureReason}</p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('orderDetail.shipments.columns.attempt')}</TableHead>
                  <TableHead>{t('orderDetail.shipments.columns.status')}</TableHead>
                  <TableHead>{t('orderDetail.shipments.columns.tracking')}</TableHead>
                  <TableHead>{t('orderDetail.shipments.columns.createdAt')}</TableHead>
                  <TableHead>{t('orderDetail.shipments.columns.failure')}</TableHead>
                  {showInpostLabel ? <TableHead /> : null}
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
                    {showInpostLabel ? (
                      <TableCell>
                        {s.providerDetails?.['provider'] === 'inpost' && s.status === 'success' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => void downloadInpostLabel(s.id)}
                          >
                            {tinpost('label.download')}
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {canGenerate ? (
              <Button size="sm" disabled={regenerating} onClick={generateAgain}>
                {regenerating
                  ? t('orderDetail.shipments.generate.busy')
                  : rows.length === 0
                    ? t('orderDetail.shipments.generate')
                    : t('orderDetail.shipments.generate.again')}
              </Button>
            ) : null}
            {latest && latest.status !== 'pending_manual' && showDhlLabel ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void downloadLabel()}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'label'
                    ? t('common.state.loading')
                    : t('orderDetail.shipments.actions.downloadLabel')}
                </Button>
                {showDhlCourierOps ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void downloadProtocol()}
                      disabled={busyAction !== null}
                    >
                      {busyAction === 'protocol'
                        ? t('common.state.loading')
                        : t('orderDetail.shipments.actions.downloadProtocol')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void bookCourier()}
                      disabled={busyAction !== null}
                    >
                      {busyAction === 'courier'
                        ? t('common.state.loading')
                        : t('orderDetail.shipments.actions.bookCourier')}
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </>
      )}
    </Section>
  );
}
