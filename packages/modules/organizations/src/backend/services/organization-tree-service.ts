import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type OrganizationTreeNode } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { Organization, OrganizationStatus } from '../entities/organization.entity.js';

/**
 * OrganizationTreeService (feature 056 US1) — the organizations-owned tree
 * mechanism over the materialized `path` column (`'/<rootId>/…/<thisId>/'`).
 *
 * All traversal is single-query / index-backed (a `text_pattern_ops` prefix
 * scan on `path`), never a per-node walk (FR-012 / SC-002). Mutations
 * (assign/move) go through the Command Bus; this service supplies the pure
 * cycle/depth checks and the single-UPDATE subtree path rewrite the Commands
 * drive (Principle XIII).
 *
 * Flat behavior is preserved byte-for-byte: a root has `parent_id = NULL` and
 * `path = '/<id>/'`, so `subtreeIds(root) = {root}` and `ancestorIds(root) = []`.
 */

/** Maximum number of path segments (tree levels) — depth bound (research §R3). */
export const MAX_TREE_DEPTH_SEGMENTS = 10;

/** Split a materialized path `'/a/b/c/'` into its ordered id segments `[a, b, c]`. */
function pathSegments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/**
 * The three refusals this module's tree rules produce, as pure functions —
 * D-129's remaining sweep, MR 7.
 *
 * Extracted for the reason `admin_roles`' `roleInUseRefusal` was (issue #168):
 * `check:error-translations` verifies that a code has a sentence and can see
 * neither the token the raise writes nor a `{placeholder}` nothing fills, and
 * the envelope's own `hasUnfilledPlaceholder` fall-back then hides the miss
 * behind the written English. Only a test that builds a **real** refusal and
 * renders the bundle's sentence from its `details` sees all three agree, and a
 * refusal it can build without an `EntityManager` is what makes that test a unit
 * test — `test/unit/organizations/error-code-sentences.test.ts`.
 *
 * Every one of them is tokened, which is the whole shape here: the base key
 * `errors.<CODE>` renders for nobody, because `localizeErrorEnvelope` composes
 * `errors.<CODE>.<token>` whenever `details.code` is present and never re-asks.
 * The base sentences are carried anyway, and this module's manifest records
 * D-190's measurement of why.
 */
export function cycleRefusal(): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.ORGANIZATION_TREE_INVALID,
    'Cannot set a parent that would create a cycle (the target is inside this organization\'s own subtree).',
    { code: 'cycle' },
  );
}

/**
 * The depth refusal, carrying the bound it refused against.
 *
 * `maxDepth` and never a second `code`: `details.code` is the refusal token, so
 * a value written there would re-key the sentence lookup instead of filling the
 * sentence. Before MR 7 this raise interpolated the bound into its English
 * message and passed the token alone, so the translated sentence — which
 * replaces the message wholesale — had no way to say how deep is too deep
 * (!1181's finding).
 */
export function maxDepthRefusal(maxDepth: number = MAX_TREE_DEPTH_SEGMENTS): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.ORGANIZATION_TREE_INVALID,
    `Re-parent would exceed the maximum organization tree depth (${maxDepth} levels).`,
    { code: 'max_depth_exceeded', maxDepth },
  );
}

/**
 * Deleting an organization that still has sub-organizations (FR-010), backed by
 * the database's own `parent_id ON DELETE RESTRICT`.
 *
 * It lives beside the two above because it is the same rule read from the other
 * end — a child is an edge of this tree — and because the admin route that
 * raises it already imports this service.
 */
export function hasChildrenRefusal(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ORGANIZATION_HAS_CHILDREN,
    'This organization has sub-organizations. Reassign or remove the children first.',
    { code: 'has_children' },
  );
}

