'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { RELATED_PAYER_COMMENT_MAX } from '@endora-commerce/contracts';
import { tForLocale } from '../../lib/i18n/messages';
import { richText } from '../../lib/account/labels';
import { ModalDialog, ModalDialogAction, ModalDialogClose } from '../ModalDialog';

/**
 * `specs/182-related-payers/` FR-042 — **Reject** for a request or an invitation awaiting this
 * Organization on **Payers** (owner, 2026-11-20). The row carries only the button; the optional
 * reason is asked for in a `ModalDialog` (issue #804) that names the sender and says the sender
 * will see the reason. Its confirm posts `requestId` and `reason` to the page's server action
 * through `ModalDialogAction` — the pending label until it finishes, nothing able to dismiss it
 * meanwhile, a message with a retry if the request itself fails. A refusal the API answers
 * arrives as the action's own `?error=` redirect, and an empty reason is the action's to send
 * as `null`.
 *
 * A form dialog rather than an alertdialog: focus opens on the reason, the field the member came
 * to fill in.
 */
export function RejectPayerRequestButton({
  requestId,
  senderName,
  kind,
  locale,
  triggerClassName,
  rejectAction,
}: {
  requestId: string;
  senderName: string;
  /** A buyer's request to be paid for, or a payer's invitation to pay. */
  kind: 'requests' | 'invitations';
  /** The page language, from the server component that renders this (issue #85). */
  locale: string;
  /** The row's destructive button class, so the trigger looks as the row's other actions. */
  triggerClassName: string;
  rejectAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  const t = tForLocale(locale);
  const [failed, setFailed] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const reasonId = `${fieldId}-reason`;
  const hintId = `${fieldId}-hint`;
  const invitation = kind === 'invitations';

  const confirm = async (): Promise<void> => {
    setFailed(false);
    const formData = new FormData();
    formData.set('requestId', requestId);
    formData.set('reason', reasonRef.current?.value ?? '');
    await rejectAction(formData);
  };

  return (
    <ModalDialog
      triggerLabel={t('account.payers.reject')}
      triggerClassName={triggerClassName}
      title={t(invitation ? 'account.payers.rejectDialog.invitationTitle' : 'account.payers.rejectDialog.requestTitle')}
      closeLabel={t('account.common.close')}
      footer={
        <>
          <ModalDialogClose className="btn btn--outline">{t('account.common.cancel')}</ModalDialogClose>
          <ModalDialogAction
            className="btn btn--danger"
            pendingLabel={t('account.payers.rejectDialog.pending')}
            action={confirm}
            onError={(): void => setFailed(true)}
          >
            {t('account.payers.reject')}
          </ModalDialogAction>
        </>
      }
    >
      <p className="m-0">
        {richText(
          t(invitation ? 'account.payers.rejectDialog.invitationBody' : 'account.payers.rejectDialog.requestBody'),
          { name: <strong>{senderName}</strong> },
        )}
      </p>
      <div className="b2b-auth__field mt-4">
        <label htmlFor={reasonId}>{t('account.payers.rejectReason')}</label>
        <textarea
          ref={reasonRef}
          id={reasonId}
          name="reason"
          rows={4}
          maxLength={RELATED_PAYER_COMMENT_MAX}
          aria-describedby={hintId}
          data-autofocus=""
        />
        <p id={hintId} className="mt-1 mb-0 text-[13px] text-muted">
          {t('account.payers.rejectDialog.hint')}
        </p>
      </div>
      <div role="status">
        {failed ? <p className="mt-2 mb-0 text-[13px] text-bad">{t('account.payers.rejectDialog.failed')}</p> : null}
      </div>
    </ModalDialog>
  );
}
