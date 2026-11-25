import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { ApiError, apiClient, useAuth, withReturnTo } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Combobox,
  FormField,
  Input,
  Label,
  PageHeader,
  TableCell,
  TableHead,
  TableRow,
  Textarea,
  type ComboboxOption,
} from '@endora-commerce/admin-kit/ui';
import {
  adminLanguageToLocale,
  CustomFieldValuesPanel,
  customFieldErrorsOf,
  LineGroupsEditor,
  pickCategoryDisplayName,
  ProductBrowserDialog,
  ProductBrowserTrigger,
  ProductPicker,
  parsePositiveInt,
  productDisplayName,
  StickyFormActions,
  useConfirmDialog,
  type ProductBrowserItem,
  type ProductBrowserRules,
} from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { createPricePrefillQueue, type PricePrefillQueue } from '../lib/price-prefill-queue';
import { SectionSummary, sectionTotals, useQuoteLineGroupLabels, useSectionSummaryText } from '../line-groups.js';
import { quoteNet } from '../quote-totals.js';
import { createValidity } from '../validity.js';
import { SHARE_FAILED_CODE, shareRefusalOf, type ShareRefusal } from '../share-refusal.js';
import { shareConfirmMessage, shareCustomerName } from '../share-confirm.js';
import type { RfqDetailArrival } from './rfq-page-notice.js';
import {
  lineAmountHalfUp,
  QUOTE_VALIDITY_DAYS_MAX,
  unitPriceDisplayText,
  adminQuoteRequestCreateDefaultsSchema,
  type AdminQuoteRequestCreateDefaults,
  type AdminQuoteRequestWarning,
  type OrganizationSalesChannelOption,
  type OrganizationSalesChannelsResponse,
  isUuidShape,
} from '@endora-commerce/contracts';

/**
 * Admin "create a Quote Request on behalf of a customer" (feature 008 US4).
 *
 * The backend endpoint `POST /api/v1/admin/quote-requests` already exists and
 * validates the org/customer/products; this page is the missing admin UI for
 * it. Customer search reuses `GET /api/v1/admin/customers`, whose rows carry
 * `organizationId`, so the (organization, customer) pair the endpoint requires
 * is derived from the single customer selection.
 */

interface AdminCustomerListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
  organizationName: string | null;
}

/**
 * One quote-request line (feature 145, FR-030). Keyed by its own `key`: one
 * product may be on several lines — in different groups, or twice in one
 * (feature 159, research N-31) — so the picker and the quick search offer a
 * product already a line again. `quantityInput` is kept as typed so an
 * invalid entry stays on screen, marked. `priceSource` says where the agreed
 * price came from: `manual` once the operator has typed in the field, after
 * which no prefill ever overwrites it (FR-033).
 */
