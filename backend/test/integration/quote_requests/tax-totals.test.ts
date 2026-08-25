import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Tax } from '../../helpers/package-entities.js';

/**
 * Quote Request prices are net; the read serialization must surface the VAT
 * rate resolved from the Organization's VAT status + tax rules so the quote
 * total matches the order it converts into. Mirrors the Orders VAT flow.
 */
describe('Quote Requests — VAT rate on read', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // A single default tax rule → taxRateFor() resolves it for any vat_payer org.
    const em = h.em();
    em.create(Tax, {
      code: 'rfq-test-vat',
      name: 'RFQ test VAT 23%',
      rate: '0.2300',
      isDefault: true,
    });
    await em.flush();
  });

  afterAll(async () => {
    const em = h.em();
    const row = await em.findOne(Tax, { code: 'rfq-test-vat' });
    if (row) await em.removeAndFlush(row);
    await teardownBackendServer(h);
  });

  async function createPending(quantity = 10, desiredUnitPrice = 8): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity, desiredUnitPrice }] },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('exposes the resolved VAT rate on the quote detail and each item', async () => {
    const id = await createPending();
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const rfq = (res.json() as {
      data: { taxRate: number; items: Array<{ taxRate: number }> };
    }).data;
    expect(rfq.taxRate).toBeCloseTo(0.23, 4);
    expect(rfq.items.length).toBeGreaterThan(0);
    for (const it of rfq.items) {
      expect(it.taxRate).toBeCloseTo(0.23, 4);
    }
  });

  it('exposes the VAT rate on the customer list summary', async () => {
    await createPending();
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const list = (res.json() as { data: Array<{ taxRate: number }> }).data;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.taxRate).toBeCloseTo(0.23, 4);
  });
});
