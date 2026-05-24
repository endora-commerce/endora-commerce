import type { ReactNode } from 'react';

/**
 * CartCouponInput — Industria-themed coupon block (feature 027 US2).
 *
 * Embedded inside the `.cart-summary` aside (see cart page). Server-
 * component-friendly. Two states: input form (no active code) and an
 * active-code row with a clear button. Surfaces the auto-dropped-on-
 * read notice and the typed apply-error inline.
 */

interface CartCouponInputProps {
  appliedCode: string | null;
  /** Set when the GET handler silently dropped a previously-valid code. */
  droppedOnRead: {
    code: string;
    reason: string;
  } | null;
  /** Set after a failed apply — surfaces the typed reason. */
  applyError: {
    reason:
      | 'invalid_code'
      | 'expired'
      | 'below_min_spend'
      | 'wrong_channel'
      | 'wrong_customer_group'
      | 'wrong_organization'
      | 'coupon_format_invalid';
    shortfall?: { amount: number; currency: string };
  } | null;
  /** Server actions wired by the parent (the cart page). */
  applyAction: (formData: FormData) => Promise<void>;
  clearAction: (formData: FormData) => Promise<void>;
  /** Locale-aware strings (en/pl). */
  strings: {
    label: string;
    placeholder: string;
    applyButton: string;
    clearButton: string;
    activeCode: (code: string) => string;
    autoDropped: (code: string, reason: string) => string;
    rejectedReason: (reason: string, shortfall?: { amount: number; currency: string }) => string;
  };
}

export function CartCouponInput({
  appliedCode,
  droppedOnRead,
  applyError,
  applyAction,
  clearAction,
  strings,
}: CartCouponInputProps): ReactNode {
  return (
    <div className="cart-coupon">
      <h4>{strings.label}</h4>

      {appliedCode ? (
        <form action={clearAction} className="cart-coupon__active">
          <span>
            <code>{appliedCode}</code> · {strings.activeCode(appliedCode)}
          </span>
          <button type="submit" className="btn btn--ghost btn--sm">
            {strings.clearButton}
          </button>
        </form>
      ) : (
        <form action={applyAction} className="cart-coupon__form">
          <input
            type="text"
            name="code"
            placeholder={strings.placeholder}
            required
            pattern="[A-Z0-9_-]{1,64}"
          />
          <button type="submit" className="btn btn--dark btn--sm">
            {strings.applyButton}
          </button>
        </form>
      )}

      {droppedOnRead ? (
        <p className="cart-coupon__notice">
          {strings.autoDropped(droppedOnRead.code, droppedOnRead.reason)}
        </p>
      ) : null}

      {applyError ? (
        <p className="cart-coupon__error">
          {strings.rejectedReason(applyError.reason, applyError.shortfall)}
        </p>
      ) : null}
    </div>
  );
}
