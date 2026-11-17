import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { TaskStatusConfig, TaskWorkflow } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { StatusTransitionGraph, type StatusTransitionGraphStatus } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../../api.js';
import { BOARD_CARD_ANCHOR, TASK_GENERAL_SETTINGS_PATH, TASK_PRIORITIES_PATH, TASK_TAGS_PATH } from '../../lib/settings-paths.js';
import { TaskStatusDeleteDialog } from '../../components/workflow/TaskStatusDeleteDialog.js';
import { BoardCardFieldsEditor } from '../../components/BoardCardFieldsEditor.js';
import { TaskStatusDialog, type TaskStatusDialogSubmit } from '../../components/workflow/TaskStatusDialog.js';
import { TaskStatusesTable } from '../../components/workflow/TaskStatusesTable.js';
import { errorMessage, workflowStatusName } from '../../lib/labels.js';

type DialogState = { kind: 'create' } | { kind: 'edit'; status: TaskStatusConfig } | null;

/**
 * The Task workflow configuration (`specs/165-task-management/`, User Story 2
 * — FR-012 – FR-016; `contracts/admin-surfaces.md` §1; CRM's
 * `WorkflowConfigPage`, the model): the statuses and what each means, which
 * one a new Task starts in, and the moves allowed between them, on the kit's
 * `StatusTransitionGraph`.
 *
 * Every write answers the workflow as it stands afterwards, so the screen
 * shows the server's state and never a guess at what its change did to the
 * rest. A refusal is the server's own sentence — one per broken rule — shown
 * where the operator was working. Gated `tasks:configure` by its route.
 *
 * Below the workflow, the *Board card* section (User Story 3, FR-022): which
 * fields a card on the Task board shows (`BoardCardFieldsEditor`). The header
 * links to the other configuration screens — priorities, tags (User Story 9)
 * and the general settings.
 */
export function TaskWorkflowPage(): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const [workflow, setWorkflow] = useState<TaskWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<TaskStatusConfig | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setWorkflow(await tasksApi.workflow());
    } catch (error) {
      setLoadError(errorMessage(error, t('workflow.error.load')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The board's *Configure card* links here as `#board-card` (issue #512): a
  // client-side navigation does not scroll to a hash, and the section exists
  // only once the workflow has loaded — so scroll then, as CRM's workflow screen does.
  const { hash } = useLocation();
  const boardCardSection = useRef<HTMLElement>(null);
  const loaded = workflow !== null;
  useEffect(() => {
    if (loaded && hash === `#${BOARD_CARD_ANCHOR}`) boardCardSection.current?.scrollIntoView?.();
  }, [loaded, hash]);

  const graphStatuses = useMemo<StatusTransitionGraphStatus[]>(
    () =>
      (workflow?.statuses ?? []).map((status) => ({
        code: status.code,
        name: status.name,
        defaultName: status.defaultName,
        isInitial: status.isInitial,
        // A status that closes a Task is where the graph ends; a Task can still be reopened from it.
        isTerminal: status.category !== 'open',
        isSystem: false,
        weight: status.weight,
        color: status.color,
        inUseCount: status.inUseCount,
      })),
    [workflow],
  );
  const graphTransitions = useMemo(
    () =>
      (workflow?.transitions ?? []).map((edge) => ({
        fromStatusCode: edge.from,
        toStatusCode: edge.to,
        isSystem: false,
      })),
    [workflow],
  );
  const graphLabel = useCallback(
    (status: StatusTransitionGraphStatus): string => workflowStatusName(status, language),
    [language],
  );

  const submitStatus = async (submit: TaskStatusDialogSubmit): Promise<void> => {
    setActionError(null);
    setWorkflow(
      submit.mode === 'create'
        ? await tasksApi.createStatus(submit.body)
        : await tasksApi.updateStatus(submit.code, submit.body),
    );
  };

  const changeTransitions = (change: 'add' | 'remove', from: string, to: string): void => {
    if (!from || !to || from === to) return;
    setActionError(null);
    tasksApi
      .setTransitions({ [change]: [{ from, to }] })
      .then(setWorkflow)
      .catch((error: unknown) => setActionError(errorMessage(error, t('workflow.error.save'))));
  };

  const deleteStatus = async (replacement: string | undefined): Promise<void> => {
    if (!pendingDelete) return;
    setActionError(null);
    setWorkflow(await tasksApi.deleteStatus(pendingDelete.code, replacement));
  };

  const header = (
    <PageHeader
      title={t('workflow.title')}
      description={t('workflow.description')}
      actions={
        <nav aria-label={t('settings.nav')} className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {(
            [
              [TASK_PRIORITIES_PATH, 'settings.priorities.link'],
              [TASK_TAGS_PATH, 'settings.tags.link'],
              [TASK_GENERAL_SETTINGS_PATH, 'settings.link'],
            ] as const
          ).map(([to, labelKey]) => (
            <Link
              key={to}
              to={to}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-8"
            >
              {t(labelKey)}
            </Link>
          ))}
        </nav>
      }
    />
  );

  if (workflow === null) {
    return (
      <>
        {header}
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {tCore('common.state.loading')}
          </p>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{loadError ?? t('workflow.error.load')}</span>
              <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                {tCore('common.action.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  const nextWeight = workflow.statuses.reduce((max, status) => Math.max(max, status.weight), 0) + 10;

  return (
    <>
      {header}

      <Card className="mb-4">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{t('workflow.statuses.title')}</CardTitle>
            <CardDescription>{t('workflow.statuses.description')}</CardDescription>
          </div>
          <Button className="min-h-11 sm:min-h-9" variant="outline" onClick={(): void => setDialog({ kind: 'create' })}>
            <Plus aria-hidden="true" />
            {t('workflow.status.add')}
          </Button>
        </CardHeader>
        <CardContent>
          <TaskStatusesTable
            statuses={workflow.statuses}
            language={language}
            onEdit={(status): void => setDialog({ kind: 'edit', status })}
            onDelete={setPendingDelete}
          />
        </CardContent>
      </Card>

      <section aria-labelledby="tasks-workflow-transitions-title" className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle id="tasks-workflow-transitions-title">{t('workflow.transitions.title')}</CardTitle>
            <CardDescription>{t('workflow.transitions.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* A refused change of the moves is said beside the graph it is about. */}
            {actionError ? (
              <Alert variant="destructive">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            ) : null}
            <StatusTransitionGraph
              statuses={graphStatuses}
              transitions={graphTransitions}
              statusLabel={graphLabel}
              onAdd={(from, to): void => changeTransitions('add', from, to)}
              onRemove={(from, to): void => changeTransitions('remove', from, to)}
            />
          </CardContent>
        </Card>
      </section>

      <section ref={boardCardSection} id={BOARD_CARD_ANCHOR} aria-labelledby="tasks-board-card-title" className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle id="tasks-board-card-title">{t('boardCard.title')}</CardTitle>
            <CardDescription>{t('boardCard.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <BoardCardFieldsEditor />
          </CardContent>
        </Card>
      </section>

      {dialog ? (
        <TaskStatusDialog
          status={dialog.kind === 'edit' ? dialog.status : null}
          nextWeight={nextWeight}
          language={language}
          onSubmit={submitStatus}
          onClose={(): void => setDialog(null)}
        />
      ) : null}

      {pendingDelete ? (
        <TaskStatusDeleteDialog
          status={pendingDelete}
          workflow={workflow}
          language={language}
          onConfirm={deleteStatus}
          onClose={(): void => setPendingDelete(null)}
        />
      ) : null}
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TaskWorkflowPage;
