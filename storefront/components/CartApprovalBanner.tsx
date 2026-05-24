import type { ReactNode } from 'react';

/**
 * CartApprovalBanner (feature 027 US4).
 *
 * Server-rendered banner that reflects the cart's `approval_status`
 * sub-state when the Organization's `requires_cart_approval` policy is
 * on. Variants:
 *   - `pending`            — "Your cart is awaiting approval by an
 *                            organization administrator."
 *   - `approved`           — "Your cart has been approved and is ready
 *                            for checkout."
 *   - `rejected_by_org_admin` — "Your cart was rejected by an
 *                            organization administrator." (with reason)
 *   - `not_required` with policy on — "Submit for approval before
 *                            checkout."
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
  /** True when the Organization's policy is on. */
  policyOn: boolean;
  /** Rejection reason persisted on the cart record. */
  rejectedReason: string | null;
  /** Server action — used only when policyOn && approvalStatus === 'not_required'. */
  submitForApprovalAction: (formData: FormData) => Promise<void>;
  /** Locale-aware strings. */
  strings: {
    pending: string;
    approved: string;
    rejected: (reason: string | null) => string;
    policyOn: string;
    submitButton: string;
  };
}

export function CartApprovalBanner({
  approvalStatus,
  policyOn,
  rejectedReason,
  submitForApprovalAction,
  strings,
}: CartApprovalBannerProps): ReactNode {
  if (approvalStatus === 'pending') {
    return (
      <div className="cart-approval-banner cart-approval-banner--pending" role="status">
        {strings.pending}
      </div>
    );
  }
  if (approvalStatus === 'approved') {
    return (
      <div className="cart-approval-banner cart-approval-banner--approved" role="status">
        {strings.approved}
      </div>
    );
  }
  if (approvalStatus === 'rejected_by_org_admin') {
    return (
      <div className="cart-approval-banner cart-approval-banner--rejected" role="alert">
        {strings.rejected(rejectedReason)}
      </div>
    );
  }
  if (policyOn && approvalStatus === 'not_required') {
    return (
      <div className="cart-approval-banner cart-approval-banner--policy" role="status">
        <span>{strings.policyOn}</span>
        <form action={submitForApprovalAction}>
          <button type="submit" className="btn btn--dark btn--sm">
            {strings.submitButton}
          </button>
        </form>
      </div>
    );
  }
  return null;
}
