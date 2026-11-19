import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import {
  PROJECT_STAGE_NAME_MAX,
  type CustomFieldFilter,
  type CustomFieldListFilterField,
  type ProjectRole,
  type ProjectState,
  type ProjectSummary,
  type ProjectTemplateSummary,
} from '@endora-commerce/contracts';
import { useAuth, usePageSizePreference, type PageSizeOption } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import {
  CustomFieldListFilters,
  FilterChip,
  ListToolbar,
  ListToolbarSearch,
  PaginationFooter,
  ResponsiveTable,
  customFieldDisplayName,
  customFieldFilterRefusal,
  toCustomFieldFiltersParam,
  useCustomFieldListFilterFields,
  withCustomFieldFilter,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi, type ProjectListParams, type ProjectSort } from '../api.js';
import { StateBadge } from '../components/StateBadge.js';
import { StageDot } from '../components/StageDot.js';
import { calendarDateLabel, errorMessage, NO_VALUE, valueLabel } from '../lib/labels.js';
import { AdminUserLookup, OrganizationLookup } from '../components/LookupPickers.js';
import {
  NO_FILTERS,
  SORTS,
  STATES,
  hiddenFilterCount,
  readListAddress,
  writeListAddress,
  type Filters,
  type ListAddress,
  type SortOption,
} from '../lib/list-filters.js';

/** The most rows `GET /projects` answers in one page (`PROJECT_LIST_LIMIT_MAX`). */
const MAX_PAGE_LIMIT = 100;
const PAGE_SIZES: readonly PageSizeOption[] = [10, 20, 50, 100];

const SEARCH_DEBOUNCE_MS = 300;
/** The first page's trail: one instance, so a derived empty trail is the same value every render. */
const NO_CURSORS: readonly string[] = [];
/** The longest search `GET /projects` takes (`ProjectListQuerySchema.q`). */
const SEARCH_MAX = 200;

/** The Project custom fields the list offers as filters (User Story 9). */
const CUSTOM_FIELD_FILTERS_ENDPOINT = '/api/v1/admin/projects/custom-field-filters';
/** Custom fields — their filters included — are shown only to a reader who may view them. */
const CUSTOM_FIELDS_READ_PERMISSION = 'custom_fields:read';

/** The custom fields offered as list filters, as the kit's hook reads them. */
type OfferedCustomFields = ReturnType<typeof useCustomFieldListFilterFields>;

/**
 * Reads the offered custom fields and hands them to the list. Renders
 * nothing: it is mounted only for a reader holding `custom_fields:read`, so
 * only they read the fields — and mounted whether or not *More filters* is
 * open, so a refused filter is named by its label even while the panel,
 * where its cell lives, is folded away.
 */
function CustomFieldFilterSource({ onOffered }: { onOffered: (offered: OfferedCustomFields) => void }): null {
  const offered = useCustomFieldListFilterFields(CUSTOM_FIELD_FILTERS_ENDPOINT);
  const { fields, status, reload } = offered;
  useEffect(() => {
    onOffered({ fields, status, reload });
  }, [fields, status, reload, onOffered]);
  return null;
}

/**
 * The Projects list (`specs/163-projects-and-tasks/`, User Story 1;
 * `contracts/admin-surfaces.md` §2).
 *
 * Every Project the operator may see — the server applies Organization reach
 * and visibility, so nothing here filters for safety — narrowed by state,
 * Organization, "my projects" or any one Member, a Project Role some Member
 * holds, the Template it was created from, the current Stage's name, the
 * custom fields marked as list filters (for a reader who may view custom
 * fields) and a search over number and title; sorted by creation, value or the current
 * Stage's deadline. The list is keyset-paged and knows its total, so the kit's
 * footer can say "21–40 of 57".
 *
 * The Role and Template choices list archived ones too, marked: a Project
 * keeps an archived Role, and was created from a Template archived since.
 *
 * **The filters and the sort live in the address** (issue #454,
 * `lib/list-filters.ts`), so Back, a reload and a shared link keep them and
 * another screen can link to a narrowed list. A parameter the list does not
 * take is ignored; a Role or Template the choices no longer hold is dropped
 * from the address once they are read.
 */
