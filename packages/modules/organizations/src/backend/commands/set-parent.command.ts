import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
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
      // D-290 / OD-10 — the subtree's tax-ID locks, ascending, before anything
      // reads or rewrites it (the lock order is on the tree service).
      await deps.tree.lockSubtreeTaxIds(em, node);
      await deps.tree.assertMaxDepth(em, node, newParent);
      // `specs/177-tax-id-scope/` FR-020 — the readable refusal; the deferred
      // constraint is the backstop at commit (`runOrganizationWrite`).
      await deps.tree.assertTaxIdsStayInOneTree(em, node, newParent);
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

/**
 * The Command that places an Organization in the tree, as `POST …/:id/parent`
 * and `organizationCommandPort.setParent` both choose it
 * (`specs/186-aggregate-ports/` research R-9, R-16.3): `organization.move` for a
 * new parent of a branch, `organization.set_parent` for a first parent or a
 * detach (`parentId: null`). The choice needs the current row, so this reads
 * it on `em` first and refuses an unknown, malformed or soft-deleted id with
 * `404 NOT_FOUND`; the Command re-reads it inside its own transaction.
 */
export async function makePlaceInTreeCommand(
  em: EntityManager,
  deps: ReparentCommandDeps,
  input: ReparentCommandInput,
): Promise<Command<Organization>> {
  const org = isUuidShape(input.organizationId)
    ? await em.findOne(Organization, { id: input.organizationId, deletedAt: null })
    : null;
  if (!org) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
  const wasChild = (org.parentId ?? null) !== null;
  return wasChild && input.parentId !== null
    ? makeReparentCommand('organization.move', deps, input)
    : makeReparentCommand('organization.set_parent', deps, input);
}
