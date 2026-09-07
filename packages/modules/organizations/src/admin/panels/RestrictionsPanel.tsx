import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface MethodOption {
  id: string;
  /** display name — falls back to code when the locale-keyed name is missing. */
  label: string;
}

interface WarehouseOption {
  id: string;
  label: string;
}

interface RestrictionsRead {
  organizationId: string;
  paymentMethodIds: string[];
  deliveryMethodIds: string[];
  warehouseIds: string[];
  version: number;
}

export interface RestrictionsPanelProps {
  organizationId: string;
  /** Current Organization version — required for optimistic-lock writes. */
  version: number;
  /** Called after a successful save so the parent can re-fetch (version bumped). */
  onChanged: () => void | Promise<void>;
}

/**
 * Per-Organization allow-list editor for payment methods, delivery
 * methods, and assigned warehouses (feature 026 US4).
 *
 * Empty list = "platform defaults apply" — the panel makes this
 * explicit via an inline hint underneath each section. A single
 * "Save restrictions" action atomically PUTs all three lists; the
 * server returns the new version which the parent picks up on its
 * next refresh.
 *
 * The current Organization version is gated by an optimistic-lock
 * check; on 409 the panel surfaces a friendly "refresh and retry"
 * alert instead of silently overwriting.
 */
export function RestrictionsPanel(props: RestrictionsPanelProps): ReactNode {
  const t = useTranslation('core');

  const [paymentMethods, setPaymentMethods] = useState<MethodOption[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<MethodOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);

  const [selectedPayment, setSelectedPayment] = useState<Set<string>>(new Set());
  const [selectedDelivery, setSelectedDelivery] = useState<Set<string>>(new Set());
  const [selectedWarehouses, setSelectedWarehouses] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [pms, dms, whs, current] = await Promise.all([
        apiClient.get<{ data: Array<{ id: string; name: Record<string, string>; code: string }> }>(
          '/api/v1/admin/payment-methods?pageSize=200',
        ),
        apiClient.get<{ data: Array<{ id: string; name: Record<string, string>; code: string }> }>(
          '/api/v1/admin/delivery-methods?pageSize=200',
        ),
        apiClient.get<{ items: Array<{ id: string; name: string; code: string }> }>(
          '/api/v1/admin/warehouses?pageSize=200&activeOnly=true',
        ),
        apiClient.get<{ data: RestrictionsRead }>(
          `/api/v1/admin/organizations/${props.organizationId}/restrictions`,
        ),
      ]);
      setPaymentMethods(
        (pms.data ?? []).map((m) => ({ id: m.id, label: pickLabel(m.name, m.code) })),
      );
      setDeliveryMethods(
        (dms.data ?? []).map((m) => ({ id: m.id, label: pickLabel(m.name, m.code) })),
      );
      setWarehouses(
        (whs.items ?? []).map((w) => ({ id: w.id, label: w.name || w.code })),
      );
      setSelectedPayment(new Set(current.data.paymentMethodIds));
      setSelectedDelivery(new Set(current.data.deliveryMethodIds));
      setSelectedWarehouses(new Set(current.data.warehouseIds));
      setDirty(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('organizations.restrictions.error.load'),
      );
    } finally {
      setLoading(false);
    }
  }, [props.organizationId, t]);

  useEffect((): void => {
    void loadAll();
  }, [loadAll]);

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.put(`/api/v1/admin/organizations/${props.organizationId}/restrictions`, {
        expectedVersion: props.version,
        paymentMethodIds: [...selectedPayment],
        deliveryMethodIds: [...selectedDelivery],
        warehouseIds: [...selectedWarehouses],
      });
      setInfo(t('organizations.restrictions.success.save'));
      setDirty(false);
      await props.onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t('organizations.restrictions.error.conflict'));
      } else {
        setError(
          err instanceof ApiError
            ? err.envelope.error.message
            : t('organizations.restrictions.error.save'),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('organizations.restrictions.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert variant="success">
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
        ) : (
          <>
            <Section
              title={t('organizations.restrictions.paymentMethods.title')}
              emptyHint={t('organizations.restrictions.emptyHint')}
              options={paymentMethods}
              selected={selectedPayment}
              onToggle={(id): void => {
                setSelectedPayment((s) => toggle(s, id));
                setDirty(true);
              }}
            />
            <Section
              title={t('organizations.restrictions.deliveryMethods.title')}
              emptyHint={t('organizations.restrictions.emptyHint')}
              options={deliveryMethods}
              selected={selectedDelivery}
              onToggle={(id): void => {
                setSelectedDelivery((s) => toggle(s, id));
                setDirty(true);
              }}
            />
            <Section
              title={t('organizations.restrictions.warehouses.title')}
              emptyHint={t('organizations.restrictions.warehousesEmptyHint')}
              options={warehouses}
              selected={selectedWarehouses}
              onToggle={(id): void => {
                setSelectedWarehouses((s) => toggle(s, id));
                setDirty(true);
              }}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={(): void => void loadAll()} disabled={busy}>
                {t('common.action.cancel')}
              </Button>
              <Button onClick={(): void => void save()} disabled={busy || !dirty}>
                {t('organizations.restrictions.action.save')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface SectionProps {
  title: string;
  emptyHint: string;
  options: Array<{ id: string; label: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}

function Section(props: SectionProps): ReactNode {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">{props.title}</h4>
      {props.options.length === 0 ? (
        <p className="text-xs text-muted-foreground">— none configured</p>
      ) : (
        <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
          {props.options.map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={props.selected.has(opt.id)}
                onChange={(): void => props.onToggle(opt.id)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
      {props.selected.size === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{props.emptyHint}</p>
      ) : null}
    </div>
  );
}

function pickLabel(name: Record<string, string> | undefined, fallback: string): string {
  if (!name) return fallback;
  return name['en'] ?? name['pl'] ?? Object.values(name)[0] ?? fallback;
}
