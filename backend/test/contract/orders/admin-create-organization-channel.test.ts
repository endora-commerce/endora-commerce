import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * Issue #515 — `POST /api/v1/admin/orders` and its `/preview` place an order
 * for a customer only on one of the customer's Organization's **active
 * assigned** channels: the rule the on-behalf quote request has followed since
 * feature 163. Before it the create checked only that the channel existed, so an
 * operator could place an order on a channel the Organization was not assigned
 * to, or on an inactive one.
 *
 * An unassigned, an inactive and a nonexistent channel get one answer — `422
 * ORDER_SALES_CHANNEL_NOT_ALLOWED` — and nothing is written.
 *
 * **There is no defaulted channel here.** The issue names "a defaulted channel
 * the Organization is not assigned to" for the quote request, whose
 * `salesChannelId` is optional and falls back to the admin-resolved default.
 * The order's `salesChannelId` is required by `adminCreateOrderRequestSchema`,
 * so an omitted one is a `400 VALIDATION_FAILED` and never a fallback — pinned
 * below, so a later optional field has to come with its own check.
 */
describe('POST /api/v1/admin/orders — the Organization\'s active channels only (#515)', () => {
  let h: BackendServerHandle;
  let defaultId: string;
  let unassignedId: string;
  let inactiveId: string;

  const ADMIN = { b2b_session: 'stub-admin-session' };

  const channel = (prefix: string, active: boolean) =>
    h.em().create(SalesChannel, {
      code: `${prefix}-${randomUUID().slice(0, 8)}`,
      name: { 'en-US': `#515 ${prefix}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active,
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    defaultId = await systemDefaultSalesChannelId(em);
    const unassigned = channel('order-515-unassigned', true);
    const inactive = channel('order-515-inactive', false);
    await em.persistAndFlush([unassigned, inactive]);
    unassignedId = unassigned.id;
    inactiveId = inactive.id;
    // Both sell the product, so only the Organization's assignment separates
    // them from the channel the control case is created on.
    const conn = em.getConnection();
    for (const id of [unassignedId, inactiveId]) {
      await conn.execute(
        'insert into sales_channel_products (sales_channel_id, product_id) values (?,?) on conflict do nothing',
        [id, SEED_PRODUCT_101_ID],
      );
    }
    // Assigned — but inactive. The unassigned channel gets no bridge row.
    await conn.execute(
      'insert into sales_channel_organizations (sales_channel_id, organization_id) values (?,?) on conflict do nothing',
      [inactiveId, TEST_ORGANIZATION_ID],
    );
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const payload = (salesChannelId: string | undefined) => ({
    customerAccountId: TEST_CUSTOMER_ID,
    ...(salesChannelId === undefined ? {} : { salesChannelId }),
    items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
  });

  const create = (salesChannelId: string | undefined) =>
    h.app.inject({ method: 'POST', url: '/api/v1/admin/orders', cookies: ADMIN, payload: payload(salesChannelId) });

  const preview = (salesChannelId: string) => {
    const { deliveryAddressId: _d, billingAddressId: _b, ...rest } = payload(salesChannelId);
    return h.app.inject({ method: 'POST', url: '/api/v1/admin/orders/preview', cookies: ADMIN, payload: rest });
  };

  const codeOf = (body: string) => (JSON.parse(body) as { error?: { code?: string } }).error?.code;

  const refusals: Array<[string, () => string]> = [
    ['a channel the Organization is not assigned to', () => unassignedId],
    ['an inactive channel the Organization is assigned to', () => inactiveId],
    ['an id naming no channel', () => '00000000-0000-4000-8000-00000000dead'],
  ];

  it.each(refusals)('create refuses %s with 422 ORDER_SALES_CHANNEL_NOT_ALLOWED, writing nothing', async (_label, id) => {
    const em = h.em();
    const before = await em.count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID });

    const res = await create(id());

    expect(res.statusCode, res.body).toBe(422);
    expect(codeOf(res.body)).toBe(ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED);
    expect(await h.em().count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID })).toBe(before);
  });

  it.each(refusals)('preview refuses %s with the same 422', async (_label, id) => {
    const res = await preview(id());

    expect(res.statusCode, res.body).toBe(422);
    expect(codeOf(res.body)).toBe(ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED);
  });

  it('refuses an omitted salesChannelId with 400 VALIDATION_FAILED — no channel is defaulted', async () => {
    const em = h.em();
    const before = await em.count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID });

    const res = await create(undefined);

    expect(res.statusCode, res.body).toBe(400);
    expect(codeOf(res.body)).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(await h.em().count(Order, { placedByCustomerAccountId: TEST_CUSTOMER_ID })).toBe(before);
  });

  it('previews and creates on an active channel the Organization is assigned to', async () => {
    const priced = await preview(defaultId);
    expect(priced.statusCode, priced.body).toBe(200);

    const res = await create(defaultId);

    expect(res.statusCode, res.body).toBe(201);
    const order = await h.em().findOne(Order, { id: (res.json() as { data: { id: string } }).data.id });
    expect(order?.salesChannelId).toBe(defaultId);
  });
});
