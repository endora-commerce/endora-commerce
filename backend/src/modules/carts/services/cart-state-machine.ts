import type { CartStatus, CartApprovalStatus } from '../entities/cart.entity.js';

/**
 * Pure state-machine helpers for the carts module (feature 027 US4).
 *
 * The cart has two orthogonal axes:
 *   - main `status`:           active | abandoned | completed | rejected
 *   - `approval_status`:       not_required | pending | approved
 *                              | rejected_by_org_admin
 *
 * Production transitions are implemented by `CartService`,
 * `CartApprovalService`, and the abandonment worker — all DB-coupled.
 * This module exposes the same invariants as pure functions so the
 * matrix can be unit-tested (feature 027 T084 / T085) and so callers
 * (route handlers, audit-row builders) can reach decisions without
 * duplicating the inline branching.
 */

export type ApprovalEvent =
  | 'submit'
  | 'approve'
  | 'reject'
  | 'buyer_mutation'
  | 'policy_off'
  | 'policy_on';

export type ApprovalTransitionFailure =
  | 'already_terminal'
  | 'already_initiated'
  | 'not_pending'
  | 'not_applicable';

export type ApprovalTransitionResult =
  | { ok: true; next: CartApprovalStatus }
  | { ok: false; reason: ApprovalTransitionFailure };

/**
 * Returns the post-event approval state for a cart whose current
 * approval state is `from`. Pre-flight checks (policy on, cart not
 * empty, buyer-not-org-admin, etc.) live in the service layer; this
 * function captures only the FSM legality of (state, event) pairs.
 */
export function nextApprovalState(
  from: CartApprovalStatus,
  event: ApprovalEvent,
): ApprovalTransitionResult {
  if (from === 'rejected_by_org_admin') {
    // Terminal on the approval axis. No event re-opens it; a new cart
    // must be created.
    return { ok: false, reason: 'already_terminal' };
  }

  switch (event) {
    case 'submit':
      if (from === 'not_required') return { ok: true, next: 'pending' };
      return { ok: false, reason: 'already_initiated' };

    case 'approve':
      if (from === 'pending') return { ok: true, next: 'approved' };
      return { ok: false, reason: 'not_pending' };

    case 'reject':
      if (from === 'pending') return { ok: true, next: 'rejected_by_org_admin' };
      return { ok: false, reason: 'not_pending' };

    case 'buyer_mutation':
      // Re-arm rule: any buyer-driven mutation on an `approved` cart
      // silently drops it back to `pending`. Any other state is a no-op
      // (the service short-circuits before calling).
      if (from === 'approved') return { ok: true, next: 'pending' };
      return { ok: false, reason: 'not_applicable' };

    case 'policy_off':
      // Turning the org-wide policy off resets every pending/approved
      // cart back to not_required. not_required carts stay put.
      if (from === 'pending' || from === 'approved') {
        return { ok: true, next: 'not_required' };
      }
      return { ok: false, reason: 'not_applicable' };

    case 'policy_on':
      // Turning the policy on does NOT auto-flip existing not_required
      // carts to pending — the buyer must explicitly submit. The hook
      // exists so audit-row builders can decide whether to record a
      // pure policy-change event.
      return { ok: false, reason: 'not_applicable' };
  }
}

/**
 * Primary CTA the storefront should render. Pure function over the
 * cart's two-axis state. The route handler caches this on every cart
 * read; see `routes.ts.serializeCart`.
 */
export type PrimaryCta =
  | 'checkout'
  | 'submit_for_approval'
  | 'awaiting_approval'
  | 'blocked_by_organization';

export function derivePrimaryCta(input: {
  status: CartStatus;
  approvalStatus: CartApprovalStatus;
  requiresApproval?: boolean;
}): PrimaryCta {
  if (input.status === 'rejected' || input.status === 'completed') {
    return 'blocked_by_organization';
  }
  if (input.approvalStatus === 'pending') return 'awaiting_approval';
  if (input.approvalStatus === 'rejected_by_org_admin') {
    return 'blocked_by_organization';
  }
  // `not_required` and `approved` both → checkout. The
  // `submit_for_approval` CTA is only emitted when the Org policy is on
  // and the buyer has not yet submitted.
  if (input.approvalStatus === 'not_required' && input.requiresApproval === true) {
    return 'submit_for_approval';
  }
  return 'checkout';
}

/**
 * `true` when an `approved` cart should be silently re-armed to
 * `pending` because the buyer just mutated it. Lives here so the
 * various write paths (add / update / remove / coupon apply / coupon
 * clear) all agree on the same rule.
 */
export function shouldReArmOnBuyerMutation(
  approvalStatus: CartApprovalStatus,
): boolean {
  return approvalStatus === 'approved';
}