interface LineRow {
  /** The line's identity — the grouping editor's, the price prefill's and the row's DOM ids. */
  key: string;
  /** Feature 159 — the group (a group draft's key) the line is in; `null` = ungrouped. */
  groupKey: string | null;
  productId: string;
  sku: string;
  name: string;
  quantityInput: string;
  agreedUnitPrice: string;
  priceSource: 'resolved' | 'manual' | 'none';
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * What another screen may hand this one in the query string when it opens it
 * (feature 143, US10) — all of it optional, and none of it interpreted:
 *
 * - `originType` + `originId`: where the request is being created from. Sent
 *   on the create request as `origin` and otherwise unread. A pair that is not
 *   well-formed is dropped rather than sent, because the request would be
 *   refused for it.
 * - `organizationId`, `customerAccountId`: what to preselect. The organization
 *   narrows the customer search; the customer arrives chosen.
 * - `returnTo`: a path inside this application to go back to — from the Back
 *   link, and after the request is created, when the id of the new request is
 *   handed over in the navigation state as `createdDocument`.
 */
interface OpenedWith {
  origin: { type: string; id: string } | null;
  organizationId: string;
  customerAccountId: string;
  returnTo: string | null;
}

const ORIGIN_TYPE = /^[a-z][a-z0-9_]{0,63}$/;

function readOpenedWith(params: URLSearchParams): OpenedWith {
  const type = params.get('originType') ?? '';
  const id = params.get('originId') ?? '';
  const returnTo = params.get('returnTo') ?? '';
  return {
    origin: ORIGIN_TYPE.test(type) && isUuidShape(id) ? { type, id } : null,
    organizationId: params.get('organizationId') ?? '',
    customerAccountId: params.get('customerAccountId') ?? '',
    // A path of this application only: never a scheme, a host or `//`.
    returnTo: /^\/(?![/\\])/.test(returnTo) ? returnTo : null,
  };
}

/**
 * Feature 163 (FR-018, T155 §1.5c, security review M1) — the channels an
 * operator may raise the customer's request on: exactly the set the API accepts
 * (`createOnBehalf` refuses anything else with `422 RFQ_SALES_CHANNEL_NOT_ALLOWED`),
 * the Organization's own active channels. Never another active channel, nor the
 * system default: an Organization with no active channel of its own gets an
 * empty list, and the screen says so and sends nothing. The preselection is the
 * only choice when there is one, else none — the operator chooses.
 */
function channelChoices(
  assignment: Pick<OrganizationSalesChannelsResponse['data'], 'assignedSalesChannelIds' | 'options'>,
): { options: OrganizationSalesChannelOption[]; preselected: string } {
  const assigned = new Set(assignment.assignedSalesChannelIds);
  const options = assignment.options.filter((c) => c.active && assigned.has(c.id));
  return { options, preselected: options.length === 1 ? options[0]!.id : '' };
}

/** The channel's name in the admin language, picked as every admin surface picks a name map. */
function channelLabel(c: OrganizationSalesChannelOption, locale: string): string {
  return pickCategoryDisplayName(c.name, c.code, locale);
}

function customerLabel(c: AdminCustomerListItem): string {
  const name = `${c.firstName} ${c.lastName}`.trim();
  return name.length > 0 ? name : c.email;
}

/**
 * Debounced server-side customer picker that hands the full selected row back
 * to the parent (we need its `organizationId`, not just the id).
 */
function CustomerPicker(props: {
  /** The input's id — `FormField`'s, so its label names the picker (issue #1475). */
  id: string;
  value: AdminCustomerListItem | null;
  onChange: (next: AdminCustomerListItem | null) => void;
  /** Narrows the search to one organization's customers, and offers them at once. */
  organizationId?: string;
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

  const runSearch = useCallback(async (query: string, seq: number): Promise<void> => {
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
  }, [organizationId]);

  // Opened with an organization: its customers are offered before anything is typed.
  useEffect(() => {
    if (organizationId) void runSearch('', ++seqRef.current);
  }, [organizationId, runSearch]);

  const handleSearchChange = useCallback(
    (query: string): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      const seq = ++seqRef.current;
      timerRef.current = setTimeout(() => void runSearch(query, seq), SEARCH_DEBOUNCE_MS);
    },
    [runSearch],
  );

  return (
    <Combobox<string>
      id={props.id}
      options={options}
      value={props.value?.id ?? null}
      selectedLabel={props.value ? customerLabel(props.value) : ''}
      onChange={(id): void => props.onChange(id ? cache.get(id) ?? null : null)}
      onSearchChange={handleSearchChange}
      manualFilter
      loading={searching}
      placeholder={t('rfqCreate.placeholder.customer')}
      emptyMessage={searching ? t('rfqCreate.loading') : t('rfqCreate.empty.customers')}
    />
  );
}

/**
 * The quote request's selectability rules for the picker and the quick search (Clarifications).
 * An archived product cannot be quoted (feature 163, owner decision P-3 → A): the browser offers
 * no Archived tab, and the quick search lists archived products refused with the reason, as the
 * order's does (owner decision RFQ-c → B).
 */
const RFQ_PRODUCT_RULES: ProductBrowserRules = {
  initialStatus: 'active',
  blockedTypes: ['grouped', 'bundle'],
  blockArchived: true,
};

/** Feature 159 (research N-31) — nothing is "already added": a product may be a line twice. */
const NO_IDS: readonly string[] = [];

/** An agreed unit price of 0 or more, or `null` when the field holds none. */
function parsePrice(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function productLine(item: ProductBrowserItem, groupKey: string | null, key: string): LineRow {
  return {
    key,
    groupKey,
    productId: item.id,
    sku: item.sku,
    name: productDisplayName(item),
    quantityInput: '1',
    agreedUnitPrice: '',
    priceSource: 'none',
  };
}

/** The panel's starting bag: a new quote request has none. */
const EMPTY_VALUES: Record<string, unknown> = {};

export function RfqCreatePage(): ReactNode {
  const t = useTranslation('core');
  const { language } = useTranslationContext();
  const locale = adminLanguageToLocale(language);
  // Feature 175 (FR-019, FR-039) — the request's custom fields, embedded in the
  // form: their bag travels as `customFieldValues` in the create and a refusal
  // is said at the field it names. Their definitions are `custom_fields:read`'s,
  // so without that code the panel is not shown and the create carries none.
  const { hasPermission } = useAuth();
  const canSeeCustomFields = hasPermission('custom_fields:read');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const tGroups = useTranslation('quote_requests');
  const groupLabels = useQuoteLineGroupLabels();
  const summaryText = useSectionSummaryText();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Read once: what the page was opened with does not change under the form.
  const [openedWith] = useState(() => readOpenedWith(searchParams));

  const [customer, setCustomer] = useState<AdminCustomerListItem | null>(null);

  // Opened with a customer already chosen: read the row once — the request
  // needs its organization, and the picker its name.
  useEffect(() => {
    if (!openedWith.customerAccountId) return undefined;
    let alive = true;
    void apiClient
      .get<{ data: AdminCustomerListItem }>(`/api/v1/admin/customers/${openedWith.customerAccountId}`)
      .then((res) => {
        if (alive) setCustomer((current) => current ?? res.data);
      })
      .catch(() => {
        // Left unchosen; the search still finds the customer.
      });
    return (): void => {
      alive = false;
    };
  }, [openedWith.customerAccountId]);

  // Feature 163 (T155 §1.5c) — the channel the request is raised on, chosen
  // among the customer's Organization's active channels. Empty options: the
  // Organization has no active channel, and nothing is sent. While they are
  // being read nothing can be sent either: until the answer is in, the screen
  // cannot tell an Organization whose channels it will offer from one it cannot.
  // When the read fails or is refused (a network error, a server error) the
  // screen says so with a retry and nothing is sent: the server checks the
  // channel even when none is named (owner decision 2026-10-29 "A"), so a blind
  // request would only be refused, or land on a channel nobody chose. The alert
  // stays while a retry is in flight, its button inert.
  const [channelOptions, setChannelOptions] = useState<OrganizationSalesChannelOption[] | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsFailed, setChannelsFailed] = useState(false);
  const [channelsAttempt, setChannelsAttempt] = useState(0);
  const [salesChannelId, setSalesChannelId] = useState('');
  // The Organization the options and the choice were read for: until the new
  // customer's channels are in, the previous customer's channel is no channel.
  const [channelsFor, setChannelsFor] = useState('');
  const organizationId = customer?.organizationId ?? '';
  const chosenChannelId = organizationId !== '' && channelsFor === organizationId ? salesChannelId : '';
  const channelRef = useRef(chosenChannelId);
  useEffect(() => {
    channelRef.current = chosenChannelId;
  });
  const channelsReadFor = useRef('');
  useEffect(() => {
    // A retry keeps the failure on screen until it is answered; a new Organization starts afresh.
    if (channelsReadFor.current !== organizationId) {
      channelsReadFor.current = organizationId;
      setChannelsFailed(false);
    }
    setChannelOptions(null);
    setSalesChannelId('');
    setChannelsFor('');
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
        const { options, preselected } = channelChoices(res.data);
        setChannelsFailed(false);
        setChannelOptions(options);
        setSalesChannelId(preselected);
        setChannelsFor(organizationId);
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
  }, [organizationId, channelsAttempt]);
  // After a create the answer warned about: the request exists, the operator reads the warning.
  // `specs/192-quote-request-draft-share/` (FR-020, US2 #8) — after *Create and share*
  // (`viaShare`) nothing was shared: the operator may open the draft or share it anyway.
  const [created, setCreated] = useState<{
    id: string;
    businessId?: string | undefined;
    version: number;
    warnings: AdminQuoteRequestWarning[];
    viaShare: boolean;
  } | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [browserOpen, setBrowserOpen] = useState(false);
  // Feature 159 — the new quote's groups, and where the browser's products go:
  // a group's *Add product* opens it for that group, the page's own controls
  // add to Ungrouped.
  const [groups, setGroups] = useState<Array<{ key: string; name: string }>>([]);
  const [addTarget, setAddTarget] = useState<string | null>(null);
  const groupCounter = useRef(0);
  const itemsId = useId();
  const [headerNote, setHeaderNote] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  /**
   * `specs/192-quote-request-draft-share/` (FR-031) — the store's default days
   * prefill the field until the operator touches it. A failed read leaves the
   * field empty and the screen usable, worded as the store's default the server
   * applies; every state is {@link createValidity}'s.
   */
  const [validityTouched, setValidityTouched] = useState(false);
  const [defaultDays, setDefaultDays] = useState<{ status: 'loading' | 'ready' | 'failed'; days: number | null }>({
    status: 'loading',
    days: null,
  });
  useEffect(() => {
    let alive = true;
    apiClient
      .get<{ data: AdminQuoteRequestCreateDefaults }>('/api/v1/admin/quote-requests/create-defaults')
      .then((res) => {
        if (!alive) return;
        // 0 is no deadline, as `null` is (the server already answers 0 as `null`).
        // A reply the contract does not describe says nothing about the default:
        // it is worded as the store's default, as a failed read is.
        const days: unknown = (res?.data as { validityDays?: unknown } | undefined)?.validityDays;
        const parsed = adminQuoteRequestCreateDefaultsSchema.safeParse({ validityDays: days === 0 ? null : days });
        setDefaultDays(parsed.success ? { status: 'ready', days: parsed.data.validityDays } : { status: 'failed', days: null });
      })
      .catch(() => {
        if (alive) setDefaultDays({ status: 'failed', days: null });
      });
    return (): void => {
      alive = false;
    };
  }, []);
  // Derived, not copied into the field: a late answer never overwrites what the
  // operator typed, because once touched the typed value is the one shown.
  const validity = createValidity(defaultDays, validityTouched, expiresInDays);
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  // ---- agreed-price prefill (FR-031…FR-033, research R-11)
  //
  // Every question goes through one queue: at most four in flight, and an
  // answer applied only while it is still the line's question. The answer is
  // also refused here when the line's price has been typed by hand in the
  // meantime — the operator may type one while its question is in flight.
  const queueRef = useRef<PricePrefillQueue | null>(null);
  const [resolving, setResolving] = useState<ReadonlySet<string>>(() => new Set());
  const markResolving = useCallback((key: string, on: boolean): void => {
    setResolving((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const queue = createPricePrefillQueue({
      fetch: async (q) => {
        // Feature 160 — the price explanation, which replaced the per-product probe.
        const res = await apiClient.post<{ data: Array<{ price: { amount: string } | null }> }>(
          '/api/v1/admin/price-books/resolve',
          {
            ...(q.salesChannelId ? { salesChannelId: q.salesChannelId } : {}),
            buyer: { organizationId: q.organizationId, customerAccountId: q.customerId },
            lines: [{ key: 'line', productId: q.productId, quantity: q.quantity }],
          },
        );
        return res.data[0]?.price?.amount ?? null;
      },
      onResult: (key, amount) => {
        markResolving(key, false);
        setLines((prev) =>
          prev.map((row) =>
            row.key === key && row.priceSource !== 'manual'
              ? {
                  ...row,
                  // The resolver's unit price, unrounded (owner ruling of 2026-10-25).
                  agreedUnitPrice: amount === null ? '' : unitPriceDisplayText(amount),
                  priceSource: amount === null ? 'none' : 'resolved',
                }
              : row,
          ),
        );
      },
    });
    queueRef.current = queue;
    return (): void => {
      queue.dispose();
      queueRef.current = null;
    };
  }, [markResolving]);

  /** Ask for a line's price, when it may be prefilled at all; otherwise drop any question it had. */
  const prefill = useCallback(
    (row: Pick<LineRow, 'key' | 'productId' | 'quantityInput' | 'priceSource'>, cust: AdminCustomerListItem | null): void => {
      const queue = queueRef.current;
      if (!queue) return;
      const quantity = parsePositiveInt(row.quantityInput);
      // No channel settled yet, no price: a request is never sent without one
      // (owner decision 2026-10-29 "A"), so a channel-less price would answer nothing.
      if (row.priceSource === 'manual' || quantity === null || !cust?.organizationId || channelRef.current === '') {
        queue.forget(row.key);
        markResolving(row.key, false);
        return;
      }
      queue.request({
        key: row.key,
        productId: row.productId,
        quantity,
        customerId: cust.id,
        organizationId: cust.organizationId,
        // Feature 163 — priced on the channel the request is raised on.
        salesChannelId: channelRef.current,
      });
      markResolving(row.key, true);
    },
    [markResolving],
  );

  // A customer change (including the one the page was opened with) clears every
  // price not typed by hand and asks again for the new customer — a previous
  // customer's price never stays on as if it were this one's (research R-11).
  // A channel change does the same (feature 163): a price answers one channel.
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  });
  const pricedForRef = useRef<string | null>(null);
  useEffect(() => {
    // Identity and organization, not the object: re-reading the same customer is no change.
    const key = `${customer?.id ?? ''}:${customer?.organizationId ?? ''}:${chosenChannelId}`;
    if (pricedForRef.current === key) return;
    pricedForRef.current = key;
    setLines((prev) =>
      prev.some((row) => row.priceSource !== 'manual' && row.agreedUnitPrice !== '')
        ? prev.map((row) =>
            row.priceSource === 'manual' ? row : { ...row, agreedUnitPrice: '', priceSource: 'none' },
          )
        : prev,
    );
    for (const row of linesRef.current) prefill(row, customer);
  }, [customer, chosenChannelId, prefill]);

  /**
   * Append products as lines, in the order given — a product already a line
   * included: it becomes a line of its own (feature 159, research N-31).
   *
   * `linesRef` is advanced at once, so a second add landing before the next
   * render sees the first one's lines, and exactly the rows appended are
   * prefilled. The prefill stays out of the `setLines` updater, which StrictMode
   * runs twice. A browser confirm is applied once (`browserConfirmed`), so two
   * confirms landing in one tick do not add their products twice.
   */
  const lineCounter = useRef(0);
  const appendLines = (products: readonly ProductBrowserItem[], groupKey: string | null = null): void => {
    const added = products.map((p) => productLine(p, groupKey, `line-${(lineCounter.current += 1)}`));
    if (added.length === 0) return;
    linesRef.current = [...linesRef.current, ...added];
    setLines((prev) => [...prev, ...added]);
    for (const row of added) prefill(row, customer);
  };

  // A resolved price answers one quantity; once the quantity is not a valid one it
  // answers nothing, so it is cleared rather than left on screen as current
  // (FR-034 then marks the line). A hand-typed price is the operator's and stays.
  // A valid quantity asks again through `prefill`.
  const setQuantity = (key: string, quantityInput: string): void => {
    const row = lines.find((r) => r.key === key);
    const invalid = parsePositiveInt(quantityInput) === null;
    setLines((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        return invalid && r.priceSource === 'resolved'
          ? { ...r, quantityInput, agreedUnitPrice: '', priceSource: 'none' }
          : { ...r, quantityInput };
      }),
    );
    if (row) prefill({ ...row, quantityInput }, customer);
  };

