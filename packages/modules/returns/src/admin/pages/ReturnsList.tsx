import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Download, ListChecks, Store, Undo2, UserRound } from 'lucide-react';
import {
  ApiError,
  apiBaseUrl,
  formatDateTime,
  formatMoney,
  statusBadgeStyle,
} from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, EmptyState, Select, MultiSelect, type MultiSelectOption } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  SavedViewsControl,
  useListPagination,
  type AppliedFilter,
  type ListPageLoad,
  type ResponsiveColumn,
  type SavedViewState,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { returnsClient } from '../api/returns-client.js';

import type { AdminReturnRow, ReturnStatusDto } from '@endora-commerce/contracts';


const VIEWS_ENDPOINT = '/api/v1/admin/returns/list-views';
/** `GET /api/v1/admin/returns` serves at most 200 rows a page. */
const MAX_PAGE_SIZE = 200;
const DEFAULT_SORT = 'submittedAt:desc';
/** The sort options the toolbar offers; a saved sort outside them loads the default. */
const SORTS = ['submittedAt:desc', 'submittedAt:asc', 'rmaNumber:asc', 'rmaNumber:desc'] as const;
const KINDS = ['return', 'complaint'] as const;
/**
 * 180 FR-B35 — the origin filter; absent = every case. 181 (research R-10) splits
 * *bought elsewhere* by filer and keeps the combined value, so a saved view stored before
 * keeps its meaning. The guest origin is offered to every admin: one who may not see guest
 * cases gets an empty list, and hiding it would say their scope is narrower.
 */
const ORIGINS = ['platform', 'off_platform', 'off_platform_customer', 'guest'] as const;

/** Resolve the admin-facing label for a status: default name → English → first → code. */
function statusName(s: ReturnStatusDto): string {
  return s.defaultName || s.name['en'] || Object.values(s.name)[0] || s.code;
}

