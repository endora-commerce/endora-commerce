import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type CustomerAccountCreateInput,
  type CustomerAccountLookupOptions,
  type CustomerAccountMemberWritePort,
  type CustomerAccountProfilePatch,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type CustomerAccountRole,
  type CustomerAuthPort,
  type CustomerPasswordStatePort,
  type CustomerPasswordVerificationPort,
  type CustomerRolePort,
} from '@endora-commerce/contracts';
import { recordAuditFromContext } from '../../../commands/index.js';
import { HttpError } from '../../../http/error-envelope.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import { hashPassword, verifyPassword } from '../../../kernel/crypto/password-hasher.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import type { CustomerAuthService } from './customer-auth-service.js';
import type { RoleService } from './role-service.js';

/**
 * The published face of `customer_accounts` (feature 075, Phase P).
 *
 * Nineteen modules read this module's table today, 51 of the sites on the
 * entity class itself. What they ask for is narrow — an account by id, by ids,
 * by e-mail, by organisation, and the two counting questions the "an
 * organisation keeps at least one admin" rule is spelled with — so that is
 * what the read port is, rather than the table.
 *
 * The mapping below is the point of the exercise and not ceremony:
 * `passwordHash` does not survive it. It is read by exactly one module, and a
 * record that carried it would turn every consumer into a place a credential
 * can leak from.
 */

export function toCustomerAccountRecord(account: CustomerAccount): CustomerAccountRecord {
  return {
    id: account.id,
    organizationId: account.organizationId ?? null,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    role: account.role,
    emailVerifiedAt: account.emailVerifiedAt ?? null,
    twoFactorEnabled: Boolean(account.twoFactorConfirmedAt),
    lastLoginAt: account.lastLoginAt ?? null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    customFieldValues: account.customFieldValues ?? {},
    deletedAt: account.deletedAt ?? null,
    customerGroupId: account.customerGroupId ?? null,
    subtreeRollupEnabled: account.subtreeRollupEnabled,
    blockedAt: account.blockedAt ?? null,
    blockReason: account.blockReason ?? null,
    blockSource: account.blockSource ?? null,
    blockedByAdminUserId: account.blockedByAdminUserId ?? null,
    blockedByCustomerAccountId: account.blockedByCustomerAccountId ?? null,
    deletionRequestedByAdminUserId: account.deletionRequestedByAdminUserId ?? null,
    anonymizedAt: account.anonymizedAt ?? null,
  };
}

/** `{ deletedAt: null }` when the caller asked for it, nothing otherwise. */
function activeFilter(options?: CustomerAccountLookupOptions): { deletedAt?: null } {
  return options?.activeOnly ? { deletedAt: null } : {};
}

