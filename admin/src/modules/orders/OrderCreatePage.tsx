import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { PageHeader } from '@/components/ui/page-header';
import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { CountrySelect } from '@/components/country-select';
import { ProductPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@/i18n/useTranslation';
import { useUnsavedChangesPrompt } from '@/lib/use-unsaved-changes-prompt';
import { formatMoney as formatMoneyShared } from '@/lib/money';

interface ItemRow {
  productId: string;
  quantity: number;
}

interface SalesChannelSummary {
  id: string;
  code: string;
  name: Record<string, string>;
  active: boolean;
}

interface MethodSummary {
  id: string;
  code: string;
  name: Record<string, string>;
  status: string;
}

/** Sales-channel / method names are localized maps; pick a display string. */
function pickName(name: Record<string, string> | undefined | null, fallback: string): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

interface AdminCustomerListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationName: string | null;
}

interface AddressSummary {
  id: string;
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

/** A new address typed inline on the form. */
interface InlineAddressFields {
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
}

/** Per address side: either an existing org address id, or a new inline one. */
type AddressChoice =
  | { mode: 'existing'; id: string }
  | { mode: 'new'; fields: InlineAddressFields; save: boolean };

const EMPTY_INLINE: InlineAddressFields = {
  recipientName: '',
  street: '',
  city: '',
  postalCode: '',
  country: '',
  phone: '',
};

function inlineComplete(f: InlineAddressFields): boolean {
  return (
    f.recipientName.trim().length > 0 &&
    f.street.trim().length > 0 &&
    f.city.trim().length > 0 &&
    f.postalCode.trim().length > 0 &&
    f.country.trim().length === 2
  );
}

function addressComplete(c: AddressChoice): boolean {
  return c.mode === 'existing' ? c.id.trim().length > 0 : inlineComplete(c.fields);
}

/** True when the choice carries something worth copying to the other side. */
function addressHasContent(c: AddressChoice): boolean {
  return c.mode === 'existing'
    ? c.id.trim().length > 0
    : Object.values(c.fields).some((v) => v.trim().length > 0);
}

/** Deep copy of an address choice so the two sides don't share mutable state. */
function cloneAddressChoice(c: AddressChoice): AddressChoice {
  return c.mode === 'existing'
    ? { mode: 'existing', id: c.id }
    : { mode: 'new', fields: { ...c.fields }, save: c.save };
}

interface PreviewLine {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: string;
  currency: string;
  lineTotal: number;
  unavailable?: boolean;
}

interface PreviewResponse {
  lines: PreviewLine[];
  summary: {
    subtotal: number;
    taxTotal: number;
    deliveryTotal: number;
    paymentSurcharge: number;
    discountTotal: number;
    total: number;
    currency: string;
  };
  messages: Array<{ productId: string; code: string }>;
}

const CUSTOMER_SEARCH_DEBOUNCE_MS = 250;
const PREVIEW_DEBOUNCE_MS = 250;

function customerLabel(c: AdminCustomerListItem): string {
  const name = `${c.firstName} ${c.lastName}`.trim();
  return name.length > 0 ? name : c.email;
}

function formatMoney(amount: number, currency: string): string {
  return formatMoneyShared(amount, currency);
}

/**
 * Debounced, server-side customer picker. Mirrors the catalog ProductPicker
 * pattern: searches `GET /api/v1/admin/customers?q=…` with a 250 ms debounce,
 * discards stale responses by sequence id, and caches seen rows so the closed
 * input keeps showing the selected customer once the dropdown paginates away.
 */
function CustomerPicker(props: {
  value: string | null;
  onChange: (next: string | null) => void;
}): ReactNode {
  const t = useTranslation('core');
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [cache, setCache] = useState<Map<string, AdminCustomerListItem>>(() => new Map());
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(
    () => (): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const runSearch = useCallback(
    async (query: string, seq: number): Promise<void> => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '20', status: 'active' });
        const trimmed = query.trim();
        if (trimmed.length > 0) params.set('q', trimmed);
        const res = await apiClient.get<{ data: AdminCustomerListItem[] }>(
          `/api/v1/admin/customers?${params.toString()}`,
        );
        if (seq !== seqRef.current) return;
        setCache((prev) => {
          const next = new Map(prev);
          for (const c of res.data) next.set(c.id, c);
          return next;
        });
        setOptions(
          res.data.map((c) => ({
            value: c.id,
            label: customerLabel(c),
            description: c.organizationName ? `${c.email} · ${c.organizationName}` : c.email,
          })),
        );
      } catch {
        if (seq !== seqRef.current) return;
        setOptions([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    },
    [],
  );

  const handleSearchChange = useCallback(
    (query: string): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      const seq = ++seqRef.current;
      timerRef.current = setTimeout(() => void runSearch(query, seq), CUSTOMER_SEARCH_DEBOUNCE_MS);
    },
    [runSearch],
  );

