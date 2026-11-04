import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import {
  CustomerAccount,
  Organization,
  QuoteRequest,
  QuoteRequestAccountPolicy,
  QuoteRequestOrgPolicy,
} from '../../helpers/package-entities.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  CUSTOMER_COOKIES,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { seedCustomOrganizationRole } from '../../helpers/seed-organization-roles.js';
import { Order, Product } from '../../helpers/package-entities.js';
import {
  acceptedQuoteRequest,
  checkOutBasket,
  convertQuoteRequestToCart,
  whenOrderCreatedSettled,
} from '../../helpers/quote-conversion.js';
import { setProductMinimum } from '../../helpers/order-minimum-fixture.js';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { CrmOpportunityLink } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';
import {
  createCrmOpportunity,
  crmPlacedDocumentsHandled,
  setCrmSetting,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';

/**
 * `quote_requests` off-state — Constitution XVII item 6, from a **package**
 * (feature 080, T040b).
 *
 * The module lives in `packages/modules/quote_requests` now, and every gate it
 * relies on is applied by `ctx.routes` / `ctx.subscribe` in the kernel
 * container. Nothing about those seams is supposed to change when a module's
 * sources move — this file is what turns "supposed to" into a measurement.
 *
 * **The subscriber is the half `blog` left uncovered** (!910). `blog`'s only
 * `ctx.subscribe` listens for `settings.value_changed` and drops a cache, which
 * is invisible from outside: a test cannot tell a subscriber that did not run
 * from one that ran and cleared an already-empty cache, so the packaged
 * `ctx.subscribe` seam had no proof at all. `quote_requests`' subscriber
 * **writes** — `order.created.v1` flips the originating quote request to
 * `Completed`, appends a `completed` event row and enqueues a notification — so
 * "did it run" is a row. And issue #107's regression is exactly that handler
 * going on doing all three while every route that could show the customer the
 * quote request refused.
 *
 * The positive control comes first, for the reason `mfa`'s off-state test gives:
 * without it, a subscriber that never worked at all would read as a successful
 * absence.
 */
describe('quote_requests off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  /** The completion reactor, taken while the module is on: its handle is gated. */
  let reactor: { idle(): Promise<void> };
  const admin = { b2b_session: 'stub-admin-session' };
  const customer = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    reactor = (h.container.resolve('quoteRequests') as { handle(): { orderCompletionReactor: typeof reactor } })
      .handle().orderCompletionReactor;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'quote_requests', {
      routes: [
        { url: '/api/v1/admin/quote-requests', cookies: admin },
        { url: '/api/v1/admin/quote-requests/list-views', cookies: admin },
        // `specs/157-custom-fields-list-filters/` — the list's offered custom-field filters.
        { url: '/api/v1/admin/quote-requests/custom-field-filters', cookies: admin },
        { url: '/api/v1/quote-requests', cookies: customer },
        '/api/v1/storefront/settings/quote-requests',
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS,
        value: 21,
        cookies: admin,
      },
    });
  });

  /**
   * `specs/147-saved-views/` FR-018 (US3-7, threat model S-09): a saved view
   * on the Quote Request list is refused on **every** method while the module
   * is off — the collection's `GET` and `POST` and the item's `PATCH` and
   * `DELETE` — exactly as the list itself is, and the stored row is untouched:
   * once the module is back the view is listed as it was.
   */
  it('refuses all four saved-view routes while deactivated and keeps the view (FR-018)', async () => {
    const VIEWS = '/api/v1/admin/quote-requests/list-views';
    const name = `Off-state view ${randomUUID().slice(0, 8)}`;
    const created = await h.app.inject({
      method: 'POST',
      url: VIEWS,
      cookies: admin,
      payload: { name, shared: true, filters: { scope: 'all' }, sort: { field: 'total', dir: 'desc' } },
    });
    expect(created.statusCode).toBe(201);
    const view = (created.json() as { data: { id: string } }).data;

    const listView = async (): Promise<unknown> => {
      const res = await h.app.inject({ method: 'GET', url: VIEWS, cookies: admin });
      expect(res.statusCode).toBe(200);
      return (res.json() as { data: Array<{ id: string }> }).data.find((v) => v.id === view.id);
    };
    const before = await listView();
    expect(before).toMatchObject({ name, shared: true, filters: { scope: 'all' } });

    await withModuleOff('quote_requests', 'deactivated', async () => {
      const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/quote-requests', cookies: admin });
      const probes = [
        { method: 'GET' as const, url: VIEWS },
        { method: 'POST' as const, url: VIEWS, payload: { name: `${name} 2`, shared: false, filters: {} } },
        { method: 'PATCH' as const, url: `${VIEWS}/${view.id}`, payload: { name: `${name} renamed` } },
        { method: 'DELETE' as const, url: `${VIEWS}/${view.id}` },
      ];
      for (const probe of probes) {
        const res = await h.app.inject({ ...probe, cookies: admin });
        expect(res.statusCode, `${probe.method} ${probe.url}`).toBe(list.statusCode);
        expect((res.json() as { error?: { code?: string } }).error?.code, `${probe.method} ${probe.url}`).toBe(
          (list.json() as { error?: { code?: string } }).error?.code,
        );
      }
      // The list itself is what the four are measured against; it answers the
      // module's absence, so a match above is a refusal and not a coincidence.
      expect(list.statusCode).toBe(503);
      expect((list.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    expect(await listView()).toEqual(before);
  });

  /**
   * One submitted quote request, and one order pointing back at it.
   *
   * The order is written directly rather than checked out: the reactor reads it
   * through `orderReadPort` and needs only `sourceQuoteRequestId`, and a full
   * checkout would put four other modules between this test and the thing it is
   * measuring.
   */
  async function quoteRequestWithOrder(): Promise<{ quoteRequestId: string; orderId: string }> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customer,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    expect(created.statusCode).toBe(201);
    const quoteRequestId = (created.json() as { data: { id: string } }).data.id;

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
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
      sourceQuoteRequestId: quoteRequestId,
    });
    await em.persistAndFlush(order);
    return { quoteRequestId, orderId: order.id };
  }

  /**
   * `emit` dispatches without a scope and the handlers are async, so wait for
   * them — for the bus's chain to reach its end, and for the reactor's second
   * look where it took one — rather than for a number of milliseconds. This
   * slept 50 ms; measured on a busy machine the completion lands 27 to 67 ms
   * after the event, so both cases below failed now and then for no reason of
   * their own.
   */
  async function announceOrder(orderId: string): Promise<void> {
    await whenOrderCreatedSettled(h, async () => {
      h.eventBus.emit('order.created.v1', { orderId } as never);
    });
    await reactor.idle();
  }

  async function statusOf(quoteRequestId: string): Promise<string | undefined> {
    const em = h.em();
    em.clear();
    return (await em.findOne(QuoteRequest, { id: quoteRequestId }))?.status;
  }

  it('the packaged subscriber runs: order.created.v1 completes the quote request', async () => {
    const { quoteRequestId, orderId } = await quoteRequestWithOrder();
    await announceOrder(orderId);
    expect(await statusOf(quoteRequestId)).toBe('Completed');
  });

  it('and stops while the module is deactivated, then resumes (issue #107)', async () => {
    const { quoteRequestId, orderId } = await quoteRequestWithOrder();
    const before = await statusOf(quoteRequestId);
    expect(before).not.toBe('Completed');

    await withModuleOff('quote_requests', 'deactivated', async () => {
      await announceOrder(orderId);
      expect(await statusOf(quoteRequestId)).toBe(before);
    });

    await announceOrder(orderId);
    expect(await statusOf(quoteRequestId)).toBe('Completed');
  });

  /**
   * Feature 155 (T056b; FR-036, research R17/R19) — with `quote_requests` off,
   * placement cannot vouch for a basket's quote source, so no line is exempt:
   * a seeded A × 5 (A minimum 10) is flagged by the checkout preview, and
   * placement — which since issue #167 cannot confirm the agreed price either —
   * refuses it: the fail-closed reading. Switched back on, the same basket's
   * exemption is honoured again and it places.
   */
  it('155 — while off, a quote-seeded A × 5 below its minimum is flagged and refused; back on, it places', async () => {
    const em = h.em();
    const product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID }, { filters: false });
    const previousMinimum = product.minOrderQuantity ?? null;
    await em
      .getConnection()
      .execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [SEED_PRODUCT_101_ID]);
    await em
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);
    try {
      await setProductMinimum(em, SEED_PRODUCT_101_ID, null);
      const rfq = await acceptedQuoteRequest(h, { quantity: 5, agreedUnitPrice: 11.25 });
      await setProductMinimum(em, SEED_PRODUCT_101_ID, 10);
      await convertQuoteRequestToCart(h, rfq.id);

      const preview = () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/orders/preview-total',
          cookies: customer,
          payload: { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID },
        });
      const place = () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/orders',
          cookies: customer,
          payload: {
            deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
            billingAddressId: SEED_ADDRESS_BILLING_ID,
            deliveryMethodId: SEED_DELIVERY_METHOD_ID,
            paymentMethodId: SEED_PAYMENT_METHOD_ID,
          },
        });
      const belowMinimumLines = async () => {
        const res = await preview();
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: { belowMinimumLines: Array<{ productId: string; kind: string }> } }).data
          .belowMinimumLines;
      };

      await withModuleOff('quote_requests', 'deactivated', async () => {
        expect(await belowMinimumLines()).toEqual([
          expect.objectContaining({ productId: SEED_PRODUCT_101_ID, kind: 'pieces', minimum: 10 }),
        ]);
        // Issue #167 — and the agreed price itself cannot be confirmed, which
        // refuses the placement ahead of the minimums (fail-closed).
        const refused = await place();
        expect(refused.statusCode, refused.body).toBe(410);
        expect((refused.json() as { error: { code: string; details?: { code?: string } } }).error).toMatchObject({
          code: ERROR_CODES.QUOTE_VALIDITY_ENDED,
          details: { code: 'unavailable' },
        });
      });

      expect(await belowMinimumLines()).toEqual([]);
      const placed = await whenOrderCreatedSettled(h, () => place());
      expect(placed.statusCode, placed.body).toBe(201);
      await reactor.idle();
    } finally {
      await setProductMinimum(em, SEED_PRODUCT_101_ID, previousMinimum);
    }
  });

  /**
   * Feature 159 (T069; FR-083, research R-23) — line groups across the two
   * off-states that touch them.
   *
   * - `document_templates` off: the quote PDF is refused (`refuses-without`, as
   *   153), and nothing else about the grouping moves — an operator still
   *   groups a quote, both replies still carry the groups.
   * - `quote_requests` off: an order placed from a grouped quote keeps showing
   *   its groups. They are `orders`' own rows, written at placement, so the
   *   quote module's absence has nothing to take away. (A placement while it
   *   is off carries no groups — `place-order-quote-groups.test.ts` FR-083.)
   */
  describe('feature 159 — line groups (FR-083)', () => {
    type Grouped = {
      itemGroups: Array<{ id: string; name: string; position: number }>;
      items: Array<{ productId: string; groupId: string | null; position: number }>;
    };

    const read = async (url: string, cookies: Record<string, string>): Promise<Grouped> => {
      const res = await h.app.inject({ method: 'GET', url, cookies });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
      return (res.json() as { data: Grouped }).data;
    };

    /** `[group name | '-', productId]` per line, in the reply's order. */
    const shapeOf = (reply: Grouped) => {
      const names = new Map(reply.itemGroups.map((group) => [group.id, group.name]));
      return reply.items.map((item) => [item.groupId ? names.get(item.groupId) : '-', item.productId]);
    };

    /** A Pending quote of the shared buyer, grouped by the operator into `Hall A`. */
    async function groupedQuote(): Promise<string> {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: customer,
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 12 }] },
      });
      expect(created.statusCode, created.body).toBe(201);
      const rfq = (created.json() as { data: { id: string; version: number } }).data;
      const grouped = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${rfq.id}`,
        cookies: admin,
        headers: { 'if-match': `"${rfq.version}"` },
        payload: {
          groups: [{ key: 'a', name: 'Hall A' }],
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 11, groupKey: 'a' }],
        },
      });
      expect(grouped.statusCode, grouped.body).toBe(200);
      return rfq.id;
    }

    it('document templates off: the quote PDF is refused, grouping and the replies are unaffected', async () => {
      const quoteId = await groupedQuote();
      const adminUrl = `/api/v1/admin/quote-requests/${quoteId}`;
      const before = await read(adminUrl, admin);
      expect(shapeOf(before)).toEqual([['Hall A', SEED_PRODUCT_101_ID]]);

      await withModuleOff('document_templates', 'deactivated', async () => {
        const pdf = await h.app.inject({ method: 'GET', url: `${adminUrl}/pdf`, cookies: admin });
        expect(pdf.statusCode, pdf.body).toBe(503);
        expect((pdf.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');

        expect(await read(adminUrl, admin)).toMatchObject({ itemGroups: before.itemGroups });
        expect(shapeOf(await read(`/api/v1/quote-requests/${quoteId}`, customer))).toEqual([
          ['Hall A', SEED_PRODUCT_101_ID],
        ]);

        // Regrouping is a quote write, not a document one: it still saves.
        const { version } = (await read(adminUrl, admin)) as Grouped & { version: number };
        const renamed = await h.app.inject({
          method: 'PATCH',
          url: adminUrl,
          cookies: admin,
          headers: { 'if-match': `"${version}"` },
          payload: {
            groups: [{ key: 'a', id: before.itemGroups[0]!.id, name: 'Hall A1' }],
            items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 11, groupKey: 'a' }],
          },
        });
        expect(renamed.statusCode, renamed.body).toBe(200);
        expect(shapeOf((renamed.json() as { data: Grouped }).data)).toEqual([['Hall A1', SEED_PRODUCT_101_ID]]);
      });

      const pdf = await h.app.inject({ method: 'GET', url: `${adminUrl}/pdf`, cookies: admin });
      expect(pdf.statusCode, pdf.body).toBe(200);
      expect(shapeOf(await read(adminUrl, admin))).toEqual([['Hall A1', SEED_PRODUCT_101_ID]]);
    });

    it.each(['deactivated', 'platform-unavailable'] as const)(
      'quote requests %s: an order placed from a grouped quote still serves its itemGroups',
      async (axis) => {
        const em = h.em();
        await em
          .getConnection()
          .execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [SEED_PRODUCT_101_ID]);
        await em
          .getConnection()
          .execute(
            `update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`,
            [TEST_CUSTOMER_ID],
          );

        const quoteId = await groupedQuote();
        const detail = await read(`/api/v1/quote-requests/${quoteId}`, customer);
        const accepted = await h.app.inject({
          method: 'POST',
          url: `/api/v1/quote-requests/${quoteId}/accept-revision`,
          cookies: customer,
          payload: {
            expectedRevisionNumber: (detail as Grouped & { currentRevisionNumber: number }).currentRevisionNumber,
          },
        });
        expect(accepted.statusCode, accepted.body).toBe(200);
        await convertQuoteRequestToCart(h, quoteId);
        const placed = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
        await reactor.idle();

        const customerUrl = `/api/v1/orders/${placed.id}`;
        const adminUrl = `/api/v1/admin/orders/${placed.id}`;
        const customerBefore = await read(customerUrl, customer);
        const adminBefore = await read(adminUrl, admin);
        expect(shapeOf(customerBefore)).toEqual([['Hall A', SEED_PRODUCT_101_ID]]);

        await withModuleOff('quote_requests', axis, async () => {
          // The control: the quote itself is gone, so the order's answer below is an exemption measured.
          const quote = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${quoteId}`, cookies: customer });
          expect(quote.statusCode, quote.body).not.toBe(200);
          expect(await read(customerUrl, customer)).toEqual(customerBefore);
          expect(await read(adminUrl, admin)).toEqual(adminBefore);
        });
      },
    );
  });

  /**
   * Feature 146 (T085, FR-028) — the price-negotiation lock and the history
   * read are module surfaces like any other: while `quote_requests` is off the
   * four admin negotiation routes, the buyer's own read and `/history` answer
   * `MODULE_DISABLED`; the stored policy rows are not touched by the flip; and
   * once it is back on, the routes answer the values written before.
   *
   * The organization, account and buyer session are this file's own, so a
   * lock written here cannot reach another file's buyer.
   */
  describe('feature 146 — negotiation lock and history (FR-028)', () => {
    const stamp = Date.now();
    const BUYER_SESSION = `stub-146-off-buyer-${stamp}`;
    const buyer = { b2b_session: BUYER_SESSION };
    let organizationId: string;
    let customerAccountId: string;
    let quoteRequestId: string;

    const orgUrl = () => `/api/v1/admin/organizations/${organizationId}/quote-price-negotiation`;
    const accountUrl = () => `/api/v1/admin/customers/${customerAccountId}/quote-price-negotiation`;
    const historyUrl = () => `/api/v1/admin/quote-requests/${quoteRequestId}/history`;
    const STOREFRONT_URL = '/api/v1/quote-requests/price-negotiation';

    const policyRows = () =>
      withSystemScope('146 T085: read the policy rows back across the off-state flip', async () => {
        const em = h.orm.em.fork();
        const org = await em.findOne(QuoteRequestOrgPolicy, { organizationId });
        const account = await em.findOne(QuoteRequestAccountPolicy, { customerAccountId });
        return {
          org: org ? { allowed: org.priceProposalsAllowed, updatedAt: org.updatedAt.toISOString() } : null,
          account: account
            ? { allowed: account.priceProposalsAllowed, updatedAt: account.updatedAt.toISOString() }
            : null,
        };
      });

    beforeAll(async () => {
      await withSystemScope('146 T085: seed the off-state tenant', async () => {
        const em = h.orm.em.fork();
        const org = em.create(Organization, {
          name: `146 off-state ${stamp}`,
          taxId: `PL146O${String(stamp).slice(-7)}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
        });
        await em.persistAndFlush(org);
        const account = em.create(CustomerAccount, {
          organizationId: org.id,
          email: `146-off-${stamp}@off.local`,
          passwordHash: 'x'.repeat(60),
          firstName: '146',
          lastName: 'off',
        });
        await em.persistAndFlush(account);
        organizationId = org.id;
        // Feature 154 — the tenant shops on the stores the harness seeds.
        await bindOrganizationsToFixtureChannelsSql(em, [org.id]);
        customerAccountId = account.id;
      });
      CUSTOMER_COOKIES[BUYER_SESSION] = { customerAccountId, organizationId };

      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: buyer,
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
      });
      expect(created.statusCode, created.body).toBe(201);
      quoteRequestId = (created.json() as { data: { id: string } }).data.id;

      const orgWrite = await h.app.inject({
        method: 'PUT',
        url: orgUrl(),
        cookies: admin,
        payload: { priceProposalsAllowed: false },
      });
      expect(orgWrite.statusCode, orgWrite.body).toBe(200);
      const accountWrite = await h.app.inject({
        method: 'PUT',
        url: accountUrl(),
        cookies: admin,
        payload: { override: 'allowed' },
      });
      expect(accountWrite.statusCode, accountWrite.body).toBe(200);
    });

    afterAll(() => {
      delete CUSTOMER_COOKIES[BUYER_SESSION];
    });

    it('the four admin routes, the storefront read and /history are absent while off, and restored after', async () => {
      await expectModuleAbsent(h, 'quote_requests', {
        routes: [
          { url: orgUrl(), cookies: admin },
          { method: 'PUT', url: orgUrl(), cookies: admin, payload: { priceProposalsAllowed: false } },
          { url: accountUrl(), cookies: admin },
          { method: 'PUT', url: accountUrl(), cookies: admin, payload: { override: 'allowed' } },
          { url: STOREFRONT_URL, cookies: buyer },
          { url: historyUrl(), cookies: admin },
        ],
      });
    });

    it('keeps the stored values through the flip, and answers them once switched back on', async () => {
      const before = await policyRows();
      expect(before.org?.allowed).toBe(false);
      expect(before.account?.allowed).toBe(true);

      await withModuleOff('quote_requests', 'deactivated', async () => {
        const refused = await h.app.inject({
          method: 'PUT',
          url: orgUrl(),
          cookies: admin,
          payload: { priceProposalsAllowed: true },
        });
        expect(refused.statusCode).toBe(503);
        expect(await policyRows()).toEqual(before);
      });

      expect(await policyRows()).toEqual(before);

      const org = await h.app.inject({ method: 'GET', url: orgUrl(), cookies: admin });
      expect(org.statusCode, org.body).toBe(200);
      expect((org.json() as { data: { priceProposalsAllowed: boolean } }).data.priceProposalsAllowed).toBe(false);

      const account = await h.app.inject({ method: 'GET', url: accountUrl(), cookies: admin });
      expect(account.statusCode, account.body).toBe(200);
      expect(account.json()).toMatchObject({
        data: {
          override: 'allowed',
          organizationPriceProposalsAllowed: false,
          effectivePriceProposalsAllowed: true,
          effectiveSource: 'account',
        },
      });

      const own = await h.app.inject({ method: 'GET', url: STOREFRONT_URL, cookies: buyer });
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json()).toEqual({ data: { priceProposalsAllowed: true } });

      const history = await h.app.inject({ method: 'GET', url: historyUrl(), cookies: admin });
      expect(history.statusCode, history.body).toBe(200);
    });
  });

  /**
   * Feature 162 (`specs/162-custom-fields-value-carry/` T037; FR-005, FR-014) —
   * custom-field carry with `quote_requests` off.
   *
   * - A basket converted from a request while the module was on places an
   *   Order that carries nothing: there is no vouched quote source to carry
   *   from, so there is nothing to skip either — no system note.
   * - Opportunity → Quote Request is not attempted: CRM asks the module's
   *   presence before it reads the request, so the announcement of a request
   *   created from an Opportunity links nothing and carries nothing, and the
   *   Opportunity's history is unchanged. Nothing is replayed once back on.
   *
   * The `quote_request` carry options being hidden and retained while the module
   * is off is `custom_fields/entity-owner-presence.test.ts`' (Phase 2).
   */
  describe('feature 162 — custom-field carry while quote_requests is off', () => {
    const CUSTOM_FIELDS_API = '/api/v1/admin/custom-fields';
    const RUN = randomUUID().slice(0, 8);
    const ORDER_KEY = `cfc_${RUN}_qr_off_order`;
    const OPPORTUNITY_KEY = `cfc_${RUN}_qr_off_opportunity`;
    const created: string[] = [];
    let storedAutoCreate: unknown;

    const define = async (entityType: string, key: string, carryTo: string[]) => {
      const response = await h.app.inject({
        method: 'POST',
        url: `${CUSTOM_FIELDS_API}/definitions`,
        cookies: admin,
        payload: {
          entityType,
          key,
          label: {},
          labelDefault: key,
          valueType: 'text',
          required: false,
          sortOrder: 0,
          config: {},
          options: [],
          audience: 'internal',
          carryTo,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      created.push((response.json() as { data: { id: string } }).data.id);
    };

    const valuesOf = async (
      table: 'orders' | 'quote_requests' | 'crm_opportunities',
      id: string,
    ): Promise<Record<string, unknown>> => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select custom_field_values from "${table}" where id = ?`, [id])) as Array<{
        custom_field_values: Record<string, unknown> | null;
      }>;
      expect(rows).toHaveLength(1);
      return rows[0]!.custom_field_values ?? {};
    };

    const setValues = async (table: 'quote_requests' | 'crm_opportunities', id: string, values: Record<string, unknown>) => {
      await h
        .em()
        .getConnection()
        .execute(`update "${table}" set custom_field_values = ?::jsonb where id = ?`, [JSON.stringify(values), id]);
    };

    const carrySkipEvents = async (quoteRequestId: string): Promise<number> => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(
          `select count(*)::int as n from "quote_request_events" where quote_request_id = ? and event_type = 'custom-field-carry-skipped'`,
          [quoteRequestId],
        )) as Array<{ n: number }>;
      return rows[0]!.n;
    };

    const opportunityHistory = async (opportunityId: string): Promise<unknown[]> => {
      const response = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/crm/opportunities/${opportunityId}/history`,
        cookies: admin,
      });
      expect(response.statusCode, response.body).toBe(200);
      return (response.json() as { data: unknown[] }).data;
    };

    /** A request converted into the buyer's basket while the module is on. */
    const quoteInBasket = async (value: string) => {
      await h
        .em()
        .getConnection()
        .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
          TEST_CUSTOMER_ID,
        ]);
      const rfq = await acceptedQuoteRequest(h, { quantity: 2, agreedUnitPrice: 11.25 });
      await setValues('quote_requests', rfq.id, { [ORDER_KEY]: value });
      await convertQuoteRequestToCart(h, rfq.id);
    };

    /** A submitted request, and an Opportunity holding `value`, announced as created from it. */
    const announceCreatedFromOpportunity = async (quoteRequestId: string, opportunityId: string) =>
      whenCrmEventSettled(h, 'rfq.created_by_admin.v1', (payload) => payload['rfqId'] === quoteRequestId, async () => {
        h.eventBus.emit('rfq.created_by_admin.v1' as never, {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          rfqId: quoteRequestId,
          organizationId: TEST_ORGANIZATION_ID,
          adminUserId: TEST_ADMIN_ID,
          origin: { type: 'crm_opportunity', id: opportunityId },
        } as never);
      });

    const opportunityWithValue = async (value: string) => {
      const opportunity = await createCrmOpportunity(h, { title: `cfc ${RUN} ${value}` });
      await setValues('crm_opportunities', opportunity.id, { [OPPORTUNITY_KEY]: value });
      return opportunity;
    };

    const submittedRequest = async (): Promise<string> => {
      const rfq = await acceptedQuoteRequest(h, { quantity: 1, agreedUnitPrice: 11.25 });
      return rfq.id;
    };

    const linksOf = (quoteRequestId: string) =>
      h.em().count(CrmOpportunityLink, { documentKind: 'quote_request', documentId: quoteRequestId }, { filters: false });

    beforeAll(async () => {
      // The value in force, read and kept to write back (standing rule 7).
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select coalesce(global_value, default_value) as value from "settings" where code = ?`, [
          CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS,
        ])) as Array<{ value: unknown }>;
      if (!rows[0]) throw new Error('The setting crm.auto_create_from_quote_requests is not registered.');
      storedAutoCreate = rows[0].value;
      // A submitted request gets no Opportunity of its own: only the announced origin links one.
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, false);
      await h
        .em()
        .getConnection()
        .execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [SEED_PRODUCT_101_ID]);
      await define('order', ORDER_KEY, []);
      await define('quote_request', ORDER_KEY, ['order']);
      await define('quote_request', OPPORTUNITY_KEY, []);
      await define('opportunity', OPPORTUNITY_KEY, ['quote_request']);
    });

    afterAll(async () => {
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS, storedAutoCreate);
      for (const id of [...created].reverse()) {
        await h.app.inject({ method: 'DELETE', url: `${CUSTOM_FIELDS_API}/definitions/${id}`, cookies: admin });
      }
    });

    it('carries a request’s value into the Order placed from its basket while on — the positive control', async () => {
      const value = `on_${RUN}`;
      await quoteInBasket(value);
      const order = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
      expect((await valuesOf('orders', order.id))[ORDER_KEY]).toBe(value);
      await reactor.idle();
    });

    // Issue #167 — while off, nothing can confirm the quote's agreed prices, so
    // the basket converted from it is refused outright (fail-closed): there is
    // no Order for a value to be carried into or a note to be recorded on.
    it.each(['deactivated', 'platform-unavailable'] as const)(
      'while %s a basket converted from a request is refused, so nothing is carried or recorded',
      async (axis) => {
        await quoteInBasket(`off_${axis}_${RUN}`);
        await withModuleOff('quote_requests', axis, async () => {
          await expect(checkOutBasket(h)).rejects.toThrow(/checkOutBasket: 410 .*QUOTE_VALIDITY_ENDED/);
        });
        await reactor.idle();
      },
    );

    it('carries an Opportunity’s value into the request created from it while on — the positive control', async () => {
      const value = `on_${RUN}`;
      const opportunity = await opportunityWithValue(value);
      const quoteRequestId = await submittedRequest();
      await announceCreatedFromOpportunity(quoteRequestId, opportunity.id);
      expect(await linksOf(quoteRequestId)).toBe(1);
      expect((await valuesOf('quote_requests', quoteRequestId))[OPPORTUNITY_KEY]).toBe(value);
    });

    it.each(['deactivated', 'platform-unavailable'] as const)(
      'while %s a request announced as created from an Opportunity is neither linked nor carried into, then or afterwards',
      async (axis) => {
        const opportunity = await opportunityWithValue(`off_${axis}_${RUN}`);
        const quoteRequestId = await submittedRequest();
        const valuesBefore = await valuesOf('quote_requests', quoteRequestId);
        const historyBefore = await opportunityHistory(opportunity.id);
        await withModuleOff('quote_requests', axis, async () => {
          await announceCreatedFromOpportunity(quoteRequestId, opportunity.id);
          expect(await linksOf(quoteRequestId)).toBe(0);
        });
        await crmPlacedDocumentsHandled(h);
        expect(await linksOf(quoteRequestId)).toBe(0);
        expect(await valuesOf('quote_requests', quoteRequestId)).toEqual(valuesBefore);
        expect(await carrySkipEvents(quoteRequestId)).toBe(0);
        expect(await opportunityHistory(opportunity.id)).toEqual(historyBefore);
      },
    );
  });
  /**
   * `specs/170-organization-roles/` WP-05, T080 (FR-007, FR-025, US 8): the one
   * organization permission this module declares follows its presence. While
   * the module is off, `quote_requests.create` leaves the permission catalogue
   * and every member's effective set; a role's stored grant of it is kept; on
   * reactivation it is back in both.
   */
  describe('the quote_requests.create organization permission (170 WP-05)', () => {
    const CODE = 'quote_requests.create';
    const RUN = randomUUID().slice(0, 8);
    const MEMBER_COOKIE = `stub-170-05-off-state-member-${RUN}`;
    let grantingRoleId: string;

    beforeAll(async () => {
      const conn = h.em().getConnection();
      const accountId = randomUUID();
      // No role named: the R-28 trigger gives the account the Organization's *Member*.
      await conn.execute(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
         values (?, ?, ?, 'x', 'Off', 'State', now(), now())`,
        [accountId, TEST_ORGANIZATION_ID, `off-state-${RUN}@rfq-permission.example`],
      );
      CUSTOMER_COOKIES[MEMBER_COOKIE] = { customerAccountId: accountId, organizationId: TEST_ORGANIZATION_ID };
      grantingRoleId = await seedCustomOrganizationRole(h.em(), {
        organizationId: TEST_ORGANIZATION_ID,
        name: `Off-state RFQ ${RUN}`,
        permissions: [CODE],
      });
    });

    afterAll(() => {
      delete CUSTOMER_COOKIES[MEMBER_COOKIE];
    });

    const catalogueCodes = async (): Promise<string[]> => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/organizations/mine/permission-catalogue',
        cookies: customer,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: { groups: Array<{ permissions: Array<{ code: string }> }> } };
      return body.data.groups.flatMap((g) => g.permissions.map((p) => p.code));
    };
    const memberCodes = async (): Promise<string[]> => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/organizations/mine/role',
        cookies: { b2b_session: MEMBER_COOKIE },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { permissions: Array<{ code: string }> } }).data.permissions.map((p) => p.code);
    };
    const storedGrants = async (): Promise<string[]> => {
      const [row] = (await h.em().getConnection().execute(
        `select "permissions" from "organization_roles" where "id" = ?`,
        [grantingRoleId],
      )) as Array<{ permissions: string[] }>;
      return row!.permissions;
    };

    it('is offered and held while on — the positive control', async () => {
      expect(await catalogueCodes()).toContain(CODE);
      expect(await memberCodes()).toContain(CODE);
    });

    it.each(['deactivated', 'platform-unavailable'] as const)(
      'while %s it leaves the catalogue and the effective set, keeps the stored grant, and is back after',
      async (axis) => {
        await withModuleOff('quote_requests', axis, async () => {
          expect(await catalogueCodes()).not.toContain(CODE);
          expect(await memberCodes()).not.toContain(CODE);
          expect(await storedGrants()).toContain(CODE);
        });
        expect(await catalogueCodes()).toContain(CODE);
        expect(await memberCodes()).toContain(CODE);
        expect(await storedGrants()).toContain(CODE);
      },
    );
  });
});