export class CustomerAccountReadService implements CustomerAccountReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(
    id: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null> {
    const account = await this.emFactory().findOne(CustomerAccount, {
      id,
      ...activeFilter(options),
    });
    return account ? toCustomerAccountRecord(account) : null;
  }

  async findByIds(
    ids: readonly string[],
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord[]> {
    if (ids.length === 0) return [];
    const accounts = await this.emFactory().find(CustomerAccount, {
      id: { $in: [...ids] },
      ...activeFilter(options),
    });
    return accounts.map(toCustomerAccountRecord);
  }

  async findByEmail(
    email: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null> {
    // The fold is here rather than at the four callers: this is the one
    // question "is this address taken" is asked through, and a caller that
    // folded its own way (or forgot to) is what made a registered account
    // unfindable by the address its holder had typed.
    const account = await this.emFactory().findOne(CustomerAccount, {
      email: normalizeEmailAddress(email),
      ...activeFilter(options),
    });
    return account ? toCustomerAccountRecord(account) : null;
  }

  async findInOrganization(
    id: string,
    organizationId: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null> {
    const account = await this.emFactory().findOne(CustomerAccount, {
      id,
      organizationId,
      ...activeFilter(options),
    });
    return account ? toCustomerAccountRecord(account) : null;
  }

  async listByOrganization(
    organizationId: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord[]> {
    const accounts = await this.emFactory().find(
      CustomerAccount,
      { organizationId, ...activeFilter(options) },
      { orderBy: { role: 'asc', createdAt: 'asc' } },
    );
    return accounts.map(toCustomerAccountRecord);
  }

  async countByOrganizationRole(
    organizationId: string,
    role: CustomerAccountRole,
    options?: {
      excludeCustomerAccountId?: string;
      activeOnly?: boolean;
      notBlocked?: boolean;
    },
  ): Promise<number> {
    return this.emFactory().count(CustomerAccount, {
      organizationId,
      role,
      ...(options?.activeOnly ? { deletedAt: null } : {}),
      ...(options?.notBlocked ? { blockedAt: null } : {}),
      ...(options?.excludeCustomerAccountId
        ? { id: { $ne: options.excludeCustomerAccountId } }
        : {}),
    });
  }

  async searchByEmail(query: string, limit: number): Promise<CustomerAccountRecord[]> {
    const trimmed = query.trim();
    const accounts = await this.emFactory().find(
      CustomerAccount,
      trimmed ? { email: { $ilike: `%${trimmed}%` } } : {},
      { orderBy: { email: 'asc' }, limit },
    );
    return accounts.map(toCustomerAccountRecord);
  }

  async searchIdsByName(query: string): Promise<string[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const like = `%${trimmed}%`;
    const accounts = await this.emFactory().find(
      CustomerAccount,
      {
        $or: [
          { email: { $ilike: like } },
          { firstName: { $ilike: like } },
          { lastName: { $ilike: like } },
        ],
      },
      { fields: ['id'] },
    );
    return accounts.map((account) => account.id);
  }

  async listAll(): Promise<CustomerAccountRecord[]> {
    const accounts = await this.emFactory().find(
      CustomerAccount,
      {},
      { orderBy: { email: 'asc' } },
    );
    return accounts.map(toCustomerAccountRecord);
  }
}

/**
 * Issue #222 — the one credential fact that crosses this boundary, and it
 * crosses as a date rather than as anything derived from the hash.
 *
 * Separate from {@link CustomerAccountReadService} on purpose: that read port
 * is what nineteen modules resolve, and the mapping above deliberately drops
 * `passwordHash`. "Does this account have a password its holder can use" is a
 * question one module asks, so it gets a port one module resolves.
 *
 * An unknown id answers `null`, not a throw: the caller's question is about a
 * credential, and "no account" and "no password on record" want the same
 * refusal from every caller there could be.
 */
export class CustomerPasswordStateService implements CustomerPasswordStatePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async passwordSetAt(customerAccountId: string): Promise<Date | null> {
    // A full load rather than a projection: a partially-loaded entity in the
    // identity map is a hazard for whatever flushes next in the same unit of
    // work, and only the date leaves this method either way.
    const account = await this.emFactory().findOne(CustomerAccount, { id: customerAccountId });
    return account?.passwordSetAt ?? null;
  }
}

/**
 * Step-up re-verification, for `mfa` (feature 080, T052).
 *
 * The read is this module's own row and the comparison is the platform
 * hasher's, so both halves are on this side of the seam. The composition roots
 * held them instead: each read `passwordHash` off the entity and called
 * `verifyPassword` itself, which is a credential column and a hash comparison
 * living in a file that owns neither.
 *
 * The hash never leaves this class — that is the difference between this port
 * and a `passwordHash` field on `CustomerAccountRecord`, and it is the whole
 * reason the port exists.
 */
export class CustomerPasswordVerificationService implements CustomerPasswordVerificationPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async verifyPassword(customerAccountId: string, password: string): Promise<boolean> {
    const account = await this.emFactory().findOne(CustomerAccount, { id: customerAccountId });
    // The bare call is the imported hasher: a class method is not in scope as
    // an identifier, so it shadows nothing.
    return account ? verifyPassword(account.passwordHash, password) : false;
  }
}

/**
 * The member lifecycle `organizations` runs over this module's table
 * (feature 075, Phase C).
 *
 * It ran it by creating and mutating the `CustomerAccount` entity in its own
 * services and route handlers — seven write sites across five files. They are
 * six methods here, each one unit of work on this table alone, because a write
 * port that took the caller's `EntityManager` would publish the coupling
 * instead of removing it (D-78).
 *
 * **Each write audits itself**, in the same unit of work, exactly as
 * `RoleService` and `addresses`' `AddressService` — the two write surfaces
 * `organizations` already reaches across this boundary — have always done. The
 * host's own row is a different fact and stays where it is: "an operator edited
 * this member on the organisation panel" is not "this account's e-mail
 * changed", and the role endpoint has recorded both for as long as it has
 * existed.
 */
export class CustomerAccountMemberWriteService implements CustomerAccountMemberWritePort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
  ) {}

  async create(input: CustomerAccountCreateInput): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
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
      organizationId: input.organizationId,
      email,
      passwordHash: await hashPassword(input.password),
      // Issue #222 — a password somebody supplied, so the account has one on
      // record from its first moment. This is the write both organisation
      // registration (the holder typed it) and the member admin surface (an
      // operator set it and hands it over) go through.
      passwordSetAt: new Date(),
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      ...(input.emailVerified ? { emailVerifiedAt: new Date() } : {}),
    });
    this.#audit(em, 'customer_account.create', account.id, null, {
      organizationId: account.organizationId ?? null,
      email: account.email,
      role: account.role,
    });
    try {
      await em.persistAndFlush(account);
    } catch (err) {
      // The unique index is the real arbiter; the pre-check above only buys a
      // better message for the common case. Two registrations racing on one
      // address must both answer 409 rather than one answering 500.
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

  async updateProfile(
    customerAccountId: string,
    patch: CustomerAccountProfilePatch,
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#loadLive(em, customerAccountId);
    const before = {
      email: account.email,
      firstName: account.firstName,
      lastName: account.lastName,
    };
    if (patch.email !== undefined) {
      const nextEmail = normalizeEmailAddress(patch.email);
      if (nextEmail !== account.email) {
        const taken = await em.findOne(CustomerAccount, { email: nextEmail, deletedAt: null });
        if (taken && taken.id !== account.id) {
          throw new HttpError(
            409,
            ERROR_CODES.EMAIL_ALREADY_REGISTERED,
            'That email is already used by another account.',
          );
        }
        account.email = nextEmail;
        account.emailVerifiedAt = null;
      }
    }
    if (patch.firstName !== undefined) account.firstName = patch.firstName;
    if (patch.lastName !== undefined) account.lastName = patch.lastName;
    this.#audit(em, 'customer_account.update_profile', account.id, before, {
      email: account.email,
      firstName: account.firstName,
      lastName: account.lastName,
    });
    await em.flush();
    return toCustomerAccountRecord(account);
  }

  async setSubtreeRollup(
    customerAccountId: string,
    enabled: boolean,
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#loadLive(em, customerAccountId);
    const before = { subtreeRollupEnabled: account.subtreeRollupEnabled };
    account.subtreeRollupEnabled = enabled;
    this.#audit(em, 'customer_account.set_subtree_rollup', account.id, before, {
      subtreeRollupEnabled: enabled,
    });
    await em.flush();
    return toCustomerAccountRecord(account);
  }

  async promoteToOrganizationAdmin(customerAccountId: string): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await this.#loadLive(em, customerAccountId);
    const before = { role: account.role };
    account.role = 'organization_admin';
    this.#audit(em, 'customer_account.promote_organization_admin', account.id, before, {
      role: account.role,
    });
    await em.flush();
    return toCustomerAccountRecord(account);
  }

  async markEmailVerified(
    customerAccountId: string,
    verifiedAt: Date,
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await em.findOne(CustomerAccount, { id: customerAccountId });
    if (!account) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
    }
    // Idempotent: a retried verification keeps the first timestamp, and records
    // nothing the second time — an audit row per retry would say a change
    // happened that did not.
    if (!account.emailVerifiedAt) {
      account.emailVerifiedAt = verifiedAt;
      this.#audit(em, 'customer_account.email_verified', account.id, { emailVerifiedAt: null }, {
        emailVerifiedAt: verifiedAt.toISOString(),
      });
      await em.flush();
    }
    return toCustomerAccountRecord(account);
  }

  async attachToOrganization(
    customerAccountId: string,
    organizationId: string,
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await em.findOne(CustomerAccount, { id: customerAccountId });
    if (!account) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
    }
    const before = { organizationId: account.organizationId ?? null };
    account.organizationId = organizationId;
    this.#audit(em, 'customer_account.attach_organization', account.id, before, {
      organizationId,
    });
    await em.flush();
    return toCustomerAccountRecord(account);
  }

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (!this.auditLog) return;
    recordAuditFromContext(this.auditLog, em, {
      action,
      objectType: 'customer_account',
      objectId,
      stateBefore,
      stateAfter,
    });
  }

  async #loadLive(em: EntityManager, id: string): Promise<CustomerAccount> {
    const account = await em.findOne(CustomerAccount, { id, deletedAt: null });
    if (!account) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
    }
    return account;
  }
}

