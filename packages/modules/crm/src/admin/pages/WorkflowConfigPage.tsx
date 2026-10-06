import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
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
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import {
  StatusTransitionGraph,
  type StatusTransitionGraphStatus,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi, type OrderStatusOption } from '../api.js';
import { ModalDialog } from '../components/ModalDialog.js';
import { errorMessage, workflowStatusLabel } from '../lib/labels.js';
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

  const header = <PageHeader title={t('workflow.title')} description={t('workflow.description')} />;

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

      {actionError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

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
          <StatusesTable
            statuses={workflow.statuses}
            language={language}
            onEdit={(status): void => setDialog({ kind: 'edit', status })}
            onDelete={setPendingDelete}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('workflow.transitions.title')}</CardTitle>
          <CardDescription>{t('workflow.transitions.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <StatusTransitionGraph
            statuses={graphStatuses}
            transitions={graphTransitions}
            statusLabel={graphLabel}
            onAdd={(from, to): void => changeTransitions('add', from, to)}
            onRemove={(from, to): void => changeTransitions('remove', from, to)}
          />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('workflow.mapping.title')}</CardTitle>
          <CardDescription>{t('workflow.mapping.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <OrderStatusMappings
            workflow={workflow}
            orderStatuses={orderStatuses}
            language={language}
            onSave={saveMappings}
          />
        </CardContent>
      </Card>

      {/* --- User Story 8: which statuses count towards a computed value --- */}
      <Card>
        <CardHeader>
          <CardTitle>{t('value.counting.title')}</CardTitle>
          <CardDescription>{t('value.counting.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ValueCountingStatuses
            workflow={workflow}
            orderStatuses={orderStatuses}
            language={language}
            onSave={async (body): Promise<void> => {
              setWorkflow(await crmApi.setValueCountingStatuses(body));
            }}
          />
        </CardContent>
      </Card>
      {/* --- end of User Story 8 ------------------------------------------- */}

      {dialog ? (
        <StatusDialog
          status={dialog.kind === 'edit' ? dialog.status : null}
          nextWeight={nextWeight}
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
              <Button className="min-h-11 sm:min-h-9"
                variant="outline"
                disabled={deleting}
                onClick={(): void => setPendingDelete(null)}
              >
                {tCore('common.action.cancel')}
              </Button>
              <Button className="min-h-11 sm:min-h-9"
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
