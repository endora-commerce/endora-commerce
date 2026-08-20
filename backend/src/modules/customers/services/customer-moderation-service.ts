import {
  ERROR_CODES,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CustomerAuthorityService } from './customer-authority-service.js';

/**
 * CustomerModerationService — block / unblock a Customer account (feature 040,
 * US3). Enforces the staff-authority rules (FR-013/FR-015 via
 * CustomerAuthorityService), revokes sessions on block, and guards against
 * stranding an Organization with zero usable admins.
 *
 * **Feature 075, Phase C — the row is `customer_accounts`'.** This service used
 * to load and mutate that module's entity and write the audit row for it; both
 * moved behind `customerAccountLifecycleWritePort`, which records exactly the
 * same `customer_account.blocked` / `.unblocked` entry (FR-017). What stays is
 * everything that is a *decision*: whether this staff member may act on this
 * customer, and whether the block would leave an Organization without an
 * administrator. The session revocation stays too — it is `auth`'s, and it must
 * happen after the block is durable rather than inside it.
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

export class CustomerModerationService {
  constructor(
    private readonly accounts: CustomerAccountReadPort,
    private readonly accountWrites: CustomerAccountLifecycleWritePort,
    private readonly authority: CustomerAuthorityService,
    private readonly sessions: SessionRevoker,
  ) {}

  async block(input: BlockCustomerInput): Promise<CustomerAccountRecord> {
    const customer = await this.loadActive(input.targetCustomerAccountId);
    await this.assertAuthorized(input.actor, customer);

    if (customer.blockedAt) return customer; // idempotent

    await this.assertWouldNotStrandOrg(customer);

    const blocked = await this.accountWrites.block(customer.id, {
      actorAdminUserId: input.actor.adminUserId,
      reason: input.reason ?? null,
      ...(input.audit ? { audit: input.audit } : {}),
    });

    // Revoke active sessions so the block takes effect promptly (SC-002).
    await this.sessions.destroyAllForCustomer(customer.id);
    return blocked;
  }

  async unblock(input: UnblockCustomerInput): Promise<CustomerAccountRecord> {
    const customer = await this.loadActive(input.targetCustomerAccountId);
    await this.assertAuthorized(input.actor, customer);

    if (!customer.blockedAt) return customer; // idempotent

    return this.accountWrites.unblock(customer.id, {
      actorAdminUserId: input.actor.adminUserId,
      ...(input.audit ? { audit: input.audit } : {}),
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
    customer: CustomerAccountRecord,
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
  private async assertWouldNotStrandOrg(customer: CustomerAccountRecord): Promise<void> {
    if (!customer.organizationId || customer.role !== 'organization_admin') return;
    const remaining = await this.accounts.countByOrganizationRole(
      customer.organizationId,
      'organization_admin',
      { excludeCustomerAccountId: customer.id, activeOnly: true, notBlocked: true },
    );
    if (remaining === 0) {
      throw new HttpError(
        409,
        ERROR_CODES.ORG_OWNER_DEPLETION,
        'Cannot block the last organization administrator; the organization would be left without an admin.',
      );
    }
  }
}
