import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type CustomerAccountCommandPort,
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
  type CustomerAccountMemberCommandPort,
  type CustomerRolePort,
  isUuidShape,
} from '@endora-commerce/contracts';
import { recordAuditFromContext, type CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { verifyPassword } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import type { CustomerAuthService } from './customer-auth-service.js';
import { makeChangeCustomerAccountRoleCommand } from '../commands/customer-account-change-role.command.js';
import { makeRemoveMemberCommand } from '../commands/customer-account-remove-member.command.js';
import { prepareCustomerAccountCreate } from '../commands/customer-account-create.command.js';
import {
  entityManagerAccountRoleStore,
  type CustomerAccountRoleCommandDeps,
  type OrganizationRoleLookup,
} from '../commands/customer-account-role-rules.js';
import type { TwoFactorEnrolmentReader } from './two-factor-enrolments.js';
// A cycle by design: the deprecated member port delegates to the aggregate
// port, which maps its rows with this file's `toCustomerAccountRecord`. Both
// are used only inside calls, never while either module is being evaluated.
import { CustomerAccountCommandService } from './customer-account-command-port.js';
import { anyRowExists, type WorkRows } from './scheduled-work-probe.js';
import { organizationMoveAuditState } from './customer-account-audit-state.js';

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
    preferredLanguage: account.preferredLanguage ?? null,
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
    if (!isUuidShape(id)) return null;
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
    if (!isUuidShape(id) || !isUuidShape(organizationId)) return null;
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

  /**
   * The retention sweep's work list (`specs/186-aggregate-ports/` moved it here
   * from the deprecated lifecycle port): the ids through the shared row source,
   * then the entities through the ORM, so the tenant filter still applies.
   */
  async listDueForAnonymization(cutoff: Date): Promise<CustomerAccountRecord[]> {
    const em = this.emFactory();
    const due = dueForAnonymization(cutoff);
    const rows = await em.execute<Array<{ id: string }>>(`select "id" ${due.from}`, [...due.params]);
    if (rows.length === 0) return [];
    const accounts = await em.find(CustomerAccount, { id: { $in: rows.map((row) => row.id) } });
    return toCustomerAccountRecords(this.twoFactorEnrolments, accounts);
  }

  /**
   * The sweep tick's question, asked outside any tenant scope (issue #857;
   * `docs/docs/architecture/tenant-scoping.md` § *A scheduled tick with nothing
   * to do enters no scope*). It learns one bit, through `anyRowExists`, over the
   * work list's own row source.
   */
  async hasDueForAnonymization(cutoff: Date): Promise<boolean> {
    return anyRowExists(this.emFactory(), [dueForAnonymization(cutoff)]);
  }
}

/**
 * The accounts the retention sweep anonymises at `cutoff`, as a row source —
 * **the one statement of that rule** (issue #857). Soft-deleted before the
 * cutoff and not anonymised yet, **or** anonymised by an earlier scrub that left
 * residue behind (issue #843, `hasScrubResidue` in
 * `commands/customer-account-anonymize.command.ts`). The residue branch is not
 * under the cutoff: the window already elapsed once, and an operator raising
 * `customers.deletion_retention_days` afterwards must not take the account off
 * the list for good. `listDueForAnonymization` lists through it and
 * `hasDueForAnonymization` asks through it, so a condition added here is added
 * to both by the same edit and the sweep's question cannot drift from its work
 * list.
 */
