import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import type {
  OpportunityBoardCardConfig,
  OpportunityWorkflow,
  OpportunityWorkflowStatus,
  OrderStatusMapping,
} from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  EditorSection,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import {
  BoardCardFieldsEditor,
  ImmediateBadge,
  ModalDialog,
  StatusTransitionGraph,
  type StatusTransitionGraphStatus,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi, type OrderStatusOption } from '../api.js';
import { boardFieldLabel } from '../lib/board-fields.js';
import { errorMessage, workflowStatusLabel } from '../lib/labels.js';
import { useServerReorder } from '../lib/use-server-reorder.js';
import { CrmConfigurationTabs } from '../components/CrmConfigurationTabs.js';
import {
  VALUE_COUNTING_HASH,
  workflowSection,
  workflowSectionForHash,
  workflowSectionPath,
} from '../lib/workflow-sections.js';
import { OrderStatusMappings } from './workflow/OrderStatusMappings.js';
import { StatusDialog, type StatusDialogSubmit } from './workflow/StatusDialog.js';
import { StatusesTable } from './workflow/StatusesTable.js';
import { ValueCountingStatuses } from './workflow/ValueCountingStatuses.js';

type DialogState = { kind: 'create' } | { kind: 'edit'; status: OpportunityWorkflowStatus } | null;

/**
 * The Opportunity workflow configuration
 * (`specs/143-crm-sales-opportunities/`, User Story 1 — FR-010 – FR-014): the
 * statuses and what each means, the transitions allowed between them, and the
 * Order status each Opportunity status sets on its linked Orders.
 *
 * Every write answers the workflow as it stands afterwards, so the screen
 * shows the server's state and never a guess at what its change did to the
 * rest. A refusal is the server's own sentence — one per broken rule — shown
 * where the operator was working.
 */
