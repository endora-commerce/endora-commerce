import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Inbox, Loader2 } from 'lucide-react';
import {
  ADMIN_RELATED_PAYER_REQUESTS_MAX_PAGE_SIZE,
  type AdminRelatedPayerRequest,
  type RelatedPayerOperatorReason,
  type RelatedPayerRequestState,
} from '@endora-commerce/contracts';
import { formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  ListPage,
  ListToolbar,
  ModalDialog,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useListPagination,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  EmptyState,
  InlineStatus,
  Label,
  Select,
  Textarea,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { relatedPayersClient } from '../api.js';
import { NewOrganizationFields, newOrganizationBody, useNewOrganizationFields } from '../components/NewOrganizationFields.js';
import { errorMessage, relatedPayerOperatorReasonLabels, relatedPayerRequestStateLabels } from '../lib/labels.js';
import { DEFAULT_QUEUE_FILTERS, queueFiltersActive, type QueueFilters } from '../lib/queue-filters.js';

/** What the open dialog decides, and for which request. */
type QueueDialog =
  | { kind: 'reject'; request: AdminRelatedPayerRequest }
  | { kind: 'assign'; request: AdminRelatedPayerRequest }
  | { kind: 'create'; request: AdminRelatedPayerRequest };

/**
 * The operator queue of payer requests (`specs/182-related-payers/` FR-023, FR-024), at
 * `/related-payers/requests`: what waits for an operator and why — approval mode `admin`, the
 * second step of `payer_then_admin`, no eligible approver, no account, an ambiguous or ineligible
 * tax ID — with everything the sender never sees. `related_payers:manage` approves (the link, on
 * the buyer's terms) or rejects with a reason the sender reads. A request whose Organization is
 * not settled (US5, T090) cannot be approved until it is: the operator assigns one of the
 * Organizations its tax ID matches, creates the Organization (pre-filled with the tax ID and the
 * registry lookup), or sends the contact e-mail an invitation to register.
 *
 * UX audit 2026-11-17: the kit `ListPage`, server-paged (DS-05, #1439); the state and reason
 * filters are a `ListToolbar` (DS-06, #1440); a row's one visible action is an outline *Approve*,
 * the rest is in its `RowActionMenu` with *Reject* last (DS-07, #1441); an empty queue and a
 * filtered-out one are two `EmptyState`s (DS-15, #1448). Each decision's result is said beside
 * the list in an `InlineStatus`; a dialog's refusal stays in the dialog.
 */
export function RequestsQueue(): ReactNode {
  const { language } = useTranslationContext();
  const t = useTranslation('related_payers');
  const { hasPermission } = useAuth();
  const canManage = hasPermission('related_payers:manage');
  const pager = useListPagination({ scope: 'related-payer-requests', maxPageSize: ADMIN_RELATED_PAYER_REQUESTS_MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  const { page, pageSize } = pager.query;
  const status = useInlineStatus();
  const { clear: clearStatus, show: showStatus } = status;
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_QUEUE_FILTERS);
  const [rows, setRows] = useState<AdminRelatedPayerRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<QueueDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const stateRef = useRef<HTMLSelectElement>(null);
  /** Only the latest read may draw: a filter changed mid-flight must not be overwritten by the older answer. */
  const readSeq = useRef(0);
  const filtered = queueFiltersActive(filters);

  /** `quiet` re-reads after a decision without the skeleton, so the rows stay where the operator is. */
  const refresh = useCallback(
    async (quiet = false): Promise<void> => {
      const seq = ++readSeq.current;
      if (!quiet) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const res = await relatedPayersClient.queue({
          state: filters.state,
          ...(filters.reason ? { reason: filters.reason } : {}),
          page,
          pageSize,
        });
        if (seq !== readSeq.current) return;
        setRows(res.data);
        setTotal(res.meta.total);
        syncTotal(res.meta.total);
        setLoadError(null);
      } catch (e) {
        if (seq !== readSeq.current) return;
        // A quiet re-read that fails leaves the last page on screen; the decision itself was answered.
        if (!quiet) setLoadError(errorMessage(e, t('queue.loadError')));
      } finally {
        if (seq === readSeq.current) setLoading(false);
      }
    },
    [filters, page, pageSize, syncTotal, t],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** A new filter goes back to the first page in the same update, so one read goes out, not two. */
  const changeFilters = (next: QueueFilters): void => {
    setFilters(next);
    resetPage();
  };
  const clearFilters = (): void => changeFilters(DEFAULT_QUEUE_FILTERS);

  /** Runs a decision on one request; answers the refusal's message, or `null` once it is done. */
  async function decide(request: AdminRelatedPayerRequest, action: () => Promise<unknown>, success: string): Promise<string | null> {
    setBusy(request.id);
    try {
      await action();
      showStatus(success);
      void refresh(true);
      return null;
    } catch (e) {
      return errorMessage(e, t('queue.error'));
    } finally {
      setBusy(null);
    }
  }

  /** A row's own action: its refusal is said beside the list. */
  async function decideInRow(request: AdminRelatedPayerRequest, action: () => Promise<unknown>, success: string): Promise<void> {
    clearStatus();
    const refused = await decide(request, action, success);
    if (refused) showStatus(refused, 'error');
  }

  /** A dialog's action: its refusal stays in the dialog, beside the answer the operator gave. */
  async function decideInDialog(request: AdminRelatedPayerRequest, action: () => Promise<unknown>, success: string): Promise<void> {
    setDialogError(null);
    const refused = await decide(request, action, success);
    if (refused) setDialogError(refused);
    else setDialog(null);
  }

  const openDialog = (next: QueueDialog): void => {
    clearStatus();
    setDialogError(null);
    setDialog(next);
  };

  const load: ListPageLoad = loading
    ? { kind: 'loading' }
    : loadError !== null
      ? { kind: 'error', message: loadError }
      : { kind: 'ready' };

  const columns: ResponsiveColumn<AdminRelatedPayerRequest>[] = [
    {
      id: 'sender',
      header: t('queue.column.sender'),
      primary: true,
      render: (row) => <span className="font-medium">{row.senderName}</span>,
      meta: (row) => (row.operatorReason ? relatedPayerOperatorReasonLabels.label(t, row.operatorReason) : null),
    },
    {
      id: 'createdAt',
      header: t('queue.column.createdAt'),
      render: (row) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.createdAt, language)}</span>,
    },
    { id: 'taxId', header: t('queue.column.taxId'), render: (row) => <span className="tabular-nums">{row.taxId}</span> },
    { id: 'counterparty', header: t('queue.column.counterparty'), render: (row) => row.counterpartyName ?? '—' },
    { id: 'contactEmail', header: t('queue.column.contactEmail'), hideOnMobile: true, render: (row) => row.contactEmail },
    { id: 'comment', header: t('queue.column.comment'), hideOnMobile: true, render: (row) => row.comment ?? '—' },
    {
      id: 'reason',
      header: t('queue.column.reason'),
      hideOnMobile: true,
      render: (row) => (row.operatorReason ? relatedPayerOperatorReasonLabels.label(t, row.operatorReason) : '—'),
    },
    {
      id: 'state',
      header: t('queue.column.state'),
      hideOnMobile: true,
      render: (row) => relatedPayerRequestStateLabels.label(t, row.state),
    },
  ];

  const rowActions = (row: AdminRelatedPayerRequest): ReactNode => {
    if (!canManage || row.state !== 'pending') return null;
    const settled = row.counterpartyOrganizationId !== null;
    const running = busy === row.id;
    return (
      <div className="flex items-center justify-end gap-1">
        {settled ? (
          // A row's action that writes at once is outline, never filled: the queue has no one
          // primary to compete with, and a filled button in every row is none (Von Restorff).
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            aria-busy={running || undefined}
            onClick={() =>
              void decideInRow(row, () => relatedPayersClient.approveRequest(row.id), t('queue.status.approved', { sender: row.senderName }))
            }
          >
            {running ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Check aria-hidden="true" />}
            {t('queue.actions.approve')}
          </Button>
        ) : null}
        <RowActionMenu label={t('queue.rowMenu.label', { sender: row.senderName })} disabled={busy !== null}>
          {!settled && row.candidates.length > 0 ? (
            <RowActionMenuItem onSelect={() => openDialog({ kind: 'assign', request: row })}>{t('queue.actions.assign')}</RowActionMenuItem>
          ) : null}
          {!settled ? (
            <>
              <RowActionMenuItem onSelect={() => openDialog({ kind: 'create', request: row })}>
                {t('queue.actions.createOrganization')}
              </RowActionMenuItem>
              <RowActionMenuItem
                onSelect={() =>
                  void decideInRow(
                    row,
                    () => relatedPayersClient.sendInvitation(row.id),
                    t('queue.status.invited', { email: row.contactEmail }),
                  )
                }
              >
                {t('queue.actions.sendInvitation')}
              </RowActionMenuItem>
              <RowActionMenuSeparator />
            </>
          ) : null}
          <RowActionMenuItem destructive onSelect={() => openDialog({ kind: 'reject', request: row })}>
            {t('queue.actions.reject')}
          </RowActionMenuItem>
        </RowActionMenu>
      </div>
    );
  };

  return (
    <>
      <ListPage
        title={t('queue.title')}
        description={t('queue.description')}
        help={t('queue.help')}
        load={load}
        onRetry={() => void refresh()}
        count={t('queue.count', { count: total })}
        notice={<InlineStatus {...status.props} />}
        pagination={pager.footer(total)}
        toolbar={
          <ListToolbar
            className="min-w-0 flex-1"
            label={t('queue.toolbar.label')}
            filters={
              <>
                <Select
                  ref={stateRef}
                  aria-label={t('queue.filters.state')}
                  className="w-auto"
                  value={filters.state}
                  onChange={(e) => changeFilters({ ...filters, state: e.target.value as RelatedPayerRequestState })}
                >
                  {relatedPayerRequestStateLabels.values.map((value) => (
                    <option key={value} value={value}>
                      {relatedPayerRequestStateLabels.label(t, value)}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={t('queue.filters.reason')}
                  className="w-auto"
                  value={filters.reason}
                  onChange={(e) => changeFilters({ ...filters, reason: e.target.value as RelatedPayerOperatorReason | '' })}
                >
                  <option value="">{t('queue.filters.anyReason')}</option>
                  {relatedPayerOperatorReasonLabels.values.map((value) => (
                    <option key={value} value={value}>
                      {relatedPayerOperatorReasonLabels.label(t, value)}
                    </option>
                  ))}
                </Select>
              </>
            }
            filtersActive={filtered}
            onClearFilters={clearFilters}
          />
        }
      >
        <ResponsiveTable
          data={rows}
          keyExtractor={(row) => row.id}
          columns={columns}
          {...(canManage ? { renderActions: rowActions } : {})}
          emptyState={
            filtered ? (
              <EmptyState variant="no-results" title={t('queue.emptyFiltered')} onClearFilters={clearFilters} focusAfterClear={stateRef} />
            ) : (
              <EmptyState icon={<Inbox size={20} />} title={t('queue.empty.title')} description={t('queue.empty.description')} />
            )
          }
        />
      </ListPage>
      {dialog?.kind === 'reject' ? (
        <RejectRequestDialog
          busy={busy !== null}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(reason) =>
            void decideInDialog(
              dialog.request,
              () => relatedPayersClient.rejectRequest(dialog.request.id, reason),
              t('queue.status.rejected', { sender: dialog.request.senderName }),
            )
          }
        />
      ) : null}
      {dialog?.kind === 'assign' ? (
        <AssignOrganizationDialog
          request={dialog.request}
          busy={busy !== null}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(organizationId) =>
            void decideInDialog(
              dialog.request,
              () => relatedPayersClient.assignOrganization(dialog.request.id, organizationId),
              t('queue.status.assigned', { sender: dialog.request.senderName }),
            )
          }
        />
      ) : null}
      {dialog?.kind === 'create' ? (
        <CreateRequestOrganizationDialog
          request={dialog.request}
          busy={busy !== null}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(organization) =>
            void decideInDialog(
              dialog.request,
              () => relatedPayersClient.createRequestOrganization(dialog.request.id, { organization }),
              t('queue.status.created', { sender: dialog.request.senderName }),
            )
          }
        />
      ) : null}
    </>
  );
}

