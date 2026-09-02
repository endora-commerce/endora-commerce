import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * DefaultPreferencesPanel — feature 039 (US2 / FR-018).
 *
 * Embedded editor for an organization's or customer's default ordering
 * preferences (payment / delivery method + billing / shipping address). It is
 * mounted on the Customer and Organization edit pages so the configuration
 * lives next to the entity it belongs to — the standalone admin page was
 * removed in favour of this panel.
 *
 * Scope + scopeId are fixed by the host page; the four values are picked from
 * dropdowns populated with the real methods / addresses available for that
 * scope. For the customer scope an empty value means "inherit the
 * organization default"; for the organization scope it means "no default".
 *
 * ## Why the calls are rebuilt rather than the client moved (feature 091, P7b)
 *
 * The file used to live at `admin/src/modules/quick_order/`, imported by path
 * from `organizations`' and `customers`' detail screens — the two
 * `DefaultPreferencesPanel` keys of the boundary ledger, one in each shard. It
 * is this module's panel, so it lives in this module's package and reaches both
 * screens as `organization.detail.after` and `customer.detail.after`
 * contributions instead.
 *
 * `admin/src/modules/quick_order/api/quick-order-client.ts` did **not** travel
 * with it: `QuickOrderOnBehalfPage` still imports that file, and moving it here
 * would leave a package reaching back into the admin application. Its two
 * preference bindings are HTTP paths over a payload this file already declares,
 * so they are rebuilt from the published `apiClient` (P2's exit) — twelve lines
 * against a reach.
 *
 * The copy stays in the `core` namespace rather than moving to this module's
 * own, on P7a's reading of `contracts/admin-component-contribution.md` §9.2:
 * that population is 62 files wide and no P7 row is the merge request that
 * answers it.
 */

/** Which entity the defaults belong to. */
export type PreferenceScope = 'organization' | 'customer';

interface QuickOrderPreference {
  scope: PreferenceScope;
  scopeId: string;
  defaultPaymentMethodId: string | null;
  defaultDeliveryMethodId: string | null;
  defaultBillingAddressId: string | null;
  defaultShippingAddressId: string | null;
}

interface QuickOrderPreferenceUpsert {
  scope: PreferenceScope;
  scopeId: string;
  defaultPaymentMethodId: string | null;
  defaultDeliveryMethodId: string | null;
  defaultBillingAddressId: string | null;
  defaultShippingAddressId: string | null;
}

async function readPreference(
  scope: PreferenceScope,
  scopeId: string,
): Promise<QuickOrderPreference | null> {
  const res = await apiClient.get<{ data: QuickOrderPreference | null }>(
    `/api/v1/admin/quick-order/preferences?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`,
  );
  return res.data;
}

async function writePreference(body: QuickOrderPreferenceUpsert): Promise<void> {
  await apiClient.put('/api/v1/admin/quick-order/preferences', body);
}

interface Option {
  id: string;
  label: string;
}

interface AddressOption extends Option {
  kind: 'delivery' | 'billing';
}

interface AdminAddressRow {
  id: string;
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
}

export interface DefaultPreferencesPanelProps {
  scope: PreferenceScope;
  scopeId: string;
}

function pickLabel(name: Record<string, string> | undefined, fallback: string): string {
  if (!name) return fallback;
  return name['en'] ?? name['pl'] ?? Object.values(name)[0] ?? fallback;
}

function addressLabel(a: AdminAddressRow): string {
  return `${a.recipientName} — ${a.street}, ${a.postalCode} ${a.city}`;
}

export function DefaultPreferencesPanel(props: DefaultPreferencesPanelProps): ReactNode {
  const { scope, scopeId } = props;
  const t = useTranslation('core');

  const [paymentMethods, setPaymentMethods] = useState<Option[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<Option[]>([]);
  const [addresses, setAddresses] = useState<AddressOption[]>([]);

  const [payment, setPayment] = useState('');
  const [delivery, setDelivery] = useState('');
  const [billing, setBilling] = useState('');
  const [shipping, setShipping] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const addressesReq =
        scope === 'customer'
          ? apiClient
              .get<{ data: { personal: AdminAddressRow[]; organization: AdminAddressRow[] } }>(
                `/api/v1/admin/customers/${scopeId}/addresses`,
              )
              .then((res) => [...res.data.personal, ...res.data.organization])
          : apiClient
              .get<{ data: AdminAddressRow[] }>(`/api/v1/admin/organizations/${scopeId}/addresses`)
              .then((res) => res.data);

      const [pms, dms, addrRows, current] = await Promise.all([
        apiClient.get<{ data: Array<{ id: string; name: Record<string, string>; code: string }> }>(
          '/api/v1/admin/payment-methods?pageSize=200',
        ),
        apiClient.get<{ data: Array<{ id: string; name: Record<string, string>; code: string }> }>(
          '/api/v1/admin/delivery-methods?pageSize=200',
        ),
        addressesReq,
        readPreference(scope, scopeId),
      ]);

      setPaymentMethods((pms.data ?? []).map((m) => ({ id: m.id, label: pickLabel(m.name, m.code) })));
      setDeliveryMethods((dms.data ?? []).map((m) => ({ id: m.id, label: pickLabel(m.name, m.code) })));
      setAddresses(
        (addrRows ?? []).map((a) => ({ id: a.id, kind: a.kind, label: addressLabel(a) })),
      );

      setPayment(current?.defaultPaymentMethodId ?? '');
      setDelivery(current?.defaultDeliveryMethodId ?? '');
      setBilling(current?.defaultBillingAddressId ?? '');
      setShipping(current?.defaultShippingAddressId ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('defaultPreferences.loadError'));
    } finally {
      setLoading(false);
    }
  }, [scope, scopeId, t]);

  useEffect((): void => {
    void loadAll();
  }, [loadAll]);

  const save = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await writePreference({
        scope,
        scopeId,
        defaultPaymentMethodId: payment || null,
        defaultDeliveryMethodId: delivery || null,
        defaultBillingAddressId: billing || null,
        defaultShippingAddressId: shipping || null,
      });
      setInfo(t('defaultPreferences.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('defaultPreferences.saveError'));
    } finally {
      setBusy(false);
    }
  }, [busy, scope, scopeId, payment, delivery, billing, shipping, t]);

  const emptyLabel = scope === 'customer' ? t('defaultPreferences.inherit') : t('defaultPreferences.none');
  const billingAddresses = addresses.filter((a) => a.kind === 'billing');
  const shippingAddresses = addresses.filter((a) => a.kind === 'delivery');

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('defaultPreferences.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('defaultPreferences.description')}</p>

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
            <div className="grid gap-4 md:grid-cols-2">
              <PrefSelect
                id="pref-payment"
                label={t('defaultPreferences.paymentMethod')}
                emptyLabel={emptyLabel}
                value={payment}
                options={paymentMethods}
                onChange={setPayment}
              />
              <PrefSelect
                id="pref-delivery"
                label={t('defaultPreferences.deliveryMethod')}
                emptyLabel={emptyLabel}
                value={delivery}
                options={deliveryMethods}
                onChange={setDelivery}
              />
              <PrefSelect
                id="pref-billing"
                label={t('defaultPreferences.billingAddress')}
                emptyLabel={emptyLabel}
                value={billing}
                options={billingAddresses}
                onChange={setBilling}
              />
              <PrefSelect
                id="pref-shipping"
                label={t('defaultPreferences.shippingAddress')}
                emptyLabel={emptyLabel}
                value={shipping}
                options={shippingAddresses}
                onChange={setShipping}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={(): void => void save()} disabled={busy}>
                {t('defaultPreferences.save')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface PrefSelectProps {
  id: string;
  label: string;
  emptyLabel: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}

function PrefSelect(props: PrefSelectProps): ReactNode {
  // Keep the stored value selectable even when it is no longer in the
  // available list (e.g. an address that was since deleted, or a method the
  // caller cannot see) so saving does not silently drop it.
  const known = props.options.some((o) => o.id === props.value);
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Select id={props.id} value={props.value} onChange={(e): void => props.onChange(e.target.value)}>
        <option value="">{props.emptyLabel}</option>
        {props.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {props.value && !known ? <option value={props.value}>{props.value}</option> : null}
      </Select>
    </div>
  );
}
