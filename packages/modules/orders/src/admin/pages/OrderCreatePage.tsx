import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, Info, Split, Trash2 } from 'lucide-react';
import type {
  AdminOrderPreviewMessageCode,
  OrganizationSalesChannelOption,
  OrganizationSalesChannelsResponse,
} from '@endora-commerce/contracts';
import {
  ApiError,
  apiClient,
  useUnsavedChangesPrompt,
  formatMoney as formatMoneyShared,
  type FormatMoneyOptions,
} from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Separator,
  PageHeader,
  Combobox,
  TableCell,
  TableHead,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import type { ComboboxOption } from '@endora-commerce/admin-kit/ui';
import {
  CountrySelect,
  LineGroupsEditor,
  ProductBrowserDialog,
  ProductBrowserTrigger,
  ProductPicker,
  SplitLineDialog,
  canSplitLine,
  parsePositiveInt,
  productDisplayName,
  splitLineInto,
  type ProductBrowserItem,
  type ProductBrowserRules,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
import {
  OrderSectionSummary,
  orderSectionTotals,
  useOrderLineGroupLabels,
  useOrderSectionSummaryText,
  useOrderSplitLineLabels,
} from '../line-groups.js';

/**
 * One order line (feature 145, FR-022). Keyed by its own `key`: one product may be
 * on several lines — in different groups, or twice in one (feature 159, research
 * N-31) — so the picker and the quick search offer a product already a line again.
 * `quantityInput` is what the operator typed — kept as text so an invalid entry
 * stays on screen, marked, instead of being coerced away.
 */
interface ItemRow {
  /** The line's identity — the grouping editor's, the preview lookup's and the row's DOM ids. */
  key: string;
  /** Feature 159 — the group (a group draft's `key`) the line is in; `null` = ungrouped. */
  groupKey: string | null;
  productId: string;
  sku: string;
  name: string;
  quantityInput: string;
}

/** The order's selectability rules for the picker and the quick search (Clarifications). */
/**
 * An archived product cannot be ordered whatever its status,
 * so it is refused on its own, beside `inactive`.
 */
const ORDER_PRODUCT_RULES: ProductBrowserRules = {
  initialStatus: 'active',
  blockedTypes: ['grouped', 'bundle'],
  blockedStatuses: ['inactive'],
  blockArchived: true,
};

// Members of `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE`, named rather than taken by
// position: a renamed code then fails to compile instead of remapping a reason.
const NOT_VISIBLE_CODE: AdminOrderPreviewMessageCode = 'PRODUCT_NOT_VISIBLE_TO_CUSTOMER';
const NOT_IN_CHANNEL_CODE: AdminOrderPreviewMessageCode = 'PRODUCT_NOT_IN_SALES_CHANNEL';
const BELOW_MINIMUM_CODE: AdminOrderPreviewMessageCode = 'BELOW_MINIMUM_QUANTITY';

/** One preview message, as `messages[]` carries it (`minimum` on `BELOW_MINIMUM_QUANTITY` only). */
interface PreviewMessage {
  productId: string;
  code: string;
  minimum?: number;
}

/**
 * The line reason for a preview message
 * (`contracts/order-preview-unavailability.md` § Consumer mapping): the two
 * assortment/visibility codes carry their own reason; feature 155's
 * `BELOW_MINIMUM_QUANTITY` names the minimum it missed (FR-009) — the operator
 * can fix that one by raising the quantity, so it must not read as **No price**;
 * `PRODUCT_NOT_FOUND`, `QUOTE_ONLY` and any code this client does not know read
 * **No price**.
 */
function unavailableReason(message: PreviewMessage | undefined): {
  key: string;
  params?: Record<string, number>;
} {
  if (message?.code === NOT_VISIBLE_CODE) return { key: 'orderCreate.line.notVisible' };
  if (message?.code === NOT_IN_CHANNEL_CODE) return { key: 'orderCreate.line.notInChannel' };
  if (message?.code === BELOW_MINIMUM_CODE) {
    return message.minimum !== undefined
      ? { key: 'orderCreate.line.belowMinimum', params: { minimum: message.minimum } }
      : { key: 'orderCreate.line.belowMinimumUnknown' };
  }
  return { key: 'orderCreate.line.unavailable' };
}

/** Feature 159 (research N-31) — nothing is "already added": a product may be a line twice. */
const NO_IDS: readonly string[] = [];

function productLine(item: ProductBrowserItem, groupKey: string | null, key: string): ItemRow {
  return {
    key,
    groupKey,
    productId: item.id,
    sku: item.sku,
    name: productDisplayName(item),
    quantityInput: '1',
  };
}

interface MethodSummary {
  id: string;
  code: string;
  name: Record<string, string>;
  status: string;
  /** The channels the method is restricted to; empty means every channel. */
  salesChannelIds?: string[];
}

/**
 * The methods an order on `salesChannelId` may use: those bound to that channel
 * and those bound to none, which are offered in every channel. With no channel
 * chosen yet nothing is narrowed — the operator has not said where the order
 * is, and an empty select would read as "this shop has no methods".
 *
 * The server refuses an out-of-channel method on preview and on create; this is
 * what keeps the operator from being offered one in the first place.
 */
export function methodsOfferedInChannel<M extends { salesChannelIds?: string[] }>(
  methods: readonly M[],
  salesChannelId: string,
): M[] {
  if (!salesChannelId) return [...methods];
  return methods.filter((m) => {
    const restrictedTo = m.salesChannelIds ?? [];
    return restrictedTo.length === 0 || restrictedTo.includes(salesChannelId);
  });
}

/**
 * Issue #515 — the channels an operator may place the customer's order on:
 * exactly the set the API accepts (`POST /api/v1/admin/orders` refuses anything
 * else with `422 ORDER_SALES_CHANNEL_NOT_ALLOWED`), the customer's
 * Organization's own active channels. Never another active channel, nor the
 * system default: an Organization with no active channel of its own gets an
 * empty list, and the screen says so and sends nothing.
 *
 * The preselection is the channel the page was opened with when it is one of
 * them, else the only choice when there is one, else none — the operator
 * chooses. A channel handed over in the link that is not allowed is dropped
 * rather than sent blind.
 */
export function orderChannelChoices(
  assignment: Pick<OrganizationSalesChannelsResponse['data'], 'assignedSalesChannelIds' | 'options'>,
  requested: string,
): { options: OrganizationSalesChannelOption[]; preselected: string } {
  const assigned = new Set(assignment.assignedSalesChannelIds);
  const options = assignment.options.filter((c) => c.active && assigned.has(c.id));
  if (requested && options.some((c) => c.id === requested)) return { options, preselected: requested };
  return { options, preselected: options.length === 1 ? options[0]!.id : '' };
}

function toMethodOptions(methods: readonly MethodSummary[]): ComboboxOption<string>[] {
  return methods.map((m) => ({
    value: m.id,
    label: pickName(m.name, m.code),
    description: m.code,
  }));
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
  /** The customer's Organization — whose channels the order may be placed on (issue #515). */
  organizationId?: string | null;
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
  /** Feature 159 — the rate the line is taxed at; a group's VAT is summed from it. */
  taxRate?: number;
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
  messages: PreviewMessage[];
}

/**
 * What another screen may hand this one in the query string when it opens it
 * (feature 143, US10) — all of it optional, and none of it interpreted:
 *
 * - `originType` + `originId`: where the order is being created from. Sent on
 *   the create request as `origin` and otherwise unread. A pair that is not
 *   well-formed is dropped rather than sent, because the request would be
 *   refused for it.
 * - `organizationId`, `customerAccountId`, `salesChannelId`: what to preselect.
 *   The organization narrows the customer search; the other two arrive chosen.
 * - `returnTo`: a path inside this application to go back to — from the Back
 *   button, and after the order is created, when the id of the new order is
 *   handed over in the navigation state as `createdDocument`.
 */
interface OpenedWith {
  origin: { type: string; id: string } | null;
  organizationId: string;
  customerAccountId: string;
  salesChannelId: string;
  returnTo: string | null;
}

const ORIGIN_TYPE = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readOpenedWith(params: URLSearchParams): OpenedWith {
  const type = params.get('originType') ?? '';
  const id = params.get('originId') ?? '';
  const returnTo = params.get('returnTo') ?? '';
  return {
    origin: ORIGIN_TYPE.test(type) && UUID.test(id) ? { type, id } : null,
    organizationId: params.get('organizationId') ?? '',
    customerAccountId: params.get('customerAccountId') ?? '',
    salesChannelId: params.get('salesChannelId') ?? '',
    // A path of this application only: never a scheme, a host or `//`.
    returnTo: /^\/(?![/\\])/.test(returnTo) ? returnTo : null,
  };
}

const CUSTOMER_SEARCH_DEBOUNCE_MS = 250;
const PREVIEW_DEBOUNCE_MS = 250;

function customerLabel(c: AdminCustomerListItem): string {
  const name = `${c.firstName} ${c.lastName}`.trim();
  return name.length > 0 ? name : c.email;
}

function formatMoney(amount: number, currency: string, locale?: string, options?: FormatMoneyOptions): string {
  return formatMoneyShared(amount, currency, locale, options);
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
  /** Narrows the search to one organization's customers, and offers them at once. */
  organizationId?: string;
  /**
   * The chosen customer's Organization, once its row is known — `''` while it
   * is not (issue #515: the order's channels are that Organization's).
   */
  onOrganizationChange: (organizationId: string) => void;
}): ReactNode {
  const t = useTranslation('core');
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [cache, setCache] = useState<Map<string, AdminCustomerListItem>>(() => new Map());
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const organizationId = props.organizationId ?? '';

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
        if (organizationId) params.set('organizationId', organizationId);
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
    [organizationId],
  );

  // Opened with an organization: its customers are offered before anything is typed.
  useEffect(() => {
    if (organizationId) void runSearch('', ++seqRef.current);
  }, [organizationId, runSearch]);

  // Opened with a customer already chosen: read it once, for its name.
  const initialValue = useRef(props.value);
  useEffect(() => {
    const id = initialValue.current;
    if (!id) return;
    let alive = true;
    void apiClient
      .get<{ data: AdminCustomerListItem }>(`/api/v1/admin/customers/${id}`)
      .then((res) => {
        if (alive) setCache((prev) => new Map(prev).set(res.data.id, res.data));
      })
      .catch(() => {
        // Left without a name; the search still finds the customer.
      });
    return (): void => {
      alive = false;
    };
  }, []);

  const handleSearchChange = useCallback(
    (query: string): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      const seq = ++seqRef.current;
      timerRef.current = setTimeout(() => void runSearch(query, seq), CUSTOMER_SEARCH_DEBOUNCE_MS);
    },
    [runSearch],
  );

  const selected = props.value ? cache.get(props.value) : undefined;
  const selectedOrganizationId = selected?.organizationId ?? '';
  const { onOrganizationChange } = props;
  useEffect(() => {
    onOrganizationChange(selectedOrganizationId);
  }, [selectedOrganizationId, onOrganizationChange]);

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
  const tGroups = useTranslation('orders');
  const groupLabels = useOrderLineGroupLabels();
  const splitLabels = useOrderSplitLineLabels();
  const summaryText = useOrderSectionSummaryText();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Read once: what the page was opened with does not change under the form.
  const [openedWith] = useState(() => readOpenedWith(searchParams));

  const [customerAccountId, setCustomerAccountId] = useState(openedWith.customerAccountId);
  const [organizationId, setOrganizationId] = useState('');
  // Issue #515 — the order's channel, chosen among the customer's
  // Organization's active channels once they are read. Until they are, no
  // channel is chosen: not even the one the link named, which is kept only if
  // it is one of them.
  const [salesChannelId, setSalesChannelId] = useState('');
  const [deliveryMethodId, setDeliveryMethodId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [deliveryChoice, setDeliveryChoice] = useState<AddressChoice>({ mode: 'existing', id: '' });
  const [billingChoice, setBillingChoice] = useState<AddressChoice>({ mode: 'existing', id: '' });
  const [customerNote, setCustomerNote] = useState('');
  // In display order: each group's lines, then the ungrouped ones (feature 159).
  const [items, setItems] = useState<ItemRow[]>([]);
  const [browserOpen, setBrowserOpen] = useState(false);
  // Feature 159 — the order's groups, and where the browser's products go (a
  // group's *Add product* opens it for that group; everything else adds to
  // Ungrouped).
  const [groups, setGroups] = useState<Array<{ key: string; name: string }>>([]);
  const [addTarget, setAddTarget] = useState<string | null>(null);
  const groupCounter = useRef(0);
  const lineCounter = useRef(0);
  const newLineKey = (): string => `line-${(lineCounter.current += 1)}`;
  // One confirm per opening of the browser: two confirms landing in one tick
  // must not add their products twice now that a product may be a line twice.
  const browserConfirmed = useRef(false);
  const openBrowser = (target: string | null): void => {
    browserConfirmed.current = false;
    setAddTarget(target);
    setBrowserOpen(true);
  };
  // Feature 159 (research N-33) — the line whose *Split line* dialog is open.
  const [splitting, setSplitting] = useState<string | null>(null);
  const itemsId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // The address the page chose by itself for a customer it was opened with —
  // a selection nobody made is not a draft to warn about.
  const arrivedAddressId = useRef('');
  // The same for the channel: the one the page chose (from the link, or the
  // only one offered), so dropping a link's channel that is not allowed is not
  // a change the operator made either.
  const arrivedChannelId = useRef('');
  const addressIsDraft = (c: AddressChoice): boolean =>
    addressHasContent(c) && !(c.mode === 'existing' && c.id === arrivedAddressId.current);

  // Warn before leaving with a partially-filled order draft. The lines count
  // whether or not **Items** is shown: hiding it (FR-025) keeps them.
  const dirty =
    !submitted &&
    (customerAccountId !== openedWith.customerAccountId ||
      salesChannelId !== arrivedChannelId.current ||
      deliveryMethodId !== '' ||
      paymentMethodId !== '' ||
      customerNote !== '' ||
      addressIsDraft(deliveryChoice) ||
      addressIsDraft(billingChoice) ||
      items.length > 0 ||
      groups.length > 0);
  useUnsavedChangesPrompt(dirty);

  // Issue #515 — the customer's Organization's channels. `null` while there is
  // no Organization or its channels are being read; empty when it has no
  // active channel, which the screen says, sending nothing. A failed read says
  // so with a retry, and nothing is sent either: the server would only refuse.
  const [channelChoices, setChannelChoices] = useState<OrganizationSalesChannelOption[] | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsFailed, setChannelsFailed] = useState(false);
  const [channelsAttempt, setChannelsAttempt] = useState(0);
  const channelsReadFor = useRef('');
  useEffect(() => {
    // A retry keeps the failure on screen until it is answered; a new Organization starts afresh.
    if (channelsReadFor.current !== organizationId) {
      channelsReadFor.current = organizationId;
      setChannelsFailed(false);
    }
    setChannelChoices(null);
    setSalesChannelId('');
    arrivedChannelId.current = '';
    setChannelsLoading(Boolean(organizationId));
    if (!organizationId) return undefined;
    let alive = true;
    void apiClient
      .get<OrganizationSalesChannelsResponse>(`/api/v1/admin/organizations/${organizationId}/sales-channels`)
      .then((res) => {
        if (!alive) return;
        if (!Array.isArray(res.data?.options)) {
          setChannelsFailed(true);
          return;
        }
        const { options, preselected } = orderChannelChoices(res.data, openedWith.salesChannelId);
        setChannelsFailed(false);
        setChannelChoices(options);
        arrivedChannelId.current = preselected;
        setSalesChannelId(preselected);
      })
      .catch(() => {
        if (alive) setChannelsFailed(true);
      })
      .finally(() => {
        if (alive) setChannelsLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, [organizationId, channelsAttempt, openedWith.salesChannelId]);
  const channelOptions = useMemo<ComboboxOption<string>[]>(
    () =>
      (channelChoices ?? []).map((c) => ({ value: c.id, label: pickName(c.name, c.code), description: c.code })),
    [channelChoices],
  );
  // The active methods as loaded; the two selects offer the ones the chosen
  // channel offers, so the lists follow the channel select.
  const [paymentMethods, setPaymentMethods] = useState<MethodSummary[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<MethodSummary[]>([]);
  const paymentOptions = useMemo(
    () => toMethodOptions(methodsOfferedInChannel(paymentMethods, salesChannelId)),
    [paymentMethods, salesChannelId],
  );
  const deliveryOptions = useMemo(
    () => toMethodOptions(methodsOfferedInChannel(deliveryMethods, salesChannelId)),
    [deliveryMethods, salesChannelId],
  );
  // Changing the channel can take the chosen method out of the list. Clear it
  // then, so the form does not go on submitting a method the select no longer
  // shows — the required-field check asks the operator to choose again.
  useEffect(() => {
    if (paymentMethodId && !paymentOptions.some((o) => o.value === paymentMethodId)) {
      setPaymentMethodId('');
    }
  }, [paymentOptions, paymentMethodId]);
  useEffect(() => {
    if (deliveryMethodId && !deliveryOptions.some((o) => o.value === deliveryMethodId)) {
      setDeliveryMethodId('');
    }
  }, [deliveryOptions, deliveryMethodId]);

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
        const [payments, deliveries] = await Promise.all([
          apiClient.get<{ data: MethodSummary[] }>('/api/v1/admin/payment-methods'),
          apiClient.get<{ data: MethodSummary[] }>('/api/v1/admin/delivery-methods'),
        ]);
        if (!alive) return;
        setPaymentMethods(payments.data.filter((m) => m.status === 'active'));
        setDeliveryMethods(deliveries.data.filter((m) => m.status === 'active'));
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
          if (customerAccountId === openedWith.customerAccountId) arrivedAddressId.current = preferred;
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
  }, [customerAccountId, openedWith.customerAccountId, t]);

  // The lines that may be priced and sent: an invalid quantity keeps its line on
  // screen, marked, and out of both requests (FR-022, FR-026). The preview is
  // asked about the lines only, so moving a line between groups does not
  // re-price; its order is the display order.
  // Keyed on what pricing reads, so a regroup that leaves it unchanged asks
  // the preview nothing. One request line per screen line, a repeated product
  // included (feature 159, research N-31): the preview answers one line each.
  // In display order — each group's lines, then the ungrouped ones — whatever
  // order an edit left the list in.
  const knownGroupKeys = new Set(groups.map((group) => group.key));
  const displayItems = [
    ...groups.flatMap((group) => items.filter((it) => it.groupKey === group.key)),
    ...items.filter((it) => it.groupKey === null || !knownGroupKeys.has(it.groupKey)),
  ];
  const pricedRows = displayItems.flatMap((it) => {
    const quantity = parsePositiveInt(it.quantityInput);
    return quantity === null ? [] : [{ row: it, quantity }];
  });
  const pricingKey = JSON.stringify(pricedRows.map(({ row, quantity }) => ({ productId: row.productId, quantity })));
  const validItems = useMemo(
    () => JSON.parse(pricingKey) as Array<{ productId: string; quantity: number }>,
    [pricingKey],
  );

  // Live pricing preview — debounced; fires whenever the priced inputs change
  // (FR-023: lines, quantities, customer, channel, delivery and payment method).
  useEffect(() => {
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
          items: validItems,
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
  }, [customerAccountId, salesChannelId, deliveryMethodId, paymentMethodId, validItems, t]);

  /**
   * Append products as lines, in the order given — a product already a line
   * included: it becomes a line of its own (feature 159, research N-31) — at the
   * end of `groupKey`'s section (`null` = Ungrouped, which is last, so the end of
   * the list). Keys are made here, outside the updater StrictMode runs twice.
   */
  const appendLines = (products: readonly ProductBrowserItem[], groupKey: string | null = null): void => {
    const added = products.map((p) => productLine(p, groupKey, newLineKey()));
    if (added.length === 0) return;
    setItems((prev) => {
      if (groupKey === null) return [...prev, ...added];
      const lastOfGroup = prev.map((row) => row.groupKey).lastIndexOf(groupKey);
      const at = lastOfGroup >= 0 ? lastOfGroup + 1 : prev.findIndex((row) => row.groupKey === null);
      const index = at < 0 ? prev.length : at;
      return [...prev.slice(0, index), ...added, ...prev.slice(index)];
    });
  };
  const setQuantity = (key: string, quantityInput: string): void =>
    setItems((prev) => prev.map((row) => (row.key === key ? { ...row, quantityInput } : row)));
  const removeLine = (key: string): void => setItems((prev) => prev.filter((row) => row.key !== key));

  // Per-line price lookup for the items table: the preview answers one line per
  // request line, in order, so a screen line reads the answer at its own index —
  // only while that answer is still about its product and quantity, so a line
  // whose quantity just changed shows nothing until its new price arrives.
  const splitRow = splitting !== null ? items.find((row) => row.key === splitting) : undefined;
  const previewIndexByKey = new Map(pricedRows.map(({ row }, index) => [row.key, index]));
  const previewLineOf = (row: ItemRow, quantity: number | null): PreviewLine | undefined => {
    if (quantity === null) return undefined;
    const index = previewIndexByKey.get(row.key);
    const line = index === undefined ? undefined : preview?.lines[index];
    return line && line.productId === row.productId && line.quantity === quantity ? line : undefined;
  };
  const messageByProduct = new Map<string, PreviewMessage>();
  for (const m of preview?.messages ?? []) messageByProduct.set(m.productId, m);
  const translateReason = (reason: ReturnType<typeof unavailableReason>): string =>
    t(reason.key, reason.params);
  // Only a message about a line still on the form blocks submit: a removed
  // line's message lingers until the next preview answers.
  const hasUnavailable = items.some((row) => messageByProduct.has(row.productId));
  const allQuantitiesValid = validItems.length === items.length;

  // Every group needs a name before the order can be created (FR-002).
  const groupsNamed = groups.every((group) => group.name.trim() !== '');

  const canSubmit =
    groupsNamed &&
    !!customerAccountId.trim() &&
    !!salesChannelId.trim() &&
    !!deliveryMethodId.trim() &&
    !!paymentMethodId.trim() &&
    addressComplete(deliveryChoice) &&
    addressComplete(billingChoice) &&
    items.length > 0 &&
    allQuantitiesValid &&
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
    // Feature 159 — with groups, each line names its own group (the server
    // places the lines as sent, one order line each: each group's lines, then
    // the ungrouped ones); without, the request is the one it always was.
    const sentItems =
      groups.length > 0
        ? pricedRows.map(({ row, quantity }) => ({
            productId: row.productId,
            quantity,
            groupKey: row.groupKey !== null && knownGroupKeys.has(row.groupKey) ? row.groupKey : null,
          }))
        : validItems;
    try {
      const res = await apiClient.post<{ data: { id: string } }>('/api/v1/admin/orders', {
        customerAccountId: customerAccountId.trim(),
        salesChannelId: salesChannelId.trim(),
        deliveryMethodId: deliveryMethodId.trim(),
        paymentMethodId: paymentMethodId.trim(),
        ...addressPayload(deliveryChoice, 'deliveryAddressId', 'deliveryAddress'),
        ...addressPayload(billingChoice, 'billingAddressId', 'billingAddress'),
        ...(customerNote.trim() ? { customerNote: customerNote.trim() } : {}),
        ...(groups.length > 0 ? { groups: groups.map((group) => ({ key: group.key, name: group.name.trim() })) } : {}),
        items: sentItems,
        ...(openedWith.origin ? { origin: openedWith.origin } : {}),
      });
      setSubmitted(true);
      if (openedWith.returnTo) {
        navigate(openedWith.returnTo, { state: { createdDocument: { id: res.data.id } } });
      } else {
        navigate(`/orders/${res.data.id}`);
      }
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

  // Items and Order summary need the two inputs pricing needs (FR-021);
  // payment, delivery and addresses do not gate them.
  const canPrice = customerAccountId !== '' && salesChannelId !== '';
  // With the Organization's channels unreadable, or none of them active, the
  // alert beside the field says why; "choose a sales channel" would be wrong.
  const channelBlocked = channelsFailed || (channelChoices !== null && channelChoices.length === 0);
  const gateHint = canPrice || (customerAccountId !== '' && channelBlocked)
    ? null
    : customerAccountId === '' && salesChannelId === ''
      ? t('orderCreate.gate.missingBoth')
      : customerAccountId === ''
        ? t('orderCreate.gate.missingCustomer')
        : t('orderCreate.gate.missingChannel');

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
            <Link to={openedWith.returnTo ?? '/orders'}>
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
              organizationId={openedWith.organizationId}
              onOrganizationChange={setOrganizationId}
            />
          </div>
          {channelsFailed ? (
            // Not read, so nothing to offer and nothing sent: said, with a way back.
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('orderCreate.channelsLoadError')}</span>
                <Button
                  className="min-h-11 sm:min-h-8"
                  variant="outline"
                  size="sm"
                  disabled={channelsLoading}
                  onClick={(): void => setChannelsAttempt((n) => n + 1)}
                >
                  {t('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : channelChoices !== null && channelChoices.length === 0 ? (
            // Nothing the API would accept: said, never papered over.
            <Alert variant="destructive">
              <AlertDescription>{t('orderCreate.noChannelWarning')}</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="salesChannelId">{t('orderCreate.field.salesChannel')}</Label>
              <Combobox<string>
                id="salesChannelId"
                ariaLabel="salesChannelId"
                options={channelOptions}
                value={salesChannelId === '' ? null : salesChannelId}
                onChange={(next): void => setSalesChannelId(next ?? '')}
                disabled={channelChoices === null}
                placeholder={t('orderCreate.placeholder.select')}
                emptyMessage={t('orderCreate.empty.options')}
              />
              {channelChoices === null ? (
                <p className="text-xs text-muted-foreground">
                  {channelsLoading ? t('orderCreate.loading') : t('orderCreate.address.selectCustomerFirst')}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('orderCreate.hint.salesChannel')}</p>
              )}
            </div>
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

      {gateHint ? (
        <Card className="mb-4">
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            <p>{gateHint}</p>
          </CardContent>
        </Card>
      ) : null}

      {canPrice ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('orderCreate.section.items')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <ProductBrowserTrigger onOpen={(): void => openBrowser(null)} />
              <div className="min-w-64 flex-1 space-y-1">
                <Label htmlFor={`${itemsId}-quick-search`}>{t('orderCreate.items.quickSearch')}</Label>
                <ProductPicker
                  mode="select"
                  id={`${itemsId}-quick-search`}
                  ariaLabel={t('orderCreate.items.quickSearch')}
                  value={null}
                  onChange={(): void => {}}
                  onPickProduct={(item): void => appendLines([item])}
                  rules={ORDER_PRODUCT_RULES}
                  includeArchived
                  placeholder={t('orderCreate.placeholder.product')}
                />
              </div>
            </div>
            <ProductBrowserDialog
              open={browserOpen}
              title={t('orderCreate.items.browse')}
              rules={ORDER_PRODUCT_RULES}
              alreadyAddedIds={NO_IDS}
              onConfirm={(picked): void => {
                if (browserConfirmed.current) return;
                browserConfirmed.current = true;
                appendLines(picked, addTarget);
                setBrowserOpen(false);
                setAddTarget(null);
              }}
              onCancel={(): void => {
                setBrowserOpen(false);
                setAddTarget(null);
              }}
            />

            {items.length === 0 && groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('orderCreate.items.empty')}</p>
            ) : (
              // Feature 159 — with no group the editor renders the table as it was (FR-033).
              <LineGroupsEditor<ItemRow>
                layout="table"
                columnCount={5}
                tableHeader={
                  <TableRow>
                    <TableHead>{t('orderCreate.field.product')}</TableHead>
                    <TableHead id={`${itemsId}-qty`} className="w-28">
                      {t('orderCreate.field.quantity')}
                    </TableHead>
                    <TableHead className="text-right">{t('orderCreate.line.unitPrice')}</TableHead>
                    <TableHead className="text-right">{t('orderCreate.line.lineTotal')}</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">{t('common.action.delete')}</span>
                    </TableHead>
                  </TableRow>
                }
                groups={groups}
                lines={items}
                disabled={busy}
                labels={groupLabels}
                createGroupKey={(): string => `group-${(groupCounter.current += 1)}`}
                getLineLabel={(row): string => row.name}
                onChange={(next): void => {
                  setGroups(next.groups);
                  setItems(next.lines);
                }}
                renderSummary={(sectionLines): ReactNode => (
                  <OrderSectionSummary
                    text={summaryText(
                      orderSectionTotals(
                        sectionLines.map((row) => {
                          const line = previewLineOf(row, parsePositiveInt(row.quantityInput));
                          const priced = line !== undefined && !line.unavailable;
                          return {
                            net: priced ? line.lineTotal : null,
                            taxRate: priced ? (line.taxRate ?? null) : null,
                          };
                        }),
                      ),
                      preview?.summary.currency ?? '',
                    )}
                  />
                )}
                renderSectionFooter={(section): ReactNode =>
                  section.kind === 'group' && section.key !== null ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(): void => openBrowser(section.key)}
                    >
                      {tGroups('lineGroups.addProduct')}
                    </Button>
                  ) : null
                }
                renderLine={(row, slots): ReactNode => {
                  const quantity = parsePositiveInt(row.quantityInput);
                  const line = previewLineOf(row, quantity);
                  const rowId = `${itemsId}-${row.key}`;
                  const reason =
                    quantity === null
                      ? t('orderCreate.line.quantityInvalid')
                      : line?.unavailable
                        ? translateReason(unavailableReason(messageByProduct.get(row.productId)))
                        : null;
                  // Feature 159 (research N-33) — part of the line to a new line.
                  const splitButton =
                    quantity !== null && canSplitLine(quantity) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={splitLabels.action({ name: row.name })}
                        title={splitLabels.action({ name: row.name })}
                        disabled={busy}
                        onClick={(): void => setSplitting(row.key)}
                      >
                        <Split aria-hidden="true" />
                      </Button>
                    ) : null;
                  const removeButton = (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-labelledby={`${rowId}-remove ${rowId}-name`}
                      onClick={(): void => removeLine(row.key)}
                    >
                      <Trash2 aria-hidden="true" />
                      <span id={`${rowId}-remove`} className="sr-only">
                        {t('common.action.delete')}
                      </span>
                    </Button>
                  );
                  return (
                    <>
                      <TableCell>
                        <div id={`${rowId}-name`} data-line-name className="font-medium">
                          {row.name}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">{row.sku}</div>
                      </TableCell>
                      <TableCell>
                        <Input
                          id={`${rowId}-qty`}
                          type="text"
                          inputMode="numeric"
                          aria-labelledby={`${itemsId}-qty ${rowId}-name`}
                          aria-invalid={quantity === null || undefined}
                          aria-describedby={reason !== null ? `${rowId}-reason` : undefined}
                          value={row.quantityInput}
                          onChange={(e): void => setQuantity(row.key, e.target.value)}
                        />
                      </TableCell>
                      {reason !== null ? (
                        <TableCell colSpan={2} className="text-right">
                          <span id={`${rowId}-reason`} className="text-sm text-destructive">
                            {reason}
                          </span>
                        </TableCell>
                      ) : (
                        <>
                          <TableCell className="text-right text-muted-foreground">
                            {line ? formatMoney(Number(line.unitPrice), line.currency, undefined, { unitPrice: true }) : null}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {line ? formatMoney(line.lineTotal, line.currency) : null}
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        {slots.handle === null && slots.moveMenu === null && splitButton === null ? (
                          removeButton
                        ) : (
                          <div className="flex items-center gap-1">
                            {slots.handle}
                            {slots.moveMenu}
                            {splitButton}
                            {removeButton}
                          </div>
                        )}
                      </TableCell>
                    </>
                  );
                }}
              />
            )}
            {splitRow ? (
              <SplitLineDialog
                lineName={splitRow.name}
                quantity={Number(splitRow.quantityInput)}
                targets={[
                  ...groups.map((group) => ({ key: group.key, name: group.name.trim() || groupLabels.groupName })),
                  { key: null, name: groupLabels.ungrouped },
                ]}
                defaultTargetKey={
                  splitRow.groupKey !== null && groups.some((group) => group.key === splitRow.groupKey)
                    ? splitRow.groupKey
                    : null
                }
                labels={splitLabels}
                onConfirm={(split): void => {
                  setItems((prev) => [
                    ...splitLineInto(prev, splitRow.key, split, {
                      quantityOf: (row) => Number(row.quantityInput),
                      setQuantity: (row, quantity) => ({ ...row, quantityInput: String(quantity) }),
                      make: (source, quantity, groupKey) => ({
                        ...source,
                        key: newLineKey(),
                        groupKey,
                        quantityInput: String(quantity),
                      }),
                    }),
                  ]);
                  setSplitting(null);
                }}
                onClose={(): void => setSplitting(null)}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canPrice && preview ? (
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

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default OrderCreatePage;
