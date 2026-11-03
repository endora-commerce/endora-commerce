import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { mergeSubmittedPermissions } from '../services/organization-role-catalogue.js';
import {
  MAX_CUSTOM_ROLES_PER_ORGANIZATION,
  auditRole,
  lockCompanyOrganization,
  refuseTakenName,
  refuseUnknownCodes,
  type OrganizationRoleCommandDeps,
} from '../services/organization-role-rules.js';
import type { OrganizationRoleRow } from '../services/organization-role-store.js';

export interface CreateOrganizationRoleInput {
  readonly organizationId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly permissions: readonly string[];
}

/**
 * `organization_role.create` — a custom role (`specs/170-organization-roles/`,
 * `contracts/commands-audit-events.md` §2; FR-002, FR-004, FR-065).
 *
 * The name is trimmed, and refused when another custom role of the
 * Organization or a predefined role's label in a shipped language already has
 * it (case-insensitively, R-29); the 51st custom role is refused; a code no
 * module declares is refused. Of the submitted codes only the **present** ones
 * are stored — the editor cannot show an absent module's code, so it cannot
 * have meant to grant one.
 *
 * Audited against the Organization (R-32) with the role in the after-state; the
 * actor is the bus's, so one Command serves the storefront administrator and
 * the operator. The caller drops the role cache after the bus resolves.
 */
export function makeCreateOrganizationRoleCommand(
  deps: OrganizationRoleCommandDeps,
  input: CreateOrganizationRoleInput,
): Command<OrganizationRoleRow> {
  return {
    action: 'organization_role.create',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const store = deps.store(em);
      await lockCompanyOrganization(store, input.organizationId);
      refuseUnknownCodes(input.permissions, deps.catalogue);

      const name = input.name.trim();
      const nameNormalized = await refuseTakenName(store, deps, input.organizationId, name, null);
      const customCount = (await store.listInOrganization(input.organizationId)).filter(
        (role) => role.kind === 'custom',
      ).length;
      if (customCount >= MAX_CUSTOM_ROLES_PER_ORGANIZATION) {
        throw new HttpError(
          422,
          ERROR_CODES.ORGANIZATION_ROLE_LIMIT_REACHED,
          `An organization can have at most ${MAX_CUSTOM_ROLES_PER_ORGANIZATION} custom roles.`,
        );
      }

      const { permissions } = mergeSubmittedPermissions(
        { kind: 'custom', permissions: [], memberDefaultsOffered: [] },
        input.permissions,
        deps.catalogue,
      );
      const description = input.description?.trim() ? input.description.trim() : null;
      const role = await store.create({
        organizationId: input.organizationId,
        name,
        nameNormalized,
        description,
        permissions,
      });
      return { result: role, before: null, after: { role: auditRole(role, role.permissions) } };
    },
  };
}
