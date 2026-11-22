import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Send, Trash2 } from 'lucide-react';
import {
  TASK_TITLE_MAX,
  type RecordHistoryEntry,
  type TaskDetail as TaskDetailData,
  type TaskWorkflow,
  type UpdateTaskBody,
} from '@endora-commerce/contracts';
import { ApiError, cn, readReturnTo, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Label,
  PageHeader,
  RecordTabs,
  Switch,
} from '@endora-commerce/admin-kit/ui';
import {
  ConfirmDialog,
  InlineEditTitle,
  MoveToMenu,
  RecordHistory,
  recordHistoryChanges,
  useRecordHistory,
  type RecordHistoryChange,
} from '@endora-commerce/admin-kit/components';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { ContextSection } from '../components/ContextSection.js';
import { LinkedRecordsSection } from '../components/LinkedRecordsSection.js';
import { RemindersSection } from '../components/RemindersSection.js';
import { RelatedTasksSection } from '../components/RelatedTasksSection.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { SubtasksSection } from '../components/SubtasksSection.js';
import { TaskAttachments } from '../components/TaskAttachments.js';
import { TaskComments } from '../components/TaskComments.js';
import { TaskCustomFields } from '../components/TaskCustomFields.js';
import { TaskFacts } from '../components/TaskFacts.js';
import { usePriorities } from '../components/TaskFieldInputs.js';
import { useCurrentAdmin } from '../lib/current-admin.js';
import { calendarDateLabel, errorMessage, momentLabel } from '../lib/labels.js';
import { searchForTaskTab, taskTabFromSearch, type TaskTab } from '../lib/task-tabs.js';

const LIST_PATH = '/tasks';

