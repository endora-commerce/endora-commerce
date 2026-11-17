import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CornerLeftUp, ListTree, Plus, Unlink } from 'lucide-react';
import type { TaskDetail, TaskSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Label } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { calendarDateLabel, errorMessage, momentLabel } from '../lib/labels.js';
import { useEditorFocus } from '../lib/use-editor-focus.js';
import { StatusBadge } from './StatusBadge.js';
import { TaskPicker } from './TaskPicker.js';

export interface SubtasksSectionProps {
  task: TaskDetail;
  /** The reader may change this Task (`tasks:write`, not someone else's private Task). */
  canChange: boolean;
  /** The Task as the server answered a change — the screen's copy is replaced by it. */
  onChange: (next: TaskDetail, notice: string) => void;
}

/**
 * A Task's place in the sub-task hierarchy (`specs/165-task-management/`
 * User Story 5, FR-027–FR-029; `contracts/admin-surfaces.md` §2, main
 * column): the parent it is a sub-task of — a link, or a plain mention when
 * the reader may not see it —, the progress line and its sub-tasks with
 * status, assignees and due date. Everything comes with the Task: the section
 * asks for nothing until an operator picks a parent.
 *
 * Only the sub-tasks the reader may see are counted and listed (scenario 7);
 * the server has already left the others out. A writer may *Add sub-task* (the
 * create form with `?parent=`), *Make sub-task of…* another Task, or take the
 * Task out of its parent; a refusal — a cycle, a depth — is shown in the
 * server's words.
 */
export function SubtasksSection(props: SubtasksSectionProps): ReactNode {
  const { task, canChange } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const headingId = useId();
  const pickerId = useId();
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<TaskSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focus = useEditorFocus(picking);

  const setParent = async (parentTaskId: string | null): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await tasksApi.updateTask(task.id, { parentTaskId });
      props.onChange(
        next,
        next.parent?.number ? t('subtasks.moved', { number: next.parent.number }) : t('subtasks.detached'),
      );
      setPicking(false);
      setChosen(null);
      // *Remove from parent* unmounts with the parent line; focus goes to the opener.
      if (parentTaskId === null) focus.returnFocus();
    } catch (failure) {
      setError(errorMessage(failure, t('detail.saveError')));
    } finally {
      setBusy(false);
    }
  };

  // *Make sub-task of…* sits on the *Sub-task of* line it changes when there is
  // one (Law of Proximity, issue #512), and in the section header when there is not.
  const makeChild = picking ? null : (
    <Button
      ref={focus.openerRef}
      type="button"
      variant="ghost"
      size="sm"
      className="min-h-11 px-2 sm:min-h-8"
      disabled={busy}
      onClick={(): void => {
        setPicking(true);
        setError(null);
      }}
    >
      <ListTree aria-hidden="true" />
      {t('subtasks.makeChild')}
    </Button>
  );

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          {t('detail.subtasks')}
        </h2>
        {canChange ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-8">
              <Link to={`/tasks/new?parent=${task.id}`}>
                <Plus aria-hidden="true" />
                {t('subtasks.add')}
              </Link>
            </Button>
            {task.parent ? null : makeChild}
          </div>
        ) : null}
      </div>

      {task.parent ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <CornerLeftUp aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t('subtasks.parent')}</span>
          {task.parent.available && task.parent.number ? (
            <Link
              to={`/tasks/${task.parent.id}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {task.parent.number}
            </Link>
          ) : (
            <span>{t('subtasks.parentUnavailable')}</span>
          )}
          {canChange ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 px-2 sm:min-h-8"
              disabled={busy}
              onClick={(): void => void setParent(null)}
            >
              <Unlink aria-hidden="true" />
              {t('subtasks.detach')}
            </Button>
          ) : null}
          {canChange ? makeChild : null}
        </p>
      ) : null}

      {picking ? (
        <div ref={focus.editorRef} className="space-y-2 rounded-md border p-3">
          <Label htmlFor={pickerId}>{t('subtasks.parentPicker')}</Label>
          <TaskPicker id={pickerId} value={chosen} onChange={setChosen} exclude={[task.id]} disabled={busy} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy || chosen === null}
              aria-busy={busy}
              onClick={(): void => {
                if (chosen) void setParent(chosen.id);
              }}
            >
              {tCore('common.action.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy}
              onClick={(): void => {
                setPicking(false);
                setChosen(null);
                setError(null);
              }}
            >
              {tCore('common.action.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {task.subtasks.total > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('subtasks.progress', { closed: task.subtasks.closed, total: task.subtasks.total })}
        </p>
      ) : null}

      {task.subtaskItems.length > 0 ? (
        <ul aria-label={t('detail.subtasks')} className="divide-y rounded-md border">
          {task.subtaskItems.map((child) => (
            <SubtaskRow key={child.id} task={child} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('subtasks.empty')}</p>
      )}
    </section>
  );
}

/** One sub-task: its number and title as a link, its status, assignees and due date. */
function SubtaskRow(props: { task: TaskSummary }): ReactNode {
  const { task } = props;
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const due = task.dueAt ? momentLabel(task.dueAt, language) : task.dueOn ? calendarDateLabel(task.dueOn, language) : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <Link
        to={`/tasks/${task.id}`}
        className="min-w-0 font-medium text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline"
      >
        <span className="text-muted-foreground">{task.number}</span> {task.title}
      </Link>
      <StatusBadge status={task.status} />
      <span className="text-muted-foreground [overflow-wrap:anywhere]">
        {task.assignees.length > 0 ? task.assignees.map((person) => person.name).join(', ') : t('list.unassigned')}
      </span>
      <span className={task.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>
        {due ?? t('list.noDueDate')}
        {task.overdue ? ` · ${t('list.overdue')}` : null}
      </span>
    </li>
  );
}
