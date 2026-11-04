import {
  ERROR_CODES,
  type CustomerAccountRoleCommandPort,
  type DeleteOrganizationRoleResponse,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { grantedCodes } from '../services/organization-role-catalogue.js';
import {
  auditRole,
  lockCompanyOrganization,
  protectedRole,
  refuseStale,
  roleNotFound,
  type OrganizationRoleCommandDeps,
} from '../services/organization-role-rules.js';
import type { OrganizationRoleRow } from '../services/organization-role-store.js';

export interface DeleteOrganizationRoleInput {
  readonly organizationId: string;
  readonly roleId: string;
  readonly expectedVersion: number;
  readonly replacementRoleId?: string;
}

export type DeleteOrganizationRoleResult = DeleteOrganizationRoleResponse['data'];

function replacementRequired(message: string): HttpError {
  return new HttpError(422, ERROR_CODES.ORGANIZATION_ROLE_REPLACEMENT_REQUIRED, message);
}

/**
 * `organization_role.delete` (`specs/170-organization-roles/`,
 * `contracts/commands-audit-events.md` §2; research R-22; FR-024, FR-065, US 6).
 *
 * The predefined roles are never deleted (`409 ORGANIZATION_ROLE_PROTECTED`).
 * A role nobody holds — no account, no invitation in any state — is deleted
 * outright and needs no replacement. A held role needs one (`422
 * ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`): a different role of the same
 * Organization (`422` for the role itself, `404` for another Organization's).
 *
 * The holders move **inside this Command's transaction**: one
 * `customer_account.change_role` child per account, run through `ctx.run` —
 * `customer_accounts` builds it behind `customerAccountRoleCommandPort`, and
 * each child records its own audit entry — then every invitation naming the
 * role, then the role row itself. Parent and children commit together or not at
 * all; the composite foreign keys (`on delete restrict`) refuse the delete if a
 * holder was missed.
 *
 * Audited against the Organization with the deleted role's last state.
 */
export interface DeleteOrganizationRoleCommandDeps extends Omit<OrganizationRoleCommandDeps, 'reservedNames'> {
  /** `customer_accounts`' role Command port, resolved per call (`lazyPort`). */
  readonly accounts: Pick<CustomerAccountRoleCommandPort, 'changeRole' | 'holdersOf'>;
}

export function makeDeleteOrganizationRoleCommand(
  deps: DeleteOrganizationRoleCommandDeps,
  input: DeleteOrganizationRoleInput,
): Command<DeleteOrganizationRoleResult> {
  return {
    action: 'organization_role.delete',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async (ctx) => {
      const store = deps.store(ctx.em);
      await lockCompanyOrganization(store, input.organizationId);
      const role = await store.lock(input.organizationId, input.roleId);
      if (role === null) throw roleNotFound();
      if (role.kind !== 'custom') throw protectedRole('A predefined role cannot be deleted.');
      refuseStale(role, input.expectedVersion);

      let replacement: OrganizationRoleRow | null = null;
      if (input.replacementRoleId !== undefined) {
        if (input.replacementRoleId === role.id) {
          throw replacementRequired('The replacement role must be a different role.');
        }
        replacement = await store.lock(input.organizationId, input.replacementRoleId);
        if (replacement === null) throw roleNotFound();
      }

      const members = await deps.accounts.holdersOf(input.organizationId, role.id);
      const invitationCount = await store.countInvitations(input.organizationId, role.id);
      const before = {
        role: auditRole(role, grantedCodes(role, deps.catalogue)),
        memberCount: members.length,
        invitationCount,
      };
      if (replacement === null) {
        if (members.length > 0 || invitationCount > 0) {
          throw replacementRequired(
            'Members or invitations still hold this role. Choose the role they move to before deleting it.',
          );
        }
        await store.remove(role);
        return {
          result: { reassignedMembers: 0, reassignedInvitations: 0 },
          before,
          after: { deletedRoleId: role.id, replacementRoleId: null, reassignedInvitations: [] },
        };
      }

      if (members.length > 0 && !ctx.run) {
        throw new Error('organization_role.delete moves holders through child Commands; run it on the Command Bus.');
      }
      for (const customerAccountId of members) {
        await ctx.run!(
          deps.accounts.changeRole({
            organizationId: input.organizationId,
            customerAccountId,
            roleId: replacement.id,
            includeRemoved: true,
          }),
        );
      }
      const reassignedInvitations = await store.moveInvitations(input.organizationId, role.id, replacement);
      await store.remove(role);
      return {
        result: { reassignedMembers: members.length, reassignedInvitations: reassignedInvitations.length },
        before,
        after: { deletedRoleId: role.id, replacementRoleId: replacement.id, reassignedInvitations },
      };
    },
  };
}
