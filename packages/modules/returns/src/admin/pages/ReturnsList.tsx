import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Download, ListChecks, Search, Settings, Store, UserRound, X } from 'lucide-react';
import {
  ApiError,
  apiBaseUrl,
  formatDateTime,
  formatMoney,
  statusBadgeStyle,
  usePageSizePreference,
} from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, Select, MultiSelect, type MultiSelectOption, PageHeader } from '@endora-commerce/admin-kit/ui';
import {
  ResponsiveTable,
  type ResponsiveColumn,
  PaginationFooter,
  SavedViewsControl,
  type SavedViewState,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { returnsClient } from '../api/returns-client.js';

import type { AdminReturnRow, ReturnStatusDto } from '@endora-commerce/contracts';


const VIEWS_ENDPOINT = '/api/v1/admin/returns/list-views';
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
  const { pageSize, setPageSize } = usePageSizePreference('returns');

  const [rows, setRows] = useState<AdminReturnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statuses, setStatuses] = useState<ReturnStatusDto[]>([]);
  const [page, setPage] = useState(0);

  const [loading, setLoading] = useState(true);
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
    p.set('page', String(page + 1));
    p.set('pageSize', String(Math.min(pageSize, 200)));
    p.set('sort', sort);
    if (statusCodes.length) p.set('status', statusCodes.join(','));
    if (kindFilter) p.set('kind', kindFilter);
    if (originFilter) p.set('origin', originFilter);
    if (debouncedSearch.trim()) p.set('q', debouncedSearch.trim());
    return `?${p.toString()}`;
  }, [page, pageSize, sort, statusCodes, kindFilter, originFilter, debouncedSearch]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await returnsClient.list(queryString);
      setRows(res.rows);
      setTotal(res.total);
      setCounts(res.counts);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('returns.error.load'));
    } finally {
      setLoading(false);
    }
  }, [queryString, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset to the first page whenever a filter narrows the result set.
  useEffect(() => {
    setPage(0);
  }, [statusCodes, kindFilter, originFilter, debouncedSearch, sort, pageSize]);

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

  // Removable summary chips for every applied filter (the search box is always
  // visible, so it gets a chip too — driven by the live state for instant removal).
  type FilterChip = { key: string; label: string; onRemove: () => void };
  const filterChips: FilterChip[] = [
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
    ...(search.trim()
      ? [{ key: 'search', label: tr('list.search.chip', { q: search.trim() }), onRemove: (): void => setSearch('') }]
      : []),
  ];

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
    setPage(0);
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

  return (
    <>
      <PageHeader
        title={t('returns.title')}
        description={t('returns.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/returns/statuses">
                <Settings />
                {t('returns.nav.workflow')}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/returns/reasons">{t('returns.nav.reasons')}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/returns/delivery-methods">{t('returns.nav.returnMethods')}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/returns/clauses">{tr('clauses.navLink')}</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              {/* `apiBaseUrl` and not `import.meta.env`: this file compiles
                  under the package's own `tsconfig.ui.json`, which carries no
                  `vite/client` types, and an installed module package has no
                  Vite of its own to read them from. The kit publishes the origin
                  it resolved once, which is the same value this screen read by
                  hand. */}
              <a href={`${apiBaseUrl}/api/v1/admin/returns/export${queryString}`}>
                <Download />
                {t('returns.action.exportCsv')}
              </a>
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="space-y-3">
          {/* Primary toolbar: search + status / kind filters + sort. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="rsearch"
                className="h-9 w-full rounded-md border pl-8 pr-3 text-sm"
                value={search}
                onChange={(e): void => setSearch(e.target.value)}
                placeholder={tr('list.search.placeholder')}
                aria-label={tr('list.search.label')}
              />
            </div>
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
            <div className="ml-auto">
              <SavedViewsControl
                endpoint={VIEWS_ENDPOINT}
                current={currentView}
                onApply={applyView}
                onError={setError}
              />
            </div>
          </div>

          {/* Applied-filter chips — each removable, with a one-click clear-all. */}
          {filterChips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {filterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onRemove}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted"
                >
                  <span>{chip.label}</span>
                  <X className="size-3 opacity-70" />
                </button>
              ))}
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {t('returns.filter.clearAll')}
              </button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {t('returns.bulk.selected', { count: selected.size })}
            </span>
            <Button size="sm" onClick={(): void => void bulkAuthorize()}>
              <ListChecks />
              {t('returns.bulk.authorize', { count: selected.size })}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('returns.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('returns.empty')}</p>
          ) : (
            <ResponsiveTable
              data={rows}
              keyExtractor={(r) => r.id}
              columns={columns}
              renderActions={(r) => (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link to={`/returns/${r.id}`}>
                    {t('returns.action.open')}
                    <ArrowRight />
                  </Link>
                </Button>
              )}
            />
          )}
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            onPageSizeChange={setPageSize}
            onPrev={(): void => setPage((p) => Math.max(0, p - 1))}
            onNext={(): void => setPage((p) => p + 1)}
          />
        </CardContent>
      </Card>
    </>
  );
}
export default ReturnsList;
