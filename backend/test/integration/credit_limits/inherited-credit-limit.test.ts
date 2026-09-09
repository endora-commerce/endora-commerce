import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { EventBus } from '@endora-commerce/platform/events';
import { CreditLimitService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-service.js';
import { CreditLimitReservation } from '../../helpers/package-entities.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { OrganizationInheritanceService } from '../../../../packages/modules/organizations/src/backend/services/organization-inheritance-service.js';
import { CreditLimitReadService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-read.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 056 US3 — credit-limit inheritance + concurrency (T022, money path).
 *
 *  - a descendant with no own limit transacts against the nearest ancestor's
 *    (US3 AS2);
 *  - shared_pool: N concurrent branch draws NEVER exceed the pool (SC-004, zero
 *    double-spend — exercised through the real pessimistic-lock reserve path);
 *  - independent_default: each branch draws its full inherited amount without
 *    affecting siblings;
 *  - a branch with its own limit overrides the inherited one (AS3).
 */

let seq = 0;
async function makeRootOrg(em: EntityManager, name: string): Promise<Organization> {
  seq += 1;
  const org = em.create(Organization, {
    name,
    taxId: `PL056ICL${String(seq).padStart(6, '0')}`,
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

async function seedOrder(em: EntityManager, orgId: string): Promise<string> {
  const order = em.create(Order, {
    organizationId: orgId,
    placedByCustomerAccountId: randomUUID(),
    salesChannelId: randomUUID(),
    status: 'paid',
    paymentStatus: 'paid',
    deliveryAddress: { recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'p', name: 'P', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
    subtotal: '10.00',
    taxTotal: '0.00',
    deliveryTotal: '0.00',
    total: '10.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  return order.id;
}

describe('credit-limit inheritance + concurrency (US3)', () => {
  let h: BackendServerHandle;
  let tree: OrganizationTreeService;
  let svc: CreditLimitService;

  async function setMode(
    orgId: string,
    mode: 'shared_pool' | 'independent_default' | null,
  ): Promise<void> {
    const em = h.em();
    const org = await em.findOneOrFail(Organization, { id: orgId });
    org.creditInheritanceMode = mode;
    await em.flush();
  }

  /**
   * `reserve` requires the caller's transaction since D-94.5, and every
   * reservation now references a real order — `credit_limit_reservations_order_fk`
   * (`on delete restrict`) refuses the `randomUUID()` order ids these cases
   * used to pass. One transaction per call, so the concurrency case below still
   * races five separate pessimistic locks exactly as it did.
   */
  const reserve = (input: {
    organizationId: string;
    orderId: string;
    amount: number;
    currency: string;
  }): ReturnType<CreditLimitService['reserve']> =>
    h.em().transactional((tx) => svc.reserve({ ...input, tx }));

  beforeAll(async () => {
    h = await setupBackendServer();
    tree = new OrganizationTreeService(h.em);
    const inheritance = new OrganizationInheritanceService(
      h.em,
      tree,
      new CreditLimitReadService(h.em),
      async () => 'shared_pool',
    );
    svc = new CreditLimitService(h.em, new EventBus(), undefined, inheritance);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('AS2 — a descendant with no own limit resolves the nearest ancestor row', async () => {
    const em = h.em();
    const head = await makeRootOrg(em, 'ICL Head read');
    const branch = await makeRootOrg(em, 'ICL Branch read');
    await reparent(h, tree, branch.id, head.id);
    await svc.grant({ organizationId: head.id, grantedAmount: 500, currency: 'PLN' });

    const resolved = await svc.getForOrganization(branch.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.organizationId).toBe(head.id);
    expect(Number(resolved!.grantedAmount)).toBe(500);
  });

  it('shared_pool — concurrent branch draws never exceed the pool (SC-004)', async () => {
    const em = h.em();
    const head = await makeRootOrg(em, 'ICL Head shared');
    const branchA = await makeRootOrg(em, 'ICL Branch A shared');
    const branchB = await makeRootOrg(em, 'ICL Branch B shared');
    await reparent(h, tree, branchA.id, head.id);
    await reparent(h, tree, branchB.id, head.id);
    await svc.grant({ organizationId: head.id, grantedAmount: 100, currency: 'PLN' });
    await setMode(head.id, 'shared_pool');

    // 5 concurrent draws of 30 from the two branches → demand 150 > pool 100.
    const drawOrders = await Promise.all(
      [branchA, branchB, branchA, branchB, branchA].map((org) => seedOrder(h.em(), org.id)),
    );
    const draws = [branchA, branchB, branchA, branchB, branchA].map((org, i) =>
      reserve({
        organizationId: org.id,
        orderId: drawOrders[i]!,
        amount: 30,
        currency: 'PLN',
      }),
    );
    const results = await Promise.all(draws);
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    // Exactly floor(100/30) = 3 succeed; the rest fail LIMIT_INSUFFICIENT.
    expect(ok).toHaveLength(3);
    expect(failed.every((r) => !r.ok && r.code === 'LIMIT_INSUFFICIENT')).toBe(true);

    // Zero double-spend: total active reservations against the OWNER (head) row
    // never exceed the granted pool.
    const ownerLimit = await svc.getForOrganization(head.id);
    const reservations = await em.find(CreditLimitReservation, {
      creditLimitId: ownerLimit!.id,
      status: 'active',
    });
    const totalReserved = reservations.reduce((s, r) => s + Number(r.amount), 0);
    expect(totalReserved).toBe(90);
    expect(totalReserved).toBeLessThanOrEqual(100);
    // Every reservation is keyed to the owner (head) row.
    expect(reservations.every((r) => r.creditLimitId === ownerLimit!.id)).toBe(true);
  });

  it('independent_default — each branch draws its full inherited amount independently', async () => {
    const em = h.em();
    const head = await makeRootOrg(em, 'ICL Head indep');
    const branchX = await makeRootOrg(em, 'ICL Branch X indep');
    const branchY = await makeRootOrg(em, 'ICL Branch Y indep');
    await reparent(h, tree, branchX.id, head.id);
    await reparent(h, tree, branchY.id, head.id);
    await svc.grant({ organizationId: head.id, grantedAmount: 100, currency: 'PLN' });
    await setMode(head.id, 'independent_default');

    // Each branch draws 80 of its own inherited 100 → both succeed (independent).
    const orderX1 = await seedOrder(em, branchX.id);
    const orderY1 = await seedOrder(em, branchY.id);
    const rx = await reserve({ organizationId: branchX.id, orderId: orderX1, amount: 80, currency: 'PLN' });
    const ry = await reserve({ organizationId: branchY.id, orderId: orderY1, amount: 80, currency: 'PLN' });
    expect(rx.ok).toBe(true);
    expect(ry.ok).toBe(true);

    // Branch X is now bounded by ITS OWN inherited 100 (80 used → 20 left).
    const orderX2 = await seedOrder(em, branchX.id);
    const rx2 = await reserve({ organizationId: branchX.id, orderId: orderX2, amount: 30, currency: 'PLN' });
    expect(rx2.ok).toBe(false);
    expect(!rx2.ok && rx2.code).toBe('LIMIT_INSUFFICIENT');
  });

  it('AS3 — a branch with its own limit overrides the inherited one', async () => {
    const em = h.em();
    const head = await makeRootOrg(em, 'ICL Head override');
    const child = await makeRootOrg(em, 'ICL Child override');
    await reparent(h, tree, child.id, head.id);
    await svc.grant({ organizationId: head.id, grantedAmount: 1000, currency: 'PLN' });
    await svc.grant({ organizationId: child.id, grantedAmount: 40, currency: 'PLN' });
    await setMode(head.id, 'shared_pool');

    // The child's own 40 limit governs — not the head's 1000.
    const resolved = await svc.getForOrganization(child.id);
    expect(resolved!.organizationId).toBe(child.id);
    expect(Number(resolved!.grantedAmount)).toBe(40);

    const r = await reserve({
      organizationId: child.id,
      orderId: await seedOrder(em, child.id),
      amount: 60,
      currency: 'PLN',
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('LIMIT_INSUFFICIENT');
  });

  it('flat behavior — a root org with its own limit reserves exactly as before', async () => {
    const em = h.em();
    const root = await makeRootOrg(em, 'ICL Flat root');
    await svc.grant({ organizationId: root.id, grantedAmount: 50, currency: 'PLN' });

    const r1 = await reserve({
      organizationId: root.id,
      orderId: await seedOrder(em, root.id),
      amount: 40,
      currency: 'PLN',
    });
    expect(r1.ok).toBe(true);
    const r2 = await reserve({
      organizationId: root.id,
      orderId: await seedOrder(em, root.id),
      amount: 20,
      currency: 'PLN',
    });
    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.code).toBe('LIMIT_INSUFFICIENT');
  });
});
