import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Columns3, Download, ListChecks, Plus, Printer, ShoppingBag } from 'lucide-react';
import { ApiError, apiBaseUrl, apiClient, formatDateTime, formatMoney, statusBadgeStyle, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, EmptyState, InlineStatus, Input, Label, Select, MultiSelect, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import type { MultiSelectOption } from '@endora-commerce/admin-kit/ui';
import {
  CustomFieldListFilters,
  customFieldDisplayName,
  customFieldFilterChips,
  customFieldFilterRefusal,
  emptyCustomFieldFilters,
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  OrganizationPicker,
  pruneRemovedOptions,
  readCustomFieldFilterParams,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  SavedViewsControl,
  sanitizeCustomFieldFilters,
  toCustomFieldFiltersParam,
  useCustomFieldListFilterFields,
  useListPagination,
  withCustomFieldFilter,
  writeCustomFieldFilterParams,
} from '@endora-commerce/admin-kit/components';
import type { AppliedFilter, ListPageLoad, ResponsiveColumn, SavedViewState } from '@endora-commerce/admin-kit/components';
import type { CustomFieldFilters } from '@endora-commerce/contracts';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { orderStatusName } from '../lib/status-name.js';
import { DISPLAYABLE_PAYMENT_STATUSES, paymentStatusLabelKey } from '../lib/paymentStatus.js';
import { OrdersBulkStatusDialog } from '../components/OrdersBulkStatusDialog.js';

interface AdminOrderRow {
  id: string;
  businessId: string;
  customerName: string | null;
  organizationId: string;
  organizationName: string | null;
  status: string;
  statusName: Record<string, string>;
  paymentStatus: string;
  total: number;
  currency: string;
  placedAt: string;
  createdAt: string;
  salesChannelId: string;
  salesChannelName: string | null;
  deliveryMethodName: string | null;
  paymentMethodName: string | null;
  shipToName: string | null;
  billToName: string | null;
}
interface StatusDef {
  code: string;
  name: Record<string, string>;
  color: string;
}
interface MethodOption {
  id: string;
  code: string;
  name: Record<string, string>;
}
interface ListResponse {
  data: AdminOrderRow[];
  pagination: { page: number; pageSize: number; total: number };
  counts?: Record<string, number>;
  /** Feature 085 — the money axis, counted separately from the lifecycle one. */
  paymentStatusCounts?: Record<string, number>;
}

/**
 * The API origin, taken from the kit rather than re-read here (feature 091,
 * batch 15).
 *
 * A package's `tsconfig.ui.json` carries no `vite/client` types, so
 * `import.meta.env` does not compile in one — which is the compiler catching
 * batch 9's `AssetDetailDrawer` finding for free: a private copy of a value the
 * kit already publishes. **One behaviour change, recorded rather than glossed**:
 * the copy fell back to `''` where `apiBaseUrl` falls back to
 * `http://localhost:3001`, so on a build with no `VITE_API_BASE_URL` these two
 * links now go where every `apiClient` call on this same screen already went.
 */
const API_BASE = apiBaseUrl;

// Pickable columns in display order. `select` (bulk checkbox) and the actions
// column are structural and always rendered, so they are not in the picker.
const COLUMN_IDS = [
  'order',
  'placedAt',
  'salesChannel',
  'customer',
  'org',
  'status',
  'payment',
  'paymentMethod',
  'deliveryMethod',
  'shipTo',
  'billTo',
  'total',
] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

// Default-visible set (the rest start hidden, toggled via the column picker).
//
// `payment` joined it with feature 085 (FR-023): `on_hold` now carries two
// different situations — a payment that failed and an order fully refunded —
// and the money axis is the only thing that tells them apart. A column an
// operator has to go and enable does not satisfy "distinguishable without
// opening either".
const DEFAULT_VISIBLE: ColumnId[] = [
  'order',
  'placedAt',
  'salesChannel',
  'customer',
  'org',
  'status',
  'payment',
  'total',
];

function pickName(name: Record<string, string> | undefined | null): string {
  if (!name) return '';
  return name['en'] ?? name['en-US'] ?? Object.values(name)[0] ?? '';
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v) return [v];
  return [];
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const EMPTY_TEXT = { q: '', orgName: '', customerName: '', totalMin: '', totalMax: '' };

/** The list's sort before anything is chosen, and what a view saved without one loads. */
const DEFAULT_SORT = 'placedAt:desc';

/** `GET /api/v1/admin/orders` serves at most 200 rows a page. */
const MAX_PAGE_SIZE = 200;

/** The endpoint naming the Order custom fields this list offers as filters (feature 157). */
const CUSTOM_FIELD_FILTERS_ENDPOINT = '/api/v1/admin/orders/custom-field-filters';

/**
 * A saved view's custom-field filters kept as saved, for when the offered
 * fields are not known (still loading, or failed): written to and read back
 * from the address form, which re-applies the key grammar, each filter's
 * schema and the caps — nothing more is judged until the fields are known.
 */
function savedCustomFieldFilters(saved: unknown): CustomFieldFilters {
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return emptyCustomFieldFilters();
  return readCustomFieldFilterParams(
    writeCustomFieldFilterParams(new URLSearchParams(), saved as CustomFieldFilters),
  );
}

export function OrdersList(): ReactNode {
  const t = useTranslation('core');
  const tOrders = useTranslation('orders');
  const { language } = useTranslationContext();
  // Issue #1500 — the kit pager, fitted to what the endpoint serves.
  const pager = useListPagination({ scope: 'orders', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  // `/orders/new` opens on `orders:write`; a read-only operator is not offered it.
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('orders:write');
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [paymentStatusCounts, setPaymentStatusCounts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<StatusDef[]>([]);
  const [channels, setChannels] = useState<MethodOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<MethodOption[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<MethodOption[]>([]);

  // Filters.
  const [statusCodes, setStatusCodes] = useState<string[]>(() => searchParams.getAll('status'));
  // Feature 085 (FR-021) — deep-linkable like the status filter, so a saved
  // link or a dashboard tile can point an operator straight at the held orders.
  const [paymentStatuses, setPaymentStatuses] = useState<string[]>(() =>
    searchParams.getAll('paymentStatus'),
  );
  const [salesChannelIds, setSalesChannelIds] = useState<string[]>([]);
  const [paymentMethodIds, setPaymentMethodIds] = useState<string[]>([]);
  const [deliveryMethodIds, setDeliveryMethodIds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // `specs/182-related-payers/` FR-073 — orders a related payer pays for.
  const [payerOrganizationId, setPayerOrganizationId] = useState<string | null>(null);
  const [textFilters, setTextFilters] = useState(EMPTY_TEXT);
  const [debouncedText, setDebouncedText] = useState(EMPTY_TEXT);
  // Feature 157 — custom-field filters, deep-linkable as `cf.<key>.<op>`.
  const customFieldFields = useCustomFieldListFilterFields(CUSTOM_FIELD_FILTERS_ENDPOINT);
  const [customFieldFilters, setCustomFieldFilters] = useState<CustomFieldFilters>(() =>
    readCustomFieldFilterParams(searchParams),
  );
  /** The key the server refused, until the operator removes it. */
  const [refusedCustomField, setRefusedCustomField] = useState<string | null>(null);
  /** The keys a loaded view carried that the list no longer offers. */
  const [droppedCustomFields, setDroppedCustomFields] = useState<string[]>([]);
  /** The results region, focused once a refused filter is removed. */
  const resultsRef = useRef<HTMLDivElement | null>(null);
  /** Set when a refused filter is removed: focus the results once they are back. */
  const focusResultsOnLoad = useRef(false);
  /** Numbers each list request, so a slower, older answer cannot land last. */
  const requestSequence = useRef(0);

  /**
   * The custom-field filters changed: back to the first page in the same
   * update — so no request carries the new filters with the old page — and a
   * dropped-filters notice about the previous state is no longer news.
   */
  const changeCustomFieldFilters = useCallback((next: CustomFieldFilters): void => {
    setCustomFieldFilters(next);
    resetPage();
    setDroppedCustomFields([]);
  }, [resetPage]);

  const [sort, setSort] = useState(DEFAULT_SORT);
  /** Prefix of the folded filters' ids, so each label names its control. */
  const filterId = useId();
  const [visibleColumnIds, setVisibleColumnIds] = useState<ColumnId[]>(DEFAULT_VISIBLE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The orders the status dialog is open for: the selection, or the one row its menu was opened on. */
  const [statusDialogIds, setStatusDialogIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  /** Why the list could not be read — the list's own state, beside which *Retry* is offered. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** An action on the list that failed (printing, saved views) — a notice above the results. */
  const [error, setError] = useState<string | null>(null);
  /** The search box, where focus goes once *Clear filters* empties the list's filters. */
  const searchRef = useRef<HTMLInputElement>(null);
  // Issue #1499 (UX audit SALES-17, DEC-12 a) — a bulk status change's result
  // is said beside the header's actions, in a region mounted before it has
  // text: the dialog that ran it is gone, and the bulk bar goes with the
  // selection, so the header is what is still on screen. Not a success banner.
  const { props: bulkStatus, show: showBulkStatus, clear: clearBulkStatus } = useInlineStatus();

  // Debounce the free-text / numeric filters.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedText(textFilters), 300);
    return () => window.clearTimeout(id);
  }, [textFilters]);

  useEffect(() => {
    // Coerce each list with `?? []` so a malformed/missing payload can never
    // leave the state `undefined` — the filter controls map over these arrays
    // on every render and would otherwise crash.
    void apiClient
      .get<{ data: { statuses: StatusDef[] } }>('/api/v1/admin/orders/statuses')
      .then((res) => setStatuses(res.data?.statuses ?? []))
      .catch(() => setStatuses([]));
    void apiClient
      .get<{ items: MethodOption[] }>('/api/v1/admin/sales-channels?pageSize=100')
      .then((res) => setChannels(res.items ?? []))
      .catch(() => setChannels([]));
    void apiClient
      .get<{ data: MethodOption[] }>('/api/v1/admin/payment-methods')
      .then((res) => setPaymentMethods(res.data ?? []))
      .catch(() => setPaymentMethods([]));
    void apiClient
      .get<{ data: MethodOption[] }>('/api/v1/admin/delivery-methods')
      .then((res) => setDeliveryMethods(res.data ?? []))
      .catch(() => setDeliveryMethods([]));
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(pager.query.page));
    params.set('pageSize', String(pager.query.pageSize));
    params.set('sort', sort);
    for (const s of statusCodes) params.append('status', s);
    for (const s of paymentStatuses) params.append('paymentStatus', s);
    for (const id of salesChannelIds) params.append('salesChannelId', id);
    for (const id of paymentMethodIds) params.append('paymentMethodId', id);
    for (const id of deliveryMethodIds) params.append('deliveryMethodId', id);
    if (dateFrom) params.set('placedFrom', `${dateFrom}T00:00:00.000Z`);
    if (dateTo) params.set('placedTo', `${dateTo}T23:59:59.999Z`);
    if (payerOrganizationId) params.set('payerOrganizationId', payerOrganizationId);
    const { q, orgName, customerName, totalMin, totalMax } = debouncedText;
    if (q.trim()) params.set('q', q.trim());
    if (orgName.trim()) params.set('orgName', orgName.trim());
    if (customerName.trim()) params.set('customerName', customerName.trim());
    if (totalMin.trim()) params.set('totalMin', totalMin.trim());
    if (totalMax.trim()) params.set('totalMax', totalMax.trim());
    const customFieldParam = toCustomFieldFiltersParam(customFieldFilters);
    if (customFieldParam !== null) params.set('customFieldFilters', customFieldParam);
    return params.toString();
  }, [
    customFieldFilters,
    pager.query.page,
    pager.query.pageSize,
    sort,
    statusCodes,
    paymentStatuses,
    salesChannelIds,
    paymentMethodIds,
    deliveryMethodIds,
    dateFrom,
    dateTo,
    payerOrganizationId,
    debouncedText,
  ]);

  const refresh = useCallback(async (): Promise<void> => {
    const current = ++requestSequence.current;
    setLoading(true);
    setLoadError(null);
    setRefusedCustomField(null);
    try {
      const res = await apiClient.get<ListResponse>(`/api/v1/admin/orders?${queryString}`);
      if (current !== requestSequence.current) return;
      setRows(res.data);
      setTotal(res.pagination.total);
      syncTotal(res.pagination.total);
      setCounts(res.counts ?? {});
      setPaymentStatusCounts(res.paymentStatusCounts ?? {});
      setSelected(new Set());
    } catch (err) {
      if (current !== requestSequence.current) return;
      const refused = customFieldFilterRefusal(err);
      if (refused !== null) {
        // The refusal stands in for the results: nothing listed, nothing to page.
        setRows([]);
        setTotal(0);
        setRefusedCustomField(refused);
      } else {
        setLoadError(err instanceof ApiError ? err.envelope.error.message : t('orders.error.load'));
      }
    } finally {
      if (current === requestSequence.current) setLoading(false);
    }
  }, [queryString, syncTotal, t]);

  // Once the offered fields are known, options removed since a link was made
  // are dropped from it; an unknown key stays, for the server to refuse.
  useEffect(() => {
    if (customFieldFields.status !== 'ready') return;
    const pruned = pruneRemovedOptions(customFieldFilters, customFieldFields.fields);
    if (toCustomFieldFiltersParam(pruned) !== toCustomFieldFiltersParam(customFieldFilters)) {
      changeCustomFieldFilters(pruned);
    }
  }, [customFieldFields, customFieldFilters, changeCustomFieldFilters]);

  // The address follows the custom-field filters; every other parameter stays.
  useEffect(() => {
    setSearchParams(
      (current) => {
        const next = writeCustomFieldFilterParams(current, customFieldFilters);
        return next.toString() === current.toString() ? current : next;
      },
      { replace: true },
    );
  }, [customFieldFilters, setSearchParams]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading || !focusResultsOnLoad.current) return;
    focusResultsOnLoad.current = false;
    resultsRef.current?.focus();
  }, [loading]);

  // Reset to the first page whenever a filter narrows the result set (the
  // kit pager goes back to the first page on a page-size change itself).
  useEffect(() => {
    resetPage();
  }, [
    resetPage,
    statusCodes,
    paymentStatuses,
    salesChannelIds,
    paymentMethodIds,
    deliveryMethodIds,
    dateFrom,
    dateTo,
    payerOrganizationId,
    debouncedText,
    customFieldFilters,
    sort,
  ]);

  const statusLabel = useCallback(
    (code: string): string => {
      // Issue #1809 — the operator's name for the status in the admin's language.
      return orderStatusName(statuses.find((x) => x.code === code), language, code);
    },
    [statuses, language],
  );

  const statusColor = useCallback(
    (code: string): string => statuses.find((x) => x.code === code)?.color ?? '#64748b',
    [statuses],
  );

  const toggleOne = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = (): void => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  /** A new status change starts: the previous change's result no longer applies. */
  const openStatusDialog = (orderIds: string[]): void => {
    clearBulkStatus();
    setStatusDialogIds(orderIds);
  };

  const printInvoices = async (orderIds: string[]): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/orders/bulk/print-invoices`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) throw new Error('print failed');
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch {
      setError(t('orders.error.print'));
    }
  };

  const applyView = (view: SavedViewState): void => {
    const f = view.filters;
    // FR-011: a loaded view starts on the first page. Set here, in the same
    // batch as the filters, so the list is never requested with the old page;
    // the reset effect below runs only after the first request has gone out.
    resetPage();
    setSelected(new Set());
    setStatusCodes(asStringArray(f['status']));
    setPaymentStatuses(asStringArray(f['paymentStatus']));
    setSalesChannelIds(asStringArray(f['salesChannelId']));
    setPaymentMethodIds(asStringArray(f['paymentMethodId']));
    setDeliveryMethodIds(asStringArray(f['deliveryMethodId']));
    setDateFrom(asString(f['dateFrom']));
    setDateTo(asString(f['dateTo']));
    // FR-014: a saved custom-field filter the list no longer offers is dropped,
    // and the operator is told which — but only against fields that are known.
    // While they load, or after they failed to, the saved filters are kept as
    // saved (their keys and values still checked), with no notice: nothing is
    // known to be gone.
    if (customFieldFields.status === 'ready') {
      const { kept, dropped } = sanitizeCustomFieldFilters(f['customFields'], customFieldFields.fields);
      setCustomFieldFilters(kept);
      setDroppedCustomFields(dropped);
    } else {
      setCustomFieldFilters(savedCustomFieldFilters(f['customFields']));
      setDroppedCustomFields([]);
    }
    setTextFilters({
      q: asString(f['q']),
      orgName: asString(f['orgName']),
      customerName: asString(f['customerName']),
      totalMin: asString(f['totalMin']),
      totalMax: asString(f['totalMax']),
    });
    // A view need not carry a sort (feature 147: the kit hands over `sort ?? null`).
    setSort(view.sort ? `${view.sort.field}:${view.sort.dir}` : DEFAULT_SORT);
    if (view.visibleColumns && view.visibleColumns.length) {
      setVisibleColumnIds(view.visibleColumns.filter((c): c is ColumnId => COLUMN_IDS.includes(c as ColumnId)));
    } else {
      setVisibleColumnIds(DEFAULT_VISIBLE);
    }
  };

  const currentView: SavedViewState = {
    filters: {
      ...(statusCodes.length ? { status: statusCodes } : {}),
      ...(paymentStatuses.length ? { paymentStatus: paymentStatuses } : {}),
      ...(salesChannelIds.length ? { salesChannelId: salesChannelIds } : {}),
      ...(paymentMethodIds.length ? { paymentMethodId: paymentMethodIds } : {}),
      ...(deliveryMethodIds.length ? { deliveryMethodId: deliveryMethodIds } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(debouncedText.q ? { q: debouncedText.q } : {}),
      ...(debouncedText.orgName ? { orgName: debouncedText.orgName } : {}),
      ...(debouncedText.customerName ? { customerName: debouncedText.customerName } : {}),
      ...(debouncedText.totalMin ? { totalMin: debouncedText.totalMin } : {}),
      ...(debouncedText.totalMax ? { totalMax: debouncedText.totalMax } : {}),
      ...(Object.keys(customFieldFilters).length > 0 ? { customFields: { ...customFieldFilters } } : {}),
    },
    sort: { field: sort.split(':')[0] ?? 'placedAt', dir: sort.endsWith(':asc') ? 'asc' : 'desc' },
    visibleColumns: visibleColumnIds,
  };

  const setText = (key: keyof typeof EMPTY_TEXT, value: string): void =>
    setTextFilters((prev) => ({ ...prev, [key]: value }));

  const methodOptions = (list: MethodOption[]): MultiSelectOption[] =>
    list.map((m) => ({ value: m.id, label: pickName(m.name) || m.code }));

  const statusOptions: MultiSelectOption[] = statuses.map((s) => ({
    value: s.code,
    label: `${statusLabel(s.code)}${counts[s.code] !== undefined ? ` (${counts[s.code]})` : ''}`,
  }));

  // The money axis (feature 085). The option set is the contract's own
  // vocabulary rather than the values present on this page: an operator looking
  // for failed payments must be able to pick `failed` on a page that has none.
  const paymentStatusLabel = useCallback(
    (code: string): string => t(paymentStatusLabelKey(code)),
    [t],
  );
  const paymentStatusOptions: MultiSelectOption[] = DISPLAYABLE_PAYMENT_STATUSES.map((code) => ({
    value: code,
    label: `${paymentStatusLabel(code)}${
      paymentStatusCounts[code] !== undefined ? ` (${paymentStatusCounts[code]})` : ''
    }`,
  }));

  const columnOptions: MultiSelectOption[] = COLUMN_IDS.map((id) => ({
    value: id,
    label: t(`orders.column.${id}`),
  }));

  // Filters that live behind *More filters* — counted on its toggle while it is
  // closed, so a folded bar still says the list is narrowed.
  const advancedActiveCount =
    paymentStatuses.length +
    paymentMethodIds.length +
    deliveryMethodIds.length +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (payerOrganizationId ? 1 : 0) +
    (textFilters.orgName.trim() ? 1 : 0) +
    (textFilters.customerName.trim() ? 1 : 0) +
    (textFilters.totalMin.trim() ? 1 : 0) +
    (textFilters.totalMax.trim() ? 1 : 0) +
    Object.keys(customFieldFilters).length;

  // Removable summary chips for every applied filter (search box excluded — it
  // is always visible). Operates on the live (un-debounced) text state so a
  // chip removal takes effect immediately.
  const methodName = (list: MethodOption[], id: string): string =>
    pickName(list.find((m) => m.id === id)?.name) || id;
  const filterChips: AppliedFilter[] = [
    ...statusCodes.map((code) => ({
      key: `status:${code}`,
      label: `${t('orders.field.status')}: ${statusLabel(code)}`,
      onRemove: (): void => setStatusCodes((p) => p.filter((c) => c !== code)),
    })),
    ...paymentStatuses.map((code) => ({
      key: `pstat:${code}`,
      label: `${t('orders.field.paymentStatus')}: ${paymentStatusLabel(code)}`,
      onRemove: (): void => setPaymentStatuses((p) => p.filter((c) => c !== code)),
    })),
    ...salesChannelIds.map((id) => ({
      key: `ch:${id}`,
      label: `${t('orders.field.salesChannel')}: ${methodName(channels, id)}`,
      onRemove: (): void => setSalesChannelIds((p) => p.filter((x) => x !== id)),
    })),
    ...paymentMethodIds.map((id) => ({
      key: `pay:${id}`,
      label: `${t('orders.field.paymentMethod')}: ${methodName(paymentMethods, id)}`,
      onRemove: (): void => setPaymentMethodIds((p) => p.filter((x) => x !== id)),
    })),
    ...deliveryMethodIds.map((id) => ({
      key: `del:${id}`,
      label: `${t('orders.field.deliveryMethod')}: ${methodName(deliveryMethods, id)}`,
      onRemove: (): void => setDeliveryMethodIds((p) => p.filter((x) => x !== id)),
    })),
    ...(dateFrom
      ? [{ key: 'from', label: `${t('orders.field.dateFrom')}: ${dateFrom}`, onRemove: (): void => setDateFrom('') }]
      : []),
    ...(dateTo
      ? [{ key: 'to', label: `${t('orders.field.dateTo')}: ${dateTo}`, onRemove: (): void => setDateTo('') }]
      : []),
    ...(payerOrganizationId
      ? [{ key: 'payer', label: tOrders('list.filter.payer'), onRemove: (): void => setPayerOrganizationId(null) }]
      : []),
    ...(textFilters.orgName.trim()
      ? [{ key: 'org', label: `${t('orders.field.orgName')}: ${textFilters.orgName.trim()}`, onRemove: (): void => setText('orgName', '') }]
      : []),
    ...(textFilters.customerName.trim()
      ? [{ key: 'cust', label: `${t('orders.field.customerName')}: ${textFilters.customerName.trim()}`, onRemove: (): void => setText('customerName', '') }]
      : []),
    ...(textFilters.totalMin.trim()
      ? [{ key: 'tmin', label: `≥ ${textFilters.totalMin.trim()}`, onRemove: (): void => setText('totalMin', '') }]
      : []),
    ...(textFilters.totalMax.trim()
      ? [{ key: 'tmax', label: `≤ ${textFilters.totalMax.trim()}`, onRemove: (): void => setText('totalMax', '') }]
      : []),
    ...customFieldFilterChips(customFieldFields.fields, customFieldFilters, language, t).map((chip) => ({
      key: chip.id,
      label: chip.label,
      removeLabel: chip.removeLabel,
      onRemove: (): void => changeCustomFieldFilters(chip.remove()),
    })),
  ];

  // The search narrows the list as much as a filter does, so *Clear all
  // filters* and the empty state's *Clear filters* empty it too.
  const filtersActive = filterChips.length > 0 || textFilters.q.trim() !== '';
  /** Whether the rows on screen were read through a filter — what the empty state tells apart. */
  const resultsFiltered = filterChips.length > 0 || debouncedText.q.trim() !== '';
  const clearAllFilters = (): void => {
    setStatusCodes([]);
    setPaymentStatuses([]);
    setSalesChannelIds([]);
    setPaymentMethodIds([]);
    setDeliveryMethodIds([]);
    setDateFrom('');
    setDateTo('');
    setPayerOrganizationId(null);
    setTextFilters(EMPTY_TEXT);
    changeCustomFieldFilters(emptyCustomFieldFilters());
  };

  const removeRefusedCustomField = (): void => {
    if (refusedCustomField === null) return;
    changeCustomFieldFilters(withCustomFieldFilter(customFieldFilters, refusedCustomField, null));
    setRefusedCustomField(null);
    // Focus follows the operator to what they are waiting for: the results,
    // once they are read again — the list page draws its skeleton meanwhile,
    // and the region it would have focused now is gone with it.
    focusResultsOnLoad.current = true;
  };

  // Build the visible columns in canonical order.
  const columnDefs: Record<ColumnId, ResponsiveColumn<AdminOrderRow>> = {
    order: {
      id: 'order',
      header: t('orders.column.order'),
      primary: true,
      render: (o) => (
        <Link to={`/orders/${o.id}`} className="font-mono text-xs underline underline-offset-2">
          #{o.businessId}
        </Link>
      ),
      meta: (o) => formatDateTime(o.placedAt, language),
    },
    placedAt: {
      id: 'placedAt',
      header: t('orders.column.placedAt'),
      render: (o) => formatDateTime(o.placedAt, language),
    },
    salesChannel: {
      id: 'salesChannel',
      header: t('orders.column.salesChannel'),
      render: (o) => o.salesChannelName ?? '—',
    },
    customer: {
      id: 'customer',
      header: t('orders.column.customer'),
      render: (o) => o.customerName ?? '—',
    },
    org: {
      id: 'org',
      header: t('orders.column.org'),
      render: (o) => o.organizationName ?? o.organizationId.slice(0, 8),
    },
    status: {
      id: 'status',
      header: t('orders.column.status'),
      render: (o) => (
        <Badge style={statusBadgeStyle(statusColor(o.status))}>{statusLabel(o.status)}</Badge>
      ),
    },
    payment: {
      id: 'payment',
      header: t('orders.column.payment'),
      hideOnMobile: true,
      // Feature 085 (FR-022). This printed the raw code — `awaiting_payment` —
      // in a screen that is otherwise entirely in the operator's language, and
      // the value it most needs to print now is `failed`.
      render: (o) => paymentStatusLabel(o.paymentStatus),
    },
    paymentMethod: {
      id: 'paymentMethod',
      header: t('orders.column.paymentMethod'),
      hideOnMobile: true,
      render: (o) => o.paymentMethodName ?? '—',
    },
    deliveryMethod: {
      id: 'deliveryMethod',
      header: t('orders.column.deliveryMethod'),
      render: (o) => o.deliveryMethodName ?? '—',
    },
    shipTo: {
      id: 'shipTo',
      header: t('orders.column.shipTo'),
      render: (o) => o.shipToName ?? '—',
    },
    billTo: {
      id: 'billTo',
      header: t('orders.column.billTo'),
      render: (o) => o.billToName ?? '—',
    },
    total: {
      id: 'total',
      header: t('orders.column.total'),
      render: (o) => (
        <span className="tabular-nums">
          {formatMoney(o.total, o.currency)}
        </span>
      ),
    },
  };

  const visibleSet = new Set(visibleColumnIds);
  const selectColumn: ResponsiveColumn<AdminOrderRow> = {
    id: 'select',
    header: (
      <input
        type="checkbox"
        aria-label={tOrders('list.selection.selectAll')}
        checked={allSelected}
        onChange={toggleAll}
      />
    ),
    render: (o) => (
      <input
        type="checkbox"
        aria-label={tOrders('list.selection.selectRow', { number: o.businessId })}
        checked={selected.has(o.id)}
        onChange={(): void => toggleOne(o.id)}
      />
    ),
  };
  const tableColumns: ResponsiveColumn<AdminOrderRow>[] = [
    selectColumn,
    ...COLUMN_IDS.filter((id) => visibleSet.has(id)).map((id) => columnDefs[id]),
  ];

  const load: ListPageLoad = loading
    ? { kind: 'loading' }
    : loadError !== null
      ? { kind: 'error', message: loadError }
      : { kind: 'ready' };

  const create = canCreate ? (
    <Button asChild>
      <Link to="/orders/new">
        <Plus aria-hidden="true" />
        {tOrders('actions.newOrder.label')}
      </Link>
    </Button>
  ) : null;

  // The kit list page (issue #1500, SALES-24): one header with the one primary
  // action, the toolbar as a plain row, and one results card holding the bulk
  // bar, the table and the pager — the three cards this screen drew are one.
  return (
    <>
      <ListPage
        title={t('orders.page.title')}
        actions={
          <>
            <InlineStatus {...bulkStatus} className="max-w-sm" />
            {/* Not offered while a custom-field filter stands refused: the
                export would be refused for the same reason. */}
            {refusedCustomField === null ? (
              <Button asChild variant="outline">
                <a href={`${API_BASE}/api/v1/admin/orders/export?${queryString}`}>
                  <Download aria-hidden="true" />
                  {t('orders.action.exportCsv')}
                </a>
              </Button>
            ) : null}
            {create}
          </>
        }
        load={load}
        onRetry={(): void => void refresh()}
        count={tOrders('list.count', { count: total })}
        toolbar={
          // The kit's list toolbar (issue #1440, DS-06), extracted from this
          // one: search + the two most-used filters + sort always shown, the
          // list's own controls to the right, the long tail behind *More
          // filters (n)*, and every applied filter as a removable chip.
          <ListToolbar
            className="min-w-0 flex-1"
            label={t('orders.toolbar.label')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('orders.field.search')}
                placeholder={t('orders.search.placeholder')}
                value={textFilters.q}
                onValueChange={(value): void => setText('q', value)}
              />
            }
            filters={
              <>
                <MultiSelect
                  className="w-44"
                  ariaLabel={t('orders.field.status')}
                  placeholder={t('orders.field.status')}
                  options={statusOptions}
                  selected={statusCodes}
                  onChange={setStatusCodes}
                />
                <MultiSelect
                  className="w-44"
                  ariaLabel={t('orders.field.salesChannel')}
                  placeholder={t('orders.field.salesChannel')}
                  options={methodOptions(channels)}
                  selected={salesChannelIds}
                  onChange={setSalesChannelIds}
                />
                <Select
                  aria-label={t('orders.field.sort')}
                  value={sort}
                  onChange={(e): void => setSort(e.target.value)}
                  className="w-auto"
                >
                  <option value="placedAt:desc">{t('orders.sort.newest')}</option>
                  <option value="placedAt:asc">{t('orders.sort.oldest')}</option>
                  <option value="total:desc">{t('orders.sort.totalDesc')}</option>
                  <option value="businessId:asc">{t('orders.sort.idAsc')}</option>
                </Select>
              </>
            }
            actions={
              <>
                <MultiSelect
                  className="w-40"
                  ariaLabel={t('orders.columns.label')}
                  placeholder={t('orders.columns.label')}
                  icon={<Columns3 className="size-4 opacity-70" aria-hidden="true" />}
                  options={columnOptions}
                  selected={visibleColumnIds}
                  onChange={(next): void =>
                    setVisibleColumnIds(next.filter((c): c is ColumnId => COLUMN_IDS.includes(c as ColumnId)))
                  }
                />
                <SavedViewsControl
                  endpoint="/api/v1/admin/orders/list-views"
                  current={currentView}
                  onApply={applyView}
                  onError={setError}
                />
              </>
            }
            moreFiltersActiveCount={advancedActiveCount}
            moreFilters={
              <>
                <div className="space-y-1">
                  <span id={`${filterId}-paystat`} className="block text-sm font-medium">
                    {t('orders.field.paymentStatus')}
                  </span>
                  <MultiSelect
                    ariaLabelledBy={`${filterId}-paystat`}
                    placeholder={t('orders.filter.all')}
                    options={paymentStatusOptions}
                    selected={paymentStatuses}
                    onChange={setPaymentStatuses}
                  />
                </div>
                <div className="space-y-1">
                  <span id={`${filterId}-pay`} className="block text-sm font-medium">
                    {t('orders.field.paymentMethod')}
                  </span>
                  <MultiSelect
                    ariaLabelledBy={`${filterId}-pay`}
                    placeholder={t('orders.filter.all')}
                    options={methodOptions(paymentMethods)}
                    selected={paymentMethodIds}
                    onChange={setPaymentMethodIds}
                  />
                </div>
                <div className="space-y-1">
                  <span id={`${filterId}-delivery`} className="block text-sm font-medium">
                    {t('orders.field.deliveryMethod')}
                  </span>
                  <MultiSelect
                    ariaLabelledBy={`${filterId}-delivery`}
                    placeholder={t('orders.filter.all')}
                    options={methodOptions(deliveryMethods)}
                    selected={deliveryMethodIds}
                    onChange={setDeliveryMethodIds}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${filterId}-payer`}>{tOrders('list.filter.payer')}</Label>
                  <OrganizationPicker
                    id={`${filterId}-payer`}
                    ariaLabel={tOrders('list.filter.payer')}
                    value={payerOrganizationId}
                    onChange={setPayerOrganizationId}
                    clearable
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${filterId}-org`}>{t('orders.field.orgName')}</Label>
                  <Input
                    id={`${filterId}-org`}
                    value={textFilters.orgName}
                    onChange={(e): void => setText('orgName', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${filterId}-cust`}>{t('orders.field.customerName')}</Label>
                  <Input
                    id={`${filterId}-cust`}
                    value={textFilters.customerName}
                    onChange={(e): void => setText('customerName', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${filterId}-datefrom`}>{t('orders.field.dateFrom')}</Label>
                  <Input
                    id={`${filterId}-datefrom`}
                    type="date"
                    value={dateFrom}
                    onChange={(e): void => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${filterId}-dateto`}>{t('orders.field.dateTo')}</Label>
                  <Input
                    id={`${filterId}-dateto`}
                    type="date"
                    value={dateTo}
                    onChange={(e): void => setDateTo(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${filterId}-tmin`}>{t('orders.field.totalMin')}</Label>
                  <Input
                    id={`${filterId}-tmin`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={textFilters.totalMin}
                    onChange={(e): void => setText('totalMin', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${filterId}-tmax`}>{t('orders.field.totalMax')}</Label>
                  <Input
                    id={`${filterId}-tmax`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={textFilters.totalMax}
                    onChange={(e): void => setText('totalMax', e.target.value)}
                  />
                </div>
                <CustomFieldListFilters
                  idPrefix="orders"
                  fields={customFieldFields.fields}
                  value={customFieldFilters}
                  language={language}
                  status={customFieldFields.status}
                  onRetry={customFieldFields.reload}
                  onChange={(key, filter): void =>
                    changeCustomFieldFilters(withCustomFieldFilter(customFieldFilters, key, filter))
                  }
                />
              </>
            }
            appliedFilters={filterChips}
            filtersActive={filtersActive}
            onClearFilters={clearAllFilters}
          />
        }
        notice={
          error || droppedCustomFields.length > 0 || selected.size > 0 ? (
            <>
              {droppedCustomFields.length > 0 ? (
                <Alert variant="warning">
                  <AlertDescription>
                    {t('customFieldFilters.notice.dropped', {
                      fields: droppedCustomFields
                        .map((key) => customFieldDisplayName(customFieldFields.fields, key, language))
                        .join(', '),
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {/* The bulk bar is the results card's header row, not a card
                  between the toolbar and the table (issue #1500). */}
              {selected.size > 0 ? (
                <div className="flex flex-wrap items-center gap-3 border-b pb-3">
                  <span className="text-sm text-muted-foreground">
                    {t('orders.bulk.selected', { count: selected.size })}
                  </span>
                  {/* Outline, as *Print invoices*: *New order* stays the page's one
                      filled primary while rows are selected (Von Restorff). */}
                  <Button size="sm" variant="outline" onClick={(): void => openStatusDialog([...selected])}>
                    <ListChecks aria-hidden="true" />
                    {t('orders.bulk.changeStatus')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={(): void => void printInvoices([...selected])}>
                    <Printer aria-hidden="true" />
                    {t('orders.bulk.printInvoices')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null
        }
        pagination={refusedCustomField === null ? pager.footer(total) : null}
      >
        <div ref={resultsRef} tabIndex={-1} className="focus:outline-none">
          {refusedCustomField !== null ? (
            // The refusal stands in for the results: nothing listed, nothing to page.
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  {t('customFieldFilters.error.unavailable', {
                    field: customFieldDisplayName(customFieldFields.fields, refusedCustomField, language),
                  })}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11 sm:min-h-8"
                  onClick={removeRefusedCustomField}
                >
                  {t('customFieldFilters.error.remove')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <ResponsiveTable
              data={rows}
              keyExtractor={(o) => o.id}
              columns={tableColumns}
              emptyState={
                resultsFiltered ? (
                  <EmptyState
                    variant="no-results"
                    title={tOrders('list.emptyFiltered')}
                    onClearFilters={clearAllFilters}
                    focusAfterClear={searchRef}
                  />
                ) : (
                  <EmptyState
                    icon={<ShoppingBag size={20} />}
                    title={tOrders('list.emptyTitle')}
                    description={tOrders('list.empty')}
                    action={create}
                  />
                )
              }
              // The order number is the way in; the menu holds what a row can
              // do besides being opened.
              renderActions={(o) => (
                <RowActionMenu label={tOrders('list.rowMenu.label', { number: o.businessId })}>
                  <RowActionMenuItem onSelect={(): void => openStatusDialog([o.id])}>
                    <ListChecks aria-hidden="true" />
                    {tOrders('list.rowMenu.changeStatus')}
                  </RowActionMenuItem>
                  <RowActionMenuItem onSelect={(): void => void printInvoices([o.id])}>
                    <Printer aria-hidden="true" />
                    {tOrders('list.rowMenu.printInvoice')}
                  </RowActionMenuItem>
                  <RowActionMenuItem asChild>
                    <Link to={`/organizations/${o.organizationId}`}>{tOrders('list.rowMenu.organization')}</Link>
                  </RowActionMenuItem>
                </RowActionMenu>
              )}
            />
          )}
        </div>
      </ListPage>

      <OrdersBulkStatusDialog
        open={statusDialogIds !== null}
        orderIds={statusDialogIds ?? []}
        statuses={statuses}
        onClose={(): void => setStatusDialogIds(null)}
        onDone={(summary): void => {
          setStatusDialogIds(null);
          // Some orders left as they were is a partial result, not a success.
          showBulkStatus(
            t('orders.bulk.result', { changed: summary.changed, skipped: summary.skipped }),
            summary.skipped > 0 ? 'warning' : 'success',
          );
          void refresh();
        }}
      />
    </>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default OrdersList;
