import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  seedSuspendedOrganization,
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
  TEST_SUSPENDED_CUSTOMER_ID,
  TEST_SUSPENDED_ORGANIZATION_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { StockLevel } from '../../helpers/package-entities.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';
import { ApiKey } from '../../helpers/package-entities.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 062 / T020 — `POST /api/v1/external/orders` + the orders half of the
 * SC-002 isolation matrix (contracts/orders-api-key-intake.md).
 *
 *  - happy path 201: order for the bound org + service account, org pricing,
 *    reserved stock, existing serialized shape;
 *  - missing `Idempotency-Key` ⇒ 422 IDEMPOTENCY_KEY_REQUIRED;
 *  - foreign SKU ⇒ 422 per-line SKU_NOT_IN_ASSORTMENT, nothing persisted;
 *  - unresolvable price ⇒ 422 per-line PRICE_UNAVAILABLE;
 *  - suspended org ⇒ 423 (storefront semantics);
 *  - insufficient stock ⇒ 409 STOCK_UNAVAILABLE;
 *  - orders:read-only key ⇒ 403 out-of-scope; unbound ⇒ 403 API_KEY_NOT_BOUND;
 *    anonymous ⇒ 401; every response no-store;
 *  - GET /api/v1/external/orders(/:id): bound-org visibility, foreign id ⇒ 404.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const NO_STORE = 'private, no-store';
const LEGACY_ORDERS_TOKEN = 'sk_live_legacy-unbound-orders-intake-062';

interface SerializedOrder {
  id: string;
  businessId: string;
  organizationId: string;
  placedByCustomerAccountId: string;
  salesChannelId: string;
  status: string;
  customerNote: string | null;
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  total: number;
  currency: string;
}

