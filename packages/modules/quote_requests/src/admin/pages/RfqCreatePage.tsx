import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Combobox,
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
  LineGroupsEditor,
  ProductBrowserDialog,
  ProductBrowserTrigger,
  ProductPicker,
  parsePositiveInt,
  productDisplayName,
  type ProductBrowserItem,
  type ProductBrowserRules,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { createPricePrefillQueue, type PricePrefillQueue } from '../lib/price-prefill-queue';
import { SectionSummary, sectionTotals, useQuoteLineGroupLabels, useSectionSummaryText } from '../line-groups.js';
import { quoteNet } from '../quote-totals.js';
import { lineAmountHalfUp } from '@endora-commerce/contracts';

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readOpenedWith(params: URLSearchParams): OpenedWith {
  const type = params.get('originType') ?? '';
  const id = params.get('originId') ?? '';
  const returnTo = params.get('returnTo') ?? '';
  return {
    origin: ORIGIN_TYPE.test(type) && UUID.test(id) ? { type, id } : null,
    organizationId: params.get('organizationId') ?? '',
    customerAccountId: params.get('customerAccountId') ?? '',
    // A path of this application only: never a scheme, a host or `//`.
    returnTo: /^\/(?![/\\])/.test(returnTo) ? returnTo : null,
  };
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
      id="customerAccountId"
      ariaLabel="customerAccountId"
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

/** The quote request's selectability rules for the picker and the quick search (Clarifications). */
const RFQ_PRODUCT_RULES: ProductBrowserRules = {
  initialStatus: 'active',
  blockedTypes: ['grouped', 'bundle'],
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

export function RfqCreatePage(): ReactNode {
  const t = useTranslation('core');
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              ? { ...row, agreedUnitPrice: amount ?? '', priceSource: amount === null ? 'none' : 'resolved' }
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
      if (row.priceSource === 'manual' || quantity === null || !cust?.organizationId) {
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
      });
      markResolving(row.key, true);
    },
    [markResolving],
  );

  // A customer change (including the one the page was opened with) clears every
  // price not typed by hand and asks again for the new customer — a previous
  // customer's price never stays on as if it were this one's (research R-11).
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  });
  const pricedForRef = useRef<string | null>(null);
  useEffect(() => {
    // Identity and organization, not the object: re-reading the same customer is no change.
    const key = `${customer?.id ?? ''}:${customer?.organizationId ?? ''}`;
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
  }, [customer, prefill]);

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

  // Every line is sent; a line with an invalid quantity or no price blocks
  // submit rather than being dropped from the request (FR-034).
  const parsedLines = lines.map((row) => ({
    row,
    quantity: parsePositiveInt(row.quantityInput),
    price: parsePrice(row.agreedUnitPrice),
  }));
  const parsedByKey = new Map(parsedLines.map((l) => [l.row.key, l]));
  const allLinesComplete = parsedLines.every((l) => l.quantity !== null && l.price !== null);
  const hasOrg = Boolean(customer?.organizationId);
  // Exact decimal arithmetic (issue #417).
  const total = quoteNet(
    parsedLines.flatMap((l) => (l.quantity !== null && l.price !== null ? [{ price: l.price, quantity: l.quantity }] : [])),
  );
  // Feature 159 — every group needs a name before the request can be created.
  const groupsNamed = groups.every((group) => group.name.trim() !== '');
  const canSubmit = hasOrg && lines.length > 0 && allLinesComplete && groupsNamed && !busy;
  // In display order: each group's lines, then the ungrouped ones.
  const knownGroups = new Set(groups.map((group) => group.key));
  const orderedLines = [
    ...groups.flatMap((group) => parsedLines.filter((l) => l.row.groupKey === group.key)),
    ...parsedLines.filter((l) => l.row.groupKey === null || !knownGroups.has(l.row.groupKey)),
  ];

  const submit = async (): Promise<void> => {
    if (!customer?.organizationId || !allLinesComplete || !groupsNamed) return;
    setBusy(true);
    setError(null);
    try {
      const trimmedExpiry = expiresInDays.trim();
      const res = await apiClient.post<{ data: { id: string } }>('/api/v1/admin/quote-requests', {
        organizationId: customer.organizationId,
        customerAccountId: customer.id,
        ...(headerNote.trim() ? { headerNote: headerNote.trim() } : {}),
        ...(trimmedExpiry !== '' ? { expiresInDays: Number(trimmedExpiry) } : {}),
        // Sent only when there is a group: a request without one is unchanged.
        ...(groups.length > 0 ? { groups: groups.map((group) => ({ key: group.key, name: group.name.trim() })) } : {}),
        items: orderedLines.map((l) => ({
          productId: l.row.productId,
          quantity: l.quantity ?? 0,
          agreedUnitPrice: l.price ?? 0,
          ...(groups.length > 0
            ? { groupKey: l.row.groupKey !== null && knownGroups.has(l.row.groupKey) ? l.row.groupKey : null }
            : {}),
        })),
        ...(openedWith.origin ? { origin: openedWith.origin } : {}),
      });
      if (openedWith.returnTo) {
        navigate(openedWith.returnTo, { state: { createdDocument: { id: res.data.id } } });
      } else {
        navigate(`/quote-requests/${res.data.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfqCreate.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('rfqCreate.title')}
        description={t('rfqCreate.description')}
        back={
          // Opened from elsewhere: the way back leads there, and says only "Back".
          openedWith.returnTo
            ? { label: t('common.action.back'), to: openedWith.returnTo }
            : { label: t('rfqCreate.back'), to: '/quote-requests' }
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('rfqCreate.section.customer')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="customerAccountId">{t('rfqCreate.field.customer')}</Label>
          <CustomerPicker
            value={customer}
            onChange={setCustomer}
            organizationId={openedWith.organizationId}
          />
          {customer && !hasOrg ? (
            <Alert variant="destructive">
              <AlertDescription>{t('rfqCreate.noOrgWarning')}</AlertDescription>
            </Alert>
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
              disabled={busy}
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
                  const { quantity, price } = parsedByKey.get(row.key)!;
                  const rowId = `${itemsId}-${row.key}`;
                  const isResolving = resolving.has(row.key);
                  const priceMissing = price === null && !isResolving;
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
                          step="0.01"
                          aria-labelledby={`${itemsId}-price ${rowId}-name`}
                          aria-invalid={priceMissing || undefined}
                          aria-describedby={priceMissing ? `${rowId}-price-reason` : undefined}
                          aria-busy={isResolving || undefined}
                          value={row.agreedUnitPrice}
                          onChange={(e): void => setPrice(row.key, e.target.value)}
                        />
                        {isResolving ? (
                          <p className="mt-1 text-xs text-muted-foreground">{t('rfqCreate.loading')}</p>
                        ) : priceMissing ? (
                          <p id={`${rowId}-price-reason`} className="mt-1 text-xs text-destructive">
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
          <div className="w-40 space-y-1">
            <Label htmlFor="expiresInDays">{t('rfqCreate.field.expiresInDays')}</Label>
            <Input
              id="expiresInDays"
              type="number"
              min={0}
              value={expiresInDays}
              placeholder={t('rfqCreate.placeholder.expiresInDays')}
              onChange={(e): void => setExpiresInDays(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={!canSubmit} onClick={(): void => void submit()}>
          {busy ? t('rfqCreate.submitting') : t('rfqCreate.submit')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default RfqCreatePage;
