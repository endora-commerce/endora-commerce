import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { adminOrdersListResponseSchema, orderSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const DELIVERY_ADDRESS_ID = '00000000-0000-4000-8000-0000000000d1';
const BILLING_ADDRESS_ID = '00000000-0000-4000-8000-0000000000d2';
const DELIVERY_METHOD_ID = '00000000-0000-4000-8000-0000000000e1';

const CUSTOMER = { cookies: { b2b_session: 'stub-customer-session' } };
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/**
 * Every disagreement between a response and a published schema, as
 * `path: message` lines. Asserted against `[]` so a failure names all the
 * fields that drifted at once rather than the first one zod met.
 */
function disagreements(schema: z.ZodTypeAny, value: unknown): string[] {
  const parsed = schema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/**
 * The order routes answer what `@endora-commerce/contracts` publishes
 * (Constitution II).
 *
 * The serialiser behind these routes returns `Record<string, unknown>`, so the
 * compiler holds it to nothing and the published `orderSchema` could drift away
 * from the wire without any test noticing — which it had: an address snapshot
 * answers `phone: null`, and the schema said "a string, or absent". A consumer
 * that parsed an order response with the schema it was given was refused.
 *
 * So each route that claims the order shape is driven through the real HTTP
 * stack here and its reply is parsed with the published schema. A new field
 * the serialiser emits with a type the schema does not allow, or a required
 * field it stops emitting, reds this file.
 */
describe('order responses parse with the published order schemas', () => {
  let h: BackendServerHandle;
  let orderId: string;
  let placed: unknown;
  let onBehalfOrderId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      ...CUSTOMER,
      payload: {
        deliveryAddressId: DELIVERY_ADDRESS_ID,
        billingAddressId: BILLING_ADDRESS_ID,
        deliveryMethodId: DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });
    expect(res.statusCode).toBe(201);
    placed = (res.json() as { data: unknown }).data;
    orderId = (placed as { id: string }).id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('POST /api/v1/orders — the placement reply', () => {
    expect(disagreements(orderSchema, placed)).toEqual([]);
  });

  it('GET /api/v1/orders/:id — the buyer detail', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, ...CUSTOMER });
    expect(res.statusCode).toBe(200);
    expect(disagreements(orderSchema, (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('GET /api/v1/orders — every item of the buyer list', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/orders', ...CUSTOMER });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { data: Array<{ id: string }> }).data;
    expect(items.some((o) => o.id === orderId)).toBe(true);
    expect(items.flatMap((o) => disagreements(orderSchema, o))).toEqual([]);
  });

  it('GET /api/v1/admin/orders/:id — the admin detail', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${orderId}`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    expect(disagreements(orderSchema, (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('GET /api/v1/admin/orders — the admin list and its rows', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders', ...ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.some((o) => o.id === orderId)).toBe(true);
    expect(disagreements(adminOrdersListResponseSchema, body)).toEqual([]);
  });

  it('POST /api/v1/admin/orders — an order created on behalf of a customer', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      ...ADMIN,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: SALES_CHANNEL_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
        deliveryMethodId: DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddress: {
          recipientName: 'Inline Recipient',
          street: '1 Inline Street',
          city: 'Warsaw',
          postalCode: '00-001',
          country: 'PL',
          saveToAddressBook: false,
        },
        billingAddressId: BILLING_ADDRESS_ID,
      },
    });
    expect(res.statusCode).toBe(201);
    const created = (res.json() as { data: { id: string } }).data;
    onBehalfOrderId = created.id;
    expect(disagreements(orderSchema, created)).toEqual([]);
  });

  it('PATCH /api/v1/admin/orders/:id/custom-fields — the reply to a custom-field write', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/orders/${orderId}/custom-fields`,
      ...ADMIN,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(disagreements(orderSchema, (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('POST /api/v1/admin/orders/:id/payment-status — the reply to a payment transition', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${onBehalfOrderId}/payment-status`,
      ...ADMIN,
      payload: { to: 'paid' },
    });
    expect(res.statusCode).toBe(200);
    expect(disagreements(orderSchema, (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('POST /api/v1/admin/orders/:id/status — the reply to a lifecycle transition', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${onBehalfOrderId}/status`,
      ...ADMIN,
      payload: { to: 'cancelled', reason: 'schema conformance' },
    });
    expect(res.statusCode).toBe(200);
    expect(disagreements(orderSchema, (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('POST /api/v1/orders/:id/cancel — the reply to a buyer cancellation', async () => {
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, ...CUSTOMER });
    expect(res.statusCode).toBe(200);
    expect(disagreements(orderSchema, (res.json() as { data: unknown }).data)).toEqual([]);
  });
});
