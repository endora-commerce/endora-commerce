import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { ProjectStage, ProjectTasksResponse, TaskSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Input } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../../../api.js';
import { StageDot } from '../../../components/StageDot.js';
import { calendarDateLabel, errorMessage } from '../../../lib/labels.js';
import type { ProjectTabProps } from '../tabs.js';

/** The code `POST /tasks` enforces; the quick-add is offered to its holders only. */
const TASKS_WRITE = 'tasks:write';

/**
 * A Project's *Tasks* tab (`specs/163-projects-and-tasks/`, User Story 2;
 * `contracts/admin-surfaces.md` §2): its Tasks under the Stage each belongs to,
 * in Stage order, and a quick-add into each Stage.
 *
 * The page offers this tab only while the Tasks module is present and the
 * operator may read Tasks; should the server still answer
 * `tasksAvailable: false` — the module was switched off after the page opened —
 * the tab says so instead of showing an empty list.
 *
 * A Task is created through the Tasks module's own route, naming the Project
 * and the Stage as its context: a Project Task always belongs to a Stage.
 */
export function TasksTab({ project }: ProjectTabProps): ReactNode {
  const t = useTranslation('projects');
  const { hasPermission } = useAuth();
  // Adding to a Project's work needs both: Tasks' write and this Project's (T147, #472).
  const canAdd = hasPermission(TASKS_WRITE) && project.permissions.canWrite;
  const [answer, setAnswer] = useState<ProjectTasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setError(null);
    try {
      const loaded = await projectsApi.projectTasks(project.id);
      if (current === sequence.current) setAnswer(loaded);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('tasks.error')));
    }
  }, [project.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (answer === null) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('tasks.loading')}
      </p>
    );
  }
  if (!answer.tasksAvailable) return <p className="text-sm text-muted-foreground">{t('tasks.unavailable')}</p>;

  const stages = [...project.stages].sort((a, b) => a.position - b.position);
  const tasksOf = (stageId: string): TaskSummary[] =>
    answer.stages.find((group) => group.stageId === stageId)?.tasks ?? [];

  return (
    <div className="space-y-6">
      {stages.map((stage) => (
        <StageTasks
          key={stage.id}
          projectId={project.id}
          stage={stage}
          isCurrent={stage.id === project.currentStage?.id}
          tasks={tasksOf(stage.id)}
          canAdd={canAdd}
          onAdded={(task): void => {
            setNotice(t('tasks.quickAdd.added', { number: task.number, stage: stage.name }));
            void load();
          }}
        />
      ))}
      {/* Mounted before it has text, so the announcement is reliable (WCAG 4.1.3). */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </div>
  );
}

interface StageTasksProps {
  projectId: string;
  stage: ProjectStage;
  isCurrent: boolean;
  tasks: readonly TaskSummary[];
  canAdd: boolean;
  onAdded: (task: TaskSummary) => void;
}

/** One Stage: its Tasks, then the quick-add. */
function StageTasks(props: StageTasksProps): ReactNode {
  const { projectId, stage, tasks } = props;
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  const headingId = useId();
  const inputId = useId();
  const [title, setTitle] = useState('');
  const [missingTitle, setMissingTitle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (title.trim() === '') {
      setMissingTitle(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await projectsApi.addStageTask(projectId, stage.id, title.trim());
      setTitle('');
      props.onAdded(created);
    } catch (failure) {
      setError(errorMessage(failure, t('tasks.quickAdd.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-md border p-3">
      <h3 id={headingId} className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <StageDot color={stage.color} />
        <span className="[overflow-wrap:anywhere]">{stage.name}</span>
        {props.isCurrent ? <span className="text-xs font-normal text-muted-foreground">({t('stageBar.current')})</span> : null}
        {stage.completionGate ? (
          <Badge variant="outline" className="font-normal">
            {t('tasks.gate')}
          </Badge>
        ) : null}
      </h3>

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks.empty')}</p>
      ) : (
        <ul className="divide-y text-sm">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
              <Link to={`/tasks/${task.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                {task.number}
              </Link>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{task.title}</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: task.status.color }} />
                {task.status.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {task.assignees.length > 0 ? task.assignees.map((person) => person.name).join(', ') : t('tasks.unassigned')}
              </span>
              {task.dueOn ? (
                <span className={task.overdue ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}>
                  {t('tasks.due', { date: calendarDateLabel(task.dueOn, language) })}
                  {task.overdue ? ` · ${t('list.overdue')}` : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {props.canAdd ? (
        <form className="space-y-1 pt-1" noValidate onSubmit={(event): void => void add(event)}>
          <div className="flex flex-wrap gap-2">
            <Input
              id={inputId}
              className="min-w-48 flex-1"
              value={title}
              maxLength={200}
              placeholder={t('tasks.quickAdd.placeholder')}
              aria-label={t('tasks.quickAdd.label', { stage: stage.name })}
              aria-invalid={missingTitle}
              aria-describedby={missingTitle ? `${inputId}-error` : undefined}
              onChange={(event): void => {
                setTitle(event.target.value);
                setMissingTitle(false);
              }}
            />
            <Button
              type="submit"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              aria-label={t('tasks.quickAdd.submitTo', { stage: stage.name })}
              disabled={busy}
              aria-busy={busy}
            >
              <Plus aria-hidden="true" />
              {t('tasks.quickAdd.submit')}
            </Button>
          </div>
          {missingTitle ? (
            <p id={`${inputId}-error`} className="text-xs text-destructive">
              {t('tasks.quickAdd.titleRequired')}
            </p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

export default TasksTab;
