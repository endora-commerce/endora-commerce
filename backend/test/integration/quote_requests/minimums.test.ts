import { randomUUID } from 'node:crypto';
import { asValue, type Resolver } from 'awilix';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type BuyerLinePricePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  CustomerAccount,
  Order,
  OrderItem,
  Organization,
  QuoteRequest,
  QuoteRequestItem,
  QuoteRequestOrgPolicy,
} from '../../helpers/package-entities.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  setProductMinimum,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';

/**
 * Feature 155, Phase 10 (T078) — a buyer's quote-request writes refuse a line
 * below its product's minimum, before pricing, writing nothing (FR-012, FR-029,
 * FR-031; US4 #5, #5a–#5d; threats S2, S3; SC-004, analyze F11;
 * `contracts/quote-requests-api.md` §2, §3).
 *
 * - A: simple, minimum 10 pcs. D: simple, no minimum.
 * - L: simple, no minimum at first; its minimum is raised to 10 once a line
 *   below it is already stored (a cart line, a draft line) — the way a buyer's
 *   document comes to hold a line below today's minimum.
 * - H: minimum 10, published on no channel — hidden from every buyer request.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('155 — buyer quote-request writes refuse lines below a minimum [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let A: MinimumProductFixture;
  let D: MinimumProductFixture;
  let L: MinimumProductFixture;
  let H: MinimumProductFixture;
  let lockedOrg = '';
  let lockedBuyer = '';
  const lockedCookie = `stub-148-qmin-locked-${RUN}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    A = await createMinimumProduct(em, { sku: `QMIN-A-${RUN}`, nameEn: `Anchor ${RUN}`, namePl: `Kotwa ${RUN}`, minOrderQuantity: 10, channelIds: channels });
    D = await createMinimumProduct(em, { sku: `QMIN-D-${RUN}`, nameEn: `Dowel ${RUN}`, namePl: `Kolek ${RUN}`, channelIds: channels });
    L = await createMinimumProduct(em, { sku: `QMIN-L-${RUN}`, nameEn: `Lintel ${RUN}`, namePl: `Nadproze ${RUN}`, channelIds: channels });
    H = await createMinimumProduct(em, { sku: `QMIN-H-${RUN}`, nameEn: `Hinge ${RUN}`, namePl: `Zawias ${RUN}`, minOrderQuantity: 10, channelIds: [] });

    await withSystemScope('155 T078: seed a price-proposal-locked organization', async () => {
      const fork = h.orm.em.fork();
      const org = fork.create(Organization, {
        name: `148 quote minimums locked ${RUN}`,
        taxId: `PL148Q${String(Date.now()).slice(-8)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
      });
      await fork.persistAndFlush(org);
      const account = fork.create(CustomerAccount, {
        organizationId: org.id,
        email: `148-qmin-${RUN}@qmin.local`,
        passwordHash: 'x'.repeat(60),
        firstName: '148',
        lastName: 'locked',
      });
      await fork.persistAndFlush(account);
      await fork.persistAndFlush(fork.create(QuoteRequestOrgPolicy, { organizationId: org.id, priceProposalsAllowed: false }));
      // Feature 154 — the tenant shops on the stores the harness seeds.
      await bindOrganizationsToFixtureChannelsSql(fork, [org.id]);
      lockedOrg = org.id;
      lockedBuyer = account.id;
    });
    CUSTOMER_COOKIES[lockedCookie] = { customerAccountId: lockedBuyer, organizationId: lockedOrg };
  }, 60_000);

  afterAll(async () => {
    delete CUSTOMER_COOKIES[lockedCookie];
    await teardownBackendServer(h);
  });

  // -------------------------------------------------------------------------

  const create = (payload: Record<string, unknown>, cookies: Record<string, string> = CUSTOMER) =>
    h.app.inject({ method: 'POST', url: '/api/v1/quote-requests', cookies, payload });

  const patch = (id: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/quote-requests/${id}`, cookies: CUSTOMER, payload });

  const countRequests = async (customerAccountId = TEST_CUSTOMER_ID) => {
    const em = h.em();
    em.clear();
    return em.count(QuoteRequest, { customerAccountId });
  };

  const requestRow = async (id: string) => {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(QuoteRequest, { id });
  };

  const linesOf = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    return em.find(QuoteRequestItem, { quoteRequestId }, { orderBy: { createdAt: 'asc', id: 'asc' } });
  };

  const historyOf = async (quoteRequestId: string) => {
    const connection = h.em().getConnection();
    const [events] = await connection.execute<Array<{ n: string }>>(
      `select count(*) as n from "quote_request_events" where "quote_request_id" = ?`,
      [quoteRequestId],
    );
    const [revisions] = await connection.execute<Array<{ n: string }>>(
      `select count(*) as n from "quote_request_revisions" where "quote_request_id" = ?`,
      [quoteRequestId],
    );
    return { events: Number(events?.n), revisions: Number(revisions?.n) };
  };

  /** Runs `fn` with a `buyerLinePricePort` that counts its calls. */
  const countingPrices = async (fn: (asked: () => number) => Promise<void>) => {
    const original = h.container.registrations['buyerLinePricePort'] as Resolver<unknown>;
    const real = h.container.resolve('buyerLinePricePort') as BuyerLinePricePort;
    let asked = 0;
    h.container.register({
      buyerLinePricePort: asValue({
        resolveForBuyer: async (query: Parameters<BuyerLinePricePort['resolveForBuyer']>[0]) => {
          asked += 1;
          return real.resolveForBuyer(query);
        },
      }),
    });
    try {
      await fn(() => asked);
    } finally {
      h.container.register('buyerLinePricePort', original);
    }
  };

  /** SC-004 / analyze F11 — the refusal names the product and the minimum, on every line. */
  const expectAnchorRefused = (res: { statusCode: number; body: string; json: () => unknown }, index = 0) => {
    expect(res.statusCode, res.body).toBe(422);
    const { error } = res.json() as ErrorBody;
    expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    expect(error.message).toContain(A.nameEn);
    expect(error.message).toContain('10');
    expect(error.details).toMatchObject({
      productId: A.id,
      productName: A.nameEn,
      minimum: 10,
      lines: [{ index, productId: A.id, productName: A.nameEn, kind: 'pieces', minimum: 10 }],
    });
  };

  const closeBasket = () =>
    h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

  /** A stored, editable draft holding `L × 5`, written before L's minimum was raised to 10. */
  const draftBelowTodaysMinimum = async (): Promise<{ id: string }> => {
    await setProductMinimum(h.em(), L.id, null);
    try {
      const res = await create({
        items: [
          { productId: L.id, quantity: 5 },
          { productId: D.id, quantity: 1 },
        ],
      });
      expect(res.statusCode, res.body).toBe(201);
      return { id: (res.json() as { data: { id: string } }).data.id };
    } finally {
      await setProductMinimum(h.em(), L.id, 10);
    }
  };

  // -------------------------------------------------------------------------

  describe('US4 #5 — every buyer submission path refuses A × 5', () => {
    it('direct: 422 naming A and its minimum; no row; price_lists never asked', async () => {
      await countingPrices(async (asked) => {
        const before = await countRequests();
        expectAnchorRefused(
          await create({
            items: [
              { productId: D.id, quantity: 1 },
              { productId: A.id, quantity: 5 },
            ],
          }),
          1,
        );
        expect(await countRequests()).toBe(before);
        expect(asked()).toBe(0);
        // The counting port is the one an accepted create asks.
        const ok = await create({ items: [{ productId: A.id, quantity: 10 }] });
        expect(ok.statusCode, ok.body).toBe(201);
        expect(asked()).toBe(1);
      });
    });

    it('a body carrying minimums: "warn", top level and per line, is still refused [S3]', async () => {
      const before = await countRequests();
      expectAnchorRefused(await create({ minimums: 'warn', items: [{ productId: A.id, quantity: 5, minimums: 'warn' }] }));
      expect(await countRequests()).toBe(before);
    });

    it('from the cart', async () => {
      await closeBasket();
      await setProductMinimum(h.em(), A.id, null);
      try {
        const add = await h.app.inject({
          method: 'POST',
          url: '/api/v1/cart/items',
          cookies: CUSTOMER,
          payload: { productId: A.id, quantity: 5 },
        });
        expect(add.statusCode, add.body).toBe(200);
      } finally {
        await setProductMinimum(h.em(), A.id, 10);
      }
      const before = await countRequests();
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/convert-to-quote-request',
        cookies: CUSTOMER,
        payload: {},
      });
      expectAnchorRefused(res);
      expect(await countRequests()).toBe(before);
      await closeBasket();
    });

    it('from quick order (the buyer’s build)', async () => {
      const before = await countRequests();
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/build',
        cookies: CUSTOMER,
        payload: { target: 'quote_request', items: [{ productId: A.id, quantity: 5 }] },
      });
      expectAnchorRefused(res);
      expect(await countRequests()).toBe(before);
    });

    it('from a shopping list', async () => {
      const list = await h.app.inject({
        method: 'POST',
        url: '/api/v1/shopping-lists',
        cookies: CUSTOMER,
        payload: { name: `Quote minimums ${RUN}` },
      });
      expect(list.statusCode, list.body).toBe(201);
      const listId = (list.json() as { data: { id: string } }).data.id;
      const item = await h.app.inject({
        method: 'POST',
        url: `/api/v1/shopping-lists/${listId}/items`,
        cookies: CUSTOMER,
        payload: { productId: A.id, quantity: 5 },
      });
      expect(item.statusCode, item.body).toBe(201);
      const before = await countRequests();
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/shopping-lists/${listId}/convert-to-rfq`,
        cookies: CUSTOMER,
        payload: {},
      });
      expectAnchorRefused(res);
      expect(await countRequests()).toBe(before);
    });

    it('#5a — the buyer’s clone of an order holding A × 5 is refused; no request is created', async () => {
      const em = h.em();
      const order = em.create(Order, {
        organizationId: TEST_ORGANIZATION_ID,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: randomUUID(),
        status: 'completed',
        deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        deliveryMethodId: randomUUID(),
        deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
        paymentMethodId: randomUUID(),
        paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
        subtotal: '50.00',
        taxTotal: '0.00',
        deliveryTotal: '0.00',
        total: '50.00',
        currency: 'PLN',
        placedAt: new Date(),
      });
      await em.persistAndFlush(order);
      await em.persistAndFlush(
        em.create(OrderItem, {
          orderId: order.id,
          productId: A.id,
          productSnapshot: { sku: A.sku, name: A.nameEn, primaryAssetUrl: null },
          quantity: 5,
          unitPrice: '10.00',
          taxRate: '0.0000',
          lineTotal: '50.00',
        }),
      );
      const before = await countRequests();
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${order.id}/clone-to-quote`,
        cookies: CUSTOMER,
      });
      expectAnchorRefused(res);
      expect(await countRequests()).toBe(before);
    });

    it('the operator’s quick-order build to a quote request is not refused (minimums: warn, FR-012)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quick-order/build',
        cookies: ADMIN,
        payload: {
          target: 'quote_request',
          onBehalfOf: { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
          items: [{ productId: A.id, quantity: 5 }],
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const id = (res.json() as { data: { quoteRequestId: string } }).data.quoteRequestId;
      expect((await linesOf(id)).map((l) => [l.productId, l.quantity])).toEqual([[A.id, 5]]);
    });
  });

  describe('FR-029 — the order of the refusals', () => {
    it('a locked buyer’s price proposal is refused with RFQ_PRICE_PROPOSAL_NOT_ALLOWED first', async () => {
      const before = await countRequests(lockedBuyer);
      const res = await create(
        { items: [{ productId: A.id, quantity: 5, desiredUnitPrice: 3 }] },
        { b2b_session: lockedCookie },
      );
      expect(res.statusCode, res.body).toBe(422);
      expect((res.json() as ErrorBody).error.code).toBe('RFQ_PRICE_PROPOSAL_NOT_ALLOWED');
      expect(await countRequests(lockedBuyer)).toBe(before);
    });

    it('a hidden product → 404 first, naming neither product nor minimum [S2]', async () => {
      const before = await countRequests();
      const res = await create({
        items: [
          { productId: H.id, quantity: 5 },
          { productId: A.id, quantity: 5 },
        ],
      });
      expect(res.statusCode, res.body).toBe(404);
      const { error } = res.json() as ErrorBody;
      expect(error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      expect(JSON.stringify(error)).not.toContain(H.nameEn);
      expect(JSON.stringify(error)).not.toContain(A.nameEn);
      expect(await countRequests()).toBe(before);
    });
  });

  describe('FR-031 — revisions, draft edits and resubmission', () => {
    it('#5b — the buyer accepts a representative’s below-minimum revision', async () => {
      const created = await create({ items: [{ productId: A.id, quantity: 10 }] });
      expect(created.statusCode, created.body).toBe(201);
      const { id, version } = (created.json() as { data: { id: string; version: number } }).data;
      const [row] = await linesOf(id);
      const modify = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${id}`,
        cookies: ADMIN,
        headers: { 'if-match': `"${version}"` },
        payload: { items: [{ id: row!.id, productId: A.id, quantity: 5, agreedUnitPrice: 9 }] },
      });
      expect(modify.statusCode, modify.body).toBe(200);
      const revision = (modify.json() as { data: { currentRevisionNumber: number } }).data.currentRevisionNumber;
      const accept = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${id}/accept-revision`,
        cookies: CUSTOMER,
        payload: { expectedRevisionNumber: revision },
      });
      expect(accept.statusCode, accept.body).toBe(200);
      expect((await requestRow(id)).status).toBe('Approved');
    });

    it('#5c — an unchanged below-minimum line survives a draft edit; a change to 6 is refused, writing nothing', async () => {
      const { id } = await draftBelowTodaysMinimum();
      const kept = await patch(id, {
        headerNote: 'unchanged L line',
        items: [
          { productId: L.id, quantity: 5 },
          { productId: D.id, quantity: 2 },
        ],
      });
      expect(kept.statusCode, kept.body).toBe(200);

      const before = await requestRow(id);
      const history = await historyOf(id);
      await countingPrices(async (asked) => {
        const res = await patch(id, {
          items: [
            { productId: L.id, quantity: 6 },
            { productId: D.id, quantity: 2 },
          ],
        });
        expect(res.statusCode, res.body).toBe(422);
        const { error } = res.json() as ErrorBody;
        expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
        expect(error.message).toContain(L.nameEn);
        expect(error.details).toMatchObject({
          productName: L.nameEn,
          minimum: 10,
          lines: [{ index: 0, productId: L.id, productName: L.nameEn, kind: 'pieces', minimum: 10 }],
        });
        expect(asked()).toBe(0);
      });
      const after = await requestRow(id);
      expect(after.version).toBe(before.version);
      expect(after.currentRevisionNumber).toBe(before.currentRevisionNumber);
      expect(await historyOf(id)).toEqual(history);
      expect((await linesOf(id)).map((l) => [l.productId, l.quantity]).sort()).toEqual(
        [
          [L.id, 5],
          [D.id, 2],
        ].sort(),
      );
    });

    it('#5c — an unchanged line counts toward its product total when another line of it is checked', async () => {
      const { id } = await draftBelowTodaysMinimum();
      const short = await patch(id, {
        items: [
          { productId: L.id, quantity: 5 },
          { productId: L.id, quantity: 3 },
        ],
      });
      expect(short.statusCode, short.body).toBe(422);
      expect((short.json() as ErrorBody).error.details).toMatchObject({ lines: [{ index: 1, productId: L.id }] });
      const enough = await patch(id, {
        items: [
          { productId: L.id, quantity: 5 },
          { productId: L.id, quantity: 5 },
        ],
      });
      expect(enough.statusCode, enough.body).toBe(200);
    });

    it('#5d — resubmitting a request holding a below-minimum line is refused; no new request', async () => {
      const { id } = await draftBelowTodaysMinimum();
      const before = await countRequests();
      await countingPrices(async (asked) => {
        const res = await h.app.inject({
          method: 'POST',
          url: `/api/v1/quote-requests/${id}/resubmit`,
          cookies: CUSTOMER,
          payload: {},
        });
        expect(res.statusCode, res.body).toBe(422);
        const { error } = res.json() as ErrorBody;
        expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
        expect(error.details).toMatchObject({
          productName: L.nameEn,
          minimum: 10,
          // The resubmitted request's line order is the stored one; only L is below.
          lines: [{ productId: L.id, productName: L.nameEn, kind: 'pieces', minimum: 10 }],
        });
        expect(asked()).toBe(0);
      });
      expect(await countRequests()).toBe(before);
    });
  });
});
