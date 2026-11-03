import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrganizationRoleKind } from '@endora-commerce/contracts';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import { OrganizationRole } from '../entities/organization-role.entity.js';

/**
 * The persistence the `organization_role.*` Commands run over
 * (`specs/170-organization-roles/` WP-02a).
 *
 * A seam rather than inline `em` calls so the Commands' rules — names, limits,
 * versions, the merge, protection, holders — are unit-tested beside them with
 * an in-memory store, and so this file is the one place that says how a role
 * row is locked. Every method runs on the Command's transactional
 * `EntityManager` (Principle XIII).
 */

/** The mutable shape of a role row. {@link OrganizationRole} satisfies it. */
export interface OrganizationRoleRow {
  id: string;
  organizationId: string;
  kind: OrganizationRoleKind;
  name: string | null;
  nameNormalized: string | null;
  description: string | null;
  permissions: string[];
  memberDefaultsOffered: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOrganizationRole {
  readonly organizationId: string;
  readonly name: string;
  readonly nameNormalized: string;
  readonly description: string | null;
  readonly permissions: string[];
}

export interface OrganizationRoleHolders {
  /** Accounts holding the role, deleted and blocked ones included (the FK does not distinguish). */
  readonly members: number;
  /** Invitations naming the role, in any state (the FK does not distinguish). */
  readonly invitations: number;
}

export interface OrganizationRoleStore {
  /**
   * The Organization, locked for the rest of the Command (`for update`) — which
   * serialises concurrent role creates for one Organization, so the 50-role
   * limit holds — or `null` when it does not exist or the request cannot see it.
   */
  lockOrganization(organizationId: string): Promise<{ readonly isPersonal: boolean } | null>;
  /** The role, locked, if it belongs to `organizationId`; otherwise `null` (FR-005). */
  lock(organizationId: string, roleId: string): Promise<OrganizationRoleRow | null>;
  listInOrganization(organizationId: string): Promise<OrganizationRoleRow[]>;
  create(values: NewOrganizationRole): Promise<OrganizationRoleRow>;
  save(row: OrganizationRoleRow): Promise<void>;
  remove(row: OrganizationRoleRow): Promise<void>;
  holders(organizationId: string, roleId: string): Promise<OrganizationRoleHolders>;
}

/** The store over a Command's `EntityManager`. */
export function entityManagerRoleStore(em: EntityManager): OrganizationRoleStore {
  // command-coverage-ignore: the role writes below run only inside the three
  // `organization_role.*` Commands, on the `em` the bus handed them, and the bus
  // records each Command's one audit entry; this factory is their persistence.
  return {
    async lockOrganization(organizationId) {
      const organization = await em.findOne(
        Organization,
        { id: organizationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      return organization ? { isPersonal: organization.isPersonal } : null;
    },
    async lock(organizationId, roleId) {
      return em.findOne(
        OrganizationRole,
        { id: roleId, organizationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
    },
    async listInOrganization(organizationId) {
      return em.find(OrganizationRole, { organizationId });
    },
    async create(values) {
      const row = em.create(OrganizationRole, { ...values, kind: 'custom' });
      await em.persistAndFlush(row);
      return row;
    },
    async save() {
      await em.flush();
    },
    async remove(row) {
      await em.removeAndFlush(row as OrganizationRole);
    },
    async holders(organizationId, roleId) {
      return {
        // `customer_accounts.organization_role_id` arrives with WP-02b (migration
        // M3); until then no account can hold a role row, so only invitations
        // can. WP-02b replaces this with `customerAccountRoleCommandPort.holdersOf`.
        members: 0,
        invitations: await em.count(OrganizationInvitation, { organizationId, organizationRoleId: roleId }),
      };
    },
  };
}
