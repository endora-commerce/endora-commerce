import type { ReactNode } from 'react';
import type { CartSummary } from '../lib/api/cart';
import { LocalizedLink } from '../lib/i18n/localized-link';

/** The `aria-describedby` targets — distinct, so a page that renders both never duplicates an id. */
const CHECKOUT_BLOCKED_ID = 'cart-checkout-blocked';
const APPROVAL_BLOCKED_ID = 'cart-approval-blocked';

export interface CartPrimaryCtaProps {
  cta: NonNullable<CartSummary['primaryCta']>;
  /** Whether the buyer has a valid customer session (resolved `/me`). */
  authenticated: boolean;
  canTransact: boolean;
  moderationMessage: string | null;
  submitAction: (formData: FormData) => Promise<void>;
  /**
   * Feature 155 — a line is below a minimum or its product is gone (`cartBlocksCheckout`).
   * Blocks checkout and, by the owner's ruling of 2026-10-18, submitting for approval too.
   */
  linesBlockCheckout: boolean;
  /** The visible sentence explaining `linesBlockCheckout` under the checkout control. */
  linesBlockedNote: string;
  /** The same explanation under the "Submit for approval" control. */
  approvalBlockedNote: string;
  strings: {
    checkout: string;
    submitForApproval: string;
    awaitingApproval: string;
    blockedByOrganization: string;
  };
}

/**
 * A primary control the basket's lines currently block: disabled, with no form behind it,
 * and the reason as visible text next to it, linked by `aria-describedby` — on the page, not
 * only in a tooltip.
 */
function BlockedPrimary({ label, noteId, note }: { label: string; noteId: string; note: string }): ReactNode {
  return (
    <>
      <button
        type="button"
        className="btn btn--dark btn--lg btn--block"
        disabled
        aria-disabled
        aria-describedby={noteId}
        style={{ opacity: 0.55, cursor: 'not-allowed' }}
      >
        {label}
      </button>
      <p id={noteId} className="m-0 mt-2 text-[12px] font-medium text-warn">
        {note}
      </p>
    </>
  );
}

/**
 * The cart page's primary CTA. Source of truth is the backend's `cart.primaryCta` field; the
 * page's fallback covers anonymous carts (the backend can't compute `primaryCta` without an org
 * context). Feature 027 T096; feature 155 blocks checkout and approval on the same verdict.
 *
 * `specs/170-organization-roles/` (FR-031, FR-057): `cta` alone decides between checkout and
 * "Submit for approval" — the backend derives it from the member's role
 * (`carts.order_without_approval`); the Organization-wide approval flag this used to accept beside
 * it is gone.
 */
export function CartPrimaryCta({
  cta,
  authenticated,
  canTransact,
  moderationMessage,
  submitAction,
  linesBlockCheckout,
  linesBlockedNote,
  approvalBlockedNote,
  strings,
}: CartPrimaryCtaProps): ReactNode {
  if (!canTransact || cta === 'blocked_by_organization') {
    return (
      <button
        type="button"
        className="btn btn--dark btn--lg btn--block"
        disabled
        aria-disabled
        title={moderationMessage ?? strings.blockedByOrganization}
        style={{ opacity: 0.55, cursor: 'not-allowed' }}
      >
        {strings.blockedByOrganization}
      </button>
    );
  }
  if (cta === 'awaiting_approval') {
    return (
      <button type="button" className="btn btn--ghost btn--lg btn--block" disabled aria-disabled>
        {strings.awaitingApproval}
      </button>
    );
  }
  if (cta === 'submit_for_approval') {
    if (linesBlockCheckout) {
      // Owner ruling 2026-10-18 — a basket that cannot be ordered cannot be sent for approval
      // either; the server refuses it with the minimum code, so the control is not offered.
      return (
        <BlockedPrimary label={strings.submitForApproval} noteId={APPROVAL_BLOCKED_ID} note={approvalBlockedNote} />
      );
    }
    return (
      <form action={submitAction}>
        <button type="submit" className="btn btn--dark btn--lg btn--block">
          {strings.submitForApproval}
        </button>
      </form>
    );
  }
  if (linesBlockCheckout) {
    // Feature 155 (FR-013, FR-037) — placement would refuse this basket, so checkout is not
    // offered until the flagged lines are changed or removed.
    return <BlockedPrimary label={`${strings.checkout} →`} noteId={CHECKOUT_BLOCKED_ID} note={linesBlockedNote} />;
  }
  // /checkout requires a valid customer session, so when the buyer isn't authenticated (no
  // session, or a stale/expired session that `/me` rejected) route them through login first —
  // preserving the cart and returning to checkout via `?next` — instead of letting /checkout
  // bounce them to login unexpectedly.
  const checkoutHref = authenticated ? '/checkout' : '/login?next=/checkout';
  return (
    <LocalizedLink href={checkoutHref} className="btn btn--dark btn--lg btn--block">
      {strings.checkout} →
    </LocalizedLink>
  );
}
