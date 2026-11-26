import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { QueryOrder, raw } from '@mikro-orm/core';
import {
  ERROR_CODES,
  type CustomerAccountAdminSearchCriteria,
  type CustomerAccountAdminSearchPort,
  type CustomerAccountAdminSearchResult,
  type CustomerAccountCommandPort,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountOrganizationMoveInput,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type CustomerAccountStandaloneCreateInput,
  type CustomerAccountWriteRequestMeta,
  isUuidShape,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { toCustomerAccountRecords, toOneCustomerAccountRecord } from './customer-account-ports.js';
import type { TwoFactorEnrolmentReader } from './two-factor-enrolments.js';
import { organizationMoveAuditState } from './customer-account-audit-state.js';

export { ANONYMIZED_CUSTOMER_NAME, ANONYMIZED_PASSWORD_HASH } from '../commands/customer-account-anonymize.command.js';

/**
 * `customerAccountLifecycleWritePort` — the account lifecycle `customers` runs
 * over this module's table (feature 075, Phase C).
 *
 * **Deprecated since 0.113.0** (`specs/186-aggregate-ports/` T050, T051, issue
 * #1822). Every method but the two Organization moves delegates:
 *
 * - `createStandalone`, `block`, `unblock`, `softDelete`, `restore`,
 *   `setCustomerGroup`, `setCustomFieldValues` and `anonymize` to
 *   `customerAccountCommandPort`, whose Commands record the entries this
 *   service used to write by hand — the same actions and states, inside the
 *   write's transaction rather than after it. The actor is the ambient one, so
 *   `actorAdminUserId` is ignored, and the request metadata is the bus's, so
 *   `audit` is ignored (Principle XIII). A block and a deletion now end the
 *   account's sessions and run the depletion guard themselves;
 * - `listDueForAnonymization` and `hasDueForAnonymization` to
 *   `customerAccountReadPort`.
 *
 * `setOrganization` and `detachToPersonalOrganization` are moves between
 * Organizations, the Membership concern `specs/191-membership-join-requests/`
 * owns: they keep their hand-written entry here until that feature replaces
 * them with its Command.
 */
export interface CustomerAccountLifecycleWriteDeps {
  /** The aggregate port the deprecated writes delegate to. */
  readonly commands: CustomerAccountCommandPort;
  /** The read port the moved work-list reads delegate to. */
  readonly reads: Pick<CustomerAccountReadPort, 'listDueForAnonymization' | 'hasDueForAnonymization'>;
}

export class CustomerAccountLifecycleWriteService implements CustomerAccountLifecycleWritePort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditPort,
    /**
     * `mfa`'s answer to which of these accounts hold a second factor: the two
     * Organization moves answer with a record, and the record carries
     * `twoFactorEnabled`.
     */
    private readonly twoFactorEnrolments: TwoFactorEnrolmentReader,
    private readonly deps: CustomerAccountLifecycleWriteDeps,
  ) {}

  async createStandalone(input: CustomerAccountStandaloneCreateInput): Promise<CustomerAccountRecord> {
    return this.deps.commands.createStandalone(input);
  }

  async block(
    customerAccountId: string,
    input: { actorAdminUserId: string; reason?: string | null; audit?: CustomerAccountWriteRequestMeta },
  ): Promise<CustomerAccountRecord> {
    return this.deps.commands.block(customerAccountId, { reason: input.reason ?? null });
  }

  async unblock(
    customerAccountId: string,
    _input: { actorAdminUserId: string; audit?: CustomerAccountWriteRequestMeta },
  ): Promise<CustomerAccountRecord> {
    return this.deps.commands.unblock(customerAccountId);
  }

  async softDelete(customerAccountId: string, _input: { actorAdminUserId: string }): Promise<CustomerAccountRecord> {
    return this.deps.commands.softDelete(customerAccountId);
  }

  async restore(customerAccountId: string, _input: { actorAdminUserId: string }): Promise<CustomerAccountRecord> {
    return this.deps.commands.restore(customerAccountId);
  }

  async setOrganization(
    customerAccountId: string,
    organizationId: string,
    input: CustomerAccountOrganizationMoveInput,
  ): Promise<CustomerAccountRecord> {
    return this.#writeOrganization(
      'customer_account.organization_assigned',
      customerAccountId,
      organizationId,
      input,
    );
  }

  /**
   * D-178 — an operator detaching a member from a company.
   *
   * The write is byte-identical to {@link setOrganization}'s; only the audit
   * verb differs, and it is the verb this operation has always recorded. What
   * changed is what it writes: `organization_id = NULL` until D-178, which left
   * an account that could not place an order, submit an RFQ or read an address —
   * and which the column now refuses outright.
   *
   * The destination is the account's own personal organisation, resolved by the
   * caller through `organizations`. This module does not resolve it, because
   * that would make the account table's owner responsible for the tenancy
   * policy of the module it points at.
   */
  async detachToPersonalOrganization(
    customerAccountId: string,
    personalOrganizationId: string,
    input: CustomerAccountOrganizationMoveInput,
  ): Promise<CustomerAccountRecord> {
    return this.#writeOrganization(
      'customer_account.organization_unassigned',
      customerAccountId,
      personalOrganizationId,
      input,
    );
  }

  async #writeOrganization(
    action: string,
    customerAccountId: string,
    organizationId: string,
    input: CustomerAccountOrganizationMoveInput,
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    if (!isUuidShape(customerAccountId)) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    const account = await em.findOne(CustomerAccount, { id: customerAccountId, deletedAt: null });
    if (!account) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    const before = { organizationId: account.organizationId, organizationRoleId: account.organizationRoleId };
    // The role moves with the Organization, in one statement: the composite
    // foreign key refuses the previous Organization's role
    // (`specs/170-organization-roles/` research R-34).
    account.organizationId = organizationId;
    account.organizationRoleId = input.organizationRoleId;
    await em.flush();
    // A tenant move by name: the Organization ids stay out of the audit log (D-288).
    const { stateBefore, stateAfter } = organizationMoveAuditState(before, {
      organizationId,
      organizationRoleId: input.organizationRoleId,
    });
    await this.auditLog.record({
      actorAdminUserId: input.actorAdminUserId,
      action,
      objectType: 'customer_account',
      objectId: account.id,
      stateBefore,
      stateAfter,
      ipAddress: null,
      userAgent: null,
      requestId: null,
    });
    return toOneCustomerAccountRecord(this.twoFactorEnrolments, account);
  }

  async setCustomerGroup(
    customerAccountId: string,
    customerGroupId: string | null,
    _input: { actorAdminUserId: string },
  ): Promise<CustomerAccountRecord> {
    return this.deps.commands.setCustomerGroup(customerAccountId, { customerGroupId });
  }

  async setCustomFieldValues(
    customerAccountId: string,
    merge: (current: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ): Promise<CustomerAccountRecord> {
    return this.deps.commands.setCustomFieldValues(customerAccountId, merge);
  }

  async listDueForAnonymization(cutoff: Date): Promise<CustomerAccountRecord[]> {
    return this.deps.reads.listDueForAnonymization(cutoff);
  }

  async hasDueForAnonymization(cutoff: Date): Promise<boolean> {
    return this.deps.reads.hasDueForAnonymization(cutoff);
  }

  async anonymize(customerAccountId: string): Promise<CustomerAccountRecord> {
    return this.deps.commands.anonymize(customerAccountId);
  }
}