  // Typing a price makes it the operator's: it is never prefilled again (FR-033).
  const setPrice = (key: string, agreedUnitPrice: string): void => {
    setLines((prev) =>
      prev.map((r) => (r.key === key ? { ...r, agreedUnitPrice, priceSource: 'manual' } : r)),
    );
    queueRef.current?.forget(key);
    markResolving(key, false);
  };

  const removeLine = (key: string): void => {
    setLines((prev) => prev.filter((r) => r.key !== key));
    queueRef.current?.forget(key);
    markResolving(key, false);
  };
  // One confirm per opening of the browser (see `appendLines`).
  const browserConfirmed = useRef(false);
  const openBrowser = (target: string | null): void => {
    browserConfirmed.current = false;
    setAddTarget(target);
    setBrowserOpen(true);
  };

  // Every line is sent; a line with an invalid quantity or a price that is not
  // one blocks both actions rather than being dropped from the request
  // (FR-034). `specs/192-quote-request-draft-share/` (FR-013) — a line with no
  // price yet may be saved; only sharing needs every price (FR-026).
  const parsedLines = lines.map((row) => ({
    row,
    quantity: parsePositiveInt(row.quantityInput),
    price: parsePrice(row.agreedUnitPrice),
    priceInvalid: row.agreedUnitPrice.trim() !== '' && parsePrice(row.agreedUnitPrice) === null,
  }));
  const parsedByKey = new Map(parsedLines.map((l) => [l.row.key, l]));
  const linesSavable = parsedLines.every((l) => l.quantity !== null && !l.priceInvalid);
  const allPriced = parsedLines.every((l) => l.price !== null);
  const hasOrg = Boolean(customer?.organizationId);
  // Exact decimal arithmetic (issue #417).
  const total = quoteNet(
    parsedLines.flatMap((l) => (l.quantity !== null && l.price !== null ? [{ price: l.price, quantity: l.quantity }] : [])),
  );
  // Feature 159 — every group needs a name before the request can be created.
  const groupsNamed = groups.every((group) => group.name.trim() !== '');
  const channelChosen = !channelsLoading && !channelsFailed && channelOptions !== null && chosenChannelId !== '';
  const daysInvalid = validity.input.kind === 'invalid';
  // Until the default is known the question could not name the validity the share writes.
  const defaultPending = defaultDays.status === 'loading' && !validityTouched;
  const canSave =
    hasOrg && lines.length > 0 && linesSavable && groupsNamed && channelChosen && !daysInvalid && busy === null && !created;
  const canShare = canSave && allPriced && !defaultPending;
  /** What the create sends as `expiresInDays`; absent = the store's default, applied by the server. */
  const daysPayload = validity.payload;
  // In display order: each group's lines, then the ungrouped ones.
  const knownGroups = new Set(groups.map((group) => group.key));
  const orderedLines = [
    ...groups.flatMap((group) => parsedLines.filter((l) => l.row.groupKey === group.key)),
    ...parsedLines.filter((l) => l.row.groupKey === null || !knownGroups.has(l.row.groupKey)),
  ];

