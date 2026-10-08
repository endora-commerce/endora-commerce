import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CartItem,
  OrderItem,
  QuoteRequest,
  QuoteRequestItem,
} from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * A quote request becomes an order only at a price the seller agreed.
 *
 * Three rules, each asserted through the real routes:
 *
 *  1. the buyer can accept only an offer the seller has made, and only once
 *     every line of it carries an agreed unit price;
 *  2. an operator can approve a request only once every line carries an agreed
 *     unit price;
 *  3. an approved request that still has a line with no agreed unit price is
 *     not converted into a basket, however it came to be approved.
 *
 * The rules are about a **missing** price. A price of exactly zero that an
 * operator typed is an agreed price like any other and stays orderable.
 *
 * Every refusal is read off `error.code`, not the status alone.
 */
describe('Quote Requests — a request is accepted, approved and ordered only once priced', () => {
  let h: BackendServerHandle;

  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  const ADMIN = { b2b_session: 'stub-admin-session' };

  interface Rfq {
    id: string;
    version: number;
    status: string;
    currentRevisionNumber: number;
    awaitingCustomerRevisionAcceptance: boolean;
  }
  interface Envelope {
    error: { code: string; message: string };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function raiseRequest(quantity: number): Promise<Rfq> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity }] },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: Rfq }).data;
  }

  async function revise(rfq: Rfq, payload: Record<string, unknown>): Promise<Rfq> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${rfq.id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${rfq.version}"` },
      payload,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Rfq }).data;
  }

  const accept = (id: string, revision: number) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/accept-revision`,
      cookies: CUSTOMER,
      payload: { expectedRevisionNumber: revision },
    });

  const approve = (rfq: Rfq) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${rfq.id}/approve`,
      cookies: ADMIN,
      headers: { 'if-match': `"${rfq.version}"` },
      payload: {},
    });

  const convert = (id: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/convert-to-order`,
      cookies: CUSTOMER,
      payload: {},
    });

  async function statusOf(id: string): Promise<string | undefined> {
    const em = h.em();
    em.clear();
    return (await em.findOne(QuoteRequest, { id }, { filters: false }))?.status;
  }

  async function basketLines(cartId: string): Promise<Array<{ quantity: number; unitPrice: string }>> {
    const em = h.em();
    em.clear();
    const rows = await em.find(CartItem, { cartId }, { filters: false });
    return rows.map((row) => ({ quantity: row.quantity, unitPrice: String(row.unitPrice) }));
  }

  // -------------------------------------------------------------------------
  // Rule 1 — the buyer accepts an offer, never their own request
  // -------------------------------------------------------------------------

  it('refuses accept-revision on a request the seller has not answered (409 RFQ_NOT_QUOTED)', async () => {
    const rfq = await raiseRequest(3);
    expect(rfq.awaitingCustomerRevisionAcceptance).toBe(false);

    const res = await accept(rfq.id, rfq.currentRevisionNumber);

    expect(res.statusCode).toBe(409);
    expect((res.json() as Envelope).error.code).toBe('RFQ_NOT_QUOTED');
    expect(await statusOf(rfq.id)).toBe('Pending');
    // Still not convertible: it was never approved.
    expect((await convert(rfq.id)).statusCode).toBe(409);
  });

  it('refuses accept-revision on a seller revision that leaves a line unpriced (409 QUOTE_INCOMPLETE)', async () => {
    const rfq = await raiseRequest(4);
    // The operator answers with a note only — the lines stay unpriced.
    const revised = await revise(rfq, { headerNote: 'We will come back with prices.' });
    expect(revised.awaitingCustomerRevisionAcceptance).toBe(true);

    const res = await accept(rfq.id, revised.currentRevisionNumber);

    expect(res.statusCode).toBe(409);
    expect((res.json() as Envelope).error.code).toBe('QUOTE_INCOMPLETE');
    expect(await statusOf(rfq.id)).toBe('Pending');
  });

  it('still lets the buyer withdraw a request the seller has not answered', async () => {
    const rfq = await raiseRequest(2);

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfq.id}/reject-revision`,
      cookies: CUSTOMER,
      payload: { expectedRevisionNumber: rfq.currentRevisionNumber, reason: 'No longer needed' },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: Rfq }).data.status).toBe('Canceled');
  });

  // -------------------------------------------------------------------------
  // Rule 2 — an operator approves a priced request only
  // -------------------------------------------------------------------------

  it('refuses admin approve while no line has an agreed price (409 QUOTE_INCOMPLETE)', async () => {
    const rfq = await raiseRequest(5);

    const res = await approve(rfq);

    expect(res.statusCode).toBe(409);
    expect((res.json() as Envelope).error.code).toBe('QUOTE_INCOMPLETE');
    expect(await statusOf(rfq.id)).toBe('Pending');
    expect((await convert(rfq.id)).statusCode).toBe(409);
  });

  it('refuses admin approve while any one line has no agreed price (409 QUOTE_INCOMPLETE)', async () => {
    const rfq = await raiseRequest(6);
    const revised = await revise(rfq, {
      items: [
        { productId: SEED_PRODUCT_101_ID, quantity: 6, agreedUnitPrice: 7.5 },
        { productId: SEED_PRODUCT_102_ID, quantity: 1, agreedUnitPrice: null },
      ],
    });

    const res = await approve(revised);

    expect(res.statusCode).toBe(409);
    expect((res.json() as Envelope).error.code).toBe('QUOTE_INCOMPLETE');
    expect(await statusOf(rfq.id)).toBe('Pending');
  });

  it('lets an operator approve a request once every line is priced, at the agreed price', async () => {
    const rfq = await raiseRequest(8);
    const revised = await revise(rfq, {
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 8, agreedUnitPrice: 6.4 }],
    });

    const res = await approve(revised);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: Rfq }).data.status).toBe('Approved');

    const converted = await convert(rfq.id);
    expect(converted.statusCode).toBe(200);
    const { cartId } = (converted.json() as { data: { cartId: string } }).data;
    expect(await basketLines(cartId)).toEqual([{ quantity: 8, unitPrice: '6.40' }]);
  });

  // -------------------------------------------------------------------------
  // Rule 3 — the conversion itself never invents a price
  // -------------------------------------------------------------------------

  it('refuses convert-to-order on an approved request with an unpriced line (409 QUOTE_INCOMPLETE)', async () => {
    const rfq = await raiseRequest(37);
    // A row approved before the two rules above existed: no route produces it
    // any more, so it is written directly.
    await h.em().nativeUpdate(QuoteRequest, { id: rfq.id }, { status: 'Approved', approvedAt: new Date() });

    const res = await convert(rfq.id);

    expect(res.statusCode).toBe(409);
    expect((res.json() as Envelope).error.code).toBe('QUOTE_INCOMPLETE');
    // Nothing was seeded: no basket line carries this request's quantity.
    const em = h.em();
    em.clear();
    expect(await em.find(CartItem, { quantity: 37 }, { filters: false })).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // The flows the rules must not reach
  // -------------------------------------------------------------------------

  it('seller revises with prices → buyer accepts → order placed at the agreed price', async () => {
    const rfq = await raiseRequest(9);
    const revised = await revise(rfq, {
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 9, agreedUnitPrice: 11.25 }],
    });

    const accepted = await accept(rfq.id, revised.currentRevisionNumber);
    expect(accepted.statusCode).toBe(200);
    expect((accepted.json() as { data: Rfq }).data.status).toBe('Approved');

    const converted = await convert(rfq.id);
    expect(converted.statusCode).toBe(200);
    const { cartId } = (converted.json() as { data: { cartId: string } }).data;
    expect(await basketLines(cartId)).toEqual([{ quantity: 9, unitPrice: '11.25' }]);

    const placed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: CUSTOMER,
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });
    expect(placed.statusCode).toBe(201);
    const orderId = (placed.json() as { data: { id: string } }).data.id;
    const em = h.em();
    em.clear();
    const lines = await em.find(OrderItem, { orderId }, { filters: false });
    expect(lines.map((line) => String(line.unitPrice))).toEqual(['11.25']);
  });

  it('operator creates on behalf with prices → buyer accepts', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 12, agreedUnitPrice: 89.0 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const rfq = (created.json() as { data: Rfq }).data;
    expect(rfq.status).toBe('Created from admin');

    const accepted = await accept(rfq.id, rfq.currentRevisionNumber);

    expect(accepted.statusCode).toBe(200);
    expect((accepted.json() as { data: Rfq }).data.status).toBe('Approved');
  });

  it('keeps a price of exactly zero that the operator agreed orderable', async () => {
    const rfq = await raiseRequest(1);
    const revised = await revise(rfq, {
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 0 }],
    });
    const em = h.em();
    em.clear();
    const stored = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id }, { filters: false });
    expect(stored.map((line) => line.agreedUnitPrice)).toEqual(['0.00']);

    expect((await accept(rfq.id, revised.currentRevisionNumber)).statusCode).toBe(200);

    const converted = await convert(rfq.id);
    expect(converted.statusCode).toBe(200);
    const { cartId } = (converted.json() as { data: { cartId: string } }).data;
    expect(await basketLines(cartId)).toEqual([{ quantity: 1, unitPrice: '0.00' }]);
  });
});
