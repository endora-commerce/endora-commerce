'use client';

import { useState, type ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { richText } from '../../lib/account/labels';
import { ModalDialog, ModalDialogAction, ModalDialogClose } from '../ModalDialog';

/**
 * "Delete list" control for the shopping-lists overview. Renders a button that
 * opens a confirmation dialog before deleting a whole shopping list — deleting
 * a list is destructive and irreversible, so it must be confirmed.
 *
 * Mirrors `ClearListButton`: a `ModalDialog` alertdialog (issue #804) opening
 * on Cancel, whose confirm runs the `deleteAction` server action through
 * `ModalDialogAction` — "Deleting…" until it finishes, nothing able to dismiss
 * it meanwhile, and a retry with a message if the request itself fails.
 */
export function DeleteShoppingListButton({
  listId,
  listName,
  locale,
  deleteAction,
}: {
  listId: string;
  listName: string;
  /** The page language, from the server page that renders this (issue #85). */
  locale: string;
  deleteAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  const t = tForLocale(locale);
  const [failed, setFailed] = useState(false);

  const confirmDelete = async (): Promise<void> => {
    setFailed(false);
    const formData = new FormData();
    formData.set('id', listId);
    await deleteAction(formData);
  };

  return (
    <ModalDialog
      triggerLabel={t('account.shoppingList.delete.button')}
      triggerClassName="btn btn--outline btn--sm"
      title={t('account.shoppingList.delete.title')}
      closeLabel={t('account.common.close')}
      role="alertdialog"
      footer={
        <>
          <ModalDialogClose className="btn btn--outline" initialFocus>
            {t('account.common.cancel')}
          </ModalDialogClose>
          <ModalDialogAction
            className="btn btn--danger"
            pendingLabel={t('account.shoppingList.delete.pending')}
            action={confirmDelete}
            onError={(): void => setFailed(true)}
          >
            {t('account.shoppingList.delete.confirm')}
          </ModalDialogAction>
        </>
      }
    >
      <p className="m-0">
        {richText(t('account.shoppingList.delete.body'), { name: <strong>{listName}</strong> })}
      </p>
      <div role="status">
        {failed ? <p className="mt-2 mb-0 text-[13px] text-bad">{t('account.shoppingLists.deleteFailed')}</p> : null}
      </div>
    </ModalDialog>
  );
}
