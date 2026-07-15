'use client';

import { type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { trackPlaceOrderClicked } from '../../lib/analytics/ecommerce';

/**
 * Feature 049 — capture the checkout submission fields (the same data posted to
 * the server) for the `place_order_clicked` custom-event trigger. File inputs
 * are skipped (FR-018); only string form values are forwarded.
 */
function capturePlaceOrder(ev: MouseEvent<HTMLButtonElement>): void {
  const form = ev.currentTarget.form;
  if (!form) return;
  const payload: Record<string, string> = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === 'string') payload[key] = value;
  }
  trackPlaceOrderClicked(payload);
}

/**
 * Submit button for the checkout `<form action={submitAction}>`. Reads the
 * parent form's pending state via `useFormStatus`, so once the buyer clicks
 * "Place order" the button is disabled and shows an inline spinner with a
 * "Placing order…" label while the server action is in flight (task: checkout
 * "Place Order" needs a progress indicator so it's clear the process is
 * running). Must be rendered as a child of the `<form>` whose status it
 * reflects.
 *
 * `canTransact` reflects the organization moderation gate — when false the
 * button stays disabled regardless of pending state.
 */
export function PlaceOrderButton({
  canTransact,
  label,
  pendingLabel,
  title,
}: {
  canTransact: boolean;
  label: string;
  /** Label shown while the order placement is in flight. */
  pendingLabel: string;
  /** Tooltip shown when ordering is unavailable (moderation gate). */
  title?: string;
}): ReactNode {
  const { pending } = useFormStatus();
  const disabled = !canTransact || pending;
  const style: CSSProperties | undefined = !canTransact
    ? { opacity: 0.6, cursor: 'not-allowed' }
    : undefined;
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-disabled={disabled}
      aria-busy={pending || undefined}
      aria-live="polite"
      title={!canTransact ? title : undefined}
      style={style}
      onClick={capturePlaceOrder}
    >
      {pending ? <Spinner /> : null}
      {pending ? pendingLabel : label}
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
