import { ERROR_CODES, type CustomerAccountReadPort } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import { OrganizationRole } from '../entities/organization-role.entity.js';
import { predefinedRoleIdOn } from '../services/organization-role-store.js';
import { invitationRoleSnapshot } from './organization-invitation-create.command.js';

export interface RevokeOrganizationInvitationInput {
  readonly organizationId: string;
  readonly invitationId: string;
}

export interface RevokeOrganizationInvitationDeps {
  /** The count of the Organization's active administrators — `customer_accounts`' answer. */
  readonly accounts: Pick<CustomerAccountReadPort, 'countAdministrators'>;
}

/**
 * `organization_invitation.revoke` (`specs/170-organization-roles/` WP-03;
 * `contracts/commands-audit-events.md` §2 — "as today, moved onto the bus";
 * R-10, R-32).
 *
 * Revokes an invitation **of the Organization** (`404` for anybody else's: the
 * lookup is scoped, so another Organization's invitation is not
 * distinguishable from a missing one). An invitation already accepted or
 * revoked answers as today — nothing changes and nothing is recorded. An
 * expired one may still be revoked (research R-37, unchanged).
 *
 * The last-administrator invitation rule keeps its code: while the
 * Organization has no active, unblocked administrator, its only pending
 * (unexpired, FR-010a) invitation to the *Administrator* role cannot be revoked (`409
 * CANNOT_REVOKE_LAST_ADMIN_INVITE`). Administrator is the role, not the legacy
 * enum, since this package (`contracts/organization-permission-port.md` §3).
 *
 * Audited against the Organization with the invitation's address and role in
 * the before-state.
 */
export function makeRevokeOrganizationInvitationCommand(
  deps: RevokeOrganizationInvitationDeps,
  input: RevokeOrganizationInvitationInput,
): Command<void> {
  return {
    action: 'organization_invitation.revoke',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const invitation = await em.findOne(OrganizationInvitation, {
        id: input.invitationId,
        organizationId: input.organizationId,
      });
      if (!invitation) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invitation not found.');
      }
      if (invitation.consumedAt || invitation.revokedAt) return { result: undefined, skipAudit: true };

      const administratorRoleId = await predefinedRoleIdOn(em, input.organizationId, 'administrator');
      if (invitation.organizationRoleId === administratorRoleId) {
        // A blocked administrator is not an active one (owner ruling).
        const administrators = await deps.accounts.countAdministrators(input.organizationId, {
          activeOnly: true,
          notBlocked: true,
        });
        if (administrators === 0) {
          const otherPending = await em.count(OrganizationInvitation, {
            organizationId: input.organizationId,
            organizationRoleId: administratorRoleId,
            consumedAt: null,
            revokedAt: null,
            // An expired invitation is not pending (FR-010a), so it is no way back in.
            expiresAt: { $gt: new Date() },
            id: { $ne: invitation.id },
          });
          if (otherPending === 0) {
            throw new HttpError(
              409,
              ERROR_CODES.CANNOT_REVOKE_LAST_ADMIN_INVITE,
              'Cannot revoke the only pending administrator invitation while the organization has no active administrator.',
            );
          }
        }
      }

      const role = await em.findOne(OrganizationRole, {
        id: invitation.organizationRoleId,
        organizationId: input.organizationId,
      });
      const before = {
        invitationId: invitation.id,
        email: invitation.email,
        role: role ? invitationRoleSnapshot(role) : { id: invitation.organizationRoleId, kind: null, name: null },
      };
      invitation.revokedAt = new Date();
      await em.flush();
      return { result: undefined, before, after: null };
    },
  };
}