export class OrganizationTreeService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * `{orgId} ∪ descendants`, pre-order (by `path`). One indexed prefix scan.
   * Empty when the org does not exist.
   */
  async subtreeIds(orgId: string): Promise<string[]> {
    const em = this.emFactory();
    const rows = (await em.getConnection().execute(
      `select "id" from "organizations"
         where "path" like (select "path" from "organizations" where "id" = ?) || '%'
           and "deleted_at" is null
         order by "path"`,
      [orgId],
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  /** Descendants of `orgId` (excludes self), pre-order. */
  async descendantIds(orgId: string): Promise<string[]> {
    const subtree = await this.subtreeIds(orgId);
    return subtree.filter((id) => id !== orgId);
  }

  /** Ancestor ids of `orgId`, nearest-first (parent → … → root). Excludes self. */
  async ancestorIds(orgId: string): Promise<string[]> {
    const em = this.emFactory();
    const rows = (await em.getConnection().execute(
      `select "path" from "organizations" where "id" = ?`,
      [orgId],
    )) as Array<{ path: string }>;
    const path = rows[0]?.path;
    if (!path) return [];
    const segs = pathSegments(path);
    segs.pop(); // drop self (final segment)
    return segs.reverse(); // nearest-first
  }

  /** Subtree as tree nodes (id, name, parentId, depth, status), pre-order. */
  async subtreeNodes(orgId: string): Promise<OrganizationTreeNode[]> {
    const em = this.emFactory();
    const rows = (await em.getConnection().execute(
      `select "id", "name", "parent_id", "status", "path" from "organizations"
         where "path" like (select "path" from "organizations" where "id" = ?) || '%'
           and "deleted_at" is null
         order by "path"`,
      [orgId],
    )) as Array<{ id: string; name: string; parent_id: string | null; status: string; path: string }>;
    return rows.map((r) => this.#toNode(r));
  }

  /** Ancestor chain as tree nodes, nearest-first. */
  async ancestorNodes(orgId: string): Promise<OrganizationTreeNode[]> {
    const ids = await this.ancestorIds(orgId);
    if (ids.length === 0) return [];
    const em = this.emFactory();
    const rows = (await em.getConnection().execute(
      `select "id", "name", "parent_id", "status", "path" from "organizations"
         where "id" in (${ids.map(() => '?').join(', ')})`,
      ids,
    )) as Array<{ id: string; name: string; parent_id: string | null; status: string; path: string }>;
    const byId = new Map(rows.map((r) => [r.id, this.#toNode(r)]));
    // Preserve nearest-first order from `ids`.
    return ids.map((id) => byId.get(id)).filter((n): n is OrganizationTreeNode => n !== undefined);
  }

  /**
   * Rejects assigning `node`'s parent to `newParent` when that would create a
   * cycle: `newParent` is `node` itself or lives inside `node`'s own subtree.
   * One path-prefix comparison — no walk (FR-002).
   */
  assertNoCycle(node: Organization, newParent: Organization | null): void {
    if (!newParent) return; // detach → root, never a cycle
    if (newParent.id === node.id || newParent.path.startsWith(node.path)) {
      throw cycleRefusal();
    }
  }

  /**
   * Rejects a re-parent whose resulting deepest subtree node would exceed the
   * depth bound (`MAX_TREE_DEPTH_SEGMENTS` path segments — research §R3).
   */
  async assertMaxDepth(
    em: EntityManager,
    node: Organization,
    newParent: Organization | null,
  ): Promise<void> {
    const rows = (await em.getConnection().execute(
      `select "path" from "organizations" where "path" like ? and "deleted_at" is null`,
      [`${node.path}%`],
      'all',
      em.getTransactionContext(),
    )) as Array<{ path: string }>;
    const nodeSegs = pathSegments(node.path).length;
    const maxSubtreeSegs = rows.reduce(
      (max, r) => Math.max(max, pathSegments(r.path).length),
      nodeSegs,
    );
    const relativeMax = maxSubtreeSegs - nodeSegs; // 0 when node is a leaf
    const newNodeSegs = newParent ? pathSegments(newParent.path).length + 1 : 1;
    const newDeepestSegs = newNodeSegs + relativeMax;
    if (newDeepestSegs > MAX_TREE_DEPTH_SEGMENTS) {
      throw maxDepthRefusal();
    }
  }

  /**
   * Sets `node.parent_id` and rewrites the moved subtree's `path` prefixes in a
   * single UPDATE (`path = :newPath || substring(path from len(oldPath)+1)`).
   * Runs on the transactional `em`. The caller must have already validated the
   * cycle + depth invariants. Returns the affected rows' prior `path` values
   * (for reversible-command capture).
   */
  async applyReparentPaths(
    em: EntityManager,
    node: Organization,
    newParent: Organization | null,
  ): Promise<{ affected: Array<{ id: string; oldPath: string }> }> {
    const oldPath = node.path;
    const newPath = `${newParent ? newParent.path : '/'}${node.id}/`;

    // Capture the moved subtree's prior paths (reversibility, R3).
    const before = (await em.getConnection().execute(
      `select "id", "path" from "organizations" where "path" like ?`,
      [`${oldPath}%`],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string; path: string }>;
    const affected = before.map((r) => ({ id: r.id, oldPath: r.path }));

    if (newPath !== oldPath) {
      // Rewrite every subtree row's path prefix in one statement.
      await em.getConnection().execute(
        `update "organizations"
           set "path" = ? || substring("path" from ?)
         where "path" like ?`,
        [newPath, oldPath.length + 1, `${oldPath}%`],
        'run',
        em.getTransactionContext(),
      );
    }

    // Reflect the change on the managed node entity so the transaction flush
    // persists the new parent_id (+ version bump) consistently with the DB.
    node.parentId = newParent ? newParent.id : null;
    node.path = newPath;

    return { affected };
  }

  #toNode(r: {
    id: string;
    name: string;
    parent_id: string | null;
    status: string;
    path: string;
  }): OrganizationTreeNode {
    return {
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      depth: pathSegments(r.path).length - 1, // root = 0
      status: r.status as OrganizationStatus,
    };
  }
}
