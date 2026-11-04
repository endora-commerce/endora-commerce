import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { predefinedRoleIdOf, seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';
import { CustomerAccount, Order, OrderItem, Organization } from '../../helpers/package-entities.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { seedInvoiceableOrder, setSellerSettings } from '../invoices/helpers.js';

/**
 * `specs/170-organization-roles/` WP-07 (FR-049, OR-5; US 2.5) — a colleague's
 * order, and every action reading one as its source, is reachable only with
 * `orders.view_organization`. *Administrator* holds it implicitly; *Member*
 * does not hold it by default. Without it the order answers `404`, never `403`
 * (Principle XI's existence rule), exactly as a foreign Organization's order.
 *
 * With it the reach is the administrator's of today: the member's own
 * Organization, and its subtree for a roll-up login — the tenant filter draws
 * that line; the permission only stops pinning the read to the placer.
 *
 * Organizations and accounts are this file's own, so changing a role here
 * cannot move another file's fixtures:
 *
 *   ORG (flat):    placer (Member), plain (Member), viewer (custom role holding
 *                  `orders.view_organization`), admin (Administrator);
 *   HEAD → BRANCH: headViewer (custom role holding the code, roll-up on) and
 *                  headPlain (Member, roll-up on) in HEAD; branchPlacer in BRANCH.
 */

const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };

