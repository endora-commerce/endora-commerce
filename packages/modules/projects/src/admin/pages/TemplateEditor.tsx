import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import {
  PROJECT_STAGES_MAX,
  type ProjectRole,
  type ProjectStage,
  type ProjectStageMove,
  type ProjectTemplateBody,
  type ProjectTemplateDetail,
  type StageTaskDefinition,
} from '@endora-commerce/contracts';
import { useModulePresence, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
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
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { StickyFormActions, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import {
  StageFields,
  StageWorkflow,
  draftOf,
  unreachableFrom,
  type StageDraft,
} from '../components/StageEditor.js';
import { StageDot } from '../components/StageDot.js';
import { StageTasksEditor } from '../components/StageTasksEditor.js';
import { errorMessage, parseAlertOffsets, parseDuration } from '../lib/labels.js';
import { stageColorAt } from '../lib/stage-colors.js';

const LIST_PATH = '/projects/templates';

/** The module whose presence decides whether Stage Task definitions are shown (Principle XVII). */
const TASKS_MODULE = 'tasks';

/** One Stage of the Template being edited. */
interface StageRow {
  /** The Stage's id once saved, otherwise a label of the editor's; what moves name it by. */
  key: string;
  draft: StageDraft;
  /** The Stage's Task definitions — `null` while one of them cannot be sent. */
  tasks: StageTaskDefinition[] | null;
  /** What the Task definitions editor starts from. */
  initialTasks: ProjectStage['stageTasks'];
  /** The Roles the Stage named when read: an archived one among them is still offered. */
  heldRoleIds: string[];
}

interface Graph {
  name: string;
  description: string;
  roleIds: string[];
  stages: StageRow[];
  moves: ProjectStageMove[];
  archivedAt: string | null;
}

let nextKey = 0;
const newKey = (): string => `new-${++nextKey}`;

function emptyStage(index: number): StageRow {
  return {
    key: newKey(),
    draft: {
      name: '',
      color: stageColorAt(index),
      duration: '0',
      responsibleRoleIds: [],
      alerts: '',
      completionGate: false,
      completionPermitted: false,
    },
    tasks: [],
    initialTasks: [],
    heldRoleIds: [],
  };
}

/** A definition as the body takes it — empty parts left out, as the Task definitions editor sends them. */
function definitionOf(task: StageTaskDefinition): StageTaskDefinition {
  return {
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    dueOffsetDays: task.dueOffsetDays,
    ...(task.responsibleRoleId ? { responsibleRoleId: task.responsibleRoleId } : {}),
  };
}

function graphOf(template: ProjectTemplateDetail): Graph {
  return {
    name: template.name,
    description: template.description,
    roleIds: [...template.roleIds],
    stages: [...template.stages]
      .sort((a, b) => a.position - b.position)
      .map((stage) => ({
        key: stage.id,
        draft: draftOf(stage),
        tasks: stage.tasks.map(definitionOf),
        initialTasks: stage.tasks,
        heldRoleIds: [...stage.responsibleRoleIds],
      })),
    moves: [...template.moves],
    archivedAt: template.archivedAt,
  };
}

/**
 * What a save would send, as one string — the editor's own keys and drafts,
 * not the archive flag, which is its own request. Equal fingerprints are an
 * editor with nothing unsaved.
 */
function fingerprintOf(graph: Graph): string {
  return JSON.stringify({
    name: graph.name,
    description: graph.description,
    roleIds: graph.roleIds,
    stages: graph.stages.map((row) => ({ key: row.key, draft: row.draft, tasks: row.tasks })),
    moves: graph.moves,
  });
}

const NEW_GRAPH = (): Graph => ({
  name: '',
  description: '',
  roleIds: [],
  stages: [emptyStage(0)],
  moves: [],
  archivedAt: null,
});

/**
 * A Project Template, created or edited (`specs/163-projects-and-tasks/`,
 * User Story 3; `contracts/admin-surfaces.md` §2, `/projects/templates/:id`).
 *
 * The same Stage fields, Stage Task definitions and workflow graph as a
 * Project's *Stages* tab (`StageEditor.tsx`'s {@link StageFields} and
 * {@link StageWorkflow}, and `StageTasksEditor`), but held here and **saved
 * together** — one `POST` for a new Template, one `PUT` replacing the whole
 * graph for an existing one — because a Template has no running state a
 * half-saved edit could disturb, and its moves may name a Stage that has no id
 * yet. A Template holds structure only: no Organization, Member, value or link.
 *
 * Stage Task definitions are shown only while the Tasks module is present; off,
 * they are kept as loaded and saved back unchanged. Archiving takes the
 * Template out of the create screen's picker and changes no Project; a
 * duplicate is a new, independent Template.
 *
 * **Unsaved edits are not lost without a question** (issue #452). The editor
 * holds the Template as last loaded or saved beside the one on screen; while
 * they differ, the kit's unsaved-changes prompt guards leaving through a link
 * or the browser, *Cancel* asks in the kit's dialog, and *Duplicate* — which
 * copies the saved Template, never the screen — says so and asks first.
 */
export function TemplateEditor(): ReactNode {
  const { id } = useParams<{ id?: string }>();
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const navigate = useNavigate();
  const tasksPresent = useModulePresence().isPresent(TASKS_MODULE);
  const isNew = id === undefined || id === 'new';
  const nameRef = useRef<HTMLInputElement>(null);

  const [graph, setGraph] = useState<Graph | null>(isNew ? NEW_GRAPH() : null);
  /** The Template as last loaded or saved — what "unsaved" is measured against. */
  const [saved, setSaved] = useState<Graph | null>(graph);
  const { confirm, confirmDialog } = useConfirmDialog();
  const [roles, setRoles] = useState<ProjectRole[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // Every Role, archived ones too: the Template still shows the ones it names.
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

  /** Show `next` as the Template's saved state: nothing on screen is unsaved. */
  const reset = useCallback((next: Graph): void => {
    setGraph(next);
    setSaved(next);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (isNew || id === undefined) return;
    setLoadError(null);
    try {
      reset(graphOf(await projectsApi.getTemplate(id)));
    } catch (failure) {
      setLoadError(errorMessage(failure, t('templates.editor.loadError')));
    }
  }, [id, isNew, reset, t]);

  useEffect(() => {
    if (isNew) reset(NEW_GRAPH());
    else void load();
  }, [isNew, load, reset]);

  const dirty = useMemo(
    () => graph !== null && saved !== null && fingerprintOf(graph) !== fingerprintOf(saved),
    [graph, saved],
  );
  useUnsavedChangesPrompt(dirty);

  const update = (patch: Partial<Graph>): void => setGraph((previous) => (previous ? { ...previous, ...patch } : previous));

  const updateStage = (key: string, patch: Partial<StageRow>): void =>
    setGraph((previous) =>
      previous
        ? { ...previous, stages: previous.stages.map((row) => (row.key === key ? { ...row, ...patch } : row)) }
        : previous,
    );

  const addStage = (): void =>
    setGraph((previous) => {
      if (!previous) return previous;
      const added = emptyStage(previous.stages.length);
      const last = previous.stages[previous.stages.length - 1];
      return {
        ...previous,
        stages: [...previous.stages, added],
        // A Stage added at the end is reached from the one that was last, as on a Project (FR-011).
        moves: last ? [...previous.moves, { fromStageId: last.key, toStageId: added.key }] : previous.moves,
      };
    });

  const removeStage = (key: string): void =>
    setGraph((previous) =>
      previous
        ? {
            ...previous,
            stages: previous.stages.filter((row) => row.key !== key),
            moves: previous.moves.filter((move) => move.fromStageId !== key && move.toStageId !== key),
          }
        : previous,
    );

  const moveStage = (index: number, by: -1 | 1): void =>
    setGraph((previous) => {
      if (!previous) return previous;
      const target = index + by;
      if (target < 0 || target >= previous.stages.length) return previous;
      const stages = [...previous.stages];
      [stages[index], stages[target]] = [stages[target] as StageRow, stages[index] as StageRow];
      return { ...previous, stages };
    });

  const workflowStages = useMemo(
    () =>
      (graph?.stages ?? []).map((row, index) => ({
        id: row.key,
        name: row.draft.name.trim() || t('stage.name', { position: index + 1 }),
        color: row.draft.color,
        position: index + 1,
      })),
    [graph?.stages, t],
  );
  const unreachable = useMemo(
    () => unreachableFrom(workflowStages.map((stage) => stage.id), graph?.moves ?? []),
    [workflowStages, graph?.moves],
  );

  /** The body to send, or `null` when something cannot be sent (and the form says what). */
  const bodyOf = (current: Graph): ProjectTemplateBody | null => {
    const stages: ProjectTemplateBody['stages'] = [];
    for (const row of current.stages) {
      const days = parseDuration(row.draft.duration);
      const alerts = parseAlertOffsets(row.draft.alerts);
      if (row.draft.name.trim() === '' || days === null || alerts === null || row.tasks === null) return null;
      stages.push({
        key: row.key,
        name: row.draft.name.trim(),
        color: row.draft.color,
        plannedDurationDays: days,
        responsibleRoleIds: row.draft.responsibleRoleIds,
        alertOffsetsDays: alerts,
        completionGate: row.draft.completionGate,
        completionPermitted: row.draft.completionPermitted,
        tasks: row.tasks,
      });
    }
    if (current.name.trim() === '' || stages.length === 0) return null;
    return {
      name: current.name.trim(),
      description: current.description,
      roleIds: current.roleIds,
      stages,
      moves: current.moves.map((move) => ({ fromStageKey: move.fromStageId, toStageKey: move.toStageId })),
    };
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!graph) return;
    const body = bodyOf(graph);
    if (body === null) {
      setShowErrors(true);
      if (graph.name.trim() === '') nameRef.current?.focus();
      return;
    }
    setShowErrors(false);
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      if (isNew) {
        const created = await projectsApi.createTemplate(body);
        void navigate(`${LIST_PATH}/${created.id}`);
        return;
      }
      reset(graphOf(await projectsApi.saveTemplate(id as string, body)));
      setNotice(t('templates.editor.saved'));
    } catch (failure) {
      setError(errorMessage(failure, t('templates.editor.error.generic')));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Archive, restore or duplicate — each its own request; unsaved edits stay on
   * screen. A duplicate is made from the saved Template and opens in place of
   * this one, so with unsaved edits it asks first.
   */
  const act = async (action: 'archive' | 'restore' | 'duplicate'): Promise<void> => {
    if (isNew || id === undefined) return;
    if (
      action === 'duplicate' &&
      dirty &&
      !(await confirm({
        title: t('templates.editor.duplicateUnsaved.title'),
        message: t('templates.editor.duplicateUnsaved.message'),
        confirmLabel: t('templates.editor.duplicateUnsaved.confirm'),
        cancelLabel: t('templates.editor.unsaved.stay'),
      }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      if (action === 'duplicate') {
        const copy = await projectsApi.duplicateTemplate(id);
        void navigate(`${LIST_PATH}/${copy.id}`);
        return;
      }
      const answered = action === 'archive' ? await projectsApi.archiveTemplate(id) : await projectsApi.restoreTemplate(id);
      update({ archivedAt: answered.archivedAt });
      setSaved((previous) => (previous ? { ...previous, archivedAt: answered.archivedAt } : previous));
      setNotice(t(action === 'archive' ? 'templates.editor.archived' : 'templates.editor.restored'));
    } catch (failure) {
      setError(errorMessage(failure, t('templates.editor.error.action')));
    } finally {
      setBusy(false);
    }
  };

  /** *Cancel*: back to the list — after a question when something is unsaved. */
  const cancel = async (): Promise<void> => {
    if (
      dirty &&
      !(await confirm({
        title: t('templates.editor.unsaved.title'),
        message: t('templates.editor.unsaved.message'),
        confirmLabel: t('templates.editor.unsaved.discard'),
        cancelLabel: t('templates.editor.unsaved.stay'),
        destructive: true,
      }))
    ) {
      return;
    }
    void navigate(LIST_PATH);
  };

  if (loadError) {
    return (
      <>
        <PageHeader title={t('templates.list.title')} back={{ label: t('templates.editor.back'), to: LIST_PATH }} />
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  if (!graph) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('templates.editor.loading')}
      </p>
    );
  }

  const nameInvalid = showErrors && graph.name.trim() === '';
  const stageNameInvalid = showErrors && graph.stages.some((row) => row.draft.name.trim() === '');
  const durationInvalid = showErrors && graph.stages.some((row) => parseDuration(row.draft.duration) === null);
  const offeredRoles = roles.filter((role) => role.archivedAt === null || graph.roleIds.includes(role.id));

  const required = (
    <span aria-hidden="true" className="text-destructive">
      {' *'}
    </span>
  );

  return (
    <>
      <PageHeader
        title={isNew ? t('templates.editor.titleNew') : graph.name || t('templates.editor.titleNew')}
        back={{ label: t('templates.editor.back'), to: LIST_PATH }}
        titleActions={graph.archivedAt ? <Badge variant="secondary">{t('templates.list.archived')}</Badge> : undefined}
        actions={
          isNew ? undefined : (
            <>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={busy}
                onClick={(): void => void act('duplicate')}
              >
                <Copy aria-hidden="true" />
                {t('templates.editor.duplicate')}
              </Button>
              {graph.archivedAt ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  disabled={busy}
                  onClick={(): void => void act('restore')}
                >
                  <ArchiveRestore aria-hidden="true" />
                  {t('templates.editor.restore')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  disabled={busy}
                  onClick={(): void => void act('archive')}
                >
                  <Archive aria-hidden="true" />
                  {t('templates.editor.archive')}
                </Button>
              )}
            </>
          )
        }
      />

      <form noValidate onSubmit={(event): void => void save(event)} className="space-y-4">
        {graph.archivedAt ? (
          <Alert>
            <AlertDescription>{t('templates.editor.archivedNotice')}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardContent className="space-y-5 pt-6">
            <p className="text-xs text-muted-foreground">{t('create.requiredHint')}</p>
            <div className="space-y-1">
              <Label htmlFor="template-name">
                {t('templates.editor.name')}
                {required}
              </Label>
              <Input
                id="template-name"
                ref={nameRef}
                value={graph.name}
                maxLength={120}
                required
                aria-invalid={nameInvalid}
                aria-describedby={nameInvalid ? 'template-name-error' : undefined}
                onChange={(event): void => update({ name: event.target.value })}
              />
              {nameInvalid ? (
                <p id="template-name-error" className="text-xs text-destructive">
                  {t('templates.editor.error.name')}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="template-description">{t('templates.editor.description')}</Label>
              <Textarea
                id="template-description"
                rows={4}
                value={graph.description}
                maxLength={20000}
                aria-describedby="template-description-hint"
                onChange={(event): void => update({ description: event.target.value })}
              />
              <p id="template-description-hint" className="text-xs text-muted-foreground">
                {t('templates.editor.descriptionHint')}
              </p>
            </div>
            {offeredRoles.length > 0 ? (
              <fieldset>
                <legend className="text-sm font-medium">{t('templates.editor.roles')}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {offeredRoles.map((role) => {
                    const checkboxId = `template-role-${role.id}`;
                    return (
                      <label key={role.id} htmlFor={checkboxId} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                        <Checkbox
                          id={checkboxId}
                          checked={graph.roleIds.includes(role.id)}
                          onChange={(event): void =>
                            update({
                              roleIds: event.target.checked
                                ? [...graph.roleIds, role.id]
                                : graph.roleIds.filter((roleId) => roleId !== role.id),
                            })
                          }
                        />
                        {role.archivedAt ? t('overview.archivedRole', { role: role.label }) : role.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <fieldset className="space-y-3" aria-describedby="template-stages-hint">
              <legend className="text-base font-semibold">
                {t('templates.editor.stages')}
                {required}
              </legend>
              <p id="template-stages-hint" className="text-sm text-muted-foreground">
                {t('templates.editor.stagesHint')}
              </p>
              <ol className="space-y-3">
                {graph.stages.map((row, index) => {
                  const position = index + 1;
                  return (
                    <li key={row.key} className="space-y-3 rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span aria-hidden="true" className="text-sm font-medium tabular-nums text-muted-foreground">
                          {position}.
                        </span>
                        <StageDot color={row.draft.color} />
                        <span className="font-medium [overflow-wrap:anywhere]">{row.draft.name}</span>
                      </div>
                      <StageFields
                        idPrefix={`template-stage-${row.key}`}
                        position={position}
                        draft={row.draft}
                        onChange={(patch): void => updateStage(row.key, { draft: { ...row.draft, ...patch } })}
                        roles={roles}
                        heldRoleIds={row.heldRoleIds}
                        invalid={showErrors}
                      />
                      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                          aria-label={t('stage.moveUp', { position })}
                          disabled={busy || index === 0}
                          onClick={(): void => moveStage(index, -1)}
                        >
                          <ArrowUp aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                          aria-label={t('stage.moveDown', { position })}
                          disabled={busy || index === graph.stages.length - 1}
                          onClick={(): void => moveStage(index, 1)}
                        >
                          <ArrowDown aria-hidden="true" />
                        </Button>
                        {graph.stages.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="ml-auto min-h-11 text-destructive hover:text-destructive sm:min-h-9"
                            aria-label={t('editor.delete', { position })}
                            disabled={busy}
                            onClick={(): void => removeStage(row.key)}
                          >
                            <Trash2 aria-hidden="true" />
                            {tCore('common.action.delete')}
                          </Button>
                        ) : null}
                      </div>
                      {tasksPresent ? (
                        <StageTasksEditor
                          stage={{ stageTasks: row.initialTasks }}
                          position={position}
                          roles={roles}
                          canWrite
                          busy={busy}
                          showErrors={showErrors && row.tasks === null}
                          onChange={(tasks): void => updateStage(row.key, { tasks })}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {stageNameInvalid ? <p className="text-xs text-destructive">{t('create.error.stageName')}</p> : null}
              {durationInvalid ? <p className="text-xs text-destructive">{t('create.error.stageDuration')}</p> : null}
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={busy || graph.stages.length >= PROJECT_STAGES_MAX}
                onClick={addStage}
              >
                <Plus aria-hidden="true" />
                {t('editor.add')}
              </Button>
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <StageWorkflow
              stages={workflowStages}
              moves={graph.moves}
              unreachableStageIds={unreachable}
              canWrite
              onSetMoves={(moves): void => update({ moves })}
            />
          </CardContent>
        </Card>

        {/* Mounted before it has text, so a change is announced (WCAG 4.1.3). */}
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>

        <StickyFormActions className="flex justify-end gap-2">
          <Button
            className="min-h-11 sm:min-h-9"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={(): void => void cancel()}
          >
            {tCore('common.action.cancel')}
          </Button>
          <Button className="min-h-11 sm:min-h-9" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? t('templates.editor.saving') : t('templates.editor.save')}
          </Button>
        </StickyFormActions>
      </form>
      {confirmDialog}
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TemplateEditor;
