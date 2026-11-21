import { useId, type ReactNode } from 'react';
import { UserCheck } from 'lucide-react';
import {
  TASK_DESCRIPTION_MAX,
  type TaskDetail,
  type TaskPriorityConfig,
  type UpdateTaskBody,
} from '@endora-commerce/contracts';
import { InlineEdit, ReferenceField, ReferenceText, TagChips, TagMultiSelect } from '@endora-commerce/admin-kit/components';
import { Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { calendarDateLabel, momentLabel } from '../lib/labels.js';
import { useTaskReferences } from '../lib/references.js';
import { AssigneePicker, type ChosenAssignee } from './AssigneePicker.js';
import { dueOf, taskFieldValuesOf, type TaskFieldValues } from './TaskFieldInputs.js';

type Due = Pick<TaskFieldValues, 'dueOn' | 'dueTime'>;

/** The due part of a write: only what differs from the Task's due date, `{}` when nothing does. */
export function dueChange(task: TaskDetail, draft: Due): UpdateTaskBody {
  const due = dueOf(draft);
  const before = dueOf(taskFieldValuesOf(task));
  if (due.dueAt === before.dueAt && due.dueOn === before.dueOn) return {};
  // A date alone clears a stored moment; a moment carries its own date.
  return due.dueAt !== null ? { dueAt: due.dueAt } : { dueOn: due.dueOn, ...(task.dueAt !== null ? { dueAt: null } : {}) };
}

/** Whether two lists of ids hold the same ids, in any order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join(',') === [...b].sort().join(',');
}

export interface TaskFactsProps {
  task: TaskDetail;
  /** `tasks:write`, and the Task is not someone else's private one. */
  canWrite: boolean;
  /** The operator's priority list; the Task's own priority is offered even when the list no longer holds it. */
  priorities: readonly TaskPriorityConfig[];
  /** Saves one field; a rejection carries the sentence to show under it. */
  save: (body: UpdateTaskBody) => Promise<void>;
  /** *Assign to me* — offered beside the assignees while the caller is not one of them. */
  assignToMe: (() => void) | null;
  busy: boolean;
}

/**
 * The facts of a Task, **each edited where it is shown** — the kit's
 * `InlineEdit`, the model an Opportunity's and a Project's facts share (issue
 * #1525, UX audit 2026-11-17 WORK-03; owner decision DEC-05): the
 * description in the kit's reference editor (Ctrl/Cmd + Enter saves), the due
 * date with its optional time, the start date, the priority, the tags and
 * the assignees. Every field has its own pencil, *Save* and *Cancel*, and
 * sends only itself. A private Task's assignee is its Creator's alone
 * (FR-038), so that one is read only.
 */
