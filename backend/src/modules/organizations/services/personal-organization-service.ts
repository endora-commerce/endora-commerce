import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../../http/error-envelope.js';
import { ERROR_CODES } from '@b2b/contracts';
import { Organization } from '../entities/organization.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';

/**
 * Feature 051 — provisions and guards single-member Personal Organizations for
 * B2C (individual) customers. One provisioning rule, reused by live registration
 * and the backfill migration's mental model (the migration duplicates the SQL).
 */
export class PersonalOrganizationService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /** Name an individual's organization from their profile, falling back to the email local-part. */
  static personalName(account: Pick<CustomerAccount, 'firstName' | 'lastName' | 'email'>): string {
    const full = `${account.firstName ?? ''} ${account.lastName ?? ''}`.trim();
    return full.length > 0 ? full : account.email.split('@')[0]!;
  }

  /**
   * Return the customer's organization, provisioning a personal one iff none is
   * linked. Idempotent by customer — a customer that already has an organization
   * is returned as-is (never a second personal org).
   */
  async ensureFor(account: CustomerAccount, em = this.emFactory()): Promise<Organization> {
    // command-coverage-ignore: idempotent auto-provisioning of a customer's
    // personal (B2C) organization on first transact — a system invariant repair
    // (returns the existing org if any), not an operator-initiated write.
    if (account.organizationId) {
      const existing = await em.findOne(Organization, { id: account.organizationId });
      if (existing) return existing;
    }
    const org = em.create(Organization, {
      name: PersonalOrganizationService.personalName(account),
      // tax_id is globally unique (varchar(32)); an individual has no company tax
      // id, so use the account's UUID without dashes (32 hex chars — unique, fits).
      taxId: account.id.replace(/-/g, ''),
      status: 'active',
      vatStatus: 'vat_exempt',
      isPersonal: true,
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    account.organizationId = org.id;
    await em.persistAndFlush(account);
    return org;
  }

  /**
   * The published form of {@link ensureFor} (feature 075, Phase P).
   *
   * Two things the entity-taking overload carries do not cross a module
   * boundary: the `CustomerAccount` **entity**, which is what this feature
   * exists to stop, and the caller's `EntityManager`, which cannot appear in a
   * `@b2b/contracts` signature and should not — the one caller flushes the
   * account before calling, so sharing an identity map bought nothing.
   *
   * The lookup lands in this file deliberately: the entity import it needs is
   * the one already standing here, so the boundary ledger gains no key.
   */
  async ensureForCustomerAccountId(customerAccountId: string): Promise<Organization> {
    const em = this.emFactory();
    const account = await em.findOne(CustomerAccount, { id: customerAccountId });
    if (!account) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Customer account ${customerAccountId} not found.`,
      );
    }
    return this.ensureFor(account, em);
  }

  /**
   * Guard: a personal organization is single-member and MUST never gain a second
   * customer. Call before attaching a customer to an organization.
   */
  async assertMembershipAllowed(organizationId: string, em = this.emFactory()): Promise<void> {
    const org = await em.findOne(Organization, { id: organizationId });
    if (!org?.isPersonal) return; // company orgs are multi-member
    const memberCount = await em.count(CustomerAccount, { organizationId, deletedAt: null });
    if (memberCount > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'A personal organization is single-member and cannot take another customer.',
      );
    }
  }
}