  const selected = props.value ? cache.get(props.value) : undefined;

  return (
    <Combobox<string>
      id="customerAccountId"
      ariaLabel="customerAccountId"
      options={options}
      value={props.value}
      selectedLabel={selected ? customerLabel(selected) : ''}
      onChange={props.onChange}
      onSearchChange={handleSearchChange}
      manualFilter
      loading={searching}
      placeholder={t('orderCreate.placeholder.customer')}
      emptyMessage={searching ? t('orderCreate.loading') : t('orderCreate.empty.customers')}
    />
  );
}

/**
 * One address side (delivery or billing): toggle between picking an existing
 * org address and typing a brand-new one (with an opt-in "save to address
 * book" checkbox). The new address is always snapshotted onto the order; the
 * checkbox controls whether it is also persisted to the org book for reuse.
 */
function AddressPicker(props: {
  idPrefix: string;
  heading: string;
  choice: AddressChoice;
  onChange: (next: AddressChoice) => void;
  options: ComboboxOption<string>[];
  disabled: boolean;
  loading: boolean;
  emptyMessage: string;
  copy?: { label: string; disabled: boolean; onCopy: () => void };
}): ReactNode {
  const t = useTranslation('core');
  const { choice, onChange, idPrefix } = props;

  const setField = (key: keyof InlineAddressFields, value: string): void => {
    if (choice.mode !== 'new') return;
    onChange({ ...choice, fields: { ...choice.fields, [key]: value } });
  };

  const inlineField = (key: keyof InlineAddressFields, label: string, required = true): ReactNode => (
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
      <Input
        id={`${idPrefix}-${key}`}
        aria-label={`${idPrefix}-${key}`}
        required={required}
        value={choice.mode === 'new' ? choice.fields[key] : ''}
        onChange={(e): void => setField(key, e.target.value)}
      />
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{props.heading}</Label>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={choice.mode === 'existing' ? 'default' : 'outline'}
            disabled={props.disabled}
            onClick={(): void => onChange({ mode: 'existing', id: '' })}
          >
            {t('orderCreate.address.mode.existing')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={choice.mode === 'new' ? 'default' : 'outline'}
            onClick={(): void => onChange({ mode: 'new', fields: { ...EMPTY_INLINE }, save: true })}
          >
            {t('orderCreate.address.mode.new')}
          </Button>
        </div>
      </div>

      {props.copy ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-auto px-0 text-xs"
          disabled={props.copy.disabled}
          onClick={props.copy.onCopy}
        >
          <Copy className="size-3" />
          {props.copy.label}
        </Button>
      ) : null}

      {choice.mode === 'existing' ? (
        <Combobox<string>
          id={`${idPrefix}-existing`}
          ariaLabel={`${idPrefix}-existing`}
          options={props.options}
          value={choice.id === '' ? null : choice.id}
          onChange={(next): void => onChange({ mode: 'existing', id: next ?? '' })}
          placeholder={t('orderCreate.placeholder.address')}
          disabled={props.disabled}
          loading={props.loading}
          emptyMessage={props.emptyMessage}
        />
      ) : (
        <div className="space-y-3 rounded-md border p-3">
          {inlineField('recipientName', t('orderCreate.address.field.recipientName'))}
          {inlineField('street', t('orderCreate.address.field.street'))}
          <div className="grid grid-cols-2 gap-3">
            {inlineField('postalCode', t('orderCreate.address.field.postalCode'))}
            {inlineField('city', t('orderCreate.address.field.city'))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-country`}>
                {t('orderCreate.address.field.country')}
              </Label>
              <CountrySelect
                id={`${idPrefix}-country`}
                ariaLabel={`${idPrefix}-country`}
                value={choice.mode === 'new' ? choice.fields.country : null}
                onChange={(code): void => setField('country', code ?? '')}
              />
            </div>
            {inlineField('phone', t('orderCreate.address.field.phone'), false)}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={choice.save}
              onChange={(e): void => onChange({ ...choice, save: e.target.checked })}
            />
            {t('orderCreate.address.saveToBook')}
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * OrderCreatePage — feature 038 (US3).
 *
 * Lets a sales rep / admin build an order for a customer: pick the customer,
 * sales channel, payment + delivery method, delivery + billing address (pick an
 * existing one or type a new one), and add line items. A live price summary —
 * computed from the chosen customer + channel via the pricing engine — mirrors
 * the cart/checkout totals. On submit the backend creates the order on-behalf
 * and notifies the customer to pay it.
 */
export function OrderCreatePage(): ReactNode {
  const t = useTranslation('core');
  const navigate = useNavigate();

  const [customerAccountId, setCustomerAccountId] = useState('');
  const [salesChannelId, setSalesChannelId] = useState('');
  const [deliveryMethodId, setDeliveryMethodId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [deliveryChoice, setDeliveryChoice] = useState<AddressChoice>({ mode: 'existing', id: '' });
  const [billingChoice, setBillingChoice] = useState<AddressChoice>({ mode: 'existing', id: '' });
  const [customerNote, setCustomerNote] = useState('');
  const [items, setItems] = useState<ItemRow[]>([{ productId: '', quantity: 1 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Warn before leaving with a partially-filled order draft.
  const dirty =
    !submitted &&
    (customerAccountId !== '' ||
      salesChannelId !== '' ||
      deliveryMethodId !== '' ||
      paymentMethodId !== '' ||
      customerNote !== '' ||
      addressHasContent(deliveryChoice) ||
      addressHasContent(billingChoice) ||
      items.some((it) => it.productId !== '' || it.quantity !== 1));
  useUnsavedChangesPrompt(dirty);

  // Static reference lists, loaded once on mount.
  const [channelOptions, setChannelOptions] = useState<ComboboxOption<string>[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<ComboboxOption<string>[]>([]);
  const [deliveryOptions, setDeliveryOptions] = useState<ComboboxOption<string>[]>([]);

  // Address lists, refetched whenever the customer changes.
  const [addressOptions, setAddressOptions] = useState<ComboboxOption<string>[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);

  // Live pricing preview.
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async (): Promise<void> => {
      try {
        const [channels, payments, deliveries] = await Promise.all([
          apiClient.get<{ items: SalesChannelSummary[] }>(
            '/api/v1/admin/sales-channels?pageSize=100&activeOnly=true',
          ),
          apiClient.get<{ data: MethodSummary[] }>('/api/v1/admin/payment-methods'),
          apiClient.get<{ data: MethodSummary[] }>('/api/v1/admin/delivery-methods'),
        ]);
        if (!alive) return;
        setChannelOptions(
          channels.items.map((c) => ({
            value: c.id,
            label: pickName(c.name, c.code),
            description: c.code,
          })),
        );
        setPaymentOptions(
          payments.data
            .filter((m) => m.status === 'active')
            .map((m) => ({ value: m.id, label: pickName(m.name, m.code), description: m.code })),
        );
        setDeliveryOptions(
          deliveries.data
            .filter((m) => m.status === 'active')
            .map((m) => ({ value: m.id, label: pickName(m.name, m.code), description: m.code })),
        );
      } catch (err) {
        if (!alive) return;
        setError(err instanceof ApiError ? err.envelope.error.message : t('orderCreate.loadError'));
      }
    })();
    return (): void => {
      alive = false;
    };
  }, [t]);

  // Load the selected customer's addresses; reset any prior address choices.
  useEffect(() => {
    setDeliveryChoice({ mode: 'existing', id: '' });
    setBillingChoice({ mode: 'existing', id: '' });
    setAddressOptions([]);
    if (!customerAccountId) return;
    let alive = true;
    setAddressesLoading(true);
    void (async (): Promise<void> => {
      try {
        const res = await apiClient.get<{
          data: { personal: AddressSummary[]; organization: AddressSummary[] };
        }>(`/api/v1/admin/customers/${customerAccountId}/addresses`);
        if (!alive) return;
        const toOption = (a: AddressSummary, group: string): ComboboxOption<string> => ({
          value: a.id,
          label: a.isDefault ? `${a.recipientName} ★` : a.recipientName,
          description: `${group} · ${a.street}, ${a.postalCode} ${a.city}, ${a.country}`,
        });
        // Only organization addresses are valid for placing an order (the order
        // service resolves the id against the org address book); personal
        // addresses are shown for context but cannot be used here.
        const opts = res.data.organization.map((a) =>
          toOption(a, t('orderCreate.address.group.organization')),
        );
        setAddressOptions(opts);
        // Pre-select the org's default (or first) address for both sides.
        const preferred =
          res.data.organization.find((a) => a.isDefault)?.id ?? opts[0]?.value ?? '';
        if (preferred) {
          setDeliveryChoice({ mode: 'existing', id: preferred });
          setBillingChoice({ mode: 'existing', id: preferred });
        }
      } catch {
        if (!alive) return;
        setAddressOptions([]);
      } finally {
        if (alive) setAddressesLoading(false);
      }
    })();
    return (): void => {
      alive = false;
    };
  }, [customerAccountId, t]);

  // Live pricing preview — debounced; fires whenever the priced inputs change.
  useEffect(() => {
    const validItems = items.filter((it) => it.productId.trim() && it.quantity > 0);
    if (!customerAccountId || !salesChannelId || validItems.length === 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let alive = true;
    const handle = setTimeout(() => {
      setPreviewLoading(true);
      setPreviewError(null);
      void apiClient
        .post<{ data: PreviewResponse }>('/api/v1/admin/orders/preview', {
          customerAccountId,
          salesChannelId,
          ...(deliveryMethodId ? { deliveryMethodId } : {}),
          ...(paymentMethodId ? { paymentMethodId } : {}),
          items: validItems.map((it) => ({ productId: it.productId, quantity: it.quantity })),
        })
        .then((res) => {
          if (alive) setPreview(res.data);
        })
        .catch(() => {
          if (!alive) return;
          setPreview(null);
          setPreviewError(t('orderCreate.preview.error'));
        })
        .finally(() => {
          if (alive) setPreviewLoading(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return (): void => {
      alive = false;
      clearTimeout(handle);
    };
  }, [customerAccountId, salesChannelId, deliveryMethodId, paymentMethodId, items, t]);

  const setItem = (i: number, patch: Partial<ItemRow>): void =>
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const addRow = (): void => setItems((prev) => [...prev, { productId: '', quantity: 1 }]);
  const removeRow = (i: number): void => setItems((prev) => prev.filter((_, idx) => idx !== i));

  // Per-line price lookup for the items table (keyed by product + quantity;
  // identical keys necessarily resolve to the same price).
  const lineByKey = new Map<string, PreviewLine>();
  for (const line of preview?.lines ?? []) lineByKey.set(`${line.productId}:${line.quantity}`, line);
  const hasUnavailable = (preview?.messages.length ?? 0) > 0;

  const canSubmit =
    !!customerAccountId.trim() &&
    !!salesChannelId.trim() &&
    !!deliveryMethodId.trim() &&
    !!paymentMethodId.trim() &&
    addressComplete(deliveryChoice) &&
    addressComplete(billingChoice) &&
    items.some((it) => it.productId.trim() && it.quantity > 0) &&
    !hasUnavailable;

  const addressPayload = (
    c: AddressChoice,
    idKey: 'deliveryAddressId' | 'billingAddressId',
    inlineKey: 'deliveryAddress' | 'billingAddress',
  ): Record<string, unknown> => {
    if (c.mode === 'existing') return { [idKey]: c.id.trim() };
    return {
      [inlineKey]: {
        recipientName: c.fields.recipientName.trim(),
        street: c.fields.street.trim(),
        city: c.fields.city.trim(),
        postalCode: c.fields.postalCode.trim(),
        country: c.fields.country.trim().toUpperCase(),
        ...(c.fields.phone.trim() ? { phone: c.fields.phone.trim() } : {}),
        saveToAddressBook: c.save,
      },
    };
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ data: { id: string } }>('/api/v1/admin/orders', {
        customerAccountId: customerAccountId.trim(),
        salesChannelId: salesChannelId.trim(),
        deliveryMethodId: deliveryMethodId.trim(),
        paymentMethodId: paymentMethodId.trim(),
        ...addressPayload(deliveryChoice, 'deliveryAddressId', 'deliveryAddress'),
        ...addressPayload(billingChoice, 'billingAddressId', 'billingAddress'),
        ...(customerNote.trim() ? { customerNote: customerNote.trim() } : {}),
        items: items
          .filter((it) => it.productId.trim() && it.quantity > 0)
          .map((it) => ({ productId: it.productId.trim(), quantity: it.quantity })),
      });
      setSubmitted(true);
      navigate(`/orders/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('orderCreate.error'));
    } finally {
      setBusy(false);
    }
  };

  const selectField = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: ComboboxOption<string>[],
    opts?: { placeholder?: string },
  ): ReactNode => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Combobox<string>
        id={id}
        ariaLabel={id}
        options={options}
        value={value === '' ? null : value}
        onChange={(next): void => onChange(next ?? '')}
        placeholder={opts?.placeholder ?? t('orderCreate.placeholder.select')}
        emptyMessage={t('orderCreate.empty.options')}
      />
    </div>
  );

  const addressEmptyMessage = !customerAccountId
    ? t('orderCreate.address.selectCustomerFirst')
    : addressesLoading
      ? t('orderCreate.loading')
      : t('orderCreate.address.none');

  const summaryRow = (label: string, value: number, currency: string, strong = false): ReactNode => (
    <div className={`flex justify-between text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span>{formatMoney(value, currency)}</span>
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('orderCreate.title')}
        description={t('orderCreate.description')}
        actions={
          <Button asChild variant="outline">
            <Link to="/orders">
              <ArrowLeft />
              {t('common.action.back')}
            </Link>
          </Button>
        }
      />

      <RouteTabsZone name="order.entry.tabs" props={{}} className="mb-4" />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('orderCreate.section.parties')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="customerAccountId">{t('orderCreate.field.customer')}</Label>
            <CustomerPicker
              value={customerAccountId === '' ? null : customerAccountId}
              onChange={(next): void => setCustomerAccountId(next ?? '')}
            />
          </div>
          {selectField(
            'salesChannelId',
            t('orderCreate.field.salesChannel'),
            salesChannelId,
            setSalesChannelId,
            channelOptions,
          )}
          {selectField(
            'paymentMethodId',
            t('orderCreate.field.paymentMethod'),
            paymentMethodId,
            setPaymentMethodId,
            paymentOptions,
          )}
          {selectField(
            'deliveryMethodId',
            t('orderCreate.field.deliveryMethod'),
            deliveryMethodId,
            setDeliveryMethodId,
            deliveryOptions,
          )}
          <AddressPicker
            idPrefix="deliveryAddress"
            heading={t('orderCreate.address.deliveryHeading')}
            choice={deliveryChoice}
            onChange={setDeliveryChoice}
            options={addressOptions}
            disabled={!customerAccountId}
            loading={addressesLoading}
            emptyMessage={addressEmptyMessage}
            copy={{
              label: t('orderCreate.address.copyFromBilling'),
              disabled: !addressHasContent(billingChoice),
              onCopy: (): void => setDeliveryChoice(cloneAddressChoice(billingChoice)),
            }}
          />
          <AddressPicker
            idPrefix="billingAddress"
            heading={t('orderCreate.address.billingHeading')}
            choice={billingChoice}
            onChange={setBillingChoice}
            options={addressOptions}
            disabled={!customerAccountId}
            loading={addressesLoading}
            emptyMessage={addressEmptyMessage}
            copy={{
              label: t('orderCreate.address.copyFromDelivery'),
              disabled: !addressHasContent(deliveryChoice),
              onCopy: (): void => setBillingChoice(cloneAddressChoice(deliveryChoice)),
            }}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('orderCreate.section.items')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((row, i) => {
            const line = row.productId ? lineByKey.get(`${row.productId}:${row.quantity}`) : undefined;
            return (
              <div key={i} className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`product-${i}`}>{t('orderCreate.field.product')}</Label>
                  <ProductPicker
                    mode="select"
                    id={`product-${i}`}
                    ariaLabel={`product-${i}`}
                    value={row.productId === '' ? null : row.productId}
                    onChange={(next): void => setItem(i, { productId: next ?? '' })}
                    placeholder={t('orderCreate.placeholder.product')}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label htmlFor={`qty-${i}`}>{t('orderCreate.field.quantity')}</Label>
                  <Input
                    id={`qty-${i}`}
                    aria-label={`qty-${i}`}
                    type="number"
                    min={1}
                    value={row.quantity}
                    onChange={(e): void => setItem(i, { quantity: Number(e.target.value) })}
                  />
                </div>
                <div className="w-32 pb-2 text-right text-sm">
                  {line ? (
                    line.unavailable ? (
                      <span className="text-destructive">{t('orderCreate.line.unavailable')}</span>
                    ) : (
                      <>
                        <div className="text-muted-foreground">
                          {formatMoney(Number(line.unitPrice), line.currency)}
                        </div>
                        <div className="font-medium">
                          {formatMoney(line.lineTotal, line.currency)}
                        </div>
                      </>
                    )
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`remove-item-${i}`}
                  disabled={items.length === 1}
                  onClick={(): void => removeRow(i)}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus />
            {t('orderCreate.addItem')}
          </Button>
        </CardContent>
      </Card>

      {preview ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('orderCreate.summary.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {hasUnavailable ? (
              <Alert variant="destructive">
                <AlertDescription>{t('orderCreate.notice.unavailableLines')}</AlertDescription>
              </Alert>
            ) : null}
            {summaryRow(t('orderCreate.summary.subtotal'), preview.summary.subtotal, preview.summary.currency)}
            {summaryRow(t('orderCreate.summary.tax'), preview.summary.taxTotal, preview.summary.currency)}
            {summaryRow(t('orderCreate.summary.delivery'), preview.summary.deliveryTotal, preview.summary.currency)}
            {preview.summary.paymentSurcharge > 0
              ? summaryRow(
                  t('orderCreate.summary.paymentSurcharge'),
                  preview.summary.paymentSurcharge,
                  preview.summary.currency,
                )
              : null}
            {preview.summary.discountTotal > 0
              ? summaryRow(
                  t('orderCreate.summary.discount'),
                  -preview.summary.discountTotal,
                  preview.summary.currency,
                )
              : null}
            <Separator />
            {summaryRow(t('orderCreate.summary.total'), preview.summary.total, preview.summary.currency, true)}
          </CardContent>
        </Card>
      ) : null}

      {previewError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{previewError}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="space-y-3 pt-6">
          <div className="space-y-1">
            <Label htmlFor="customerNote">{t('orderCreate.field.note')}</Label>
            <textarea
              id="customerNote"
              aria-label="customerNote"
              className="min-h-20 w-full rounded-md border p-2 text-sm"
              value={customerNote}
              onChange={(e): void => setCustomerNote(e.target.value)}
            />
          </div>
          <Button disabled={!canSubmit || busy || previewLoading} onClick={(): void => void submit()}>
            {t('orderCreate.submit')}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
