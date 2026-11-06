import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CornerLeftUp, Link2, UserCheck } from 'lucide-react';
import type { CreateTaskBody, TaskContext, TaskDetail, TaskLinkTarget } from '@endora-commerce/contracts';
import { TASK_LINK_KINDS, TASK_TITLE_MAX, UUID_SHAPE_PATTERN } from '@endora-commerce/contracts';
import { CustomFieldValuesPanel } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { AssigneePicker, type ChosenAssignee } from '../components/AssigneePicker.js';
import { dueOf, TaskFieldInputs, taskFieldValuesOf, type TaskFieldValues } from '../components/TaskFieldInputs.js';
import { useCurrentAdmin } from '../lib/current-admin.js';
import { errorMessage } from '../lib/labels.js';

const UUID = UUID_SHAPE_PATTERN;
const LINK_PARAM = new RegExp(`^(${TASK_LINK_KINDS.join('|')}):(${UUID})$`, 'i');
const CONTEXT_PARAM = new RegExp(`^([a-z][a-z0-9_]*):(${UUID})(?::(${UUID}))?$`, 'i');

/** `?link=<kind>:<id>` — the record a panel's *Add task* was pressed on; anything else is ignored. */
function linkFromParam(value: string | null): TaskLinkTarget | null {
  const match = value ? LINK_PARAM.exec(value) : null;
  return match ? { kind: match[1]!.toLowerCase() as TaskLinkTarget['kind'], id: match[2]!.toLowerCase() } : null;
}

/** `?context=<type>:<id>[:<group>]` — the record (and group) to create the Task in; anything else is ignored. */
function contextFromParam(value: string | null): TaskContext | null {
  const match = value ? CONTEXT_PARAM.exec(value) : null;
  if (!match) return null;
  return {
    contextType: match[1]!.toLowerCase(),
    contextId: match[2]!.toLowerCase(),
    ...(match[3] ? { contextGroupId: match[3].toLowerCase() } : {}),
  };
}

/**
 * Creating a Task (`specs/163-projects-and-tasks/`, User Story 2;
 * `contracts/admin-surfaces.md` §2).
 *
 * A Task created here belongs to no record — a Project's Tasks are created on
 * the Project's own *Tasks* tab, into a Stage, which is the only place that
 * knows the Stage. A title is required; everything else is not — the
 * description in the kit's reference editor, the due date with an optional
 * time, the start date, the priority, the tags, the assignees and the `task`
 * custom fields (`specs/165-task-management/` User Story 1). The new Task
 * starts in the workflow's initial status and opens.
 *
 * `?parent=<taskId>` — *Add sub-task* on a Task's screen — creates the Task as
 * a sub-task of that one (User Story 5), named at the top of the form. The
 * server decides whether it may be: a parent the operator may not see, or one
 * that would nest too deep, is refused in its own words.
 *
 * `?link=<kind>:<id>` — *Add task* on an Opportunity's, an Order's or a Quote
 * Request's *Tasks* panel — creates the Task linked to that record, and
 * `?context=<type>:<id>[:<group>]` creates it in that record and group
 * (User Story 6). The form says so; the server validates both.
 *
 * *Save as draft* creates the Task as its caller's draft — nobody else sees
 * it or is told until it is published on its screen — and the **Private**
 * switch keeps it to its caller and the holders of *See private tasks*
 * (User Story 8). While the switch is on, the Task can be assigned only to the
 * caller, so the picker of other people gives way to that one choice; a Task
 * started inside a record is never private, so it offers no switch.
 */
