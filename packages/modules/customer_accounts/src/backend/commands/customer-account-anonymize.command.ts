import { LockMode } from '@mikro-orm/core';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CustomerAccount } from '../entities/customer-account.entity.js';

/** The name a scrubbed account's first and last name are replaced with. */
export const ANONYMIZED_CUSTOMER_NAME = 'Deleted customer';

/**
 * The placeholder written over `password_hash`. It is deliberately not a hash
 * of anything: the column is NOT NULL, and nothing may authenticate against a
 * scrubbed account. `passwordSetAt` is cleared beside it (issue #222).
 */
export const ANONYMIZED_PASSWORD_HASH = 'anonymized-no-login';

/**
 * Whether an anonymised account still holds something today's scrub erases
 * (issue #843): a block reason, custom field values a pre-#802 scrub left, or a
 * preferred language a pre-#652 scrub left (D-292). Such an account is
 * unfinished, and the Command below finishes it. The residue branch of the
 * sweep's work list (`customer-account-ports.ts`, `dueForAnonymization`) is the
 * same rule as SQL.
 */
export function hasScrubResidue(account: CustomerAccount): boolean {
  return (
    account.blockReason != null ||
    Object.keys(account.customFieldValues ?? {}).length > 0 ||
    account.preferredLanguage != null
  );
}

/** What the scrub answers: the row, and whether this run was the transition. */
export interface AnonymizeOutcome {
  readonly account: CustomerAccount;
  readonly transitioned: boolean;
}

/**
 * `customer_account.anonymized` (`specs/186-aggregate-ports/` T050, issue
 * #1822) — the retention sweep's last write, which was a hand-audited
 * transaction marked `command-coverage-ignore`. It is a Command now with the
 * same action and state; under the sweep's system scope the entry has no
 * actor, as it had.
 *
 * - The row is locked before `anonymizedAt` is read (issue #857): a second
 *   pass waits, then reads the first's commit and finds nothing to scrub.
 * - The scrub clears the e-mail, both names, the credentials, every custom
 *   field value, the block reason and the preferred language (#802, #843,
 *   #652); the entry records which custom-field keys held a value and whether
 *   a reason was set — none of the erased data.
 * - An account an earlier scrub left residue on is finished: the residue goes,
 *   `anonymizedAt` stays, one more entry is written (`stateBefore.anonymizedAt`
 *   the first scrub's time) and `transitioned` is `false`, so nothing is
 *   announced twice. A fully anonymised account records nothing (`skipAudit`).
 *
 * `customer_account.anonymized.v1` is announced by the caller after the commit
 * and only on the transition (`CustomerAccountCommandService.anonymize`): its
 * subscribers' work runs inside the sweep step, awaited, as it always has.
 */
export function makeAnonymizeCustomerAccountCommand(input: {
  readonly customerAccountId: string;
}): Command<AnonymizeOutcome> {
  return {
    action: 'customer_account.anonymized',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    run: async ({ em }) => {
      if (!isUuidShape(input.customerAccountId)) throw customerNotFound();
      const row = await em.findOne(
        CustomerAccount,
        { id: input.customerAccountId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!row) throw customerNotFound();
      if (row.anonymizedAt) {
        if (!hasScrubResidue(row)) return { result: { account: row, transitioned: false }, skipAudit: true };
        const leftKeys = Object.keys(row.customFieldValues ?? {}).sort();
        const before = {
          anonymizedAt: row.anonymizedAt.toISOString(),
          customFieldKeys: leftKeys,
          hadBlockReason: row.blockReason != null,
        };
        row.blockReason = null;
        row.customFieldValues = {};
        row.preferredLanguage = null;
        await em.flush();
        return {
          result: { account: row, transitioned: false },
          before,
          after: { anonymizedAt: row.anonymizedAt.toISOString() },
        };
      }
      row.email = `deleted+${row.id}@anonymized.invalid`;
      row.firstName = ANONYMIZED_CUSTOMER_NAME;
      row.lastName = ANONYMIZED_CUSTOMER_NAME;
      row.passwordHash = ANONYMIZED_PASSWORD_HASH;
      // Issue #222 — the scrubbed hash is a placeholder, not a credential.
      row.passwordSetAt = null;
      row.twoFactorConfirmedAt = null;
      const customFieldKeys = Object.keys(row.customFieldValues ?? {}).sort();
      row.customFieldValues = {};
      const hadBlockReason = row.blockReason != null;
      row.blockReason = null;
      // Issue #652 (D-292) — the language its owner reads is personal data too.
      row.preferredLanguage = null;
      row.anonymizedAt = new Date();
      await em.flush();
      return {
        result: { account: row, transitioned: true },
        before: { anonymizedAt: null, customFieldKeys, hadBlockReason },
        after: { anonymizedAt: row.anonymizedAt.toISOString() },
      };
    },
  };
}

function customerNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
}