export function ProjectsList(): ReactNode {
  const t = useTranslation('projects');
  /** Where focus returns after *Clear filters* in the empty state (WCAG 2.4.3). */
  const searchRef = useRef<HTMLInputElement>(null);
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('projects:write');
  const canFilterCustomFields = hasPermission(CUSTOM_FIELDS_READ_PERMISSION);
  const { pageSize: preferredPageSize, setPageSize } = usePageSizePreference('projects-list');
  const pageSize = Math.min(preferredPageSize, MAX_PAGE_LIMIT) as PageSizeOption;

  const [searchParams, setSearchParams] = useSearchParams();
  // Keyed by the address's own text, so the derived values are stable until it changes.
  const address = searchParams.toString();
  const { filters, sort } = useMemo(() => readListAddress(new URLSearchParams(address)), [address]);

  const [search, setSearch] = useState(filters.q);
  const [stageSearch, setStageSearch] = useState(filters.stageName);
  /** The search texts these boxes last wrote, so an address they did not write (Back, *Clear*) is shown. */
  const written = useRef({ q: filters.q, stageName: filters.stageName });
  const latestFilters = useRef(filters);
  latestFilters.current = filters;
  /** The choices of the Role and Template filters; `null` until read, and when the read failed. */
  const [roles, setRoles] = useState<ProjectRole[] | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplateSummary[] | null>(null);
  /**
   * The cursors that led to the page on screen, for the address they were
   * given under: any other address is on its first page.
   */
  const [pages, setPages] = useState<{ address: string; cursors: readonly string[] }>({ address, cursors: NO_CURSORS });
  const trail = pages.address === address ? pages.cursors : NO_CURSORS;
  const setTrail = (step: (cursors: readonly string[]) => readonly string[]): void =>
    setPages((previous) => ({ address, cursors: step(previous.address === address ? previous.cursors : NO_CURSORS) }));
  const [rows, setRows] = useState<ProjectSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The custom-field filter the server refused, until the operator removes it. */
  const [refusedCustomField, setRefusedCustomField] = useState<string | null>(null);
  const [offeredCustomFields, setOfferedCustomFields] = useState<OfferedCustomFields | null>(null);
  const customFieldFields: readonly CustomFieldListFilterField[] = offeredCustomFields?.fields ?? [];
  const sequence = useRef(0);

  /**
   * Change what the address asks for, from what it asks for now. It replaces
   * the screen's history entry, so Back leaves the list rather than undoing a
   * filter; a new address is on its first page.
   */
  const update = useCallback(
    (change: (current: ListAddress) => ListAddress): void => {
      setSearchParams(
        (current) => {
          const next = writeListAddress(change(readListAddress(current)));
          return next.toString() === current.toString() ? current : next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // The search boxes are typed into; the address follows once typing pauses.
  useEffect(() => {
    const q = search.trim();
    const stageName = stageSearch.trim();
    if (q === latestFilters.current.q && stageName === latestFilters.current.stageName) return undefined;
    const timer = setTimeout(() => {
      written.current = { q, stageName };
      update((current) => ({ ...current, filters: { ...current.filters, q, stageName } }));
    }, SEARCH_DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [search, stageSearch, update]);

  // An address the boxes did not write — Back, a link, *Clear* — is shown in them.
  useEffect(() => {
    if (filters.q !== written.current.q) setSearch(filters.q);
    if (filters.stageName !== written.current.stageName) setStageSearch(filters.stageName);
    written.current = { q: filters.q, stageName: filters.stageName };
  }, [filters.q, filters.stageName]);

  // The choices of the Role and Template filters; a failed read leaves the filter with "any" only.
  useEffect(() => {
    let alive = true;
    projectsApi
      .listRoles()
      .then((loaded) => {
        if (alive) setRoles(loaded);
      })
      .catch(() => undefined);
    projectsApi
      .listTemplates()
      .then((loaded) => {
        if (alive) setTemplates(loaded);
      })
      .catch(() => undefined);
    return (): void => {
      alive = false;
    };
  }, []);

  // A Role or Template the address names that the choices no longer hold is dropped,
  // once they are read; a failed read drops nothing, and the server matches nothing.
  useEffect(() => {
    const dropRole = roles !== null && filters.roleId !== '' && !roles.some((role) => role.id === filters.roleId);
    const dropTemplate =
      templates !== null &&
      filters.templateId !== '' &&
      !templates.some((template) => template.id === filters.templateId);
    if (!dropRole && !dropTemplate) return;
    update((current) => ({
      ...current,
      filters: {
        ...current.filters,
        ...(dropRole ? { roleId: '' } : {}),
        ...(dropTemplate ? { templateId: '' } : {}),
      },
    }));
  }, [roles, templates, filters.roleId, filters.templateId, update]);

  // Filters the custom fields on what was asked: without the permission, none is sent.
  const customFieldParam = canFilterCustomFields ? toCustomFieldFiltersParam(filters.customFields) : null;

  const params = useMemo<ProjectListParams>(() => {
    const [field, order] = sort.split(':') as [ProjectSort, 'asc' | 'desc'];
    const cursor = trail[trail.length - 1];
    return {
      ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
      ...(filters.state ? { state: [filters.state] } : {}),
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.mine ? { memberId: 'me' } : filters.memberId ? { memberId: filters.memberId } : {}),
      ...(filters.roleId ? { roleId: filters.roleId } : {}),
      ...(filters.templateId ? { templateId: filters.templateId } : {}),
      ...(filters.stageName.trim() ? { stageName: filters.stageName.trim() } : {}),
      ...(customFieldParam !== null ? { customFieldFilters: customFieldParam } : {}),
      sort: field,
      order,
      ...(cursor ? { cursor } : {}),
      limit: pageSize,
    };
  }, [filters, customFieldParam, sort, trail, pageSize]);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    setRefusedCustomField(null);
    try {
      const page = await projectsApi.listProjects(params);
      // A slower, older answer must not overwrite a newer one.
      if (current !== sequence.current) return;
      setRows(page.items);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      setLoaded(true);
    } catch (failure) {
      if (current !== sequence.current) return;
      // A custom field no longer offered as a filter is named, with a way to drop it.
      const refused = customFieldFilterRefusal(failure);
      if (refused !== null) {
        setRows([]);
        setTotal(0);
        setNextCursor(null);
        setLoaded(true);
        setRefusedCustomField(refused);
      } else {
        setError(errorMessage(failure, t('list.error')));
      }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [params, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Any change of what is asked for is a new address, which starts again from the first page. */
  const change = (patch: Partial<Filters>): void =>
    update((current) => ({ ...current, filters: { ...current.filters, ...patch } }));

  const clear = (): void => {
    setSearch('');
    setStageSearch('');
    update((current) => ({ ...current, filters: NO_FILTERS }));
  };

  const changeCustomField = useCallback(
    (key: string, filter: CustomFieldFilter | null): void =>
      update((current) => ({
        ...current,
        filters: { ...current.filters, customFields: withCustomFieldFilter(current.filters.customFields, key, filter) },
      })),
    [update],
  );

  const removeRefusedCustomField = (): void => {
    if (refusedCustomField !== null) changeCustomField(refusedCustomField, null);
  };

  const filtered =
    search.trim() !== '' ||
    stageSearch.trim() !== '' ||
    filters.state !== '' ||
    filters.organizationId !== null ||
    filters.mine ||
    filters.memberId !== null ||
    filters.roleId !== '' ||
    filters.templateId !== '' ||
    (canFilterCustomFields && Object.keys(filters.customFields).length > 0);

  const columns: ResponsiveColumn<ProjectSummary>[] = [
    {
      id: 'number',
      header: t('list.col.number'),
      primary: true,
      render: (row) => (
        <Link to={`/projects/${row.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {row.number}
        </Link>
      ),
    },
    {
      id: 'title',
      header: t('list.col.title'),
      primary: true,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
          <span>{row.title}</span>
          {row.state !== 'open' ? <StateBadge state={row.state} /> : null}
        </span>
      ),
    },
    {
      id: 'organizations',
      header: t('list.col.organizations'),
      render: (row) =>
        row.organizations.length === 0 ? (
          <span className="text-muted-foreground">{t('list.internal')}</span>
        ) : (
          <span className="[overflow-wrap:anywhere]">{row.organizations.map((org) => org.name).join(', ')}</span>
        ),
    },
    {
      id: 'stage',
      header: t('list.col.stage'),
      render: (row) =>
        row.currentStage ? (
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <StageDot color={row.currentStage.color} />
              <span>{row.currentStage.name}</span>
            </span>
            {row.currentStage.deadlineOn ? (
              <span
                className={
                  row.currentStage.overdue ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'
                }
              >
                {t('list.deadline', { date: calendarDateLabel(row.currentStage.deadlineOn, language) })}
                {row.currentStage.overdue ? (
                  <>
                    {' · '}
                    <span>{t('list.overdue')}</span>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
        ) : (
          NO_VALUE
        ),
    },
    {
      id: 'value',
      header: t('list.col.value'),
      className: 'text-right tabular-nums',
      render: (row) => valueLabel(row.value),
    },
    {
      id: 'managers',
      header: t('list.col.managers'),
      hideOnMobile: true,
      render: (row) =>
        row.projectManagers.length === 0 ? NO_VALUE : row.projectManagers.map((person) => person.name).join(', '),
    },
  ];

  const newProject = (
    <Button className="min-h-11 sm:min-h-9" asChild>
      <Link to="/projects/new">
        <Plus aria-hidden="true" />
        {t('list.new')}
      </Link>
    </Button>
  );

  const emptyState = filtered ? (
    <EmptyState
      variant="no-results"
      title={t('list.noResults.title')}
      description={t('list.noResults.body')}
      onClearFilters={clear}
      focusAfterClear={searchRef}
    />
  ) : (
    <EmptyState
      icon={<ClipboardList size={20} />}
      title={t('list.empty.title')}
      description={canWrite ? t('list.empty.body') : t('list.empty.bodyReadOnly')}
      action={canWrite ? newProject : null}
    />
  );

  return (
    <>
      <PageHeader
        title={t('list.title')}
        // With nothing listed the empty state carries the one action.
        actions={canWrite && (rows.length > 0 || filtered || !loaded) ? newProject : undefined}
      />

      {canFilterCustomFields ? <CustomFieldFilterSource onOffered={setOfferedCustomFields} /> : null}
      <Card className="mb-4">
        <CardContent>
          <ListToolbar
            label={t('list.filter.toolbar')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                id="projects-search"
                label={t('list.search')}
                placeholder={t('list.searchPlaceholder')}
                maxLength={SEARCH_MAX}
                value={search}
                onValueChange={setSearch}
              />
            }
            filters={
              <>
                <Select
                  id="projects-state"
                  aria-label={t('list.filter.state')}
                  className="w-auto"
                  value={filters.state}
                  onChange={(event): void => change({ state: event.target.value as ProjectState | '' })}
                >
                  <option value="">{t('list.filter.stateAll')}</option>
                  {STATES.map((state) => (
                    <option key={state} value={state}>
                      {t(`state.${state}`)}
                    </option>
                  ))}
                </Select>
                <div className="w-full sm:w-56">
                  <OrganizationLookup
                    id="projects-organization"
                    ariaLabel={t('list.filter.organization')}
                    value={filters.organizationId}
                    onChange={(organizationId): void => change({ organizationId })}
                    placeholder={t('list.filter.organizationPlaceholder')}
                  />
                </div>
                {/* "My projects" and a member are one filter: choosing one clears the other. */}
                <FilterChip
                  pressed={filters.mine}
                  onPressedChange={(next): void => change(next ? { mine: true, memberId: null } : { mine: false })}
                >
                  {t('list.filter.mine')}
                </FilterChip>
                <div className="w-full sm:w-56">
                  <AdminUserLookup
                    id="projects-member"
                    ariaLabel={t('list.filter.member')}
                    value={filters.memberId}
                    onChange={(memberId): void => change(memberId ? { memberId, mine: false } : { memberId: null })}
                    placeholder={t('list.filter.memberPlaceholder')}
                  />
                </div>
              </>
            }
            actions={
              <Select
                id="projects-sort"
                aria-label={t('list.sort')}
                className="w-auto"
                value={sort}
                onChange={(event): void => {
                  const next = event.target.value as SortOption;
                  update((current) => ({ ...current, sort: next }));
                }}
              >
                {SORTS.map((option) => (
                  <option key={option} value={option}>
                    {t(`list.sortOption.${option.replace(':', '.')}`)}
                  </option>
                ))}
              </Select>
            }
            moreFilters={
              <>
                <div className="space-y-1">
                  <Label htmlFor="projects-role">{t('list.filter.role')}</Label>
                  <Select
                    id="projects-role"
                    value={filters.roleId}
                    onChange={(event): void => change({ roleId: event.target.value })}
                  >
                    <option value="">{t('list.filter.roleAll')}</option>
                    {(roles ?? []).map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.archivedAt ? t('overview.archivedRole', { role: role.label }) : role.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="projects-template">{t('list.filter.template')}</Label>
                  <Select
                    id="projects-template"
                    value={filters.templateId}
                    onChange={(event): void => change({ templateId: event.target.value })}
                  >
                    <option value="">{t('list.filter.templateAll')}</option>
                    {(templates ?? []).map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.archivedAt ? `${template.name} (${t('templates.list.archived')})` : template.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="projects-stage-name">{t('list.filter.stageName')}</Label>
                  <Input
                    id="projects-stage-name"
                    type="search"
                    value={stageSearch}
                    maxLength={PROJECT_STAGE_NAME_MAX}
                    placeholder={t('list.filter.stageNamePlaceholder')}
                    onChange={(event): void => setStageSearch(event.target.value)}
                  />
                </div>
                {canFilterCustomFields && offeredCustomFields ? (
                  <CustomFieldListFilters
                    idPrefix="projects"
                    fields={offeredCustomFields.fields}
                    value={filters.customFields}
                    onChange={changeCustomField}
                    language={language}
                    status={offeredCustomFields.status}
                    onRetry={offeredCustomFields.reload}
                  />
                ) : null}
              </>
            }
            moreFiltersActiveCount={hiddenFilterCount(
              { ...filters, stageName: stageSearch },
              { customFields: canFilterCustomFields },
            )}
            filtersActive={filtered}
            onClearFilters={clear}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent aria-busy={loading}>
          {/* Mounted before it has text, so a reload is announced (WCAG 4.1.3). */}
          <p role="status" className="sr-only">
            {loading && loaded ? t('list.loading') : ''}
          </p>
          {refusedCustomField !== null ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {tCore('customFieldFilters.error.unavailable', {
                    field: customFieldDisplayName(customFieldFields, refusedCustomField, language),
                  })}
                </span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={removeRefusedCustomField}>
                  {tCore('customFieldFilters.error.remove')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                  {tCore('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : !loaded ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('list.loading')}
            </p>
          ) : (
            <>
              <ResponsiveTable
                data={rows}
                columns={columns}
                keyExtractor={(row): string => row.id}
                emptyState={emptyState}
              />
              {total > 0 ? (
                <PaginationFooter
                  page={trail.length}
                  pageSize={pageSize}
                  total={total}
                  pageSizes={PAGE_SIZES}
                  onPageSizeChange={(next): void => {
                    setPageSize(next);
                    setTrail(() => NO_CURSORS);
                  }}
                  onPrev={(): void => setTrail((previous) => previous.slice(0, -1))}
                  onNext={(): void => {
                    if (nextCursor && !loading) setTrail((previous) => [...previous, nextCursor]);
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
export default ProjectsList;