export function TaskCreate(): ReactNode {
  const t = useTranslation('tasks');
  const navigate = useNavigate();
  const me = useCurrentAdmin();
  const { hasPermission } = useAuth();
  const { language } = useAppLanguage();
  const [searchParams] = useSearchParams();
  const parentTaskId = searchParams.get('parent');
  const link = linkFromParam(searchParams.get('link'));
  const context = contextFromParam(searchParams.get('context'));
  const [parent, setParent] = useState<TaskDetail | null>(null);
  const ids = { title: useId(), assignee: useId(), private: useId(), draftHint: useId() };
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState<TaskFieldValues>(() => taskFieldValuesOf());
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [assignees, setAssignees] = useState<ChosenAssignee[]>([]);
  const [isPrivate, setPrivate] = useState(false);
  const [missingTitle, setMissingTitle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The parent named at the top of the form; without it the Task is still sent under it.
  useEffect(() => {
    if (!parentTaskId) return;
    let live = true;
    tasksApi
      .getTask(parentTaskId)
      .then((loaded) => {
        if (live) setParent(loaded);
      })
      .catch(() => undefined);
    return (): void => {
      live = false;
    };
  }, [parentTaskId]);

  const submit = async (event: Pick<FormEvent, 'preventDefault'>, asDraft = false): Promise<void> => {
    event.preventDefault();
    if (title.trim() === '') {
      setMissingTitle(true);
      return;
    }
    const due = dueOf(fields);
    const body: CreateTaskBody = {
      title: title.trim(),
      ...(fields.description.trim() ? { description: fields.description } : {}),
      ...(due.dueAt ? { dueAt: due.dueAt } : due.dueOn ? { dueOn: due.dueOn } : {}),
      ...(fields.startOn ? { startOn: fields.startOn } : {}),
      ...(fields.priorityCode ? { priorityCode: fields.priorityCode } : {}),
      ...(fields.tagIds.length > 0 ? { tagIds: fields.tagIds } : {}),
      ...(assignees.length > 0 ? { assigneeIds: assignees.map((chosen) => chosen.id) } : {}),
      ...(Object.keys(customFieldValues).length > 0 ? { customFieldValues } : {}),
      ...(parentTaskId ? { parentTaskId } : {}),
      ...(link ? { links: [link] } : {}),
      ...(context ? { context } : {}),
      ...(isPrivate ? { private: true } : {}),
      ...(asDraft ? { draft: true } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      const created = await tasksApi.createTask(body);
      void navigate(`/tasks/${created.id}`);
    } catch (failure) {
      setError(errorMessage(failure, t('create.error.generic')));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('create.title')} description={t('create.description')} back={{ label: t('create.back'), to: '/tasks' }} />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <form className="space-y-5" noValidate onSubmit={(event): void => void submit(event)}>
            {parent ? (
              <p className="flex items-center gap-2 text-sm">
                <CornerLeftUp aria-hidden="true" className="size-4 text-muted-foreground" />
                {t('create.parent', { number: parent.number, title: parent.title })}
              </p>
            ) : null}
            {link ? (
              <p className="flex items-center gap-2 text-sm">
                <Link2 aria-hidden="true" className="size-4 text-muted-foreground" />
                {t(`create.link.${link.kind}`)}
              </p>
            ) : null}
            {context ? <p className="text-sm">{t('create.context')}</p> : null}
            <p className="text-xs text-muted-foreground">{t('create.requiredHint')}</p>

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
              taskId={null}
              disabled={busy}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={isPrivate ? undefined : ids.assignee}>{t('field.assignee')}</Label>
                {isPrivate ? (
                  <p className="text-sm">
                    {assignees.length > 0 ? `${assignees.map((chosen) => chosen.name).join(', ')} · ` : null}
                    <span className="text-muted-foreground">{t('create.privateAssignee')}</span>
                  </p>
                ) : (
                  <>
                    <AssigneePicker
                      id={ids.assignee}
                      value={assignees}
                      onChange={setAssignees}
                      {...(context ? { contextType: context.contextType, contextId: context.contextId } : {})}
                      ariaDescribedBy={`${ids.assignee}-hint`}
                    />
                    <p id={`${ids.assignee}-hint`} className="text-xs text-muted-foreground">
                      {t('field.assigneeHint')}
                    </p>
                  </>
                )}
                {me && !assignees.some((chosen) => chosen.id === me.id) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 px-2 sm:min-h-8"
                    onClick={(): void => setAssignees([...assignees, me])}
                  >
                    <UserCheck aria-hidden="true" />
                    {t('detail.assignToMe')}
                  </Button>
                ) : null}
              </div>
            </div>

            {/* A Task started inside a record is never private (FR-038): no switch there. */}
            {context ? null : (
              <div className="space-y-1">
                <label htmlFor={ids.private} className="flex min-h-11 items-center gap-2 text-sm font-medium sm:min-h-9">
                  <Checkbox
                    id={ids.private}
                    role="switch"
                    checked={isPrivate}
                    aria-describedby={`${ids.private}-hint`}
                    onChange={(event): void => {
                      const on = event.target.checked;
                      setPrivate(on);
                      // A private Task is its caller's alone: everyone else leaves the assignees.
                      if (on) setAssignees((chosen) => chosen.filter((person) => person.id === me?.id));
                    }}
                  />
                  {t('create.private')}
                </label>
                <p id={`${ids.private}-hint`} className="text-xs text-muted-foreground">
                  {t('create.privateHint')}
                </p>
              </div>
            )}

            {/* The `task` custom fields, sent with the Task (R-8); their definitions are `custom_fields:read`'s. */}
            {hasPermission('custom_fields:read') ? (
              <CustomFieldValuesPanel
                entityType="task"
                values={EMPTY_VALUES}
                onChange={setCustomFieldValues}
                language={language}
              />
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy} aria-busy={busy}>
                {busy ? t('create.submitting') : t('create.submit')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={busy}
                aria-describedby={ids.draftHint}
                onClick={(event): void => void submit(event, true)}
              >
                {t('create.saveDraft')}
              </Button>
              <p id={ids.draftHint} className="basis-full text-xs text-muted-foreground">
                {t('create.draftHint')}
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

const EMPTY_VALUES: Record<string, unknown> = {};

/** The default export the route declaration's dynamic-import factory resolves. */
export default TaskCreate;
