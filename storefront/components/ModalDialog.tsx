'use client';

import { useId, useRef, type ReactNode } from 'react';

/**
 * A button that opens its server-rendered content in a modal dialog (issue #801).
 *
 * Built on the native `<dialog>` opened with `showModal()`, so the browser
 * supplies what a hand-rolled overlay has to reimplement: the rest of the page
 * is inert while it is open (the focus trap), Escape closes it, and it sits in
 * the top layer, so no positioned ancestor can clip it. On close, focus goes
 * back to the trigger explicitly rather than relying on each browser's
 * restoration.
 *
 * `children` arrive already rendered — typically by a Server Component — and
 * are in the HTML on first paint, hidden until opened; this component holds no
 * data of its own. The trigger is a `<button>` because it opens something
 * rather than navigating, styled as a link where the caller asks for one.
 */
export function ModalDialog(props: {
  /** The trigger's visible text. */
  triggerLabel: string;
  /** The dialog's heading, which also names it (`aria-labelledby`). */
  title: string;
  /** The close button's accessible name, in the page's language. */
  closeLabel: string;
  triggerClassName?: string;
  children: ReactNode;
}): ReactNode {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-controls={dialogId}
        className={props.triggerClassName ?? 'b2b-dialog__trigger'}
        onClick={(): void => dialogRef.current?.showModal()}
      >
        {props.triggerLabel}
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={titleId}
        className="b2b-dialog"
        onClose={(): void => triggerRef.current?.focus()}
        onClick={(e): void => {
          // A click on the backdrop lands on the <dialog> itself; the content sits in a child.
          if (e.target === e.currentTarget) dialogRef.current?.close();
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
              onClick={(): void => dialogRef.current?.close()}
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
          <div className="b2b-dialog__body">{props.children}</div>
        </div>
      </dialog>
    </>
  );
}