let seq = 0;
async function makeRootOrg(em: EntityManager, name: string): Promise<Organization> {
  seq += 1;
  const org = em.create(Organization, {
    name,
    taxId: `PL170WP7${String(seq).padStart(6, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  });
  await em.persistAndFlush(org);
  await bindOrganizationsToFixtureChannelsSql(em, [org.id]);
  org.path = `/${org.id}/`;
  await em.flush();
  return org;
}

async function makeAccount(
  em: EntityManager,
  organizationId: string,
  options: { role?: 'administrator' | 'member'; rollup?: boolean } = {},
): Promise<string> {
  const account = em.create(CustomerAccount, {
    organizationId,
    email: `wp07-${randomUUID()}@example.com`,
    passwordHash: 'x',
    firstName: 'WP07',
    lastName: 'Buyer',
    organizationRoleId: await predefinedRoleIdOf(em, organizationId, options.role ?? 'member'),
    subtreeRollupEnabled: options.rollup ?? false,
    emailVerifiedAt: new Date(),
  });
  await em.persistAndFlush(account);
  return account.id;
}

async function seedOrderWithLine(
  em: EntityManager,
  organizationId: string,
  placedByCustomerAccountId: string,
  salesChannelId: string,
): Promise<string> {
  const order = em.create(Order, {
    organizationId,
    placedByCustomerAccountId,
    salesChannelId,
    status: 'completed',
    deliveryAddress: { recipientName: 'W', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'W', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
    subtotal: '20.00',
    taxTotal: '0.00',
    deliveryTotal: '0.00',
    total: '20.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  await em.persistAndFlush(
    em.create(OrderItem, {
      orderId: order.id,
      productId: SEED_PRODUCT_101_ID,
      productSnapshot: { sku: 'P101', name: 'Product 101', primaryAssetUrl: null },
      quantity: 2,
      unitPrice: '10.00',
      taxRate: '0.0000',
      lineTotal: '20.00',
    }),
  );
  return order.id;
}

describe('170 WP-07 — colleagues’ orders need orders.view_organization (FR-049)', () => {
  let h: BackendServerHandle;
  const ids = { org: '', head: '', branch: '' };
  const accounts = { placer: '', plain: '', viewer: '', admin: '', headViewer: '', headPlain: '', branchPlacer: '' };
  const orders = { colleague: '', branch: '', invoiced: '' };
  let invoiceId = '';
  const cookie = (key: keyof typeof accounts) => ({ b2b_session: `stub-wp07-${key}` });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await systemDefaultSalesChannelId(em);

    const org = await makeRootOrg(em, 'WP07 Flat');
    const head = await makeRootOrg(em, 'WP07 Head');
    const branch = await makeRootOrg(em, 'WP07 Branch');
    Object.assign(ids, { org: org.id, head: head.id, branch: branch.id });
    const tree = new OrganizationTreeService(h.em);
    await em.transactional(async (tx) => {
      const node = await tx.findOneOrFail(Organization, { id: ids.branch });
      const parent = await tx.findOneOrFail(Organization, { id: ids.head });
      tree.assertNoCycle(node, parent);
      await tree.assertMaxDepth(tx, node, parent);
      await tree.applyReparentPaths(tx, node, parent);
    });

    accounts.placer = await makeAccount(em, ids.org);
    accounts.plain = await makeAccount(em, ids.org);
    accounts.viewer = await makeAccount(em, ids.org);
    accounts.admin = await makeAccount(em, ids.org, { role: 'administrator' });
    accounts.headViewer = await makeAccount(em, ids.head, { rollup: true });
    accounts.headPlain = await makeAccount(em, ids.head, { rollup: true });
    accounts.branchPlacer = await makeAccount(em, ids.branch);

    // The custom roles hold the one code under test and nothing else — save
    // the flat viewer's two action codes: since WP-16 the reorder needs
    // `carts.create` and the clone `quote_requests.create`, judged before the
    // order scope this file is about (`order-actions-permissions.test.ts`).
    await seedMemberWithPermissions(em, {
      organizationId: ids.org,
      customerAccountId: accounts.viewer,
      permissions: ['orders.view_organization', 'carts.create', 'quote_requests.create'],
    });
    await seedMemberWithPermissions(em, {
      organizationId: ids.head,
      customerAccountId: accounts.headViewer,
      permissions: ['orders.view_organization'],
    });

    orders.colleague = await seedOrderWithLine(em, ids.org, accounts.placer, channel);
    orders.branch = await seedOrderWithLine(em, ids.branch, accounts.branchPlacer, channel);
    ({ orderId: orders.invoiced } = await seedInvoiceableOrder(em, {
      salesChannelId: channel,
      organizationId: ids.org,
      placedByCustomerAccountId: accounts.placer,
    }));
    await setSellerSettings(h);
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orders.invoiced}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode, issued.body).toBeLessThan(300);
    invoiceId = (issued.json() as { data: { id: string } }).data.id;

    for (const key of Object.keys(accounts) as Array<keyof typeof accounts>) {
      const organizationId = key.startsWith('head') ? ids.head : key.startsWith('branch') ? ids.branch : ids.org;
      CUSTOMER_COOKIES[`stub-wp07-${key}`] = { customerAccountId: accounts[key], organizationId };
    }
  }, 90_000);

  afterAll(async () => {
    for (const key of Object.keys(accounts)) delete CUSTOMER_COOKIES[`stub-wp07-${key}`];
    await teardownBackendServer(h);
  });

  async function listedIds(key: keyof typeof accounts): Promise<Set<string>> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/orders', cookies: cookie(key) });
    expect(res.statusCode, res.body).toBe(200);
    const rows = (res.json() as { data: Array<{ id: string }> }).data;
    const ours = new Set<string>(Object.values(orders));
    return new Set(rows.map((r) => r.id).filter((id) => ours.has(id)));
  }

  async function as(key: keyof typeof accounts, method: 'GET' | 'POST', url: string) {
    return h.app.inject({ method, url, cookies: cookie(key) });
  }

  const code = (res: { json: () => unknown }) => (res.json() as { error?: { code?: string } }).error?.code;

  describe('a member without orders.view_organization', () => {
    it('lists only the orders they placed', async () => {
      expect(await listedIds('plain')).toEqual(new Set());
      expect(await listedIds('placer')).toEqual(new Set([orders.colleague, orders.invoiced]));
    });

    it('gets 404 on a colleague’s order', async () => {
      const res = await as('plain', 'GET', `/api/v1/orders/${orders.colleague}`);
      expect(res.statusCode, res.body).toBe(404);
    });

    it('gets 404 ORDER_NOT_FOUND reordering it', async () => {
      const res = await as('plain', 'POST', `/api/v1/orders/${orders.colleague}/reorder`);
      expect(res.statusCode, res.body).toBe(404);
      expect(code(res)).toBe(ERROR_CODES.ORDER_NOT_FOUND);
    });

    it('gets 404 ORDER_NOT_FOUND cloning it to a quote request', async () => {
      const res = await as('plain', 'POST', `/api/v1/orders/${orders.colleague}/clone-to-quote`);
      expect(res.statusCode, res.body).toBe(404);
      expect(code(res)).toBe(ERROR_CODES.ORDER_NOT_FOUND);
    });

    it('gets 404 starting a return from it', async () => {
      const res = await as('plain', 'GET', `/api/v1/orders/${orders.colleague}/returnable`);
      expect(res.statusCode, res.body).toBe(404);
    });

    it('gets 404 on its invoices and an invoice PDF', async () => {
      expect((await as('plain', 'GET', `/api/v1/orders/${orders.invoiced}/invoices`)).statusCode).toBe(404);
      expect(
        (await as('plain', 'GET', `/api/v1/orders/${orders.invoiced}/invoices/${invoiceId}/pdf`)).statusCode,
      ).toBe(404);
    });

    it('with roll-up on, still sees nothing of the subtree: roll-up never adds a permission', async () => {
      expect(await listedIds('headPlain')).toEqual(new Set());
      expect((await as('headPlain', 'GET', `/api/v1/orders/${orders.branch}`)).statusCode).toBe(404);
    });
  });

  for (const holder of ['viewer', 'admin'] as const) {
    describe(`${holder === 'viewer' ? 'a member holding orders.view_organization' : 'the Administrator'}`, () => {
      it('lists the Organization’s orders', async () => {
        expect(await listedIds(holder)).toEqual(new Set([orders.colleague, orders.invoiced]));
      });

      it('reads a colleague’s order', async () => {
        const res = await as(holder, 'GET', `/api/v1/orders/${orders.colleague}`);
        expect(res.statusCode, res.body).toBe(200);
      });

      it('reorders it', async () => {
        const res = await as(holder, 'POST', `/api/v1/orders/${orders.colleague}/reorder`);
        expect(res.statusCode, res.body).toBe(200);
      });

      it('clones it to a quote request of their own', async () => {
        const res = await as(holder, 'POST', `/api/v1/orders/${orders.colleague}/clone-to-quote`);
        expect(res.statusCode, res.body).toBe(200);
      });

      it('reads its invoices and an invoice PDF', async () => {
        const list = await as(holder, 'GET', `/api/v1/orders/${orders.invoiced}/invoices`);
        expect(list.statusCode, list.body).toBe(200);
        expect((list.json() as { data: Array<{ id: string }> }).data.map((i) => i.id)).toContain(invoiceId);
        const pdf = await as(holder, 'GET', `/api/v1/orders/${orders.invoiced}/invoices/${invoiceId}/pdf`);
        expect(pdf.statusCode).toBe(200);
      });

      it('reads its returnable lines, the first step of starting a return from it (200)', async () => {
        // WP-14 (FR-054, Q-R1 = A) widened this, as this row said `returns`
        // would: the order is judged through `orderReadPort.findByIdForCustomer`,
        // so it reaches exactly the orders this file's other rows reach.
        // Submitting the return also needs `returns.create` — see
        // `test/integration/returns/colleague-order-returns.test.ts`.
        const res = await as(holder, 'GET', `/api/v1/orders/${orders.colleague}/returnable`);
        expect(res.statusCode, res.body).toBe(200);
      });

      it('gets 404 on another Organization’s order', async () => {
        const res = await as(holder, 'GET', `/api/v1/orders/${orders.branch}`);
        expect(res.statusCode, res.body).toBe(404);
      });
    });
  }

  describe('a roll-up login holding orders.view_organization', () => {
    it('lists and reads the subtree’s orders, as a roll-up administrator does', async () => {
      expect(await listedIds('headViewer')).toEqual(new Set([orders.branch]));
      const res = await as('headViewer', 'GET', `/api/v1/orders/${orders.branch}`);
      expect(res.statusCode, res.body).toBe(200);
    });

    it('still gets 404 outside the subtree', async () => {
      const res = await as('headViewer', 'GET', `/api/v1/orders/${orders.colleague}`);
      expect(res.statusCode, res.body).toBe(404);
    });
  });
});
