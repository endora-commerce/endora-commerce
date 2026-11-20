import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleDollarSign, Plus } from 'lucide-react';
import {
  opportunityBoardCustomFieldRef,
  type CustomFieldFilters,
  type OpportunityFieldFilters,
  type OpportunityStatusKind,
  type OpportunitySummary,
  type OpportunityWorkflowStatus,
} from '@endora-commerce/contracts';
import {
  formatDateTime,
  statusBadgeStyle,
  useAuth,
  usePageSizePreference,
} from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import {
  CursorPagination,
  CustomFieldListFilters,
  ListToolbar,
  ListToolbarSearch,
  ResponsiveTable,
  customFieldDisplayName,
  customFieldFilterRefusal,
  emptyCustomFieldFilters,
  pruneRemovedOptions,
  readCustomFieldFilterParams,
  toCustomFieldFiltersParam,
  useCustomFieldListFilterFields,
  withCustomFieldFilter,
  writeCustomFieldFilterParams,
  TagChips,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi, MAX_PAGE_LIMIT, type OpportunityListParams, type OpportunitySort } from '../api.js';
import { AssigneeName } from '../components/AssigneeName.js';
import {
  LIST_MORE_FILTERS,
  LIST_PRIMARY_FILTERS,
  NO_SHARED_FILTERS,
  OpportunityFilterFields,
  hasSharedFilters,
  hiddenSharedFilterCount,
  sharedFilterParams,
  type SharedOpportunityFilters,
} from '../components/OpportunityFilterFields.js';
import {
  calendarDateLabel,
  errorMessage,
  moneyLabel,
  workflowStatusLabel,
} from '../lib/labels.js';

const STATES: readonly OpportunityStatusKind[] = ['open', 'won', 'lost'];

/** `<field>:<direction>` — one control for the two query parameters. */
const SORTS = [
  'createdAt:desc',
  'createdAt:asc',
  'updatedAt:desc',
  'value:desc',
  'expectedCloseDate:asc',
] as const;
type SortOption = (typeof SORTS)[number];

const SEARCH_DEBOUNCE_MS = 300;

/** The custom fields this list offers as filters (feature 157). */
const CUSTOM_FIELD_FILTERS_ENDPOINT = '/api/v1/admin/crm/opportunities/custom-field-filters';

/**
 * The custom-field filters as the list's `fieldFilters`: one `custom:<key>`
 * reference each. Sent without `cardValues`, so the server applies the
 * list-filter option, not the board card's rule (FR-011a).
 */
function customFieldReferences(filters: CustomFieldFilters): OpportunityFieldFilters | undefined {
  const keys = Object.keys(filters);
  if (keys.length === 0) return undefined;
  const references: OpportunityFieldFilters = {};
  for (const key of keys) {
    const filter = filters[key];
    if (filter !== undefined) references[opportunityBoardCustomFieldRef(key)] = filter;
  }
  return references;
}

/** The filters shared with the board, plus the two only a list has. */
interface Filters extends SharedOpportunityFilters {
  state: OpportunityStatusKind | '';
  statusCode: string;
}

const NO_FILTERS: Filters = { ...NO_SHARED_FILTERS, state: '', statusCode: '' };

function hasFilters(filters: Filters): boolean {
  return hasSharedFilters(filters) || filters.state !== '' || filters.statusCode !== '';
}

/**
 * The Opportunities list (`specs/143-crm-sales-opportunities/`, User Story 1 —
 * FR-003 – FR-005): every Opportunity the operator may see, filtered by text,
 * state, status, Organization, Sales Channel and creation date.
 *
 * The fields the board has too are one component, `OpportunityFilterFields`;
 * the state and the status are the list's alone, because the board's columns
 * *are* the statuses. They sit on the kit `ListToolbar`: the search, the
 * state, the status and the assignee always shown, the rest — custom-field
 * filters included — behind *More filters (n)* (issue #1505, WORK-05).
 *
 * Custom-field filters (feature 157) are the definitions whose list-filter
 * option is on, whatever the board card shows. They live in the address as
 * `cf.<key>.<op>` and reach the server as `custom:<key>` references in
 * `fieldFilters`; a filter the server refuses is reported by name with a way
 * to remove it. The board and its card-field filters are untouched.
 */
