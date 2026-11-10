import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const AGREED_UNIT_PRICE = 15;

/**
 * Issue #170 — the Quote Request screen's order action works for an operator.
 *
 * The admin *Place order* button posted to the storefront's
 * `POST /api/v1/quote-requests/:id/convert-to-order`, which is guarded by
 * `requireCustomer`: an administrator's session answered `401`, which the Admin
 * UI reads as an expired session — the operator was signed out — and had the
 * call been accepted it would have seeded the *caller's* basket and printed a
 * storefront checkout URL nobody in the admin can follow.
 *
 * The admin route prepares the basket of the customer who owns the request, at
 * the agreed prices, through the same rules the customer's own conversion
 * applies; the customer completes the order at checkout.
 */
describe('admin — prepare the customer’s basket from an approved Quote Request (issue #170)', () => {
  let h: BackendServerHandle;

  const submitted = async (): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  };

  const approved = async (): Promise<string> => {
    const id = await submitted();
    const priced = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: ADMIN,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: AGREED_UNIT_PRICE }] },
    });
    expect(priced.statusCode, priced.body).toBe(200);
    const approve = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${id}/approve`,
      cookies: ADMIN,
      payload: {},
    });
    expect(approve.statusCode, approve.body).toBe(200);
    return id;
  };

  const prepare = (id: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${id}/prepare-customer-basket`,
      cookies: ADMIN,
      payload: {},
    });

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('puts the agreed lines into the basket of the customer who owns the request', async () => {
    const id = await approved();

    const res = await prepare(id);

    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: unknown }).data).toMatchObject({
      cartId: expect.any(String),
      customerAccountId: TEST_CUSTOMER_ID,
      itemCount: 1,
    });

    const cart = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: CUSTOMER });
    expect(cart.statusCode, cart.body).toBe(200);
    const lines = (cart.json() as {
      data: { items: Array<{ productId: string; quantity: number; unitPrice: { amount: number } }> };
    }).data.items;
    expect(lines).toEqual([
      expect.objectContaining({ productId: SEED_PRODUCT_101_ID, quantity: 3, unitPrice: expect.objectContaining({ amount: AGREED_UNIT_PRICE }) }),
    ]);
  });

  it('records who prepared it, for which customer', async () => {
    const id = await approved();
    expect((await prepare(id)).statusCode).toBe(200);

    const rows = await h
      .em()
      .execute<Array<{ action: string; state_after: { customerAccountId?: string; itemCount?: number } }>>(
        `select "action", "state_after" from "audit_log_entries" where "object_id" = ? and "action" = 'quote_request.prepare_customer_basket'`,
        [id],
      );
    expect(rows).toHaveLength(1);
    // The basket and its size; the customer is the request's tenant anchor and stays out (D-288, #470).
    expect(rows[0]!.state_after).toMatchObject({ itemCount: 1 });
    expect(rows[0]!.state_after).not.toHaveProperty('customerAccountId');
  });

  it('refuses a request that is not approved, as the customer’s conversion does', async () => {
    const id = await submitted();

    const res = await prepare(id);

    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('RFQ_NOT_QUOTED');
  });
});
