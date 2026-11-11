import { randomUUID } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type CustomerAccountCreatePreparation,
  type CustomerAccountRecord,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { accountCreatedAuditState } from '../services/customer-account-audit-state.js';

/**
 * `customer_account.create` (`specs/176-command-hooks-outbox/` FR-002, FR-004,
 * FR-005; `contracts/registration-command.md`).
 *
 * One implementation of an account's creation, run three ways: by
 * `CustomerAccountMemberWritePort.create` through `commandBus.run` (the admin
 * member create, the invitation accept), and as the **child** of
 * `organizations`' `organization.register` through `ctx.run`, on that
 * registration's transaction — so an Organization never commits without its
 * administrator, nor an administrator without the Organization.
 *
 * The password is hashed by {@link prepareCustomerAccountCreate}, before any
 * transaction opens: argon2 is slow by design, and a registration holding its
 * new Organization row while it hashed would hold a connection and a row lock
 * for it on an anonymous endpoint. The Command only writes.
 *
 * The e-mail is refused `409 EMAIL_ALREADY_REGISTERED` by the pre-check and, for
 * the race the pre-check cannot see, by the unique index at the flush. The
 * action, the object and the audit state are the ones the port's hand-written
 * entry recorded before, so an account's audit history is continuous: the names
 * of the fields it was created with, its role by id and whether its address was
 * confirmed (`specs/conventions/audit-state.md`, D-288).
 */
export interface CustomerAccountCreateDeps {
  /** The published record of the account just written. */
  toRecord(account: CustomerAccount): CustomerAccountRecord;
  /** The hasher; the platform's argon2 unless a test supplies one. */
  hash?: (password: string) => Promise<string>;
}

export interface CustomerAccountCreatePrepared {
  command(target: { organizationId: string; organizationRoleId: string }): Command<CustomerAccountRecord>;
}

/** Hashes the password now and returns the factory of the Command that writes the account. */
export async function prepareCustomerAccountCreate(
  input: CustomerAccountCreatePreparation,
  deps: CustomerAccountCreateDeps,
): Promise<CustomerAccountCreatePrepared> {
  const passwordHash = await (deps.hash ?? hashPassword)(input.password);
  return {
    command: (target) => makeCreateCustomerAccountCommand(deps, { ...input, ...target, passwordHash }),
  };
}

function makeCreateCustomerAccountCommand(
  deps: CustomerAccountCreateDeps,
  input: CustomerAccountCreatePreparation & { organizationId: string; organizationRoleId: string; passwordHash: string },
): Command<CustomerAccountRecord> {
  const customerAccountId = randomUUID();
  return {
    action: 'customer_account.create',
    objectType: 'customer_account',
    objectId: customerAccountId,
    run: async ({ em }) => {
      const email = normalizeEmailAddress(input.email);
      if (await em.findOne(CustomerAccount, { email })) throw emailTaken();
      const account = em.create(CustomerAccount, {
        id: customerAccountId,
        organizationId: input.organizationId,
        email,
        passwordHash: input.passwordHash,
        // Issue #222 — a password somebody supplied, so the account has one on
        // record from its first moment: the holder typed it at registration, or
        // an operator set it on the member surface and hands it over.
        passwordSetAt: new Date(),
        firstName: input.firstName,
        lastName: input.lastName,
        organizationRoleId: input.organizationRoleId,
        // Feature 175 (research R-5) — already validated by the caller through
        // custom_fields' value port; stored as given, never re-validated here.
        customFieldValues: input.customFieldValues ?? {},
        ...(input.emailVerified ? { emailVerifiedAt: new Date() } : {}),
      });
      try {
        await em.persistAndFlush(account);
      } catch (err) {
        // The unique index is the real arbiter; the pre-check above only buys a
        // better message for the common case. Two registrations racing on one
        // address must both answer 409 rather than one answering 500.
        if (err instanceof UniqueConstraintViolationException) throw emailTaken();
        throw err;
      }
      return { result: deps.toRecord(account), before: null, after: accountCreatedAuditState(account) };
    },
  };
}

function emailTaken(): HttpError {
  return new HttpError(409, ERROR_CODES.EMAIL_ALREADY_REGISTERED, 'An account with this email already exists.');
}