  /** Where the screen goes once the request exists. */
  const leaveFor = (id: string): void => {
    if (openedWith.returnTo) {
      navigate(openedWith.returnTo, { state: { createdDocument: { id } } });
    } else {
      navigate(`/quote-requests/${id}`);
    }
  };

  /**
   * `specs/192-quote-request-draft-share/` (FR-020, US2 #7) — the quote exists
   * but its share was refused: the operator lands on it, a draft, with the
   * refusal said there once. The opener's way back stays on its address.
   */
  const leaveRefused = (id: string, refusal: ShareRefusal): void => {
    const target = `/quote-requests/${id}`;
    const state: RfqDetailArrival = { shareRefusal: refusal, afterCreate: true };
    navigate(openedWith.returnTo ? withReturnTo(target, openedWith.returnTo) : target, { state });
  };

  /**
   * The question before a share — who is told, and the validity written. Before
   * *Create and share* it asks about a quote still to be created; after a create
   * that warned (`existing`), about the quote that now exists, as the detail does.
   */
  const confirmShare = (days: number | null | undefined, existing?: { reference: string }): Promise<boolean> =>
    confirm({
      title: existing ? tGroups('share.confirm.title', { id: existing.reference }) : tGroups('create.confirm.title'),
      message:
        days === undefined
          ? tGroups('share.confirm.message', {
              customer: shareCustomerName(tGroups, customer),
              validity: tGroups('share.confirm.validityDefault'),
            })
          : shareConfirmMessage(tGroups, {
              customer: shareCustomerName(tGroups, customer),
              days,
              now: new Date(),
              language,
            }),
      confirmLabel: existing ? tGroups('share.action') : tGroups('create.share'),
    });

