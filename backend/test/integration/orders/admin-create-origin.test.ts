import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };

/**
 * The opaque `origin` of an admin-created Order
 * (`specs/143-crm-sales-opportunities/contracts/foreign-module-changes.md` §B).
 *
 * `orders` validates its shape, echoes it on `order.created.v1` and does
 * nothing else with it: it is not stored, not returned and not branched on.
 * Only the admin create request may carry it — the storefront's placement has
 * no such field.
 */
describe('orders — the origin of an admin-created order', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const body = (extra: Record<string, unknown> = {}) => ({
    customerAccountId: TEST_CUSTOMER_ID,
    salesChannelId: SALES_CHANNEL_ID,
    items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
    ...extra,
  });

  /** Run `act` and answer every `order.created.v1` payload emitted meanwhile. */
  const createdEvents = async <T>(act: () => Promise<T>) => {
    const events: Array<Record<string, unknown>> = [];
    const off = h.eventBus.on('order.created.v1' as never, (payload: unknown) => {
      events.push(payload as Record<string, unknown>);
    });
    try {
      return { result: await act(), events };
    } finally {
      off();
    }
  };

  const createAsAdmin = (extra: Record<string, unknown> = {}) =>
    h.app.inject({ method: 'POST', url: '/api/v1/admin/orders', cookies: ADMIN, payload: body(extra) });

  it('echoes the origin of the admin request on order.created.v1, exactly once', async () => {
    const origin = { type: 'some_other_module_thing', id: randomUUID() };
    const { result, events } = await createdEvents(() => createAsAdmin({ origin }));
    expect(result.statusCode, result.body).toBe(201);
    const order = (result.json() as { data: { id: string } }).data;

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ orderId: order.id, organizationId: TEST_ORGANIZATION_ID, origin });
  });

  it('emits no origin key at all when the request carried none', async () => {
    const { result, events } = await createdEvents(() => createAsAdmin());
    expect(result.statusCode, result.body).toBe(201);

    expect(events).toHaveLength(1);
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(['eventId', 'occurredAt', 'orderId', 'organizationId']);
  });

  it('answers the same response with and without an origin — it is not stored and not returned', async () => {
    const plain = await createAsAdmin();
    const withOrigin = await createAsAdmin({ origin: { type: 'crm_opportunity', id: randomUUID() } });
    expect(plain.statusCode, plain.body).toBe(201);
    expect(withOrigin.statusCode, withOrigin.body).toBe(201);

    const plainData = (plain.json() as { data: Record<string, unknown> }).data;
    const originData = (withOrigin.json() as { data: Record<string, unknown> }).data;
    expect(Object.keys(originData).sort()).toEqual(Object.keys(plainData).sort());
    expect(originData).not.toHaveProperty('origin');
    expect(JSON.stringify(originData)).not.toContain('crm_opportunity');
  });

  it.each([
    ['an id that is not a uuid', { type: 'crm_opportunity', id: 'not-a-uuid' }],
    ['a missing id', { type: 'crm_opportunity' }],
    ['an empty type', { type: '', id: randomUUID() }],
    ['a type that is not an identifier', { type: 'CRM Opportunity!', id: randomUUID() }],
    ['an unknown key', { type: 'crm_opportunity', id: randomUUID(), organizationId: randomUUID() }],
    ['a string', 'crm_opportunity'],
  ])('refuses %s and creates nothing', async (_label, origin) => {
    const { result, events } = await createdEvents(() => createAsAdmin({ origin }));
    // The platform's answer to a body its schema refuses.
    expect(result.statusCode, result.body).toBe(400);
    expect((result.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    expect(events).toEqual([]);
  });

  it('a storefront placement cannot set it: an origin smuggled into the body never reaches the event', async () => {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: CUSTOMER,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });
    expect(added.statusCode, added.body).toBe(200);

    const { result, events } = await createdEvents(() =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: CUSTOMER,
        payload: {
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          origin: { type: 'crm_opportunity', id: randomUUID() },
        },
      }),
    );
    expect(result.statusCode, result.body).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('origin');
  });
});
