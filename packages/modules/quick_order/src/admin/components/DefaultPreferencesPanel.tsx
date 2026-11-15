import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { quickOrderPreferenceUpsertSchema, type EditorSaveSessionHandle } from '@endora-commerce/contracts';
import {
  ApiError,
  INERT_SAVE_SESSION,
  apiClient,
  useSaveParticipant,
  type ParticipantIssues,
  type SaveParticipantHandlers,
} from '@endora-commerce/admin-kit/lib';
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
 *
 * ## Under a page Save (feature 180, WP-7)
 *
 * Handed a host's `saveSession`, the panel is the part `ordering-defaults` of that host's one
 * Save (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §2, FR-060): the
 * selects stage the four values, one change per changed value, and the host's Save writes them
 * through the same `PUT …/quick-order/preferences`. The panel's own Save button and its "Saved"
 * line are not rendered — the host's Save reports the outcome. Validation is the contracts
 * request schema; the server adds no rule beyond it (research R20). The write stays unversioned,
 * last write wins, as before (research R11).
 *
 * Without a session — the customer detail, until its own work package (WP-8) hands one — the
 * panel keeps its own Save. That branch goes when the last host adopts.
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
  /** The host editor's save session (feature 180); without one the panel keeps its own Save. */
  saveSession?: EditorSaveSessionHandle;
}

/** The four values as the selects hold them: `''` is "no default" / "inherit". */
interface PreferenceDraft {
  payment: string;
  delivery: string;
  billing: string;
  shipping: string;
}

const DRAFT_FIELDS = ['payment', 'delivery', 'billing', 'shipping'] as const;

function upsertOf(scope: PreferenceScope, scopeId: string, draft: PreferenceDraft): QuickOrderPreferenceUpsert {
  return {
    scope,
    scopeId,
    defaultPaymentMethodId: draft.payment || null,
    defaultDeliveryMethodId: draft.delivery || null,
    defaultBillingAddressId: draft.billing || null,
    defaultShippingAddressId: draft.shipping || null,
  };
}

function pickLabel(name: Record<string, string> | undefined, fallback: string): string {
  if (!name) return fallback;
  return name['en'] ?? name['pl'] ?? Object.values(name)[0] ?? fallback;
}

function addressLabel(a: AdminAddressRow): string {
  return `${a.recipientName} — ${a.street}, ${a.postalCode} ${a.city}`;
}

export function DefaultPreferencesPanel(props: DefaultPreferencesPanelProps): ReactNode {
  const { scope, scopeId, saveSession } = props;
  const t = useTranslation('core');
  const own = useTranslation('quick_order');

  const [paymentMethods, setPaymentMethods] = useState<Option[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<Option[]>([]);
  const [addresses, setAddresses] = useState<AddressOption[]>([]);

  // The stored values; `null` while the read is in flight or after it failed, so a panel that
  // could not load takes no part in its host's Save.
  const [stored, setStored] = useState<PreferenceDraft | null>(null);
  // Standalone (no session): the values the operator picked.
  const [local, setLocal] = useState<PreferenceDraft | null>(null);

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

      const values: PreferenceDraft = {
        payment: current?.defaultPaymentMethodId ?? '',
        delivery: current?.defaultDeliveryMethodId ?? '',
        billing: current?.defaultBillingAddressId ?? '',
        shipping: current?.defaultShippingAddressId ?? '',
      };
      setStored(values);
      setLocal(values);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('defaultPreferences.loadError'));
    } finally {
      setLoading(false);
    }
  }, [scope, scopeId, t]);

  useEffect((): void => {
    void loadAll();
  }, [loadAll]);

  // Feature 180 — the part this panel plays in its host's Save. Pure of component state: the
  // session may run it after the panel has unmounted.
  const inSession = saveSession !== undefined;
  const handlers = useMemo<SaveParticipantHandlers<PreferenceDraft>>(
    () => ({
      changeCount: (draft, baseline) => DRAFT_FIELDS.filter((field) => draft[field] !== baseline[field]).length,
      validate: async (draft): Promise<ParticipantIssues> =>
        quickOrderPreferenceUpsertSchema.safeParse(upsertOf(scope, scopeId, draft)).success
          ? { fields: {} }
          : { fields: {}, message: t('defaultPreferences.saveError') },
      save: async (draft): Promise<PreferenceDraft> => {
        await writePreference(upsertOf(scope, scopeId, draft));
        return draft;
      },
    }),
    [scope, scopeId, t],
  );
  const participant = useSaveParticipant<PreferenceDraft>(
    saveSession ?? INERT_SAVE_SESSION,
    { key: 'ordering-defaults', label: own('defaultPreferences.partLabel'), writable: inSession, loaded: stored },
    handlers,
  );
  const values: PreferenceDraft = (inSession ? participant.draft : local) ?? stored ?? {
    payment: '',
    delivery: '',
    billing: '',
    shipping: '',
  };
  const change = (field: (typeof DRAFT_FIELDS)[number], value: string): void => {
    if (inSession) {
      participant.setDraft((previous) => ({ ...previous, [field]: value }));
      return;
    }
    setLocal((previous) => (previous === null ? previous : { ...previous, [field]: value }));
  };
  const shownError = inSession ? (participant.error ?? participant.issues?.message ?? error) : error;

  const save = useCallback(async (): Promise<void> => {
    if (busy || local === null) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await writePreference(upsertOf(scope, scopeId, local));
      setInfo(t('defaultPreferences.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('defaultPreferences.saveError'));
    } finally {
      setBusy(false);
    }
  }, [busy, scope, scopeId, local, t]);

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

        {shownError ? (
          <Alert variant="destructive">
            <AlertDescription>{shownError}</AlertDescription>
          </Alert>
        ) : null}
        {info && !inSession ? (
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
                value={values.payment}
                options={paymentMethods}
                onChange={(value): void => change('payment', value)}
                disabled={participant.status === 'saving'}
              />
              <PrefSelect
                id="pref-delivery"
                label={t('defaultPreferences.deliveryMethod')}
                emptyLabel={emptyLabel}
                value={values.delivery}
                options={deliveryMethods}
                onChange={(value): void => change('delivery', value)}
                disabled={participant.status === 'saving'}
              />
              <PrefSelect
                id="pref-billing"
                label={t('defaultPreferences.billingAddress')}
                emptyLabel={emptyLabel}
                value={values.billing}
                options={billingAddresses}
                onChange={(value): void => change('billing', value)}
                disabled={participant.status === 'saving'}
              />
              <PrefSelect
                id="pref-shipping"
                label={t('defaultPreferences.shippingAddress')}
                emptyLabel={emptyLabel}
                value={values.shipping}
                options={shippingAddresses}
                onChange={(value): void => change('shipping', value)}
                disabled={participant.status === 'saving'}
              />
            </div>
            {inSession ? null : (
              <div className="flex justify-end">
                <Button onClick={(): void => void save()} disabled={busy}>
                  {t('defaultPreferences.save')}
                </Button>
              </div>
            )}
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
  disabled?: boolean;
}

function PrefSelect(props: PrefSelectProps): ReactNode {
  // Keep the stored value selectable even when it is no longer in the
  // available list (e.g. an address that was since deleted, or a method the
  // caller cannot see) so saving does not silently drop it.
  const known = props.options.some((o) => o.id === props.value);
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Select
        id={props.id}
        value={props.value}
        disabled={props.disabled}
        onChange={(e): void => props.onChange(e.target.value)}
      >
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