/** Returns / RMA admin list (feature 046, US8). */
export function ReturnsList(): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  // Issue #1500 — the kit pager, fitted to what the endpoint serves.
  const pager = useListPagination({ scope: 'returns', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  /** The search box, where focus goes once *Clear filters* empties the list's filters. */
  const searchRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<AdminReturnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<ReturnStatusDto[]>([]);

  const [loading, setLoading] = useState(true);
  /** Why the list could not be read — the list's own state, beside which *Retry* is offered. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** An action on the list that failed (bulk authorize, saved views) — a notice above the results. */
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Filters.
  const [statusCodes, setStatusCodes] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState('');
  // 180 FR-B35, D-6 — kept in saved views, never in the URL, as the other filters.
  const [originFilter, setOriginFilter] = useState('');
  // 181 design review A-2 — one search box over the RMA number, the case reference and the
  // whole contact e-mail (`q`), not an RMA-number field: a guest case is found by its e-mail.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<string>(DEFAULT_SORT);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Debounce the free-text search.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  // Load the configured status graph once for labels + badge colours.
  useEffect(() => {
    void returnsClient
      .statuses()
      .then((graph) => setStatuses(graph.statuses))
      .catch(() => setStatuses([]));
  }, []);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(pager.query.page));
    p.set('pageSize', String(pager.query.pageSize));
    p.set('sort', sort);
    if (statusCodes.length) p.set('status', statusCodes.join(','));
    if (kindFilter) p.set('kind', kindFilter);
    if (originFilter) p.set('origin', originFilter);
    if (debouncedSearch.trim()) p.set('q', debouncedSearch.trim());
    return `?${p.toString()}`;
  }, [pager.query.page, pager.query.pageSize, sort, statusCodes, kindFilter, originFilter, debouncedSearch]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await returnsClient.list(queryString);
      setRows(res.rows);
      setTotal(res.total);
      syncTotal(res.total);
      setCounts(res.counts);
      setSelected(new Set());
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.envelope.error.message : t('returns.error.load'));
    } finally {
      setLoading(false);
    }
  }, [queryString, syncTotal, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset to the first page whenever a filter narrows the result set (the kit
  // pager goes back to the first page on a page-size change itself).
  useEffect(() => {
    resetPage();
  }, [resetPage, statusCodes, kindFilter, originFilter, debouncedSearch, sort]);

  const statusLabel = useCallback(
    (code: string): string => {
      const s = statuses.find((x) => x.code === code);
      return s ? statusName(s) : code;
    },
    [statuses],
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

  const bulkAuthorize = useCallback(async (): Promise<void> => {
    setError(null);
    setInfo(null);
    try {
      const res = await returnsClient.bulkTransition([...selected], 'authorized');
      setInfo(t('returns.bulk.result', { authorized: res.moved.length, skipped: res.skipped.length }));
      setSelected(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('returns.error.bulk'));
    }
  }, [selected, refresh, t]);

  // Status filter options carry the live per-status counts from the list payload.
  const statusOptions: MultiSelectOption[] = statuses.map((s) => ({
    value: s.code,
    label: `${statusName(s)}${counts[s.code] !== undefined ? ` (${counts[s.code]})` : ''}`,
  }));

  // Removable summary chips for every applied filter. The search box is not
  // one: it is always visible, and *Clear all filters* empties it too.
  const filterChips: AppliedFilter[] = [
    ...statusCodes.map((code) => ({
      key: `status:${code}`,
      label: `${t('returns.filter.status')}: ${statusLabel(code)}`,
      onRemove: (): void => setStatusCodes((prev) => prev.filter((c) => c !== code)),
    })),
    ...(kindFilter
      ? [
          {
            key: 'kind',
            label: `${t('returns.filter.kind')}: ${t(`returns.kind.${kindFilter}`)}`,
            onRemove: (): void => setKindFilter(''),
          },
        ]
      : []),
    ...(originFilter
      ? [
          {
            key: 'origin',
            label: `${tr('list.filter.origin')}: ${tr(`list.origin.${originFilter}`)}`,
            onRemove: (): void => setOriginFilter(''),
          },
        ]
      : []),
  ];
  const filtersActive = filterChips.length > 0 || search.trim() !== '';
  /** Whether the rows on screen were read through a filter — what the empty state tells apart. */
  const resultsFiltered = filterChips.length > 0 || debouncedSearch.trim() !== '';

  // Saved views (#312): what the list really has — the status, kind and origin
  // filters, the search and the sort. It has no column picker, so a view stores no
  // columns. The search is stored as the list applies it, debounced and trimmed,
  // under `q` (181 A-2).
  const trimmedSearch = debouncedSearch.trim();
  const [sortField = 'submittedAt', sortDir] = sort.split(':');
  const currentView: SavedViewState = {
    filters: {
      ...(statusCodes.length ? { status: statusCodes } : {}),
      ...(kindFilter ? { kind: kindFilter } : {}),
      ...(originFilter ? { origin: originFilter } : {}),
      ...(trimmedSearch ? { q: trimmedSearch } : {}),
    },
    sort: { field: sortField, dir: sortDir === 'asc' ? 'asc' : 'desc' },
  };

  // Loading a view replaces every filter and the sort; a value the page does
  // not offer is dropped. The page and the debounced search are set in the same
  // batch, so no list request goes out with the old page or the old search. A view
  // saved under 180 holds `rmaNumber`; `q` matches the RMA number by the same
  // substring rule, so it keeps finding what it found.
  const applyView = (view: SavedViewState): void => {
    const f = view.filters;
    resetPage();
    setSelected(new Set());
    setStatusCodes(Array.isArray(f['status']) ? f['status'].filter((c): c is string => typeof c === 'string') : []);
    const kind = f['kind'];
    setKindFilter(typeof kind === 'string' && (KINDS as readonly string[]).includes(kind) ? kind : '');
    const origin = f['origin'];
    setOriginFilter(typeof origin === 'string' && (ORIGINS as readonly string[]).includes(origin) ? origin : '');
    const saved = typeof f['q'] === 'string' ? f['q'] : typeof f['rmaNumber'] === 'string' ? f['rmaNumber'] : '';
    setSearch(saved);
    setDebouncedSearch(saved);
    const savedSort = view.sort ? `${view.sort.field}:${view.sort.dir}` : DEFAULT_SORT;
    setSort((SORTS as readonly string[]).includes(savedSort) ? savedSort : DEFAULT_SORT);
  };

  const clearAllFilters = (): void => {
    setStatusCodes([]);
    setKindFilter('');
    setOriginFilter('');
    setSearch('');
  };

  const selectColumn: ResponsiveColumn<AdminReturnRow> = {
    id: 'select',
    header: (
      <input
        type="checkbox"
        aria-label={tr('list.selection.selectAll')}
        checked={allSelected}
        onChange={toggleAll}
      />
    ),
    render: (r) => (
      <input
        type="checkbox"
        aria-label={tr('list.selection.selectRow', { number: r.reference })}
        checked={selected.has(r.id)}
        onChange={(): void => toggleOne(r.id)}
      />
    ),
  };

  const columns: ResponsiveColumn<AdminReturnRow>[] = [
    selectColumn,
    {
      id: 'rma',
      header: t('returns.col.rma'),
      primary: true,
      render: (r) => (
        // 180 FR-A44, D-4 — the RMA number, else the derived reference: a link
        // whose text is a dash names nothing (WCAG 2.4.4).
        <Link to={`/returns/${r.id}`} className="font-mono text-xs underline underline-offset-2">
          {r.reference}
        </Link>
      ),
      meta: (r) => formatDateTime(r.submittedAt),
    },
    {
      id: 'kind',
      header: t('returns.col.kind'),
      render: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {t(`returns.kind.${r.kind}`)}
          {r.offPlatform && (
            // 180 FR-B35 — text and an icon, never colour alone (design review R-4.2).
            <Badge variant="outline" className="gap-1">
              <Store className="size-3" aria-hidden="true" />
              {tr('list.offPlatform')}
            </Badge>
          )}
          {r.guest && (
            // 181 FR-061 — filed by a guest without an account; text and an icon.
            <Badge variant="outline" className="gap-1">
              <UserRound className="size-3" aria-hidden="true" />
              {tr('list.guest')}
            </Badge>
          )}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('returns.col.status'),
      render: (r) => (
        <Badge style={statusBadgeStyle(statusColor(r.statusCode))}>
          {r.statusLabel || statusLabel(r.statusCode)}
        </Badge>
      ),
    },
    {
      // 180 FR-A41 — who authorized the case. Not sortable: the name is
      // `admin_users`' and the list cannot be ordered on it (spec Clarifications).
      id: 'authorizedBy',
      header: tr('list.col.authorizedBy'),
      hideOnMobile: true,
      render: (r) => {
        if (!r.authorizedBy) return '—';
        if (!r.authorizedBy.adminUserId) {
          return (
            <span className="text-muted-foreground" title={tr('list.authorizedBy.unknownHint')}>
              {tr('list.authorizedBy.unknown')}
              <span className="sr-only"> ({tr('list.authorizedBy.unknownHint')})</span>
            </span>
          );
        }
        if (r.authorizedBy.name === null) {
          return <span className="italic text-muted-foreground">{tr('list.authorizedBy.former')}</span>;
        }
        return r.authorizedBy.name;
      },
    },
    {
      id: 'refund',
      header: t('returns.col.refund'),
      render: (r) =>
        r.offPlatform ? (
          <span>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{tr('list.notApplicable')}</span>
          </span>
        ) : (
          <span className="tabular-nums">{formatMoney(r.totalRefundAmount, r.currency)}</span>
        ),
    },
    {
      id: 'customer',
      header: t('returns.col.customer'),
      // 181 (admin-api.md A1) — a guest is named by the contact as given, until erased.
      render: (r) =>
        r.guest
          ? r.customerName
            ? tr('list.customer.guest', { name: r.customerName })
            : tr('list.customer.guestErased')
          : (r.customerName ?? '—'),
    },
    {
      id: 'org',
      header: t('returns.col.org'),
      hideOnMobile: true,
      render: (r) => r.organizationName ?? '—',
    },
    {
      id: 'submitted',
      header: t('returns.col.submitted'),
      hideOnMobile: true,
      render: (r) => formatDateTime(r.submittedAt),
    },
  ];

  const load: ListPageLoad = loading
    ? { kind: 'loading' }
    : loadError !== null
      ? { kind: 'error', message: loadError }
      : { kind: 'ready' };

  // The kit list page (issue #1500, SALES-24): one header, the toolbar as a
  // plain row, and one results card holding the bulk bar, the table and the pager.
  return (
    <ListPage
      title={t('returns.title')}
      actions={
        <>
          <Button asChild variant="outline">
            {/* `apiBaseUrl` and not `import.meta.env`: this file compiles
                under the package's own `tsconfig.ui.json`, which carries no
                `vite/client` types, and an installed module package has no
                Vite of its own to read them from. The kit publishes the origin
                it resolved once, which is the same value this screen read by
                hand. */}
            <a href={`${apiBaseUrl}/api/v1/admin/returns/export${queryString}`}>
              <Download aria-hidden="true" />
              {t('returns.action.exportCsv')}
            </a>
          </Button>
          {/* The four configuration screens behind one labelled menu, not four
              buttons competing with the list (Hick). */}
          <RowActionMenu label={tr('list.settingsMenu.label')} showLabel>
            <RowActionMenuItem asChild>
              <Link to="/returns/statuses">{t('returns.nav.workflow')}</Link>
            </RowActionMenuItem>
            <RowActionMenuItem asChild>
              <Link to="/returns/reasons">{t('returns.nav.reasons')}</Link>
            </RowActionMenuItem>
            <RowActionMenuItem asChild>
              <Link to="/returns/delivery-methods">{t('returns.nav.returnMethods')}</Link>
            </RowActionMenuItem>
            <RowActionMenuItem asChild>
              <Link to="/returns/clauses">{tr('clauses.navLink')}</Link>
            </RowActionMenuItem>
          </RowActionMenu>
        </>
      }
      load={load}
      onRetry={(): void => void refresh()}
      count={tr('list.count', { count: total })}
      toolbar={
        <ListToolbar
          className="min-w-0 flex-1"
          label={tr('list.toolbar.label')}
          search={
            <ListToolbarSearch
              ref={searchRef}
              label={tr('list.search.label')}
              placeholder={tr('list.search.placeholder')}
              value={search}
              onValueChange={setSearch}
            />
          }
          filters={
            <>
              <MultiSelect
                className="w-44"
                ariaLabel={t('returns.filter.status')}
                placeholder={t('returns.filter.status')}
                options={statusOptions}
                selected={statusCodes}
                onChange={setStatusCodes}
              />
              <Select
                id="kind"
                aria-label={t('returns.filter.kind')}
                value={kindFilter}
                onChange={(e): void => setKindFilter(e.target.value)}
                className="w-auto"
              >
                <option value="">{t('returns.filter.kind')}</option>
                <option value="return">{t('returns.kind.return')}</option>
                <option value="complaint">{t('returns.kind.complaint')}</option>
              </Select>
              <Select
                id="origin"
                aria-label={tr('list.filter.origin')}
                value={originFilter}
                onChange={(e): void => setOriginFilter(e.target.value)}
                className="w-auto"
              >
                <option value="">{tr('list.filter.origin')}</option>
                {ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {tr(`list.origin.${o}`)}
                  </option>
                ))}
              </Select>
              <Select
                id="rsort"
                aria-label={t('returns.field.sort')}
                value={sort}
                onChange={(e): void => setSort(e.target.value)}
                className="w-auto"
              >
                <option value="submittedAt:desc">{t('returns.sort.newest')}</option>
                <option value="submittedAt:asc">{t('returns.sort.oldest')}</option>
                <option value="rmaNumber:asc">{t('returns.sort.rmaAsc')}</option>
                <option value="rmaNumber:desc">{t('returns.sort.rmaDesc')}</option>
              </Select>
            </>
          }
          actions={
            <SavedViewsControl endpoint={VIEWS_ENDPOINT} current={currentView} onApply={applyView} onError={setError} />
          }
          appliedFilters={filterChips}
          filtersActive={filtersActive}
          onClearFilters={clearAllFilters}
        />
      }
      notice={
        error || info || selected.size > 0 ? (
          <>
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
            {/* The bulk bar is the results card's header row (issue #1500). */}
            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-3 border-b pb-3">
                <span className="text-sm text-muted-foreground">
                  {t('returns.bulk.selected', { count: selected.size })}
                </span>
                <Button size="sm" onClick={(): void => void bulkAuthorize()}>
                  <ListChecks aria-hidden="true" />
                  {t('returns.bulk.authorize', { count: selected.size })}
                </Button>
              </div>
            ) : null}
          </>
        ) : null
      }
      pagination={pager.footer(total)}
    >
      <ResponsiveTable
        data={rows}
        keyExtractor={(r) => r.id}
        columns={columns}
        emptyState={
          resultsFiltered ? (
            <EmptyState
              variant="no-results"
              title={tr('list.emptyFiltered')}
              onClearFilters={clearAllFilters}
              focusAfterClear={searchRef}
            />
          ) : (
            <EmptyState icon={<Undo2 size={20} />} title={tr('list.emptyTitle')} description={tr('list.empty')} />
          )
        }
        // The case number is the way in; the menu holds where else a row
        // leads — and a case filed for a purchase made elsewhere has no order.
        renderActions={(r) =>
          r.orderId ? (
            <RowActionMenu label={tr('list.rowMenu.label', { number: r.reference })}>
              <RowActionMenuItem asChild>
                <Link to={`/orders/${r.orderId}`}>{tr('list.rowMenu.order')}</Link>
              </RowActionMenuItem>
            </RowActionMenu>
          ) : null
        }
      />
    </ListPage>
  );
}

export default ReturnsList;
