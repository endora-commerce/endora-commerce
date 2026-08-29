import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';

/**
 * Feature 056 US1 — organization tree invariants (T007).
 *
 * Exercises the OrganizationTreeService directly (the pure tree mechanism the
 * Commands drive): assign/move rewrites descendant + ancestor sets; cycles are
 * rejected on assign and on move; depth > 10 is rejected; a root reports
 * `parentId = null`; and subtree/ancestors resolve without an N+1 walk.
 */

let seq = 0;
function uniqueTaxId(): string {
  seq += 1;
  return `PL056TREE${String(seq).padStart(6, '0')}`;
}

async function makeRootOrg(em: EntityManager, name: string): Promise<Organization> {
  const org = em.create(Organization, {
    name,
    taxId: uniqueTaxId(),
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  });
  await em.persistAndFlush(org);
  // Mirror the migration backfill: a freshly-created org is a root.
  org.path = `/${org.id}/`;
  await em.flush();
  return org;
}

/** Re-parent `nodeId` under `newParentId` (or detach when null) via the service. */
async function reparent(
  h: BackendServerHandle,
  tree: OrganizationTreeService,
  nodeId: string,
  newParentId: string | null,
): Promise<void> {
  const em = h.em();
  await em.transactional(async (tx) => {
    const node = await tx.findOneOrFail(Organization, { id: nodeId });
    const newParent = newParentId
      ? await tx.findOneOrFail(Organization, { id: newParentId })
      : null;
    tree.assertNoCycle(node, newParent);
    await tree.assertMaxDepth(tx, node, newParent);
    await tree.applyReparentPaths(tx, node, newParent);
  });
}

describe('organization tree invariants (US1)', () => {
  let h: BackendServerHandle;
  let tree: OrganizationTreeService;

  beforeAll(async () => {
    h = await setupBackendServer();
    tree = new OrganizationTreeService(h.em);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a freshly created org is a root (parentId null, subtree = {self})', async () => {
    const root = await makeRootOrg(h.em(), 'Head Office 056');
    const fresh = await h.em().findOneOrFail(Organization, { id: root.id });
    expect(fresh.parentId ?? null).toBeNull();
    expect(await tree.subtreeIds(root.id)).toEqual([root.id]);
    expect(await tree.ancestorIds(root.id)).toEqual([]);
  });

  it('assign/move sets descendant and ancestor sets correctly', async () => {
    const head = await makeRootOrg(h.em(), 'HO 056 AS1');
    const branchA = await makeRootOrg(h.em(), 'Branch A 056');
    const branchB = await makeRootOrg(h.em(), 'Branch B 056');
    const sub = await makeRootOrg(h.em(), 'Sub-branch 056');

    await reparent(h, tree, branchA.id, head.id);
    await reparent(h, tree, branchB.id, head.id);
    await reparent(h, tree, sub.id, branchA.id);

    // Descendants of the head office = both branches + the sub-branch.
    const headSubtree = new Set(await tree.subtreeIds(head.id));
    expect(headSubtree).toEqual(new Set([head.id, branchA.id, branchB.id, sub.id]));

    // Descendants of branch A = branch A + its sub-branch (not branch B).
    const branchASubtree = new Set(await tree.descendantIds(branchA.id));
    expect(branchASubtree).toEqual(new Set([sub.id]));

    // Ancestors of the sub-branch, nearest-first: branch A → head office.
    expect(await tree.ancestorIds(sub.id)).toEqual([branchA.id, head.id]);

    // Sub-branch parent is branch A; head office is still a root.
    const subFresh = await h.em().findOneOrFail(Organization, { id: sub.id });
    expect(subFresh.parentId).toBe(branchA.id);
    const headFresh = await h.em().findOneOrFail(Organization, { id: head.id });
    expect(headFresh.parentId ?? null).toBeNull();
  });

  it('rejects a cycle on assign (node under its own descendant)', async () => {
    const root = await makeRootOrg(h.em(), 'HO 056 cycle');
    const child = await makeRootOrg(h.em(), 'Child 056 cycle');
    await reparent(h, tree, child.id, root.id);

    // Attempting to make the root a child of its own descendant is a cycle.
    await expect(reparent(h, tree, root.id, child.id)).rejects.toMatchObject({
      statusCode: 422,
    });
    // Assigning a node to itself is also a cycle.
    await expect(reparent(h, tree, root.id, root.id)).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('rejects a cycle on move (moving an ancestor beneath its descendant)', async () => {
    const a = await makeRootOrg(h.em(), 'A 056 move');
    const b = await makeRootOrg(h.em(), 'B 056 move');
    const c = await makeRootOrg(h.em(), 'C 056 move');
    await reparent(h, tree, b.id, a.id);
    await reparent(h, tree, c.id, b.id);

    // Move A under C — C is inside A's subtree → cycle.
    await expect(reparent(h, tree, a.id, c.id)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects a move that would exceed max depth (10)', async () => {
    // Build a chain of depth 10 (root at depth 0 … leaf at depth 9).
    const chain: Organization[] = [await makeRootOrg(h.em(), 'depth-0')];
    for (let i = 1; i <= 9; i += 1) {
      const node = await makeRootOrg(h.em(), `depth-${i}`);
      await reparent(h, tree, node.id, chain[i - 1]!.id);
      chain.push(node);
    }
    // The chain leaf is at depth 9 (10 segments) — still within bound.
    const extra = await makeRootOrg(h.em(), 'depth-10');
    // Placing `extra` under the depth-9 leaf would make it depth 10 (11
    // segments) → over the ≤10 bound.
    await expect(reparent(h, tree, extra.id, chain[9]!.id)).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('resolves subtree/ancestors for a deep + wide tree in a bounded query count', async () => {
    // Head office with 3 branches, each with 2 sub-branches (deep + wide).
    const head = await makeRootOrg(h.em(), 'HO 056 wide');
    const expected = new Set<string>([head.id]);
    let deepest = head.id;
    for (let b = 0; b < 3; b += 1) {
      const branch = await makeRootOrg(h.em(), `wide-branch-${b}`);
      await reparent(h, tree, branch.id, head.id);
      expected.add(branch.id);
      for (let s = 0; s < 2; s += 1) {
        const sub = await makeRootOrg(h.em(), `wide-sub-${b}-${s}`);
        await reparent(h, tree, sub.id, branch.id);
        expected.add(sub.id);
        deepest = sub.id;
      }
    }

    const em = h.em();
    const conn = em.getConnection();
    // A single indexed prefix query answers the whole subtree (no N+1).
    let queryCount = 0;
    const originalExecute = conn.execute.bind(conn);
    (conn as unknown as { execute: typeof originalExecute }).execute = ((...args: unknown[]) => {
      queryCount += 1;
      return (originalExecute as (...a: unknown[]) => unknown)(...args);
    }) as typeof originalExecute;
    try {
      const treeForConn = new OrganizationTreeService(() => em);
      const subtree = new Set(await treeForConn.subtreeIds(head.id));
      expect(subtree).toEqual(expected);
      const ancestors = await treeForConn.ancestorIds(deepest);
      // deepest sub-branch → its branch → head office (nearest-first, length 2).
      expect(ancestors).toHaveLength(2);
      expect(ancestors[ancestors.length - 1]).toBe(head.id);
      // subtreeIds + ancestorIds together issue a small constant number of
      // queries — never one-per-node (which would be ≫ the node count here).
      expect(queryCount).toBeLessThanOrEqual(3);
    } finally {
      (conn as unknown as { execute: typeof originalExecute }).execute = originalExecute;
    }
  });
});
