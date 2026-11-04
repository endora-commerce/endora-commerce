import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';
import { TEST_CL_CUSTOMER_A_ID, TEST_CL_CUSTOMER_B_ID } from '../../helpers/seed-credit-limit.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  CustomerAccount,
  Order,
  OrderItem,
  QuoteRequest,
  QuoteRequestItem,
} from '../../helpers/package-entities.js';

/**
 * Issue #665 — an action a buyer takes on an order *by its id* resolves that
 * order through the same scope the read does (`OrderAccessService`): a
 * Member reaches only the orders they placed, an Administrator
 * every order of the Organization. An order outside that scope answers 404,
 * exactly as `GET /api/v1/orders/:id` does, and nothing is created.
 *
 * `specs/170-organization-roles/` WP-07 (FR-049, OR-5) — the scope's rule is
 * the permission `orders.view_organization`: a *Member* (no such code by
 * default) reaches only the orders they placed, the *Administrator* (every
 * code implicitly) and any role granting the code every order of the
 * Organization.
 *
 * Actors, all in TEST_ORGANIZATION_ID:
 *   - A — *Member*, `stub-customer-session-cl-a`, places the order;
 *   - B — *Member*, `stub-customer-session-cl-b`, a colleague;
 *   - C — this file's own account, a custom role granting
 *     `orders.view_organization` and nothing else;
 *   - the org admin — *Administrator*, `stub-customer-session` (TEST_CUSTOMER_ID).
 */
const MEMBER_A = { b2b_session: 'stub-customer-session-cl-a' };
const MEMBER_B = { b2b_session: 'stub-customer-session-cl-b' };
const VIEWER_C = { b2b_session: 'stub-customer-session-665-c' };
const ORG_ADMIN = { b2b_session: 'stub-customer-session' };
const OPERATOR = { b2b_session: 'stub-admin-session' };

