import type { CartApprovalStatus, OrganizationPermissionPort } from '@endora-commerce/contracts';

/** The one read the approval rule is judged from. */
export interface CartApprovalPolicyReads {
  /** `organizations`' permission port — the buyer's `carts.order_without_approval`. */
  readonly permissions: Pick<OrganizationPermissionPort, 'can'>;
}

/**
 * Whose basket the rule is judged for. `organizationRoleId` is the buyer's role
 * when the caller already knows it — the requester's own, which the auth hook
 * stamps on the actor (research R-15). With it the port judges from its cache
 * alone; without it the port reads the account first, which is a read per
 * request on the cart path (FR-080, SC-004).
 */
export interface CartApprovalBuyer {
  readonly customerAccountId: string;
  readonly organizationId: string;
  readonly organizationRoleId?: string | null;
}

/**
 * Whether `buyer`'s basket must be approved before it is ordered: their role
 * does not hold `carts.order_without_approval` (`specs/170-organization-roles/`,
 * OR-3; research R-4, which replaced the Organization's `requires_cart_approval`
 * flag and the administrator exemption — an administrator holds every code).
 * The one statement of the rule: submit-for-approval refuses on it, the cart's
 * primary call to action reads it, and placement refuses a basket it applies
 * to that is not `approved` (issues #619, #648).
 *
 * A buyer whose role cannot be found fails closed — `can` answers `false` — so
 * their basket needs approval.
 */
export async function approvalSubmissionRequired(
  reads: CartApprovalPolicyReads,
  buyer: CartApprovalBuyer,
): Promise<boolean> {
  return !(await reads.permissions.can(
    {
      customerAccountId: buyer.customerAccountId,
      organizationId: buyer.organizationId,
      ...(buyer.organizationRoleId ? { organizationRoleId: buyer.organizationRoleId } : {}),
    },
    'carts.order_without_approval',
  ));
}

/**
 * Issue #648 — whether a basket still awaits approval and so may not be placed:
 * the rule applies to its owner and it is not `approved`. A basket with no
 * owner (an anonymous one) is never placed and is not this rule's to refuse.
 *
 * Judged on the owner's permission **now**, never on the stored approval state
 * alone (research R-25): a `pending` basket whose owner has since gained the
 * code is placeable even if the cascade that returns it to `not_required`
 * never ran.
 */
export async function basketAwaitsApproval(
  reads: CartApprovalPolicyReads,
  input: {
    cart: { customerAccountId: string | null; approvalStatus: CartApprovalStatus };
    organizationId: string;
    /** The owner's role, when the caller knows it (FR-080; see `CartApprovalBuyer`). */
    organizationRoleId?: string | null;
  },
): Promise<boolean> {
  if (input.cart.approvalStatus === 'approved') return false;
  if (input.cart.customerAccountId === null) return false;
  return approvalSubmissionRequired(reads, {
    customerAccountId: input.cart.customerAccountId,
    organizationId: input.organizationId,
    organizationRoleId: input.organizationRoleId ?? null,
  });
}
