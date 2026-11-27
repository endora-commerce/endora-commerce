import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z, type ZodType } from 'zod';
import {
  assignCustomerGroupRequestSchema,
  blockCustomerRequestSchema,
  ERROR_CODES,
  isUuidShape,
  patchCustomerPreferredLanguageBodySchema,
  type AggregateCommandOptions,
  type AuthSessionPort,
  type CustomerAccountAnonymizedEventV1,
  type CustomerAccountCommandPort,
  type CustomerAccountCreateInput,
  type CustomerAccountProfilePatch,
  type CustomerAccountRecord,
  type CustomerAccountStandaloneCreateInput,
  type CustomFieldMerge,
} from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { hashPassword } from '@endora-commerce/platform/kernel';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { assertCallerSource, withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { makeAnonymizeCustomerAccountCommand } from '../commands/customer-account-anonymize.command.js';
import { makeChangeCustomerAccountRoleCommand } from '../commands/customer-account-change-role.command.js';
import { prepareCustomerAccountCreate } from '../commands/customer-account-create.command.js';
import {
  makeBlockCustomerAccountCommand,
  makeRestoreCustomerAccountCommand,
  makeSetCustomerCustomFieldValuesCommand,
  makeSetCustomerGroupCommand,
  makeSoftDeleteCustomerAccountCommand,
  makeUnblockCustomerAccountCommand,
} from '../commands/customer-account-lifecycle.commands.js';
import {
  makeMarkCustomerAccountEmailVerifiedCommand,
  makeUpdateCustomerAccountProfileCommand,
} from '../commands/customer-account-profile.commands.js';
import { makePromoteOrganizationAdminCommand } from '../commands/customer-account-promote-admin.command.js';
import { makeRegisterStandaloneCommand } from '../commands/customer-account-register-standalone.command.js';
import { makeRemoveMemberCommand } from '../commands/customer-account-remove-member.command.js';
import {
  entityManagerAccountRoleStore,
  memberNotFound,
  type CustomerAccountRoleCommandDeps,
  type OrganizationRoleLookup,
  type PersonalOrganizationCheck,
} from '../commands/customer-account-role-rules.js';
import { makeSetCustomerAccountPreferredLanguageCommand } from '../commands/customer-account-set-preferred-language.command.js';
import { makeSetCustomerAccountSubtreeRollupCommand } from '../commands/customer-account-set-subtree-rollup.command.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { toCustomerAccountRecord, toOneCustomerAccountRecord } from './customer-account-ports.js';
import type { TwoFactorEnrolmentReader } from './two-factor-enrolments.js';

/**
 * `customerAccountCommandPort` (`specs/186-aggregate-ports/` US3, issue #1822)
 * — the CustomerAccount aggregate's write port. The contract, the refusals and
 * the options are `CustomerAccountCommandPort` in `@endora-commerce/contracts`.
 *
 * **It checks no permission.** The caller is the gate: `customers`' and
 * `organizations`' admin routes ask `customers:manage` and the operator's
 * reach, then call this port, so an operator's click and a server-side call run
 * the same Command (FR-002). Each method validates `source` before it reads
 * anything (issue #1922), parses its input with the admin route's limits (a
 * refusal is `422 VALIDATION_FAILED`), and runs one Command factory of
 * `commands/`; the caller's `source` and `extensions` are added to it by
 * `withCallerOptions`, never by a second factory.
 *
 * The three member Commands (`change_role`, `remove_member`,
 * `promote_organization_admin`) are recorded against the Organization and take
 * its id; the port reads it off the live account first, which is also what
 * makes an unknown or removed account `404 NOT_FOUND` before anything is
 * written.
 */

export interface CustomerAccountCommandServiceDeps {
  readonly commandBus: Pick<CommandBus, 'run'>;
  readonly emFactory: () => EntityManager;
  readonly twoFactorEnrolments: TwoFactorEnrolmentReader;
  /** `organizations`' roles, for the member Commands and the depletion guard. */
  readonly roles: OrganizationRoleLookup;
  /** `organizations`' answer to "is this a personal Organization?" — the depletion guard's exemption. */
  readonly isPersonal: PersonalOrganizationCheck;
  /** D-178 — `organizations`' co-transactional provisioning seam, for `createStandalone`. */
  readonly personalOrganizations: PersonalOrganizationProvisionApi;
  /** `auth`'s session store: a block and a deletion end the account's sessions. */
  readonly sessions: Pick<AuthSessionPort, 'destroyAllForCustomer'>;
  /** Runs `fn` once the enclosing Command has committed — `EventBus.afterScope`. */
  readonly afterCommit: (fn: () => Promise<void>) => Promise<void>;
  /**
   * `customer_account.anonymized.v1`, announced after the scrub has committed,
   * on the transition only, and awaited — a subscriber's erasure (forms' entries)
   * runs inside the sweep step (`specs/170-forms-module/` research R-17).
   * Absent, nothing is announced.
   */
  readonly announceAnonymized?: (payload: CustomerAccountAnonymizedEventV1) => Promise<void>;
  /** The hasher; the platform's argon2 unless a test supplies one. */
  readonly hash?: (password: string) => Promise<string>;
}

/** The admin bodies' limits, refused as the routes refuse them. */
const blockInputSchema = z.object({ reason: blockCustomerRequestSchema.shape.reason.unwrap().nullable().optional() });
const customerGroupInputSchema = assignCustomerGroupRequestSchema;
const rollupInputSchema = z.object({ enabled: z.boolean() });
const verifiedInputSchema = z.object({ verifiedAt: z.date() });
const roleInputSchema = z.object({ organizationRoleId: z.string().min(1) });
const languageInputSchema = z.object({ language: patchCustomerPreferredLanguageBodySchema.shape.preferredLanguage });

/** Parses a port input; a refusal is `422 VALIDATION_FAILED` with a field error per issue. */
function parseOrRefuse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpError(
    422,
    ERROR_CODES.VALIDATION_FAILED,
    'The customer account write is invalid.',
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), issue: issue.message })),
  );
}

