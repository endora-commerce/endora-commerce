import type {
  CustomerAccountReadPort,
  CustomerAccountRecord,
  OrganizationDetailsPort,
  OrganizationRoleReadPort,
} from '@endora-commerce/contracts';

/**
 * "Would this leave a company Organization without an administrator?" — the
 * one question `customers`' three depletion guards ask (deletion, blocking,
 * unassigning; `409 ORG_OWNER_DEPLETION`), spelled once
 * (`specs/170-organization-roles/` WP-03, T063/T120;
 * `contracts/commands-audit-events.md` §3).
 *
 * - **Administrator is the role, not the legacy column**: the account holds
 *   its Organization's *Administrator* role, and the others counted are its
 *   other holders (`countAdministrators`).
 * - **Blocked administrators do not count** (owner ruling): a blocked
 *   administrator cannot manage the Organization, so deleting, blocking or
 *   detaching the last *unblocked* one is refused alike.
 * - **Company Organizations only** (owner ruling PR-3, research R-34): a
 *   personal Organization's sole member holds *Administrator* by construction,
 *   and its depletion is that Organization's intended end
 *   (`anonymizeIfOrphaned`). Asking the role alone would refuse the deletion
 *   and blocking of every B2C customer.
 *
 * No `catch`: each read is another module's gated port, and an absent owner
 * must refuse the operation rather than let it through unguarded.
 */
export interface OrganizationDepletionGuardDeps {
  readonly accounts: Pick<CustomerAccountReadPort, 'countAdministrators'>;
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
  readonly organizationRoles: Pick<OrganizationRoleReadPort, 'predefinedRoleId'>;
}

export class OrganizationDepletionGuard {
  constructor(private readonly deps: OrganizationDepletionGuardDeps) {}

  /**
   * `true` when `customer` is an administrator of a company Organization and
   * no other active, unblocked administrator of it would remain.
   */
  async wouldLeaveWithoutAdministrator(
    customer: Pick<CustomerAccountRecord, 'id' | 'organizationId' | 'organizationRoleId'>,
  ): Promise<boolean> {
    const administratorRoleId = await this.deps.organizationRoles.predefinedRoleId(
      customer.organizationId,
      'administrator',
    );
    if (customer.organizationRoleId !== administratorRoleId) return false;
    const organization = await this.deps.organizations.findById(customer.organizationId);
    if (organization?.isPersonal === true) return false;
    const remaining = await this.deps.accounts.countAdministrators(customer.organizationId, {
      excludeCustomerAccountId: customer.id,
      activeOnly: true,
      notBlocked: true,
    });
    return remaining === 0;
  }
}
