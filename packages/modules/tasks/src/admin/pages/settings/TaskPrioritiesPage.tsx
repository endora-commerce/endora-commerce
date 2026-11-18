import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Flag, Pencil, Plus, Trash2 } from 'lucide-react';
import type { TaskPriorityConfig } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../../api.js';
import { TaskPriorityDeleteDialog } from '../../components/priorities/TaskPriorityDeleteDialog.js';
import { TaskPriorityDialog, type TaskPriorityDialogSubmit } from '../../components/priorities/TaskPriorityDialog.js';
import { ReorderControls } from '../../components/reorder/ReorderControls.js';
import { SettingsEmptyState } from '../../components/SettingsEmptyState.js';
import { errorMessage, workflowStatusName } from '../../lib/labels.js';
import { TASK_WORKFLOW_PATH } from '../../lib/settings-paths.js';
import { useServerReorder } from '../../lib/use-server-reorder.js';

type DialogState = { kind: 'create' } | { kind: 'edit'; priority: TaskPriorityConfig } | null;

/** Most urgent first: the lowest position, then the code. */
function byPosition(a: TaskPriorityConfig, b: TaskPriorityConfig): number {
  return a.weight - b.weight || a.code.localeCompare(b.code);
}

/**
 * The Task priorities (`specs/165-task-management/`, User Story 9 — FR-009,
 * FR-024, FR-041, research R-9; `contracts/admin-surfaces.md` §1): the
 * operator's list, most urgent first, each with how many Tasks the operator
 * can see hold it. Adding one, renaming it in both languages, recolouring it
 * and moving it (one batch reorder per move, issue #1560) are configuration — the route is gated `tasks:configure` —
 * and the list's sort by priority follows the order set here. Removing one
 * that Tasks hold asks which priority, or none, they get.
 *
 * Every write answers the whole list as it stands afterwards.
 */
export function TaskPrioritiesPage(): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const [priorities, setPriorities] = useState<TaskPriorityConfig[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<TaskPriorityConfig | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setPriorities(await tasksApi.priorities());
    } catch (error) {
      setLoadError(errorMessage(error, t('priorities.error.load')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const ordered = useMemo(() => [...(priorities ?? [])].sort(byPosition), [priorities]);
  const reorder = useServerReorder({
    rows: ordered,
    show: setPriorities,
    save: async (orderedCodes) => setPriorities(await tasksApi.reorderPriorities(orderedCodes)),
    reload: async () => setPriorities(await tasksApi.priorities()),
    staleMessage: t('reorder.stale'),
    failedMessage: (error) => errorMessage(error, t('reorder.failed')),
  });

  const submitPriority = async (submit: TaskPriorityDialogSubmit): Promise<void> => {
    setPriorities(
      submit.mode === 'create'
        ? await tasksApi.createPriority(submit.body)
        : await tasksApi.updatePriority(submit.code, submit.body),
    );
  };

  const deletePriority = async (replacement: string | undefined): Promise<void> => {
    if (!pendingDelete) return;
    setPriorities(await tasksApi.deletePriority(pendingDelete.code, replacement));
  };

  const header = (
    <PageHeader
      title={t('priorities.title')}
      description={t('priorities.description')}
      back={{ label: t('settings.back'), to: TASK_WORKFLOW_PATH }}
    />
  );

  if (priorities === null) {
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
              <span>{loadError ?? t('priorities.error.load')}</span>
              <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                {tCore('common.action.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  const nextWeight = ordered.reduce((max, priority) => Math.max(max, priority.weight), 0) + 10;

  return (
    <>
      {header}

      <Card className="mb-4">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{t('priorities.list.title')}</CardTitle>
            <CardDescription>{t('priorities.list.description')}</CardDescription>
          </div>
          {ordered.length > 0 ? (
            <Button className="min-h-11 sm:min-h-9" variant="outline" onClick={(): void => setDialog({ kind: 'create' })}>
              <Plus aria-hidden="true" />
              {t('priorities.add')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {reorder.notice ? (
            <Alert variant={reorder.notice.kind === 'stale' ? 'warning' : 'destructive'} live="assertive">
              <AlertDescription>{reorder.notice.message}</AlertDescription>
            </Alert>
          ) : null}
          {ordered.length === 0 ? (
            <SettingsEmptyState
              icon={<Flag size={20} />}
              title={t('priorities.empty.title')}
              body={t('priorities.empty.body')}
              actionLabel={t('priorities.add')}
              onAction={(): void => setDialog({ kind: 'create' })}
            />
          ) : (
            <Table aria-label={t('priorities.title')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('workflow.col.name')}</TableHead>
                  <TableHead>{t('workflow.col.code')}</TableHead>
                  <TableHead className="text-right">{t('workflow.col.position')}</TableHead>
                  <TableHead className="text-right">{t('workflow.col.inUse')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('workflow.col.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map((priority, index) => {
                  const name = workflowStatusName(priority, language);
                  return (
                    <TableRow key={priority.code}>
                      <TableCell>
                        <Badge className="font-medium" style={statusBadgeStyle(priority.color)}>
                          {name}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{priority.code}</TableCell>
                      <TableCell className="text-right tabular-nums">{index + 1}</TableCell>
                      <TableCell className="text-right tabular-nums">{priority.inUseCount}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <ReorderControls
                            name={name}
                            isFirst={index === 0}
                            isLast={index === ordered.length - 1}
                            disabled={reorder.busy}
                            onMove={(delta): void => reorder.move(priority.code, delta)}
                          />
                          <Button
                            className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
                            variant="ghost"
                            size="sm"
                            aria-label={t('priorities.editLabel', { name })}
                            onClick={(): void => setDialog({ kind: 'edit', priority })}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
                            variant="ghost"
                            size="sm"
                            aria-label={t('priorities.deleteLabel', { name })}
                            onClick={(): void => setPendingDelete(priority)}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {dialog ? (
        <TaskPriorityDialog
          priority={dialog.kind === 'edit' ? dialog.priority : null}
          nextWeight={nextWeight}
          takenCodes={ordered.map((priority) => priority.code)}
          language={language}
          onSubmit={submitPriority}
          onClose={(): void => setDialog(null)}
        />
      ) : null}

      {pendingDelete ? (
        <TaskPriorityDeleteDialog
          priority={pendingDelete}
          priorities={ordered}
          language={language}
          onConfirm={deletePriority}
          onClose={(): void => setPendingDelete(null)}
        />
      ) : null}
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TaskPrioritiesPage;
