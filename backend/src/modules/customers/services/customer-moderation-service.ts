import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import type { CustomerAuthorityService } from './customer-authority-service.js';

/**
 * CustomerModerationService — block / unblock a Customer account (feature 040,
 * US3). Enforces the staff-authority rules (FR-013/FR-015 via
 * CustomerAuthorityService), revokes sessions on block, records every action
 * in the audit log (FR-017), and guards against stranding an Organization with
 * zero usable admins.
 */
export interface SessionRevoker {
  destroyAllForCustomer(customerAccountId: string): Promise<void>;
}

export interface ModerationActor {
  adminUserId: string;
  isPlatformAdmin: boolean;
}

export interface ModerationAuditMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface BlockCustomerInput {
  targetCustomerAccountId: string;
  actor: ModerationActor;
  reason?: string | null;
  audit?: ModerationAuditMeta;
}

export interface UnblockCustomerInput {
  targetCustomerAccountId: string;
  actor: ModerationActor;
  audit?: ModerationAuditMeta;
}

function snapshot(c: CustomerAccount): Record<string, unknown> {
  return {
    blockedAt: c.blockedAt ? c.blockedAt.toISOString() : null,
    blockSource: c.blockSource ?? null,
    blockReason: c.blockReason ?? null,
  };
}

export class CustomerModerationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly authority: CustomerAuthorityService,
    private readonly auditLog: AuditLogService,
    private readonly sessions: SessionRevoker,
  ) {}

  async block(input: BlockCustomerInput): Promise<CustomerAccount> {
    const em = this.emFactory();
    const customer = await this.loadActive(em, input.targetCustomerAccountId);
    await this.assertAuthorized(input.actor, customer);

    if (customer.blockedAt) return customer; // idempotent

    await this.assertWouldNotStrandOrg(em, customer);

    const before = snapshot(customer);
    customer.blockedAt = new Date();
    customer.blockSource = 'staff';
    customer.blockedByAdminUserId = input.actor.adminUserId;
    customer.blockedByCustomerAccountId = null;
    customer.blockReason = input.reason ?? null;
    await em.flush();

    // Revoke active sessions so the block takes effect promptly (SC-002).
    await this.sessions.destroyAllForCustomer(customer.id);

    await this.auditLog.record({
      actorAdminUserId: input.actor.adminUserId,
      action: 'customer_account.blocked',
      objectType: 'customer_account',
      objectId: customer.id,
      stateBefore: before,
      stateAfter: snapshot(customer),
      ipAddress: input.audit?.ipAddress ?? null,
      userAgent: input.audit?.userAgent ?? null,
      requestId: input.audit?.requestId ?? null,
    });
    return customer;
  }

  async unblock(input: UnblockCustomerInput): Promise<CustomerAccount> {
    const em = this.emFactory();
    const customer = await this.loadActive(em, input.targetCustomerAccountId);
    await this.assertAuthorized(input.actor, customer);

    if (!customer.blockedAt) return customer; // idempotent

    const before = snapshot(customer);
    customer.blockedAt = null;
    customer.blockSource = null;
    customer.blockedByAdminUserId = null;
    customer.blockedByCustomerAccountId = null;
    customer.blockReason = null;
    await em.flush();

    await this.auditLog.record({
      actorAdminUserId: input.actor.adminUserId,
      action: 'customer_account.unblocked',
      objectType: 'customer_account',
      objectId: customer.id,
      stateBefore: before,
      stateAfter: snapshot(customer),
      ipAddress: input.audit?.ipAddress ?? null,
      userAgent: input.audit?.userAgent ?? null,
      requestId: input.audit?.requestId ?? null,
    });
    return customer;
  }

  private async loadActive(
    em: EntityManager,
    id: string,
  ): Promise<CustomerAccount> {
    const customer = await em.findOne(CustomerAccount, { id, deletedAt: null });
    if (!customer) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    return customer;
  }

  private async assertAuthorized(
    actor: ModerationActor,
    customer: CustomerAccount,
  ): Promise<void> {
    const allowed = await this.authority.canManageCustomer({
      isPlatformAdmin: actor.isPlatformAdmin,
      adminUserId: actor.adminUserId,
      customerOrganizationId: customer.organizationId ?? null,
    });
    if (!allowed) {
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        'You are not allowed to manage this customer.',
      );
    }
  }

  /**
   * Refuses to block the last usable (active, non-blocked) organization admin
   * of an Organization — that would strand the org with nobody able to manage
   * it (spec edge case "org-owner depletion").
   */
  private async assertWouldNotStrandOrg(
    em: EntityManager,
    customer: CustomerAccount,
  ): Promise<void> {
    if (!customer.organizationId || customer.role !== 'organization_admin') return;
    const remaining = await em.count(CustomerAccount, {
      organizationId: customer.organizationId,
      role: 'organization_admin',
      deletedAt: null,
      blockedAt: null,
      id: { $ne: customer.id },
    });
    if (remaining === 0) {
      throw new HttpError(
        409,
        ERROR_CODES.ORG_OWNER_DEPLETION,
        'Cannot block the last organization administrator; the organization would be left without an admin.',
      );
    }
  }
}
