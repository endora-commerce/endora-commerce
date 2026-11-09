import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';

/** The caller's read-modify-write over an Organization's custom-field bag. */
export type OrganizationCustomFieldMerge = (
  current: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/**
 * The live Organization a write targets, on the Command's transactional `em`:
 * `404 NOT_FOUND` for an id that is not a uuid, an unknown id or a soft-deleted
 * row. Shared by both Commands that write the bag, so they cannot disagree
 * about which rows are writable.
 */
export async function loadLiveOrganization(em: EntityManager, organizationId: string): Promise<Organization> {
  if (!isUuidShape(organizationId)) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
  }
  const org = await em.findOne(Organization, { id: organizationId, deletedAt: null });
  if (!org) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
  }
  return org;
}

/**
 * The one step that writes an Organization's custom-field bag: the caller's
 * `merge` over a **copy** of the current bag, its answer stored on the entity.
 * The copy keeps a merge that mutates its argument from rewriting the
 * before-state the audit row records. `merge` may throw; nothing is assigned
 * then, and the Command's transaction rolls back.
 *
 * Both `organization.set_custom_field_values` and the admin PATCH
 * (`organization.admin_patch`) run their custom-field write through this.
 */
export async function applyCustomFieldMerge(
  org: Organization,
  merge: OrganizationCustomFieldMerge,
): Promise<void> {
  org.customFieldValues = await merge({ ...(org.customFieldValues ?? {}) });
}

/**
 * `organization.set_custom_field_values` — the Command behind
 * `organizationCustomFieldWritePort.setCustomFieldValues` (Principle XIII).
 *
 * The caller's `merge` runs between this Command's load and its write, on the
 * bus's one transaction, so the bag is read, validated (by the caller, inside
 * `merge`) and written atomically, with one audit row carrying the bag before
 * and after. The actor is whatever the ambient tenant context says; a
 * subscriber or worker records a null one.
 */
export function makeSetCustomFieldValuesCommand(input: {
  organizationId: string;
  merge: OrganizationCustomFieldMerge;
}): Command<Organization> {
  return {
    action: 'organization.set_custom_field_values',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const org = await loadLiveOrganization(em, input.organizationId);
      const before = { customFieldValues: { ...(org.customFieldValues ?? {}) } };
      await applyCustomFieldMerge(org, input.merge);
      await em.flush();
      return {
        result: org,
        before,
        after: { customFieldValues: org.customFieldValues },
      };
    },
  };
}
