import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type CustomerAccountAdminSearchCriteria,
  type CustomerAccountAdminSearchPort,
  type CustomerAccountAdminSearchResult,
  type CustomerAccountLifecycleWritePort,
  type CustomerAccountRecord,
  type CustomerAccountStandaloneCreateInput,
  type CustomerAccountWriteRequestMeta,
} from '@b2b/contracts';
import type { Command, CommandBus } from '../../../commands/index.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import { HttpError } from '../../../http/error-envelope.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { hashPassword } from '../../../kernel/crypto/password-hasher.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { toCustomerAccountRecord } from './customer-account-ports.js';

/**
 * The account lifecycle `customers` runs over this module's table
 * (feature 075, Phase C).
 *
 * It ran it by loading and mutating the `CustomerAccount` entity in five of its
 * own services and two route files — block, unblock, soft-delete, restore,
 * anonymise, organisation assignment, group assignment, the standalone
 * registration and the admin custom-field patch. Each is one method here, each
 * one unit of work on this table alone, because a write port that took the
 * caller's `EntityManager` would publish the coupling instead of removing it
 * (D-78).
 *
 * **The policy stayed with the caller.** Whether the acting staff member may
 * touch this customer, and whether the write would strand an organisation
 * without an administrator, are `customers`' questions and are still asked
 * there; the counting half of the second is
 * `CustomerAccountReadPort.countByOrganizationRole`, which already existed.
 *
 * **The audit row came here** — one row, with the action string the caller used
 * to write, so nothing an operator can see moved. Unlike
 * `CustomerAccountMemberWriteService` the caller keeps no second row: there,
 * "an operator edited this member on the organisation panel" and "this
 * account's e-mail changed" are two facts; here "an operator blocked this
 * customer" *is* the write, and recording it twice would be a defect rather
 * than a pair.
 */

/** The name a scrubbed account's first and last name are replaced with. */
export const ANONYMIZED_CUSTOMER_NAME = 'Deleted customer';

/**
 * The placeholder written over `password_hash`. It is deliberately not a hash
 * of anything: the column is NOT NULL, and nothing may authenticate against a
 * scrubbed account. `passwordSetAt` is cleared beside it (issue #222).
 */
export const ANONYMIZED_PASSWORD_HASH = 'anonymized-no-login';

function blockSnapshot(account: CustomerAccount): Record<string, unknown> {
  return {
    blockedAt: account.blockedAt ? account.blockedAt.toISOString() : null,
    blockSource: account.blockSource ?? null,
    blockReason: account.blockReason ?? null,
  };
}

