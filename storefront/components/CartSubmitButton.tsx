'use client';

import { type CSSProperties, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Submit button for a `<form action={serverAction}>` add-to-cart form. Reads the
 * parent form's pending state via `useFormStatus`, so while the server action is
 * in flight the button is disabled and shows an inline spinner in place of its
 * icon (task: PDP add-to-cart needs an "adding…" indicator). Must be rendered as
 * a child of the `<form>` whose status it reflects.
 */
export function CartSubmitButton({
  className,
  style,
  label,
  pendingLabel,
  icon,
}: {
  className?: string;
  style?: CSSProperties;
  label: string;
  /** Optional label shown while the add is in flight; falls back to `label`. */
  pendingLabel?: string;
  /** Idle-state leading icon (replaced by the spinner while pending). */
  icon?: ReactNode;
}): ReactNode {
  const { pending } = useFormStatus();
  return (
    <button
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
