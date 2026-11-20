import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { AdminRelatedPayerRequest, RelatedPayerOperatorReason, RelatedPayerRequestState } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { relatedPayersClient } from '../api.js';
import { NewOrganizationFields, newOrganizationBody, useNewOrganizationFields } from '../components/NewOrganizationFields.js';
import { errorMessage, relatedPayerOperatorReasonLabels, relatedPayerRequestStateLabels } from '../lib/labels.js';

/**
 * The operator queue of payer requests (`specs/182-related-payers/` FR-023, FR-024), at
 * `/related-payers/requests`: what waits for an operator and why — approval mode `admin`, the
 * second step of `payer_then_admin`, no eligible approver, no account, an ambiguous or ineligible
 * tax ID — with everything the sender never sees. `related_payers:manage` approves (the link, on
 * the buyer's terms) or rejects with a reason the sender reads. A request whose Organization is
 * not settled (US5, T090) cannot be approved until it is: the operator assigns one of the
 * Organizations its tax ID matches, creates the Organization (pre-filled with the tax ID and the
 * registry lookup), or sends the contact e-mail an invitation to register.
 */
export function RequestsQueue(): ReactNode {
  const t = useTranslation('related_payers');
  const { hasPermission } = useAuth();
  const canManage = hasPermission('related_payers:manage');
  const [state, setState] = useState<RelatedPayerRequestState>('pending');
  const [reason, setReason] = useState<RelatedPayerOperatorReason | ''>('');
  const [rows, setRows] = useState<AdminRelatedPayerRequest[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminRelatedPayerRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [assigning, setAssigning] = useState<AdminRelatedPayerRequest | null>(null);
  const [assignTo, setAssignTo] = useState('');
  const [creating, setCreating] = useState<AdminRelatedPayerRequest | null>(null);
  const assignId = useId();
  const stateId = useId();
  const reasonId = useId();
  const rejectReasonId = useId();

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await relatedPayersClient.queue({ state, ...(reason ? { reason } : {}) });
      setRows(res.data);
    } catch {
      setLoadError(true);
    }
  }, [state, reason]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e, t('queue.error')));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function confirmReject() {
    if (!rejecting) return;
    const ok = await run(rejecting.id, () => relatedPayersClient.rejectRequest(rejecting.id, rejectReason.trim()));
    if (ok) {
      setRejecting(null);
      setRejectReason('');
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('queue.title')} description={t('queue.description')} />
      <div className="flex flex-wrap gap-4">
        <div className="space-y-1">
          <Label htmlFor={stateId}>{t('queue.filters.state')}</Label>
          <Select id={stateId} value={state} onChange={(e) => setState(e.target.value as RelatedPayerRequestState)}>
            {relatedPayerRequestStateLabels.values.map((value) => (
              <option key={value} value={value}>
                {relatedPayerRequestStateLabels.label(t, value)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={reasonId}>{t('queue.filters.reason')}</Label>
          <Select id={reasonId} value={reason} onChange={(e) => setReason(e.target.value as RelatedPayerOperatorReason | '')}>
            <option value="">{t('queue.filters.anyReason')}</option>
            {relatedPayerOperatorReasonLabels.values.map((value) => (
              <option key={value} value={value}>
                {relatedPayerOperatorReasonLabels.label(t, value)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="p-0">
          {loadError ? (
            <div className="flex items-center gap-3 p-4">
              <span>{t('queue.loadError')}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t('queue.retry')}
              </Button>
            </div>
          ) : rows === null ? (
            <p className="p-4 text-sm text-muted-foreground">{t('queue.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t('queue.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('queue.column.createdAt')}</TableHead>
                  <TableHead>{t('queue.column.sender')}</TableHead>
                  <TableHead>{t('queue.column.taxId')}</TableHead>
                  <TableHead>{t('queue.column.counterparty')}</TableHead>
                  <TableHead>{t('queue.column.contactEmail')}</TableHead>
                  <TableHead>{t('queue.column.comment')}</TableHead>
                  <TableHead>{t('queue.column.reason')}</TableHead>
                  <TableHead>{t('queue.column.state')}</TableHead>
                  {canManage ? <TableHead>{t('queue.column.actions')}</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{row.senderName}</TableCell>
                    <TableCell>{row.taxId}</TableCell>
                    <TableCell>{row.counterpartyName ?? '—'}</TableCell>
                    <TableCell>{row.contactEmail}</TableCell>
                    <TableCell>{row.comment ?? '—'}</TableCell>
                    <TableCell>{row.operatorReason ? relatedPayerOperatorReasonLabels.label(t, row.operatorReason) : '—'}</TableCell>
                    <TableCell>{relatedPayerRequestStateLabels.label(t, row.state)}</TableCell>
                    {canManage ? (
                      <TableCell>
                        {row.state === 'pending' ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={busy !== null || !row.counterpartyOrganizationId}
                              onClick={() => void run(row.id, () => relatedPayersClient.approveRequest(row.id))}
                            >
                              {t('queue.actions.approve')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => {
                                setRejectReason('');
                                setRejecting(row);
                              }}
                            >
                              {t('queue.actions.reject')}
                            </Button>
                            {!row.counterpartyOrganizationId && row.candidates.length > 0 ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy !== null}
                                onClick={() => {
                                  setAssignTo('');
                                  setAssigning(row);
                                }}
                              >
                                {t('queue.actions.assign')}
                              </Button>
                            ) : null}
                            {!row.counterpartyOrganizationId ? (
                              <>
                                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setCreating(row)}>
                                  {t('queue.actions.createOrganization')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy !== null}
                                  onClick={() => void run(row.id, () => relatedPayersClient.sendInvitation(row.id))}
                                >
                                  {t('queue.actions.sendInvitation')}
                                </Button>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {rejecting ? (
        <ModalDialog
          title={t('queue.reject.title')}
          onClose={() => setRejecting(null)}
          busy={busy !== null}
          footer={
            <>
              <Button variant="outline" disabled={busy !== null} onClick={() => setRejecting(null)}>
                {t('queue.reject.cancel')}
              </Button>
              <Button disabled={busy !== null || rejectReason.trim() === ''} onClick={() => void confirmReject()}>
                {t('queue.reject.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-1">
            <Label htmlFor={rejectReasonId}>{t('queue.reject.reason')}</Label>
            <Textarea id={rejectReasonId} value={rejectReason} maxLength={2000} onChange={(e) => setRejectReason(e.target.value)} />
            <p className="text-sm text-muted-foreground">{t('queue.reject.hint')}</p>
          </div>
        </ModalDialog>
      ) : null}
      {assigning ? (
        <ModalDialog
          title={t('queue.assign.title')}
          onClose={() => setAssigning(null)}
          busy={busy !== null}
          footer={
            <>
              <Button variant="outline" disabled={busy !== null} onClick={() => setAssigning(null)}>
                {t('queue.reject.cancel')}
              </Button>
              <Button
                disabled={busy !== null || assignTo === ''}
                onClick={() =>
                  void run(assigning.id, () => relatedPayersClient.assignOrganization(assigning.id, assignTo)).then(
                    (ok) => ok && setAssigning(null),
                  )
                }
              >
                {t('queue.assign.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-1">
            <Label htmlFor={assignId}>{t('queue.assign.organization')}</Label>
            <Select id={assignId} value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">{t('queue.assign.choose')}</option>
              {assigning.candidates.map((candidate) => (
                <option key={candidate.organizationId} value={candidate.organizationId}>
                  {candidate.name}
                </option>
              ))}
            </Select>
            <p className="text-sm text-muted-foreground">{t('queue.assign.hint')}</p>
          </div>
        </ModalDialog>
      ) : null}
      {creating ? (
        <CreateRequestOrganizationDialog
          request={creating}
          busy={busy !== null}
          onClose={() => setCreating(null)}
          onSubmit={(organization) =>
            void run(creating.id, () => relatedPayersClient.createRequestOrganization(creating.id, { organization })).then(
              (ok) => ok && setCreating(null),
            )
          }
        />
      ) : null}
    </div>
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
          <Button type="submit" form={formId} disabled={props.busy}>
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
        <p className="text-sm text-muted-foreground">{t('queue.create.hint')}</p>
        <NewOrganizationFields id={id} state={organization} />
      </form>
    </ModalDialog>
  );
}

/** The route registry loads a page through a dynamic-import factory and reads its default export. */
export default RequestsQueue;
