import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import {
  memberNotFound,
  memberState,
  refuseLosingLastAdministrator,
  roleSnapshot,
  type CustomerAccountRoleCommandDeps,
} from './customer-account-role-rules.js';

export interface RemoveMemberInput {
  readonly organizationId: string;
  readonly customerAccountId: string;
}

/**
 * `customer_account.remove_member` (`specs/170-organization-roles/` WP-02b;
 * `contracts/commands-audit-events.md` §2–§3; research R-29, R-32).
 *
 * Soft-deletes a live member of the Organization (`404 NOT_FOUND` for anyone
 * else). Removing the last active holder of *Administrator* is refused `409
 * CANNOT_REMOVE_LAST_ADMIN`, counted under a lock (R-29). The account keeps its
 * role reference — the foreign key counts removed accounts as holders.
 *
 * Audited against the Organization (R-32): `{ customerAccountId, role }` → `null`.
 */
export function makeRemoveMemberCommand(
  deps: CustomerAccountRoleCommandDeps,
  input: RemoveMemberInput,
): Command<void> {
  return {
    action: 'customer_account.remove_member',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const store = deps.store(em);
      const account = await store.findMember(input.organizationId, input.customerAccountId);
      if (account === null) throw memberNotFound();
      await refuseLosingLastAdministrator(
        deps,
        store,
        account,
        () => new HttpError(409, ERROR_CODES.CANNOT_REMOVE_LAST_ADMIN, 'Cannot remove the only organization admin.'),
      );
      const before = memberState(
        account.id,
        await roleSnapshot(deps.roles, input.organizationId, account.organizationRoleId),
      );
      account.deletedAt = new Date();
      await store.save(account);
      return { result: undefined, before, after: null };
    },
  };
}
