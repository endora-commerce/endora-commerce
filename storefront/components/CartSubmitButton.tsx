'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Submit button for a `<form action={serverAction}>` add-to-cart form. Reads the
 * parent form's pending state via `useFormStatus`, so while the server action is
 * in flight the button is disabled and shows an inline spinner in place of its
 * icon (task: PDP add-to-cart needs an "adding…" indicator). Must be rendered as
 * a child of the `<form>` whose status it reflects.
 *
 * `trackNativeSubmit` (`specs/181-guest-complaints/` design review F-9): a form that posts
 * to a route handler — a string `action`, which works without JavaScript — gets no pending
 * state from `useFormStatus`. The button then listens for its form's `submit` and stays
 * pending until the page is left, or shown again from the back-forward cache. A submission
 * another handler cancelled (an upload still running) leaves it as it was. One pending
 * button, two trigger modes (Constitution IX).
 */
export function CartSubmitButton({
  className,
  style,
  label,
  pendingLabel,
  icon,
  trackNativeSubmit = false,
}: {
  className?: string;
  style?: CSSProperties;
  label: string;
  /** Optional label shown while the add is in flight; falls back to `label`. */
  pendingLabel?: string;
  /** Idle-state leading icon (replaced by the spinner while pending). */
  icon?: ReactNode;
  /** Pending from the form's native `submit` event, for a form posting to a route handler. */
  trackNativeSubmit?: boolean;
}): ReactNode {
  const { pending: actionPending } = useFormStatus();
  const [submitted, setSubmitted] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!trackNativeSubmit) return;
    const form = ref.current?.form;
    if (!form) return;
    const document = form.ownerDocument;
    // On the document, after the form's own listeners: a cancelled submission sends nothing.
    const onSubmit = (event: Event): void => {
      if (event.target === form && !event.defaultPrevented) setSubmitted(true);
    };
    const onShow = (): void => setSubmitted(false);
    document.addEventListener('submit', onSubmit);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('submit', onSubmit);
      window.removeEventListener('pageshow', onShow);
    };
  }, [trackNativeSubmit]);
  const pending = actionPending || submitted;
  return (
    <button
      ref={ref}
      type="submit"
      className={className}
      style={style}
      disabled={pending}
      aria-busy={pending || undefined}
      aria-live="polite"
    >
      {pending ? <Spinner /> : icon}
      {pending ? pendingLabel ?? label : label}
    </button>
  );
}

function Spinner(): ReactNode {
  return (
    <svg
      className="b2b-spin"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
