import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Pencil, Send, Trash2, UserCheck } from 'lucide-react';
import {
  TASK_TITLE_MAX,
  type RecordHistoryEntry,
  type TaskDetail as TaskDetailData,
  type TaskWorkflow,
  type UpdateTaskBody,
} from '@endora-commerce/contracts';
import { ApiError, readReturnTo, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import {
  ConfirmDialog,
  MoveToMenu,
  RecordHistory,
  recordHistoryChanges,
  ReferenceText,
  TagChips,
  useRecordHistory,
  type RecordHistoryChange,
} from '@endora-commerce/admin-kit/components';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { AssigneePicker, type ChosenAssignee } from '../components/AssigneePicker.js';
import { ContextSection } from '../components/ContextSection.js';
import { LinkedRecordsSection } from '../components/LinkedRecordsSection.js';
import { RemindersSection } from '../components/RemindersSection.js';
import { RelatedTasksSection } from '../components/RelatedTasksSection.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { SubtasksSection } from '../components/SubtasksSection.js';
import { TaskAttachments } from '../components/TaskAttachments.js';
import { TaskComments } from '../components/TaskComments.js';
import { TaskCustomFields } from '../components/TaskCustomFields.js';
import { dueOf, TaskFieldInputs, taskFieldValuesOf, usePriorities, type TaskFieldValues } from '../components/TaskFieldInputs.js';
import { useCurrentAdmin } from '../lib/current-admin.js';
import { calendarDateLabel, errorMessage, momentLabel } from '../lib/labels.js';
import { useEditorFocus } from '../lib/use-editor-focus.js';
import { useFocusFirstInvalid } from '../lib/use-focus-first-invalid.js';

const LIST_PATH = '/tasks';

/** The permitted next statuses a `TASK_TRANSITION_FORBIDDEN` refusal names, if `failure` is one. */
function allowedTargetsOf(failure: unknown): readonly string[] | null {
  if (!(failure instanceof ApiError) || failure.envelope.error.code !== 'TASK_TRANSITION_FORBIDDEN') return null;
  const allowed = (failure.envelope.error.details as { allowedTargets?: unknown } | undefined)?.allowedTargets;
  return Array.isArray(allowed) ? allowed.filter((code): code is string => typeof code === 'string') : null;
}

/**
 * One Task (`specs/163-projects-and-tasks/`, User Story 2;
 * `contracts/admin-surfaces.md` §2–§3).
 *
 * Top to bottom: **the header** — title, number and status; **the details** —
 * the status with the kit's *Move to…* menu, the board's own, which offers only
 * the moves the configured workflow permits from where the Task is
 * (`specs/165-task-management/` research R-1) and writes one move per
 * deliberate press, never per arrow key (WCAG 3.2.2, T092), and the rest
 * edited in place, sending only what changed —
 * several assignees (R-2), the description in the kit's reference editor and
 * drawn with its references as links (R-4, R-5), the due date with an
 * optional time, the start date, the priority and the tags (User Story 1);
 * **the sub-tasks** — the parent, the progress line and the visible sub-tasks
 * — beside **the related Tasks** (User Story 5, R-15);
 * **the comments** (User Story 4, R-6), **the attachments** and **the custom
 * fields** (R-7, R-8); beside the details, **the context card** — the record
 * the Task belongs to as its owner describes it, which a writer may change
 * (`components/ContextSection.tsx`) — and **the linked records** — the
 * Opportunities, Orders and Quote Requests the Task is about (User Story 6,
 * R-16) — and **the reminders** the reader set or is named in (User Story 7,
 * R-17); **the history**; and last the zone `task.detail.after`, which
 * other modules fill and this one names none of.
 *
 * A Task the operator may not see answers exactly as one that does not exist
 * (404 `TASK_NOT_FOUND`), and the screen says what the server said. Without
 * `tasks:write` the screen is read-only and says so.
 */
export function TaskDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = readReturnTo(searchParams);
  const { hasPermission } = useAuth();
  const [task, setTask] = useState<TaskDetailData | null>(null);
  // Someone else's private Task is read-only even to a holder of `tasks:write` (R-3).
  const canWrite = hasPermission('tasks:write') && (task === null || task.permissions.canChange);
  const me = useCurrentAdmin();
  const statusId = useId();
  const detailsHeadingId = useId();
  const historyHeadingId = useId();
  const [workflow, setWorkflow] = useState<TaskWorkflow | null>(null);
  /**
   * The moves the server named when it refused one, from the status it was
   * refused from — newer than the workflow this screen read, so they replace
   * its moves from that status until the Task moves (FR-015).
   */
  const [refusedFrom, setRefusedFrom] = useState<{ from: string; allowed: readonly string[] } | null>(null);
  // A Task of a record is the record owner's to delete (`canChangeTasks`, T147):
  // no Delete the server would refuse.
  const mayDelete = task === null || task.context === null || task.context.canChangeTasks;
  // Someone else's private Task is deleted by a holder of `tasks:see_private` without `tasks:write` (FR-041).
  const mayDeletePrivate = task !== null && task.private && hasPermission('tasks:see_private');
  const privateId = useId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  /** After a move that closed the Task: how many of its visible sub-tasks are still open (FR-028). */
  const [openSubtasks, setOpenSubtasks] = useState(0);
  const [editing, setEditing] = useState(false);
  const editFocus = useEditorFocus(editing);
  /** The *Move to…* menu's wrapper: its trigger takes focus back after a move (the chosen target unmounts). */
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const statusLabelRef = useRef<HTMLParagraphElement>(null);
  const refocusMove = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const sequence = useRef(0);
  const priorities = usePriorities();

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setError(null);
    try {
      const loaded = await tasksApi.getTask(id);
      if (current === sequence.current) setTask(loaded);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('detail.error')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    setTask(null);
    setLoading(true);
    void load();
  }, [load]);

  // After a move from the menu: back to its trigger once it is enabled again, or
  // to the status's label when no move is left from the new status (WCAG 2.4.3).
  useEffect(() => {
    if (!refocusMove.current || busy) return;
    refocusMove.current = false;
    const trigger = moveMenuRef.current?.querySelector('button');
    if (trigger) trigger.focus();
    else statusLabelRef.current?.focus();
  });

  // The statuses and moves of the workflow, for the status control and the history.
  useEffect(() => {
    let live = true;
    tasksApi
      .workflow()
      .then((loaded) => {
        if (live) setWorkflow(loaded);
      })
      // Without it the control offers only the current status; the screen still works.
      .catch(() => undefined);
    return (): void => {
      live = false;
    };
  }, []);

  /** A status's name in the reader's language, from the workflow; the code when it is not there. */
  const statusName = (code: string): string => {
    const status = workflow?.statuses.find((candidate) => candidate.code === code);
    return status ? status.name[language] || status.defaultName : code;
  };

  /** A priority's name in the reader's language, from the list; the code when it is not there. */
  const priorityName = (code: string): string => {
    const priority = priorities.find((candidate) => candidate.code === code);
    return priority ? priority.name[language] || priority.defaultName : code;
  };

  /** One write; the answer is the Task as it is now. Resolves `true` when it was made. */
  const write = async (body: UpdateTaskBody, done: (next: TaskDetailData) => string): Promise<boolean> => {
    setBusy(true);
    setWriteError(null);
    setNotice('');
    setOpenSubtasks(0);
    try {
      const next = await tasksApi.updateTask(id, body);
      setTask(next);
      setNotice(done(next));
      setHistoryVersion((version) => version + 1);
      return true;
    } catch (failure) {
      setWriteError(errorMessage(failure, t('detail.saveError')));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Opened from another screen that named its own address (a record's *Tasks*
  // panel, issue #512): the way back — and the way out after a delete — leads there.
  const back = returnTo ? { label: tCore('common.action.back'), to: returnTo } : { label: t('detail.back'), to: LIST_PATH };

  if (task === null) {
    return (
      <>
        <PageHeader title={t('list.title')} back={back} />
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('detail.loading')}
          </p>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error ?? t('detail.error')}</span>
              <span className="flex gap-2">
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                  {tCore('common.action.retry')}
                </Button>
                <Button className="min-h-11 sm:min-h-8" asChild variant="ghost" size="sm">
                  <Link to={back.to}>{back.label}</Link>
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  const changeStatus = async (to: string): Promise<boolean> => {
    setBusy(true);
    setWriteError(null);
    setNotice('');
    setOpenSubtasks(0);
    try {
      const { task: next, openSubtasks: stillOpen } = await tasksApi.changeStatus(id, task.status.code, to);
      setTask(next);
      setRefusedFrom(null);
      // Closing a parent is allowed while sub-tasks are open; the operator is told how many (FR-028).
      setOpenSubtasks(next.closed ? stillOpen : 0);
      setNotice(t('detail.statusChanged', { status: next.status.name }));
      setHistoryVersion((version) => version + 1);
      return true;
    } catch (failure) {
      // The server's sentence names the moves it permits; the control offers exactly those from now on.
      const allowed = allowedTargetsOf(failure);
      if (allowed) setRefusedFrom({ from: task.status.code, allowed });
      setWriteError(errorMessage(failure, t('detail.saveError')));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** The caller's own draft becomes a normal Task — one way (FR-037). */
  const publish = async (): Promise<void> => {
    setBusy(true);
    setWriteError(null);
    setNotice('');
    try {
      setTask(await tasksApi.publishTask(id));
      setNotice(t('detail.published'));
      setHistoryVersion((version) => version + 1);
    } catch (failure) {
      setWriteError(errorMessage(failure, t('detail.saveError')));
    } finally {
      setBusy(false);
    }
  };

  const mine = me !== null && task.createdBy?.id === me.id;
  const someoneElsesPrivate = task.private && !mine;
  // A private Task is assigned to nobody but its Creator (FR-038): with anybody
  // else on it, turning Private on could only be refused (T095).
  const privateBlocked = !task.private && task.assignees.some((assignee) => assignee.id !== me?.id);

  const assignToMe = (): Promise<boolean> =>
    me ? write({ addAssigneeIds: [me.id] }, () => t('detail.saved')) : Promise.resolve(false);

  /**
   * The current status, then the moves the workflow permits from it — or, once
   * the server refused a move from here, exactly the targets it named.
   */
  const allowedTargets =
    refusedFrom !== null && refusedFrom.from === task.status.code
      ? refusedFrom.allowed
      : (workflow?.transitions ?? []).filter((edge) => edge.from === task.status.code).map((edge) => edge.to);
  const moveTargets = allowedTargets
    .filter((code) => code !== task.status.code)
    .map((code) => workflow?.statuses.find((status) => status.code === code))
    .filter((status): status is NonNullable<typeof status> => status !== undefined)
    .sort((a, b) => a.weight - b.weight)
    .map((status) => ({ code: status.code, name: status.name[language] || status.defaultName, color: status.color }));
  const assignedToMe = me !== null && task.assignees.some((person) => person.id === me.id);

  return (
    <>
      <PageHeader
        className="[&>div:first-child]:min-w-0 [&_h1]:flex-wrap"
        title={
          <span className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
            <span>{task.title}</span>
            <StatusBadge status={task.status} />
            {task.draft ? <Badge variant="outline">{t('detail.draftBadge')}</Badge> : null}
            {task.private ? <Badge variant="secondary">{t('detail.privateBadge')}</Badge> : null}
          </span>
        }
        description={<span>{task.number}</span>}
        back={back}
        actions={
          // Delete sits in the page header, apart from the frequent Edit in
          // the Details section (issue #527), as on a Project and an Opportunity.
          (canWrite || mayDeletePrivate) && mayDelete && task.permissions.canDelete && !editing ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 text-destructive hover:text-destructive sm:min-h-9"
              disabled={busy}
              onClick={(): void => setDeleting(true)}
            >
              <Trash2 aria-hidden="true" />
              {t('detail.delete')}
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {task.draft ? (
        <Alert className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('detail.draftHint')}</span>
            {task.permissions.canPublish ? (
              <Button
                type="button"
                size="sm"
                className="min-h-11 sm:min-h-8"
                disabled={busy}
                aria-busy={busy}
                onClick={(): void => void publish()}
              >
                <Send aria-hidden="true" />
                {t('detail.publish')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardContent className="pt-6">
            <section aria-labelledby={detailsHeadingId} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={detailsHeadingId} className="text-base font-semibold">
                  {t('detail.details')}
                </h2>
                {canWrite && !editing ? (
                  <Button
                    ref={editFocus.openerRef}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-8"
                    disabled={busy}
                    onClick={(): void => setEditing(true)}
                  >
                    <Pencil aria-hidden="true" />
                    {t('detail.edit')}
                  </Button>
                ) : null}
              </div>
              {canWrite && !mayDelete ? (
                <p className="text-xs text-muted-foreground">{t('detail.deleteNotAllowed')}</p>
              ) : null}

              {canWrite ? (
                <div role="group" aria-labelledby={statusId} className="max-w-xs space-y-1">
                  <p ref={statusLabelRef} id={statusId} tabIndex={-1} className="text-sm font-medium leading-none">
                    {t('field.status')}
                  </p>
                  <StatusBadge status={task.status} />
                  {moveTargets.length > 0 ? (
                    <div ref={moveMenuRef}>
                      <MoveToMenu
                        title={task.title}
                        targets={moveTargets}
                        busy={busy}
                        onMove={(code): void => {
                          refocusMove.current = true;
                          void changeStatus(code);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {someoneElsesPrivate
                    ? t('detail.privateReadOnly', { name: task.createdBy?.name ?? '' })
                    : t('detail.readOnly')}
                </p>
              )}

              {/* Only its Creator says whether a Task is private, and a Task of a record never is (FR-038). */}
              {canWrite && mine && task.context === null && !editing ? (
                <div className="space-y-1">
                  <label htmlFor={privateId} className="flex min-h-11 items-center gap-2 text-sm font-medium sm:min-h-9">
                    <Checkbox
                      id={privateId}
                      role="switch"
                      checked={task.private}
                      disabled={busy || privateBlocked}
                      aria-describedby={`${privateId}-hint`}
                      onChange={(event): void =>
                        void write({ private: event.target.checked }, () => t('detail.saved'))
                      }
                    />
                    {t('detail.private')}
                  </label>
                  <p id={`${privateId}-hint`} className="text-xs text-muted-foreground">
                    {task.private
                      ? t('detail.privateOnHint')
                      : privateBlocked
                        ? t('detail.privateBlocked')
                        : t('detail.privateHint')}
                  </p>
                </div>
              ) : null}

              {editing ? (
                <TaskEditForm
                  editorRef={editFocus.editorRef}
                  task={task}
                  busy={busy}
                  onCancel={(): void => {
                    setEditing(false);
                    setWriteError(null);
                  }}
                  onSave={async (body): Promise<void> => {
                    if (Object.keys(body).length === 0) {
                      setEditing(false);
                      return;
                    }
                    if (await write(body, () => t('detail.saved'))) setEditing(false);
                  }}
                />
              ) : (
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div className="space-y-0.5 sm:col-span-2">
                    <dt className="text-xs font-medium text-muted-foreground">{t('field.description')}</dt>
                    <dd className="[overflow-wrap:anywhere]">
                      {task.description.trim() ? (
                        <ReferenceText text={task.description} references={task.references} />
                      ) : (
                        <span className="text-muted-foreground">{t('detail.noDescription')}</span>
                      )}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">
                      {task.dueAt ? t('field.dueAt') : t('field.dueOn')}
                    </dt>
                    <dd className={task.overdue ? 'font-medium text-destructive' : undefined}>
                      {task.dueAt
                        ? momentLabel(task.dueAt, language)
                        : task.dueOn
                          ? calendarDateLabel(task.dueOn, language)
                          : t('list.noDueDate')}
                      {task.overdue ? ` · ${t('list.overdue')}` : null}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">{t('field.startOn')}</dt>
                    <dd>{task.startOn ? calendarDateLabel(task.startOn, language) : t('detail.noStartDate')}</dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">{t('field.priority')}</dt>
                    <dd>
                      {task.priority ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="inline-block size-2 rounded-full"
                            style={{ backgroundColor: task.priority.color }}
                          />
                          {task.priority.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t('field.priorityNone')}</span>
                      )}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">{t('field.tags')}</dt>
                    <dd>
                      {task.tags.length > 0 ? (
                        <TagChips tags={task.tags} />
                      ) : (
                        <span className="text-muted-foreground">{t('detail.noTags')}</span>
                      )}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">{t('field.assignee')}</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      {task.assignees.length > 0 ? (
                        <ul aria-label={t('field.assignee')} className="flex flex-wrap gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
                          {task.assignees.map((person) => (
                            <li key={person.id}>
                              {person.name}
                              {person.active ? null : (
                                <span className="text-muted-foreground"> ({t('detail.inactive')})</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">{t('list.unassigned')}</span>
                      )}
                      {canWrite && me && !assignedToMe ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11 px-2 sm:min-h-8"
                          disabled={busy}
                          onClick={(): void => void assignToMe()}
                        >
                          <UserCheck aria-hidden="true" />
                          {t('detail.assignToMe')}
                        </Button>
                      ) : null}
                    </dd>
                  </div>
                  <div className="space-y-0.5 text-xs text-muted-foreground sm:col-span-2">
                    <p>
                      {task.createdBy
                        ? t('detail.createdBy', { name: task.createdBy.name, date: momentLabel(task.createdAt, language) })
                        : t('detail.createdOn', { date: momentLabel(task.createdAt, language) })}
                    </p>
                    {task.completedAt ? <p>{t('detail.completedAt', { date: momentLabel(task.completedAt, language) })}</p> : null}
                  </div>
                </dl>
              )}

              {openSubtasks > 0 ? (
                <Alert>
                  <AlertDescription>{t('detail.openSubtasks', { count: openSubtasks })}</AlertDescription>
                </Alert>
              ) : null}

              {writeError ? (
                <Alert variant="destructive">
                  <AlertDescription>{writeError}</AlertDescription>
                </Alert>
              ) : null}
            </section>
          </CardContent>
        </Card>

        {/* The side column beside the details: where the Task belongs, what it is linked to, its reminders. */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardContent className="pt-6">
              <ContextSection
                task={task}
                canChange={canWrite}
                busy={busy}
                onWrite={(body, message): Promise<boolean> => write(body, () => message)}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <LinkedRecordsSection
                task={task}
                canChange={canWrite}
                onChange={(message): void => {
                  setNotice(message);
                  setHistoryVersion((version) => version + 1);
                  void load();
                }}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <RemindersSection
                task={task}
                canChange={canWrite}
                onChange={(message): void => {
                  setNotice(message);
                  setHistoryVersion((version) => version + 1);
                  void load();
                }}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0 lg:col-span-2">
          <CardContent className="pt-6">
            <SubtasksSection
              task={task}
              canChange={canWrite}
              onChange={(next, message): void => {
                setTask(next);
                setNotice(message);
                setHistoryVersion((version) => version + 1);
              }}
            />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardContent className="pt-6">
            <RelatedTasksSection
              task={task}
              canChange={canWrite}
              onChange={(message): void => {
                setNotice(message);
                setHistoryVersion((version) => version + 1);
                void load();
              }}
            />
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-3">
          <CardContent className="pt-6">
            <TaskComments
              taskId={task.id}
              // Whoever may see the Task may comment, but someone else's private Task is read only (R-3).
              canComment={hasPermission('tasks:read') && !(task.private && task.createdBy?.id !== me?.id)}
              onChange={(): void => setHistoryVersion((version) => version + 1)}
            />
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardContent className="pt-6">
            <TaskAttachments
              taskId={task.id}
              canChange={canWrite}
              onChange={(): void => setHistoryVersion((version) => version + 1)}
            />
          </CardContent>
        </Card>

        <div className="min-w-0">
          <TaskCustomFields
            task={task}
            canChange={canWrite}
            onChange={(next): void => {
              setTask(next);
              setNotice(t('detail.saved'));
              setHistoryVersion((version) => version + 1);
            }}
          />
        </div>

        <Card className="min-w-0 lg:col-span-3">
          <CardContent className="pt-6">
            <section aria-labelledby={historyHeadingId} className="space-y-3">
              <h2 id={historyHeadingId} className="text-base font-semibold">
                {t('detail.history')}
              </h2>
              <TaskHistory
                taskId={task.id}
                version={historyVersion}
                statusName={statusName}
                priorityName={priorityName}
              />
            </section>
          </CardContent>
        </Card>
      </div>

      {/* Mounted before it has text, so the announcement is reliable (WCAG 4.1.3). */}
      <p role="status" className="sr-only">
        {notice}
      </p>

      {deleting ? (
        <DeleteTaskDialog
          task={task}
          onClose={(): void => setDeleting(false)}
          onDeleted={(): void => void navigate(back.to)}
        />
      ) : null}

      <AdminZone name="task.detail.after" props={{ taskId: task.id }} />
    </>
  );
}

interface TaskEditFormProps {
  /** The form's container: its first control takes focus when it opens. */
  editorRef: RefObject<HTMLDivElement | null>;
  task: TaskDetailData;
  busy: boolean;
  onCancel: () => void;
  /** Only the fields that changed; empty when nothing did. */
  onSave: (body: UpdateTaskBody) => Promise<void>;
}

/** The Task's title, assignees and the fields of `TaskFieldInputs`, edited together. */
function TaskEditForm(props: TaskEditFormProps): ReactNode {
  const { task, busy } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const ids = { title: useId(), assignee: useId() };
  const [title, setTitle] = useState(task.title);
  const [fields, setFields] = useState<TaskFieldValues>(() => taskFieldValuesOf(task));
  const [assignees, setAssignees] = useState<ChosenAssignee[]>(
    task.assignees.map((person) => ({ id: person.id, name: person.name })),
  );
  const [missingTitle, setMissingTitle] = useState(false);
  const invalid = useFocusFirstInvalid(props.editorRef);

  const save = (): void => {
    if (title.trim() === '') {
      setMissingTitle(true);
      invalid.refuse();
      return;
    }
    const due = dueOf(fields);
    const before = dueOf(taskFieldValuesOf(task));
    const dueChanged = due.dueAt !== before.dueAt || due.dueOn !== before.dueOn;
    const tagIds = [...fields.tagIds];
    const body: UpdateTaskBody = {
      ...(title.trim() !== task.title ? { title: title.trim() } : {}),
      ...(fields.description !== task.description ? { description: fields.description } : {}),
      ...(dueChanged
        ? due.dueAt !== null
          ? { dueAt: due.dueAt }
          : { dueOn: due.dueOn, ...(task.dueAt !== null ? { dueAt: null } : {}) }
        : {}),
      ...((fields.startOn || null) !== task.startOn ? { startOn: fields.startOn || null } : {}),
      ...((fields.priorityCode || null) !== (task.priority?.code ?? null)
        ? { priorityCode: fields.priorityCode || null }
        : {}),
      ...([...tagIds].sort().join(',') !== task.tags.map((tag) => tag.id).sort().join(',') ? { tagIds } : {}),
      ...(assignees.map((chosen) => chosen.id).join(',') !== task.assignees.map((person) => person.id).join(',')
        ? { assigneeIds: assignees.map((chosen) => chosen.id) }
        : {}),
    };
    void props.onSave(body);
  };

  return (
    <div ref={props.editorRef} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor={ids.title}>
          {t('field.title')}
          <span aria-hidden="true" className="text-destructive">
            {' *'}
          </span>
        </Label>
        <Input
          id={ids.title}
          value={title}
          maxLength={TASK_TITLE_MAX}
          required
          aria-invalid={missingTitle}
          aria-describedby={missingTitle ? `${ids.title}-error` : undefined}
          onChange={(event): void => {
            setTitle(event.target.value);
            setMissingTitle(false);
          }}
        />
        {missingTitle ? (
          <p id={`${ids.title}-error`} className="text-xs text-destructive">
            {t('create.error.title')}
          </p>
        ) : null}
      </div>
      <TaskFieldInputs
        values={fields}
        onChange={(patch): void => setFields((previous) => ({ ...previous, ...patch }))}
        taskId={task.id}
        references={task.references}
        currentPriority={task.priority ? { code: task.priority.code, name: task.priority.name } : null}
        disabled={busy}
      />
      <div className="space-y-1">
        <Label htmlFor={task.private ? undefined : ids.assignee}>{t('field.assignee')}</Label>
        {task.private ? (
          // A private Task is its Creator's alone (FR-038): no picker of other people.
          <p className="text-sm text-muted-foreground">{t('create.privateAssignee')}</p>
        ) : (
          <AssigneePicker id={ids.assignee} value={assignees} onChange={setAssignees} taskId={task.id} />
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button type="button" className="min-h-11 sm:min-h-9" disabled={busy} aria-busy={busy} onClick={save}>
          {tCore('common.action.save')}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={props.onCancel}>
          {tCore('common.action.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Fields of a Task's audited state a reader is shown, each with its label (`history.field.<field>`). */
const SHOWN_HISTORY_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'status',
  'dueOn',
  'dueAt',
  'startOn',
  'priorityCode',
  'contextNote',
  'completedAt',
]);

const emptyValue = (value: unknown): boolean => value === null || value === undefined || value === '';

/**
 * The rows an entry shows: the {@link SHOWN_HISTORY_FIELDS}, and the due date
 * only where it is not the day of a due moment the same entry shows — a Task
 * due at a time stores both, and the walk found *Due* and *Due date* side by
 * side (165 T095). Where either side has a date but no time, the date stays.
 */
function shownHistoryChanges(changes: readonly RecordHistoryChange[]): RecordHistoryChange[] {
  const shown = changes.filter((change) => SHOWN_HISTORY_FIELDS.has(change.field));
  const dueAt = shown.find((change) => change.field === 'dueAt');
  const dueOn = shown.find((change) => change.field === 'dueOn');
  if (!dueAt || !dueOn) return shown;
  const derived =
    (emptyValue(dueOn.before) || !emptyValue(dueAt.before)) && (emptyValue(dueOn.after) || !emptyValue(dueAt.after));
  return derived ? shown.filter((change) => change !== dueOn) : shown;
}

/**
 * The Task's audit trail (`GET /tasks/:id/history`) on the kit's
 * `RecordHistory` (`specs/163-projects-and-tasks/` research R-17): newest
 * first, a page at a time, each entry by what happened and what it changed,
 * field by field. Identifiers — the assignee, the context — are never a row;
 * the entry's heading says an assignment happened. Read again after every
 * write made on this screen.
 */
function TaskHistory(props: {
  taskId: string;
  version: number;
  statusName: (code: string) => string;
  priorityName: (code: string) => string;
}): ReactNode {
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const { taskId } = props;
  const loadPage = useCallback((cursor: string | null) => tasksApi.history(taskId, cursor ?? undefined), [taskId]);
  const history = useRecordHistory<RecordHistoryEntry>(loadPage, props.version);

  const renderValue = (field: string, raw: unknown): ReactNode => {
    if (raw === null || raw === undefined || raw === '') return '—';
    if (field === 'status') return props.statusName(String(raw));
    if (field === 'priorityCode') return props.priorityName(String(raw));
    if ((field === 'dueOn' || field === 'startOn') && typeof raw === 'string') return calendarDateLabel(raw, language);
    if ((field === 'completedAt' || field === 'dueAt') && typeof raw === 'string') return momentLabel(raw, language);
    return String(raw);
  };

  return (
    <RecordHistory
      history={history}
      copy={{
        hint: t('history.hint'),
        empty: t('history.empty'),
        end: t('history.end'),
        truncated: t('history.truncated'),
      }}
      heading={(entry) => t(`auditLog.${entry.action}`)}
      changes={(entry) => shownHistoryChanges(recordHistoryChanges(entry))}
      fieldLabel={(field) => t(`history.field.${field}`)}
      renderValue={renderValue}
      formatTime={(iso): string => momentLabel(iso, language)}
    />
  );
}

/**
 * Deleting a Task, behind the kit's destructive confirmation — it opens on
 * *Cancel*, so Enter on a dialog opened by accident keeps the Task (issue #527).
 * A refusal is shown in the dialog, in the server's words.
 */
function DeleteTaskDialog(props: { task: TaskDetailData; onClose: () => void; onDeleted: () => void }): ReactNode {
  const t = useTranslation('tasks');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await tasksApi.deleteTask(props.task.id);
      props.onDeleted();
    } catch (failure) {
      setError(errorMessage(failure, t('delete.error')));
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      destructive
      title={t('delete.title')}
      confirmLabel={t('delete.confirm')}
      busy={busy}
      error={error}
      onCancel={props.onClose}
      onConfirm={(): void => void confirm()}
      message={
        <div className="space-y-3">
          <p>{t('delete.body', { number: props.task.number })}</p>
          {props.task.subtasks.total > 0 ? <p>{t('delete.subtasks', { count: props.task.subtasks.total })}</p> : null}
        </div>
      }
    />
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TaskDetail;
