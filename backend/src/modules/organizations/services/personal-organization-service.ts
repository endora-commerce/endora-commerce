import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CustomerAccountMemberWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import { Organization } from '../entities/organization.entity.js';

/**
 * `customer_accounts`' own read and write of the row this service binds to an
 * Organization (feature 075, Phase C). The three sites they replace were
 * `em.findOne`, `em.count` and a field assignment on that module's entity.
 *
 * With `customer_accounts` off both fail closed, which is the only coherent
 * answer: provisioning a personal Organization for an account the platform
 * cannot see would create a tenant with no member.
 */
export interface PersonalOrganizationAccountPorts {
  read: CustomerAccountReadPort;
  write: CustomerAccountMemberWritePort;
}

/**
 * The name a scrubbed personal organisation is renamed to. It matches the one
 * `customer_accounts` writes over the member's own first and last name,
 * because a personal organisation's name *is* that person's name.
 */
export const ANONYMIZED_ORGANIZATION_NAME = 'Deleted customer';

/**
 * Feature 051 — provisions and guards single-member Personal Organizations for
 * B2C (individual) customers. One provisioning rule, reused by live registration
 * and the backfill migration's mental model (the migration duplicates the SQL).
 */
export class PersonalOrganizationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Required since `customers`' Phase-C cut: the `ensureFor` overload that
     * needed neither port — it took the caller's managed `CustomerAccount` and
     * its `EntityManager` — went with that cut, and every method left reads
     * this module's neighbour through its ports.
     */
    private readonly accounts: PersonalOrganizationAccountPorts,
    /**
     * Feature 075 — `anonymizeIfOrphaned` records the scrub. It used to be
     * written by `customers`' deletion sweep, on a row that module does not
     * own; the write and its one audit row moved here together.
     */
    private readonly auditLog?: AuditPort,
  ) {}

  /** Name an individual's organization from their profile, falling back to the email local-part. */
  static personalName(
    account: Pick<CustomerAccountRecord, 'firstName' | 'lastName' | 'email'>,
  ): string {
    const full = `${account.firstName ?? ''} ${account.lastName ?? ''}`.trim();
    return full.length > 0 ? full : account.email.split('@')[0]!;
  }

  /**
   * Return the customer's organization, provisioning a personal one iff none is
   * linked. Idempotent by customer — a customer that already has an organization
   * is returned as-is (never a second personal org).
   *
   * The two writes are two units of work since feature 075's Phase C: the
   * Organization is this module's row and the membership binding is
   * `customer_accounts`'. They were already two flushes, so nothing atomic is
   * lost — and the order is the recoverable one, because an Organization no
   * account points at is re-found by the caller's next attempt (the taxId is
   * derived from the account id), while a binding to an Organization that was
   * never created is not.
   */
  async ensureForCustomerAccountId(customerAccountId: string): Promise<Organization> {
    const accounts = this.#accounts();
    const em = this.emFactory();
    const account = await accounts.read.findById(customerAccountId);
    if (!account) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Customer account ${customerAccountId} not found.`,
      );
    }
    // command-coverage-ignore: idempotent auto-provisioning of a customer's
    // personal (B2C) organization on first transact — a system invariant repair
    // (returns the existing org if any), not an operator-initiated write.
    if (account.organizationId) {
      const existing = await em.findOne(Organization, { id: account.organizationId });
      if (existing) return existing;
    }
    // Two units of work rather than one since the boundary cut: the
    // Organization is this module's row, the membership binding is
    // `customer_accounts`'. They were already two flushes, so nothing atomic is
    // lost. The order is the recoverable one — the taxId is derived from the
    // account id, so an Organization no account points at is *re-found* by the
    // next attempt rather than duplicated, while a binding to an Organization
    // that was never created has nothing to point at.
    const taxId = personalTaxId(account.id);
    const existingByTaxId = await em.findOne(Organization, { taxId });
    const org =
      existingByTaxId ??
      em.create(Organization, {
        name: PersonalOrganizationService.personalName(account),
        taxId,
        status: 'active',
        vatStatus: 'vat_exempt',
        isPersonal: true,
        registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
      });
    if (!existingByTaxId) await em.persistAndFlush(org);
    await accounts.write.attachToOrganization(account.id, org.id);
    return org;
  }

  /**
   * Feature 051, the other end of the same rule — the retention sweep's
   * cascade, moved here with `customers`' Phase-C cut.
   *
   * That module ran it by loading this module's `Organization`, renaming it,
   * blanking its registered address and stamping `deletedAt` — three writes on
   * a row it does not own, plus the audit entry describing them. The decision
   * is this module's: a personal organisation whose single member has been
   * anonymised has nobody in it and carries that person's name.
   *
   * Writes nothing and answers `null` whenever the cascade does not apply, so a
   * caller cannot get it wrong by asking too often.
   */
  async anonymizeIfOrphaned(customerAccountId: string): Promise<Organization | null> {
    const account = await this.#accounts().read.findById(customerAccountId);
    if (!account?.organizationId) return null;

    const em = this.emFactory();
    const org = await em.findOne(Organization, { id: account.organizationId });
    if (!org || !org.isPersonal || org.deletedAt) return null;

    // Any surviving (non-deleted) member keeps the organisation alive. For a
    // personal one this is empty once its single member has been soft-deleted.
    const members = await this.#accounts().read.listByOrganization(org.id, { activeOnly: true });
    if (members.length > 0) return null;

    // command-coverage-ignore: the retention sweep's cascade over a
    // member-less personal organization — a system-initiated scrub on a timer,
    // audited below with the null actor that fact deserves, not an
    // operator-initiated write with an actor to attribute it to.
    const before = { name: org.name };
    org.name = ANONYMIZED_ORGANIZATION_NAME;
    org.registeredAddress = {
      street: '-',
      city: '-',
      postalCode: '-',
      country: org.registeredAddress.country,
    };
    org.deletedAt = new Date();
    await em.flush();
    await this.auditLog?.record({
      actorAdminUserId: null,
      action: 'organization.anonymized',
      objectType: 'organization',
      objectId: org.id,
      stateBefore: before,
      stateAfter: { anonymizedAt: org.deletedAt.toISOString(), isPersonal: true },
    });
    return org;
  }

  /**
   * Guard: a personal organization is single-member and MUST never gain a second
   * customer. Call before attaching a customer to an organization.
   */
  async assertMembershipAllowed(organizationId: string, em = this.emFactory()): Promise<void> {
    const org = await em.findOne(Organization, { id: organizationId });
    if (!org?.isPersonal) return; // company orgs are multi-member
    const members = await this.#accounts().read.listByOrganization(organizationId, {
      activeOnly: true,
    });
    if (members.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'A personal organization is single-member and cannot take another customer.',
      );
    }
  }

  #accounts(): PersonalOrganizationAccountPorts {
    return this.accounts;
  }
}

/**
 * `tax_id` is globally unique (varchar(32)); an individual has no company tax
 * id, so the account's UUID without dashes is used — 32 hex chars, unique, and
 * derived, which is what makes the provisioning re-runnable.
 */
function personalTaxId(customerAccountId: string): string {
  return customerAccountId.replace(/-/g, '');
}
