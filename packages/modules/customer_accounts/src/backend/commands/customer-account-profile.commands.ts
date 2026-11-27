import {
  ERROR_CODES,
  isUuidShape,
  normalizeEmailAddress,
  type CustomerAccountOutbox,
  type CustomerAccountProfilePatch,
  type CustomerAccountRecord,
  type CustomerAccountUpdateHookData,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { changedKeys } from '../services/customer-account-audit-state.js';

/**
 * `customer_account.update_profile` and `customer_account.email_verified`
 * (`specs/186-aggregate-ports/` T050, issue #1822).
 *
 * Both were `CustomerAccountMemberWriteService` methods that recorded their
 * entry by hand on the write's unit of work: atomic, but no command hook saw
 * them and they were not reachable from a worker as one recorded operation.
 * They are Commands now, with the action strings and states they recorded.
 */

function accountNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
}

/**
 * `customer_account.update_profile` — the e-mail is folded, and a changed one
 * clears `emailVerifiedAt`: the new address is unconfirmed, and keeping the
 * old confirmation would let an operator verify an address by editing it.
 * `409 EMAIL_ALREADY_REGISTERED` when another live account holds the address.
 * The entry names the fields that changed, never the values (D-288), and is
 * written even for a patch that changed nothing, as it always was.
 *
 * Hookable, both phases (`specs/193-admin-form-extensions/` FR-110): a hook is
 * handed the after-state through `toRecord`, which the caller builds with
 * what it already knows of the account's second factor — `hookData` cannot
 * await another module.
 */
export function makeUpdateCustomerAccountProfileCommand(input: {
  readonly customerAccountId: string;
  readonly patch: CustomerAccountProfilePatch;
  readonly toRecord: (account: CustomerAccount) => CustomerAccountRecord;
}): Command<CustomerAccount> {
  // Set by `run`, which the bus calls before `hookData` and `outboxData`.
  let changedFields: readonly string[] = [];
  return {
    action: 'customer_account.update_profile',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    hookData: (account): CustomerAccountUpdateHookData => ({
      customerAccount: input.toRecord(account),
      changedFields,
      changedCustomFields: [],
    }),
    outboxData: (account): CustomerAccountOutbox => ({
      customerAccountId: account.id,
      organizationId: account.organizationId ?? null,
      changedFields,
    }),
    run: async ({ em }) => {
      const account = isUuidShape(input.customerAccountId)
        ? await em.findOne(CustomerAccount, { id: input.customerAccountId, deletedAt: null })
        : null;
      if (!account) throw accountNotFound();
      const snapshot = () => ({
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        emailVerifiedAt: account.emailVerifiedAt ?? null,
      });
      const before = snapshot();
      const { patch } = input;
      if (patch.email !== undefined) {
        const nextEmail = normalizeEmailAddress(patch.email);
        if (nextEmail !== account.email) {
          const taken = await em.findOne(CustomerAccount, { email: nextEmail, deletedAt: null });
          if (taken && taken.id !== account.id) {
            throw new HttpError(409, ERROR_CODES.EMAIL_ALREADY_REGISTERED, 'That email is already used by another account.');
          }
          account.email = nextEmail;
          account.emailVerifiedAt = null;
        }
      }
      if (patch.firstName !== undefined) account.firstName = patch.firstName;
      if (patch.lastName !== undefined) account.lastName = patch.lastName;
      await em.flush();
      changedFields = changedKeys(before, snapshot());
      return { result: account, before: null, after: { changedFields } };
    },
  };
}

/**
 * `customer_account.email_verified` — idempotent: a retried verification keeps
 * the first timestamp and records nothing, since an entry per retry would say a
 * change happened that did not. Any account, removed ones included, as before.
 */
export function makeMarkCustomerAccountEmailVerifiedCommand(input: {
  readonly customerAccountId: string;
  readonly verifiedAt: Date;
}): Command<CustomerAccount> {
  return {
    action: 'customer_account.email_verified',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    run: async ({ em }) => {
      const account = isUuidShape(input.customerAccountId)
        ? await em.findOne(CustomerAccount, { id: input.customerAccountId })
        : null;
      if (!account) throw accountNotFound();
      if (account.emailVerifiedAt) return { result: account, skipAudit: true };
      account.emailVerifiedAt = input.verifiedAt;
      await em.flush();
      return {
        result: account,
        before: { emailVerifiedAt: null },
        after: { emailVerifiedAt: input.verifiedAt.toISOString() },
      };
    },
  };
}
