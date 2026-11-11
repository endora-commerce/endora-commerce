import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CustomerAccountMemberWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  isUuidShape,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort, SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { Organization } from '../entities/organization.entity.js';
import { predefinedRoleIdOn } from './organization-role-store.js';
import { anyRowExists } from './scheduled-work-probe.js';

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

/** What each blanked line of a scrubbed registered address reads. */
const ANONYMIZED_ADDRESS_FIELD = '-';

/**
 * Whether every part of the personal-organisation scrub is already written.
 *
 * Issue #802 added the legal name, the order-confirmation recipients and the
 * custom field values; issue #843 the block and rejection reasons, which are
 * free text an operator wrote about the person. An organisation scrubbed
 * before either answers `false` here — and what makes the next run reach it is
 * {@link incompletelyScrubbedRows}, which puts it back on the retention
 * sweep's work list (issue #923). The account work list alone never did: an
 * account an earlier release anonymised is not due again. No backfill is
 * needed.
 *
 * **A field added to the scrub is added here and to
 * {@link incompletelyScrubbedRows}.** The two must agree field by field;
 * `backend/test/integration/customers/customer-deletion-service.test.ts` I-21
 * fails when they do not.
 */
function isFullyScrubbed(org: Organization): boolean {
  const address = org.registeredAddress;
  return (
    org.name === ANONYMIZED_ORGANIZATION_NAME &&
    address.street === ANONYMIZED_ADDRESS_FIELD &&
    address.city === ANONYMIZED_ADDRESS_FIELD &&
    address.postalCode === ANONYMIZED_ADDRESS_FIELD &&
    org.legalName == null &&
    (org.orderConfirmationEmails ?? []).length === 0 &&
    Object.keys(org.customFieldValues ?? {}).length === 0 &&
    org.blockedReason == null &&
    org.rejectedReason == null &&
    org.deletedAt != null
  );
}

/**
 * A set of rows as a `from … where …` and its parameters — the `WorkRows`
 * shape of the `scheduled-work-probe.ts` copies, so a probe of this module can
 * take the same statement as it stands.
 */
export interface OrganizationRows {
  /** Starts at `from`. No select list, no trailing `limit` or locking clause. */
  readonly from: string;
  readonly params: readonly unknown[];
}

/**
 * Issue #923 — the personal organisations a scrub has reached that do not hold
 * all of it: the scrub's signature (personal, and carrying its name, which
 * every rule since feature 051 writes in the scrub transaction) and the
 * negation of {@link isFullyScrubbed}, in one statement over this module's own
 * table.
 *
 * **A field added to the scrub is added here and to {@link isFullyScrubbed}.**
 * The JSON columns read the way the entity's fallbacks do: a `null` list or
 * bag counts as empty, and a missing address line as not blanked.
 *
 * Built per call, so no caller shares a statement object with another.
 */