/**
 * `CustomerAuthService.login` resolves to a `LoginResult` carrying the
 * `CustomerAccount` entity. The port hands back the record instead — the same
 * substitution the read service makes, for the same reason.
 *
 * The service arrives as a **getter** rather than a value so the adapter reads
 * it from the container per call. Constructing a second `CustomerAuthService`
 * here is precisely the divergence this module's conversion removed: the two
 * composition roots each built one, and their MFA argument differed.
 */
export function createCustomerAuthPort(getService: () => CustomerAuthService): CustomerAuthPort {
  return {
    async login(input) {
      const outcome = await getService().login(input);
      if (outcome.status !== 'authenticated') return outcome;
      return {
        status: 'authenticated',
        customerAccount: toCustomerAccountRecord(outcome.customerAccount),
        sessionCookieValue: outcome.sessionCookieValue,
        sessionExpiresAt: outcome.sessionExpiresAt,
      };
    },
    changePassword: (customerAccountId, currentPassword, newPassword) =>
      getService().changePassword(customerAccountId, currentPassword, newPassword),
    logout: (sessionId) => getService().logout(sessionId),
  };
}

/** Same substitution for the member-management surface `organizations` calls. */
export function createCustomerRolePort(getService: () => RoleService): CustomerRolePort {
  return {
    async listMembers(organizationId) {
      return (await getService().listMembers(organizationId)).map(toCustomerAccountRecord);
    },
    async changeRole(organizationId, targetCustomerAccountId, newRole) {
      return toCustomerAccountRecord(
        await getService().changeRole(organizationId, targetCustomerAccountId, newRole),
      );
    },
    removeMember: (organizationId, targetCustomerAccountId) =>
      getService().removeMember(organizationId, targetCustomerAccountId),
  };
}
