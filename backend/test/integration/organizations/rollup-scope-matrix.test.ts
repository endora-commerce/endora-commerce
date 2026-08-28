import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  runInTenantContext,
  runWithoutTenantContext,
  MissingTenantContextError,
  type TenantContext,
} from '../../../src/tenancy/tenant-context.js';
import { systemTenantContext } from '../../../src/tenancy/resolve-tenant-context.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { SalesRepAssignmentService } from '../../../../packages/modules/organizations/src/backend/services/sales-rep-assignment-service.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { randomUUID } from 'node:crypto';
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 056 US2 — roll-up scope matrix (T015).
 *
 * head-office(roll-up) / branch / cross-subtree actor × orders / quotes /
 * customers. The subtree-aware SalesRepAssignmentService derives an allowed-set;
 * the feature-050 org guard enforces it. A roll-up parent sees exactly its
 * subtree (SC-001, FR-009); a branch sees only itself; a rep without roll-up
 * stays node-only (FR-005); an out-of-subtree record is 404-indistinguishable;
 * a query with no ambient context raises (fail-closed, Principle XI).
 */

let seq = 0;
function withCtx<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    runInTenantContext(ctx, () => {
      fn().then(resolve, reject);
    });
  });
}

const SYS = systemTenantContext('test-seed-056-us2');
function allowedSet(ids: string[]): TenantContext {
  return { mode: 'allowed-set', allowedOrganizationIds: ids, actor: { kind: 'admin', id: 'test' } };
}

