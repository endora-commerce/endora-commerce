import {
  CUSTOMER_ACCOUNT_ORGANIZATION_ROLE_CHANGED_EVENT,
  type CustomerAccountRoleChangeResult,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import {
  eventEnvelope,
  memberNotFound,
  memberState,
  roleSnapshot,
  type CustomerAccountRoleCommandDeps,
} from './customer-account-role-rules.js';

export interface PromoteOrganizationAdminInput {
  readonly organizationId: string;
  readonly customerAccountId: string;
}

/**
 * `customer_account.promote_organization_admin` — the operator's break-glass
 * promotion (`specs/170-organization-roles/` WP-02b;
 * `contracts/commands-audit-events.md` §2; research R-32).
 *
 * The path an operator reaches *because* an Organization has no administrator
 * left, so it has no last-administrator guard. Assigns the Organization's
 * *Administrator* role; idempotent — an account that
 * already holds it records nothing and emits nothing.
 *
 * Audited against the Organization with `{ customerAccountId, role }` refs;
 * `customer_account.organization_role_changed.v1` is emitted on commit.
 */
export function makePromoteOrganizationAdminCommand(
  deps: CustomerAccountRoleCommandDeps,
  input: PromoteOrganizationAdminInput,
): Command<CustomerAccountRoleChangeResult> {
  return {
    action: 'customer_account.promote_organization_admin',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const store = deps.store(em);
      const account = await store.findMember(input.organizationId, input.customerAccountId);
      if (account === null) throw memberNotFound();
      const administratorRoleId = await deps.roles.predefinedRoleId(input.organizationId, 'administrator');
      const fromRoleId = account.organizationRoleId;
      const result: CustomerAccountRoleChangeResult = {
        organizationId: input.organizationId,
        customerAccountId: account.id,
        fromRoleId,
        toRoleId: administratorRoleId,
      };
      if (fromRoleId === administratorRoleId) {
        return { result, skipAudit: true };
      }
      const before = memberState(account.id, await roleSnapshot(deps.roles, input.organizationId, fromRoleId));
      account.organizationRoleId = administratorRoleId;
      await store.save(account);
      return {
        result,
        before,
        after: memberState(account.id, { id: administratorRoleId, name: null, kind: 'administrator' }),
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
