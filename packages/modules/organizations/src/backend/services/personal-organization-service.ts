import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CustomerAccountMemberWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
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
   * The provisioning itself — find-or-create the personal organisation for an
   * account, on the `EntityManager` the caller hands in.
   *
   * D-178 made this the one place the row is written, and gave it a caller that
   * has no account row yet: `customer_accounts` inserts the account and its
   * organisation in one transaction, so it passes the id it is *about* to write
   * and the name components it already holds. Nothing here reads
   * `customer_accounts` and nothing here writes it.
   *
   * Idempotent by `taxId`, which is derived from the account id — a retry after
   * a rolled-back attempt re-finds the row rather than creating a second one.
   *
   * command-coverage-ignore: idempotent auto-provisioning of a customer's
   * personal (B2C) organization — a system invariant the constitution mandates
   * (Principle XI), not an operator-initiated write. Its caller's own write is
   * the audited event.
   */
  async provisionFor(
    em: EntityManager,
    input: {
      customerAccountId: string;
      email: string;
      firstName?: string | null;
      lastName?: string | null;
    },
  ): Promise<Organization> {
    const taxId = personalTaxId(input.customerAccountId);
    const existingByTaxId = await em.findOne(Organization, { taxId });
    if (existingByTaxId) return existingByTaxId;
    const org = em.create(Organization, {
      name: PersonalOrganizationService.personalName({
        firstName: input.firstName ?? '',
        lastName: input.lastName ?? '',
        email: input.email,
      }),
      taxId,
      status: 'active',
      vatStatus: 'vat_exempt',
      isPersonal: true,
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    // Flushed here rather than left pending, because the caller's next statement
    // inserts a row whose `organization_id` foreign key points at this one. It
    // is the caller's `EntityManager` and therefore the caller's transaction, so
    // a rollback takes this row with it.
    await em.persistAndFlush(org);
    return org;
  }

  /**
   * Return the customer's organization, provisioning a personal one iff none is
   * linked. Idempotent by customer — a customer that already has an organization
   * is returned as-is (never a second personal org).
   *
   * **Since D-178 this repairs rather than provisions.** Every write path now
   * creates the account and its organisation in one transaction, so a live
   * account always has one and this method's provisioning arm is reached only by
   * a caller holding an account written before that ruling. It is kept because
   * it is idempotent and because `ensureForCustomerAccount` is a published port.
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
    if (account.organizationId) {
      const existing = await em.findOne(Organization, { id: account.organizationId });
      if (existing) return existing;
    }
    const org = await this.provisionFor(em, { ...account, customerAccountId: account.id });
    await accounts.write.attachToOrganization(account.id, org.id);
    return org;
  }

  /**
   * D-178 — the account's **own** personal organisation, whatever it currently
   * belongs to, provisioned if it has never existed.
   *
   * `unassign` on the admin customer screen is what wants it: an operator
   * detaching a member from a company used to write `organization_id = NULL`,
   * and the account it produced could never transact. The operation is now the
   * move it always meant, and this is the destination. The **binding** is not
   * written here — `customers` writes it through
   * `CustomerAccountLifecycleWritePort.detachToPersonalOrganization` once its
   * own authority and org-administrator-depletion guards have passed.
   */
  async provisionPersonalOrganizationFor(customerAccountId: string): Promise<Organization> {
    const account = await this.#accounts().read.findById(customerAccountId);
    if (!account) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Customer account ${customerAccountId} not found.`,
      );
    }
    return this.provisionFor(this.emFactory(), { ...account, customerAccountId: account.id });
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
