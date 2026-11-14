import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { ModalDialog, ModalDialogAction, ModalDialogClose } from '../ModalDialog';

/**
 * The confirmation shared by the two rows of `/organization/members` that end
 * someone's way into the Organization: removing a member (issue #1178) and
 * revoking a pending invitation (issue #1214). Both take effect at once, so the
 * row's button opens a `ModalDialog` alertdialog (issue #804) instead of
 * posting: it opens on Cancel, names whom it is about, and its confirm runs the
 * page's server action through `ModalDialogAction` — the pending label until it
 * finishes, nothing able to dismiss it meanwhile, and a message with a retry if
 * the request itself fails. A refusal the API answers arrives as the action's
 * own `?error=` redirect.
 *
 * A plain function, not a component: each caller owns its one piece of state
 * (`failed`) and returns this tree, which keeps the dialog's structure in one
 * place and lets the wiring tests reach the `ModalDialog` in the tree they get.
 */
export function accessConfirmDialog(props: {
  locale: string;
  /** The row's destructive button class, so the trigger looks as it did. */
  triggerClassName?: string | undefined;
  /** The form field the action reads, and its value. */
  field: { name: string; value: string };
  action: (formData: FormData) => void | Promise<void>;
  copy: { trigger: string; title: string; body: ReactNode; confirm: string; pending: string; failed: string };
  failed: boolean;
  setFailed: (failed: boolean) => void;
}): ReactNode {
  const t = tForLocale(props.locale);

  const confirm = async (): Promise<void> => {
    props.setFailed(false);
    const formData = new FormData();
    formData.set(props.field.name, props.field.value);
    await props.action(formData);
  };

  return (
    <ModalDialog
      triggerLabel={props.copy.trigger}
      {...(props.triggerClassName ? { triggerClassName: props.triggerClassName } : {})}
      title={props.copy.title}
      closeLabel={t('account.common.close')}
      role="alertdialog"
      footer={
        <>
          <ModalDialogClose className="btn btn--outline" initialFocus>
            {t('account.common.cancel')}
          </ModalDialogClose>
          <ModalDialogAction
            className="btn btn--danger"
            pendingLabel={props.copy.pending}
            action={confirm}
            onError={(): void => props.setFailed(true)}
          >
            {props.copy.confirm}
          </ModalDialogAction>
        </>
      }
    >
      <p className="m-0">{props.copy.body}</p>
      <div role="status">
        {props.failed ? <p className="mt-2 mb-0 text-[13px] text-bad">{props.copy.failed}</p> : null}
      </div>
    </ModalDialog>
  );
}
