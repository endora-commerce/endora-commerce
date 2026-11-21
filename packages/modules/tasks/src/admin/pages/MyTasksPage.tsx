import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleCheck, Plus } from 'lucide-react';
import type { TaskSummary } from '@endora-commerce/contracts';
import { useAuth, useListViewModePreference } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, EmptyState, PageHeader } from '@endora-commerce/admin-kit/ui';
import { ResponsiveTable, ViewModeToggle } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { useDigestDisclosure } from '../components/DigestControl.js';
import { TaskBoard } from '../components/TaskBoard.js';
import { TaskFilters } from '../components/TaskFilters.js';
import { useTaskColumns } from '../components/task-columns.js';
import { errorMessage } from '../lib/labels.js';
import { apiQuery, hasFilters } from '../lib/task-filters.js';
import { useTaskVocabulary } from '../lib/use-task-vocabulary.js';

/** The list id the list/board choice is remembered under — not the Tasks screen's. */
const LIST_ID = 'tasks-mine';
const CUSTOM_FIELDS_READ_PERMISSION = 'custom_fields:read';

/**
 * What *My Tasks* is (`GET /tasks/mine` implies it; the board is told): the
 * caller's own, open, published Tasks.
 */
const IMPLIED = new URLSearchParams([
  ['assignee', 'me'],
  ['statusCategory', 'open'],
  ['draft', 'false'],
]);

/**
 * *My Tasks* (`specs/165-task-management/` User Story 3 scenario 6, FR-018;
 * 163's FR-033) — **replaces** 163's `MyTasks`.
 *
 * The caller's open Tasks, the soonest due first and undated ones last, as a
 * list or as a board — the choice remembered on its own
 * (`listViewModes['tasks-mine']`) — with the Tasks screen's filters, less the
 * three it implies (assignee, open or closed, drafts). The list is the server's
 * answer of up to 500, in its order; the board is the Tasks board asked for
 * the same set, its closed lanes left empty. The caller's *Daily digest*
 * (`specs/165-task-management/` User Story 7) is a closed disclosure in the
 * header that says its state, so the list is the first thing below the title
 * (issue #1563).
 */
export function MyTasksPage(): ReactNode {
  const t = useTranslation('tasks');
  /** Where focus returns after *Clear filters* in the empty state (WCAG 2.4.3). */
  const searchRef = useRef<HTMLInputElement>(null);
  const tCore = useTranslation('core');
  const { hasPermission } = useAuth();
  const customFields = hasPermission(CUSTOM_FIELDS_READ_PERMISSION);
  const canWrite = hasPermission('tasks:write');
  const columns = useTaskColumns();
  const vocabulary = useTaskVocabulary();
  const [mode, setMode] = useListViewModePreference(LIST_ID);
  const digest = useDigestDisclosure();
  const [searchParams, setSearchParams] = useSearchParams();
  const address = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(address), [address]);
  const filtered = hasFilters(params);
  const [rows, setRows] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A read is in flight — the first, or a reload after a filter change (`aria-busy`, T092). */
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);

  const navigate = useCallback(
    (next: URLSearchParams): void => setSearchParams(next, { replace: true }),
    [setSearchParams],
  );

  const mineQuery = useMemo(() => {
    const query = apiQuery(params, { customFields });
    // `/tasks/mine` implies these and refuses them; an address carrying one (an old link) is not passed on.
    for (const key of IMPLIED.keys()) query.delete(key);
    return query.toString();
  }, [params, customFields]);
  const boardQuery = useMemo(
    () => apiQuery(params, { customFields, implied: IMPLIED }).toString(),
    [params, customFields],
  );

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const loaded = await tasksApi.myTasks(new URLSearchParams(mineQuery));
      if (current === sequence.current) setRows(loaded);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('mine.error')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [mineQuery, t]);

  useEffect(() => {
    if (mode === 'list') void load();
  }, [mode, load]);

  const clear = (): void => navigate(new URLSearchParams());

  return (
    <>
      <PageHeader
        title={t('mine.title')}
        actions={
          <>
            {digest.trigger}
            <ViewModeToggle mode={mode} onChange={setMode} />
            <Button className="min-h-11 sm:min-h-9" variant="outline" asChild>
              <Link to="/tasks">{t('mine.all')}</Link>
            </Button>
          </>
        }
      />

      {/* The caller's own daily digest (User Story 7, FR-036), opened from its summary in the header (#1563). */}
      {digest.panel}

      <Card className="mb-4">
        <CardContent className="space-y-4">
          <TaskFilters
            idPrefix="tasks-mine"
            searchRef={searchRef}
            params={params}
            onChange={navigate}
            statuses={vocabulary.workflow?.statuses.filter((status) => status.category === 'open') ?? []}
            priorities={vocabulary.priorities ?? []}
            implied={{ assignee: true, statusCategory: true, draft: true }}
            customFields={customFields}
            filtered={filtered}
            onClear={clear}
          />
        </CardContent>
      </Card>

      {mode === 'board' ? (
        <TaskBoard query={boardQuery} workflow={vocabulary.workflow} filtered={filtered} />
      ) : (
        <Card>
          <CardContent aria-busy={loading}>
            {/* Mounted before it has text, so a reload is announced (WCAG 4.1.3), as on the Tasks screen. */}
            <p role="status" className="sr-only">
              {loading && rows !== null ? t('mine.loading') : ''}
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
            ) : rows === null ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('mine.loading')}
              </p>
            ) : (
              <ResponsiveTable
                data={rows}
                columns={columns}
                keyExtractor={(row): string => row.id}
                emptyState={
                  filtered ? (
                    <EmptyState
                      variant="no-results"
                      title={t('list.noResults.title')}
                      description={t('list.noResults.body')}
                      onClearFilters={clear}
      focusAfterClear={searchRef}
                    />
                  ) : (
                    <EmptyState
                      icon={<CircleCheck size={20} />}
                      title={t('mine.empty.title')}
                      description={t('mine.empty.body')}
                      action={
                        canWrite ? (
                          <Button className="min-h-11 sm:min-h-9" asChild>
                            <Link to="/tasks/new">
                              <Plus aria-hidden="true" />
                              {t('list.new')}
                            </Link>
                          </Button>
                        ) : null
                      }
                    />
                  )
                }
              />
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default MyTasksPage;
