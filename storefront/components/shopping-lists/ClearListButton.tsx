'use client';

import { useTransition, type ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { ModalDialog, ModalDialogClose } from '../ModalDialog';

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
 * Confirming invokes the `clearAction` server action inside a transition
 * (rather than a plain `<form>` submit) held by this component, then closes
 * the dialog. Closing only hides the dialog, so it cannot abort the in-flight
 * action — the version before the portal fix closed it in the submit button's
 * onClick, which cancelled the clear before it ran. The server action's
 * redirect refreshes the page with the now-empty list.
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
  const [pending, startTransition] = useTransition();

  const confirmClear = (): void => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('listId', listId);
      await clearAction(formData);
    });
  };

  return (
    <ModalDialog
      triggerLabel={t('account.shoppingList.clear.button')}
      triggerClassName="btn btn--outline"
      title={t('account.shoppingList.clear.title')}
      closeLabel={t('account.common.close')}
      role="alertdialog"
      dismissible={!pending}
      footer={
        <>
          <ModalDialogClose className="btn btn--outline" disabled={pending} initialFocus>
            {t('account.common.cancel')}
          </ModalDialogClose>
          <ModalDialogClose className="btn btn--danger" disabled={pending} onClick={confirmClear}>
            {pending ? t('account.shoppingList.clear.pending') : t('account.shoppingList.clear.button')}
          </ModalDialogClose>
        </>
      }
    >
      <p className="m-0">{t('account.shoppingList.clear.body')}</p>
    </ModalDialog>
  );
}
