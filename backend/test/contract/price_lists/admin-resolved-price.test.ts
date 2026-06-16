import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';

/**
 * Admin resolver endpoint for customer-specific pricing.
 *
 * Covers `GET /api/v1/admin/products/:id/resolved-price`, used by the admin
 * "create quote request on behalf of a customer" UI to pre-fill the agreed
 * unit price from the customer's price lists.
 */
describe('Admin resolved-price endpoint', () => {
  let h: BackendServerHandle;
  const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
    await new DefaultPriceListMigrator(h.em).seedDefault();
    const svc = new PriceListService(h.em);
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '199.0000' }],
    });
  });

  it('resolves the unit price for a customer + product', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url:
        `/api/v1/admin/products/${SEED_PRODUCT_101_ID}/resolved-price` +
        `?organizationId=${TEST_ORGANIZATION_ID}&customerAccountId=${TEST_CUSTOMER_ID}&quantity=1`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { resolvedPrice: { amount: string; currency: string } | null };
    };
    expect(body.data.resolvedPrice).not.toBeNull();
    expect(Number(body.data.resolvedPrice?.amount)).toBeCloseTo(199, 2);
    expect(body.data.resolvedPrice?.currency).toBe('PLN');
  });

  it('returns 404 for an unknown product', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/products/00000000-0000-4000-8000-0000000000ff/resolved-price?quantity=1`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(404);
  });
});
