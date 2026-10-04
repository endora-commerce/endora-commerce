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

/**
 * Whether `path` is a materialized path this service may use as an operand, for
 * the organization `id`.
 *
 * Readable means exactly the shape the writers produce: one or more
 * slash-delimited segments, a leading and a trailing slash, the last segment
 * the organization's own id, and no segment that is empty or carries a `LIKE`
 * metacharacter. Everything else is unreadable — the empty string above all,
 * which is the column's default and the prefix of every path.
 *
 * **Every reader below asks this before it uses a path as a prefix**, and that
 * is the point of it being one function. The create hook and the repair
 * migration make an unreadable path something no current writer produces; this
 * is what keeps a row that arrives some other way (raw SQL, a restore, a writer
 * that skips the hook) from reading as the ancestor of the whole table. The
 * rule for a row that fails it is the same everywhere: it has no ancestors, its
 * subtree is itself, and it is not moved.
 */
export function isReadableTreePath(path: string | null | undefined, id: string): boolean {
  if (typeof path !== 'string' || id.length === 0) return false;
  if (!path.startsWith('/') || !path.endsWith(`/${id}/`)) return false;
  const segments = path.slice(1, -1).split('/');
  return segments.every((segment) => segment.length > 0 && !/[%_\\]/.test(segment));
}

/**
 * A move refused because one of the two organizations has a stored path the
 * tree cannot read.
 *
 * 409 rather than the 422 its siblings carry: nothing about the *request* is
 * wrong — the same move is fine once the row is repaired — so it is a conflict
 * with stored state. `organizationId` names which of the two it is, because the
 * operator chose both and only one of them is at fault.
 */
export function unreadablePathRefusal(organizationId: string): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ORGANIZATION_TREE_INVALID,
    `Organization ${organizationId} has a stored tree position that cannot be read, so it cannot be moved or chosen as a parent until that is repaired.`,
    { code: 'path_unreadable', organizationId },
  );
}

interface OwnTreeRow {
  id: string;
  name: string;
  parent_id: string | null;
  status: string;
  path: string;
  deleted_at: Date | string | null;
}

export class OrganizationTreeService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /** The organization's own row, read by primary key. */
  async #ownRow(em: EntityManager, orgId: string): Promise<OwnTreeRow | undefined> {
    const rows = (await em.getConnection().execute(
      `select "id", "name", "parent_id", "status", "path", "deleted_at"
         from "organizations" where "id" = ?`,
      [orgId],
    )) as OwnTreeRow[];
    return rows[0];
  }

  /**
   * The rows of `orgId`'s subtree, pre-order.
   *
   * The organization's own path is read first and **judged** before it becomes
   * a `LIKE` operand. It used to be inlined as a sub-select, which is one
   * statement fewer and has no place to refuse: a row holding `''` matched
   * every organization on the platform. An unreadable path answers the row
   * itself and nothing else — the narrowest set that is still true.
   */
  async #subtreeRows(
    orgId: string,
  ): Promise<Array<Omit<OwnTreeRow, 'deleted_at'>>> {
    const em = this.emFactory();
    const own = await this.#ownRow(em, orgId);
    if (!own) return [];
    if (!isReadableTreePath(own.path, own.id)) {
      // As a root for every reading derived from it: no ancestors, depth 0.
      return own.deleted_at ? [] : [{ ...own, path: `/${own.id}/` }];
    }
    return (await em.getConnection().execute(
      `select "id", "name", "parent_id", "status", "path" from "organizations"
         where "path" like ?
           and "deleted_at" is null
         order by "path"`,
      [`${own.path}%`],
    )) as Array<Omit<OwnTreeRow, 'deleted_at'>>;
  }

  /** Refuses unless every given organization has a readable path. */
  #assertReadable(...organizations: Array<Organization | null>): void {
    for (const organization of organizations) {
      if (organization && !isReadableTreePath(organization.path, organization.id)) {
        throw unreadablePathRefusal(organization.id);
      }
    }
  }

  /**
   * `{orgId} ∪ descendants`, pre-order (by `path`): a primary-key read, then
   * one indexed prefix scan. Empty when the org does not exist; the org alone
   * when its own path is unreadable (see {@link isReadableTreePath}).
   */
  async subtreeIds(orgId: string): Promise<string[]> {
    return (await this.#subtreeRows(orgId)).map((r) => r.id);
  }

  /** Descendants of `orgId` (excludes self), pre-order. */
  async descendantIds(orgId: string): Promise<string[]> {
    const subtree = await this.subtreeIds(orgId);
    return subtree.filter((id) => id !== orgId);
  }

  /** Ancestor ids of `orgId`, nearest-first (parent → … → root). Excludes self. */
  async ancestorIds(orgId: string): Promise<string[]> {
    const own = await this.#ownRow(this.emFactory(), orgId);
    // An unreadable path names no ancestors: a chain read off it would be
    // whatever ids the damage happened to leave behind.
    if (!own || !isReadableTreePath(own.path, own.id)) return [];
    const segs = pathSegments(own.path);
    segs.pop(); // drop self (final segment)
    return segs.reverse(); // nearest-first
  }

  /** Subtree as tree nodes (id, name, parentId, depth, status), pre-order. */
  async subtreeNodes(orgId: string): Promise<OrganizationTreeNode[]> {
    const rows = await this.#subtreeRows(orgId);
    // Depth is relative to nothing here — it is the node's depth in the whole
    // tree, as before — so it is read off each row's own path.
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
   *
   * Both paths have to be readable first, the detach case included: the
   * comparison below is `startsWith`, which an empty `node.path` satisfies for
   * every parent, and the rewrite that follows a passed check is a prefix
   * `UPDATE` over `node.path`. Refusing by name beats answering "cycle" for a
   * move that has none.
   */
  assertNoCycle(node: Organization, newParent: Organization | null): void {
    this.#assertReadable(node, newParent);
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
    this.#assertReadable(node, newParent);
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
    // Guarded here as well as in the two checks, because this is the statement
    // that does the damage: `where "path" like oldPath || '%'` with an empty
    // `oldPath` rewrites every organization in the table, and an empty parent
    // path builds a child path with no leading slash.
    this.#assertReadable(node, newParent);
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
