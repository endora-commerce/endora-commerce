import type { EntityManager } from '@mikro-orm/postgresql';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import { OrganizationRole } from '../entities/organization-role.entity.js';
import { Organization } from '../entities/organization.entity.js';

/**
 * What the host's `structure` phase still has to do for a pair
 * (`specs/192-organization-merge/` FR-041, FR-042; data-model §2.2): the
 * reads behind the preview's host counts and behind each structure batch. Each
 * count consumes loser-side state as the batch works through it (R-3), so it
 * reaches zero and a re-run finds nothing.
 */

/** Table of the Organization's sales-channel bridge (this module's own). */
export const ORGANIZATION_CHANNEL_TABLE = 'sales_channel_organizations';

/** The loser's custom roles the survivor has no role of the same name for — the ones the map copies. */
export async function customRolesToCopy(em: EntityManager, survivorId: string, loserId: string): Promise<OrganizationRole[]> {
  const [loserRoles, survivorRoles] = await Promise.all([
    em.find(OrganizationRole, { organizationId: loserId, kind: 'custom' }),
    em.find(OrganizationRole, { organizationId: survivorId, kind: 'custom' }),
  ]);
  const taken = new Set(survivorRoles.map((role) => role.nameNormalized));
  return loserRoles.filter((role) => !taken.has(role.nameNormalized));
}

/**
 * The loser's role id → the survivor's (FR-041): predefined to predefined,
 * custom by normalised name. A custom role the survivor lacks maps to the
 * copy `copies` names (created by the caller).
 */
export async function buildRoleMap(
  em: EntityManager,
  survivorId: string,
  loserId: string,
  copies: ReadonlyMap<string, string>,
): Promise<Record<string, string>> {
  const [loserRoles, survivorRoles] = await Promise.all([
    em.find(OrganizationRole, { organizationId: loserId }),
    em.find(OrganizationRole, { organizationId: survivorId }),
  ]);
  const map: Record<string, string> = {};
  for (const role of loserRoles) {
    const target =
      role.kind === 'custom'
        ? (survivorRoles.find((candidate) => candidate.kind === 'custom' && candidate.nameNormalized === role.nameNormalized)?.id ??
          copies.get(role.id))
        : survivorRoles.find((candidate) => candidate.kind === role.kind)?.id;
    if (target !== undefined) map[role.id] = target;
  }
  return map;
}

/** Pending invitations of the loser: not consumed, not revoked. */
export function pendingInvitationsOf(em: EntityManager, loserId: string, limit?: number): Promise<OrganizationInvitation[]> {
  return em.find(
    OrganizationInvitation,
    { organizationId: loserId, consumedAt: null, revokedAt: null },
    { orderBy: { id: 'asc' }, ...(limit !== undefined ? { limit } : {}) },
  );
}

/** The loser's live children, which move under the survivor one tree move each. */
export function childrenOf(em: EntityManager, loserId: string, limit?: number): Promise<Organization[]> {
  return em.find(
    Organization,
    { parentId: loserId, deletedAt: null },
    { orderBy: { id: 'asc' }, ...(limit !== undefined ? { limit } : {}) },
  );
}

/** Sales-representative assignments of the loser (unioned into the survivor's). */
export async function salesRepAssignmentsOf(em: EntityManager, loserId: string): Promise<number> {
  const rows = await em.execute<{ count: string }[]>(
    `select count(*)::text as "count" from "organization_sales_rep_assignments" where "organization_id" = ?`,
    [loserId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** The loser's sales channels the survivor is not a member of (FR-042 union). */
export async function channelsToAdd(em: EntityManager, survivorId: string, loserId: string): Promise<string[]> {
  const rows = await em.execute<{ sales_channel_id: string }[]>(
    `select l."sales_channel_id" from "${ORGANIZATION_CHANNEL_TABLE}" l where l."organization_id" = ? ` +
      `and not exists (select 1 from "${ORGANIZATION_CHANNEL_TABLE}" s where s."organization_id" = ? ` +
      `and s."sales_channel_id" = l."sales_channel_id") order by l."sales_channel_id"`,
    [loserId, survivorId],
  );
  return rows.map((row) => row.sales_channel_id);
}

/** Every host-side count the preview shows, keyed `Entity.property`. */
export async function structureCounts(
  em: EntityManager,
  survivorId: string,
  loserId: string,
): Promise<Record<string, number>> {
  const [roles, invitations, reps, channels, children] = await Promise.all([
    customRolesToCopy(em, survivorId, loserId),
    pendingInvitationsOf(em, loserId),
    salesRepAssignmentsOf(em, loserId),
    channelsToAdd(em, survivorId, loserId),
    childrenOf(em, loserId),
  ]);
  return {
    'OrganizationRole.organizationId': roles.length,
    'OrganizationInvitation.organizationId': invitations.length,
    'OrganizationSalesRepAssignment.organizationId': reps,
    'SalesChannelMembership.organization': channels.length,
    'Organization.parentId': children.length,
  };
}

