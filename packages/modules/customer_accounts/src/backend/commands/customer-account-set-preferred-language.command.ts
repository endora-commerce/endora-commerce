import { ERROR_CODES, isUuidShape, type CustomerPreferredLanguageSource } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CustomerAccount } from '../entities/customer-account.entity.js';

export interface SetCustomerAccountPreferredLanguageInput {
  readonly customerAccountId: string;
  /** A tag in the capturing channel's spelling; the caller resolved it. */
  readonly preferredLanguage: string;
  /**
   * `null` is a server-side write through `customerAccountCommandPort`
   * (`specs/186-aggregate-ports/` research R-17.4): it overwrites, as
   * `self_service` does, and records `source: null` — the caller's own code
   * replaces it when the caller names one (`self_service` is one such code).
   */
  readonly source: CustomerPreferredLanguageSource | null;
}

/**
 * `customer_account.set_preferred_language` (issue #652, D-292).
 *
 * Two writers, one Command:
 *
 * - `self_service` — the owner's explicit choice on the storefront account
 *   page, the only write that overwrites a stored value. An id no live account
 *   has answers `404 NOT_FOUND`.
 * - `sign_in` — a sign-in's capture, a **conditional no-op**: it writes only
 *   while the account has no language, and an account that has one (or an id
 *   nobody has) is left alone.
 *
 * - `null` — a server-side caller's write through
 *   `customerAccountCommandPort.setPreferredLanguage`: it overwrites, and an
 *   unknown id answers `404 NOT_FOUND`, as `self_service` does.
 *
 * Either way a write that changes nothing writes no audit entry (`skipAudit`).
 * The entry a change writes names the field and the source and never the tag,
 * which is personal data (`specs/conventions/audit-state.md`, D-288 list 2):
 * `stateBefore: null`, `stateAfter: { changedFields: ['preferredLanguage'], source }`.
 * No history reads the value back, so it is kept nowhere but the account row.
 *
 * The result is the account as written, or `null` when the sign-in capture
 * found nobody.
 */
export function makeSetCustomerAccountPreferredLanguageCommand(
  input: SetCustomerAccountPreferredLanguageInput,
): Command<CustomerAccount | null> {
  return {
    action: 'customer_account.set_preferred_language',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    run: async ({ em }) => {
      const account = isUuidShape(input.customerAccountId)
        ? await em.findOne(CustomerAccount, { id: input.customerAccountId, deletedAt: null })
        : null;
      if (account === null) {
        if (input.source === 'sign_in') return { result: null, skipAudit: true };
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
      }
      const current = account.preferredLanguage ?? null;
      const unchanged =
        input.source === 'sign_in' ? current !== null : current === input.preferredLanguage;
      if (unchanged) return { result: account, skipAudit: true };
      account.preferredLanguage = input.preferredLanguage;
      await em.flush();
      return {
        result: account,
        before: null,
        after: { changedFields: ['preferredLanguage'], source: input.source },
      };
    },
  };
}
