import {
  ERROR_CODES,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type PersonalOrganizationPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CustomerAuthorityService } from './customer-authority-service.js';
import type { OrganizationDepletionGuard } from './organization-depletion-guard.js';
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
 *
 * **Feature 075, Phase C — this service holds no other module's entity.** The
 * account writes and the scrub are `customer_accounts`', through
 * `customerAccountLifecycleWritePort`; the cascade onto a member-less personal
 * organisation is `organizations`', through `personalOrganizationPort`. Each
 * owner records the one audit row that describes its own write, with the same
 * action strings as before. What is left here is the *order* of the sweep and
 * the authority checks, which are this module's.
 */
export class CustomerDeletionService {
  constructor(
    private readonly accounts: CustomerAccountReadPort,
    private readonly accountWrites: CustomerAccountLifecycleWritePort,
    private readonly personalOrganizations: PersonalOrganizationPort,
    private readonly authority: CustomerAuthorityService,
    private readonly sessions: SessionRevoker,
    /**
     * `specs/170-organization-roles/` WP-03 — the last-administrator question,
     * by role and for company Organizations only (owner ruling PR-3).
     */
    private readonly depletion: OrganizationDepletionGuard,
  ) {}

  async softDelete(
    customerAccountId: string,
    actor: ModerationActor,
  ): Promise<CustomerAccountRecord> {
    const customer = await this.load(customerAccountId);
    await this.assertAuthorized(actor, customer.organizationId);
    if (customer.deletedAt) {
      throw new HttpError(409, ERROR_CODES.CUSTOMER_ALREADY_DELETED, 'Customer is already deleted.');
    }

    // Refuse to strand a company Organization without an administrator. A
    // personal Organization's sole member is its administrator; deleting them
    // is how that Organization ends (PR-3).
    if (await this.depletion.wouldLeaveWithoutAdministrator(customer)) {
      throw new HttpError(
        409,
        ERROR_CODES.ORG_OWNER_DEPLETION,
        'Cannot delete the last organization administrator.',
      );
    }

    const deleted = await this.accountWrites.softDelete(customer.id, {
      actorAdminUserId: actor.adminUserId,
    });
    await this.sessions.destroyAllForCustomer(customer.id);
    return deleted;
  }

  async restore(
    customerAccountId: string,
    actor: ModerationActor,
  ): Promise<CustomerAccountRecord> {
    const customer = await this.load(customerAccountId);
    await this.assertAuthorized(actor, customer.organizationId);
    return this.accountWrites.restore(customer.id, { actorAdminUserId: actor.adminUserId });
  }

  /**
   * Permanently anonymizes every soft-deleted account whose retention window
   * has elapsed (`deletedAt + retentionDays < now`). Returns the number
   * anonymized. Called by the repeatable sweep worker.
   */
  async sweep(retentionDays: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const due = await this.accountWrites.listDueForAnonymization(cutoff);
    for (const customer of due) {
      await this.accountWrites.anonymize(customer.id);
      // Feature 051 — a personal (B2C) organization backs exactly one customer.
      // Once that customer is anonymized the org is member-less, so the scrub
      // cascades: the owner renames it, blanks its address and soft-deletes it.
      // Company (multi-member) orgs are never touched, and the owner decides
      // that — this sweep only says which customer it just scrubbed.
      await this.personalOrganizations.anonymizeIfOrphaned(customer.id);
    }
    return due.length;
  }

  private async load(id: string): Promise<CustomerAccountRecord> {
    const customer = await this.accounts.findById(id);
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
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'You are not allowed to manage this customer.');
    }
  }
}