export function OpportunitiesList(): ReactNode {
  const t = useTranslation('crm');
  /** Where focus returns after *Clear filters* in the empty state (WCAG 2.4.3). */
  const searchRef = useRef<HTMLInputElement>(null);
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const { pageSize, setPageSize } = usePageSizePreference('crm-opportunities');

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('createdAt:desc');
  /** The cursors that led to the page on screen; empty on the first page. */
  const [trail, setTrail] = useState<string[]>([]);
  const [rows, setRows] = useState<OpportunitySummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<OpportunityWorkflowStatus[]>([]);
  const sequence = useRef(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [customFilters, setCustomFilters] = useState<CustomFieldFilters>(() =>
    readCustomFieldFilterParams(searchParams),
  );
  /** The key of a custom-field filter the server refused, until it is removed. */
  const [refusedKey, setRefusedKey] = useState<string | null>(null);
  const {
    fields: customFields,
    status: customFieldsStatus,
    reload: reloadCustomFields,
  } = useCustomFieldListFilterFields(CUSTOM_FIELD_FILTERS_ENDPOINT);
  /** The results region, focused once a refused filter is removed. */
  const resultsRef = useRef<HTMLDivElement | null>(null);
  /**
   * The request last sent. StrictMode mounts effects twice in development, and
   * an unchanged request is not sent again unless the operator retries.
   */
  const lastRequest = useRef<string | null>(null);

  /** The custom-field filters changed: into the address, and back to the first page. */
  const changeCustom = useCallback(
    (next: CustomFieldFilters): void => {
      setCustomFilters(next);
      setRefusedKey(null);
      setTrail([]);
      setSearchParams((previous) => writeCustomFieldFilterParams(previous, next), { replace: true });
    },
    [setSearchParams],
  );

  // Options removed since the address was written are dropped once the fields
  // are known; an unknown key stays for the server to refuse.
  // Through `changeCustom`, so the address loses the removed options too.
  useEffect(() => {
    if (customFieldsStatus !== 'ready') return;
    const pruned = pruneRemovedOptions(customFilters, customFields);
    if (toCustomFieldFiltersParam(pruned) !== toCustomFieldFiltersParam(customFilters)) changeCustom(pruned);
  }, [customFields, customFieldsStatus, customFilters, changeCustom]);

  // The status filter offers the configured workflow. Without it the list is
  // still usable — the filter simply has nothing to offer.
  useEffect(() => {
    let alive = true;
    crmApi
      .getWorkflow()
      .then((workflow) => {
        if (alive) setStatuses([...workflow.statuses].sort((a, b) => a.weight - b.weight));
      })
      .catch(() => {
        if (alive) setStatuses([]);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  // The search box is typed into; the request follows once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((previous) => (previous.q === search ? previous : { ...previous, q: search }));
      setTrail((previous) => (previous.length === 0 ? previous : []));
    }, SEARCH_DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [search]);

  const params = useMemo<OpportunityListParams>(() => {
    const [field, order] = sort.split(':') as [OpportunitySort, 'asc' | 'desc'];
    const cursor = trail[trail.length - 1];
    const fieldFilters = customFieldReferences(customFilters);
    return {
      ...sharedFilterParams(filters),
      ...(fieldFilters ? { fieldFilters } : {}),
      ...(filters.state ? { state: filters.state } : {}),
      ...(filters.statusCode ? { statusCode: [filters.statusCode] } : {}),
      sort: field,
      order,
      ...(cursor ? { cursor } : {}),
      limit: Math.min(pageSize, MAX_PAGE_LIMIT),
    };
  }, [filters, customFilters, sort, trail, pageSize]);

  const load = useCallback(async (force = false): Promise<void> => {
    const request = JSON.stringify(params);
    if (!force && request === lastRequest.current) return;
    lastRequest.current = request;
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    // A refusal belongs to the request that earned it; a new one starts clear.
    setRefusedKey(null);
    try {
      const page = await crmApi.listOpportunities(params);
      // A slower, older answer must not overwrite a newer one.
      if (current !== sequence.current) return;
      setRows(page.data);
      setNextCursor(page.pagination.hasMore ? page.pagination.cursor : null);
      setLoaded(true);
    } catch (failure) {
      if (current !== sequence.current) return;
      const refused = customFieldFilterRefusal(failure);
      setRefusedKey(refused);
      setError(refused === null ? errorMessage(failure, t('opportunity.list.error')) : null);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [params, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Any change of what is asked for starts again from the first page. */
  const change = (patch: Partial<Filters>): void => {
    setFilters((previous) => ({ ...previous, ...patch }));
    setTrail([]);
  };

  const clear = (): void => {
    setSearch('');
    setFilters(NO_FILTERS);
    setTrail([]);
    if (Object.keys(customFilters).length > 0) changeCustom(emptyCustomFieldFilters());
  };

  const removeRefused = (): void => {
    if (refusedKey === null) return;
    changeCustom(withCustomFieldFilter(customFilters, refusedKey, null));
    // Focus follows the operator to what they are waiting for: the results.
    resultsRef.current?.focus();
  };

  const refusedName = refusedKey === null ? '' : customFieldDisplayName(customFields, refusedKey, language);

  const filtered =
    hasFilters(filters) || search.trim() !== '' || Object.keys(customFilters).length > 0;

  const columns: ResponsiveColumn<OpportunitySummary>[] = [
    {
      id: 'number',
      header: t('opportunity.list.col.number'),
      primary: true,
      render: (row) => (
        <Link
          to={`/crm/opportunities/${row.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.number}
        </Link>
      ),
      meta: (row) => row.organization.name,
    },
    {
      id: 'title',
      header: t('opportunity.list.col.title'),
      primary: true,
      render: (row) => (
        <div className="space-y-1">
          <span>{row.title}</span>
          <TagChips tags={row.tags} />
        </div>
      ),
    },
    {
      id: 'organization',
      header: t('opportunity.list.col.organization'),
      hideOnMobile: true,
      render: (row) => row.organization.name,
    },
    {
      id: 'status',
      header: t('opportunity.list.col.status'),
      render: (row) => (
        <Badge className="font-medium" style={statusBadgeStyle(row.status.color)}>
          {row.status.name}
        </Badge>
      ),
    },
    {
      id: 'assignee',
      header: t('assignment.label'),
      hideOnMobile: true,
      render: (row) => <AssigneeName assignee={row.assignee} />,
    },
    {
      id: 'value',
      header: t('opportunity.list.col.value'),
      className: 'text-right tabular-nums',
      render: (row) => moneyLabel(row.value, row.currency),
    },
    {
      id: 'expectedClose',
      header: t('opportunity.list.col.expectedClose'),
      render: (row) => calendarDateLabel(row.expectedCloseDate),
    },
    {
      id: 'created',
      header: t('opportunity.list.col.created'),
      hideOnMobile: true,
      render: (row) => formatDateTime(row.createdAt),
    },
  ];

  const newOpportunity = (
    <Button className="min-h-11 sm:min-h-9" asChild>
      <Link to="/crm/opportunities/new">
        <Plus aria-hidden="true" />
        {t('opportunity.list.new')}
      </Link>
    </Button>
  );

  const emptyState = filtered ? (
    <EmptyState
      variant="no-results"
      title={t('opportunity.list.noResults.title')}
      description={t('opportunity.list.noResults.body')}
      onClearFilters={clear}
      focusAfterClear={searchRef}
    />
  ) : (
    <EmptyState
      icon={<CircleDollarSign size={20} />}
      title={t('opportunity.list.empty.title')}
      description={canWrite ? t('opportunity.list.empty.body') : t('opportunity.list.empty.bodyReadOnly')}
      action={canWrite ? newOpportunity : null}
    />
  );

  return (
    <>
      <PageHeader
        title={t('opportunity.list.title')}
        // With nothing listed the empty state carries the one action; two
        // filled buttons for the same thing would compete.
        actions={canWrite && (rows.length > 0 || filtered || !loaded) ? newOpportunity : undefined}
      />

      <Card className="mb-4">
        <CardContent>
          <ListToolbar
            label={t('opportunity.filter.toolbar')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                id="crm-opportunity-search"
                label={t('opportunity.list.filter.search')}
                placeholder={t('opportunity.list.filter.searchPlaceholder')}
                value={search}
                onValueChange={setSearch}
              />
            }
            filters={
              <>
                <Select
                  id="crm-opportunity-state"
                  aria-label={t('opportunity.list.filter.state')}
                  className="w-auto"
                  value={filters.state}
                  onChange={(event): void =>
                    change({ state: event.target.value as OpportunityStatusKind | '' })
                  }
                >
                  <option value="">{t('opportunity.list.filter.stateAll')}</option>
                  {STATES.map((state) => (
                    <option key={state} value={state}>
                      {t(`opportunity.state.${state}`)}
                    </option>
                  ))}
                </Select>
                <Select
                  id="crm-opportunity-status"
                  aria-label={t('opportunity.list.filter.status')}
                  className="w-auto"
                  value={filters.statusCode}
                  onChange={(event): void => change({ statusCode: event.target.value })}
                >
                  <option value="">{t('opportunity.list.filter.statusAll')}</option>
                  {statuses.map((status) => (
                    <option key={status.code} value={status.code}>
                      {workflowStatusLabel(status, language)}
                    </option>
                  ))}
                </Select>
                <OpportunityFilterFields
                  idPrefix="crm-opportunity"
                  filters={filters}
                  onChange={change}
                  only={LIST_PRIMARY_FILTERS}
                  placement="toolbar"
                />
              </>
            }
            actions={
              <Select
                id="crm-opportunity-sort"
                aria-label={t('opportunity.list.sort')}
                className="w-auto"
                value={sort}
                onChange={(event): void => {
                  setSort(event.target.value as SortOption);
                  setTrail([]);
                }}
              >
                {SORTS.map((option) => (
                  <option key={option} value={option}>
                    {t(`opportunity.list.sortOption.${option.replace(':', '.')}`)}
                  </option>
                ))}
              </Select>
            }
            moreFilters={
              <>
                <OpportunityFilterFields
                  idPrefix="crm-opportunity"
                  filters={filters}
                  onChange={change}
                  only={LIST_MORE_FILTERS}
                  placement="panel"
                />
                <CustomFieldListFilters
                  idPrefix="crm-opportunity"
                  fields={customFields}
                  value={customFilters}
                  onChange={(key, filter): void => changeCustom(withCustomFieldFilter(customFilters, key, filter))}
                  language={language}
                  status={customFieldsStatus}
                  onRetry={reloadCustomFields}
                />
              </>
            }
            moreFiltersActiveCount={
              hiddenSharedFilterCount(filters, LIST_PRIMARY_FILTERS) + Object.keys(customFilters).length
            }
            filtersActive={filtered}
            onClearFilters={clear}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent ref={resultsRef} tabIndex={-1} className="focus:outline-none" aria-busy={loading}>
          {/* Mounted before it has text, so a reload is announced (WCAG 4.1.3). */}
          <p role="status" className="sr-only">
            {loading && loaded ? t('opportunity.list.loading') : ''}
          </p>
          {refusedKey !== null ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{tCore('customFieldFilters.error.unavailable', { field: refusedName })}</span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={removeRefused}>
                  {tCore('customFieldFilters.error.remove')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load(true)}>
                  {tCore('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : !loaded ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('opportunity.list.loading')}
            </p>
          ) : (
            <>
              <ResponsiveTable
                data={rows}
                columns={columns}
                keyExtractor={(row): string => row.id}
                emptyState={emptyState}
              />
              {rows.length > 0 || trail.length > 0 ? (
                <CursorPagination
                  page={trail.length + 1}
                  pageSize={pageSize}
                  maxPageSize={MAX_PAGE_LIMIT}
                  hasPrevious={trail.length > 0}
                  hasNext={nextCursor !== null}
                  busy={loading}
                  onPageSizeChange={(next): void => {
                    setPageSize(next);
                    setTrail([]);
                  }}
                  onPrevious={(): void => setTrail((previous) => previous.slice(0, -1))}
                  onNext={(): void => {
                    if (nextCursor) setTrail((previous) => [...previous, nextCursor]);
                  }}
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default OpportunitiesList;
