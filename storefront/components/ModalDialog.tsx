'use client';

import { unstable_rethrow } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
  type Ref,
} from 'react';

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
 * `ModalDialogClose` and `ModalDialogAction`, mark a destructive confirmation
 * `role="alertdialog"`, and turn `dismissible` off while a submit is in
 * flight. A `ModalDialogAction` running marks the dialog busy, which does the
 * same and also disables every `ModalDialogClose`. The element that
 * should take focus on open carries `data-autofocus` — the least destructive
 * action of a confirmation, the first field of a form; without one the browser
 * focuses the first focusable element, the close button.
 */

interface ModalDialogApi {
  close: () => void;
  /** An action in the dialog is in flight: nothing may dismiss it. */
  busy: boolean;
  setBusy: (busy: boolean) => void;
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
  const [busy, setBusy] = useState(false);
  const dismissible = (props.dismissible ?? true) && !busy;
  const isAlert = props.role === 'alertdialog';
  const api: ModalDialogApi = { close: (): void => dialogRef.current?.close(), busy, setBusy };

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
        className={props.triggerClassName ?? 'b2b-dialog__trigger b2b-account__link'}
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
      disabled={Boolean(props.disabled) || Boolean(dialog?.busy)}
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

/** A Next.js redirect / not-found signal rather than a failure: it must reach the router. */
function isNavigationSignal(err: unknown): boolean {
  try {
    unstable_rethrow(err);
  } catch {
    return true;
  }
  return false;
}

/**
 * The confirm of a `ModalDialog` whose action takes a round trip — a server
 * action that clears or deletes, then redirects (rulings on PR #837).
 *
 * While the action is in flight the dialog stays open and says so: this
 * button shows `pendingLabel`, disabled and `aria-busy`, and the dialog is
 * busy — Escape, the backdrop, the close button and every `ModalDialogClose`
 * are held (Doherty Threshold: no plain-looking control during a request, and
 * no double submit). When the action finishes the dialog closes. A redirect
 * the action ends in is rethrown for the router — the transition is what
 * carries it there — after closing the dialog, which may outlive a redirect
 * to the page it is on. Any other failure is handed to `onError` and the
 * dialog stays open with its buttons enabled again, for a retry.
 *
 * The transition is held by this component, which stays mounted while the
 * dialog is closed, so closing can never abort the action.
 */
export function ModalDialogAction(props: {
  children: ReactNode;
  /** The label while the action is in flight ("Clearing…"). */
  pendingLabel: ReactNode;
  className?: string;
  action: () => unknown;
  /** A failure that is not a redirect; the dialog stays open. */
  onError?: (err: unknown) => void;
}): ReactNode {
  const dialog = useContext(ModalDialogContext);
  const [pending, startTransition] = useTransition();
  const setBusy = dialog?.setBusy;

  useEffect(() => {
    setBusy?.(pending);
  }, [pending, setBusy]);

  return (
    <button
      type="button"
      className={props.className}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={(): void => {
        startTransition(async () => {
          try {
            await props.action();
          } catch (err) {
            if (isNavigationSignal(err)) {
              dialog?.close();
              throw err;
            }
            props.onError?.(err);
            return;
          }
          dialog?.close();
        });
      }}
    >
      {pending ? props.pendingLabel : props.children}
    </button>
  );
}
