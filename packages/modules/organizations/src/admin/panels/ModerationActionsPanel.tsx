import { useCallback, useId, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, EditorSection, InlineStatus, Label, Textarea, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { ModalDialog, OrganizationStatusBadge, ImmediateBadge } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { TriangleAlert } from 'lucide-react';
import { showRegistryDivergenceNotice } from './vat-validation-view.js';

export interface ModerationActionsPanelProps {
  organizationId: string;
  status: 'pending_verification' | 'active' | 'blocked' | 'rejected';
  version: number;
  blockedReason?: string | null;
  rejectedReason?: string | null;
  approvedAt?: string | null;
  /**
   * Feature 173 — how many fields of the newest registration-time lookup differ
   * from what the customer submitted. A pending Organization with any shows a
   * notice pointing at the VAT validation panel (FR-023).
   */
  registryDivergenceCount?: number;
  /** The id of the VAT validation panel's heading, the notice's link target. */
  vatValidationAnchorId?: string;
  /**
   * Issue #1515 — the VAT validation is on another tab of the screen, so a plain fragment
   * link would land on a hidden element. Given, the link calls it instead of following its
   * `href`, and the screen opens that tab.
   */
  onShowVatValidation?: () => void;
  /**
   * Issue #1468 — whether the operator holds `customers:manage`, which the four moderation
   * routes require. Moderation is the organization status's one writer, so without it the panel
   * shows the status and the reasons and offers no action. Required, so a caller cannot forget it
   * into offering actions the server refuses.
   */
  canModerate: boolean;
  /** Called after a successful transition so the parent can re-fetch. */
  onChanged: () => void | Promise<void>;
}

/** A moderation transition — the route segment it posts to. */
export type ModerationActionKind = 'approve' | 'reject' | 'block' | 'unblock';
type ActionKind = ModerationActionKind;

interface ModalState {
  kind: ActionKind;
  requiresReason: boolean;
}

/**
 * Moderation actions panel on the Organization detail page.
 *
 * Renders only the lifecycle actions the current status allows (issue #1541,
 * UX audit SALES-15): pending → Approve + Reject, active → Block, blocked →
 * Unblock, rejected → none. Four buttons with three disabled and no reason
 * given asked the operator to work out which one was live (Hick). It is
 * the one place an organization's status is shown and changed (issue #1468);
 * an operator without `customers:manage` sees the status and no action.
 * Reject + Block open a small Reason modal (Reject requires a non-empty
 * reason; Block's reason is optional). A 409 VERSION_CONFLICT response
 * surfaces as an inline error toast asking the operator to refresh.
 *
 * A section of the Overview tab's card (issue #1515, SALES-02), not a card of
 * its own. Its buttons are outline: the page Save is the screen's one primary.
 *
 * Errors:
 *  - 409 → "Organization changed since you opened this page. Refresh and retry."
 *  - 422 → "Cannot perform this action in the current status (…)."
 *  - 404 → "Organization not found." (rare — page refresh recovers)
 *  - other → falls back to the envelope's message.
 */
export function ModerationActionsPanel(props: ModerationActionsPanelProps): ReactNode {
  const t = useTranslation('core');
  const tm = useTranslation('organizations');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Issue #1499 (UX audit SALES-17, DEC-12 a) — "Organization approved" is said
  // beside the buttons, in a region mounted before it has text, not as a success
  // banner at the top of the card.
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  const descriptionId = useId();
  const reasonId = useId();
  const errorId = useId();

  const openModal = (kind: ActionKind): void => {
    setError(null);
    clearStatus();
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
      clearStatus();
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
        showStatus(t(`organizations.moderation.success.${kind}`));
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
    [busy, props, t, showStatus, clearStatus],
  );

  /** The transitions the status allows, in the order they are offered. */
  const actions = allowedModerationActions(props.status);

  return (
    <EditorSection
      title={
        <>
          {t('organizations.moderation.title')}
          <ImmediateBadge className="align-middle" />
        </>
      }
      action={<OrganizationStatusBadge status={props.status} />}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {showRegistryDivergenceNotice(props.status, props.registryDivergenceCount) ? (
        // Icon and text, never colour alone (WCAG 1.4.1); phrased without a
        // plural form, which the admin kit's resolver does not have. A polite
        // status, not the Alert's default `role="alert"`: it appears once the
        // VAT history has loaded and must not interrupt (WCAG 4.1.3).
        <Alert variant="warning" role="status" data-notice="registry-divergence">
          <TriangleAlert aria-hidden="true" className="h-4 w-4" />
          <AlertDescription>
            {tm('moderation.registryDivergence', { count: String(props.registryDivergenceCount ?? 0) })}{' '}
            {props.vatValidationAnchorId ? (
              <a
                className="underline"
                href={`#${props.vatValidationAnchorId}`}
                onClick={(event): void => {
                  if (!props.onShowVatValidation) return;
                  event.preventDefault();
                  props.onShowVatValidation();
                }}
              >
                {tm('moderation.registryDivergenceLink')}
              </a>
            ) : null}
          </AlertDescription>
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

      {/* The result region stays mounted even when no transition is left (a rejected
          organization), so the Reject that led there is still announced (WCAG 4.1.3). */}
      {props.canModerate ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((kind) => (
            <Button key={kind} variant="outline" disabled={busy} aria-busy={busy} onClick={(): void => openModal(kind)}>
              {t(`organizations.moderation.action.${kind}`)}
            </Button>
          ))}
          <InlineStatus {...statusProps} />
        </div>
      ) : null}

      {modal && props.canModerate ? (
        <ModalDialog
          title={t(`organizations.moderation.modal.${modal.kind}.title`)}
          onClose={(): void => setModal(null)}
          busy={busy}
          dismissOnScrim={false}
          aria-describedby={descriptionId}
          footer={
            <>
              <Button variant="outline" onClick={(): void => setModal(null)} disabled={busy}>
                {t('common.action.cancel')}
              </Button>
              <Button
                variant={modal.kind === 'reject' ? 'destructive' : 'default'}
                onClick={(): void => void execute(modal.kind, reason)}
                disabled={busy || (modal.requiresReason && reason.trim().length === 0)}
                aria-busy={busy}
              >
                {t(`organizations.moderation.modal.${modal.kind}.confirm`)}
              </Button>
            </>
          }
        >
          <p id={descriptionId} className="mb-3 text-sm text-muted-foreground">
            {t(`organizations.moderation.modal.${modal.kind}.description`)}
          </p>
          <div className="space-y-1">
            <Label htmlFor={reasonId}>
              {modal.requiresReason
                ? t('organizations.moderation.modal.reasonRequired')
                : t('organizations.moderation.modal.reasonOptional')}
            </Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(e): void => setReason(e.target.value)}
              required={modal.requiresReason}
              aria-describedby={errorId}
              rows={5}
            />
            {/* Mounted before it has text, so a refusal that arrives is announced. */}
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          </div>
        </ModalDialog>
      ) : null}
    </EditorSection>
  );
}

/**
 * Issue #1541 — the moderation transitions a status allows. The server refuses every other
 * one (422), so offering it, even disabled, is noise.
 */
export function allowedModerationActions(status: ModerationActionsPanelProps['status']): readonly ActionKind[] {
  switch (status) {
    case 'pending_verification':
      return ['approve', 'reject'];
    case 'active':
      return ['block'];
    case 'blocked':
      return ['unblock'];
    case 'rejected':
      return [];
  }
}
