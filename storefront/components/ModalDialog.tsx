'use client';

import { createContext, useContext, useId, useRef, type ReactNode, type Ref } from 'react';

/**
 * A button that opens its server-rendered content in a modal dialog (issue #801).
 *
 * Built on the native `<dialog>` opened with `showModal()`, so the browser
 * supplies what a hand-rolled overlay has to reimplement: the rest of the page
 * is inert while it is open (the focus trap), Escape closes it, and it sits in
 * the top layer, so no positioned ancestor can clip it. On close, focus goes
 * back to the trigger explicitly rather than relying on each browser's
 * restoration. While one is open the page behind it does not scroll — a
 * stylesheet rule on `html:has(.b2b-dialog[open])`, so there is no lock for a
 * script to forget to release.
 *
 * `children` arrive already rendered — typically by a Server Component — and
 * are in the HTML on first paint, hidden until opened; this component holds no
 * data of its own. The trigger is a `<button>` because it opens something
 * rather than navigating, styled as a link where the caller asks for one.
 *
 * Confirmations and forms (issue #804) add a `footer` of actions built from
 * `ModalDialogClose`, mark a destructive confirmation `role="alertdialog"`,
 * and turn `dismissible` off while a submit is in flight. The element that
 * should take focus on open carries `data-autofocus` — the least destructive
 * action of a confirmation, the first field of a form; without one the browser
 * focuses the first focusable element, the close button.
 */

interface ModalDialogApi {
  close: () => void;
}

const ModalDialogContext = createContext<ModalDialogApi | null>(null);

export function ModalDialog(props: {
  /** The trigger's visible text. */
  triggerLabel: string;
  /** The dialog's heading, which also names it (`aria-labelledby`). */
  title: string;
  /** The close button's accessible name, in the page's language. */
  closeLabel: string;
  triggerClassName?: string;
  /**
   * `alertdialog` for a confirmation that interrupts to warn about an
   * irreversible action; the body then also describes it (`aria-describedby`).
   */
  role?: 'dialog' | 'alertdialog';
  /**
   * When false, Escape, a backdrop click and the close button leave the dialog
   * open — while a submit it started is still in flight. Default true.
   */
  dismissible?: boolean;
  /** The action row under the body, typically `ModalDialogClose` buttons. */
  footer?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const bodyId = `${dialogId}-body`;
  const dismissible = props.dismissible ?? true;
  const isAlert = props.role === 'alertdialog';
  const api: ModalDialogApi = { close: (): void => dialogRef.current?.close() };

  const open = (): void => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-controls={dialogId}
        className={props.triggerClassName ?? 'b2b-dialog__trigger'}
        onClick={open}
      >
        {props.triggerLabel}
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        role={isAlert ? 'alertdialog' : undefined}
        aria-labelledby={titleId}
        aria-describedby={isAlert ? bodyId : undefined}
        className="b2b-dialog"
        onCancel={(e): void => {
          // Escape arrives as `cancel`; refusing it keeps an in-flight submit's dialog up.
          if (!dismissible) e.preventDefault();
        }}
        onClose={(): void => triggerRef.current?.focus()}
        onClick={(e): void => {
          // A click on the backdrop lands on the <dialog> itself; the content sits in a child.
          if (dismissible && e.target === e.currentTarget) api.close();
        }}
      >
        <div className="b2b-dialog__inner">
          <div className="b2b-dialog__head">
            <h2 id={titleId} className="b2b-dialog__title">
              {props.title}
            </h2>
            <button
              type="button"
              className="icon-btn"
              aria-label={props.closeLabel}
              disabled={!dismissible}
              onClick={api.close}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width={20}
                height={20}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <ModalDialogContext value={api}>
            <div id={bodyId} className="b2b-dialog__body">
              {props.children}
            </div>
            {props.footer ? <div className="b2b-dialog__foot">{props.footer}</div> : null}
          </ModalDialogContext>
        </div>
      </dialog>
    </>
  );
}

/**
 * A button that closes the `ModalDialog` it sits in — a Cancel, or a confirm
 * whose `onClick` dispatches its action first and then closes. The action is
 * the caller's to keep alive (a transition held by the still-mounted caller):
 * closing only hides the dialog, it does not unmount anything.
 */
export function ModalDialogClose(props: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** Runs before the dialog closes. */
  onClick?: () => void;
  /** This button takes focus when the dialog opens (`data-autofocus`). */
  initialFocus?: boolean;
  ref?: Ref<HTMLButtonElement>;
}): ReactNode {
  const dialog = useContext(ModalDialogContext);
  return (
    <button
      ref={props.ref}
      type="button"
      className={props.className}
      disabled={props.disabled}
      data-autofocus={props.initialFocus ? '' : undefined}
      onClick={(): void => {
        props.onClick?.();
        dialog?.close();
      }}
    >
      {props.children}
    </button>
  );
}
