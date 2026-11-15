import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
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

/** The three allow-lists, as the restrictions `PUT` takes them. */
export interface RestrictionsSelection {
  readonly paymentMethodIds: readonly string[];
  readonly deliveryMethodIds: readonly string[];
  readonly warehouseIds: readonly string[];
}

const LISTS = ['paymentMethodIds', 'deliveryMethodIds', 'warehouseIds'] as const;

/** How many of the three lists differ — order within a list does not count. */
export function changedRestrictionLists(draft: RestrictionsSelection, stored: RestrictionsSelection): number {
  return LISTS.filter((list) => {
    const before = new Set(stored[list]);
    return draft[list].length !== before.size || draft[list].some((id) => !before.has(id));
  }).length;
}

export interface RestrictionsPanelProps {
  organizationId: string;
  /** The host's draft of the lists; `null` shows what is stored. */
  value: RestrictionsSelection | null;
  onChange: (next: RestrictionsSelection) => void;
  /** Told the stored lists each time they are read. */
  onLoaded: (stored: RestrictionsSelection) => void;
  /** A new value re-reads the stored lists (after a save, after a reload). */
  reloadKey: number;
  /** While the page's Save runs. */
  disabled?: boolean;
}

/**
 * Per-Organization allow-list editor for payment methods, delivery
 * methods, and assigned warehouses (feature 026 US4).
 *
 * Empty list = "platform defaults apply" — the panel makes this
 * explicit via an inline hint underneath each section.
 *
 * **A section of the organization detail's one Save** (feature 180, WP-7;
 * `specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §2). The
 * panel reads the options and the stored lists and shows the host's draft; it
 * has no Save or Cancel of its own any more. The page's Save writes the lists
 * in its host part, after the organization `PATCH`, through the same
 * `PUT …/restrictions` gated by the Organization's `version` — the version that
 * `PATCH` answered, so the two writes of one Save do not race each other.
 */
export function RestrictionsPanel(props: RestrictionsPanelProps): ReactNode {
  const t = useTranslation('core');
  const { organizationId, value, onChange, onLoaded, reloadKey, disabled = false } = props;

  const [paymentMethods, setPaymentMethods] = useState<MethodOption[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<MethodOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [stored, setStored] = useState<RestrictionsSelection | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The host's callback, read when a load answers rather than re-running the load.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

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
          `/api/v1/admin/organizations/${organizationId}/restrictions`,
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
      const lists: RestrictionsSelection = {
        paymentMethodIds: current.data.paymentMethodIds,
        deliveryMethodIds: current.data.deliveryMethodIds,
        warehouseIds: current.data.warehouseIds,
      };
      setStored(lists);
      onLoadedRef.current(lists);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('organizations.restrictions.error.load'),
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId, t]);

  useEffect((): void => {
    void loadAll();
  }, [loadAll, reloadKey]);

  const shown = value ?? stored;
  const toggle = (list: (typeof LISTS)[number], id: string): void => {
    if (shown === null || disabled) return;
    const current = shown[list];
    onChange({
      ...shown,
      [list]: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    });
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

        {loading && shown === null ? (
          <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
        ) : shown === null ? null : (
          <>
            <Section
              title={t('organizations.restrictions.paymentMethods.title')}
              emptyHint={t('organizations.restrictions.emptyHint')}
              options={paymentMethods}
              selected={shown.paymentMethodIds}
              disabled={disabled}
              onToggle={(id): void => toggle('paymentMethodIds', id)}
            />
            <Section
              title={t('organizations.restrictions.deliveryMethods.title')}
              emptyHint={t('organizations.restrictions.emptyHint')}
              options={deliveryMethods}
              selected={shown.deliveryMethodIds}
              disabled={disabled}
              onToggle={(id): void => toggle('deliveryMethodIds', id)}
            />
            <Section
              title={t('organizations.restrictions.warehouses.title')}
              emptyHint={t('organizations.restrictions.warehousesEmptyHint')}
              options={warehouses}
              selected={shown.warehouseIds}
              disabled={disabled}
              onToggle={(id): void => toggle('warehouseIds', id)}
            />
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
  selected: readonly string[];
  disabled: boolean;
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
                checked={props.selected.includes(opt.id)}
                disabled={props.disabled}
                onChange={(): void => props.onToggle(opt.id)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
      {props.selected.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{props.emptyHint}</p>
      ) : null}
    </div>
  );
}

function pickLabel(name: Record<string, string> | undefined, fallback: string): string {
  if (!name) return fallback;
  return name['en'] ?? name['pl'] ?? Object.values(name)[0] ?? fallback;
}
