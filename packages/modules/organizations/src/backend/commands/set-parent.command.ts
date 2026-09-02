import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';
import type { OrganizationTreeService } from '../services/organization-tree-service.js';

/**
 * Tree re-parent Commands (feature 056 US1, Principle XIII).
 *
 * `organization.set_parent` (first-assign / detach) and `organization.move`
 * (re-parent an existing child) share the same mechanism — cycle + depth
 * checks, then a single-UPDATE subtree path rewrite via the tree service. Both
 * are **reversible**: the audit `stateBefore` captures the node's prior
 * `parent_id` + the moved subtree's prior `path` values, so a mis-move can be
 * undone.
 */

export interface ReparentCommandDeps {
  tree: OrganizationTreeService;
}

export interface ReparentCommandInput {
  organizationId: string;
  /** `null` ⇒ detach `:id` to a root. */
  parentId: string | null;
}

/** Shared factory for the two re-parent actions. */
export function makeReparentCommand(
  action: 'organization.set_parent' | 'organization.move',
  deps: ReparentCommandDeps,
  input: ReparentCommandInput,
): Command<Organization> {
  return {
    action,
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const node = await em.findOne(Organization, {
        id: input.organizationId,
        deletedAt: null,
      });
      if (!node) {
        // 404 is indistinguishable from out-of-scope (Principle XI).
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }

      let newParent: Organization | null = null;
      if (input.parentId !== null) {
        newParent = await em.findOne(Organization, { id: input.parentId, deletedAt: null });
        if (!newParent) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Parent organization not found.');
        }
      }

      const beforeParentId = node.parentId ?? null;
      const beforePath = node.path;

      deps.tree.assertNoCycle(node, newParent);
      await deps.tree.assertMaxDepth(em, node, newParent);
      const { affected } = await deps.tree.applyReparentPaths(em, node, newParent);
      await em.flush();

      return {
        result: node,
        before: {
          parentId: beforeParentId,
          path: beforePath,
          subtreePaths: affected,
        },
        after: {
          parentId: node.parentId ?? null,
          path: node.path,
        },
      };
    },
  };
}

/** `organization.set_parent` — assign a first parent or detach to a root. */
export function makeSetParentCommand(
  deps: ReparentCommandDeps,
  input: ReparentCommandInput,
): Command<Organization> {
  return makeReparentCommand('organization.set_parent', deps, input);
}
