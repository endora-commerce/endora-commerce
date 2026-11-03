import { ERROR_CODES, type DeleteOrganizationRoleResponse } from '@endora-commerce/contracts';
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
 * `contracts/commands-audit-events.md` §2; FR-024, FR-065).
 *
 * The predefined roles are never deleted (`409 ORGANIZATION_ROLE_PROTECTED`).
 * A role nobody holds — no account, no invitation in any state — is deleted
 * outright and needs no replacement. A named replacement must be a different
 * role of the same Organization (`422 ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`
 * for the role itself, `404` for another Organization's).
 *
 * **A held role is refused, with or without a replacement, in this work
 * package.** Deleting it means moving every holder to the replacement in the
 * same transaction — one `customer_account.change_role` child per account
 * through `ctx.run` (research R-22) plus the invitation moves — and the child
 * Command is `customer_accounts`' to publish, which is WP-02b
 * (`specs/170-organization-roles/plan.md`, the note under the Wave 1 table). The
 * gap exists only inside the integration branch.
 *
 * Audited against the Organization with the deleted role's last state.
 */
export function makeDeleteOrganizationRoleCommand(
  deps: Omit<OrganizationRoleCommandDeps, 'reservedNames'>,
  input: DeleteOrganizationRoleInput,
): Command<DeleteOrganizationRoleResult> {
  return {
    action: 'organization_role.delete',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const store = deps.store(em);
      await lockCompanyOrganization(store, input.organizationId);
      const role = await store.lock(input.organizationId, input.roleId);
      if (role === null) throw roleNotFound();
      if (role.kind !== 'custom') throw protectedRole('A predefined role cannot be deleted.');
      refuseStale(role, input.expectedVersion);

      if (input.replacementRoleId !== undefined) {
        if (input.replacementRoleId === role.id) {
          throw replacementRequired('The replacement role must be a different role.');
        }
        if ((await store.lock(input.organizationId, input.replacementRoleId)) === null) throw roleNotFound();
      }

      const holders = await store.holders(input.organizationId, role.id);
      if (holders.members > 0 || holders.invitations > 0) {
        throw replacementRequired(
          'Members or invitations still hold this role. Move them to another role before deleting it.',
        );
      }

      const before = {
        role: auditRole(role, grantedCodes(role, deps.catalogue)),
        memberCount: holders.members,
        invitationCount: holders.invitations,
      };
      await store.remove(role);
      return {
        result: { reassignedMembers: 0, reassignedInvitations: 0 },
        before,
        after: { deletedRoleId: role.id, replacementRoleId: input.replacementRoleId ?? null, reassignedInvitations: [] },
      };
    },
  };
}