function dueForAnonymization(cutoff: Date): WorkRows {
  return {
    from:
      'from "customer_accounts" where ("deleted_at" is not null and "deleted_at" < ? and "anonymized_at" is null)' +
      ` or ("anonymized_at" is not null and ("block_reason" is not null or "custom_field_values" <> '{}'::jsonb` +
      ` or "preferred_language" is not null))`,
    params: [cutoff],
  };
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
 * `customerAccountMemberWritePort` — the member lifecycle `organizations` runs
 * over accounts in its Organizations (feature 075, Phase C).
 *
 * **Deprecated since 0.113.0** (`specs/186-aggregate-ports/` T051, issue
 * #1822): `create`, `updateProfile`, `setSubtreeRollup`,
 * `promoteToOrganizationAdmin` and `markEmailVerified` delegate to
 * `customerAccountCommandPort`, so each runs the Command it ran — or, for
 * `updateProfile` and `markEmailVerified`, the Command its hand-written entry
 * became — with the same action, state and refusals.
 *
 * `attachToOrganization` is a move between Organizations, the Membership
 * concern `specs/191-membership-join-requests/` owns; it is left as it is and
 * deprecated there.
 */
export class CustomerAccountMemberWriteService implements CustomerAccountMemberWritePort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly twoFactorEnrolments: TwoFactorEnrolmentReader,
    private readonly auditLog?: AuditPort,
    /**
     * The aggregate port the deprecated methods delegate to. A hand-built test
     * service may pass only a bus (and the role lookup the promotion needs), and
     * gets a port over them; without either, each delegated method refuses.
     */
    private readonly commands?: {
      commandBus?: CommandBus;
      roles?: OrganizationRoleLookup;
      port?: CustomerAccountCommandPort;
    },
  ) {}

  async create(input: CustomerAccountCreateInput): Promise<CustomerAccountRecord> {
    return this.#port().create(input);
  }

  async updateProfile(customerAccountId: string, patch: CustomerAccountProfilePatch): Promise<CustomerAccountRecord> {
    return this.#port().updateProfile(customerAccountId, patch);
  }

  async setSubtreeRollup(customerAccountId: string, enabled: boolean): Promise<CustomerAccountRecord> {
    return this.#port().setSubtreeRollup(customerAccountId, { enabled });
  }

  async promoteToOrganizationAdmin(customerAccountId: string): Promise<CustomerAccountRecord> {
    return this.#port().promoteToOrganizationAdmin(customerAccountId);
  }

  async markEmailVerified(customerAccountId: string, verifiedAt: Date): Promise<CustomerAccountRecord> {
    return this.#port().markEmailVerified(customerAccountId, { verifiedAt });
  }

  async attachToOrganization(
    customerAccountId: string,
    organizationId: string,
    organizationRoleId: string,
  ): Promise<CustomerAccountRecord> {
    const em = this.emFactory();
    if (!isUuidShape(customerAccountId)) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
    }
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
    // A tenant move by name: the Organization ids stay out of the audit log (D-288).
    const move = organizationMoveAuditState(before, { organizationId, organizationRoleId });
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'customer_account.attach_organization',
        objectType: 'customer_account',
        objectId: account.id,
        stateBefore: move.stateBefore,
        stateAfter: move.stateAfter,
      });
    }
    await em.flush();
    return toOneCustomerAccountRecord(this.twoFactorEnrolments, account);
  }

  #delegate: CustomerAccountCommandPort | undefined;

  #port(): CustomerAccountCommandPort {
    if (this.commands?.port) return this.commands.port;
    const commandBus = this.commands?.commandBus;
    if (!commandBus) {
      throw new Error('CustomerAccountMemberWriteService: each write runs a Command; construct the service with its bus.');
    }
    this.#delegate ??= memberCommandServiceOver({
      emFactory: this.emFactory,
      twoFactorEnrolments: this.twoFactorEnrolments,
      commandBus,
      ...(this.commands?.roles ? { roles: this.commands.roles } : {}),
    });
    return this.#delegate;
  }
}

/**
 * The aggregate port over a bus alone, for a hand-built service that delegates
 * only the member methods: the lifecycle dependencies (sessions, provisioning,
 * the personal-Organization check) refuse if anything ever reaches for them.
 */
function memberCommandServiceOver(deps: {
  emFactory: () => EntityManager;
  twoFactorEnrolments: TwoFactorEnrolmentReader;
  commandBus: CommandBus;
  roles?: OrganizationRoleLookup;
}): CustomerAccountCommandPort {
  const unwired = (what: string) => (): never => {
    throw new Error(`CustomerAccountMemberWriteService: ${what} is not wired on a member-only service.`);
  };
  return new CustomerAccountCommandService({
    commandBus: deps.commandBus,
    emFactory: deps.emFactory,
    twoFactorEnrolments: deps.twoFactorEnrolments,
    roles: deps.roles ?? { findRole: unwired('the role lookup'), predefinedRoleId: unwired('the role lookup') },
    isPersonal: unwired('the personal-Organization check'),
    personalOrganizations: { provisionFor: unwired('the personal-Organization provisioning') },
    sessions: { destroyAllForCustomer: unwired('the session store') },
    afterCommit: unwired('the after-commit scope'),
  });
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
 * `specs/176-command-hooks-outbox/` — what {@link prepareCustomerAccountCreate}
 * maps a just-written account with. A brand-new account holds no second factor,
 * so the record says so without asking `mfa`: the Command runs inside its
 * caller's transaction, and a read on another connection there would be a
 * remote call holding it open for an answer that is known.
 */
const NEW_ACCOUNT_RECORD = {
  toRecord: (account: CustomerAccount): CustomerAccountRecord => toCustomerAccountRecord(account, false),
};

/**
 * `customerAccountMemberCommandPort` — the account creation as a Command
 * factory, for `organizations`' registration to run as a child of
 * `organization.register` (`specs/176-command-hooks-outbox/` FR-002, FR-005).
 * The password is hashed by `prepareCreate`, before the caller's transaction.
 */
export function createCustomerAccountMemberCommandPort(): CustomerAccountMemberCommandPort {
  return {
    prepareCreate: (input) => prepareCustomerAccountCreate(input, NEW_ACCOUNT_RECORD),
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
