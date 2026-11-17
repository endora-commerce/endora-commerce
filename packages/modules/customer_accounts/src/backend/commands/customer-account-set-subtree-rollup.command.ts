import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CustomerAccount } from '../entities/customer-account.entity.js';

export interface SetCustomerAccountSubtreeRollupInput {
  readonly customerAccountId: string;
  readonly enabled: boolean;
}

/**
 * `customer_account.set_subtree_rollup` (feature 056 T032, issue #1338).
 *
 * Grants or withdraws a member's customer-side roll-up capability — whether its
 * login sees and acts across its Organization's subtree. An id no live account
 * has answers `404 NOT_FOUND`.
 *
 * The bus records the one audit entry in the write's transaction, against the
 * account: the flag on both sides, never the member's e-mail or names
 * (`specs/conventions/audit-state.md`, D-288).
 */
export function makeSetCustomerAccountSubtreeRollupCommand(
  input: SetCustomerAccountSubtreeRollupInput,
): Command<CustomerAccount> {
  return {
    action: 'customer_account.set_subtree_rollup',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    run: async ({ em }) => {
      const account = isUuidShape(input.customerAccountId)
        ? await em.findOne(CustomerAccount, { id: input.customerAccountId, deletedAt: null })
        : null;
      if (account === null) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
      }
      const before = { subtreeRollupEnabled: account.subtreeRollupEnabled };
      account.subtreeRollupEnabled = input.enabled;
      await em.flush();
      return { result: account, before, after: { subtreeRollupEnabled: input.enabled } };
    },
  };
}