export function WorkflowConfigPage(): ReactNode {
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const [workflow, setWorkflow] = useState<OpportunityWorkflow | null>(null);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<OpportunityWorkflowStatus | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      // The Order statuses are another module's and another permission's: the
      // workflow is still configurable without them, only the mappings are not.
      const [loadedWorkflow, loadedOrderStatuses] = await Promise.all([
        crmApi.getWorkflow(),
        crmApi.listOrderStatuses().catch(() => null),
      ]);
      setWorkflow(loadedWorkflow);
      setOrderStatuses(loadedOrderStatuses);
    } catch (error) {
      setLoadError(errorMessage(error, t('workflow.error.load')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const { pathname, hash } = useLocation();
  const section = workflowSection(pathname);

  const orderedStatuses = useMemo(
    () =>
      [...(workflow?.statuses ?? [])].sort(
        (a, b) => a.weight - b.weight || a.code.localeCompare(b.code),
      ),
    [workflow],
  );
  const reorder = useServerReorder({
    rows: orderedStatuses,
    show: (statuses) => setWorkflow((current) => (current ? { ...current, statuses } : current)),
    save: async (orderedCodes) => setWorkflow(await crmApi.reorderStatuses(orderedCodes)),
    reload: async () => setWorkflow(await crmApi.getWorkflow()),
    staleMessage: t('reorder.stale'),
    failedMessage: (error) => errorMessage(error, t('reorder.failed')),
  });

  const graphStatuses = useMemo<StatusTransitionGraphStatus[]>(
    () =>
      (workflow?.statuses ?? []).map((status) => ({
        code: status.code,
        name: status.name,
        defaultName: status.defaultName,
        isInitial: status.isInitial,
        // A status that closes an Opportunity is where the graph ends.
        isTerminal: status.kind !== 'open',
        isSystem: false,
        weight: status.weight,
        color: status.color,
        inUseCount: status.inUseCount,
      })),
    [workflow],
  );
  const graphTransitions = useMemo(
    () => (workflow?.transitions ?? []).map((edge) => ({ ...edge, isSystem: false })),
    [workflow],
  );
  const graphLabel = useCallback(
    (status: StatusTransitionGraphStatus): string => workflowStatusLabel(status, language),
    [language],
  );

  const submitStatus = async (submit: StatusDialogSubmit): Promise<void> => {
    setActionError(null);
    setWorkflow(
      submit.mode === 'create'
        ? await crmApi.createStatus(submit.body)
        : await crmApi.updateStatus(submit.code, submit.body),
    );
  };

  const changeTransitions = (change: 'add' | 'remove', from: string, to: string): void => {
    if (!from || !to || from === to) return;
    setActionError(null);
    crmApi
      .setTransitions({ [change]: [{ fromStatusCode: from, toStatusCode: to }] })
      .then(setWorkflow)
      .catch((error: unknown) => setActionError(errorMessage(error, t('workflow.error.save'))));
  };

  const saveMappings = async (mappings: OrderStatusMapping[]): Promise<void> => {
    setWorkflow(await crmApi.setOrderStatusMappings(mappings));
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    setActionError(null);
    try {
      await crmApi.deleteStatus(pendingDelete.code);
      setWorkflow(await crmApi.getWorkflow());
    } catch (error) {
      setActionError(errorMessage(error, t('workflow.error.save')));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  // The board's *Configure card* links to `#board-card`, an Opportunity's
  // computed value to `#value-counting` (issue #1561): sections of one long
  // page once, tabs of their own now, so the link opens its tab.
  const hashSection = workflowSectionForHash(hash);
  if (hashSection !== null && section === 'statuses') {
    return <Navigate to={workflowSectionPath(hashSection)} replace />;
  }

  const header = (
    <>
      <PageHeader title={t('workflow.title')} />
      {/* One strip for the whole configuration: the four workflow tabs and Tags (#1557, #1559). */}
      <CrmConfigurationTabs />
    </>
  );

  // The board card is its own resource: the editor loads it, the workflow is not needed.
  if (section === 'boardCard') {
    return (
      <>
        {header}
        <EditorSection chrome="card" title={t('boardCard.title')}>
          <BoardCardFieldsEditor
            load={(): Promise<OpportunityBoardCardConfig> => crmApi.getBoardCardFields()}
            save={(refs): Promise<OpportunityBoardCardConfig> => crmApi.setBoardCardFields(refs)}
            fieldLabel={(field): string => boardFieldLabel(field, language, t)}
            copy={{
              titleAlways: t('boardCard.shown.titleAlways'),
              builtinGroup: t('boardCard.available.builtin'),
              noCustom: t('boardCard.available.noCustom'),
            }}
          />
        </EditorSection>
      </>
    );
  }

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
              <Button
                className="min-h-11 sm:min-h-8"
                variant="outline"
                size="sm"
                onClick={(): void => void load()}
              >
                {tCore('common.action.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  const nextWeight =
    workflow.statuses.reduce((max, status) => Math.max(max, status.weight), 0) + 10;

  return (
    <>
      {header}

      {section === 'statuses' ? (
        // Every control here writes at once — the dialog's save, a move, an
        // arrow — so the two sections share one card and no Save (Similarity).
        <Card>
          <CardContent className="space-y-(--section-gap)">
            {actionError ? (
              <Alert variant="destructive">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            ) : null}
            <EditorSection
              title={t('workflow.statuses.title')}
              action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <ImmediateBadge className="ml-0" />
                  <Button
                    className="min-h-11 sm:min-h-9"
                    variant="outline"
                    onClick={(): void => setDialog({ kind: 'create' })}
                  >
                    <Plus aria-hidden="true" />
                    {t('workflow.status.add')}
                  </Button>
                </div>
              }
            >
              {reorder.notice ? (
                <Alert
                  variant={reorder.notice.kind === 'stale' ? 'warning' : 'destructive'}
                  live="assertive"
                >
                  <AlertDescription>{reorder.notice.message}</AlertDescription>
                </Alert>
              ) : null}
              <StatusesTable
                statuses={orderedStatuses}
                language={language}
                onEdit={(status): void => setDialog({ kind: 'edit', status })}
                onDelete={setPendingDelete}
                onMove={(status, delta): void => reorder.move(status.code, delta)}
                reordering={reorder.busy}
              />
            </EditorSection>
            <EditorSection
              title={t('workflow.transitions.title')}
              description={t('workflow.transitions.description')}
              action={<ImmediateBadge className="ml-0" />}
            >
              <StatusTransitionGraph
                statuses={graphStatuses}
                transitions={graphTransitions}
                statusLabel={graphLabel}
                onAdd={(from, to): void => changeTransitions('add', from, to)}
                onRemove={(from, to): void => changeTransitions('remove', from, to)}
              />
            </EditorSection>
          </CardContent>
        </Card>
      ) : null}

      {section === 'orderSync' ? (
        <OrderStatusMappings
          workflow={workflow}
          orderStatuses={orderStatuses}
          language={language}
          onSave={saveMappings}
        />
      ) : null}

      {/* --- User Story 8: which statuses count towards a computed value --- */}
      {section === 'value' ? (
        // Keeps the anchor the value link has always named.
        <div id={VALUE_COUNTING_HASH.slice(1)}>
          <ValueCountingStatuses
            workflow={workflow}
            orderStatuses={orderStatuses}
            language={language}
            onSave={async (body): Promise<void> => {
              setWorkflow(await crmApi.setValueCountingStatuses(body));
            }}
          />
        </div>
      ) : null}

      {dialog ? (
        <StatusDialog
          status={dialog.kind === 'edit' ? dialog.status : null}
          nextWeight={nextWeight}
          takenCodes={workflow.statuses.map((status) => status.code)}
          language={language}
          onSubmit={submitStatus}
          onClose={(): void => setDialog(null)}
        />
      ) : null}

      {pendingDelete ? (
        <ModalDialog
          title={t('workflow.delete.title')}
          busy={deleting}
          onClose={(): void => setPendingDelete(null)}
          footer={
            <>
              <Button
                className="min-h-11 sm:min-h-9"
                variant="outline"
                disabled={deleting}
                onClick={(): void => setPendingDelete(null)}
              >
                {tCore('common.action.cancel')}
              </Button>
              <Button
                className="min-h-11 sm:min-h-9"
                variant="destructive"
                disabled={deleting}
                aria-busy={deleting}
                onClick={(): void => void confirmDelete()}
              >
                <Trash2 aria-hidden="true" />
                {tCore('common.action.delete')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            {t('workflow.delete.body', { name: workflowStatusLabel(pendingDelete, language) })}
          </p>
        </ModalDialog>
      ) : null}
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default WorkflowConfigPage;
