import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  PROJECT_STAGE_TASKS_MAX,
  type ProjectRole,
  type ProjectStage,
  type StageTaskDefinition,
} from '@endora-commerce/contracts';
import { Button, Input, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { parseDuration } from '../lib/labels.js';

export interface StageTasksEditorProps {
  /** The Stage whose definitions are edited — a Project's, or a Template's. */
  stage: Pick<ProjectStage, 'stageTasks'>;
  /** The Stage's 1-based place, for the labels. */
  position: number;
  /** Every Role, archived ones too: a definition still names the one it uses. */
  roles: readonly ProjectRole[];
  canWrite: boolean;
  busy: boolean;
  /**
   * Every change hands the whole list over — `null` while one of them cannot
   * be sent. There is no Save here: whoever holds the list saves it with the
   * rest of the Stage (issue #1523) or of the Template.
   */
  onChange?: (tasks: StageTaskDefinition[] | null) => void;
  /** Show which definitions cannot be sent (after a refused save). */
  showErrors?: boolean;
}

interface Draft {
  key: string;
  title: string;
  dueOffset: string;
  responsibleRoleId: string;
  /** Kept as it was — a Template may have written one; this editor does not edit it. */
  description: string | undefined;
}

export function draftsOf(stage: Pick<ProjectStage, 'stageTasks'>): Draft[] {
  return [...stage.stageTasks]
    .sort((a, b) => a.position - b.position)
    .map((task) => ({
      key: task.id,
      title: task.title,
      dueOffset: String(task.dueOffsetDays),
      responsibleRoleId: task.responsibleRoleId ?? '',
      description: task.description,
    }));
}

/** The definitions to send, or `null` when one of them cannot be sent. */
export function definitionsOf(drafts: readonly Draft[]): StageTaskDefinition[] | null {
  const definitions: StageTaskDefinition[] = [];
  for (const draft of drafts) {
    const days = parseDuration(draft.dueOffset);
    if (draft.title.trim() === '' || days === null) return null;
    definitions.push({
      title: draft.title.trim(),
      ...(draft.description ? { description: draft.description } : {}),
      dueOffsetDays: days,
      ...(draft.responsibleRoleId ? { responsibleRoleId: draft.responsibleRoleId } : {}),
    });
  }
  return definitions;
}

let nextKey = 0;

/**
 * The Tasks a Stage creates when the Project enters it
 * (`specs/163-projects-and-tasks/`, User Story 2; research R-7, R-8).
 *
 * Each definition is a title, the number of days after the Stage starts that
 * the Task is due, and optionally the Role responsible for it — a single
 * active Member holding that Role is assigned the Task. The list is saved whole
 * (`PUT /stages/:stageId/tasks`, at most {@link PROJECT_STAGE_TASKS_MAX}). A
 * reader sees the list as text.
 *
 * The Stages editor renders this only while the Tasks module is present, and
 * saves the list with the Stage's one Save (issue #1523); the Template editor
 * saves it with the Template.
 */
export function StageTasksEditor(props: StageTasksEditorProps): ReactNode {
  const { stage, position, roles, canWrite, busy } = props;
  const t = useTranslation('projects');
  const hintId = useId();
  const [drafts, setDrafts] = useState<Draft[]>(() => draftsOf(stage));
  const invalid = props.showErrors === true;
  const liveRef = useRef(props.onChange);
  liveRef.current = props.onChange;
  const first = useRef(true);

  // Live editing: hand every change over; the first render changed nothing.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    liveRef.current?.(definitionsOf(drafts));
  }, [drafts]);

  const roleLabel = (roleId: string | null | undefined): string | null =>
    roleId ? (roles.find((role) => role.id === roleId)?.label ?? null) : null;

  if (!canWrite) {
    if (stage.stageTasks.length === 0) return null;
    return (
      <div className="space-y-1 border-t pt-2">
        <p className="text-xs font-medium text-muted-foreground">{t('stageTasks.heading', { position })}</p>
        <ul className="space-y-0.5">
          {[...stage.stageTasks]
            .sort((a, b) => a.position - b.position)
            .map((task) => {
              const role = roleLabel(task.responsibleRoleId);
              return (
                <li key={task.id} className="[overflow-wrap:anywhere]">
                  {role
                    ? t('stageTasks.itemRole', { title: task.title, days: task.dueOffsetDays, role })
                    : t('stageTasks.item', { title: task.title, days: task.dueOffsetDays })}
                </li>
              );
            })}
        </ul>
      </div>
    );
  }

  const change = (key: string, patch: Partial<Draft>): void => {
    setDrafts((previous) => previous.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };

  return (
    <fieldset className="space-y-3 border-t pt-3" aria-describedby={hintId}>
      <legend className="text-sm font-medium">{t('stageTasks.heading', { position })}</legend>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('stageTasks.hint')}
      </p>

      {drafts.length === 0 ? <p className="text-sm text-muted-foreground">{t('stageTasks.empty')}</p> : null}

      <ol className="space-y-2">
        {drafts.map((draft, index) => {
          const number = index + 1;
          // The Roles a definition may name: the active ones, plus an archived one it already names.
          const offered = roles.filter((role) => role.archivedAt === null || role.id === draft.responsibleRoleId);
          return (
            <li key={draft.key} className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1 space-y-1">
                <span aria-hidden="true" className="block text-xs text-muted-foreground">
                  {t('stageTasks.titleShort')}
                </span>
                <Input
                  aria-label={t('stageTasks.title', { index: number, position })}
                  value={draft.title}
                  maxLength={200}
                  aria-invalid={invalid && draft.title.trim() === ''}
                  onChange={(event): void => change(draft.key, { title: event.target.value })}
                />
              </div>
              <div className="w-28 space-y-1">
                <span aria-hidden="true" className="block text-xs text-muted-foreground">
                  {t('stageTasks.offsetShort')}
                </span>
                <Input
                  aria-label={t('stageTasks.offset', { index: number, position })}
                  inputMode="numeric"
                  value={draft.dueOffset}
                  aria-invalid={invalid && parseDuration(draft.dueOffset) === null}
                  onChange={(event): void => change(draft.key, { dueOffset: event.target.value })}
                />
              </div>
              <div className="min-w-40 space-y-1">
                <span aria-hidden="true" className="block text-xs text-muted-foreground">
                  {t('stageTasks.roleShort')}
                </span>
                <Select
                  aria-label={t('stageTasks.role', { index: number, position })}
                  value={draft.responsibleRoleId}
                  onChange={(event): void => change(draft.key, { responsibleRoleId: event.target.value })}
                >
                  <option value="">{t('stageTasks.roleNone')}</option>
                  {offered.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                aria-label={t('stageTasks.remove', { index: number, position })}
                disabled={busy}
                onClick={(): void => setDrafts((previous) => previous.filter((candidate) => candidate.key !== draft.key))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ol>

      {invalid ? <p className="text-xs text-destructive">{t('stageTasks.invalid')}</p> : null}

      <Button
        type="button"
        variant="outline"
        className="min-h-11 sm:min-h-9"
        disabled={busy || drafts.length >= PROJECT_STAGE_TASKS_MAX}
        onClick={(): void =>
          setDrafts((previous) => [
            ...previous,
            { key: `new-${++nextKey}`, title: '', dueOffset: '0', responsibleRoleId: '', description: undefined },
          ])
        }
      >
        <Plus aria-hidden="true" />
        {t('stageTasks.add')}
      </Button>
    </fieldset>
  );
}
