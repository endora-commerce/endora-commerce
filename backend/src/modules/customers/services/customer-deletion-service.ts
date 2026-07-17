import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import type { CustomerAuthorityService } from './customer-authority-service.js';
import type {
  ModerationActor,
  SessionRevoker,
} from './customer-moderation-service.js';

/**
 * CustomerDeletionService — soft-delete, restore, and permanent anonymization
 * (feature 040, US7 / FR-039/FR-040).
 *
 * Deletion is a soft-disable: login is denied, the account is hidden, and
 * sessions are revoked; history (orders, RFQs, audit) is retained. Within the
 * retention window an authorized actor can restore. The anonymization sweep
 * irreversibly scrubs PII after the window, after which restore is impossible.
 */
export const ANONYMIZED_NAME = 'Deleted customer';
export const ANONYMIZED_PASSWORD_HASH = 'anonymized-no-login';

export class CustomerDeletionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly authority: CustomerAuthorityService,
    private readonly auditLog: AuditLogService,
    private readonly sessions: SessionRevoker,
  ) {}

  async softDelete(
    customerAccountId: string,
    actor: ModerationActor,
  ): Promise<CustomerAccount> {
    const em = this.emFactory();
    const customer = await em.findOne(CustomerAccount, { id: customerAccountId });
    if (!customer) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    await this.assertAuthorized(actor, customer.organizationId ?? null);
    if (customer.deletedAt) {
      throw new HttpError(409, ERROR_CODES.CUSTOMER_ALREADY_DELETED, 'Customer is already deleted.');
    }

    // Refuse to strand an org without an admin.
    if (customer.organizationId && customer.role === 'organization_admin') {
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
          'Cannot delete the last organization administrator.',
        );
      }
    }

    customer.deletedAt = new Date();
    customer.deletionRequestedByAdminUserId = actor.adminUserId;
    await em.flush();
    await this.sessions.destroyAllForCustomer(customer.id);

    await this.auditLog.record({
      actorAdminUserId: actor.adminUserId,
      action: 'customer_account.deleted',
      objectType: 'customer_account',
      objectId: customer.id,
      stateBefore: { deletedAt: null },
      stateAfter: { deletedAt: customer.deletedAt.toISOString() },
    });
    return customer;
  }

  async restore(
    customerAccountId: string,
    actor: ModerationActor,
  ): Promise<CustomerAccount> {
    const em = this.emFactory();
    const customer = await em.findOne(CustomerAccount, { id: customerAccountId });
    if (!customer) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    await this.assertAuthorized(actor, customer.organizationId ?? null);
    if (!customer.deletedAt) {
      throw new HttpError(409, ERROR_CODES.CUSTOMER_NOT_DELETED, 'Customer is not deleted.');
    }
    if (customer.anonymizedAt) {
      throw new HttpError(
        409,
        ERROR_CODES.CUSTOMER_RESTORE_WINDOW_ELAPSED,
        'The restore window has elapsed; this account has been permanently anonymized.',
      );
    }

    customer.deletedAt = null;
    customer.deletionRequestedByAdminUserId = null;
    await em.flush();

    await this.auditLog.record({
      actorAdminUserId: actor.adminUserId,
      action: 'customer_account.restored',
      objectType: 'customer_account',
      objectId: customer.id,
      stateBefore: { deletedAt: 'set' },
      stateAfter: { deletedAt: null },
    });
    return customer;
  }

  /**
   * Permanently anonymizes every soft-deleted account whose retention window
   * has elapsed (`deletedAt + retentionDays < now`). Returns the number
   * anonymized. Called by the repeatable sweep worker.
   */
  async sweep(retentionDays: number, now: Date): Promise<number> {
    const em = this.emFactory();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const due = await em.find(CustomerAccount, {
      deletedAt: { $ne: null, $lt: cutoff },
      anonymizedAt: null,
    });
    for (const customer of due) {
      await this.anonymize(em, customer);
    }
    if (due.length > 0) await em.flush();
    return due.length;
  }

  private async anonymize(em: EntityManager, customer: CustomerAccount): Promise<void> {
    const before = { email: customer.email };
    customer.email = `deleted+${customer.id}@anonymized.invalid`;
    customer.firstName = ANONYMIZED_NAME;
    customer.lastName = ANONYMIZED_NAME;
    customer.passwordHash = ANONYMIZED_PASSWORD_HASH;
    customer.twoFactorSecret = null;
    customer.twoFactorConfirmedAt = null;
    customer.anonymizedAt = new Date();
    await this.auditLog.record({
      actorAdminUserId: null,
      action: 'customer_account.anonymized',
      objectType: 'customer_account',
      objectId: customer.id,
      stateBefore: before,
      stateAfter: { anonymizedAt: customer.anonymizedAt.toISOString() },
    });

    // Feature 051 — a personal (B2C) organization backs exactly one customer.
    // When that customer is anonymized the org is left member-less, so cascade
    // the scrub: anonymize the org's PII (its name is derived from the customer's
    // name) and soft-delete it. Company (multi-member) orgs are never touched.
    await this.anonymizePersonalOrgIfOrphaned(em, customer);
  }

  private async anonymizePersonalOrgIfOrphaned(
    em: EntityManager,
    customer: CustomerAccount,
  ): Promise<void> {
    if (!customer.organizationId) return;
    const org = await em.findOne(Organization, { id: customer.organizationId });
    if (!org || !org.isPersonal || org.deletedAt) return;

    // Any surviving (non-deleted) member keeps the org alive. For a personal
    // org this is 0 once its single member has been soft-deleted.
    const activeMembers = await em.count(CustomerAccount, {
      organizationId: org.id,
      deletedAt: null,
    });
    if (activeMembers > 0) return;

    const before = { name: org.name };
    org.name = ANONYMIZED_NAME;
    org.registeredAddress = { street: '-', city: '-', postalCode: '-', country: org.registeredAddress.country };
    org.deletedAt = new Date();
    await this.auditLog.record({
      actorAdminUserId: null,
      action: 'organization.anonymized',
      objectType: 'organization',
      objectId: org.id,
      stateBefore: before,
      stateAfter: { anonymizedAt: org.deletedAt.toISOString(), isPersonal: true },
    });
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
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'You are not allowed to manage this customer.');
    }
  }
}
