'use client';

import { useTransition, type ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { richText } from '../../lib/account/labels';
import { ModalDialog, ModalDialogClose } from '../ModalDialog';

/**
 * "Delete list" control for the shopping-lists overview. Renders a button that
 * opens a confirmation dialog before deleting a whole shopping list — deleting
 * a list is destructive and irreversible, so it must be confirmed.
 *
 * Mirrors `ClearListButton`: a `ModalDialog` alertdialog (issue #804) opening
 * on Cancel, and the `deleteAction` server action runs inside a transition
 * this component holds, so closing the dialog can't abort the mutation.
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
  const [pending, startTransition] = useTransition();

  const confirmDelete = (): void => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('id', listId);
      await deleteAction(formData);
    });
  };

  return (
    <ModalDialog
      triggerLabel={t('account.shoppingList.delete.button')}
      triggerClassName="btn btn--outline btn--sm"
      title={t('account.shoppingList.delete.title')}
      closeLabel={t('account.common.close')}
      role="alertdialog"
      dismissible={!pending}
      footer={
        <>
          <ModalDialogClose className="btn btn--outline" disabled={pending} initialFocus>
            {t('account.common.cancel')}
          </ModalDialogClose>
          <ModalDialogClose className="btn btn--danger" disabled={pending} onClick={confirmDelete}>
            {pending ? t('account.shoppingList.delete.pending') : t('account.shoppingList.delete.confirm')}
          </ModalDialogClose>
        </>
      }
    >
      <p className="m-0">
        {richText(t('account.shoppingList.delete.body'), { name: <strong>{listName}</strong> })}
      </p>
    </ModalDialog>
  );
}
