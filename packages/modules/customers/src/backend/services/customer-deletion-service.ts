import {
  ERROR_CODES,
  type AddressServicePort,
  type CartAnonymizationPort,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type PersonalOrganizationPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
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
 *
 * **The order of the sweep (issue #800).** No transaction spans the three
 * owners, so the sweep is made restartable instead: the account's
 * `anonymizedAt` is the cascade's commit marker and is written **last** —
 * organisation, then its saved addresses, then the reasons written about the
 * account's carts (issue #920), then the account. Until that last
 * write commits the account is still on `listDueForAnonymization`, and every
 * earlier step converges (each writes only what is still missing and audits only
 * what it wrote), so the next tick finishes whatever a crash left. The price
 * is that the organisation can be scrubbed while the account is not yet
 * anonymised, which is why {@link restore} refuses past the retention window on
 * the same cutoff as the sweep rather than relying on `anonymizedAt` alone.
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
    /**
     * `addresses`' write port (`specs/173-b2c-address-book-merge/` OD-7): the
     * scrubbed personal Organization's saved addresses go with it.
     */
    private readonly addresses: Pick<AddressServicePort, 'anonymizeForOrganization'>,
    /**
     * `customers.deletion_retention_days` (issue #800) — {@link restore} reads
     * it so that the window it honours is the sweep's, not a second one.
     */
    private readonly resolveRetentionDays: () => Promise<number>,
    /**
     * `carts`' step (issue #920): the reasons operators and approvers wrote
     * about the account's carts. `carts` is `nonDeactivatable` and already a
     * binding dependency, so this step has no absent state to degrade in.
     */
    private readonly carts: CartAnonymizationPort,
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
    // FR-039 — past the window the account belongs to the sweep, whether or
    // not a tick has reached it yet. Without this an account whose personal
    // organisation the sweep already scrubbed (an interrupted cascade, #800)
    // could be restored into a soft-deleted organisation. A row that is not
    // deleted, or already anonymised, is the owner's answer to give.
    if (customer.deletedAt && !customer.anonymizedAt) {
      const cutoff = retentionCutoff(await this.resolveRetentionDays(), new Date());
      if (customer.deletedAt < cutoff) {
        throw new HttpError(
          409,
          ERROR_CODES.CUSTOMER_RESTORE_WINDOW_ELAPSED,
          'The restore window has elapsed; this account is due for permanent anonymization.',
        );
      }
    }
    return this.accountWrites.restore(customer.id, { actorAdminUserId: actor.adminUserId });
  }

  /**
   * Whether {@link sweep} with the same `retentionDays` and `now` would find a
   * subject to process — yes or no (issue #857). Each owner answers over its
   * half of the work list's own predicate: `customer_accounts` for the due
   * accounts at the same cutoff, then `organizations` for the personal
   * organisations an earlier rule left incompletely scrubbed (issue #923).
   *
   * It fails open: an organisation-side question that cannot be answered counts
   * as yes, so a failing probe may cost an audit row and can never skip a
   * finish. A module switched off is re-thrown — the sweep would fail closed on
   * it too.
   */
  async hasDue(retentionDays: number, now: Date): Promise<boolean> {
    if (await this.accountWrites.hasDueForAnonymization(retentionCutoff(retentionDays, now))) return true;
    try {
      return await this.personalOrganizations.hasIncompletelyScrubbed();
    } catch (error) {
      rethrowIfModuleDisabled(error);
      return true;
    }
  }

  /**
   * Permanently anonymizes every soft-deleted account whose retention window
   * has elapsed (`deletedAt + retentionDays < now`), and finishes every subject
   * an earlier run left incomplete. Returns the number of subjects processed,
   * anonymised or finished. Called by the repeatable sweep worker.
   *
   * **The work list is every subject not fully scrubbed under the current
   * rule (issue #923)**, not only the accounts never scrubbed: the accounts
   * `customer_accounts` reports due, then the anonymised member of each
   * personal organisation `organizations` reports as incompletely scrubbed,
   * each subject once. Every one runs through the same cascade, which writes
   * only what is missing (#800), so finishing an earlier scrub records one
   * audit row per object it changes and announces nothing again. A member not
   * yet anonymised is left to the due list: it is either on it already (an
   * interrupted cascade) or a live account. An organisation with no member row
   * is not reached — the cascade is keyed on the account, and account rows
   * are only ever soft-deleted.
   *
   * Each subject is its own unit: one that fails stays unfinished and is
   * retried on the next tick, and does not stop the subjects behind it. When
   * any failed, the sweep throws once at the end, naming the failed account
   * ids (never personal data), so the tick is recorded as failed. A module
   * that is off while the work list is read fails the tick closed.
   */
  async sweep(retentionDays: number, now: Date): Promise<number> {
    const work = await this.workList(retentionCutoff(retentionDays, now));
    let completed = 0;
    const failures: Array<{ customerAccountId: string; error: unknown }> = [];
    for (const customerAccountId of work) {
      try {
        await this.anonymizeOne(customerAccountId);
        completed += 1;
      } catch (error) {
        // A module that is off fails the whole tick closed. Anything else is
        // this one account's failure: it is still due, the next tick retries
        // it, and the accounts behind it must not wait on it (issue #800).
        rethrowIfModuleDisabled(error);
        failures.push({ customerAccountId, error });
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => f.error),
        `Anonymization sweep failed for ${failures.length} of ${work.length} account(s): ` +
          failures.map((f) => f.customerAccountId).join(', '),
      );
    }
    return completed;
  }

  /**
   * The due accounts first, then the anonymised members of the personal
   * organisations an earlier scrub left incomplete (issue #923), without
   * duplicates. Read in full before any subject is processed.
   */
  private async workList(cutoff: Date): Promise<string[]> {
    const work = new Set(
      (await this.accountWrites.listDueForAnonymization(cutoff)).map((account) => account.id),
    );
    for (const organizationId of await this.personalOrganizations.listIncompletelyScrubbed()) {
      // Every member, not only the live ones: the subject is the soft-deleted one.
      for (const member of await this.accounts.listByOrganization(organizationId)) {
        if (member.anonymizedAt != null) work.add(member.id);
      }
    }
    return [...work];
  }

  /** The cascade for one account, in the order that makes it restartable. */
  private async anonymizeOne(customerAccountId: string): Promise<void> {
    // Feature 051 — a personal (B2C) organization backs exactly one customer.
    // Once that customer is soft-deleted the org has no live member, so the
    // scrub cascades: the owner renames it, blanks its address and soft-deletes
    // it. Company (multi-member) orgs are never touched, and the owner decides
    // that. It answers the org again on a repeat call, having written only what
    // was still missing, so a re-run after a crash reaches the addresses.
    const organization = await this.personalOrganizations.anonymizeIfOrphaned(customerAccountId);
    // `specs/173-b2c-address-book-merge/` OD-7 — and its saved addresses,
    // which are the customer's one address book, are cleared and blanked.
    // Order snapshots are copies on `orders`' rows and stay as they are.
    if (organization) await this.addresses.anonymizeForOrganization(organization.id);
    // Issue #920 — and the reasons written about the account's carts, on any
    // account: a company member's basket is theirs too.
    await this.carts.anonymizeForCustomerAccount(customerAccountId);
    // Last: `anonymizedAt` takes the account off the work list (issue #800).
    await this.accountWrites.anonymize(customerAccountId);
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

/**
 * The instant before which a soft-deletion is past the retention window. One
 * function for both {@link CustomerDeletionService.sweep} and
 * {@link CustomerDeletionService.restore}, so the two predicates cannot
 * disagree about which accounts are past it.
 */
export function retentionCutoff(retentionDays: number, now: Date): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
