import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';
import { organizationDeletedAuditState } from '../services/organization-audit-state.js';
import { hasChildrenRefusal } from '../services/organization-tree-service.js';

/**
 * `organization.delete` (feature 056 FR-010, issue #1338, Principle XIII).
 *
 * Soft-deletes an Organization. Refused `409 has_children` while any live child
 * exists — the database's `parent_id ON DELETE RESTRICT` is the backstop — and
 * `404` for an id no live Organization has. The bus records the one audit
 * entry in the write's transaction: `stateBefore` is names and structure, never
 * the record's values (`specs/conventions/audit-state.md`, D-288, O-2), and
 * `stateAfter` is `null`.
 */
export function makeDeleteOrganizationCommand(input: { organizationId: string }): Command<Organization> {
  return {
    action: 'organization.delete',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      if (!isUuidShape(input.organizationId)) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      const org = await em.findOne(Organization, { id: input.organizationId, deletedAt: null });
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      const childCount = await em.count(Organization, { parentId: org.id, deletedAt: null });
      if (childCount > 0) {
        throw hasChildrenRefusal();
      }
      const before = organizationDeletedAuditState(org);
      org.deletedAt = new Date();
      await em.flush();
      return { result: org, before, after: null };
    },
  };
}
