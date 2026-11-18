import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, CircleDollarSign, Plus, SearchX, X } from 'lucide-react';
import {
  opportunityBoardCustomFieldRef,
  type CustomFieldFilters,
  type CustomFieldListFilterField,
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
  Label,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import {
  CursorPagination,
  CustomFieldListFilters,
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
  NO_SHARED_FILTERS,
  OpportunityFilterFields,
  hasSharedFilters,
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
 * How many custom-field filters the always-open panel shows before the rest
 * go behind *More filters (n)* (feature 157, owner ruling U1 A). Three, because
 * the built-in filters fill two and a half rows of the four-column grid: three
 * custom cells and the disclosure complete the row after them.
 */
const VISIBLE_CUSTOM_FILTERS = 3;

/** The filter grid; the *More filters* disclosure controls it. */
const FILTER_GRID_ID = 'crm-opportunity-filters';

interface CustomFieldDisclosure {
  /** The fields on screen, in the order they are rendered. */
  shown: readonly CustomFieldListFilterField[];
  /** How many fields collapsing hides (collapsed: how many it hides now). */
  hidden: number;
  /** The fields beyond the first ones that stay on screen while collapsed. */
  promoted: readonly string[];
}

/**
 * Which custom-field filters are on screen. Collapsed: the first
 * {@link VISIBLE_CUSTOM_FILTERS}, plus every later field that is active or
 * pinned — an active filter is never hidden, and a field the operator is
 * clearing does not vanish under them. Expanded: the same fields in the same
 * places, then the rest, so expanding moves nothing already visible; `pinned`
 * is the set taken when the disclosure last opened, so a filter turning active
 * while expanded does not reorder the grid either.
 */
function customFieldDisclosure(
  fields: readonly CustomFieldListFilterField[],
  filters: CustomFieldFilters,
  pinned: readonly string[],
  expanded: boolean,
): CustomFieldDisclosure {
  const head = fields.slice(0, VISIBLE_CUSTOM_FILTERS);
  const tail = fields.slice(VISIBLE_CUSTOM_FILTERS);
  const promoted = tail.filter(
    (field) => pinned.includes(field.key) || (!expanded && Object.hasOwn(filters, field.key)),
  );
  const rest = tail.filter((field) => !promoted.includes(field));
  return {
    shown: expanded ? [...head, ...promoted, ...rest] : [...head, ...promoted],
    hidden: rest.length,
    promoted: promoted.map((field) => field.key),
  };
}

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
 * *are* the statuses.
 *
 * Custom-field filters (feature 157) are the definitions whose list-filter
 * option is on, whatever the board card shows. They live in the address as
 * `cf.<key>.<op>` and reach the server as `custom:<key>` references in
 * `fieldFilters`; a filter the server refuses is reported by name with a way
 * to remove it. The board and its card-field filters are untouched.
 */
export function OpportunitiesList(): ReactNode {
  const t = useTranslation('crm');
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
  /** Whether *More filters* is open. Not remembered: every visit starts collapsed. */
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  /**
   * The later fields kept on screen beside the first ones — those active when
   * the page opened or when the disclosure was last toggled.
   */
  const [pinnedKeys, setPinnedKeys] = useState<readonly string[]>(() => Object.keys(customFilters));
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
    setPinnedKeys([]);
  };

  const disclosure = customFieldDisclosure(customFields, customFilters, pinnedKeys, moreFiltersOpen);

  const toggleMoreFilters = (): void => {
    if (moreFiltersOpen) {
      // What stays on screen once collapsed: the later fields still active.
      setPinnedKeys(
        customFields
          .slice(VISIBLE_CUSTOM_FILTERS)
          .filter((field) => Object.hasOwn(customFilters, field.key))
          .map((field) => field.key),
      );
    } else {
      // The fields already on screen keep their places while expanded.
      setPinnedKeys(disclosure.promoted);
    }
    setMoreFiltersOpen(!moreFiltersOpen);
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
    <div className="b2b-empty">
      <div className="b2b-empty__icon">
        <SearchX aria-hidden="true" />
      </div>
      <div className="b2b-empty__title">{t('opportunity.list.noResults.title')}</div>
      <div className="b2b-empty__sub">{t('opportunity.list.noResults.body')}</div>
      <Button className="min-h-11 sm:min-h-9" variant="outline" onClick={clear}>
        <X aria-hidden="true" />
        {t('opportunity.list.filter.clear')}
      </Button>
    </div>
  ) : (
    <div className="b2b-empty">
      <div className="b2b-empty__icon">
        <CircleDollarSign aria-hidden="true" />
      </div>
      <div className="b2b-empty__title">{t('opportunity.list.empty.title')}</div>
      <div className="b2b-empty__sub">
        {canWrite ? t('opportunity.list.empty.body') : t('opportunity.list.empty.bodyReadOnly')}
      </div>
      {canWrite ? newOpportunity : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('opportunity.list.title')}
        description={t('opportunity.list.description')}
        // With nothing listed the empty state carries the one action; two
        // filled buttons for the same thing would compete.
        actions={canWrite && (rows.length > 0 || filtered || !loaded) ? newOpportunity : undefined}
      />

      <Card className="mb-4">
        <CardContent>
          <div id={FILTER_GRID_ID} className="grid gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <OpportunityFilterFields
              idPrefix="crm-opportunity"
              search={search}
              onSearchChange={setSearch}
              filters={filters}
              onChange={change}
            >
              <div className="space-y-1">
                <Label htmlFor="crm-opportunity-state">{t('opportunity.list.filter.state')}</Label>
                <Select
                  id="crm-opportunity-state"
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
              </div>
              <div className="space-y-1">
                <Label htmlFor="crm-opportunity-status">{t('opportunity.list.filter.status')}</Label>
                <Select
                  id="crm-opportunity-status"
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
              </div>
            </OpportunityFilterFields>
            <CustomFieldListFilters
              idPrefix="crm-opportunity"
              fields={disclosure.shown}
              value={customFilters}
              onChange={(key, filter): void => changeCustom(withCustomFieldFilter(customFilters, key, filter))}
              language={language}
              status={customFieldsStatus}
              onRetry={reloadCustomFields}
            />
            {customFieldsStatus === 'ready' && disclosure.hidden > 0 ? (
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 min-w-11"
                  aria-expanded={moreFiltersOpen}
                  aria-controls={FILTER_GRID_ID}
                  onClick={toggleMoreFilters}
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={`transition-transform motion-reduce:transition-none${moreFiltersOpen ? ' rotate-180' : ''}`}
                  />
                  {moreFiltersOpen
                    ? t('opportunity.list.filter.fewerCustom')
                    : t('opportunity.list.filter.moreCustom', { count: disclosure.hidden })}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <Label htmlFor="crm-opportunity-sort">{t('opportunity.list.sort')}</Label>
              <Select
                id="crm-opportunity-sort"
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
            </div>
            {filtered ? (
              <Button className="min-h-11 sm:min-h-8" variant="ghost" size="sm" onClick={clear}>
                <X aria-hidden="true" />
                {t('opportunity.list.filter.clear')}
              </Button>
            ) : null}
          </div>
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
