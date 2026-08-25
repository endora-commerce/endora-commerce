import {
  ERROR_CODES,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type OrganizationDetailsPort,
  type PersonalOrganizationPort,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CustomerAuthorityService } from './customer-authority-service.js';
import type { ModerationActor } from './customer-moderation-service.js';

/**
 * CustomerOrgAssignmentService — assign a Customer to an Organization, or
 * detach one from the company it belongs to (feature 040, US5 / FR-026). Both
 * actions are authority-checked and audited; detaching the last usable org
 * admin is refused (depletion guard, mirroring moderation).
 *
 * **D-178 redefined the second action.** `unassign` wrote
 * `organization_id = NULL` and produced an account with no tenant: it could not
 * place an order, submit an RFQ or read an address, it shared one filter bucket
 * with every other tenant-less account, and nothing ever gave it an
 * organisation back. The operator's intent — *this person no longer belongs to
 * that company* — is served exactly by moving them to their own single-member
 * personal organisation, which is what the operation does now, and what the
 * platform would have given them had they registered on their own.
 *
 * **Feature 075, Phase C — neither row is this module's.** The membership
 * column belongs to `customer_accounts` and the organisation it points at
 * belongs to `organizations`; both are reached through their published ports
 * now, and the audit row goes with the write. The authority checks and the
 * depletion guard stay here, because they are this module's policy.
 */
export class CustomerOrgAssignmentService {
  constructor(
    private readonly accounts: CustomerAccountReadPort,
    private readonly accountWrites: CustomerAccountLifecycleWritePort,
    private readonly organizations: OrganizationDetailsPort,
    private readonly authority: CustomerAuthorityService,
    /** D-178 — where a detached member goes. */
    private readonly personalOrganizations: PersonalOrganizationPort,
  ) {}

  async assign(
    customerAccountId: string,
    organizationId: string,
    actor: ModerationActor,
  ): Promise<CustomerAccountRecord> {
    const customer = await this.loadActive(customerAccountId);

    // Actor must be able to manage the customer in its CURRENT state and in
    // the TARGET organization.
    await this.assertAuthorized(actor, customer.organizationId);
    await this.assertAuthorized(actor, organizationId);

    const org = await this.organizations.findById(organizationId);
    if (!org) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
    }

    return this.accountWrites.setOrganization(customer.id, organizationId, {
      actorAdminUserId: actor.adminUserId,
    });
  }

  /**
   * Detach the customer from the company they belong to, moving them to their
   * own personal organisation (D-178).
   *
   * The destination is resolved before the depletion guard runs, so the refusal
   * an operator sees is still the depletion one and not a provisioning failure
   * underneath it. It is idempotent: a customer already in their own personal
   * organisation is returned unchanged, and no audit row is written for a move
   * that did not happen.
   */
  async unassign(
    customerAccountId: string,
    actor: ModerationActor,
  ): Promise<CustomerAccountRecord> {
    const customer = await this.loadActive(customerAccountId);
    await this.assertAuthorized(actor, customer.organizationId);

    const personal = await this.personalOrganizations.provisionPersonalOrganization(customer.id);
    if (customer.organizationId === personal.id) return customer; // already their own

    // Refuse to strand the org without an admin.
    if (customer.role === 'organization_admin') {
      const remaining = await this.accounts.countByOrganizationRole(
        customer.organizationId,
        'organization_admin',
        { excludeCustomerAccountId: customer.id, activeOnly: true },
      );
      if (remaining === 0) {
        throw new HttpError(
          409,
          ERROR_CODES.ORG_OWNER_DEPLETION,
          'Cannot unassign the last organization administrator.',
        );
      }
    }

    return this.accountWrites.detachToPersonalOrganization(customer.id, personal.id, {
      actorAdminUserId: actor.adminUserId,
    });
  }

  /** Sets (or clears) the customer's direct customer-group (feature 040, US6). */
  async setCustomerGroup(
    customerAccountId: string,
    customerGroupId: string | null,
    actor: ModerationActor,
  ): Promise<CustomerAccountRecord> {
    const customer = await this.loadActive(customerAccountId);
    await this.assertAuthorized(actor, customer.organizationId);

    return this.accountWrites.setCustomerGroup(customer.id, customerGroupId, {
      actorAdminUserId: actor.adminUserId,
    });
  }

  private async loadActive(id: string): Promise<CustomerAccountRecord> {
    const customer = await this.accounts.findById(id, { activeOnly: true });
    if (!customer) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    return customer;
  }

  private async assertAuthorized(
    actor: ModerationActor,
    organizationId: string,
  ): Promise<void> {
    const allowed = await this.authority.canManageCustomer({
      isPlatformAdmin: actor.isPlatformAdmin,
      adminUserId: actor.adminUserId,
      customerOrganizationId: organizationId,
    });
    if (!allowed) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Not allowed for this organization.');
    }
  }
}