/**
 * The admin customer list (feature 040, US5).
 *
 * `customers` built the whole query itself — the lifecycle filter, the
 * sales-rep visibility scope, the free-text predicate and the page — against
 * this module's entity. The **shape** of the answer is that module's screen and
 * the **statement** is this module's table, so the criteria cross as plain data
 * and the SQL stays here. It has to be one statement: narrowing a page after
 * the fact returns fewer rows than the caller asked for, and paging after
 * narrowing reads the whole table.
 */
export class CustomerAccountAdminSearchService implements CustomerAccountAdminSearchPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly twoFactorEnrolments: TwoFactorEnrolmentReader,
  ) {}

  async search(
    criteria: CustomerAccountAdminSearchCriteria,
  ): Promise<CustomerAccountAdminSearchResult> {
    const and: FilterQuery<CustomerAccount>[] = [];

    if (criteria.status === 'blocked') {
      and.push({ blockedAt: { $ne: null }, deletedAt: null });
    } else if (criteria.status === 'deleted') {
      and.push({ deletedAt: { $ne: null } });
    } else {
      // The default "active" view excludes deleted accounts.
      and.push({ deletedAt: null });
    }

    if (criteria.organizationId) and.push({ organizationId: criteria.organizationId });
    if (criteria.customerGroupId) and.push({ customerGroupId: criteria.customerGroupId });

    // `null` is the platform administrator's unscoped read. Anything else is a
    // sales rep's territory.
    //
    // D-178 removed an `$or` arm here that also matched `organizationId: null`.
    // Its comment said a standalone account belonged to nobody's territory and
    // the predicate put it in **everybody's**: every sales representative's
    // customer list contained every null-organisation account on the platform,
    // and the population grew on every federated sign-in. That was a live
    // cross-territory disclosure, not an optimisation, and it is gone rather
    // than left unreachable — a predicate with no population still reads as
    // policy to whoever finds it next.
    if (criteria.allowedOrganizationIds !== null) {
      and.push({ organizationId: { $in: [...criteria.allowedOrganizationIds] } });
    }

    if (criteria.excludeDeleted) and.push({ deletedAt: null, anonymizedAt: null });

    // Issue #1903 — the custom-field filters, one id sub-select built by
    // `custom_fields`' list-filter port over this table. It is intersected with
    // this statement, whose tenant filter is the reach rule, so it narrows and
    // never widens; `findAndCount` applies it to both the page and the total,
    // as the Quote Requests list's does. The raw fragment is created fresh per
    // call, never kept (threat model F-2).
    const custom = criteria.customFieldCondition;
    if (custom) and.push({ id: { $in: raw(`(${custom.sql})`, [...custom.params]) } });

    const q = criteria.q?.trim();
    // `specs/150-admin-global-search/` — a field selection makes the match
    // literal and the order relevance-first; without one, nothing changes.
    const fields = criteria.qFields === undefined ? null : new Set(criteria.qFields);
    let orderBy: unknown = { createdAt: 'desc', id: 'desc' };
    if (q && fields === null) {
      const like = `%${q}%`;
      and.push({
        $or: [
          { email: { $ilike: like } },
          { firstName: { $ilike: like } },
          { lastName: { $ilike: like } },
        ],
      });
    } else if (q && fields !== null) {
      const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const like = `%${escaped}%`;
      const or: FilterQuery<CustomerAccount>[] = [];
      if (fields.has('email')) or.push({ email: { $ilike: like } });
      if (fields.has('name')) or.push({ firstName: { $ilike: like } }, { lastName: { $ilike: like } });
      if (or.length === 0) return { rows: [], total: 0 };
      and.push({ $or: or });
      orderBy = [
        ...(fields.has('email')
          ? [
              {
                [raw(
                  (alias) =>
                    `case when lower(${alias}.email) = lower(?) then 0 when ${alias}.email ilike ? then 1 else 2 end`,
                  [q, `${escaped}%`],
                )]: QueryOrder.ASC,
              },
            ]
          : []),
        { updatedAt: QueryOrder.DESC },
        { id: QueryOrder.ASC },
      ];
    }

    const where: FilterQuery<CustomerAccount> = and.length ? { $and: and } : {};
    const [rows, total] = await this.emFactory().findAndCount(CustomerAccount, where, {
      orderBy: orderBy as never,
      limit: criteria.pageSize,
      offset: (criteria.page - 1) * criteria.pageSize,
    });
    return { rows: await toCustomerAccountRecords(this.twoFactorEnrolments, rows), total };
  }
}
