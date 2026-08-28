import { randomUUID } from 'node:crypto';
import { Organization } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { EventBus } from '../../../src/events/bus.js';
import { CreditLimitService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-service.js';
import { CreditLimitReservation } from '../../helpers/package-entities.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { OrganizationInheritanceService } from '../../../../packages/modules/organizations/src/backend/services/organization-inheritance-service.js';
import { CreditLimitReadService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-read.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 075 — `independent_default` sums this module's own record of who drew
 * the credit, not `orders.organization_id`.
 *
 * The sum used to run `join orders o on o.id = r.order_id`, inside the
 * placement transaction and under a `PESSIMISTIC_WRITE` on the owner's credit
 * row, for a value `reserve` is handed by its caller. The second case below is
 * what tells the two apart: re-point the order at another organization and the
 * branch that actually drew the credit must still be bounded by it.
 */
describe('credit-limit reservations record the organization that drew them', () => {
  let h: BackendServerHandle;
  let tree: OrganizationTreeService;
  let svc: CreditLimitService;
  let seq = 0;

  async function makeRootOrg(em: EntityManager, name: string): Promise<Organization> {
    seq += 1;
    const org = em.create(Organization, {
      name,
      taxId: `PL075CLR${String(seq).padStart(6, '0')}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    org.path = `/${org.id}/`;
    await em.flush();
    return org;
  }

  async function reparent(nodeId: string, newParentId: string): Promise<void> {
    await h.em().transactional(async (tx) => {
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

  async function setMode(
    orgId: string,
    mode: 'shared_pool' | 'independent_default' | null,
  ): Promise<void> {
    const em = h.em();
    const org = await em.findOneOrFail(Organization, { id: orgId });
    org.creditInheritanceMode = mode;
    await em.flush();
  }

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

  it('stamps the reserving descendant on the reservation row', async () => {
    const em = h.em();
    const head = await makeRootOrg(em, 'CLR Head stamp');
    const branch = await makeRootOrg(em, 'CLR Branch stamp');
    await reparent(branch.id, head.id);
    await svc.grant({ organizationId: head.id, grantedAmount: 500, currency: 'PLN' });
    await setMode(head.id, 'independent_default');

    const orderId = await seedOrder(em, branch.id);
    const result = await reserve({
      organizationId: branch.id,
      orderId,
      amount: 100,
      currency: 'PLN',
    });
    expect(result.ok).toBe(true);

    const row = await em.findOneOrFail(CreditLimitReservation, { orderId });
    // The owner row belongs to the head; the draw belongs to the branch, and
    // the row says so without anyone having to ask `orders`.
    expect(row.reservingOrganizationId).toBe(branch.id);
    const ownerLimit = await svc.getForOrganization(head.id);
    expect(row.creditLimitId).toBe(ownerLimit!.id);
  });

  it('keeps the branch bounded by its own draw after the order moves organization', async () => {
    const em = h.em();
    const head = await makeRootOrg(em, 'CLR Head move');
    const branchX = await makeRootOrg(em, 'CLR Branch X move');
    const branchY = await makeRootOrg(em, 'CLR Branch Y move');
    await reparent(branchX.id, head.id);
    await reparent(branchY.id, head.id);
    await svc.grant({ organizationId: head.id, grantedAmount: 100, currency: 'PLN' });
    await setMode(head.id, 'independent_default');

    const drawn = await seedOrder(em, branchX.id);
    expect((await reserve({ organizationId: branchX.id, orderId: drawn, amount: 80, currency: 'PLN' })).ok).toBe(true);

    // Re-point the order at the sibling. Raw SQL because `Order` is org-scoped
    // and this test is deliberately writing a value the ambient tenant is not.
    await em.getConnection().execute(`update "orders" set "organization_id" = ? where "id" = ?`, [
      branchY.id,
      drawn,
    ]);

    // Branch X drew the 80 and is still bounded by it: 100 − 80 = 20 available,
    // so 30 is refused. While the sum joined `orders`, the moved row stopped
    // counting against branch X and this draw succeeded.
    const again = await reserve({
      organizationId: branchX.id,
      orderId: await seedOrder(em, branchX.id),
      amount: 30,
      currency: 'PLN',
    });
    expect(again.ok).toBe(false);
    expect(!again.ok && again.code).toBe('LIMIT_INSUFFICIENT');
  });
});
