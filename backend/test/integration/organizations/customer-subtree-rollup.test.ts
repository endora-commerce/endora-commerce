import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  runWithoutTenantContext,
  MissingTenantContextError,
} from '../../../src/tenancy/tenant-context.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 056 (T032) — customer-side roll-up.
 *
 * A head-office customer login WITH the `subtreeRollupEnabled` capability sees
 * its organization's whole subtree's org-scoped data (orders + quotes across
 * branches); a branch customer, or a head customer WITHOUT the capability, sees
 * only its own organization. An out-of-subtree record is 404-indistinguishable,
 * and a scoped query with no ambient context raises (fail-closed, Principle XI).
 */

let seq = 0;
async function makeRootOrg(em: EntityManager, name: string): Promise<Organization> {
  seq += 1;
  const org = em.create(Organization, {
    name,
    taxId: `PL056CSR${String(seq).padStart(6, '0')}`,
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

async function seedOrder(em: EntityManager, orgId: string, customerId: string): Promise<string> {
  const order = em.create(Order, {
    organizationId: orgId,
    placedByCustomerAccountId: customerId,
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

async function makeOrgAdmin(
  em: EntityManager,
  orgId: string,
  rollup: boolean,
): Promise<string> {
  const acc = em.create(CustomerAccount, {
    organizationId: orgId,
    email: `csr-${randomUUID()}@example.com`,
    passwordHash: 'x',
    firstName: 'Head',
    lastName: 'Office',
    role: 'organization_admin',
    subtreeRollupEnabled: rollup,
  });
  await em.persistAndFlush(acc);
  return acc.id;
}

describe('customer-side roll-up (T032)', () => {
  let h: BackendServerHandle;
  let tree: OrganizationTreeService;

  const ids = { head: '', branchA: '', unrelated: '' };
  let headCustomer: string;
  let branchCustomer: string;
  const orderIds: Record<string, string> = {};
  const headCookie = 'stub-csr-head';
  const branchCookie = 'stub-csr-branch';

  beforeAll(async () => {
    h = await setupBackendServer();
    tree = new OrganizationTreeService(h.em);
    const em = h.em();

    const head = await makeRootOrg(em, 'CSR Head');
    const branchA = await makeRootOrg(em, 'CSR Branch A');
    const unrelated = await makeRootOrg(em, 'CSR Unrelated');
    Object.assign(ids, { head: head.id, branchA: branchA.id, unrelated: unrelated.id });
    await reparent(h, tree, ids.branchA, ids.head);

    headCustomer = await makeOrgAdmin(em, ids.head, true); // roll-up enabled
    branchCustomer = await makeOrgAdmin(em, ids.branchA, false); // no roll-up

    for (const key of ['head', 'branchA', 'unrelated'] as const) {
      orderIds[key] = await seedOrder(em, ids[key], headCustomer);
      em.create(QuoteRequest, { organizationId: ids[key], customerAccountId: headCustomer });
    }
    await em.flush();

    CUSTOMER_COOKIES[headCookie] = { customerAccountId: headCustomer, organizationId: ids.head };
    CUSTOMER_COOKIES[branchCookie] = { customerAccountId: branchCustomer, organizationId: ids.branchA };
  });

  afterAll(async () => {
    delete CUSTOMER_COOKIES[headCookie];
    delete CUSTOMER_COOKIES[branchCookie];
    await teardownBackendServer(h);
  });

  async function orgSet(cookie: string, url: string): Promise<Set<string>> {
    const res = await h.app.inject({ method: 'GET', url, cookies: { b2b_session: cookie } });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<{ organizationId?: string }> }).data;
    return new Set(
      rows
        .map((r) => r.organizationId)
        .filter((id): id is string => typeof id === 'string' && id in reverseOrg),
    );
  }

  // Map tree org ids so we only assert over this test's orgs (the DB holds seed rows).
  const reverseOrg: Record<string, true> = {};

  it('setup registers the tree org ids for filtering', () => {
    for (const id of Object.values(ids)) reverseOrg[id] = true;
    expect(Object.keys(reverseOrg)).toHaveLength(3);
  });

  it('a head-office customer WITH roll-up sees the whole subtree (orders + quotes)', async () => {
    const orders = await orgSet(headCookie, '/api/v1/orders');
    expect(orders).toEqual(new Set([ids.head, ids.branchA]));
    expect(orders.has(ids.unrelated)).toBe(false);

    const quotes = await orgSet(headCookie, '/api/v1/quote-requests');
    expect(quotes).toEqual(new Set([ids.head, ids.branchA]));
  });

  it('a branch customer WITHOUT roll-up sees only its own organization', async () => {
    const orders = await orgSet(branchCookie, '/api/v1/orders');
    expect(orders).toEqual(new Set([ids.branchA]));
    expect(orders.has(ids.head)).toBe(false);

    const quotes = await orgSet(branchCookie, '/api/v1/quote-requests');
    expect(quotes).toEqual(new Set([ids.branchA]));
  });

  it('disabling the flag collapses the head customer back to its own org (flat)', async () => {
    const em = h.em();
    const acc = await em.findOneOrFail(CustomerAccount, { id: headCustomer });
    acc.subtreeRollupEnabled = false;
    await em.flush();
    try {
      const orders = await orgSet(headCookie, '/api/v1/orders');
      expect(orders).toEqual(new Set([ids.head]));
    } finally {
      acc.subtreeRollupEnabled = true;
      await em.flush();
    }
  });

  it('an out-of-subtree record is 404-indistinguishable for the roll-up customer', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderIds['unrelated']}`,
      cookies: { b2b_session: headCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a tenant-scoped query with no ambient context raises (fail-closed)', async () => {
    await runWithoutTenantContext(async () => {
      await expect(h.em().find(Order, {})).rejects.toThrow(MissingTenantContextError);
    });
  });
});
