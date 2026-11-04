import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import { OrganizationRole } from '../entities/organization-role.entity.js';

export interface CreateOrganizationInvitationInput {
  readonly organizationId: string;
  readonly invitedByCustomerAccountId: string | null;
  /** Already folded the way the account table folds it. */
  readonly email: string;
  /** A role of `organizationId`; absent, the Organization's *Member* role. */
  readonly roleId?: string | undefined;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface CreatedOrganizationInvitation {
  readonly invitation: OrganizationInvitation;
  readonly role: Pick<OrganizationRole, 'id' | 'kind' | 'name'>;
}

/**
 * `organization_invitation.create` (`specs/170-organization-roles/` WP-03;
 * `contracts/commands-audit-events.md` §2; FR-005, FR-065, R-10, R-32).
 *
 * Creates a pending invitation holding a role of the inviting Organization:
 * the one named, else its *Member* role. A role the Organization does not have
 * — another Organization's included — is `404`, as if it did not exist (FR-005,
 * Principle XI). A second pending
 * invitation for the same address is the partial unique index's `409
 * EMAIL_ALREADY_IN_ORGANIZATION`.
 *
 * Audited against the Organization (R-32) with the invitation, its address and
 * its role in the after-state; the actor is the bus's, so the storefront
 * administrator and the operator are both recorded by the one Command. The
 * caller sends the e-mail after the bus resolves, never for a rolled-back
 * invitation.
 */
export function makeCreateOrganizationInvitationCommand(
  input: CreateOrganizationInvitationInput,
): Command<CreatedOrganizationInvitation> {
  return {
    action: 'organization_invitation.create',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const role = await em.findOne(
        OrganizationRole,
        input.roleId
          ? { id: input.roleId, organizationId: input.organizationId }
          : { organizationId: input.organizationId, kind: 'member' },
      );
      if (!role) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization role not found.');
      }
      const invitation = em.create(OrganizationInvitation, {
        organizationId: input.organizationId,
        invitedByCustomerAccountId: input.invitedByCustomerAccountId,
        email: input.email,
        organizationRoleId: role.id,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      });
      try {
        await em.persistAndFlush(invitation);
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new HttpError(
            409,
            ERROR_CODES.EMAIL_ALREADY_IN_ORGANIZATION,
            'A pending invitation for this email already exists.',
          );
        }
        throw err;
      }
      return {
        result: { invitation, role },
        before: null,
        after: {
          invitationId: invitation.id,
          email: invitation.email,
          role: invitationRoleSnapshot(role),
        },
      };
    },
  };
}

/** The audit snapshot of an invitation's role (R-32): `name` is `null` for a predefined role, whose label is translated. */
export function invitationRoleSnapshot(
  role: Pick<OrganizationRole, 'id' | 'kind' | 'name'>,
): { id: string; kind: OrganizationRole['kind']; name: string | null } {
  return { id: role.id, kind: role.kind, name: role.kind === 'custom' ? (role.name ?? null) : null };
}
