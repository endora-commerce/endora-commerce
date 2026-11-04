import type { ReactNode } from 'react';
import type { CartSummary } from '../lib/api/cart';

/**
 * CartApprovalBanner (feature 027 US4).
 *
 * Server-rendered banner that reflects the cart's `approval_status`
 * sub-state. Variants:
 *   - `pending`            — "Your cart is awaiting approval in your
 *                            organization."
 *   - `approved`           — "Your cart has been approved and is ready
 *                            for checkout."
 *   - `rejected_by_org_admin` — "Your cart was rejected by an approver
 *                            in your organization." (with reason)
 *   - `not_required` with `primaryCta: 'submit_for_approval'` — "Your
 *                            role requires approval…" plus the submit.
 *
 * `specs/170-organization-roles/` (FR-031, FR-057): whether a basket must be
 * sent is the member's **role** — it lacks `carts.order_without_approval` —
 * and the backend says so in `primaryCta`. The banner follows that field
 * alone; the Organization-wide *requires cart approval* switch is gone and
 * nothing here reads it. An approver is anyone holding `carts.approve`, not
 * only the administrator, so the copy no longer names the administrator.
 *
 * Browser-verification note: visual layout / styling needs eyes; the
 * variant-selection logic is the only thing worth unit-testing.
 */

export type CartApprovalStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected_by_org_admin';

interface CartApprovalBannerProps {
  approvalStatus: CartApprovalStatus;
  /**
   * The cart's `primaryCta` (FR-057). `'submit_for_approval'` on a `not_required` basket shows
   * the submit prompt; anything else — `undefined` for a guest basket included — does not.
   */
  primaryCta: CartSummary['primaryCta'];
  /** Rejection reason persisted on the cart record. */
  rejectedReason: string | null;
  /** Server action — used only when `primaryCta === 'submit_for_approval'` on a `not_required` basket. */
  submitForApprovalAction: (formData: FormData) => Promise<void>;
  /**
   * Feature 155, owner ruling 2026-10-18 — set while a cart line is below a minimum or its
   * product is gone (`cartBlocksCheckout`): the submit button is disabled, with no form behind
   * it, and this visible sentence is linked to it by `aria-describedby`.
   */
  linesBlockedNote?: string | null;
  /** Locale-aware strings. */
  strings: {
    pending: string;
    approved: string;
    rejected: (reason: string | null) => string;
    submissionRequired: string;
    submitButton: string;
  };
}

export function CartApprovalBanner({
  approvalStatus,
  primaryCta,
  rejectedReason,
  submitForApprovalAction,
  linesBlockedNote = null,
  strings,
}: CartApprovalBannerProps): ReactNode {
  const base = 'mb-3 rounded-sm border px-[14px] py-[12px] text-[13px]';
  if (approvalStatus === 'pending') {
    return (
      <div className={`${base} border-[#fde68a] bg-[#fef7e7] text-[#b45309]`} role="status">
        {strings.pending}
      </div>
    );
  }
  if (approvalStatus === 'approved') {
    return (
      <div className={`${base} border-[#bbf7d0] bg-[#ecfdf3] text-ok`} role="status">
        {strings.approved}
      </div>
    );
  }
  if (approvalStatus === 'rejected_by_org_admin') {
    return (
      <div className={`${base} border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]`} role="alert">
        {strings.rejected(rejectedReason)}
      </div>
    );
  }
  if (primaryCta === 'submit_for_approval' && approvalStatus === 'not_required') {
    return (
      <div
        className={`${base} flex items-center justify-between gap-[10px] border-line bg-surface-alt text-fg-soft`}
        role="status"
      >
        <span>{strings.submissionRequired}</span>
        {linesBlockedNote ? (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              className="btn btn--dark btn--sm"
              disabled
              aria-disabled
              aria-describedby="cart-approval-banner-blocked"
              style={{ opacity: 0.55, cursor: 'not-allowed' }}
            >
              {strings.submitButton}
            </button>
            <p id="cart-approval-banner-blocked" className="m-0 text-[12px] font-medium text-warn">
              {linesBlockedNote}
            </p>
          </div>
        ) : (
          <form action={submitForApprovalAction}>
            <button type="submit" className="btn btn--dark btn--sm">
              {strings.submitButton}
            </button>
          </form>
        )}
      </div>
    );
  }
  return null;
}
