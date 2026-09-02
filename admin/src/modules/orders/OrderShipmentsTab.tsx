import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PackageX } from 'lucide-react';
import type { ShipmentStatus } from '@endora-commerce/contracts';
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
import { useSurfaceVisibility } from '@/lib/surface-visibility';
import {
  AdminZone,
  selectZoneContributions,
  useAdminContributions,
} from '@endora-commerce/admin-kit/zones';
import { Section } from '@endora-commerce/admin-kit/ui';

interface ShipmentRow {
  id: string;
  status: ShipmentStatus;
  externalReference: string | null;
  /**
   * The carrier envelope the adapter deposited on the attempt. Read here for
   * one thing only: which carrier opened this row, so that the row's zone mount
   * carries it as `providerCode` and a carrier's contribution can narrow itself
   * to the attempt it belongs to rather than to whichever delivery-method code
   * the order happens to carry.
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
 * Which carrier opened this attempt, from the adapter's own envelope.
 *
 * A **provider code**, not a module id: it is a string the adapter deposited,
 * and it is `null` for an attempt no carrier ever answered — the fail-closed
 * value, which no contribution's `match` agrees with.
 */
function providerCodeOf(row: ShipmentRow): string | null {
  const provider = row.providerDetails?.['provider'];
  return typeof provider === 'string' ? provider : null;
}

/**
 * Delivery tab — lists the shipment generation attempts tied to an order
 * (`GET /api/v1/admin/orders/:id/shipments`). A new attempt is appended on
 * each retry, so the most recent attempt has the highest `attemptNo`.
 *
 * ## What P7d took out of it (feature 091, §10.4)
 *
 * Two carriers' affordances, which this file rendered itself. `inpost` was
 * named three ways — a `useSurfaceVisibility` gate, a `useTranslation`
 * namespace and a `providerDetails.provider` comparison — the first two being
 * the pair of `foreign-module-ids` keys this conversion retires. The other
 * carrier was named by its two **delivery-method codes** rather than by its
 * module id, so no ledger and no check ever saw it; its three buttons carried
 * no permission gate at all while the routes behind them enforce a read and a
 * write code. Neither carrier's name is written in this file any more, in any
 * spelling — `OrderShipmentsTab.carrier-zones.test.tsx` asserts that, so the
 * codes are deliberately not quoted here either.
 *
 * Both carriers left together, which is what `api/carrier-documents-client.ts`
 * ruled in its own header before it was deleted with them: *"both carriers are
 * one shipment tab reaching two adapters … a repair naming one is a repair that
 * has not understood the shape"*.
 *
 * Two zones stand in their place. `order.shipment.row.actions` is mounted once
 * per attempt and carries that attempt's `providerCode` and `status`;
 * `order.shipments.tab.actions` is mounted once in the footer bar and carries
 * the order's delivery-method code and its latest attempt. What this file keeps
 * knowing is that a shipment row may have an action and that the tab has a
 * footer bar; what it stops knowing is which carrier fills either.
 */
export function OrderShipmentsTab(props: {
  orderId: string;
  deliveryMethodCode: string;
}): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * Whether the attempts table needs its action column at all.
   *
   * `useAdminZone` is a hook, so it cannot be asked once per row;
   * `selectZoneContributions` is the pure function that hook is a `useMemo`
   * over, and the kit publishes it for exactly this. Asking it per row is the
   * honest question — *"will any row show an action"* — and strictly narrower
   * than the answer this file gave before, which was one carrier's presence
   * and permission with no reference to the rows at all.
   */
  const contributions = useAdminContributions();
  const isVisible = useSurfaceVisibility();
  const showRowActions = useMemo(
    () =>
      rows.some(
        (row) =>
          selectZoneContributions(
            contributions,
            'order.shipment.row.actions',
            {
              orderId: props.orderId,
              shipmentId: row.id,
              deliveryMethodCode: props.deliveryMethodCode,
              providerCode: providerCodeOf(row),
              status: row.status,
            },
            isVisible,
          ).length > 0,
      ),
    [rows, contributions, isVisible, props.orderId, props.deliveryMethodCode],
  );

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
                  {showRowActions ? <TableHead /> : null}
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
                    {showRowActions ? (
                      <TableCell>
                        <AdminZone
                          name="order.shipment.row.actions"
                          props={{
                            orderId: props.orderId,
                            shipmentId: s.id,
                            deliveryMethodCode: props.deliveryMethodCode,
                            providerCode: providerCodeOf(s),
                            status: s.status,
                          }}
                        />
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
            {/* The carriers' own footer actions. A contributor decides for
                itself whether the latest attempt is one it can act on — the
                two nullable props are what it decides from — because `match`
                compares strings and has no negation. */}
            <AdminZone
              name="order.shipments.tab.actions"
              props={{
                orderId: props.orderId,
                deliveryMethodCode: props.deliveryMethodCode,
                latestShipmentId: latest?.id ?? null,
                latestStatus: latest?.status ?? null,
              }}
            />
          </div>
        </>
      )}
    </Section>
  );
}