export function incompletelyScrubbedRows(): OrganizationRows {
  return {
    from:
      `from "organizations" where "is_personal" = true and "name" = ? and (` +
      [
        `"legal_name" is not null`,
        `"blocked_reason" is not null`,
        `"rejected_reason" is not null`,
        `coalesce(nullif("order_confirmation_emails", 'null'::jsonb), '[]'::jsonb) <> '[]'::jsonb`,
        `coalesce(nullif("custom_field_values", 'null'::jsonb), '{}'::jsonb) <> '{}'::jsonb`,
        `("registered_address"->>'street') is distinct from ?`,
        `("registered_address"->>'city') is distinct from ?`,
        `("registered_address"->>'postalCode') is distinct from ?`,
        `"deleted_at" is null`,
      ].join(' or ') +
      `)`,
    params: [
      ANONYMIZED_ORGANIZATION_NAME,
      ANONYMIZED_ADDRESS_FIELD,
      ANONYMIZED_ADDRESS_FIELD,
      ANONYMIZED_ADDRESS_FIELD,
    ],
  };
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
    /**
     * Feature 154 — the kernel's audited channel-membership writer. An
     * Organization with no sales channel may shop nowhere, so a created one is
     * bound in the creating transaction: to the channel of the store the
     * account registered on, or to the system default without one (FR-017,
     * FR-019). Optional so a unit composition without it keeps working.
     */
    private readonly channelMembership?: Pick<
      SalesChannelMembershipPort,
      'bindToDefaultIfEmpty' | 'replaceChannelsForEntity'
    >,
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
   * Idempotent by the account link (`personalAccountId`,
   * `specs/177-tax-id-scope/` FR-003) — a retry after a rolled-back attempt
   * re-finds the row rather than creating a second one, and the partial unique
   * index `organizations_personal_account_id_unique` refuses a concurrent second
   * insert. A personal organization has no tax ID.
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
      /**
       * Feature 154 — the store the account registers on; the new personal
       * organisation gets exactly this channel. Absent or `null`: the default.
       */
      salesChannelId?: string | null;
    },
  ): Promise<Organization> {
    const existing = await em.findOne(Organization, {
      personalAccountId: input.customerAccountId,
    });
    if (existing) {
      await this.channelMembership?.bindToDefaultIfEmpty('organization', existing.id, {
        em,
      });
      return existing;
    }
    const org = em.create(Organization, {
      name: PersonalOrganizationService.personalName({
        firstName: input.firstName ?? '',
        lastName: input.lastName ?? '',
        email: input.email,
      }),
      taxId: null,
      personalAccountId: input.customerAccountId,
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
    // Feature 154 — on the caller's `EntityManager`, so the bridge row shares
    // the transaction that creates the account and its Organization.
    if (input.salesChannelId) {
      await this.channelMembership?.replaceChannelsForEntity(
        'organization',
        org.id,
        [input.salesChannelId],
        { em },
      );
    } else {
      await this.channelMembership?.bindToDefaultIfEmpty('organization', org.id, { em });
    }
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
    // A personal organisation's member is its Administrator (owner ruling PR-3,
    // research R-34); the role is written with the Organization, which the
    // composite foreign key requires.
    await accounts.write.attachToOrganization(
      account.id,
      org.id,
      await predefinedRoleIdOn(em, org.id, 'administrator'),
    );
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
   * is this module's: a personal organisation with no live member has nobody in
   * it and carries that person's name.
   *
   * **Convergent (issue #800).** The sweep writes the account's own scrub
   * *last*, so this may run before it, and again after a crash. It writes
   * whatever part of the scrub is still missing — the name, the registered
   * address, `deletedAt` — and answers the organisation whether or not it wrote
   * anything, so a re-run still reaches the saved addresses. An existing
   * `deletedAt` (an operator's soft-delete through the admin screen) is kept.
   * The scrub and its one `organization.anonymized` row commit in one
   * transaction, and that row is written only when something changed.
   *
   * **What it clears (issue #802).** Besides the name and the address: the
   * legal name, the order-confirmation recipients — `orders` mails that list,
   * so a placeholder would receive mail — and **every** custom field value. A
   * personal organisation has one person behind it, and `custom_fields` has no
   * "personal" flag to clear by, so clearing the whole bag is the only rule
   * that does not fail open (owner ruling Q1, 2026-11-06). The audit row
   * describes what was erased without repeating it: no name, only whether a
   * legal name existed, how many recipients there were and which custom field
   * keys held a value (owner ruling Q2).
   *
   * **And the operator's reasons (issue #843).** The block and the rejection
   * reason are set to `null`; the status, `blockedAt` and `rejectedAt` stay.
   * The audit row records only whether each reason existed.
   *
   * Answers `null`, and writes nothing, only where the cascade does not apply:
   * an org-less account, an organisation that is not personal, and one that
   * still has a live member.
   */
  async anonymizeIfOrphaned(customerAccountId: string): Promise<Organization | null> {
    const account = await this.#accounts().read.findById(customerAccountId);
    if (!account?.organizationId) return null;

    const em = this.emFactory();
    const org = await em.findOne(Organization, { id: account.organizationId });
    if (!org || !org.isPersonal) return null;

    // Any surviving (non-deleted) member keeps the organisation alive. For a
    // personal one this is empty once its single member has been soft-deleted
    // — which is all the sweep needs, so this does not wait on the account's
    // own scrub.
    const members = await this.#accounts().read.listByOrganization(org.id, { activeOnly: true });
    if (members.length > 0) return null;

    if (isFullyScrubbed(org)) return org;

    // command-coverage-ignore: the retention sweep's cascade over a
    // member-less personal organization — a system-initiated scrub on a timer,
    // audited below with the null actor that fact deserves, not an
    // operator-initiated write with an actor to attribute it to.
    return em.transactional(async (txEm) => {
      const row = await txEm.findOneOrFail(Organization, { id: org.id });
      if (isFullyScrubbed(row)) return row;
      const now = new Date();
      // Non-personal facts only: the row outlives the data it describes.
      const before = {
        wasDeleted: row.deletedAt != null,
        hadLegalName: Boolean(row.legalName),
        orderConfirmationEmailCount: (row.orderConfirmationEmails ?? []).length,
        customFieldKeys: Object.keys(row.customFieldValues ?? {}).sort(),
        hadBlockedReason: row.blockedReason != null,
        hadRejectedReason: row.rejectedReason != null,
      };
      row.name = ANONYMIZED_ORGANIZATION_NAME;
      row.legalName = null;
      row.orderConfirmationEmails = [];
      row.customFieldValues = {};
      // Issue #843 — the reasons go, the block or rejection stays: its status,
      // dates and actor are not this person's data, and other flows read them.
      // `null`, not a marker: it already means "no reason given" to every
      // reader, and a marker would surface untranslated.
      row.blockedReason = null;
      row.rejectedReason = null;
      row.registeredAddress = {
        street: ANONYMIZED_ADDRESS_FIELD,
        city: ANONYMIZED_ADDRESS_FIELD,
        postalCode: ANONYMIZED_ADDRESS_FIELD,
        country: row.registeredAddress.country,
      };
      row.deletedAt ??= now;
      this.auditLog?.recordWithin(txEm, {
        actorAdminUserId: null,
        action: 'organization.anonymized',
        objectType: 'organization',
        objectId: row.id,
        stateBefore: before,
        stateAfter: { anonymizedAt: now.toISOString(), isPersonal: true },
      });
      await txEm.flush();
      return row;
    });
  }

  /**
   * Issue #923 — the ids of the personal organisations a scrub reached but did
   * not finish under the current rule ({@link incompletelyScrubbedRows}). The
   * retention sweep runs each one's anonymised member through the cascade
   * again, and {@link anonymizeIfOrphaned} — whose {@link isFullyScrubbed}
   * stays the in-transaction re-check — writes what is missing.
   *
   * Reads only this module's table and writes nothing. `Organization` is a
   * `@GlobalEntity()`, and the caller is the sweep, inside the system scope its
   * tick already opens.
   */
  async listIncompletelyScrubbed(): Promise<string[]> {
    const rows = incompletelyScrubbedRows();
    // `em.execute`, not the connection's: it runs on the caller's transaction.
    const found = (await this.emFactory().execute(`select "id" ${rows.from} order by "id"`, [
      ...rows.params,
    ])) as Array<{ id: string }>;
    return found.map((row) => row.id);
  }

  /**
   * Whether {@link listIncompletelyScrubbed} would list anything — yes or no.
   * The retention sweep's tick asks this outside any scope (issues #857,
   * #923), over the list's own row source, so the question cannot drift from
   * the list.
   */
  async hasIncompletelyScrubbed(): Promise<boolean> {
    return anyRowExists(this.emFactory(), [incompletelyScrubbedRows()]);
  }

  /**
   * Guard: a personal organization is single-member and MUST never gain a second
   * customer. Call before attaching a customer to an organization.
   */
  async assertMembershipAllowed(organizationId: string, em = this.emFactory()): Promise<void> {
    if (!isUuidShape(organizationId)) return; // company orgs are multi-member
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
