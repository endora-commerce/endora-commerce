import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { TaskLinkKind, TaskSummary } from '@endora-commerce/contracts';
import { useAuth, withReturnTo } from '@endora-commerce/admin-kit/lib';
import { Button, EditorSection } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { calendarDateLabel, momentLabel } from '../lib/labels.js';

/** How many linked Tasks the panel lists; the rest are one link away, on the Tasks list. */
const PANEL_LIMIT = 20;

export interface TasksPanelProps {
  kind: TaskLinkKind;
  recordId: string;
}

type State = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; tasks: TaskSummary[] };

/**
 * The Tasks linked to a record, on that record's own screen
 * (`specs/165-task-management/` User Story 6 scenario 2, FR-032;
 * `contracts/admin-surfaces.md` §3): an Order's, a Quote Request's or an
 * Opportunity's. Each Task the reader may see — the server lists no other
 * (`GET /tasks?linkedKind=&linkedId=`) — with its number and title, its
 * status, its assignees and its due date; *Add task* for a writer, which opens
 * the create form with the link filled in; and the same list on the Tasks
 * screen, where it can be filtered further.
 *
 * The zone renderer has already decided that `tasks` is present and that the
 * reader holds `tasks:read` before this chunk is fetched; the record's screen
 * belongs to another module and hands over an id and nothing else.
 */
export function TasksPanel({ kind, recordId }: TasksPanelProps): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const [state, setState] = useState<State>({ phase: 'loading' });
  /** Bumped by *Retry*: the read runs again. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    const query = new URLSearchParams({ linkedKind: kind, linkedId: recordId, limit: String(PANEL_LIMIT) });
    tasksApi
      .listTasksBy(query)
      .then((page) => {
        if (alive) setState({ phase: 'ready', tasks: page.items });
      })
      .catch(() => {
        if (alive) setState({ phase: 'failed' });
      });
    return (): void => {
      alive = false;
    };
  }, [kind, recordId, attempt]);

  const filtered = `/tasks?${new URLSearchParams({ linkedKind: kind, linkedId: recordId }).toString()}`;
  // A Task opened or added here leads Back to this record, not to the Tasks list (`?returnTo=`, issue #512).
  const location = useLocation();
  const backHere = (target: string): string => withReturnTo(target, `${location.pathname}${location.search}`);

  return (
    <EditorSection
      title={t('panel.title')}
      action={
        hasPermission('tasks:write') ? (
          <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-8">
            <Link to={backHere(`/tasks/new?link=${kind}:${recordId}`)}>
              <Plus aria-hidden="true" />
              {t('panel.add')}
            </Link>
          </Button>
        ) : null
      }
      className="mt-4"
      contentClassName="space-y-3 text-sm"
    >
      {state.phase === 'loading' ? (
        <p role="status" className="text-muted-foreground">
          {t('panel.loading')}
        </p>
      ) : state.phase === 'failed' ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-destructive">{t('panel.error')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={(): void => setAttempt((previous) => previous + 1)}
          >
            {tCore('common.action.retry')}
          </Button>
        </div>
      ) : state.tasks.length === 0 ? (
        <p className="text-muted-foreground">{t('panel.empty')}</p>
      ) : (
        <>
          <ul aria-label={t('panel.title')} className="divide-y">
            {state.tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Link
                  to={backHere(`/tasks/${task.id}`)}
                  className="min-w-0 font-medium text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline"
                >
                  <span className="text-muted-foreground">{task.number}</span> {task.title}
                </Link>
                <StatusBadge status={task.status} />
                <span className="text-muted-foreground [overflow-wrap:anywhere]">
                  {task.assignees.length > 0
                    ? task.assignees.map((person) => person.name).join(', ')
                    : t('list.unassigned')}
                </span>
                {task.dueAt || task.dueOn ? (
                  <span className={task.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                    {task.dueAt ? momentLabel(task.dueAt, language) : calendarDateLabel(task.dueOn, language)}
                    {task.overdue ? ` · ${t('list.overdue')}` : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <Link to={filtered} className="inline-block text-primary underline-offset-4 hover:underline">
            {t('panel.all')}
          </Link>
        </>
      )}
    </EditorSection>
  );
}