export class CustomerAccountLifecycleWriteService implements CustomerAccountLifecycleWritePort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditLogService,
    /**
     * Only {@link setCustomFieldValues} needs it, because that one write is a
     * read-modify-write and has to stay in one transaction. The method says so
     * and refuses without it.
     */
    private readonly commandBus?: CommandBus,
  ) {}

  async createStandalone(
    input: CustomerAccountStandaloneCreateInput,
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    // Folded, like the other write on this table and like every read of it.
    // This entrance stored the address verbatim while
    // `CustomerAccountMemberWriteService.create` folded it, so which spelling a
    // row held depended on which door the buyer came through; the login read
    // matched neither reliably. One normalisation now answers for all of them.
    const email = normalizeEmailAddress(input.email);
    const existing = await em.findOne(CustomerAccount, { email });
    if (existing) {
      throw new HttpError(
        409,
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'An account with this email already exists.',
      );
    }
    const account = em.create(CustomerAccount, {
      email,
      passwordHash: await hashPassword(input.password),
      // Issue #222 — the visitor typed this password on the registration form.
      passwordSetAt: new Date(),
      firstName: input.firstName,
      lastName: input.lastName,
      organizationId: null,
    });
    // Self-registration is pre-auth, so there is no ambient actor and the row
    // is recorded with a null one — as it was before this write moved here.
    recordAuditFromContext(this.auditLog, em, {
      action: 'customer_account.register_standalone',
      objectType: 'customer_account',
      objectId: account.id,
      stateBefore: null,
      stateAfter: { email: account.email },
    });
    try {
      await em.persistAndFlush(account);
    } catch (err) {
      // The unique index is the real arbiter; the pre-check above only buys a
      // better message for the common case.
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.EMAIL_ALREADY_REGISTERED,
          'An account with this email already exists.',
        );
      }
      throw err;
    }
    return toCustomerAccountRecord(account);
  }

  async block(
    customerAccountId: string,
    input: {
      actorAdminUserId: string;
      reason?: string | null;
      audit?: CustomerAccountWriteRequestMeta;
    },
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#loadLive(em, customerAccountId);
    if (account.blockedAt) return toCustomerAccountRecord(account);

    const before = blockSnapshot(account);
    account.blockedAt = new Date();
    account.blockSource = 'staff';
    account.blockedByAdminUserId = input.actorAdminUserId;
    account.blockedByCustomerAccountId = null;
    account.blockReason = input.reason ?? null;
    await em.flush();
    await this.#record(
      'customer_account.blocked',
      account.id,
      input.actorAdminUserId,
      before,
      blockSnapshot(account),
      input.audit,
    );
    return toCustomerAccountRecord(account);
  }

  async unblock(
    customerAccountId: string,
    input: { actorAdminUserId: string; audit?: CustomerAccountWriteRequestMeta },
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#loadLive(em, customerAccountId);
    if (!account.blockedAt) return toCustomerAccountRecord(account);

    const before = blockSnapshot(account);
    account.blockedAt = null;
    account.blockSource = null;
    account.blockedByAdminUserId = null;
    account.blockedByCustomerAccountId = null;
    account.blockReason = null;
    await em.flush();
    await this.#record(
      'customer_account.unblocked',
      account.id,
      input.actorAdminUserId,
      before,
      blockSnapshot(account),
      input.audit,
    );
    return toCustomerAccountRecord(account);
  }

  async softDelete(
    customerAccountId: string,
    input: { actorAdminUserId: string },
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#load(em, customerAccountId);
    if (account.deletedAt) {
      throw new HttpError(
        409,
        ERROR_CODES.CUSTOMER_ALREADY_DELETED,
        'Customer is already deleted.',
      );
    }
    account.deletedAt = new Date();
    account.deletionRequestedByAdminUserId = input.actorAdminUserId;
    await em.flush();
    await this.#record(
      'customer_account.deleted',
      account.id,
      input.actorAdminUserId,
      { deletedAt: null },
      { deletedAt: account.deletedAt.toISOString() },
    );
    return toCustomerAccountRecord(account);
  }

  async restore(
    customerAccountId: string,
    input: { actorAdminUserId: string },
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#load(em, customerAccountId);
    if (!account.deletedAt) {
      throw new HttpError(409, ERROR_CODES.CUSTOMER_NOT_DELETED, 'Customer is not deleted.');
    }
    if (account.anonymizedAt) {
      throw new HttpError(
        409,
        ERROR_CODES.CUSTOMER_RESTORE_WINDOW_ELAPSED,
        'The restore window has elapsed; this account has been permanently anonymized.',
      );
    }
    account.deletedAt = null;
    account.deletionRequestedByAdminUserId = null;
    await em.flush();
    await this.#record(
      'customer_account.restored',
      account.id,
      input.actorAdminUserId,
      { deletedAt: 'set' },
      { deletedAt: null },
    );
    return toCustomerAccountRecord(account);
  }

  async setOrganization(
    customerAccountId: string,
    organizationId: string | null,
    input: { actorAdminUserId: string },
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#loadLive(em, customerAccountId);
    const before = { organizationId: account.organizationId ?? null };
    account.organizationId = organizationId;
    await em.flush();
    await this.#record(
      organizationId === null
        ? 'customer_account.organization_unassigned'
        : 'customer_account.organization_assigned',
      account.id,
      input.actorAdminUserId,
      before,
      { organizationId },
    );
    return toCustomerAccountRecord(account);
  }

  async setCustomerGroup(
    customerAccountId: string,
    customerGroupId: string | null,
    input: { actorAdminUserId: string },
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#loadLive(em, customerAccountId);
    const before = { customerGroupId: account.customerGroupId ?? null };
    account.customerGroupId = customerGroupId;
    await em.flush();
    await this.#record(
      'customer_account.group_assigned',
      account.id,
      input.actorAdminUserId,
      before,
      { customerGroupId },
    );
    return toCustomerAccountRecord(account);
  }

  async setCustomFieldValues(
    customerAccountId: string,
    merge: (current: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ): Promise<CustomerAccountRecord> {
    const commandBus = this.commandBus;
    if (!commandBus) {
      throw new Error(
        'CustomerAccountLifecycleWriteService: the custom-field write runs a Command; construct the service with a CommandBus.',
      );
    }
    const command: Command<CustomerAccountRecord> = {
      action: 'customer.custom_fields.update',
      objectType: 'customer_account',
      objectId: customerAccountId,
      capture: async ({ em }) => {
        const account = await em.findOne(CustomerAccount, { id: customerAccountId });
        return account ? { customFieldValues: account.customFieldValues ?? {} } : null;
      },
      run: async ({ em }) => {
        const account = await em.findOne(CustomerAccount, { id: customerAccountId });
        if (!account) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer not found.');
        }
        account.customFieldValues = await merge(account.customFieldValues ?? {});
        return {
          result: toCustomerAccountRecord(account),
          after: { customFieldValues: account.customFieldValues },
        };
      },
    };
    return commandBus.run(command);
  }

  async listDueForAnonymization(cutoff: Date): Promise<CustomerAccountRecord[]> {
    const accounts = await this.emFactory().find(CustomerAccount, {
      deletedAt: { $ne: null, $lt: cutoff },
      anonymizedAt: null,
    });
    return accounts.map(toCustomerAccountRecord);
  }

  async anonymize(customerAccountId: string): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#load(em, customerAccountId);
    if (account.anonymizedAt) return toCustomerAccountRecord(account);

    const before = { email: account.email };
    account.email = `deleted+${account.id}@anonymized.invalid`;
    account.firstName = ANONYMIZED_CUSTOMER_NAME;
    account.lastName = ANONYMIZED_CUSTOMER_NAME;
    account.passwordHash = ANONYMIZED_PASSWORD_HASH;
    // Issue #222 — the scrubbed hash is a placeholder, not a credential, so the
    // account has no password on record any more. Leaving the stamp would say
    // the opposite of what the scrub just did.
    account.passwordSetAt = null;
    account.twoFactorSecret = null;
    account.twoFactorConfirmedAt = null;
    account.anonymizedAt = new Date();
    await em.flush();
    // The sweep runs on a timer, so there is no operator to attribute it to.
    await this.#record('customer_account.anonymized', account.id, null, before, {
      anonymizedAt: account.anonymizedAt.toISOString(),
    });
    return toCustomerAccountRecord(account);
  }

  async #record(
    action: string,
    objectId: string,
    actorAdminUserId: string | null,
    stateBefore: Record<string, unknown>,
    stateAfter: Record<string, unknown>,
    meta?: CustomerAccountWriteRequestMeta,
  ): Promise<void> {
    await this.auditLog.record({
      actorAdminUserId,
      action,
      objectType: 'customer_account',
      objectId,
      stateBefore,
      stateAfter,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
      requestId: meta?.requestId ?? null,
    });
  }

  async #load(em: EntityManager, id: string): Promise<CustomerAccount> {
    const account = await em.findOne(CustomerAccount, { id });
    if (!account) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    return account;
  }

  async #loadLive(em: EntityManager, id: string): Promise<CustomerAccount> {
    const account = await em.findOne(CustomerAccount, { id, deletedAt: null });
    if (!account) {
      throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
    }
    return account;
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
  constructor(private readonly emFactory: () => EntityManager) {}

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
    // sales rep's territory, and a standalone account belongs to nobody's.
    if (criteria.allowedOrganizationIds !== null) {
      and.push({
        $or: [
          { organizationId: null },
          { organizationId: { $in: [...criteria.allowedOrganizationIds] } },
        ],
      });
    }

    const q = criteria.q?.trim();
    if (q) {
      const like = `%${q}%`;
      and.push({
        $or: [
          { email: { $ilike: like } },
          { firstName: { $ilike: like } },
          { lastName: { $ilike: like } },
        ],
      });
    }

    const where: FilterQuery<CustomerAccount> = and.length ? { $and: and } : {};
    const [rows, total] = await this.emFactory().findAndCount(CustomerAccount, where, {
      orderBy: { createdAt: 'desc' },
      limit: criteria.pageSize,
      offset: (criteria.page - 1) * criteria.pageSize,
    });
    return { rows: rows.map(toCustomerAccountRecord), total };
  }
}
