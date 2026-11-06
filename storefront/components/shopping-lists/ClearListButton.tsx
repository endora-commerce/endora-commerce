'use client';

import { useState, type ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { ModalDialog, ModalDialogAction, ModalDialogClose } from '../ModalDialog';

/**
 * "Clear list" control for the shopping-list detail page. Renders a button
 * that opens a confirmation dialog before emptying the whole list — clearing
 * every item is destructive and irreversible, so it must be confirmed.
 *
 * The dialog is `ModalDialog` (issue #804): a native modal `<dialog>` in the
 * top layer, so no account-panel ancestor can trap its backdrop, with the
 * focus trap, Escape and focus return that come with it. It is an
 * `alertdialog`, and focus opens on Cancel — the least destructive choice.
 *
 * Confirming invokes the `clearAction` server action through
 * `ModalDialogAction` (rather than a plain `<form>` submit): the dialog stays
 * open showing "Clearing…", with nothing able to dismiss it, until the action
 * finishes (rulings on PR #837). The server action's redirect refreshes the
 * page with the now-empty list, or with `?error=` for a refusal it reports
 * itself. A failure that never reached the action — the request itself —
 * keeps the dialog open, says so, and re-enables it for a retry.
 */
export function ClearListButton({
  listId,
  locale,
  clearAction,
}: {
  listId: string;
  /** The page language, from the server page that renders this (issue #85). */
  locale: string;
  clearAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  const t = tForLocale(locale);
  const [failed, setFailed] = useState(false);

  const confirmClear = async (): Promise<void> => {
    setFailed(false);
    const formData = new FormData();
    formData.set('listId', listId);
    await clearAction(formData);
  };

  return (
    <ModalDialog
      triggerLabel={t('account.shoppingList.clear.button')}
      triggerClassName="btn btn--outline"
      title={t('account.shoppingList.clear.title')}
      closeLabel={t('account.common.close')}
      role="alertdialog"
      footer={
        <>
          <ModalDialogClose className="btn btn--outline" initialFocus>
            {t('account.common.cancel')}
          </ModalDialogClose>
          <ModalDialogAction
            className="btn btn--danger"
            pendingLabel={t('account.shoppingList.clear.pending')}
            action={confirmClear}
            onError={(): void => setFailed(true)}
          >
            {t('account.shoppingList.clear.button')}
          </ModalDialogAction>
        </>
      }
    >
      <p className="m-0">{t('account.shoppingList.clear.body')}</p>
      <div role="status">
        {failed ? <p className="mt-2 mb-0 text-[13px] text-bad">{t('account.shoppingList.clearFailed')}</p> : null}
      </div>
    </ModalDialog>
  );
}
