import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Flag, Pencil, Plus, Trash2 } from 'lucide-react';
import type { TaskPriorityConfig } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ReorderControls,
  ResponsiveTable,
  useServerReorder,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../../api.js';
import { TaskPriorityDeleteDialog } from '../../components/priorities/TaskPriorityDeleteDialog.js';
import { TaskPriorityDialog, type TaskPriorityDialogSubmit } from '../../components/priorities/TaskPriorityDialog.js';
import { SettingsEmptyState } from '../../components/SettingsEmptyState.js';
import { errorMessage, workflowStatusName } from '../../lib/labels.js';
import { TaskConfigurationTabs } from '../../components/TaskConfigurationTabs.js';

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
 *
 * The kit's `ListPage` since issue #1749. A row keeps its move, edit and
 * delete controls inline — moving is what this list is for, and a menu would
 * hide it; the list is answered whole, so there is no pager.
 */
export function TaskPrioritiesPage(): ReactNode {
  const t = useTranslation('tasks');
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

  const openCreate = (): void => setDialog({ kind: 'create' });

  const nextWeight = ordered.reduce((max, priority) => Math.max(max, priority.weight), 0) + 10;

  // The one place for Add (issue #1562, WORK-13): the header's filled button,
  // hidden while the list is empty, where the empty state's Add stands alone.
  const listLoad: ListPageLoad =
    priorities !== null
      ? { kind: 'ready' }
      : loading
        ? { kind: 'loading' }
        : { kind: 'error', message: loadError ?? t('priorities.error.load') };

  return (
    <>
      <ListPage
        title={t('priorities.title')}
        actions={
          priorities !== null && priorities.length > 0 ? (
            <Button className="min-h-11 sm:min-h-9" onClick={openCreate}>
              <Plus aria-hidden="true" />
              {t('priorities.add')}
            </Button>
          ) : undefined
        }
        tabs={<TaskConfigurationTabs />}
        count={t('priorities.count', { count: ordered.length })}
        notice={
          reorder.notice ? (
            <Alert variant={reorder.notice.kind === 'stale' ? 'warning' : 'destructive'} live="assertive">
              <AlertDescription>{reorder.notice.message}</AlertDescription>
            </Alert>
          ) : null
        }
        load={listLoad}
        busy={loading && priorities !== null}
        onRetry={(): void => void load()}
      >
        <ResponsiveTable
          label={t('priorities.title')}
          data={ordered}
          keyExtractor={(priority): string => priority.code}
          emptyState={
            <SettingsEmptyState
              icon={<Flag size={20} />}
              title={t('priorities.empty.title')}
              body={t('priorities.empty.body')}
              actionLabel={t('priorities.add')}
              onAction={openCreate}
            />
          }
          columns={[
            {
              id: 'name',
              header: t('workflow.col.name'),
              primary: true,
              render: (priority) => (
                <Badge className="font-medium" style={statusBadgeStyle(priority.color)}>
                  {workflowStatusName(priority, language)}
                </Badge>
              ),
            },
            {
              id: 'code',
              header: t('workflow.col.code'),
              className: 'font-mono text-xs',
              render: (priority) => priority.code,
            },
            {
              id: 'position',
              header: t('workflow.col.position'),
              className: 'text-right tabular-nums',
              render: (priority) => ordered.indexOf(priority) + 1,
            },
            {
              id: 'inUse',
              header: t('workflow.col.inUse'),
              className: 'text-right tabular-nums',
              render: (priority) => priority.inUseCount,
            },
          ]}
          renderActions={(priority) => {
            const index = ordered.indexOf(priority);
            const name = workflowStatusName(priority, language);
            return (
              <div className="flex items-center justify-end gap-1">
                <ReorderControls
                  name={name}
                  isFirst={index === 0}
                  isLast={index === ordered.length - 1}
                  disabled={reorder.busy}
                  onMove={(delta): void => reorder.move(priority.code, delta)}
                />
                <Button
                  className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                  variant="ghost"
                  size="sm"
                  aria-label={t('priorities.editLabel', { name })}
                  onClick={(): void => setDialog({ kind: 'edit', priority })}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  className="min-h-11 min-w-11 text-destructive hover:text-destructive sm:min-h-9 sm:min-w-9"
                  variant="ghost"
                  size="sm"
                  aria-label={t('priorities.deleteLabel', { name })}
                  onClick={(): void => setPendingDelete(priority)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            );
          }}
        />
      </ListPage>

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
