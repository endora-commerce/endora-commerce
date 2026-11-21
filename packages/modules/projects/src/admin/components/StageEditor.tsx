import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  ProjectDetail,
  ProjectRole,
  ProjectStage,
  ProjectStageMove,
  StageTaskDefinition,
  UpdateProjectStageBody,
} from '@endora-commerce/contracts';
import { ApiError, useModulePresence } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  ColorPicker,
  InlineStatus,
  Input,
  Label,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import {
  StatusTransitionGraph,
  useConfirmDialog,
  type StatusTransitionGraphStatus,
  type StatusTransitionGraphTransition,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { calendarDateLabel, errorMessage, parseAlertOffsets, parseDuration } from '../lib/labels.js';
import { stageColorAt } from '../lib/stage-colors.js';
import { StageDot } from './StageDot.js';
import { StageTasksEditor, definitionsOf, draftsOf } from './StageTasksEditor.js';

/** The module whose presence decides whether Stage Task definitions are shown (Principle XVII). */
const TASKS_MODULE = 'tasks';

export interface StageEditorProps {
  project: ProjectDetail;
  onChange: (project: ProjectDetail) => void;
  reload: () => Promise<void>;
}

/** A Stage's attributes as typed — what {@link StageFields} edits. */
export interface StageDraft {
  name: string;
  color: string;
  duration: string;
  responsibleRoleIds: string[];
  alerts: string;
  completionGate: boolean;
  completionPermitted: boolean;
}

/** The attributes a Stage has in a Project and in a Template alike (FR-010). */
export type StageAttributes = Pick<
  ProjectStage,
  | 'name'
  | 'color'
  | 'plannedDurationDays'
  | 'responsibleRoleIds'
  | 'alertOffsetsDays'
  | 'completionGate'
  | 'completionPermitted'
>;

export function draftOf(stage: StageAttributes): StageDraft {
  return {
    name: stage.name,
    color: stage.color,
    duration: String(stage.plannedDurationDays),
    responsibleRoleIds: [...stage.responsibleRoleIds],
    alerts: stage.alertOffsetsDays.join(', '),
    completionGate: stage.completionGate,
    completionPermitted: stage.completionPermitted,
  };
}

const sameSet = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((value) => b.includes(value));

/**
 * The PATCH body for what changed between a Stage and its draft, `null` when a
 * value cannot be sent, or an empty object when nothing changed.
 */
function changesOf(stage: ProjectStage, draft: StageDraft): UpdateProjectStageBody | null {
  const days = parseDuration(draft.duration);
  const alerts = parseAlertOffsets(draft.alerts);
  if (draft.name.trim() === '' || days === null || alerts === null) return null;
  return {
    ...(draft.name.trim() !== stage.name ? { name: draft.name.trim() } : {}),
    ...(draft.color !== stage.color ? { color: draft.color } : {}),
    ...(days !== stage.plannedDurationDays ? { plannedDurationDays: days } : {}),
    ...(!sameSet(draft.responsibleRoleIds, stage.responsibleRoleIds)
      ? { responsibleRoleIds: draft.responsibleRoleIds }
      : {}),
    ...(!sameSet(alerts, stage.alertOffsetsDays) ? { alertOffsetsDays: alerts } : {}),
    ...(draft.completionGate !== stage.completionGate ? { completionGate: draft.completionGate } : {}),
    ...(draft.completionPermitted !== stage.completionPermitted
      ? { completionPermitted: draft.completionPermitted }
      : {}),
  } as UpdateProjectStageBody;
}

/**
 * A Project's Stages and workflow (`specs/163-projects-and-tasks/`, User
 * Story 1; `contracts/admin-surfaces.md` §2, the *Stages* tab).
 *
 * **Every Stage is a row** — what a reader sees, plus *Edit*, the two moves and
 * *Delete* (issue #1523, UX audit WORK-01). *Edit* opens **one** Stage at a
 * time, below its row; opening another over unsaved changes asks first. The
 * open Stage has **one** Save, which writes its attributes
 * (`PATCH /stages/:stageId`) and then its Task definitions
 * (`PUT /stages/:stageId/tasks`, at the version the first write answered) —
 * only what changed, so a Save of an untouched Stage sends nothing. Should
 * the second write fail after the first went through, the Stage stays open
 * with the error beside its Save, and saving again sends what is left.
 *
 * Adding puts a Stage at the end; deleting asks, and refuses the current Stage
 * and a Project's only one, in the server's words. Reordering moves one Stage
 * one place. The result of each write is said beside *Add stage*
 * (`InlineStatus`); an error in the open Stage, beside its Save.
 *
 * **The workflow** is drawn with the kit's `StatusTransitionGraph`, whose
 * From/To form is the keyboard path; every change replaces the whole set
 * (`PUT /moves`) and the answer names the Stages no move reaches from the first,
 * which the editor warns about — a warning, not an error (FR-011).
 *
 * **Stage Task definitions** (User Story 2) are a section of each Stage, shown
 * only while the Tasks module is present: off, they stay stored, untouched and
 * unseen, and come back with it. A Stage whose Tasks could not be created on
 * entry (`tasksMaterializeFailed`) offers to create them again.
 *
 * Every write names the version it was read at (issue #449) — a Stage's edit
 * the Stage's, the others the Project's `configurationVersion` — and a 409
 * re-reads the Project, starting the open Stage again from what it now is.
 *
 * The Template editor (User Story 3) shares its parts — {@link StageFields},
 * {@link StageWorkflow} and `StageTasksEditor` — and saves the whole Template
 * at once.
 */
export function StageEditor(props: StageEditorProps): ReactNode {
  const { project, onChange, reload } = props;
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const canWrite = project.permissions.canWrite;
  const tasksPresent = useModulePresence().isPresent(TASKS_MODULE);
  const [roles, setRoles] = useState<ProjectRole[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useInlineStatus();
  const { confirm, confirmDialog } = useConfirmDialog();
  /** The one Stage open for editing, and what went wrong saving it. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  /** Bumped to start the open Stage again from the Project as re-read (a 409). */
  const [editGeneration, setEditGeneration] = useState(0);
  const editingDirty = useRef(false);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const focusAfterClose = useRef<string | null>(null);

  // Every Role, archived ones too: a Stage still names the ones it uses.
  useEffect(() => {
    let alive = true;
    projectsApi
      .listRoles()
      .then((loaded) => {
        if (alive) setRoles(loaded);
      })
      .catch(() => {
        if (alive) setRoles([]);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  // A closed Stage gives focus back to its Edit (WCAG 2.4.3).
  useEffect(() => {
    const id = focusAfterClose.current;
    if (editingId !== null || id === null) return;
    focusAfterClose.current = null;
    editButtons.current.get(id)?.focus();
  }, [editingId]);

  const stages = useMemo(() => [...project.stages].sort((a, b) => a.position - b.position), [project.stages]);

  const close = (stageId: string): void => {
    focusAfterClose.current = stageId;
    editingDirty.current = false;
    setEditError(null);
    setEditingId(null);
  };

  /** Open `stage`, closing the open one — after asking, when it holds unsaved changes. */
  const toggle = async (stage: ProjectStage): Promise<void> => {
    if (editingId !== null && editingDirty.current) {
      const openPosition = stages.findIndex((candidate) => candidate.id === editingId) + 1;
      const discard = await confirm({
        title: t('editor.discard.title'),
        message: t('editor.discard.message', { position: openPosition }),
        confirmLabel: t('editor.discard.confirm'),
        destructive: true,
      });
      if (!discard) return;
    }
    if (editingId === stage.id) {
      close(stage.id);
      return;
    }
    editingDirty.current = false;
    setEditError(null);
    setError(null);
    status.clear();
    setEditingId(stage.id);
  };

  /**
   * Run one write outside the open Stage: on success say so beside *Add stage*,
   * on failure show the server's sentence — and re-read on a 409.
   */
  const run = async (write: () => Promise<void>, done: () => string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    status.clear();
    try {
      await write();
      status.show(done());
      return true;
    } catch (failure) {
      setError(errorMessage(failure, t('editor.error')));
      if (failure instanceof ApiError && failure.status === 409) void reload();
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** The open Stage's one Save: its attributes, then its Task definitions — what changed of each. */
  const saveEdit = async (
    stage: ProjectStage,
    body: UpdateProjectStageBody | null,
    tasks: StageTaskDefinition[] | null,
  ): Promise<void> => {
    setBusy(true);
    setEditError(null);
    setError(null);
    status.clear();
    let wrote = false;
    try {
      let version = stage.version;
      if (body !== null) {
        version = (await projectsApi.updateStage(project.id, stage.id, { ...body, version })).version;
        wrote = true;
      }
      if (tasks !== null) await projectsApi.setStageTasks(project.id, stage.id, tasks, version);
      await reload();
      close(stage.id);
      status.show(t('editor.saved'));
    } catch (failure) {
      setEditError(errorMessage(failure, t('editor.error')));
      if (failure instanceof ApiError && failure.status === 409) {
        await reload();
        setEditGeneration((generation) => generation + 1);
      } else if (wrote) {
        // The attributes went through: what is left to send is counted from them.
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const retryStageTasks = (stage: ProjectStage): Promise<boolean> => {
    let created = 0;
    return run(
      async () => {
        created = (await projectsApi.retryStageTasks(project.id, stage.id)).created;
        await reload();
      },
      () => t('editor.retry.done', { count: created }),
    );
  };

  const deleteStage = async (stage: ProjectStage, position: number): Promise<void> => {
    status.clear();
    const deleted = await confirm({
      title: t('editor.delete', { position }),
      message: t('editor.deleteConfirm', { name: stage.name }),
      confirmLabel: tCore('common.action.delete'),
      destructive: true,
      action: () => projectsApi.deleteStage(project.id, stage.id),
      describeError: (failure) => errorMessage(failure, t('editor.error')),
      returnFocusTo: addButton,
    });
    if (!deleted) return;
    if (editingId === stage.id) {
      editingDirty.current = false;
      setEditingId(null);
    }
    await reload();
    status.show(t('editor.deleted'));
  };

  const addStage = (): Promise<boolean> =>
    run(async () => {
      await projectsApi.createStage(project.id, {
        name: t('editor.newStage'),
        color: stageColorAt(stages.length),
        configurationVersion: project.configurationVersion,
      });
      await reload();
    }, () => t('editor.added'));

  const moveStage = (index: number, by: -1 | 1): Promise<boolean> => {
    const ids = stages.map((stage) => stage.id);
    const target = index + by;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    return run(
      async () => onChange(await projectsApi.reorderStages(project.id, ids, project.configurationVersion)),
      () => t('editor.reordered'),
    );
  };

  const setMoves = (moves: ProjectStageMove[]): Promise<boolean> =>
    run(async () => {
      const result = await projectsApi.setMoves(project.id, moves, project.configurationVersion);
      onChange({
        ...project,
        moves: result.moves,
        unreachableStageIds: result.unreachableStageIds,
        configurationVersion: result.configurationVersion,
      });
    }, () => t('editor.movesSaved'));

  return (
    <div className="space-y-6">
      {/* One rule between stages, not a box around each: a frame inside the tab's card is a
          defect unless it is a field (issue #1437, WORK-01). */}
      <ol className="divide-y divide-border">
        {stages.map((stage, index) => (
          <li key={stage.id} className="py-4 first:pt-0 last:pb-0">
            <StageRow
              stage={stage}
              position={index + 1}
              isCurrent={stage.id === project.currentStage?.id}
              isFirst={index === 0}
              isLast={index === stages.length - 1}
              roles={roles}
              canWrite={canWrite}
              tasksPresent={tasksPresent}
              busy={busy}
              editing={editingId === stage.id}
              editGeneration={editGeneration}
              editError={editingId === stage.id ? editError : null}
              editButtonRef={(element): void => {
                if (element) editButtons.current.set(stage.id, element);
                else editButtons.current.delete(stage.id);
              }}
              onToggle={(): void => void toggle(stage)}
              onDirtyChange={(dirty): void => {
                if (editingId === stage.id) editingDirty.current = dirty;
              }}
              onSave={(body, tasks): Promise<void> => saveEdit(stage, body, tasks)}
              onCancel={(): void => close(stage.id)}
              onRetryTasks={(): Promise<boolean> => retryStageTasks(stage)}
              onDelete={(): void => void deleteStage(stage, index + 1)}
              onMove={(by): Promise<boolean> => moveStage(index, by)}
            />
          </li>
        ))}
      </ol>

      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            ref={addButton}
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-9"
            disabled={busy || stages.length >= 50}
            onClick={(): void => void addStage()}
          >
            <Plus aria-hidden="true" />
            {t('editor.add')}
          </Button>
          <InlineStatus {...status.props} />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <StageWorkflow
        stages={stages}
        moves={project.moves}
        unreachableStageIds={project.unreachableStageIds}
        canWrite={canWrite}
        onSetMoves={(moves): void => void setMoves(moves)}
      />
      {confirmDialog}
    </div>
  );
}

interface StageRowProps {
  stage: ProjectStage;
  position: number;
  isCurrent: boolean;
  isFirst: boolean;
  isLast: boolean;
  roles: readonly ProjectRole[];
  canWrite: boolean;
  /** The Tasks module is present: the Stage's Task definitions are shown. */
  tasksPresent: boolean;
  busy: boolean;
  /** This Stage is the one open for editing. */
  editing: boolean;
  editGeneration: number;
  editError: string | null;
  editButtonRef: (element: HTMLButtonElement | null) => void;
  onToggle: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Save what changed: the attributes (`null`: none) and the whole Task list (`null`: unchanged). */
  onSave: (body: UpdateProjectStageBody | null, tasks: StageTaskDefinition[] | null) => Promise<void>;
  onCancel: () => void;
  /** Create the Stage's Tasks again after creating them failed (`tasksMaterializeFailed`). */
  onRetryTasks: () => Promise<boolean>;
  onDelete: () => void;
  onMove: (by: -1 | 1) => Promise<boolean>;
}

/** One Stage: the row a reader sees, with its actions for a writer, and below it the open editor. */
function StageRow(props: StageRowProps): ReactNode {
  const { stage, position, roles, canWrite, busy, editing } = props;
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const editorId = `project-stage-${stage.id}-editor`;

  const roleLabel = (roleId: string): string => roles.find((role) => role.id === roleId)?.label ?? roleId;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true" className="font-medium tabular-nums text-muted-foreground">
              {position}.
            </span>
            <StageDot color={stage.color} />
            <span className="font-medium [overflow-wrap:anywhere]">{stage.name}</span>
            {props.isCurrent ? <span className="text-xs text-muted-foreground">({t('editor.current')})</span> : null}
          </div>
          {editing ? null : (
            <>
              <p className="text-muted-foreground">
                {stage.plannedDurationDays} {t('stage.durationShort').toLowerCase()}
                {stage.responsibleRoleIds.length > 0 ? ` · ${stage.responsibleRoleIds.map(roleLabel).join(', ')}` : ''}
                {stage.completionGate ? ` · ${t('editor.gate')}` : ''}
              </p>
              {stage.completionPermitted ? <p className="text-muted-foreground">{t('editor.completionPermitted')}</p> : null}
            </>
          )}
          {stage.deadlineOn ? (
            <p className="text-xs text-muted-foreground">
              {t(stage.deadlineManual ? 'editor.deadlineManual' : 'editor.deadline', {
                date: calendarDateLabel(stage.deadlineOn, language),
              })}
            </p>
          ) : null}
        </div>
        {canWrite ? (
          <div className="flex items-center gap-1">
            <Button
              ref={props.editButtonRef}
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              aria-label={t('editor.edit', { position })}
              aria-expanded={editing}
              {...(editing ? { 'aria-controls': editorId } : {})}
              disabled={busy}
              onClick={props.onToggle}
            >
              <Pencil aria-hidden="true" />
              {tCore('common.action.edit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
              aria-label={t('stage.moveUp', { position })}
              disabled={busy || props.isFirst}
              onClick={(): void => void props.onMove(-1)}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
              aria-label={t('stage.moveDown', { position })}
              disabled={busy || props.isLast}
              onClick={(): void => void props.onMove(1)}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-2 min-h-11 min-w-11 text-destructive hover:text-destructive sm:min-h-9 sm:min-w-9"
              aria-label={t('editor.delete', { position })}
              disabled={busy}
              onClick={props.onDelete}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>

      {canWrite && props.tasksPresent && stage.tasksMaterializeFailed ? (
        <Alert variant="destructive">
          <AlertTitle>{t('editor.retry.title')}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t('editor.retry.body', { position })}</p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              aria-label={t('editor.retry.actionFor', { position })}
              disabled={busy}
              onClick={(): void => void props.onRetryTasks()}
            >
              {t('editor.retry.action')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {editing ? (
        <StageEditForm
          key={props.editGeneration}
          id={editorId}
          stage={stage}
          position={position}
          roles={roles}
          tasksPresent={props.tasksPresent}
          busy={busy}
          error={props.editError}
          onDirtyChange={props.onDirtyChange}
          onSave={props.onSave}
          onCancel={props.onCancel}
        />
      ) : props.tasksPresent ? (
        <StageTasksEditor stage={stage} position={position} roles={roles} canWrite={false} busy={busy} />
      ) : null}
    </div>
  );
}

interface StageEditFormProps {
  id: string;
  stage: ProjectStage;
  position: number;
  roles: readonly ProjectRole[];
  tasksPresent: boolean;
  busy: boolean;
  error: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onSave: StageRowProps['onSave'];
  onCancel: () => void;
}

/**
 * The open Stage: its attributes, its hand-set deadline and its Task
 * definitions, with one Save for all of them (issue #1523). The drafts are
 * compared with the Stage as last read, so after a write that went through in
 * part only what is left is sent again.
 */
function StageEditForm(props: StageEditFormProps): ReactNode {
  const { stage, position, roles, busy } = props;
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const idPrefix = `project-stage-${stage.id}`;
  const [draft, setDraft] = useState<StageDraft>(() => draftOf(stage));
  const [invalid, setInvalid] = useState(false);
  /** The deadline set by hand, as typed — empty for one counted from the start (FR-013). */
  const manualDeadline = stage.deadlineManual ? (stage.deadlineOn ?? '') : '';
  const [deadlineDraft, setDeadlineDraft] = useState(manualDeadline);
  /** The Task list as edited: `undefined` untouched, `null` while one cannot be sent. */
  const [tasksDraft, setTasksDraft] = useState<StageTaskDefinition[] | null | undefined>(undefined);

  const body = changesOf(stage, draft);
  const deadlinePatch: UpdateProjectStageBody =
    deadlineDraft !== manualDeadline ? { deadlineOn: deadlineDraft === '' ? null : deadlineDraft } : {};
  const tasksChanged =
    tasksDraft !== undefined &&
    (tasksDraft === null || JSON.stringify(tasksDraft) !== JSON.stringify(definitionsOf(draftsOf(stage))));
  const dirty = body === null || Object.keys(body).length > 0 || Object.keys(deadlinePatch).length > 0 || tasksChanged;

  const { onDirtyChange } = props;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // Opened: the first field takes focus.
  useEffect(() => {
    document.getElementById(`${idPrefix}-name`)?.focus();
  }, [idPrefix]);

  const change = (patch: Partial<StageDraft>): void => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setInvalid(false);
  };

  const save = (): void => {
    if (body === null || tasksDraft === null) {
      setInvalid(true);
      return;
    }
    const stageBody = { ...body, ...deadlinePatch } as UpdateProjectStageBody;
    const stageChanged = Object.keys(stageBody).length > 0;
    if (!stageChanged && !tasksChanged) {
      props.onCancel();
      return;
    }
    void props.onSave(stageChanged ? stageBody : null, tasksChanged && tasksDraft ? tasksDraft : null);
  };

  return (
    <div id={props.id} className="space-y-3">
      <StageFields
        idPrefix={idPrefix}
        position={position}
        draft={draft}
        onChange={change}
        roles={roles}
        heldRoleIds={stage.responsibleRoleIds}
        invalid={invalid}
      />

      <div className="max-w-xs space-y-1">
        <Label htmlFor={`${idPrefix}-deadline`} className="text-xs text-muted-foreground">
          {t('editor.deadlineField', { position })}
        </Label>
        <Input
          id={`${idPrefix}-deadline`}
          type="date"
          className="min-h-11 sm:min-h-9"
          value={deadlineDraft}
          aria-describedby={`${idPrefix}-deadline-hint`}
          onChange={(event): void => setDeadlineDraft(event.target.value)}
        />
        <p id={`${idPrefix}-deadline-hint`} className="text-xs text-muted-foreground">
          {t('editor.deadlineFieldHint')}
        </p>
      </div>

      {invalid && (draft.name.trim() === '' || parseDuration(draft.duration) === null) ? (
        <p className="text-xs text-destructive">
          {draft.name.trim() === '' ? t('create.error.stageName') : t('create.error.stageDuration')}
        </p>
      ) : null}

      {props.tasksPresent ? (
        <StageTasksEditor
          stage={stage}
          position={position}
          roles={roles}
          canWrite
          busy={busy}
          showErrors={invalid && tasksDraft === null}
          onChange={(tasks): void => {
            setTasksDraft(tasks);
            setInvalid(false);
          }}
        />
      ) : null}

      {props.error ? (
        <Alert variant="destructive">
          <AlertDescription>{props.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={props.onCancel}>
          {tCore('common.action.cancel')}
        </Button>
        <Button
          type="button"
          className="min-h-11 sm:min-h-9"
          aria-label={t('editor.save', { position })}
          aria-busy={busy}
          disabled={busy}
          onClick={save}
        >
          {tCore('common.action.save')}
        </Button>
      </div>
    </div>
  );
}

export interface StageFieldsProps {
  /** Prefix of the ids of the fields, unique on the page. */
  idPrefix: string;
  /** The Stage's 1-based place, for the labels. */
  position: number;
  draft: StageDraft;
  onChange: (patch: Partial<StageDraft>) => void;
  /** Every Role, archived ones too. */
  roles: readonly ProjectRole[];
  /** The Roles the Stage named when it was read: an archived one among them is still offered. */
  heldRoleIds: readonly string[];
  /** Show which values cannot be sent. */
  invalid: boolean;
}

/**
 * A Stage's attributes as fields (FR-010) — name, colour, planned days, alert
 * offsets, responsible Roles, completion permitted and the completion gate.
 * Controlled: the Project's Stages tab saves the one open Stage, the Template
 * editor the whole Template at once.
 */
export function StageFields(props: StageFieldsProps): ReactNode {
  const { idPrefix, position, draft, onChange, roles, invalid } = props;
  const t = useTranslation('projects');
  // The Roles a Stage may name: the active ones, plus any archived one it already names.
  const offered = roles.filter((role) => role.archivedAt === null || props.heldRoleIds.includes(role.id));
  const alertsInvalid = invalid && parseAlertOffsets(draft.alerts) === null;
  return (
    <>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor={`${idPrefix}-name`} className="text-xs text-muted-foreground">
              <span aria-hidden="true">{t('stage.nameShort')}</span>
            </Label>
            <Input
              id={`${idPrefix}-name`}
              aria-label={t('stage.name', { position })}
              value={draft.name}
              maxLength={80}
              aria-invalid={invalid && draft.name.trim() === ''}
              onChange={(event): void => onChange({ name: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <span aria-hidden="true" className="block text-xs text-muted-foreground">
              {t('stage.colorShort')}
            </span>
            <ColorPicker
              value={draft.color}
              onChange={(color): void => onChange({ color })}
              label={t('stage.color', { position })}
              customLabel={t('stage.colorCustom', { position })}
            />
          </div>
          <div className="w-24 space-y-1">
            <Label htmlFor={`${idPrefix}-days`} className="text-xs text-muted-foreground">
              <span aria-hidden="true">{t('stage.durationShort')}</span>
            </Label>
            <Input
              id={`${idPrefix}-days`}
              aria-label={t('stage.duration', { position })}
              inputMode="numeric"
              value={draft.duration}
              aria-invalid={invalid && parseDuration(draft.duration) === null}
              onChange={(event): void => onChange({ duration: event.target.value })}
            />
          </div>
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor={`${idPrefix}-alerts`} className="text-xs text-muted-foreground">
              {t('editor.alerts', { position })}
            </Label>
            <Input
              id={`${idPrefix}-alerts`}
              value={draft.alerts}
              inputMode="numeric"
              placeholder="7, 1"
              aria-invalid={alertsInvalid}
              aria-describedby={`${idPrefix}-alerts-hint`}
              onChange={(event): void => onChange({ alerts: event.target.value })}
            />
          </div>
        </div>
        <p id={`${idPrefix}-alerts-hint`} className={alertsInvalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {alertsInvalid ? t('editor.alertsInvalid') : t('editor.alertsHint')}
        </p>

        {offered.length > 0 ? (
          <fieldset>
            <legend className="text-xs text-muted-foreground">{t('editor.responsibleRoles', { position })}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {offered.map((role) => {
                const id = `${idPrefix}-role-${role.id}`;
                return (
                  <label key={role.id} htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                    <Checkbox
                      id={id}
                      checked={draft.responsibleRoleIds.includes(role.id)}
                      onChange={(event): void =>
                        onChange({
                          responsibleRoleIds: event.target.checked
                            ? [...draft.responsibleRoleIds, role.id]
                            : draft.responsibleRoleIds.filter((roleId) => roleId !== role.id),
                        })
                      }
                    />
                    {role.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-completion`} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
            <Checkbox
              id={`${idPrefix}-completion`}
              checked={draft.completionPermitted}
              onChange={(event): void => onChange({ completionPermitted: event.target.checked })}
            />
            {t('editor.completionPermitted')}
          </label>
          <label htmlFor={`${idPrefix}-gate`} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
            <Checkbox
              id={`${idPrefix}-gate`}
              checked={draft.completionGate}
              aria-describedby={`${idPrefix}-gate-hint`}
              onChange={(event): void => onChange({ completionGate: event.target.checked })}
            />
            {t('editor.gate')}
          </label>
          <p id={`${idPrefix}-gate-hint`} className="text-xs text-muted-foreground">
            {t('editor.gateHint')}
          </p>
        </div>
    </>
  );
}

export interface StageWorkflowProps {
  /** The Stages, in order; `id` is whatever the moves name them by. */
  stages: ReadonlyArray<{ id: string; name: string; color: string; position: number }>;
  moves: readonly ProjectStageMove[];
  /** Stages no permitted move reaches from the first — warned about, not refused (FR-011). */
  unreachableStageIds: readonly string[];
  canWrite: boolean;
  /** The whole set of moves after an edit. */
  onSetMoves: (moves: ProjectStageMove[]) => void;
}

/**
 * The permitted moves between Stages, drawn with the kit's
 * `StatusTransitionGraph` — whose From/To form is the keyboard path — and the
 * Stages no move reaches from the first. A reader sees the moves as a list.
 */
export function StageWorkflow(props: StageWorkflowProps): ReactNode {
  const { stages, moves, canWrite } = props;
  const t = useTranslation('projects');
  const nameOf = useCallback(
    (stageId: string): string => stages.find((stage) => stage.id === stageId)?.name ?? stageId,
    [stages],
  );
  const graphStatuses = useMemo<StatusTransitionGraphStatus[]>(
    () =>
      stages.map((stage, index) => ({
        code: stage.id,
        name: {},
        defaultName: stage.name,
        isInitial: index === 0,
        isTerminal: false,
        isSystem: false,
        weight: stage.position,
        color: stage.color,
        inUseCount: 0,
      })),
    [stages],
  );
  const graphTransitions = useMemo<StatusTransitionGraphTransition[]>(
    () => moves.map((move) => ({ fromStatusCode: move.fromStageId, toStatusCode: move.toStageId, isSystem: false })),
    [moves],
  );
  const statusLabel = useCallback((status: StatusTransitionGraphStatus): string => status.defaultName, []);
  const unreachable = props.unreachableStageIds.map(nameOf);

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">{t('editor.moves')}</h3>
      {unreachable.length > 0 ? (
        <Alert>
          <AlertDescription>{t('editor.unreachable', { stages: unreachable.join(', ') })}</AlertDescription>
        </Alert>
      ) : null}
      {canWrite ? (
        <StatusTransitionGraph
          statuses={graphStatuses}
          transitions={graphTransitions}
          statusLabel={statusLabel}
          onAdd={(from, to): void => {
            if (moves.some((move) => move.fromStageId === from && move.toStageId === to)) return;
            props.onSetMoves([...moves, { fromStageId: from, toStageId: to }]);
          }}
          onRemove={(from, to): void =>
            props.onSetMoves(moves.filter((move) => !(move.fromStageId === from && move.toStageId === to)))
          }
        />
      ) : moves.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('editor.noMoves')}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {moves.map((move) => (
            <li key={`${move.fromStageId}:${move.toStageId}`}>
              {t('editor.move', { from: nameOf(move.fromStageId), to: nameOf(move.toStageId) })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The Stages no permitted move reaches from the first (FR-011) — the editor's
 * warning, worked out where the server is not asked (a Template being edited).
 */
export function unreachableFrom(stageIds: readonly string[], moves: readonly ProjectStageMove[]): string[] {
  const [first] = stageIds;
  if (first === undefined) return [];
  const reached = new Set([first]);
  const queue = [first];
  while (queue.length > 0) {
    const from = queue.shift() as string;
    for (const move of moves) {
      if (move.fromStageId === from && !reached.has(move.toStageId)) {
        reached.add(move.toStageId);
        queue.push(move.toStageId);
      }
    }
  }
  return stageIds.filter((id) => !reached.has(id));
}
