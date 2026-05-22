import type { ReactNode } from 'react';

/**
 * CartCouponInput (feature 027 US2).
 *
 * Server-component-friendly coupon input. Dispatches a Next.js server
 * action that calls `applyCartCoupon` / `clearCartCoupon`. The component
 * shows the active code when present, an inline reason-specific error
 * after a failed apply, and an "auto-dropped" notice when the cart-side
 * `couponDroppedThisRead` field is set (the GET handler dropped a
 * previously-valid code because the cart fell below min spend / the
 * promotion expired / etc.).
 *
 * Browser-verification note: visual states (active / error /
 * auto-dropped) need eyes; the data flow is straight server-action +
 * `<form>` submission so RTL coverage would be limited. The unit test
 * for the api client (`applyCartCoupon`) lives next to its callers.
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
    <div className="b2b-cart__coupon" style={{ marginTop: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{strings.label}</h2>

      {droppedOnRead ? (
        <p className="b2b-cart__coupon-notice" style={{ color: '#a06000' }}>
          {strings.autoDropped(droppedOnRead.code, droppedOnRead.reason)}
        </p>
      ) : null}

      {appliedCode ? (
        <form action={clearAction} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="b2b-cart__coupon-active">{strings.activeCode(appliedCode)}</span>
          <button type="submit">{strings.clearButton}</button>
        </form>
      ) : (
        <form action={applyAction} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="text"
            name="code"
            placeholder={strings.placeholder}
            required
            pattern="[A-Z0-9_-]{1,64}"
            style={{ width: '12rem' }}
          />
          <button type="submit">{strings.applyButton}</button>
        </form>
      )}

      {applyError ? (
        <p className="b2b-auth__error" style={{ marginTop: '0.5rem' }}>
          {strings.rejectedReason(applyError.reason, applyError.shortfall)}
        </p>
      ) : null}
    </div>
  );
}
