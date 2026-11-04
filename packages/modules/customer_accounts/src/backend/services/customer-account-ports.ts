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
  type CustomerAuthPort,
  type CustomerPasswordStatePort,
  type CustomerPasswordVerificationPort,
  type CustomerAccountRoleCommandPort,
  type CustomerRolePort,
} from '@endora-commerce/contracts';
import { recordAuditFromContext, type CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { hashPassword, verifyPassword } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import type { CustomerAuthService } from './customer-auth-service.js';
import { makeChangeCustomerAccountRoleCommand } from '../commands/customer-account-change-role.command.js';
import { makePromoteOrganizationAdminCommand } from '../commands/customer-account-promote-admin.command.js';
import { makeRemoveMemberCommand } from '../commands/customer-account-remove-member.command.js';
import {
  entityManagerAccountRoleStore,
  type CustomerAccountRoleCommandDeps,
  type OrganizationRoleLookup,
} from '../commands/customer-account-role-rules.js';
import type { TwoFactorEnrolmentReader } from './two-factor-enrolments.js';

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

/**
 * The published record, with `twoFactorEnabled` taken from `mfa` rather than
 * from this module's `two_factor_confirmed_at` column.
 *
 * The second parameter is required and has no default on purpose. That column's
 * only non-null writer was the superseded TOTP path deleted on 2026-08-25, so
 * the field was a **provably constant `false`** — on the admin customer detail,
 * on both organisation member panels, and on `GET /api/v1/me/customer`, which
 * is the buyer's own account page telling them their account is unprotected. A
 * default would let the next call site reintroduce that silently; making the
 * caller answer means the compiler asks.
 */
export function toCustomerAccountRecord(
  account: CustomerAccount,
  twoFactorEnabled: boolean,
): CustomerAccountRecord {
  return {
    id: account.id,
    organizationId: account.organizationId ?? null,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    organizationRoleId: account.organizationRoleId,
    emailVerifiedAt: account.emailVerifiedAt ?? null,
    twoFactorEnabled,
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

/**
 * One `mfa` read for a whole page of accounts, rather than one per row.
 *
 * Every caller is a list or a single row, so batching here keeps the admin
 * customer list at two queries instead of one per customer, and leaves the
 * single-row callers spelling the same thing.
 */
export async function toCustomerAccountRecords(
  twoFactorEnrolments: TwoFactorEnrolmentReader,
  accounts: readonly CustomerAccount[],
): Promise<CustomerAccountRecord[]> {
  if (accounts.length === 0) return [];
  const enrolled = await twoFactorEnrolments(accounts.map((account) => account.id));
  return accounts.map((account) => toCustomerAccountRecord(account, enrolled.has(account.id)));
}

/** The single-row spelling of {@link toCustomerAccountRecords}. */
export async function toOneCustomerAccountRecord(
  twoFactorEnrolments: TwoFactorEnrolmentReader,
  account: CustomerAccount,
): Promise<CustomerAccountRecord> {
  return (await toCustomerAccountRecords(twoFactorEnrolments, [account]))[0]!;
}

/** `{ deletedAt: null }` when the caller asked for it, nothing otherwise. */
function activeFilter(options?: CustomerAccountLookupOptions): { deletedAt?: null } {
  return options?.activeOnly ? { deletedAt: null } : {};
}

/**
 * The member order both member lists answer in: the Organization's
 * *Administrator* holders first, each group by creation date — what ordering by
 * the legacy two-value role gave, before `specs/170-organization-roles/` WP-12
 * dropped it. A stable sort over rows already in creation order.
 */
function administratorsFirst(accounts: CustomerAccount[], administratorRoleId: string): CustomerAccount[] {
  const rank = (account: CustomerAccount): number => (account.organizationRoleId === administratorRoleId ? 0 : 1);
  return [...accounts].sort((a, b) => rank(a) - rank(b));
}

export class CustomerAccountReadService implements CustomerAccountReadPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly twoFactorEnrolments: TwoFactorEnrolmentReader,
    /**
     * `organizations`' role read port, for {@link countAdministrators} and the
     * administrators-first order of {@link listByOrganization}
     * (`specs/170-organization-roles/`): which role is the Organization's
     * *Administrator* is that module's fact. Optional so the hand-built test
     * services that never ask need not wire it; without it the list is in
     * creation order.
     */
    private readonly roles?: Pick<OrganizationRoleLookup, 'predefinedRoleId'>,
  ) {}

  async findById(
    id: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null> {
    const account = await this.emFactory().findOne(CustomerAccount, {
      id,
      ...activeFilter(options),
    });
    return account ? toOneCustomerAccountRecord(this.twoFactorEnrolments, account) : null;
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
    return toCustomerAccountRecords(this.twoFactorEnrolments, accounts);
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
    return account ? toOneCustomerAccountRecord(this.twoFactorEnrolments, account) : null;
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
    return account ? toOneCustomerAccountRecord(this.twoFactorEnrolments, account) : null;
  }

  async listByOrganization(
    organizationId: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord[]> {
    const accounts = await this.emFactory().find(
      CustomerAccount,
      { organizationId, ...activeFilter(options) },
      { orderBy: { createdAt: 'asc' } },
    );
    const ordered = this.roles
      ? administratorsFirst(accounts, await this.roles.predefinedRoleId(organizationId, 'administrator'))
      : accounts;
    return toCustomerAccountRecords(this.twoFactorEnrolments, ordered);
  }

  async countAdministrators(
    organizationId: string,
    options?: {
      excludeCustomerAccountId?: string;
      activeOnly?: boolean;
      notBlocked?: boolean;
    },
  ): Promise<number> {
    if (!this.roles) {
      throw new Error(
        'CustomerAccountReadService.countAdministrators needs organizationRoleReadPort; construct the service with it.',
      );
    }
    const administratorRoleId = await this.roles.predefinedRoleId(organizationId, 'administrator');
    return this.emFactory().count(CustomerAccount, {
      organizationId,
      organizationRoleId: administratorRoleId,
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
    return toCustomerAccountRecords(this.twoFactorEnrolments, accounts);
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
    return toCustomerAccountRecords(this.twoFactorEnrolments, accounts);
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
 * `addresses`' `AddressService` does — the role changes, which `RoleService`
 * used to audit the same way, are Commands since `specs/170-organization-roles/`
 * WP-02b, and so is {@link CustomerAccountMemberWriteService.promoteToOrganizationAdmin}. The
 * host's own row is a different fact and stays where it is: "an operator edited
 * this member on the organisation panel" is not "this account's e-mail
 * changed", and the role endpoint has recorded both for as long as it has
 * existed.
 */
export class CustomerAccountMemberWriteService implements CustomerAccountMemberWritePort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly twoFactorEnrolments: TwoFactorEnrolmentReader,
    private readonly auditLog?: AuditPort,
    /**
     * The bus and the role lookup {@link promoteToOrganizationAdmin} runs its
     * Command with (`specs/170-organization-roles/` WP-02b). Optional so the
     * hand-built test services that never promote need not wire them; the
     * method refuses without them.
     */
    private readonly roleCommands?: { commandBus: CommandBus; roles: OrganizationRoleLookup },
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
      organizationRoleId: input.organizationRoleId,
      ...(input.emailVerified ? { emailVerifiedAt: new Date() } : {}),
    });
    this.#audit(em, 'customer_account.create', account.id, null, {
      organizationId: account.organizationId ?? null,
      email: account.email,
      organizationRoleId: account.organizationRoleId,
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
    return toOneCustomerAccountRecord(this.twoFactorEnrolments, account);
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
    return toOneCustomerAccountRecord(this.twoFactorEnrolments, account);
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
    return toOneCustomerAccountRecord(this.twoFactorEnrolments, account);
  }

  /**
   * Runs `customer_account.promote_organization_admin` on the bus
   * (`specs/170-organization-roles/` WP-02b): the Command writes the role and
   * its legacy value, and the bus records its one audit entry.
   */
  async promoteToOrganizationAdmin(customerAccountId: string): Promise<CustomerAccountRecord> {
    const roleCommands = this.roleCommands;
    if (!roleCommands) {
      throw new Error(
        'CustomerAccountMemberWriteService: the promotion runs a Command; construct the service with its bus and role lookup.',
      );
    }
    const account = await this.#loadLive(this.emFactory(), customerAccountId);
    await roleCommands.commandBus.run(
      makePromoteOrganizationAdminCommand(
        { roles: roleCommands.roles, store: entityManagerAccountRoleStore },
        { organizationId: account.organizationId, customerAccountId: account.id },
      ),
    );
    const promoted = await this.emFactory().findOneOrFail(CustomerAccount, { id: account.id }, { refresh: true });
    return toOneCustomerAccountRecord(this.twoFactorEnrolments, promoted);
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
    return toOneCustomerAccountRecord(this.twoFactorEnrolments, account);
  }

  async attachToOrganization(
    customerAccountId: string,
    organizationId: string,
    organizationRoleId: string,
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    const account = await em.findOne(CustomerAccount, { id: customerAccountId });
    if (!account) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
    }
    const before = {
      organizationId: account.organizationId ?? null,
      organizationRoleId: account.organizationRoleId ?? null,
    };
    // The role moves with the Organization: the composite foreign key refuses
    // the previous Organization's role (`specs/170-organization-roles/` R-34).
    account.organizationId = organizationId;
    account.organizationRoleId = organizationRoleId;
    this.#audit(em, 'customer_account.attach_organization', account.id, before, {
      organizationId,
      organizationRoleId,
    });
    await em.flush();
    return toOneCustomerAccountRecord(this.twoFactorEnrolments, account);
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
export function createCustomerAuthPort(
  getService: () => CustomerAuthService,
  twoFactorEnrolments: TwoFactorEnrolmentReader,
): CustomerAuthPort {
  return {
    async login(input) {
      const outcome = await getService().login(input);
      if (outcome.status !== 'authenticated') return outcome;
      return {
        status: 'authenticated',
        customerAccount: await toOneCustomerAccountRecord(
          twoFactorEnrolments,
          outcome.customerAccount,
        ),
        sessionCookieValue: outcome.sessionCookieValue,
        sessionExpiresAt: outcome.sessionExpiresAt,
        knownDevice: outcome.knownDevice,
      };
    },
    changePassword: (customerAccountId, currentPassword, newPassword, context) =>
      getService().changePassword(customerAccountId, currentPassword, newPassword, context),
    logout: (sessionId) => getService().logout(sessionId),
  };
}

/**
 * The member-management surface `organizations` calls (`customerRolePort`),
 * over the member Commands since `specs/170-organization-roles/` WP-02b — it
 * adapted `RoleService`, which wrote and audited by hand. A role change is the
 * `customer_account.change_role` Command, through
 * {@link createCustomerAccountRoleCommandPort}.
 */
export function createCustomerRolePort(deps: {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  roles: OrganizationRoleLookup;
  twoFactorEnrolments: TwoFactorEnrolmentReader;
}): CustomerRolePort {
  const commandDeps: CustomerAccountRoleCommandDeps = { roles: deps.roles, store: entityManagerAccountRoleStore };
  return {
    async listMembers(organizationId) {
      const members = await deps.emFactory().find(
        CustomerAccount,
        { organizationId, deletedAt: null },
        { orderBy: { createdAt: 'asc' } },
      );
      return toCustomerAccountRecords(
        deps.twoFactorEnrolments,
        administratorsFirst(members, await deps.roles.predefinedRoleId(organizationId, 'administrator')),
      );
    },
    async removeMember(organizationId, targetCustomerAccountId) {
      await deps.commandBus.run(
        makeRemoveMemberCommand(commandDeps, { organizationId, customerAccountId: targetCustomerAccountId }),
      );
    },
  };
}

/**
 * `customerAccountRoleCommandPort` — the role assignment as a Command factory,
 * for `organizations`' role deletion to run as children (research R-22).
 */
export function createCustomerAccountRoleCommandPort(deps: {
  emFactory: () => EntityManager;
  roles: OrganizationRoleLookup;
}): CustomerAccountRoleCommandPort {
  const commandDeps: CustomerAccountRoleCommandDeps = { roles: deps.roles, store: entityManagerAccountRoleStore };
  return {
    changeRole: (input) => makeChangeCustomerAccountRoleCommand(commandDeps, input),
    async holdersOf(organizationId, roleId) {
      // Every holder — removed and blocked ones included: the foreign key
      // counts them all. A plain read, so the ids come back without loading
      // the entities into anybody's unit of work.
      const rows = (await deps.emFactory().execute(
        `select "id" from "customer_accounts"
          where "organization_id" = ? and "organization_role_id" = ?
          order by "id"`,
        [organizationId, roleId],
      )) as Array<{ id: string }>;
      return rows.map((row) => row.id);
    },
  };
}
