import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminOrderDetailSchema,
  adminOrdersListResponseSchema,
  orderSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const DELIVERY_ADDRESS_ID = '00000000-0000-4000-8000-0000000000d1';
const BILLING_ADDRESS_ID = '00000000-0000-4000-8000-0000000000d2';
const DELIVERY_METHOD_ID = '00000000-0000-4000-8000-0000000000e1';

const CUSTOMER = { cookies: { b2b_session: 'stub-customer-session' } };
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/** Strict copies: a key a route answers that the contract does not declare fails. */
const strictOrder = deepStrict(orderSchema);
const strictAdminOrderDetail = deepStrict(adminOrderDetailSchema);
const strictAdminOrdersList = deepStrict(adminOrdersListResponseSchema);

/**
 * The order routes answer what `@endora-commerce/contracts` publishes, and
 * nothing beside it (Constitution II).
 *
 * Each route that claims the order shape is driven through the real HTTP stack
 * here and its reply is parsed with a **strict copy** of the published schema.
 * Two different drifts red this file:
 *
 * - a field the schema declares that the reply carries with a type it does not
 *   allow, or does not carry at all — which is how an address snapshot's
 *   `phone: null` went unnoticed against "a string, or absent";
 * - a key the reply carries that the schema does not declare (issue #128). The
 *   published schemas are non-strict, so parsing with them drops such a key
 *   silently: `customFieldValues` was on every order reply, and `organization`
 *   and `customer` on the admin detail, with no contract promising any of them.
 *
 * The second is also what holds the audience of a key. `organization` and
 * `customer` are declared by `adminOrderDetailSchema` only, so the buyer-facing
 * replies below — parsed with the strict `orderSchema` — red the moment either
 * appears on one of them; `test/contract/orders/external-intake.test.ts` holds
 * the external surface the same way.
 *
 * The serialiser is typed against the contract since the same issue, so the
 * compiler now refuses most of this before a test runs. What it cannot see is
 * the JSON the serialiser passes through from a stored column (the address,
 * method and line snapshots, `nextAction`), which is typed by assertion — that
 * part is still held here and nowhere else.
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
    expect(disagreements(strictOrder, placed)).toEqual([]);
    // Always emitted, `{}` when the order has none — the contract's default
    // only describes what a consumer may assume of an older reply.
    expect((placed as { customFieldValues?: unknown }).customFieldValues).toEqual({});
  });

  it('GET /api/v1/orders/:id — the buyer detail', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, ...CUSTOMER });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictOrder, (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('GET /api/v1/orders — every item of the buyer list', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/orders', ...CUSTOMER });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { data: Array<{ id: string }> }).data;
    expect(items.some((o) => o.id === orderId)).toBe(true);
    expect(items.flatMap((o) => disagreements(strictOrder, o))).toEqual([]);
  });

  it('GET /api/v1/admin/orders/:id — the admin detail', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${orderId}`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    const detail = (res.json() as { data: Record<string, unknown> }).data;
    expect(disagreements(strictAdminOrderDetail, detail)).toEqual([]);
    // The enrichment is there, not merely allowed to be: a `null` on both would
    // parse and prove nothing about the two objects' own keys.
    expect(detail.organization).toMatchObject({ id: TEST_ORGANIZATION_ID });
    expect(detail.customer).toMatchObject({ id: TEST_CUSTOMER_ID });
  });

  it('GET /api/v1/admin/orders — the admin list and its rows', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/orders', ...ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.some((o) => o.id === orderId)).toBe(true);
    expect(disagreements(strictAdminOrdersList, body)).toEqual([]);
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
    expect(disagreements(strictOrder, created)).toEqual([]);
  });

  it('PATCH /api/v1/admin/orders/:id/custom-fields — the reply to a custom-field write', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/orders/${orderId}/custom-fields`,
      ...ADMIN,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictOrder, (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('POST /api/v1/admin/orders/:id/payment-status — the reply to a payment transition', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${onBehalfOrderId}/payment-status`,
      ...ADMIN,
      payload: { to: 'paid' },
    });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictOrder, (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('POST /api/v1/admin/orders/:id/status — the reply to a lifecycle transition', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${onBehalfOrderId}/status`,
      ...ADMIN,
      payload: { to: 'cancelled', reason: 'schema conformance' },
    });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictOrder, (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('POST /api/v1/orders/:id/cancel — the reply to a buyer cancellation', async () => {
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, ...CUSTOMER });
    expect(res.statusCode).toBe(200);
    expect(disagreements(strictOrder, (res.json() as { data: unknown }).data)).toEqual([]);
  });
});