  /** Shares a quote just created; lands on it either way. */
  const shareCreated = async (id: string, version: number): Promise<void> => {
    try {
      await apiClient.post(`/api/v1/admin/quote-requests/${id}/share`, {}, { headers: { 'If-Match': `"${version}"` } });
      leaveFor(id);
    } catch (err) {
      leaveRefused(id, shareRefusalOf(err) ?? { code: SHARE_FAILED_CODE, message: tGroups('share.error'), lines: [] });
    }
  };

  const submit = async (mode: 'save' | 'share'): Promise<void> => {
    if (!customer?.organizationId || !(mode === 'share' ? canShare : canSave)) return;
    if (mode === 'share' && !(await confirmShare(validity.confirmDays))) return;
    setBusy(mode);
    setError(null);
    setCustomFieldErrors({});
    try {
      const res = await apiClient.post<{ data: { id: string; businessId?: string; version: number }; warnings?: AdminQuoteRequestWarning[] }>('/api/v1/admin/quote-requests', {
        organizationId: customer.organizationId,
        customerAccountId: customer.id,
        salesChannelId: chosenChannelId,
        ...(headerNote.trim() ? { headerNote: headerNote.trim() } : {}),
        ...(daysPayload !== undefined ? { expiresInDays: daysPayload } : {}),
        // Sent only when there is a group: a request without one is unchanged.
        ...(groups.length > 0 ? { groups: groups.map((group) => ({ key: group.key, name: group.name.trim() })) } : {}),
        items: orderedLines.map((l) => ({
          productId: l.row.productId,
          quantity: l.quantity ?? 0,
          // No price yet: the key is left out, never sent as 0 (FR-013).
          ...(l.price !== null ? { agreedUnitPrice: l.price } : {}),
          ...(groups.length > 0
            ? { groupKey: l.row.groupKey !== null && knownGroups.has(l.row.groupKey) ? l.row.groupKey : null }
            : {}),
        })),
        ...(openedWith.origin ? { origin: openedWith.origin } : {}),
        ...(canSeeCustomFields && Object.keys(customFieldValues).length > 0 ? { customFieldValues } : {}),
      });
      const createdQuote = { id: res.data.id, businessId: res.data.businessId, version: res.data.version };
      // Feature 163 (FR-018) — accepted, but some lines are not available to
      // the customer on the chosen channel: named here before the operator
      // leaves. `specs/192` (OQ-7) — and nothing is shared on the operator's behalf.
      if (res.warnings && res.warnings.length > 0) {
        setCreated({ ...createdQuote, warnings: res.warnings, viaShare: mode === 'share' });
      } else if (mode === 'share') {
        await shareCreated(createdQuote.id, createdQuote.version);
      } else {
        leaveFor(createdQuote.id);
      }
    } catch (err) {
      // Only the create can land here: a refused share leaves for the quote.
      setCustomFieldErrors(customFieldErrorsOf(err) ?? {});
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfqCreate.error'));
    } finally {
      setBusy(null);
    }
  };

