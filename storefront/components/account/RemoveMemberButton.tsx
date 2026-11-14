'use client';

import { useState, type ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { richText } from '../../lib/account/labels';
import { ModalDialog, ModalDialogAction, ModalDialogClose } from '../ModalDialog';

/**
 * "Remove" control for a row of `/organization/members` (issue #1178). Removing
 * a member ends another person's access to the Organization at once and cannot
 * be undone from the storefront, so the row's button opens a confirmation
 * rather than posting the removal.
 *
 * The same shape as `DeleteShoppingListButton`: a `ModalDialog` alertdialog
 * (issue #804) that opens on Cancel, naming the member by name **and** e-mail
 * address — two colleagues can share a name — whose confirm runs the page's
 * `removeAction` server action through `ModalDialogAction`: "Removing…" until
 * it finishes, nothing able to dismiss it meanwhile, and a retry with a
 * message if the request itself fails. A refusal the API answers (the last
 * administrator) arrives as the action's own `?error=` redirect.
 */
export function RemoveMemberButton({
  memberId,
  memberName,
  memberEmail,
  locale,
  triggerClassName,
  removeAction,
}: {
  memberId: string;
  memberName: string;
  memberEmail: string;
  /** The page language, from the server page that renders this (issue #85). */
  locale: string;
  /** The row's destructive button class, so the trigger looks as it did. */
  triggerClassName?: string;
  removeAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  const t = tForLocale(locale);
  const [failed, setFailed] = useState(false);

  const confirmRemove = async (): Promise<void> => {
    setFailed(false);
    const formData = new FormData();
    formData.set('memberId', memberId);
    await removeAction(formData);
  };

  return (
    <ModalDialog
      triggerLabel={t('account.common.remove')}
      {...(triggerClassName ? { triggerClassName } : {})}
      title={t('account.members.remove.title')}
      closeLabel={t('account.common.close')}
      role="alertdialog"
      footer={
        <>
          <ModalDialogClose className="btn btn--outline" initialFocus>
            {t('account.common.cancel')}
          </ModalDialogClose>
          <ModalDialogAction
            className="btn btn--danger"
            pendingLabel={t('account.members.remove.pending')}
            action={confirmRemove}
            onError={(): void => setFailed(true)}
          >
            {t('account.members.remove.confirm')}
          </ModalDialogAction>
        </>
      }
    >
      <p className="m-0">
        {richText(t('account.members.remove.body'), {
          name: <strong>{memberName}</strong>,
          email: memberEmail,
        })}
      </p>
      <div role="status">
        {failed ? <p className="mt-2 mb-0 text-[13px] text-bad">{t('account.members.removeFailed')}</p> : null}
      </div>
    </ModalDialog>
  );
}
