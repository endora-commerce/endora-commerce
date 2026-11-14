import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart, Order } from '../../helpers/package-entities.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
  topUpStock,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { seedOtherTestCustomer } from '../../helpers/seed-organizations.js';
import {
  acceptedQuoteRequest,
  checkOutBasket,
  convertQuoteRequestToCart,
  whenOrderCreatedSettled,
} from '../../helpers/quote-conversion.js';

/**
 * Quote Request → Order custom-field carry at placement
 * (`specs/162-custom-fields-value-carry/` US1; FR-007 – FR-010a, FR-012 – FR-015;
 * research R-7, R-8).
 *
 * Inside placement's transaction, on the vouched quote source: each value the
 * request's definition carries to Orders goes into the new Order's empty field.
 * A value that cannot be carried never fails the checkout — it is named in one
 * author-less, internal, non-notifying system note in the Order's comments.
 */
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const OTHER_ORG_CUSTOMER = { b2b_session: 'stub-customer-session-other-org' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cfc_${RUN}_${name}`;

const option = (value: string, sortOrder = 0) => ({
  value,
  label: {},
  labelDefault: value,
  isDefault: false,
  sortOrder,
});

interface Pair {
  key: string;
  quoteRequestDefinitionId: string;
  orderDefinition: { id: string; options: Array<{ id: string; value: string }> };
}

interface AdminComment {
  id: string;
  authorAdminUserId: string | null;
  authorCustomerAccountId: string | null;
  isCustomerVisible: boolean;
  notifyCustomer: boolean;
  systemNote: { kind: string; source: Record<string, unknown>; skipped: Array<{ key: string; reason: string }> } | null;
}

describe('orders — custom-field values carried from the quote request at placement', () => {
  let h: BackendServerHandle;
  const mailer = new InMemoryMailer();
  const created: string[] = [];

  const define = async (entityType: string, key: string, extra: Record<string, unknown>) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: ADMIN,
      payload: {
        entityType,
        key,
        label: {},
        labelDefault: key,
        valueType: 'select',
        required: false,
        sortOrder: 0,
        config: {},
        options: [option('fair'), option('web', 1)],
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const data = (response.json() as { data: { id: string; options: Array<{ id: string; value: string }> } }).data;
    created.push(data.id);
    return data;
  };

  /** A Quote Request field and the same-key Order field, both `select` of `fair` and `web`. */
  const pair = async (name: string, carry = true): Promise<Pair> => {
    const key = fixtureKey(name);
    const orderDefinition = await define('order', key, {});
    const quoteRequestDefinition = await define('quote_request', key, { carryTo: carry ? ['order'] : [] });
    return { key, quoteRequestDefinitionId: quoteRequestDefinition.id, orderDefinition };
  };

  const setQuoteValues = async (quoteRequestId: string, values: Record<string, unknown>) => {
    await h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set custom_field_values = ?::jsonb where id = ?`, [
        JSON.stringify(values),
        quoteRequestId,
      ]);
  };

  const orderValues = async (orderId: string): Promise<Record<string, unknown>> => {
    const em = h.em();
    em.clear();
    return (await em.findOneOrFail(Order, { id: orderId }, { filters: false })).customFieldValues ?? {};
  };

  const adminComments = async (orderId: string): Promise<AdminComment[]> => {
    const response = await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${orderId}/comments`, cookies: ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: AdminComment[] }).data;
  };

  const buyerComments = async (orderId: string): Promise<unknown[]> => {
    const response = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}/comments`, cookies: CUSTOMER });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: unknown[] }).data;
  };

  /** An accepted request holding `values`, converted into the buyer's basket. */
  const quoteInBasket = async (values: Record<string, unknown>): Promise<string> => {
    const rfq = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
    await setQuoteValues(rfq.id, values);
    await convertQuoteRequestToCart(h, rfq.id);
    return rfq.id;
  };

  const place = () => whenOrderCreatedSettled(h, () => checkOutBasket(h));

  const forgeBasketSource = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
    cart.sourceQuoteRequestId = quoteRequestId;
    await em.flush();
  };

  const addToBasket = async (productId: string) => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: CUSTOMER,
      payload: { productId, quantity: 1 },
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    await topUpStock(h.em(), [SEED_PRODUCT_101_ID]);
    await seedOtherTestCustomer(h.em());
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
    for (const id of created.reverse()) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('carries the request’s value into the new Order (US1-1)', async () => {
    const { key } = await pair('carried');
    await quoteInBasket({ [key]: 'fair' });
    const placed = await place();
    expect((await orderValues(placed.id))[key]).toBe('fair');
    expect((await adminComments(placed.id)).filter((c) => c.systemNote !== null)).toEqual([]);
  });

  it('carries nothing while the carry option is off (US1-2)', async () => {
    const { key } = await pair('off', false);
    await quoteInBasket({ [key]: 'fair' });
    const placed = await place();
    expect(Object.hasOwn(await orderValues(placed.id), key)).toBe(false);
  });

  it('carries nothing from a request of another Organization the basket names (US1-3, FR-012)', async () => {
    const { key } = await pair('foreign');
    const foreign = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 }, OTHER_ORG_CUSTOMER);
    await setQuoteValues(foreign.id, { [key]: 'fair' });
    await quoteInBasket({});
    await forgeBasketSource(foreign.id);
    const placed = await place();
    expect(Object.hasOwn(await orderValues(placed.id), key)).toBe(false);
  });

  it('carries nothing from a request already ordered (US1-3)', async () => {
    const { key } = await pair('ordered');
    const quoteRequestId = await quoteInBasket({ [key]: 'fair' });
    const first = await place();
    expect((await orderValues(first.id))[key]).toBe('fair');
    await addToBasket(SEED_PRODUCT_101_ID);
    await forgeBasketSource(quoteRequestId);
    const second = await place();
    expect(Object.hasOwn(await orderValues(second.id), key)).toBe(false);
  });

  it('places the Order and records one internal system note when the value is no longer valid (US1-4)', async () => {
    const { key, orderDefinition } = await pair('invalid');
    await quoteInBasket({ [key]: 'web' });
    const web = orderDefinition.options.find((o) => o.value === 'web')!;
    const removed = await h.app.inject({
      method: 'DELETE',
      url: `${API}/definitions/${orderDefinition.id}/options/${web.id}`,
      cookies: ADMIN,
    });
    expect(removed.statusCode, removed.body).toBe(204);

    const sentBefore = mailer.sent.length;
    const placed = await place();
    expect(Object.hasOwn(await orderValues(placed.id), key)).toBe(false);

    const notes = (await adminComments(placed.id)).filter((c) => c.systemNote !== null);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      authorAdminUserId: null,
      authorCustomerAccountId: null,
      isCustomerVisible: false,
      notifyCustomer: false,
    });
    expect(notes[0]!.systemNote).toMatchObject({
      kind: 'custom_field_carry_skipped',
      source: { entityType: 'quote_request' },
      skipped: [{ key, reason: 'value_invalid' }],
    });
    expect(await buyerComments(placed.id)).toEqual([]);
    const mailed = mailer.sent.slice(sentBefore);
    for (const message of mailed) {
      expect(`${message.subject ?? ''} ${message.html ?? ''} ${message.text ?? ''}`).not.toContain(key);
    }
  });

  it('skips an internal value into a field that became customer-visible (SC-005)', async () => {
    const { key, orderDefinition } = await pair('audience');
    await quoteInBasket({ [key]: 'fair' });
    const drift = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${orderDefinition.id}`,
      cookies: ADMIN,
      payload: { audience: 'customer' },
    });
    expect(drift.statusCode, drift.body).toBe(200);
    const placed = await place();
    expect(Object.hasOwn(await orderValues(placed.id), key)).toBe(false);
    const notes = (await adminComments(placed.id)).filter((c) => c.systemNote !== null);
    expect(notes.map((n) => n.systemNote!.skipped)).toEqual([[{ key, reason: 'audience_mismatch', label: { labelDefault: key, labels: {} } }]]);
  });

  it('an unrelated required Order field fails neither the placement nor the carry', async () => {
    const { key } = await pair('beside_required');
    await define('order', fixtureKey('required_unrelated'), { valueType: 'text', required: true, options: [] });
    try {
      await quoteInBasket({ [key]: 'fair' });
      const placed = await place();
      expect((await orderValues(placed.id))[key]).toBe('fair');
    } finally {
      const id = created.pop()!;
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: ADMIN });
    }
  });

  it('carries the value the request holds at placement, not at conversion', async () => {
    const { key } = await pair('edited');
    const quoteRequestId = await quoteInBasket({ [key]: 'fair' });
    await setQuoteValues(quoteRequestId, { [key]: 'web' });
    const placed = await place();
    expect((await orderValues(placed.id))[key]).toBe('web');
  });

  it('names the carried keys in the impersonated placement’s audit entry (US1-5)', async () => {
    const { key } = await pair('impersonated');
    await quoteInBasket({ [key]: 'fair' });
    const start = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/impersonate`,
      payload: { customerAccountId: TEST_CUSTOMER_ID },
      cookies: ADMIN,
    });
    expect(start.statusCode, start.body).toBe(200);
    const setCookie = start.headers['set-cookie'];
    const session = /b2b_session=([^;]+)/.exec(Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? ''))?.[1];
    expect(session).toBeDefined();

    const placed = await whenOrderCreatedSettled(h, async () => {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: { b2b_session: session! },
        payload: {
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return (response.json() as { data: { id: string } }).data;
    });
    expect((await orderValues(placed.id))[key]).toBe('fair');
    const entry = await h.em().fork().findOne(
      AuditLogEntry,
      { action: 'order.place_on_behalf', objectId: placed.id },
      { orderBy: { actedAt: 'desc' } },
    );
    expect(entry?.stateAfter).toMatchObject({ carriedCustomFieldKeys: [key] });
  });
});
