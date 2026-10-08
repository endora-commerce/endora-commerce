import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OpportunityDetailResponseSchema, OpportunityListResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Cart, Order, QuoteRequest } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';
import {
  CRM_ADMIN,
  CRM_API,
  CRM_CUSTOMER,
  changeOrderStatusAsOperator,
  createCrmOpportunity,
  linkCrmQuoteRequest,
  restoreDefaultCrmWorkflow,
  seedCrmOrganization,
  setCrmCountingStatuses,
  setCrmMappings,
  setCrmSetting,
  transitionCrmOpportunity,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';
import { acceptedQuoteRequest, checkOutBasket, convertQuoteRequestToCart } from '../../helpers/quote-conversion.js';

/**
 * An Order placed from a Quote Request that is linked to an Opportunity joins
 * that Opportunity by itself (`specs/143-crm-sales-opportunities/spec.md`
 * FR-027, FR-033, FR-061, FR-100 … FR-104; research N-QS1 … N-QS5).
 *
 * `auto-create.test.ts` and `value.test.ts` prove what CRM does with an Order
 * that names its request — an Order **written by hand**, because until FR-100
 * the product could not make one. Here the Order is placed the way a buyer
 * places it: the request is priced, accepted, converted into a basket and
 * checked out through the storefront routes, and nothing writes the Order's
 * source but `orders` itself.
 */
describe('crm — an order placed from a linked quote request (the real road)', () => {
  let h: BackendServerHandle;

  const detail = async (id: string) => {
    const response = await h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${id}`, cookies: CRM_ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityDetailResponseSchema.parse(response.json()).data;
  };

  const list = async (organizationId = TEST_ORGANIZATION_ID) => {
    const response = await h.app.inject({
      method: 'GET',
      url: `${CRM_API}/opportunities?organizationId=${organizationId}&limit=200`,
      cookies: CRM_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityListResponseSchema.parse(response.json()).data;
  };

  /** The Opportunities that exist after `act` and did not before it. */
  const createdBy = async <T>(act: () => Promise<T>) => {
    const before = new Set((await list()).map((row) => row.id));
    const result = await act();
    return { result, created: (await list()).filter((row) => !before.has(row.id)) };
  };

  const quoteRequestsIdle = () =>
    (h.container.resolve('quoteRequests') as { handle(): { orderCompletionReactor: { idle(): Promise<void> } } })
      .handle()
      .orderCompletionReactor.idle();

  /** Check the basket out and wait for every subscriber of the Order's event, CRM's second look included. */
  const place = async () => {
    const placed = await whenCrmEventSettled(h, 'order.created.v1', () => true, () => checkOutBasket(h));
    await quoteRequestsIdle();
    return placed;
  };

  const announceAgain = (orderId: string) =>
    whenCrmEventSettled(h, 'order.created.v1', (payload) => payload['orderId'] === orderId, async () => {
      h.eventBus.emit('order.created.v1' as never, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        orderId,
        organizationId: TEST_ORGANIZATION_ID,
      } as never);
    });

  /** A computed Opportunity with an accepted Quote Request (7 × 11.25 = 78.75) linked to it. */
  const opportunityWithAcceptedQuote = async () => {
    const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
    const rfq = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
    const linked = await linkCrmQuoteRequest(h, opportunity.id, rfq.id);
    expect(linked.statusCode, linked.body).toBe(201);
    return { opportunity, rfq };
  };

  const orderLinks = async (opportunityId: string) =>
    (await detail(opportunityId)).links.filter((link) => link.documentKind === 'order');

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await h.em().execute(`update "stock_levels" set "on_hand" = 100000`);
    // Both documents count in the state the road leaves them in, so a value
    // that added the request to its Order would show it.
    const counting = await setCrmCountingStatuses(h, {
      order: ['new', 'paid'],
      quoteRequest: ['Approved', 'Completed'],
    });
    expect(counting.statusCode, counting.body).toBe(202);
    const mapped = await setCrmMappings(h, [
      { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified' },
    ]);
    expect(mapped.statusCode, mapped.body).toBe(200);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);
  });

  afterAll(async () => {
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('joins the Opportunity of its request, once, as a quote conversion — and the value is the Order’s, not the two added', async () => {
    const { opportunity, rfq } = await opportunityWithAcceptedQuote();
    expect((await detail(opportunity.id)).value).toBe('78.75');

    await convertQuoteRequestToCart(h, rfq.id);
    // The buyer orders five of the seven: the Order's figure differs from the
    // request's, so "counted once" can be told from "counted twice" and from
    // "the request counted instead".
    const basket = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: CRM_CUSTOMER });
    const line = (basket.json() as { data: { items: Array<{ id: string; productId: string }> } }).data.items.find(
      (item) => item.productId === SEED_PRODUCT_101_ID,
    );
    if (!line) throw new Error('the converted basket holds no line of the quoted product');
    const changed = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${line.id}`,
      cookies: CRM_CUSTOMER,
      payload: { quantity: 5 },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const placed = await place();

    const order = await h.em().findOneOrFail(Order, { id: placed.id }, { filters: false });
    expect(order.sourceQuoteRequestId).toBe(rfq.id);

    const read = await detail(opportunity.id);
    const links = read.links.filter((link) => link.documentKind === 'order');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ documentId: placed.id, linkSource: 'quote_conversion', available: true });
    expect(Number(read.value)).toBe(Number(order.total));
    expect(Number(read.value)).toBe(56.25);

    const quote = await h.em().findOneOrFail(QuoteRequest, { id: rfq.id }, { filters: false });
    expect(quote.status).toBe('Completed');
    expect(quote.convertedOrderId).toBe(placed.id);

    // Delivered again, twice: still one link, still one figure.
    await announceAgain(placed.id);
    await announceAgain(placed.id);
    expect(await orderLinks(opportunity.id)).toHaveLength(1);
    expect(Number((await detail(opportunity.id)).value)).toBe(56.25);
  });

  it('follows the Order-status mapping like any linked Order', async () => {
    const { opportunity, rfq } = await opportunityWithAcceptedQuote();
    await convertQuoteRequestToCart(h, rfq.id);
    const placed = await place();
    expect((await detail(opportunity.id)).status.code).toBe('new');

    await changeOrderStatusAsOperator(h, placed.id, 'paid');
    expect((await detail(opportunity.id)).status.code).toBe('qualified');
  });

  it('joins a closed Opportunity too, and does not reopen it', async () => {
    const { opportunity, rfq } = await opportunityWithAcceptedQuote();
    const closed = await transitionCrmOpportunity(h, opportunity.id, 'lost', CRM_ADMIN, 'budget withdrawn');
    expect(closed.statusCode, closed.body).toBe(200);

    await convertQuoteRequestToCart(h, rfq.id);
    const { result: placed, created } = await createdBy(place);
    expect(created).toEqual([]);
    expect((await orderLinks(opportunity.id)).map((link) => link.documentId)).toEqual([placed.id]);
    expect((await detail(opportunity.id)).status.code).toBe('lost');
  });

  describe('with "create an Opportunity for every Order" on', () => {
    beforeAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
    });

    afterAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    });

    it('the Order joins its request’s Opportunity and gets none of its own', async () => {
      const { opportunity, rfq } = await opportunityWithAcceptedQuote();
      await convertQuoteRequestToCart(h, rfq.id);
      const { result: placed, created } = await createdBy(place);
      expect(created).toEqual([]);
      expect((await orderLinks(opportunity.id)).map((link) => link.documentId)).toEqual([placed.id]);
    });

    it('a basket emptied and refilled by hand is an ordinary Order: it gets its own, and the request’s is untouched', async () => {
      const { opportunity, rfq } = await opportunityWithAcceptedQuote();
      await convertQuoteRequestToCart(h, rfq.id);
      const basket = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: CRM_CUSTOMER });
      for (const item of (basket.json() as { data: { items: Array<{ id: string }> } }).data.items) {
        const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/cart/items/${item.id}`, cookies: CRM_CUSTOMER });
        expect(removed.statusCode, removed.body).toBeLessThan(300);
      }
      const added = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        cookies: CRM_CUSTOMER,
        payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      });
      expect(added.statusCode, added.body).toBe(200);

      const { result: placed, created } = await createdBy(place);
      expect(created).toHaveLength(1);
      const own = created[0];
      if (!own) throw new Error('no Opportunity was created for the ordinary Order');
      expect((await detail(own.id)).links.map((link) => link.documentId)).toEqual([placed.id]);
      expect(await orderLinks(opportunity.id)).toEqual([]);
      expect((await detail(opportunity.id)).value).toBe('78.75');
    });
  });

  it('a basket pointed at another Organization’s linked request links nothing across the tenant', async () => {
    // Another Organization, its buyer, its Opportunity and its own accepted request.
    const otherOrganizationId = await seedCrmOrganization(h.em(), 'quote-source');
    const otherBuyer = `stub-crm-quote-source-${randomUUID().slice(0, 8)}`;
    CUSTOMER_COOKIES[otherBuyer] = {
      customerAccountId: '00000000-0000-4000-8000-0000000000a7',
      organizationId: otherOrganizationId,
    };
    const foreignOpportunity = await createCrmOpportunity(h, {
      organizationId: otherOrganizationId,
      valueMode: 'computed',
    });
    const foreign = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 }, { b2b_session: otherBuyer }).finally(
      () => {
        delete CUSTOMER_COOKIES[otherBuyer];
      },
    );
    const linked = await linkCrmQuoteRequest(h, foreignOpportunity.id, foreign.id);
    expect(linked.statusCode, linked.body).toBe(201);
    const before = await detail(foreignOpportunity.id);

    // This Organization's buyer, with a basket that is line for line what the
    // foreign request holds, and a source no route would let them set.
    const own = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
    await convertQuoteRequestToCart(h, own.id);
    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
    cart.sourceQuoteRequestId = foreign.id;
    await em.flush();

    const placed = await place();
    const order = await h.em().findOneOrFail(Order, { id: placed.id }, { filters: false });
    expect(order.sourceQuoteRequestId ?? null).toBeNull();

    const after = await detail(foreignOpportunity.id);
    expect(after.links.map((link) => link.documentId)).toEqual([foreign.id]);
    expect(after.value).toBe(before.value);
    expect(after.version).toBe(before.version);
    expect((await h.em().findOneOrFail(QuoteRequest, { id: foreign.id }, { filters: false })).status).toBe('Approved');
    // And nothing of this Organization's names the Order's would-be source.
    for (const row of await list()) {
      expect((await detail(row.id)).links.map((link) => link.documentId)).not.toContain(foreign.id);
    }
  });
});
