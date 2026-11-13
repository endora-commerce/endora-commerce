import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { ModalDialog } from '../modal-dialog/ModalDialog.js';

/**
 * A yes/no question asked in the admin's own dialog rather than the browser's
 * native `confirm()` (issue #313).
 *
 * Built on {@link ModalDialog}, so it inherits the accessible name, the focus
 * trap, Escape and the scrim as *Cancel*, and focus returned to the opener. The
 * question is the dialog's description (`aria-describedby`), read with the title
 * when focus enters. A **destructive** question opens with focus on *Cancel*,
 * so Enter on a dialog opened by accident keeps the data — the destructive
 * answer has to be chosen, not defaulted into; any other question opens on the
 * confirm button, as the native dialog did.
 *
 * It renders into `document.body` through a portal, so a call site may sit
 * anywhere — inside a table row or a list item — without nesting a `<div>`
 * where the markup does not allow one.
 *
 * Two ways to use it: controlled, as `<ConfirmDialog …/>`, by a screen that runs
 * the action itself and wants the dialog to stay open with a `busy` state and
 * an `error` while the request is in flight; or through
 * {@link useConfirmDialog}, whose `await confirm({…})` is the drop-in for a
 * `window.confirm(…)` that guards an action.
 */
export interface ConfirmOptions {
  /** The dialog's title. Defaults to the core bundle's `common.confirm.title`. */
  title?: ReactNode;
  /** The question, naming the object and the consequence. */
  message: ReactNode;
  /** The confirm button's label. Defaults to `common.action.confirm`. */
  confirmLabel?: ReactNode;
  /** The cancel button's label. Defaults to `common.action.cancel`. */
  cancelLabel?: ReactNode;
  /** Styles the confirm button as destructive and opens with focus on *Cancel*. */
  destructive?: boolean;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void;
  /** Cancel, Escape and the scrim. */
  onCancel: () => void;
  /** While `true` both buttons, Escape and the scrim are inert. */
  busy?: boolean;
  /** Shown inside the dialog, announced as an alert. */
  error?: ReactNode;
}

export function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  const { title, message, confirmLabel, cancelLabel, destructive = false, onConfirm, onCancel, busy = false, error } = props;
  const t = useTranslation('core');
  const messageId = useId();
  const errorId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const hasError = error !== null && error !== undefined && error !== false && error !== '';

  return createPortal(
    <ModalDialog
      title={title ?? t('common.confirm.title')}
      onClose={onCancel}
      busy={busy}
      initialFocusRef={destructive ? cancelRef : confirmRef}
      aria-describedby={hasError ? `${messageId} ${errorId}` : messageId}
      footer={
        <>
          <Button ref={cancelRef} type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t('common.action.cancel')}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : null}
            {confirmLabel ?? t('common.action.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div id={messageId}>{message}</div>
        {/* Mounted before it has text, so an error that arrives is announced. */}
        <p id={errorId} role="alert" className="text-destructive">
          {hasError ? error : null}
        </p>
      </div>
    </ModalDialog>,
    document.body,
  );
}

export interface UseConfirmDialog {
  /** Opens the dialog; resolves `true` on confirm, `false` on Cancel, Escape, the scrim or unmount. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Render this once in the screen that calls `confirm`. */
  confirmDialog: ReactNode;
}

interface Pending {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

/**
 * The promise-returning form of {@link ConfirmDialog}:
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirmDialog();
 * …
 * if (!(await confirm({ message: t('x.deleteConfirm'), confirmLabel: tc('common.action.delete'), destructive: true }))) return;
 * …
 * return <>{…}{confirmDialog}</>;
 * ```
 *
 * A second `confirm` while one is open answers the first `false`. A question
 * still open when the screen unmounts is answered `false`, so no caller is left
 * awaiting forever.
 */
export function useConfirmDialog(): UseConfirmDialog {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((ok: boolean): void => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(ok);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false);
        const next = { options, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  useEffect(
    () => (): void => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  const confirmDialog = pending ? (
    <ConfirmDialog {...pending.options} onConfirm={(): void => settle(true)} onCancel={(): void => settle(false)} />
  ) : null;

  return { confirm, confirmDialog };
}
