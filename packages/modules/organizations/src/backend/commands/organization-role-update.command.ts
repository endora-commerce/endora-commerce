import type { Command } from '@endora-commerce/platform/commands';
import { compareCodes, grantedCodes, mergeSubmittedPermissions } from '../services/organization-role-catalogue.js';
import {
  auditRole,
  eventEnvelope,
  lockCompanyOrganization,
  protectedRole,
  refuseStale,
  refuseTakenName,
  refuseUnknownCodes,
  roleNotFound,
  type OrganizationRoleCommandDeps,
} from '../services/organization-role-rules.js';
import type { OrganizationRoleRow } from '../services/organization-role-store.js';

export interface UpdateOrganizationRoleInput {
  readonly organizationId: string;
  readonly roleId: string;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly description?: string | null;
  readonly permissions?: readonly string[];
}

/**
 * `organization_role.update` (`specs/170-organization-roles/`,
 * `contracts/commands-audit-events.md` §2; data-model §1; research R-17, R-29;
 * FR-003, FR-023, FR-025, FR-065).
 *
 * - *Administrator* is never changed; *Member*'s name and description are not
 *   editable (both `409 ORGANIZATION_ROLE_PROTECTED`, US 6.3).
 * - `expectedVersion` must be the stored version (`409 ORGANIZATION_ROLE_STALE`).
 * - The permissions merge with what the editor could not see
 *   ({@link mergeSubmittedPermissions}): a switched-off module's grant
 *   survives, an undeclared code is dropped, and a *Member* save materialises
 *   the member-defaults offer.
 * - A save whose name, description and granted set equal the stored ones is
 *   `skipAudit`, writes nothing and bumps nothing (FR-065). "Granted" is the set
 *   before presence — for *Member*, its stored grants plus its unoffered
 *   defaults — so saving exactly what a role already holds is a no-op, and
 *   un-ticking a default it held implicitly is a change.
 * - `organization_role.permissions_changed.v1` is emitted on commit when the
 *   granted set changed, with what was added and removed (FR-034's trigger in
 *   `carts`).
 */
export function makeUpdateOrganizationRoleCommand(
  deps: OrganizationRoleCommandDeps,
  input: UpdateOrganizationRoleInput,
): Command<OrganizationRoleRow> {
  let diff: { added: string[]; removed: string[] } = { added: [], removed: [] };
  return {
    action: 'organization_role.update',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const store = deps.store(em);
      await lockCompanyOrganization(store, input.organizationId);
      const role = await store.lock(input.organizationId, input.roleId);
      if (role === null) throw roleNotFound();
      if (role.kind === 'administrator') {
        throw protectedRole('The administrator role holds every permission and cannot be changed.');
      }
      if (role.kind === 'member' && (input.name !== undefined || input.description !== undefined)) {
        throw protectedRole('The member role cannot be renamed or described.');
      }
      refuseStale(role, input.expectedVersion);
      if (input.permissions !== undefined) refuseUnknownCodes(input.permissions, deps.catalogue);

      const before = grantedCodes(role, deps.catalogue);
      const merged =
        input.permissions === undefined
          ? { permissions: before, memberDefaultsOffered: [...role.memberDefaultsOffered].sort(compareCodes) }
          : mergeSubmittedPermissions(role, input.permissions, deps.catalogue);

      const name = role.kind === 'custom' && input.name !== undefined ? input.name.trim() : role.name;
      const nameNormalized =
        role.kind === 'custom' && input.name !== undefined
          ? await refuseTakenName(store, deps, input.organizationId, input.name, role.id)
          : role.nameNormalized;
      const description =
        input.description === undefined ? role.description : input.description?.trim() ? input.description.trim() : null;

      const added = merged.permissions.filter((code) => !before.includes(code));
      const removed = before.filter((code) => !merged.permissions.includes(code));
      // A column read back as `null` may hydrate as `undefined`; compare values.
      const unchanged =
        (name ?? null) === (role.name ?? null) &&
        (description ?? null) === (role.description ?? null) &&
        added.length === 0 &&
        removed.length === 0;
      if (unchanged) return { result: role, skipAudit: true };

      const beforeState = { role: auditRole(role, before) };
      role.name = name;
      role.nameNormalized = nameNormalized;
      role.description = description;
      role.permissions = merged.permissions;
      role.memberDefaultsOffered = merged.memberDefaultsOffered;
      role.version += 1;
      role.updatedAt = new Date();
      await store.save(role);
      diff = { added, removed };
      return { result: role, before: beforeState, after: { role: auditRole(role, role.permissions) } };
    },
    event: (result) =>
      diff.added.length === 0 && diff.removed.length === 0
        ? undefined
        : {
            eventName: 'organization_role.permissions_changed.v1',
            payload: {
              ...eventEnvelope(),
              organizationId: result.organizationId,
              roleId: result.id,
              added: diff.added,
              removed: diff.removed,
            },
          },
  };
}
