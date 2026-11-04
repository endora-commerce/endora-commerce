import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  QuoteRequestReadPort,
  QuoteRequestSummary,
  RfqCustomerPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CartItem, QuoteRequest, QuoteRequestItem } from '../../helpers/package-entities.js';

/**
 * Feature 146, Phase 5 (T028) — cart → quote conversion stores the cart's unit
 * price as the line's reference and records **no** customer proposal (FR-008,
 * US1 #8); the customer list then has no customer-price total (FR-009, US1
 * #8a). The in-process `lineReferencePrices` argument is validated before any
 * write (threat model T6), and the read port answers the reference so export
 * readers that used to find the cart price in `desiredUnitPrice` still can
 * (owner decision D-3O, option (b)).
 */
describe('146 — cart conversion stores the cart price as the reference [integration]', () => {
  let h: BackendServerHandle;
  const customer = { b2b_session: 'stub-customer-session' };
  /** A cart price no price list answers, so a fresh resolution cannot pass for it. */
  // A cart line's unit price reads back at the column's four places (owner ruling of 2026-10-25).
  const CART_UNIT_PRICE = '77.7000';
  let convertedId: string;

  const readPort = () => h.container.resolve('quoteRequestReadPort') as QuoteRequestReadPort;

  beforeAll(async () => {
    h = await setupBackendServer();
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: customer,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 3 },
    });
    expect(add.statusCode, add.body).toBe(200);
    const cartId = (add.json() as { data: { id: string } }).data.id;
    await h
      .em()
      .getConnection()
      .execute(`update "cart_items" set "unit_price" = ? where "cart_id" = ?`, [CART_UNIT_PRICE, cartId]);
    const em = h.em();
    em.clear();
    const [cartLine] = await em.find(CartItem, { cartId });
    expect(cartLine?.unitPrice).toBe(CART_UNIT_PRICE);

    const convert = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/convert-to-quote-request',
      cookies: customer,
      payload: {},
    });
    expect(convert.statusCode, convert.body).toBe(200);
    convertedId = (convert.json() as { data: { quoteRequestId: string } }).data.quoteRequestId;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('stores the cart unit price and currency as the reference, and no proposal (US1 #8, FR-008)', async () => {
    const em = h.em();
    em.clear();
    const lines = await em.find(QuoteRequestItem, { quoteRequestId: convertedId });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.desiredUnitPrice ?? null).toBeNull();
    expect(lines[0]?.referenceUnitPrice).toBe(CART_UNIT_PRICE);
    expect(lines[0]?.referenceCurrency).toBe('PLN');
    expect(lines[0]?.referenceCapturedAt).toBeInstanceOf(Date);
  });

  it('the storefront list shows no customer-price total for it (US1 #8a, FR-009)', async () => {
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/quote-requests', cookies: customer });
    expect(list.statusCode, list.body).toBe(200);
    const summary = (list.json() as { data: QuoteRequestSummary[] }).data.find((s) => s.id === convertedId);
    expect(summary).toBeDefined();
    expect(summary?.totalAtCustomerPrice).toBeNull();
  });

  it('the read port answers the reference, not a proposal (owner decision (b))', async () => {
    const [line] = await readPort().listItems(convertedId);
    expect(line?.desiredUnitPrice ?? null).toBeNull();
    expect(line?.referenceUnitPrice).toBe(CART_UNIT_PRICE);
    expect(line?.referenceCurrency).toBe('PLN');
  });

  it('the read port answers null for both on a line with no stored reference', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customer,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    // A line written before this feature, or whose pricing read failed.
    await h
      .em()
      .getConnection()
      .execute(
        `update "quote_request_items" set "reference_unit_price" = null, "reference_currency" = null, ` +
          `"reference_captured_at" = null where "quote_request_id" = ?`,
        [id],
      );
    const [line] = await readPort().listItems(id);
    expect(line).toBeDefined();
    expect(line?.referenceUnitPrice).toBeNull();
    expect(line?.referenceCurrency).toBeNull();
  });

  describe('an in-process caller passing an invalid lineReferencePrices entry (T6)', () => {
    const ctx = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
    const input = { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] };

    const countRequests = async () => {
      const em = h.em();
      em.clear();
      return em.count(QuoteRequest, { customerAccountId: TEST_CUSTOMER_ID });
    };

    it.each([
      ['negative', [{ amount: '-1.00', currency: 'PLN' }]],
      ['non-finite', [{ amount: 'Infinity', currency: 'PLN' }]],
      // A unit price keeps four places (owner ruling of 2026-10-25); a fifth is not a price.
      ['five decimals', [{ amount: '1.00005', currency: 'PLN' }]],
      ['lower-case currency', [{ amount: '1.00', currency: 'pln' }]],
      ['two-letter currency', [{ amount: '1.00', currency: 'PL' }]],
      ['length ≠ items', [{ amount: '1.00', currency: 'PLN' }, null]],
    ])('throws on %s and writes nothing', async (_label, lineReferencePrices) => {
      const rfqService = h.container.resolve('rfqService') as RfqCustomerPort;
      const before = await countRequests();
      await expect(rfqService.createForCustomer(ctx, input, { lineReferencePrices })).rejects.toThrow();
      expect(await countRequests()).toBe(before);
    });
  });
});