  /** *Share with customer* after a create that warned (US2 #8). */
  const shareAfterWarnings = async (): Promise<void> => {
    if (!created || busy !== null) return;
    if (!(await confirmShare(validity.confirmDays, { reference: created.businessId ?? created.id.slice(0, 8) }))) return;
    setBusy('share');
    try {
      await shareCreated(created.id, created.version);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('rfqCreate.title')}
        back={
          // Opened from elsewhere: the way back leads there, and says only "Back".
          openedWith.returnTo
            ? { label: t('common.action.back'), to: openedWith.returnTo }
            : { label: t('rfq.list.title'), to: '/quote-requests' }
        }
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('rfqCreate.section.customer')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <FormField label={t('rfqCreate.field.customer')} id="customerAccountId">
            {(control) => (
              <CustomerPicker
                id={control.id}
                value={customer}
                onChange={setCustomer}
                organizationId={openedWith.organizationId}
              />
            )}
          </FormField>
          {customer && !hasOrg ? (
            <Alert variant="destructive">
              <AlertDescription>{t('rfqCreate.noOrgWarning')}</AlertDescription>
            </Alert>
          ) : null}
          {channelsFailed ? (
            // Not read, so nothing to offer and nothing sent: said, with a way back.
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{t('rfqCreate.channelsLoadError')}</span>
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
          ) : channelOptions !== null && channelOptions.length === 0 ? (
            // Nothing the API would accept (security review M1): said, never papered over.
            <Alert variant="destructive">
              <AlertDescription>{t('rfqCreate.noChannelWarning')}</AlertDescription>
            </Alert>
          ) : channelOptions !== null ? (
            <div className="space-y-1 pt-2">
              <Label htmlFor="salesChannelId">{t('rfqCreate.field.salesChannel')}</Label>
              <Combobox<string>
                id="salesChannelId"
                ariaLabel={t('rfqCreate.field.salesChannel')}
                options={channelOptions.map((c) => ({ value: c.id, label: channelLabel(c, locale), description: c.code }))}
                value={salesChannelId === '' ? null : salesChannelId}
                onChange={(next): void => setSalesChannelId(next ?? '')}
                placeholder={t('rfqCreate.placeholder.salesChannel')}
                emptyMessage={t('rfqCreate.empty.salesChannels')}
              />
              <p className="text-xs text-muted-foreground">{t('rfqCreate.hint.salesChannel')}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('rfqCreate.section.items')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <ProductBrowserTrigger onOpen={(): void => openBrowser(null)} />
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor={`${itemsId}-quick-search`}>{t('rfqCreate.items.quickSearch')}</Label>
              <ProductPicker
                mode="select"
                id={`${itemsId}-quick-search`}
                ariaLabel={t('rfqCreate.items.quickSearch')}
                value={null}
                onChange={(): void => {}}
                onPickProduct={(item): void => appendLines([item])}
                rules={RFQ_PRODUCT_RULES}
                includeArchived
                placeholder={t('rfqCreate.placeholder.product')}
              />
            </div>
          </div>
          <ProductBrowserDialog
            open={browserOpen}
            title={t('rfqCreate.items.browse')}
            rules={RFQ_PRODUCT_RULES}
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

          {lines.length === 0 && groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('rfqCreate.items.empty')}</p>
          ) : (
            <LineGroupsEditor<LineRow>
              layout="table"
              columnCount={4}
              tableHeader={
                <TableRow>
                  <TableHead>{t('rfqCreate.field.product')}</TableHead>
                  <TableHead id={`${itemsId}-qty`} className="w-28">
                    {t('rfqCreate.field.quantity')}
                  </TableHead>
                  <TableHead id={`${itemsId}-price`} className="w-40">
                    {t('rfqCreate.field.agreedUnitPrice')}
                  </TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">{t('common.action.delete')}</span>
                  </TableHead>
                </TableRow>
              }
              groups={groups}
              lines={lines}
              disabled={busy !== null}
              labels={groupLabels}
              createGroupKey={(): string => `group-${(groupCounter.current += 1)}`}
              getLineLabel={(row): string => row.name}
              onChange={(next): void => {
                setGroups(next.groups);
                linesRef.current = next.lines;
                setLines(next.lines);
              }}
              renderSummary={(sectionLines): ReactNode => (
                <SectionSummary
                  text={summaryText(
                    sectionTotals(
                      sectionLines.map((row) => {
                        const parsed = parsedByKey.get(row.key);
                        return {
                          net:
                            parsed && parsed.quantity !== null && parsed.price !== null ? Number(lineAmountHalfUp(parsed.price, parsed.quantity)) : null,
                          reference: null,
                        };
                      }),
                      null,
                    ),
                    null,
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
                  const { quantity, price, priceInvalid } = parsedByKey.get(row.key)!;
                  const rowId = `${itemsId}-${row.key}`;
                  const isResolving = resolving.has(row.key);
                  // No price yet is allowed on a draft (FR-013): said, not flagged as an error.
                  const priceMissing = price === null && !priceInvalid && !isResolving;
                  const priceNoteShown = priceMissing || priceInvalid;
                  return (
                    <>
                      <TableCell>
                        <div id={`${rowId}-name`} data-line-name className="font-medium">
                          {row.name}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">{row.sku}</div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Input
                          id={`${rowId}-qty`}
                          type="text"
                          inputMode="numeric"
                          aria-labelledby={`${itemsId}-qty ${rowId}-name`}
                          aria-invalid={quantity === null || undefined}
                          aria-describedby={quantity === null ? `${rowId}-qty-reason` : undefined}
                          value={row.quantityInput}
                          onChange={(e): void => setQuantity(row.key, e.target.value)}
                        />
                        {quantity === null ? (
                          <p id={`${rowId}-qty-reason`} className="mt-1 text-xs text-destructive">
                            {t('rfqCreate.line.quantityInvalid')}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <Input
                          id={`${rowId}-price`}
                          type="number"
                          min={0}
                          step="0.0001"
                          aria-labelledby={`${itemsId}-price ${rowId}-name`}
                          aria-invalid={priceInvalid || undefined}
                          aria-describedby={priceNoteShown ? `${rowId}-price-reason` : undefined}
                          aria-busy={isResolving || undefined}
                          value={row.agreedUnitPrice}
                          onChange={(e): void => setPrice(row.key, e.target.value)}
                        />
                        {isResolving ? (
                          <p className="mt-1 text-xs text-muted-foreground">{t('rfqCreate.loading')}</p>
                        ) : priceInvalid ? (
                          <p id={`${rowId}-price-reason`} className="mt-1 text-xs text-destructive">
                            {tGroups('create.line.priceInvalid')}
                          </p>
                        ) : priceMissing ? (
                          <p id={`${rowId}-price-reason`} className="mt-1 text-xs text-muted-foreground">
                            {t('rfqCreate.line.priceMissing')}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex items-center gap-1">
                        {slots.handle}
                        {slots.moveMenu}
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
                        </div>
                      </TableCell>
                    </>
                  );
                }}
            />
          )}
          <div className="flex justify-end pt-2 text-sm font-medium">
            {t('rfqCreate.total')}: {total}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('rfqCreate.section.options')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="headerNote">{t('rfqCreate.field.headerNote')}</Label>
            <Textarea
              id="headerNote"
              rows={3}
              value={headerNote}
              placeholder={t('rfqCreate.placeholder.headerNote')}
              onChange={(e): void => setHeaderNote(e.target.value)}
            />
          </div>
          {/* `specs/192-quote-request-draft-share/` (FR-031) — the days count from
              sharing, so the store's default can be shown here without committing
              the customer to a date. */}
          <div className="space-y-1">
            <Label htmlFor="expiresInDays">{tGroups('validity.unshared.field')}</Label>
            <Input
              id="expiresInDays"
              className="w-40 tabular-nums"
              type="number"
              min={0}
              max={QUOTE_VALIDITY_DAYS_MAX}
              step={1}
              inputMode="numeric"
              value={validity.value}
              placeholder={
                validity.wording === 'storeDefault'
                  ? tGroups('create.validity.storeDefault.placeholder')
                  : t('rfqCreate.placeholder.expiresInDays')
              }
              aria-invalid={daysInvalid || undefined}
              aria-describedby="expiresInDays-help"
              aria-busy={defaultPending || undefined}
              onChange={(e): void => {
                setValidityTouched(true);
                setExpiresInDays(e.target.value);
              }}
            />
            <p
              id="expiresInDays-help"
              className={daysInvalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
            >
              {daysInvalid
                ? t('rfq.detail.validity.error.days')
                : validity.wording === 'storeDefault'
                  ? tGroups('create.validity.storeDefault.hint', { max: QUOTE_VALIDITY_DAYS_MAX })
                  : tGroups('create.validity.hint', { max: QUOTE_VALIDITY_DAYS_MAX })}
            </p>
          </div>
        </CardContent>
      </Card>

      {canSeeCustomFields ? (
        <div className="mb-4">
          <CustomFieldValuesPanel
            chrome="card"
            entityType="quote_request"
            values={EMPTY_VALUES}
            onChange={setCustomFieldValues}
            fieldErrors={customFieldErrors}
            language={language}
          />
        </div>
      ) : null}

      {created ? (
        <Alert variant="warning" live="assertive" className="mb-4">
          <AlertTitle>{t('rfqCreate.warnings.title')}</AlertTitle>
          <AlertDescription>
            <p>{t('rfqCreate.warnings.description')}</p>
            {created.viaShare ? <p className="mt-1 font-medium">{tGroups('create.warnings.notShared')}</p> : null}
            <ul className="mt-2 list-disc pl-5">
              {created.warnings.map((warning) => (
                <li key={warning.productId}>
                  {lines.find((row) => row.productId === warning.productId)?.name ?? warning.productId}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Issue #1449 (DS-19) — the one action stays in view over a long list of lines; a refused
          create is said beside it, and so is why it is disabled (the order create screen's gate
          hint), as the note that describes it. */}
      {/* Issue #1449 (DS-19) — the actions stay in view over a long list of lines; a refused
          create is said beside them, and so is why *Create and share* is disabled, as the note
          that describes it. `specs/192-quote-request-draft-share/` — *Save as draft* is the
          outlined secondary, *Create and share* the one filled primary (Von Restorff); sharing
          tells the customer, so it is asked first. */}
      <StickyFormActions
        desktop="sticky"
        error={error}
        note={
          created
            ? null
            : !channelChosen && (channelOptions?.length ?? 0) > 0
              ? t('rfqCreate.gate.missingChannel')
              : canSave && !allPriced
                ? tGroups('create.gate.prices')
                : canSave && defaultPending
                  ? tGroups('create.gate.defaults')
                  : null
        }
        secondary={
          created ? (
            created.viaShare ? (
              <Button variant="outline" disabled={busy !== null} onClick={(): void => leaveFor(created.id)}>
                {t('rfqCreate.warnings.open')}
              </Button>
            ) : null
          ) : (
            <Button
              variant="outline"
              disabled={!canSave}
              aria-busy={busy === 'save' || undefined}
              onClick={(): void => void submit('save')}
            >
              {busy === 'save' ? t('rfqCreate.submitting') : t('rfqCreate.submit')}
            </Button>
          )
        }
        primary={
          created ? (
            created.viaShare ? (
              <Button
                disabled={busy !== null}
                aria-busy={busy === 'share' || undefined}
                onClick={(): void => void shareAfterWarnings()}
              >
                {busy === 'share' ? tGroups('create.sharing') : tGroups('share.action')}
              </Button>
            ) : (
              <Button onClick={(): void => leaveFor(created.id)}>{t('rfqCreate.warnings.open')}</Button>
            )
          ) : (
            <Button
              disabled={!canShare}
              aria-busy={busy === 'share' || undefined}
              onClick={(): void => void submit('share')}
            >
              {busy === 'share' ? tGroups('create.sharing') : tGroups('create.share')}
            </Button>
          )
        }
      />
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default RfqCreatePage;