async function makeRootOrg(em: EntityManager, name: string): Promise<Organization> {
  seq += 1;
  const org = em.create(Organization, {
    name,
    taxId: `PL056RSM${String(seq).padStart(6, '0')}`,
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

async function seedRecords(
  em: EntityManager,
  orgId: string,
): Promise<{ orderId: string; quoteId: string; customerId: string }> {
  const customer = em.create(CustomerAccount, {
    organizationId: orgId,
    email: `rsm-${randomUUID()}@example.com`,
    passwordHash: 'x',
    firstName: 'Rsm',
    lastName: 'User',
  });
  const order = em.create(Order, {
    organizationId: orgId,
    placedByCustomerAccountId: customer.id,
    salesChannelId: randomUUID(),
    status: 'paid',
    paymentStatus: 'paid',
    deliveryAddress: {
      recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL',
    },
    billingAddress: {
      recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL',
    },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'p', name: 'P', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
    subtotal: '10.00',
    taxTotal: '2.30',
    deliveryTotal: '0.00',
    total: '12.30',
    currency: 'PLN',
    placedAt: new Date(),
  });
  const quote = em.create(QuoteRequest, {
    organizationId: orgId,
    customerAccountId: customer.id,
  });
  await em.persistAndFlush([customer, order, quote]);
  return { orderId: order.id, quoteId: quote.id, customerId: customer.id };
}

async function orgSetOf(
  h: BackendServerHandle,
  ctx: TenantContext,
  trackedOrgIds: Set<string>,
): Promise<{ orders: Set<string>; quotes: Set<string>; customers: Set<string> }> {
  return withCtx(ctx, async () => {
    const em = h.em();
    const orders = await em.find(Order, {});
    const quotes = await em.find(QuoteRequest, {});
    const customers = await em.find(CustomerAccount, {});
    // Restrict to this test's tree orgs (the DB also holds seed rows for other orgs).
    const keep = (id: string): boolean => trackedOrgIds.has(id);
    return {
      orders: new Set(orders.map((o) => o.organizationId).filter(keep)),
      quotes: new Set(quotes.map((q) => q.organizationId).filter(keep)),
      customers: new Set(
        customers
          .map((c) => c.organizationId)
          .filter((id): id is string => typeof id === 'string' && keep(id)),
      ),
    };
  });
}

describe('roll-up scope matrix (US2)', () => {
  let h: BackendServerHandle;
  let tree: OrganizationTreeService;
  const rollup = new Set<string>();
  let svc: SalesRepAssignmentService;

  // Tree A (head roll-up): head → branchA, branchB; branchA → sub.
  // Tree B (branch actor): headB → branchX, branchY; branchX → subX.
  // Tree C (cross): unrelated (root).
  const ids = {
    head: '',
    branchA: '',
    branchB: '',
    sub: '',
    headB: '',
    branchX: '',
    branchY: '',
    subX: '',
    unrelated: '',
  };
  const orderIds: Record<string, string> = {};
  let treeOrgIds: Set<string>;

  const repHead = randomUUID(); // Tree A root, roll-up → sees whole A subtree
  const repBranchX = randomUUID(); // Tree B branchX, roll-up → sees branchX + subX only
  const repCross = randomUUID(); // Tree C unrelated, roll-up → sees only unrelated
  const repFlat = randomUUID(); // Tree A root, NO roll-up → node-only

  beforeAll(async () => {
    h = await setupBackendServer();
    tree = new OrganizationTreeService(h.em);
    svc = new SalesRepAssignmentService(h.em, undefined, {
      treeService: tree,
      hasRollupCapability: async (adminUserId) => rollup.has(adminUserId),
    });

    await withCtx(SYS, async () => {
      const em = h.em();
      for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
        const org = await makeRootOrg(em, `RSM ${key}`);
        ids[key] = org.id;
      }
      treeOrgIds = new Set(Object.values(ids));
    });

    // Tree A.
    await reparent(h, tree, ids.branchA, ids.head);
    await reparent(h, tree, ids.branchB, ids.head);
    await reparent(h, tree, ids.sub, ids.branchA);
    // Tree B.
    await reparent(h, tree, ids.branchX, ids.headB);
    await reparent(h, tree, ids.branchY, ids.headB);
    await reparent(h, tree, ids.subX, ids.branchX);

    await withCtx(SYS, async () => {
      const em = h.em();
      for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
        const rec = await seedRecords(em, ids[key]);
        orderIds[key] = rec.orderId;
      }
      // Assignments (flat table): each rep pinned to one node; no overriding
      // descendant assignment inside Tree A, so the head rep sees all of A.
      em.create(OrganizationSalesRepAssignment, { organizationId: ids.head, adminUserId: repHead });
      em.create(OrganizationSalesRepAssignment, { organizationId: ids.head, adminUserId: repFlat });
      em.create(OrganizationSalesRepAssignment, { organizationId: ids.branchX, adminUserId: repBranchX });
      em.create(OrganizationSalesRepAssignment, { organizationId: ids.unrelated, adminUserId: repCross });
      await em.flush();
    });

    rollup.add(repHead);
    rollup.add(repBranchX);
    rollup.add(repCross);
    // repFlat deliberately without roll-up.
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('head-office roll-up actor sees exactly its subtree across orders/quotes/customers', async () => {
    const allowed = await svc.listAssignedOrganizationIds(repHead);
    expect(new Set(allowed)).toEqual(
      new Set([ids.head, ids.branchA, ids.branchB, ids.sub]),
    );
    const seen = await orgSetOf(h, allowedSet(allowed), treeOrgIds);
    const expected = new Set([ids.head, ids.branchA, ids.branchB, ids.sub]);
    expect(seen.orders).toEqual(expected);
    expect(seen.quotes).toEqual(expected);
    expect(seen.customers).toEqual(expected);
    // FR-009 — never an out-of-subtree org (another tree's node).
    expect(seen.orders.has(ids.unrelated)).toBe(false);
    expect(seen.orders.has(ids.headB)).toBe(false);
  });

  it('a branch actor sees only its own subtree, never a parent or sibling', async () => {
    const allowed = await svc.listAssignedOrganizationIds(repBranchX);
    expect(new Set(allowed)).toEqual(new Set([ids.branchX, ids.subX]));
    const seen = await orgSetOf(h, allowedSet(allowed), treeOrgIds);
    const expected = new Set([ids.branchX, ids.subX]);
    expect(seen.orders).toEqual(expected);
    expect(seen.quotes).toEqual(expected);
    expect(seen.customers).toEqual(expected);
    // Never the parent (headB) or the sibling (branchY).
    expect(seen.orders.has(ids.headB)).toBe(false);
    expect(seen.orders.has(ids.branchY)).toBe(false);
  });

  it('a cross-subtree actor never leaks into an unrelated subtree', async () => {
    const allowed = await svc.listAssignedOrganizationIds(repCross);
    expect(new Set(allowed)).toEqual(new Set([ids.unrelated]));
    const seen = await orgSetOf(h, allowedSet(allowed), treeOrgIds);
    expect(seen.orders).toEqual(new Set([ids.unrelated]));
    expect(seen.orders.has(ids.head)).toBe(false);
  });

  it('an actor without roll-up stays node-only (descendant access denied, FR-005)', async () => {
    const allowed = await svc.listAssignedOrganizationIds(repFlat);
    expect(new Set(allowed)).toEqual(new Set([ids.head]));
    const seen = await orgSetOf(h, allowedSet(allowed), treeOrgIds);
    expect(seen.orders).toEqual(new Set([ids.head]));
    expect(seen.orders.has(ids.branchA)).toBe(false);
    expect(seen.orders.has(ids.sub)).toBe(false);
  });

  it('an out-of-subtree record is 404-indistinguishable from "does not exist"', async () => {
    const allowed = await svc.listAssignedOrganizationIds(repBranchX);
    // `head` lives in a different subtree than branchX → its order must read as
    // null (indistinguishable from "does not exist"), not a leaked row.
    const headOrderId = orderIds['head'] as string;
    const found = await withCtx(allowedSet(allowed), async () =>
      h.em().findOne(Order, { id: headOrderId }),
    );
    expect(found).toBeNull();
  });

  it('a tenant-scoped query with no ambient context raises (fail-closed)', async () => {
    await runWithoutTenantContext(async () => {
      await expect(h.em().find(Order, {})).rejects.toThrow(MissingTenantContextError);
    });
  });
});
