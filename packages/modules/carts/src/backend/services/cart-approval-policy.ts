import type {
  CartApprovalStatus,
  CustomerAccountReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';

/** The two reads the approval policy is judged from. */
export interface CartApprovalPolicyReads {
  /** `organizations`' read model — the Organization's `requiresCartApproval`. */
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
  /** `customer_accounts`' read model — the buyer's role. */
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'findById'>;
}

/**
 * Whether `buyer`'s basket must be approved before it is ordered (issues #619,
 * #648): their Organization requires cart approval and they are not its
 * administrator. The one statement of the rule — submit-for-approval refuses on
 * it, the cart's primary call to action reads it, and placement refuses a basket
 * it applies to that is not `approved`.
 */
export async function approvalSubmissionRequired(
  reads: CartApprovalPolicyReads,
  buyer: { customerAccountId: string; organizationId: string },
): Promise<boolean> {
  const org = await reads.organizations.findById(buyer.organizationId);
  if (!org?.requiresCartApproval) return false;
  const account = await reads.customerAccounts.findById(buyer.customerAccountId);
  return account !== null && account !== undefined && account.role !== 'organization_admin';
}

/**
 * Issue #648 — whether a basket still awaits approval and so may not be placed:
 * the policy applies to its owner and it is not `approved`. A basket with no
 * owner (an anonymous one) is never placed and is not this rule's to refuse.
 */
export async function basketAwaitsApproval(
  reads: CartApprovalPolicyReads,
  input: {
    cart: { customerAccountId: string | null; approvalStatus: CartApprovalStatus };
    organizationId: string;
  },
): Promise<boolean> {
  if (input.cart.approvalStatus === 'approved') return false;
  if (input.cart.customerAccountId === null) return false;
  return approvalSubmissionRequired(reads, {
    customerAccountId: input.cart.customerAccountId,
    organizationId: input.organizationId,
  });
}
