import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { SalesRepAssignmentService } from '../../../../packages/modules/organizations/src/backend/services/sales-rep-assignment-service.js';

/**
 * Feature 056 US2 — sales-rep subtree-implied assignment with per-descendant
 * override (T016, FR-011). A rep assigned to a parent covers the whole subtree
 * EXCEPT any descendant carrying its own assignment (nearest-assignment wins).
 * A rep without the roll-up capability stays node-only (FR-005).
 */

let seq = 0;
async function makeRootOrg(em: EntityManager, name: string): Promise<Organization> {
  seq += 1;
  const org = em.create(Organization, {
    name,
    taxId: `PL056SRO${String(seq).padStart(6, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  });
  await em.persistAndFlush(org);
  org.path = `/${org.id}/`;
  await em.flush();
  return org;
}

async function reparent(
  h: BackendServerHandle,
  tree: OrganizationTreeService,
  nodeId: string,
  newParentId: string,
): Promise<void> {
  const em = h.em();
  await em.transactional(async (tx) => {
    const node = await tx.findOneOrFail(Organization, { id: nodeId });
    const parent = await tx.findOneOrFail(Organization, { id: newParentId });
    tree.assertNoCycle(node, parent);
    await tree.assertMaxDepth(tx, node, parent);
    await tree.applyReparentPaths(tx, node, parent);
  });
}

describe('sales-rep subtree-implied assignment with override (US2)', () => {
  let h: BackendServerHandle;
  let tree: OrganizationTreeService;
  let svc: SalesRepAssignmentService;
  const rollup = new Set<string>();

  const ids = { head: '', branchA: '', branchB: '', sub: '' };
  const repR = randomUUID(); // assigned to head (roll-up)
  const repS = randomUUID(); // assigned to branchA (roll-up) — overrides for branchA subtree
  const repT = randomUUID(); // assigned to head, NO roll-up

  beforeAll(async () => {
    h = await setupBackendServer();
    tree = new OrganizationTreeService(h.em);
    svc = new SalesRepAssignmentService(h.em, undefined, {
      treeService: tree,
      hasRollupCapability: async (adminUserId) => rollup.has(adminUserId),
    });

    const em = h.em();
    const head = await makeRootOrg(em, 'SRO Head');
    const branchA = await makeRootOrg(em, 'SRO Branch A');
    const branchB = await makeRootOrg(em, 'SRO Branch B');
    const sub = await makeRootOrg(em, 'SRO Sub');
    Object.assign(ids, { head: head.id, branchA: branchA.id, branchB: branchB.id, sub: sub.id });

    await reparent(h, tree, ids.branchA, ids.head);
    await reparent(h, tree, ids.branchB, ids.head);
    await reparent(h, tree, ids.sub, ids.branchA);

    const em2 = h.em();
    em2.create(OrganizationSalesRepAssignment, { organizationId: ids.head, adminUserId: repR });
    em2.create(OrganizationSalesRepAssignment, { organizationId: ids.branchA, adminUserId: repS });
    em2.create(OrganizationSalesRepAssignment, { organizationId: ids.head, adminUserId: repT });
    await em2.flush();

    rollup.add(repR);
    rollup.add(repS);
    // repT deliberately without roll-up.
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('parent rep covers the subtree minus a descendant with its own assignment', async () => {
    const rSet = new Set(await svc.listAssignedOrganizationIds(repR));
    // branchA (+ its sub) are governed by repS → excluded from repR.
    expect(rSet).toEqual(new Set([ids.head, ids.branchB]));
  });

  it('the overriding descendant rep governs exactly its own subtree', async () => {
    const sSet = new Set(await svc.listAssignedOrganizationIds(repS));
    expect(sSet).toEqual(new Set([ids.branchA, ids.sub]));
  });

  it('nearest-assignment wins for per-organization visibility (canSeeOrganization)', async () => {
    // repR: sees head + branchB, but not branchA/sub (overridden by repS).
    expect(await svc.canSeeOrganization(repR, ids.head)).toBe(true);
    expect(await svc.canSeeOrganization(repR, ids.branchB)).toBe(true);
    expect(await svc.canSeeOrganization(repR, ids.branchA)).toBe(false);
    expect(await svc.canSeeOrganization(repR, ids.sub)).toBe(false);
    // repS: sees its own subtree, not a sibling/parent.
    expect(await svc.canSeeOrganization(repS, ids.branchA)).toBe(true);
    expect(await svc.canSeeOrganization(repS, ids.sub)).toBe(true);
    expect(await svc.canSeeOrganization(repS, ids.branchB)).toBe(false);
    expect(await svc.canSeeOrganization(repS, ids.head)).toBe(false);
  });

  it('a rep without roll-up stays node-only (descendant access denied, FR-005)', async () => {
    const tSet = new Set(await svc.listAssignedOrganizationIds(repT));
    expect(tSet).toEqual(new Set([ids.head])); // flat — no subtree expansion
    expect(await svc.canSeeOrganization(repT, ids.head)).toBe(true);
    // branchA is assigned to another rep (repS) → a no-roll-up rep is denied it
    // (this is the FR-005 case: crossing into an assigned descendant needs roll-up).
    expect(await svc.canSeeOrganization(repT, ids.branchA)).toBe(false);
    // NB: `sub` carries no own assignment, so the preserved legacy unassigned-org
    // fallback still makes it visible to any rep in a flat deployment. Roll-up is
    // what would instead resolve it via the tree (branchA → repS), excluding repT.
    expect(await svc.canSeeOrganization(repT, ids.sub)).toBe(true);
  });
});