/** A dialog's refusal, above its fields: the operator reads it where the answer is given (Peak-End). */
function DialogError({ error }: { error: string | null }): ReactNode {
  return error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;
}

/** FR-023 — reject with a reason the sender reads on its *Payers* screen. */
function RejectRequestDialog(props: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}): ReactNode {
  const t = useTranslation('related_payers');
  const id = useId();
  const [reason, setReason] = useState('');
  return (
    <ModalDialog
      title={t('queue.reject.title')}
      onClose={props.onClose}
      busy={props.busy}
      footer={
        <>
          <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
            {t('queue.reject.cancel')}
          </Button>
          <Button disabled={props.busy || reason.trim() === ''} aria-busy={props.busy || undefined} onClick={() => props.onSubmit(reason.trim())}>
            {t('queue.reject.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <DialogError error={props.error} />
        <div className="space-y-1">
          <Label htmlFor={id}>{t('queue.reject.reason')}</Label>
          <Textarea id={id} value={reason} maxLength={2000} aria-describedby={`${id}-hint`} onChange={(e) => setReason(e.target.value)} />
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {t('queue.reject.hint')}
          </p>
        </div>
      </div>
    </ModalDialog>
  );
}

/** FR-023, T087 — name the Organization an ambiguous request means: one of its candidates. */
function AssignOrganizationDialog(props: {
  request: AdminRelatedPayerRequest;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (organizationId: string) => void;
}): ReactNode {
  const t = useTranslation('related_payers');
  const id = useId();
  const [assignTo, setAssignTo] = useState('');
  return (
    <ModalDialog
      title={t('queue.assign.title')}
      onClose={props.onClose}
      busy={props.busy}
      footer={
        <>
          <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
            {t('queue.reject.cancel')}
          </Button>
          <Button disabled={props.busy || assignTo === ''} aria-busy={props.busy || undefined} onClick={() => props.onSubmit(assignTo)}>
            {t('queue.assign.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <DialogError error={props.error} />
        <div className="space-y-1">
          <Label htmlFor={id}>{t('queue.assign.organization')}</Label>
          <Select id={id} value={assignTo} aria-describedby={`${id}-hint`} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">{t('queue.assign.choose')}</option>
            {props.request.candidates.map((candidate) => (
              <option key={candidate.organizationId} value={candidate.organizationId}>
                {candidate.name}
              </option>
            ))}
          </Select>
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {t('queue.assign.hint')}
          </p>
        </div>
      </div>
    </ModalDialog>
  );
}

/**
 * US5-2 — the Organization a request names, created by the operator: the request's tax ID, the
 * registry lookup that pre-fills the rest, the registered address and the sales channel. The
 * Organization is created approved and the request's link is active at once, on the buyer's terms.
 */
function CreateRequestOrganizationDialog(props: {
  request: AdminRelatedPayerRequest;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (organization: ReturnType<typeof newOrganizationBody>) => void;
}): ReactNode {
  const t = useTranslation('related_payers');
  const id = useId();
  const organization = useNewOrganizationFields({ taxId: props.request.taxId });
  const formId = `${id}-form`;
  return (
    <ModalDialog
      title={t('queue.create.title')}
      onClose={props.onClose}
      busy={props.busy}
      footer={
        <>
          <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
            {t('queue.reject.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={props.busy} aria-busy={props.busy || undefined}>
            {t('queue.create.confirm')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit(newOrganizationBody(organization.fields));
        }}
      >
        <DialogError error={props.error} />
        <p className="text-sm text-muted-foreground">{t('queue.create.hint')}</p>
        <NewOrganizationFields id={id} state={organization} />
      </form>
    </ModalDialog>
  );
}

/** The route registry loads a page through a dynamic-import factory and reads its default export. */
export default RequestsQueue;