describe('#665 — buyer order actions follow the order read scope', () => {
  let h: BackendServerHandle;
  let orderOfA = '';
  let viewerC = '';

  const countRequestsOf = async (customerAccountId: string): Promise<number> => {
    const em = h.em();
    em.clear();
    return em.count(QuoteRequest, { customerAccountId });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);
    for (const [id, letter] of [
      [TEST_CL_CUSTOMER_A_ID, 'a'],
      [TEST_CL_CUSTOMER_B_ID, 'b'],
    ] as const) {
      if (await em.findOne(CustomerAccount, { id })) continue;
      em.persist(
        em.create(CustomerAccount, {
          id,
          organizationId: TEST_ORGANIZATION_ID,
          email: `scope-665-${letter}@example.com`,
          passwordHash,
          firstName: 'Member',
          lastName: letter.toUpperCase(),
          emailVerifiedAt: new Date(),
        }),
      );
    }
    await em.flush();

    const viewer = em.create(CustomerAccount, {
      organizationId: TEST_ORGANIZATION_ID,
      email: `scope-665-c-${Date.now()}@example.com`,
      passwordHash,
      firstName: 'Member',
      lastName: 'C',
      emailVerifiedAt: new Date(),
    });
    await em.persistAndFlush(viewer);
    viewerC = viewer.id;
    await seedMemberWithPermissions(em, {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: viewerC,
      // Since `specs/170-organization-roles/` WP-16 the reorder needs
      // `carts.create` and the clone `quote_requests.create`; C holds both so
      // that the scope, which this file is about, is what answers.
      permissions: ['orders.view_organization', 'carts.create', 'quote_requests.create'],
    });
    CUSTOMER_COOKIES[VIEWER_C.b2b_session] = { customerAccountId: viewerC, organizationId: TEST_ORGANIZATION_ID };

    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CL_CUSTOMER_A_ID,
      salesChannelId: await systemDefaultSalesChannelId(em),
      status: 'completed',
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: '00000000-0000-4000-8000-0000000006a1',
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: '00000000-0000-4000-8000-0000000006a2',
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '30.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '30.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    await em.persistAndFlush(
      em.create(OrderItem, {
        orderId: order.id,
        productId: SEED_PRODUCT_101_ID,
        productSnapshot: { sku: 'P101', name: 'Product 101', primaryAssetUrl: null },
        quantity: 3,
        unitPrice: '10.00',
        taxRate: '0.0000',
        lineTotal: '30.00',
      }),
    );
    orderOfA = order.id;
  }, 60_000);

  afterAll(async () => {
    delete CUSTOMER_COOKIES[VIEWER_C.b2b_session];
    await teardownBackendServer(h);
  });

  describe('POST /api/v1/orders/:id/clone-to-quote', () => {
    it('B, a colleague, cloning A’s order gets 404 ORDER_NOT_FOUND and no request is created', async () => {
      const before = await countRequestsOf(TEST_CL_CUSTOMER_B_ID);
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderOfA}/clone-to-quote`,
        cookies: MEMBER_B,
      });
      expect(res.statusCode, res.body).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORDER_NOT_FOUND);
      expect(await countRequestsOf(TEST_CL_CUSTOMER_B_ID)).toBe(before);
    });

    it('B gets the same answer the read gives', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/orders/${orderOfA}`,
        cookies: MEMBER_B,
      });
      expect(res.statusCode, res.body).toBe(404);
    });

    it('A cloning their own order creates their request with the order’s lines', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderOfA}/clone-to-quote`,
        cookies: MEMBER_A,
      });
      expect(res.statusCode, res.body).toBe(200);
      const { quoteRequestId } = (res.json() as { data: { quoteRequestId: string } }).data;
      const em = h.em();
      em.clear();
      const rfq = await em.findOneOrFail(QuoteRequest, { id: quoteRequestId });
      expect(rfq.customerAccountId).toBe(TEST_CL_CUSTOMER_A_ID);
      expect(rfq.organizationId).toBe(TEST_ORGANIZATION_ID);
      const items = await em.find(QuoteRequestItem, { quoteRequestId });
      expect(items.map((i) => [i.productId, i.quantity])).toEqual([[SEED_PRODUCT_101_ID, 3]]);
    });

    it('the Organization admin cloning A’s order creates the admin’s own request', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderOfA}/clone-to-quote`,
        cookies: ORG_ADMIN,
      });
      expect(res.statusCode, res.body).toBe(200);
      const { quoteRequestId } = (res.json() as { data: { quoteRequestId: string } }).data;
      const em = h.em();
      em.clear();
      const rfq = await em.findOneOrFail(QuoteRequest, { id: quoteRequestId });
      expect(rfq.customerAccountId).toBe(TEST_CUSTOMER_ID);
    });

    it('C, a colleague holding orders.view_organization, cloning A’s order creates C’s own request', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderOfA}/clone-to-quote`,
        cookies: VIEWER_C,
      });
      expect(res.statusCode, res.body).toBe(200);
      const { quoteRequestId } = (res.json() as { data: { quoteRequestId: string } }).data;
      const em = h.em();
      em.clear();
      const rfq = await em.findOneOrFail(QuoteRequest, { id: quoteRequestId });
      expect(rfq.customerAccountId).toBe(viewerC);
    });

    it('the operator clone is unchanged: it creates the request for the order’s placer', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${orderOfA}/clone-to-quote`,
        cookies: OPERATOR,
      });
      expect(res.statusCode, res.body).toBe(200);
      const { quoteRequestId } = (res.json() as { data: { quoteRequestId: string } }).data;
      const em = h.em();
      em.clear();
      const rfq = await em.findOneOrFail(QuoteRequest, { id: quoteRequestId });
      expect(rfq.customerAccountId).toBe(TEST_CL_CUSTOMER_A_ID);
      expect(rfq.organizationId).toBe(TEST_ORGANIZATION_ID);
    });
  });

  describe('POST /api/v1/orders/:id/reorder', () => {
    it('B reordering A’s order gets 404 ORDER_NOT_FOUND', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderOfA}/reorder`,
        cookies: MEMBER_B,
      });
      expect(res.statusCode, res.body).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORDER_NOT_FOUND);
    });

    it('C, holding orders.view_organization, reordering A’s order is served', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderOfA}/reorder`,
        cookies: VIEWER_C,
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('A reordering their own order is served', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${orderOfA}/reorder`,
        cookies: MEMBER_A,
      });
      expect(res.statusCode, res.body).toBe(200);
    });
  });
});
