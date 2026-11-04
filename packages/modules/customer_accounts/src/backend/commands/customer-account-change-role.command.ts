import {
  CUSTOMER_ACCOUNT_ORGANIZATION_ROLE_CHANGED_EVENT,
  ERROR_CODES,
  type CustomerAccountRoleChangeInput,
  type CustomerAccountRoleChangeResult,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import {
  eventEnvelope,
  memberNotFound,
  memberState,
  refuseLosingLastAdministrator,
  roleSnapshot,
  type CustomerAccountRoleCommandDeps,
} from './customer-account-role-rules.js';

/**
 * `customer_account.change_role` (`specs/170-organization-roles/` WP-02b;
 * `contracts/commands-audit-events.md` §2–§3; research R-22, R-23, R-29, R-32;
 * FR-005, FR-065).
 *
 * Moves a member of the Organization to another role **of that Organization**:
 *
 * - an account that is not a member (or, unless `includeRemoved`, a removed
 *   one) and a role the Organization does not have both answer `404 NOT_FOUND`
 *   — another Organization's role is not distinguishable from a missing one
 *   (FR-005, Principle XI);
 * - stepping down from *Administrator* is refused `409 CANNOT_DEMOTE_LAST_ADMIN`
 *   when no other active administrator would remain, counted under a lock
 *   (R-29);
 * - an account already holding the role records nothing and emits nothing.
 *
 * Audited against the Organization (R-32) with `{ customerAccountId, role: { id,
 * name, kind } }` before and after; `customer_account.organization_role_changed.v1`
 * is emitted on commit. It runs on its own or as a child of
 * `organization_role.delete` through `ctx.run` — the same code either way.
 */
export function makeChangeCustomerAccountRoleCommand(
  deps: CustomerAccountRoleCommandDeps,
  input: CustomerAccountRoleChangeInput,
): Command<CustomerAccountRoleChangeResult> {
  return {
    action: 'customer_account.change_role',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const store = deps.store(em);
      const account = await store.findMember(input.organizationId, input.customerAccountId, {
        includeRemoved: input.includeRemoved === true,
      });
      if (account === null) throw memberNotFound();
      const target = await deps.roles.findRole(input.organizationId, input.roleId);
      if (target === null) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization role not found.');
      }
      const fromRoleId = account.organizationRoleId;
      const result: CustomerAccountRoleChangeResult = {
        organizationId: input.organizationId,
        customerAccountId: account.id,
        fromRoleId,
        toRoleId: target.id,
      };
      if (fromRoleId === target.id) return { result, skipAudit: true };

      if (target.kind !== 'administrator') {
        await refuseLosingLastAdministrator(
          deps,
          store,
          account,
          () => new HttpError(409, ERROR_CODES.CANNOT_DEMOTE_LAST_ADMIN, 'Cannot demote the only organization admin.'),
        );
      }
      const before = memberState(account.id, await roleSnapshot(deps.roles, input.organizationId, fromRoleId));
      account.organizationRoleId = target.id;
      await store.save(account);
      return {
        result,
        before,
        after: memberState(account.id, { id: target.id, name: target.name, kind: target.kind }),
      };
    },
    event: (result) =>
      result.fromRoleId === result.toRoleId
        ? undefined
        : {
            eventName: CUSTOMER_ACCOUNT_ORGANIZATION_ROLE_CHANGED_EVENT,
            payload: { ...eventEnvelope(), ...result },
          },
  };
}
