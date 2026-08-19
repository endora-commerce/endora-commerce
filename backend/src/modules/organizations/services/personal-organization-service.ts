import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CustomerAccountMemberWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
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
 * The account fields this service reads, as a shape rather than a class.
 *
 * {@link PersonalOrganizationService.ensureFor} takes one of these and a live
 * `EntityManager` the caller is mid-transaction in. `customers` is the only
 * caller and passes its managed `CustomerAccount`, which satisfies this shape
 * structurally — so the entity stops being *named* here while that module
 * waits for its own Phase-C merge request. The overload goes with it; the
 * whole flow is `ensureForCustomerAccountId` on the other side of the port.
 */
export interface PersonalOrganizationAccountShape {
  id: string;
  organizationId?: string | null;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Feature 051 — provisions and guards single-member Personal Organizations for
 * B2C (individual) customers. One provisioning rule, reused by live registration
 * and the backfill migration's mental model (the migration duplicates the SQL).
 */
export class PersonalOrganizationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Absent only where there is no container to resolve a port from:
     * `customers` still constructs this service by hand and calls the
     * `ensureFor` overload, which needs neither. The two methods that do need
     * them say so and refuse without them. Required outright once `customers`
     * is cut and that overload goes.
     */
    private readonly accounts?: PersonalOrganizationAccountPorts,
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
   * linked, writing the membership through the caller's own unit of work.
   *
   * @deprecated Retired by `customers`' Phase-C merge request, which is the one
   * caller. Use {@link ensureForCustomerAccountId}.
   */
  async ensureFor(
    account: PersonalOrganizationAccountShape,
    em: EntityManager = this.emFactory(),
  ): Promise<Organization> {
    // command-coverage-ignore: idempotent auto-provisioning of a customer's
    // personal (B2C) organization on first transact — a system invariant repair
    // (returns the existing org if any), not an operator-initiated write.
    if (account.organizationId) {
      const existing = await em.findOne(Organization, { id: account.organizationId });
      if (existing) return existing;
    }
    const org = em.create(Organization, {
      name: PersonalOrganizationService.personalName(account),
      taxId: personalTaxId(account.id),
      status: 'active',
      vatStatus: 'vat_exempt',
      isPersonal: true,
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    account.organizationId = org.id;
    await em.flush();
    return org;
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
    if (!this.accounts) {
      throw new Error(
        'PersonalOrganizationService: this method reads `customer_accounts` through its ports; construct the service with them.',
      );
    }
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