/** One section of the sidebar card: a rule above every one but the first, as `divide-y` would draw. */
const SIDEBAR_SECTION = 'border-t pt-5 first:border-t-0 first:pt-0';

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
 * The Opportunity's layout (issue #1524, UX audit 2026-11-17 WORK-02):
 * **the header** — title, number and the status, said there once (#1566);
 * **the main card** — the details, with the kit's *Move to…* menu, the
 * board's own, which offers only the moves the configured workflow permits
 * from where the Task is (`specs/165-task-management/` research R-1) and
 * writes one move per deliberate press, never per arrow key (WCAG 3.2.2,
 * T092), and the rest edited in place, sending only what changed — several
 * assignees (R-2), the description in the kit's reference editor and drawn
 * with its references as links (R-4, R-5), the due date with an optional
 * time, the start date, the priority, the tags (User Story 1) and the custom
 * fields (R-8) — then **the sub-tasks**: the parent, the progress line and
 * the visible sub-tasks (User Story 5); **the sidebar card** — the record the
 * Task belongs to as its owner describes it, which a writer may change
 * (`components/ContextSection.tsx`), **the linked records** — the
 * Opportunities, Orders and Quote Requests the Task is about (User Story 6,
 * R-16) — **the reminders** the reader set or is named in (User Story 7,
 * R-17), **the related Tasks** (R-15) and last the zone `task.detail.after`,
 * which other modules fill and this one names none of; and **the tabs** —
 * the comments (User Story 4, R-6), the attachments (R-7) and the history,
 * the tab kept in the address (`?tab=`).
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
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = readReturnTo(searchParams);
  const { hasPermission } = useAuth();
  const [task, setTask] = useState<TaskDetailData | null>(null);
  // Someone else's private Task is read-only even to a holder of `tasks:write` (R-3).
  const canWrite = hasPermission('tasks:write') && (task === null || task.permissions.canChange);
  const me = useCurrentAdmin();
  const detailsHeadingId = useId();
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
  /** The *Move to…* menu's wrapper: its trigger takes focus back after a move (the chosen target unmounts). */
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
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
  // to the Details heading when no move is left from the new status (WCAG 2.4.3).
  useEffect(() => {
    if (!refocusMove.current || busy) return;
    refocusMove.current = false;
    const trigger = moveMenuRef.current?.querySelector('button');
    if (trigger) trigger.focus();
    else detailsHeadingRef.current?.focus();
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

  /**
   * One field saved where it is shown (`TaskFacts`, the title): the answer is
   * the Task as it is now. A refusal is the field's to show, under it, in the
   * server's sentence — so it is thrown, not put in the page's banner.
   */
  const saveField = async (body: UpdateTaskBody): Promise<void> => {
    setWriteError(null);
    setNotice('');
    setOpenSubtasks(0);
    let next: TaskDetailData;
    try {
      next = await tasksApi.updateTask(id, body);
    } catch (failure) {
      throw new Error(errorMessage(failure, t('detail.saveError')));
    }
    setTask(next);
    setHistoryVersion((version) => version + 1);
  };

  // Opened from another screen that named its own address (a record's *Tasks*
  // panel, issue #512): the way back — and the way out after a delete — leads there.
  const tab = taskTabFromSearch(searchParams);
  // A tab is a view of the same page: it replaces the entry instead of adding one.
  const selectTab = (next: TaskTab): void => {
    setSearchParams((previous) => searchForTaskTab(previous, next), { replace: true });
  };

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

  /** After a sidebar section wrote through its own route: say so, and read the Task and its history again. */
  const reloadAfter = (message: string): void => {
    setNotice(message);
    setHistoryVersion((version) => version + 1);
    void load();
  };

  return (
    <>
      {/* The title is edited where it is read, as on an Opportunity (issue #1525, WORK-03). */}
      <InlineEditTitle
        className="[&>div:first-child]:min-w-0 [&_h1]:flex-wrap"
        value={task.title}
        label={t('field.title')}
        canEdit={canWrite}
        maxLength={TASK_TITLE_MAX}
        validate={(draft): string | null => (draft === '' ? t('create.error.title') : null)}
        save={(title): Promise<void> => saveField({ title })}
        beside={
          <>
            <StatusBadge status={task.status} />
            {task.draft ? <Badge variant="outline">{t('detail.draftBadge')}</Badge> : null}
            {task.private ? <Badge variant="secondary">{t('detail.privateBadge')}</Badge> : null}
          </>
        }
        description={<span>{task.number}</span>}
        back={back}
        actions={
          // Delete sits in the page header, apart from the facts edited in
          // the Details section (issue #527), as on a Project and an Opportunity.
          (canWrite || mayDeletePrivate) && mayDelete && task.permissions.canDelete ? (
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

      {/*
        The Opportunity's layout (issue #1524): one grid from the header down.
        In the markup — the order a narrow screen stacks them in — the main
        card, the sidebar, the tabs; from `lg` the sidebar is the right column
        beside both, and the last row is the flexible one, so a tall sidebar
        stretches the space under the tabs and never the gap between the cards.
      */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <Card className="min-w-0 lg:col-start-1">
          <CardContent className="space-y-6">
            <section aria-labelledby={detailsHeadingId} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  ref={detailsHeadingRef}
                  id={detailsHeadingId}
                  tabIndex={-1}
                  className="text-base font-semibold"
                >
                  {t('detail.details')}
                </h2>
                {/* The status itself is the title's badge; here only the move (issue #1566). */}
                {canWrite && moveTargets.length > 0 ? (
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
              {canWrite && !mayDelete ? (
                <p className="text-xs text-muted-foreground">{t('detail.deleteNotAllowed')}</p>
              ) : null}

              {canWrite ? null : (
                <p className="text-sm text-muted-foreground">
                  {someoneElsesPrivate
                    ? t('detail.privateReadOnly', { name: task.createdBy?.name ?? '' })
                    : t('detail.readOnly')}
                </p>
              )}
              {/* Only its Creator says whether a Task is private, and a Task of a record never is (FR-038). */}
              {canWrite && mine && task.context === null ? (
                <div className="space-y-1">
                  {/* Issue #1607 — the kit `Switch`. Blocked, it stays focusable and is described by
                      why (`disabledReason`), which a natively disabled control would never let a
                      keyboard user hear; the visible hint says the same thing. */}
                  <div className="flex min-h-11 items-center gap-2 sm:min-h-9">
                    <Switch
                      id={privateId}
                      checked={task.private}
                      disabled={busy}
                      {...(privateBlocked
                        ? { disabledReason: t('detail.privateBlocked') }
                        : { 'aria-describedby': `${privateId}-hint` })}
                      onCheckedChange={(next): void => void write({ private: next }, () => t('detail.saved'))}
                    />
                    <Label htmlFor={privateId}>{t('detail.private')}</Label>
                  </div>
                  <p
                    id={`${privateId}-hint`}
                    className="text-xs text-muted-foreground"
                    {...(privateBlocked ? { 'aria-hidden': true } : {})}
                  >
                    {task.private
                      ? t('detail.privateOnHint')
                      : privateBlocked
                        ? t('detail.privateBlocked')
                        : t('detail.privateHint')}
                  </p>
                </div>
              ) : null}

              <TaskFacts
                task={task}
                canWrite={canWrite}
                priorities={priorities}
                save={saveField}
                assignToMe={me && !assignedToMe ? (): void => void assignToMe() : null}
                busy={busy}
              />
              <div className="space-y-0.5 text-xs text-muted-foreground">
                <p>
                  {task.createdBy
                    ? t('detail.createdBy', { name: task.createdBy.name, date: momentLabel(task.createdAt, language) })
                    : t('detail.createdOn', { date: momentLabel(task.createdAt, language) })}
                </p>
                {task.completedAt ? <p>{t('detail.completedAt', { date: momentLabel(task.completedAt, language) })}</p> : null}
              </div>

              {/* The record's own fields are details of it too (WORK-04): a section here, not a card. */}
              <TaskCustomFields
                task={task}
                canChange={canWrite}
                onChange={(next): void => {
                  setTask(next);
                  setNotice(t('detail.saved'));
                  setHistoryVersion((version) => version + 1);
                }}
              />

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

            <div className="border-t pt-6">
              <SubtasksSection
                task={task}
                canChange={canWrite}
                onChange={(next, message): void => {
                  setTask(next);
                  setNotice(message);
                  setHistoryVersion((version) => version + 1);
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/*
          Beside the details, one card of sections as on an Opportunity: where
          the Task belongs, what it is linked to, its reminders, the related
          Tasks, and last what other modules say about it (the zone's panels are
          sections of this card, no card in a card).
        */}
        <aside
          aria-label={t('detail.sidebar')}
          className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <Card>
            <CardContent className="space-y-5">
              <div className={SIDEBAR_SECTION}>
                <ContextSection
                  task={task}
                  canChange={canWrite}
                  busy={busy}
                  onWrite={(body, message): Promise<boolean> => write(body, () => message)}
                />
              </div>
              <div className={SIDEBAR_SECTION}>
                <LinkedRecordsSection task={task} canChange={canWrite} onChange={reloadAfter} />
              </div>
              <div className={SIDEBAR_SECTION}>
                <RemindersSection task={task} canChange={canWrite} onChange={reloadAfter} />
              </div>
              <div className={SIDEBAR_SECTION}>
                <RelatedTasksSection task={task} canChange={canWrite} onChange={reloadAfter} />
              </div>
              {/* Empty while nobody contributes, and then not drawn at all: no rule over nothing. */}
              <div className={cn(SIDEBAR_SECTION, 'empty:hidden *:mt-0')}>
                <AdminZone name="task.detail.after" props={{ taskId: task.id }} chrome="section" />
              </div>
            </CardContent>
          </Card>
        </aside>

        <RecordTabs<TaskTab>
          className="min-w-0 overflow-hidden lg:col-start-1"
          items={[
            { value: 'comments', label: t('detail.comments'), count: task.commentsCount },
            { value: 'attachments', label: t('attachments.title'), count: task.attachmentsCount },
            { value: 'history', label: t('detail.history') },
          ]}
          value={tab}
          onValueChange={selectTab}
          idBase="task-detail"
          aria-label={t('detail.tabs')}
        >
          {tab === 'comments' ? (
            <TaskComments
              taskId={task.id}
              // Whoever may see the Task may comment, but someone else's private Task is read only (R-3).
              canComment={hasPermission('tasks:read') && !(task.private && task.createdBy?.id !== me?.id)}
              // The history has an entry more, and the tab's count changed.
              onChange={(): void => {
                setHistoryVersion((version) => version + 1);
                void load();
              }}
            />
          ) : tab === 'attachments' ? (
            <TaskAttachments
              taskId={task.id}
              canChange={canWrite}
              onChange={(): void => {
                setHistoryVersion((version) => version + 1);
                void load();
              }}
            />
          ) : (
            <TaskHistory taskId={task.id} version={historyVersion} statusName={statusName} priorityName={priorityName} />
          )}
        </RecordTabs>
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
    </>
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
