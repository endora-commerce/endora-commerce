/**
 * CustomerAuthorityService — encodes WHICH staff member may act on a given
 * Customer (block / unblock / delete / org-assign), per the clarified rule
 * (spec FR-037, research §R2):
 *
 *   - A Platform Administrator may act on any customer. Whether the actor IS
 *     a platform admin is decided by the caller (route layer) and passed in —
 *     mirroring `SalesRepAssignmentService.canSeeOrganization`, which checks
 *     the assignment table only.
 *   - For a standalone (org-less) customer, any Salesperson may act.
 *   - For an org-bound customer, only the Salesperson responsible for that
 *     customer's Organization may act — "responsible" = assigned via
 *     `OrganizationSalesRepAssignment`, including the unassigned-org fallback
 *     (an org with zero assigned reps is visible to every Salesperson).
 *
 * The route layer is responsible for the coarse permission gate
 * (`requireAdmin('customers:manage')`) before this finer check runs.
 */

export interface SalesRepVisibility {
  canSeeOrganization(adminUserId: string, organizationId: string): Promise<boolean>;
}

export interface CustomerAuthorityInput {
  /** True when the acting admin is a Platform Administrator (caller-decided). */
  isPlatformAdmin: boolean;
  adminUserId: string;
  /** The target customer's Organization, or null for a standalone customer. */
  customerOrganizationId: string | null;
}

export class CustomerAuthorityService {
  constructor(private readonly salesReps: SalesRepVisibility) {}

  /**
   * True when the acting staff member is authorized to manage the customer.
   */
  async canManageCustomer(input: CustomerAuthorityInput): Promise<boolean> {
    if (input.isPlatformAdmin) return true;
    if (input.customerOrganizationId === null) return true;
    return this.salesReps.canSeeOrganization(
      input.adminUserId,
      input.customerOrganizationId,
    );
  }
}
