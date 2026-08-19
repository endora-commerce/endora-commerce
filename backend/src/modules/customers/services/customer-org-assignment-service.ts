import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import type { CustomerAuthorityService } from './customer-authority-service.js';
import type { ModerationActor } from './customer-moderation-service.js';

/**
 * CustomerOrgAssignmentService — assign / unassign a Customer to an
 * Organization (feature 040, US5 / FR-026). Both actions are authority-checked
 * and audited; unassigning the last usable org admin is refused (depletion
 * guard, mirroring moderation).
 */
export class CustomerOrgAssignmentService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly authority: CustomerAuthorityService,
    private readonly auditLog: AuditLogService,
  ) {}

  async assign(
    customerAccountId: string,
    organizationId: string,
    actor: ModerationActor,
  ): Promise<CustomerAccount> {
    const em = this.emFactory();
    const customer = await this.loadActive(em, customerAccountId);

    // Actor must be able to manage the customer in its CURRENT state and in
    // the TARGET organization.
    await this.assertAuthorized(actor, customer.organizationId ?? null);
    await this.assertAuthorized(actor, organizationId);

    const org = await em.findOne(Organization, { id: organizationId });
    if (!org) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
    }

    const before = { organizationId: customer.organizationId ?? null };
    customer.organizationId = organizationId;
    await em.flush();

    await this.auditLog.record({
      actorAdminUserId: actor.adminUserId,
      action: 'customer_account.organization_assigned',
      objectType: 'customer_account',
      objectId: customer.id,
      stateBefore: before,
      stateAfter: { organizationId },
    });
    return customer;
  }

  async unassign(
    customerAccountId: string,
    actor: ModerationActor,
  ): Promise<CustomerAccount> {
    const em = this.emFactory();
    const customer = await this.loadActive(em, customerAccountId);
    await this.assertAuthorized(actor, customer.organizationId ?? null);

    if (!customer.organizationId) return customer; // already standalone

    // Refuse to strand the org without an admin.
    if (customer.role === 'organization_admin') {
      const remaining = await em.count(CustomerAccount, {
        organizationId: customer.organizationId,
        role: 'organization_admin',
        deletedAt: null,
        id: { $ne: customer.id },
      });
      if (remaining === 0) {
        throw new HttpError(
          409,
          ERROR_CODES.ORG_OWNER_DEPLETION,
          'Cannot unassign the last organization administrator.',
        );
      }
    }

    const before = { organizationId: customer.organizationId };
    customer.organizationId = null;
    await em.flush();

    await this.auditLog.record({
      actorAdminUserId: actor.adminUserId,
      action: 'customer_account.organization_unassigned',
      objectType: 'customer_account',
      objectId: customer.id,
      stateBefore: before,
      stateAfter: { organizationId: null },
    });
    return customer;
  }

  /** Sets (or clears) the customer's direct customer-group (feature 040, US6). */
  async setCustomerGroup(
    customerAccountId: string,
    customerGroupId: string | null,
    actor: ModerationActor,
  ): Promise<CustomerAccount> {
    const em = this.emFactory();
    const customer = await this.loadActive(em, customerAccountId);
    await this.assertAuthorized(actor, customer.organizationId ?? null);

    const before = { customerGroupId: customer.customerGroupId ?? null };
    customer.customerGroupId = customerGroupId;
    await em.flush();

    await this.auditLog.record({
      actorAdminUserId: actor.adminUserId,
      action: 'customer_account.group_assigned',
      objectType: 'customer_account',
      objectId: customer.id,
      stateBefore: before,
      stateAfter: { customerGroupId },
    });
    return customer;
  }

  private async loadActive(em: EntityManager, id: string): Promise<CustomerAccount> {
    const customer = await em.findOne(CustomerAccount, { id, deletedAt: null });
    if (!customer) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    return customer;
  }

  private async assertAuthorized(
    actor: ModerationActor,
    organizationId: string | null,
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