/** The caller's options as the Commands take them; `source` refused first (issue #1922). */
function callerOf(options: AggregateCommandOptions): CallerOptions {
  assertCallerSource(options);
  return { source: options.source, extensions: options.extensions };
}

export class CustomerAccountCommandService implements CustomerAccountCommandPort {
  constructor(private readonly deps: CustomerAccountCommandServiceDeps) {}

  async create(input: CustomerAccountCreateInput, options: AggregateCommandOptions = {}): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const { organizationId, organizationRoleId, ...rest } = input;
    // A brand-new account holds no second factor: the record says so without asking `mfa`.
    const prepared = await prepareCustomerAccountCreate(rest, {
      toRecord: (account) => toCustomerAccountRecord(account, false),
      ...(this.deps.hash ? { hash: this.deps.hash } : {}),
    });
    return this.deps.commandBus.run(withCallerOptions(prepared.command({ organizationId, organizationRoleId }), caller));
  }

  async createStandalone(
    input: CustomerAccountStandaloneCreateInput,
    options: AggregateCommandOptions = {},
  ): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const { password, ...rest } = input;
    const passwordHash = await (this.deps.hash ?? hashPassword)(password);
    const account = await this.#run(
      makeRegisterStandaloneCommand({ personalOrganizations: this.deps.personalOrganizations }, { ...rest, passwordHash }),
      caller,
    );
    // Created inside this call: nobody has enrolled a second factor against it.
    return toCustomerAccountRecord(account, false);
  }

  async updateProfile(
    id: string,
    patch: CustomerAccountProfilePatch,
    options: AggregateCommandOptions = {},
  ): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    return this.#record(await this.#run(makeUpdateCustomerAccountProfileCommand({ customerAccountId: id, patch }), caller));
  }

  async block(
    id: string,
    input: { readonly reason?: string | null },
    options: AggregateCommandOptions = {},
  ): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const { reason } = parseOrRefuse(blockInputSchema, input ?? {});
    return this.#record(
      await this.#run(makeBlockCustomerAccountCommand(this.deps, { customerAccountId: id, reason: reason ?? null }), caller),
    );
  }

  async unblock(id: string, options: AggregateCommandOptions = {}): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    return this.#record(await this.#run(makeUnblockCustomerAccountCommand({ customerAccountId: id }), caller));
  }

  async softDelete(id: string, options: AggregateCommandOptions = {}): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    return this.#record(
      await this.#run(makeSoftDeleteCustomerAccountCommand(this.deps, { customerAccountId: id }), caller),
    );
  }

  async restore(id: string, options: AggregateCommandOptions = {}): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    return this.#record(await this.#run(makeRestoreCustomerAccountCommand({ customerAccountId: id }), caller));
  }

  async setCustomerGroup(
    id: string,
    input: { readonly customerGroupId: string | null },
    options: AggregateCommandOptions = {},
  ): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const { customerGroupId } = parseOrRefuse(customerGroupInputSchema, input);
    return this.#record(await this.#run(makeSetCustomerGroupCommand({ customerAccountId: id, customerGroupId }), caller));
  }

  async setCustomFieldValues(
    id: string,
    merge: CustomFieldMerge,
    options: AggregateCommandOptions = {},
  ): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    // Asked **before** the Command opens its transaction: the answer is another
    // module's, and only shapes the response.
    const enrolled = await this.deps.twoFactorEnrolments([id]);
    const account = await this.#run(makeSetCustomerCustomFieldValuesCommand({ customerAccountId: id, merge }), caller);
    return toCustomerAccountRecord(account, enrolled.has(account.id));
  }

  async setSubtreeRollup(
    id: string,
    input: { readonly enabled: boolean },
    options: AggregateCommandOptions = {},
  ): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const { enabled } = parseOrRefuse(rollupInputSchema, input);
    return this.#record(
      await this.#run(makeSetCustomerAccountSubtreeRollupCommand({ customerAccountId: id, enabled }), caller),
    );
  }

  async promoteToOrganizationAdmin(id: string, options: AggregateCommandOptions = {}): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const member = await this.#member(id);
    await this.#run(
      makePromoteOrganizationAdminCommand(this.#roleDeps(), {
        organizationId: member.organizationId,
        customerAccountId: member.id,
      }),
      caller,
    );
    return this.#reread(member.id);
  }

  async markEmailVerified(
    id: string,
    input: { readonly verifiedAt: Date },
    options: AggregateCommandOptions = {},
  ): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const { verifiedAt } = parseOrRefuse(verifiedInputSchema, input);
    return this.#record(
      await this.#run(makeMarkCustomerAccountEmailVerifiedCommand({ customerAccountId: id, verifiedAt }), caller),
    );
  }

  async changeRole(
    id: string,
    input: { readonly organizationRoleId: string },
    options: AggregateCommandOptions = {},
  ): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const { organizationRoleId } = parseOrRefuse(roleInputSchema, input);
    const member = await this.#member(id);
    await this.#run(
      makeChangeCustomerAccountRoleCommand(this.#roleDeps(), {
        organizationId: member.organizationId,
        customerAccountId: member.id,
        roleId: organizationRoleId,
      }),
      caller,
    );
    return this.#reread(member.id);
  }

  async setPreferredLanguage(
    id: string,
    input: { readonly language: string },
    options: AggregateCommandOptions = {},
  ): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const { language } = parseOrRefuse(languageInputSchema, input);
    const account = await this.#run(
      makeSetCustomerAccountPreferredLanguageCommand({ customerAccountId: id, preferredLanguage: language, source: null }),
      caller,
    );
    // A `null` source never answers `null`: an unknown account is refused.
    return this.#record(account!);
  }

  async removeMember(id: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    const member = await this.#member(id);
    await this.#run(
      makeRemoveMemberCommand(this.#roleDeps(), { organizationId: member.organizationId, customerAccountId: member.id }),
      caller,
    );
  }

  async anonymize(id: string, options: AggregateCommandOptions = {}): Promise<CustomerAccountRecord> {
    const caller = callerOf(options);
    const { account, transitioned } = await this.#run(makeAnonymizeCustomerAccountCommand({ customerAccountId: id }), caller);
    // Committed by now. Ids only — never the e-mail or a name the scrub removed.
    if (transitioned) {
      await this.deps.announceAnonymized?.({
        eventId: randomUUID(),
        occurredAt: account.anonymizedAt!.toISOString(),
        customerAccountId: account.id,
        organizationId: account.organizationId,
      });
    }
    return this.#record(account);
  }

  #run<T>(command: Command<T>, caller: CallerOptions): Promise<T> {
    return this.deps.commandBus.run(withCallerOptions(command, caller));
  }

  #record(account: CustomerAccount): Promise<CustomerAccountRecord> {
    return toOneCustomerAccountRecord(this.deps.twoFactorEnrolments, account);
  }

  #roleDeps(): CustomerAccountRoleCommandDeps {
    return { roles: this.deps.roles, store: entityManagerAccountRoleStore };
  }

  /** The live account a member Command is about, for its Organization; `404 NOT_FOUND` otherwise. */
  async #member(id: string): Promise<CustomerAccount> {
    const account = isUuidShape(id) ? await this.deps.emFactory().findOne(CustomerAccount, { id, deletedAt: null }) : null;
    if (!account) throw memberNotFound();
    return account;
  }

  async #reread(id: string): Promise<CustomerAccountRecord> {
    const account = await this.deps.emFactory().findOneOrFail(CustomerAccount, { id }, { refresh: true });
    return this.#record(account);
  }
}
