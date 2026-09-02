import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from '@endora-commerce/admin-kit/ui';
import { OrganizationStatusBadge } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

export interface ModerationActionsPanelProps {
  organizationId: string;
  status: 'pending_verification' | 'active' | 'blocked' | 'rejected';
  version: number;
  blockedReason?: string | null;
  rejectedReason?: string | null;
  approvedAt?: string | null;
  /** Called after a successful transition so the parent can re-fetch. */
  onChanged: () => void | Promise<void>;
}

type ActionKind = 'approve' | 'reject' | 'block' | 'unblock';

interface ModalState {
  kind: ActionKind;
  requiresReason: boolean;
}

/**
 * Moderation actions panel on the Organization detail page.
 *
 * Renders the four lifecycle buttons (Approve / Reject / Block / Unblock)
 * gated on the current status: only the legal transitions are offered.
 * Reject + Block open a small Reason modal (Reject requires a non-empty
 * reason; Block's reason is optional). A 409 VERSION_CONFLICT response
 * surfaces as an inline error toast asking the operator to refresh.
 *
 * Errors:
 *  - 409 → "Organization changed since you opened this page. Refresh and retry."
 *  - 422 → "Cannot perform this action in the current status (…)."
 *  - 404 → "Organization not found." (rare — page refresh recovers)
 *  - other → falls back to the envelope's message.
 */
export function ModerationActionsPanel(props: ModerationActionsPanelProps): ReactNode {
  const t = useTranslation('core');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const openModal = (kind: ActionKind): void => {
    setError(null);
    setInfo(null);
    setReason('');
    if (kind === 'approve' || kind === 'unblock') {
      void execute(kind, undefined);
      return;
    }
    setModal({ kind, requiresReason: kind === 'reject' });
  };

  const execute = useCallback(
    async (kind: ActionKind, providedReason: string | undefined): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        const body: Record<string, unknown> = { expectedVersion: props.version };
        if (kind === 'reject') {
          if (!providedReason || providedReason.trim().length === 0) {
            setError(t('organizations.moderation.error.reasonRequired'));
            setBusy(false);
            return;
          }
          body['reason'] = providedReason.trim();
        }
        if (kind === 'block' && providedReason && providedReason.trim().length > 0) {
          body['reason'] = providedReason.trim();
        }
        await apiClient.post(`/api/v1/admin/organizations/${props.organizationId}/${kind}`, body);
        setInfo(t(`organizations.moderation.success.${kind}`));
        setModal(null);
        setReason('');
        await props.onChanged();
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 409) {
            setError(t('organizations.moderation.error.conflict'));
          } else if (err.status === 422) {
            setError(t('organizations.moderation.error.wrongStatus'));
          } else {
            setError(err.envelope.error.message);
          }
        } else {
          setError(t('organizations.moderation.error.unknown'));
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, props, t],
  );

  const canApprove = props.status === 'pending_verification';
  const canReject = props.status === 'pending_verification';
  const canBlock = props.status === 'active';
  const canUnblock = props.status === 'blocked';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{t('organizations.moderation.title')}</CardTitle>
        <OrganizationStatusBadge status={props.status} />
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert variant="success">
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {props.status === 'blocked' && props.blockedReason ? (
          <p className="text-sm text-muted-foreground">
            <strong>{t('organizations.moderation.blockedReasonLabel')}:</strong> {props.blockedReason}
          </p>
        ) : null}
        {props.status === 'rejected' && props.rejectedReason ? (
          <p className="text-sm text-muted-foreground">
            <strong>{t('organizations.moderation.rejectedReasonLabel')}:</strong> {props.rejectedReason}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="default"
            disabled={!canApprove || busy}
            onClick={(): void => openModal('approve')}
          >
            {t('organizations.moderation.action.approve')}
          </Button>
          <Button
            variant="destructive"
            disabled={!canReject || busy}
            onClick={(): void => openModal('reject')}
          >
            {t('organizations.moderation.action.reject')}
          </Button>
          <Button
            variant="outline"
            disabled={!canBlock || busy}
            onClick={(): void => openModal('block')}
          >
            {t('organizations.moderation.action.block')}
          </Button>
          <Button
            variant="outline"
            disabled={!canUnblock || busy}
            onClick={(): void => openModal('unblock')}
          >
            {t('organizations.moderation.action.unblock')}
          </Button>
        </div>

        {modal ? (
          <div style={OVERLAY_STYLE} onClick={(): void => setModal(null)}>
            <div style={PANEL_STYLE} onClick={(e): void => e.stopPropagation()}>
              <h2 className="mb-2 text-lg font-semibold">
                {t(`organizations.moderation.modal.${modal.kind}.title`)}
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                {t(`organizations.moderation.modal.${modal.kind}.description`)}
              </p>
              <Textarea
                value={reason}
                onChange={(e): void => setReason(e.target.value)}
                placeholder={
                  modal.requiresReason
                    ? t('organizations.moderation.modal.reasonRequired')
                    : t('organizations.moderation.modal.reasonOptional')
                }
                rows={5}
                disabled={busy}
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={(): void => setModal(null)} disabled={busy}>
                  {t('common.action.cancel')}
                </Button>
                <Button
                  variant={modal.kind === 'reject' ? 'destructive' : 'default'}
                  onClick={(): void => void execute(modal.kind, reason)}
                  disabled={busy || (modal.requiresReason && reason.trim().length === 0)}
                >
                  {t(`organizations.moderation.modal.${modal.kind}.confirm`)}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.4)',
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const PANEL_STYLE: CSSProperties = {
  background: 'var(--bg-surface, #fff)',
  borderRadius: 8,
  width: 520,
  maxWidth: '90vw',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
  padding: '20px',
};