describe('POST /api/v1/external/orders — contract (062 / T020)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let boundToken: string;
  let readOnlyToken: string;
  let suspendedToken: string;
  let happyOrderId: string;

  const basePayload = () => ({
    lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 2 }],
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
    customerReference: 'PO-2026-0042',
  });

  const post = (
    token: string | null,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      payload,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey !== undefined ? { 'idempotency-key': idempotencyKey } : {}),
      },
    });

  const mint = async (payload: Record<string, unknown>): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { bearerToken: string } }).data.bearerToken;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedSuspendedOrganization(h.em());
    const em = h.em();

    const channel = em.create(SalesChannel, {
      code: 'ext-orders',
      name: { 'en-US': 'External orders channel' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    await em.persistAndFlush(channel);
    channelId = channel.id;
    await h.salesChannels.cache.invalidate('ext-orders');

    // A product with no resolvable price anywhere (no bracket, no default).
    const unpriced = em.create(Product, {
      sku: 'EXT-NOPRICE-001',
      slug: 'ext-noprice-product',
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Unpriceable product' },
      description: { 'en-US': '' },
      visibility: 'public',
      manageStock: false,
      attributeValues: {},
    });
    await em.persistAndFlush(unpriced);

    // Publish product 101 + the unpriced product on the bound channel.
    await em.getConnection().execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?)`,
      [channelId, SEED_PRODUCT_101_ID, channelId, unpriced.id],
    );

    // Org-targeted price list — the intake must charge the ORG price (100),
    // not the channel default (19.99).
    const priceLists = new PriceListService(() => h.em(), undefined, undefined, undefined, neighbourReadPorts(() => h.em()));
    const list = await priceLists.create({
      name: 'Org A intake base',
      type: 'base',
      applicationRule: {
        kind: 'criterion',
        type: 'organization',
        values: [TEST_ORGANIZATION_ID],
      },
    });
    await priceLists.addProduct(list.id, SEED_PRODUCT_101_ID);
    await priceLists.replaceBrackets(list.id, SEED_PRODUCT_101_ID, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '100.00' }],
    });
    await priceLists.activate(list.id);

    boundToken = await mint({
      name: 'Intake key A',
      scopes: ['orders:read', 'orders:write'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: channelId,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    readOnlyToken = await mint({
      name: 'Read-only key',
      scopes: ['orders:read'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: channelId,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    suspendedToken = await mint({
      name: 'Suspended org key',
      scopes: ['orders:read', 'orders:write'],
      binding: {
        organizationId: TEST_SUSPENDED_ORGANIZATION_ID,
        salesChannelId: channelId,
        customerAccountId: TEST_SUSPENDED_CUSTOMER_ID,
      },
    });

    // Legacy unbound row with an orders scope (creation refuses this shape
    // today — B1); the mounted surface must fail closed API_KEY_NOT_BOUND.
    const legacy = em.create(ApiKey, {
      name: 'Legacy orders key',
      keyHash: createHash('sha256').update(LEGACY_ORDERS_TOKEN, 'utf8').digest('hex'),
      lastFour: LEGACY_ORDERS_TOKEN.slice(-4),
      scopes: ['orders:write', 'orders:read'],
    });
    await em.persistAndFlush(legacy);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('anonymous ⇒ 401, no-store', async () => {
    const res = await post(null, basePayload(), 'anon-1');
    expect(res.statusCode).toBe(401);
    expect(res.headers['cache-control']).toBe(NO_STORE);
  });

  it('unbound key with orders scope ⇒ 403 API_KEY_NOT_BOUND', async () => {
    const res = await post(LEGACY_ORDERS_TOKEN, basePayload(), 'legacy-1');
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.API_KEY_NOT_BOUND,
    );
    expect(res.headers['cache-control']).toBe(NO_STORE);
  });

  it('orders:read-only key ⇒ 403 API_KEY_OUT_OF_SCOPE on POST', async () => {
    const res = await post(readOnlyToken, basePayload(), 'readonly-1');
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.API_KEY_OUT_OF_SCOPE,
    );
  });

  it('missing Idempotency-Key ⇒ 422 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const res = await post(boundToken, basePayload());
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
    );
  });

  it('happy path 201 — bound org + service account + org pricing + reserved stock', async () => {
    // Issue #159 — `?? 0` here made the reservation delta below pass whether or
    // not the seeded stock row existed: no row and no reservation both read as
    // zero. The harness seeds it, so absence is a broken fixture, not a datum.
    const stockBefore = await h
      .em()
      .findOneOrFail(StockLevel, { productId: SEED_PRODUCT_101_ID });
    const reservedBefore = stockBefore.reserved;

    const res = await post(boundToken, basePayload(), `happy-${randomUUID()}`);
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe(NO_STORE);
    const order = (res.json() as { data: SerializedOrder }).data;
    happyOrderId = order.id;

    expect(order.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(order.placedByCustomerAccountId).toBe(TEST_CUSTOMER_ID);
    expect(order.salesChannelId).toBe(channelId);
    expect(order.customerNote).toBe('PO-2026-0042');
    expect(typeof order.businessId).toBe('string');
    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.productId).toBe(SEED_PRODUCT_101_ID);
    expect(order.items[0]!.quantity).toBe(2);
    // Org-effective price from the org's price list, not the channel default.
    expect(order.items[0]!.unitPrice).toBe(100);
    expect(order.currency).toBe('PLN');

    const em = h.em();
    em.clear();
    const stockAfter = await em.findOne(StockLevel, { productId: SEED_PRODUCT_101_ID });
    expect(stockAfter!.reserved).toBe(reservedBefore + 2);
  });

  it('foreign / unknown SKU ⇒ whole-order 422 with per-line SKU_NOT_IN_ASSORTMENT; nothing persisted', async () => {
    const ordersBefore = await h.em().count(Order, {});
    const res = await post(
      boundToken,
      {
        ...basePayload(),
        lines: [
          { sku: 'EXAMPLE-SIMPLE-001', quantity: 1 },
          // Exists in the catalog but is NOT published on the bound channel.
          { sku: 'EXAMPLE-BLUE-002', quantity: 1 },
          { sku: 'NO-SUCH-SKU', quantity: 3 },
        ],
      },
      `sku-miss-${randomUUID()}`,
    );
    expect(res.statusCode).toBe(422);
    const body = res.json() as {
      error: { code: string; details: Array<{ path: string; issue: string }> };
    };
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    const issues = body.error.details;
    expect(issues.some((d) => d.path === 'lines.1.sku' && d.issue === ERROR_CODES.SKU_NOT_IN_ASSORTMENT)).toBe(true);
    expect(issues.some((d) => d.path === 'lines.2.sku' && d.issue === ERROR_CODES.SKU_NOT_IN_ASSORTMENT)).toBe(true);
    // The in-assortment line is not reported.
    expect(issues.some((d) => d.path === 'lines.0.sku')).toBe(false);
    const ordersAfter = await h.em().count(Order, {});
    expect(ordersAfter).toBe(ordersBefore);
  });

  it('unresolvable price ⇒ 422 per-line PRICE_UNAVAILABLE', async () => {
    const res = await post(
      boundToken,
      { ...basePayload(), lines: [{ sku: 'EXT-NOPRICE-001', quantity: 1 }] },
      `noprice-${randomUUID()}`,
    );
    expect(res.statusCode).toBe(422);
    const body = res.json() as {
      error: { code: string; details: Array<{ path: string; issue: string }> };
    };
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(
      body.error.details.some(
        (d) => d.path === 'lines.0.sku' && d.issue === ERROR_CODES.PRICE_UNAVAILABLE,
      ),
    ).toBe(true);
  });

  it('suspended org ⇒ 423 with the storefront error code', async () => {
    const res = await post(
      suspendedToken,
      {
        lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 1 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddress: {
          recipientName: 'Suspended Recipient',
          street: 'ul. Wstrzymanych 2',
          city: 'Warszawa',
          postalCode: '00-701',
          country: 'PL',
        },
        billingAddress: {
          recipientName: 'Suspended Recipient',
          street: 'ul. Wstrzymanych 2',
          city: 'Warszawa',
          postalCode: '00-701',
          country: 'PL',
        },
      },
      `suspended-${randomUUID()}`,
    );
    expect(res.statusCode).toBe(423);
    // `FORBIDDEN` + `organization_cannot_transact`, which is what this feature's
    // own contract specifies (`specs/062-distributor-api/contracts/
    // orders-api-key-intake.md` error vocabulary) and what the published
    // `docs/docs/integrations/api-access.md` documents to distributors. SC-009
    // requires this to be identical to what the Organization's own buyer gets,
    // and since T141 both paths are fed from the same container binding rather
    // than from two root arguments that happened to agree.
    //
    // This is one of the two assertions issue #63 is about — it pinned
    // `ORGANIZATION_SUSPENDED`, a code production does not emit on a gated
    // route, and could only pass because the harness had never wired the gate.
    // Corrected in 633538a9 (072 T141), left here as the record of which code
    // the surface really answers with.
    const body = res.json() as {
      error: { code: string; details?: { code?: string } };
    };
    expect(body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(body.error.details?.code).toBe('organization_cannot_transact');
  });

  it('insufficient stock ⇒ 409 STOCK_UNAVAILABLE (existing placement semantics)', async () => {
    const res = await post(
      boundToken,
      { ...basePayload(), lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 100000 }] },
      `stock-${randomUUID()}`,
    );
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.STOCK_UNAVAILABLE,
    );
  });

  // --- Reads (T024 + SC-002 orders half) --------------------------------

  it('GET /api/v1/external/orders lists the bound org orders only, no-store', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/orders',
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(NO_STORE);
    const body = res.json() as { data: SerializedOrder[] };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.every((o) => o.organizationId === TEST_ORGANIZATION_ID)).toBe(true);
    expect(body.data.some((o) => o.id === happyOrderId)).toBe(true);
  });

  it('GET /api/v1/external/orders/:id returns the detail for an own order', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/external/orders/${happyOrderId}`,
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(res.statusCode).toBe(200);
    const order = (res.json() as { data: SerializedOrder }).data;
    expect(order.id).toBe(happyOrderId);
    expect(order.organizationId).toBe(TEST_ORGANIZATION_ID);
  });

  it("key of another org fetching org A's order id ⇒ 404 (no existence leak)", async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/external/orders/${happyOrderId}`,
      headers: { authorization: `Bearer ${suspendedToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe(NO_STORE);
  });

  it('GET with an unbound key ⇒ 403 API_KEY_NOT_BOUND; anonymous ⇒ 401', async () => {
    const unbound = await h.app.inject({
      method: 'GET',
      url: '/api/v1/external/orders',
      headers: { authorization: `Bearer ${LEGACY_ORDERS_TOKEN}` },
    });
    expect(unbound.statusCode).toBe(403);
    expect((unbound.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.API_KEY_NOT_BOUND,
    );
    const anon = await h.app.inject({ method: 'GET', url: '/api/v1/external/orders' });
    expect(anon.statusCode).toBe(401);
  });
});
