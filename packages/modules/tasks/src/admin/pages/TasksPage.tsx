import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ListChecks, Plus, SlidersHorizontal, X } from 'lucide-react';
import { TASK_LIST_LIMIT_MAX, TASK_LIST_SORTS, type TaskSummary } from '@endora-commerce/contracts';
import { useAuth, useListViewModePreference, usePageSizePreference } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, EmptyState, Label, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import {
  CursorPagination,
  ResponsiveTable,
  SavedViewsControl,
  customFieldFilterRefusal,
  writeCustomFieldFilterParams,
  withoutCustomFieldFilter,
  type SavedViewState,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { TaskBoard } from '../components/TaskBoard.js';
import { TaskFilters } from '../components/TaskFilters.js';
import { ViewModeToggle } from '../components/ViewModeToggle.js';
import { useTaskColumns } from '../components/task-columns.js';
import { errorMessage } from '../lib/labels.js';
import { BOARD_CARD_ANCHOR, TASK_WORKFLOW_PATH } from '../lib/settings-paths.js';
import {
  apiQuery,
  customFilters,
  fromSavedView,
  hasFilters,
  readSort,
  toSavedFilters,
  withFilter,
} from '../lib/task-filters.js';
import { useTaskVocabulary } from '../lib/use-task-vocabulary.js';

const VIEWS_ENDPOINT = '/api/v1/admin/tasks/list-views';
/** The list id the list/board choice is remembered under (`listViewModes`). */
const LIST_ID = 'tasks';
/** Custom-field filters are offered to a reader who may view custom fields. */
const CUSTOM_FIELDS_READ_PERMISSION = 'custom_fields:read';

/** Each sort in the directions a person reads it in first. */
const SORT_OPTIONS = TASK_LIST_SORTS.flatMap((sort) =>
  sort === 'created' || sort === 'updated'
    ? [`${sort}:desc`, `${sort}:asc`]
    : [`${sort}:asc`, `${sort}:desc`],
);

/**
 * The Tasks screen (`specs/165-task-management/` User Story 3, FR-018 –
 * FR-021; `contracts/admin-surfaces.md` §1) — **replaces** 163's `TasksList`.
 *
 * Every Task the operator may see — the server hides a Task whose context they
 * may not see, and another admin's draft or private Task — shown as a list or
 * as a board, the choice remembered for the admin across devices
 * (`listViewModes.tasks`). **The filters live in the address**, so both views
 * read the same ones, a filtered screen can be reloaded or sent on, and
 * switching view carries them over. A saved view stores the filters and the
 * list's sort, and applies to both views; a value it names that no longer
 * exists is left out, and the screen says how many were.
 *
 * The list is keyset-paged and knows no total, so it pages by the cursors it
 * was given; changing anything it asks for starts again from the first page.
 */
export function TasksPage(): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('tasks:write');
  const canConfigure = hasPermission('tasks:configure');
  const customFields = hasPermission(CUSTOM_FIELDS_READ_PERMISSION);
  const columns = useTaskColumns();
  const vocabulary = useTaskVocabulary();
  const [mode, setMode] = useListViewModePreference(LIST_ID);
  // The admin's rows per page for this list, kept across devices (feature 164); never above what the API returns.
  const { pageSize, setPageSize } = usePageSizePreference(LIST_ID);
  const [searchParams, setSearchParams] = useSearchParams();
  // Keyed by the address's own text, so the derived values are stable until it changes.
  const address = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(address), [address]);
  const sort = readSort(params);
  const filtered = hasFilters(params);

  /** The cursors that led to the page on screen; empty on the first page. */
  const [trail, setTrail] = useState<string[]>([]);
  const [rows, setRows] = useState<TaskSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusedCustomField, setRefusedCustomField] = useState<string | null>(null);
  const [viewsError, setViewsError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const sequence = useRef(0);

  /** Replace the address's filters; the history keeps one entry for the screen. */
  const navigate = useCallback(
    (next: URLSearchParams): void => {
      setTrail([]);
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );

  const listQuery = useMemo(() => {
    const query = apiQuery(params, { customFields, withSort: true });
    const cursor = trail[trail.length - 1];
    if (cursor) query.set('cursor', cursor);
    query.set('limit', String(Math.min(pageSize, TASK_LIST_LIMIT_MAX)));
    return query.toString();
  }, [params, customFields, trail, pageSize]);
  const boardQuery = useMemo(() => apiQuery(params, { customFields }).toString(), [params, customFields]);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    setRefusedCustomField(null);
    try {
      const page = await tasksApi.listTasksBy(new URLSearchParams(listQuery));
      // A slower, older answer must not overwrite a newer one.
      if (current !== sequence.current) return;
      setRows(page.items);
      setNextCursor(page.nextCursor);
      setLoaded(true);
    } catch (failure) {
      if (current !== sequence.current) return;
      const refused = customFieldFilterRefusal(failure);
      if (refused) setRefusedCustomField(refused);
      else setError(errorMessage(failure, t('list.error')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [listQuery, t]);

  useEffect(() => {
    if (mode === 'list') void load();
  }, [mode, load]);

  const clear = (): void => navigate(new URLSearchParams());

  const savedState = useMemo<SavedViewState>(
    () => ({
      filters: toSavedFilters(params),
      sort: params.has('sort') ? { field: sort.sort, dir: sort.dir } : null,
      visibleColumns: null,
    }),
    [params, sort.sort, sort.dir],
  );

  const applyView = (state: SavedViewState): void => {
    const { params: next, dropped } = fromSavedView(state.filters, state.sort ?? null, {
      statuses: vocabulary.workflow ? new Set(vocabulary.workflow.statuses.map((status) => status.code)) : null,
      priorities: vocabulary.priorities ? new Set(vocabulary.priorities.map((priority) => priority.code)) : null,
      tags: vocabulary.tags ? new Set(vocabulary.tags.map((tag) => tag.id)) : null,
    });
    setStaleNotice(dropped > 0 ? t('views.stale', { count: dropped }) : null);
    navigate(next);
  };

  const newTask = (
    <Button className="min-h-11 sm:min-h-9" asChild>
      <Link to="/tasks/new">
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
    />
  ) : (
    <EmptyState
      icon={<ListChecks size={20} />}
      title={t('list.empty.title')}
      description={canWrite ? t('list.empty.body') : t('list.empty.bodyReadOnly')}
      action={canWrite ? newTask : null}
    />
  );

  const showNewInHeader = canWrite && (mode === 'board' || rows.length > 0 || filtered || !loaded);

  return (
    <>
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          <>
            <ViewModeToggle mode={mode} onChange={setMode} />
            {canConfigure && mode === 'board' ? (
              <Button variant="outline" className="min-h-11 sm:min-h-9" asChild>
                <Link to={`${TASK_WORKFLOW_PATH}#${BOARD_CARD_ANCHOR}`}>
                  <SlidersHorizontal aria-hidden="true" />
                  {t('board.configureCard')}
                </Link>
              </Button>
            ) : null}
            {showNewInHeader ? newTask : null}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SavedViewsControl endpoint={VIEWS_ENDPOINT} current={savedState} onApply={applyView} onError={setViewsError} />
            {mode === 'list' ? (
              <div className="space-y-1">
                <Label htmlFor="tasks-sort">{t('list.sort.label')}</Label>
                <Select
                  id="tasks-sort"
                  value={`${sort.sort}:${sort.dir}`}
                  onChange={(event): void => {
                    const [field, dir] = event.target.value.split(':');
                    navigate(withFilter(withFilter(params, 'sort', field ?? null), 'dir', dir ?? null));
                  }}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`list.sort.${option.replace(':', '.')}`)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
          {viewsError ? (
            <Alert variant="destructive">
              <AlertDescription>{viewsError}</AlertDescription>
            </Alert>
          ) : null}
          {/* Mounted before it has text, so the notice is announced (WCAG 4.1.3). */}
          <p id="tasks-views-notice" role="status" className={staleNotice ? 'text-sm text-muted-foreground' : 'sr-only'}>
            {staleNotice ?? ''}
          </p>
          <TaskFilters
            idPrefix="tasks"
            params={params}
            onChange={navigate}
            statuses={vocabulary.workflow?.statuses ?? []}
            priorities={vocabulary.priorities ?? []}
            customFields={customFields}
          />
          {filtered ? (
            <div className="flex justify-end">
              <Button className="min-h-11 sm:min-h-8" variant="ghost" size="sm" onClick={clear}>
                <X aria-hidden="true" />
                {t('list.filter.clear')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {refusedCustomField ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('filter.customFieldRefused', { field: refusedCustomField })}</span>
            <Button
              className="min-h-11 sm:min-h-8"
              variant="outline"
              size="sm"
              onClick={(): void =>
                navigate(writeCustomFieldFilterParams(params, withoutCustomFieldFilter(customFilters(params), refusedCustomField)))
              }
            >
              {t('filter.customFieldRemove')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {mode === 'board' ? (
        <TaskBoard query={boardQuery} workflow={vocabulary.workflow} filtered={filtered} />
      ) : (
        <Card>
          <CardContent className="pt-6" aria-busy={loading}>
            {/* Mounted before it has text, so a reload is announced (WCAG 4.1.3). */}
            <p role="status" className="sr-only">
              {loading && loaded ? t('list.loading') : ''}
            </p>
            {error ? (
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
                <ResponsiveTable data={rows} columns={columns} keyExtractor={(row): string => row.id} emptyState={emptyState} />
                {rows.length > 0 || trail.length > 0 ? (
                  <CursorPagination
                    page={trail.length + 1}
                    pageSize={pageSize}
                    maxPageSize={TASK_LIST_LIMIT_MAX}
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
      )}
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TasksPage;