export function TaskFacts(props: TaskFactsProps): ReactNode {
  const { task, canWrite, save } = props;
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const timeId = useId();
  const { kinds, lookups } = useTaskReferences(task.id);
  const priorityOptions = props.priorities.map((priority) => ({
    code: priority.code,
    name: priority.name[language] || priority.defaultName,
  }));
  if (task.priority && !priorityOptions.some((option) => option.code === task.priority!.code)) {
    priorityOptions.push({ code: task.priority.code, name: task.priority.name });
  }

  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <InlineEdit<string>
        className="sm:col-span-2"
        label={t('field.description')}
        canEdit={canWrite}
        display={
          task.description.trim() ? (
            <ReferenceText text={task.description} references={task.references} />
          ) : (
            <span className="text-muted-foreground">{t('detail.noDescription')}</span>
          )
        }
        initial={(): string => task.description}
        unchanged={(draft): boolean => draft === task.description}
        save={(draft): Promise<void> => save({ description: draft })}
        editor={({ id, draft, setDraft, busy, errorId, submit }): ReactNode => (
          <div className="space-y-1">
            <ReferenceField
              id={id}
              value={draft}
              onValueChange={setDraft}
              kinds={kinds}
              lookups={lookups}
              references={task.references}
              maxLength={TASK_DESCRIPTION_MAX}
              disabled={busy}
              rows={4}
              autoFocus
              {...(errorId ? { 'aria-invalid': true } : {})}
              aria-describedby={[`${id}-hint`, errorId].filter(Boolean).join(' ')}
              onSubmitShortcut={submit}
            />
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {t('field.descriptionHint')}
            </p>
          </div>
        )}
      />

      <InlineEdit<Due>
        label={task.dueAt ? t('field.dueAt') : t('field.dueOn')}
        canEdit={canWrite}
        display={
          <span className={task.overdue ? 'font-medium text-destructive' : undefined}>
            {task.dueAt
              ? momentLabel(task.dueAt, language)
              : task.dueOn
                ? calendarDateLabel(task.dueOn, language)
                : t('list.noDueDate')}
            {task.overdue ? ` · ${t('list.overdue')}` : null}
          </span>
        }
        initial={(): Due => {
          const values = taskFieldValuesOf(task);
          return { dueOn: values.dueOn, dueTime: values.dueTime };
        }}
        unchanged={(draft): boolean => Object.keys(dueChange(task, draft)).length === 0}
        save={(draft): Promise<void> => save(dueChange(task, draft))}
        editor={({ id, draft, setDraft, busy, errorId }): ReactNode => (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              id={id}
              type="date"
              value={draft.dueOn}
              disabled={busy}
              aria-invalid={errorId !== undefined}
              aria-describedby={errorId}
              onChange={(event): void =>
                setDraft(event.target.value ? { ...draft, dueOn: event.target.value } : { dueOn: '', dueTime: '' })
              }
            />
            <div className="space-y-1">
              <Label htmlFor={timeId} className="text-xs font-normal text-muted-foreground">
                {t('field.dueTime')}
              </Label>
              <Input
                id={timeId}
                type="time"
                value={draft.dueTime}
                disabled={busy || draft.dueOn === ''}
                aria-describedby={`${timeId}-hint`}
                onChange={(event): void => setDraft({ ...draft, dueTime: event.target.value })}
              />
              <p id={`${timeId}-hint`} className="text-xs text-muted-foreground">
                {t('field.dueTimeHint')}
              </p>
            </div>
          </div>
        )}
      />

      <InlineEdit<string>
        label={t('field.startOn')}
        canEdit={canWrite}
        display={task.startOn ? calendarDateLabel(task.startOn, language) : t('detail.noStartDate')}
        initial={(): string => task.startOn ?? ''}
        unchanged={(draft): boolean => (draft || null) === task.startOn}
        save={(draft): Promise<void> => save({ startOn: draft || null })}
        editor={({ id, draft, setDraft, busy, errorId }): ReactNode => (
          <Input
            id={id}
            type="date"
            value={draft}
            disabled={busy}
            aria-invalid={errorId !== undefined}
            aria-describedby={errorId}
            onChange={(event): void => setDraft(event.target.value)}
          />
        )}
      />

      <InlineEdit<string>
        label={t('field.priority')}
        canEdit={canWrite}
        display={
          task.priority ? (
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
          )
        }
        initial={(): string => task.priority?.code ?? ''}
        unchanged={(draft): boolean => (draft || null) === (task.priority?.code ?? null)}
        save={(draft): Promise<void> => save({ priorityCode: draft || null })}
        editor={({ id, draft, setDraft, busy, errorId }): ReactNode => (
          <Select
            id={id}
            value={draft}
            disabled={busy}
            aria-invalid={errorId !== undefined}
            aria-describedby={errorId}
            onChange={(event): void => setDraft(event.target.value)}
          >
            <option value="">{t('field.priorityNone')}</option>
            {priorityOptions.map((priority) => (
              <option key={priority.code} value={priority.code}>
                {priority.name}
              </option>
            ))}
          </Select>
        )}
      />

      <InlineEdit<string[]>
        label={t('field.tags')}
        group
        canEdit={canWrite}
        display={
          task.tags.length > 0 ? (
            <TagChips tags={task.tags} />
          ) : (
            <span className="text-muted-foreground">{t('detail.noTags')}</span>
          )
        }
        initial={(): string[] => task.tags.map((tag) => tag.id)}
        unchanged={(draft): boolean => sameIds(draft, task.tags.map((tag) => tag.id))}
        save={(draft): Promise<void> => save({ tagIds: draft })}
        editor={({ id, labelId, draft, setDraft, busy }): ReactNode => (
          <TagMultiSelect
            id={id}
            ariaLabelledBy={labelId}
            selected={draft}
            onChange={setDraft}
            loadTags={tasksApi.listTags}
            disabled={busy}
            className="w-full"
          />
        )}
      />

      <InlineEdit<ChosenAssignee[]>
        label={t('field.assignee')}
        canEdit={canWrite && !task.private}
        display={
          <span className="flex flex-wrap items-center gap-2">
            {task.assignees.length > 0 ? (
              <ul aria-label={t('field.assignee')} className="flex flex-wrap gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
                {task.assignees.map((person) => (
                  <li key={person.id}>
                    {person.name}
                    {person.active ? null : <span className="text-muted-foreground"> ({t('detail.inactive')})</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">{t('list.unassigned')}</span>
            )}
            {canWrite && props.assignToMe ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-my-1 min-h-11 px-2 sm:min-h-8"
                disabled={props.busy}
                onClick={props.assignToMe}
              >
                <UserCheck aria-hidden="true" />
                {t('detail.assignToMe')}
              </Button>
            ) : null}
          </span>
        }
        initial={(): ChosenAssignee[] => task.assignees.map((person) => ({ id: person.id, name: person.name }))}
        unchanged={(draft): boolean =>
          draft.map((chosen) => chosen.id).join(',') === task.assignees.map((person) => person.id).join(',')
        }
        save={(draft): Promise<void> => save({ assigneeIds: draft.map((chosen) => chosen.id) })}
        editor={({ id, draft, setDraft, busy, errorId }): ReactNode => (
          <AssigneePicker
            id={id}
            value={draft}
            onChange={setDraft}
            taskId={task.id}
            disabled={busy}
            {...(errorId ? { ariaDescribedBy: errorId } : {})}
          />
        )}
      />
    </div>
  );
}
