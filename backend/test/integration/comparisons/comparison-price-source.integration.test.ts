import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Product } from '../../helpers/package-entities.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Issue #132 — a comparison column prices through `price_lists`.
 *
 * Comparing two products on figures neither price list supports is the worst
 * of the four listing paths: the whole surface exists so a buyer can put prices
 * side by side.
 */

const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };
const SEED_DEFAULT_PRICE = 19.99;

interface ComparisonView {
  products: Array<{ id: string; price: { amount: number; currency: string } | null }>;
}

describe('comparison price source (#132)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // The comparisons this file creates are not cleaned up and do not need to
    // be (issue #166): `comparedPrice()` posts without a cookie, so every call
    // gets an owner token of its own and reads back the row it just created.
    // The price lists below are a different matter — `seedDefaultListWithBracket`
    // rebuilds the platform's single default list, so the previous case's has
    // to go first.
    const em = h.em();
    await em
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
  });

  afterEach(async () => {
    await h.em().nativeUpdate(
      Product,
      { id: SEED_PRODUCT_101_ID },
      {
        attributeValues: {
          color: 'red',
          material: 'steel',
          certification: 'ISO9001',
          defaultPrice: SEED_DEFAULT_PRICE,
        },
      },
    );
  });

  async function seedDefaultListWithBracket(amount: string): Promise<void> {
    await new DefaultPriceListMigrator(h.em).seedDefault();
    const svc = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount }],
    });
  }

  async function comparedPrice(): Promise<{ amount: number; currency: string } | null> {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_101_ID },
    });
    expect(added.statusCode).toBe(200);
    const body = added.json() as { data: ComparisonView };
    return body.data.products.find((p) => p.id === SEED_PRODUCT_101_ID)?.price ?? null;
  }

  it('shows the price list amount rather than the catalogue attribute', async () => {
    await seedDefaultListWithBracket('88.00');
    expect(await comparedPrice()).toEqual({ amount: 88, currency: 'PLN' });
  });

  it('renders a resolved zero as zero, not as an absent price', async () => {
    await seedDefaultListWithBracket('0.00');
    expect(await comparedPrice()).toEqual({ amount: 0, currency: 'PLN' });
  });

  it("falls back to the Product's own price when no list applies", async () => {
    expect(await comparedPrice()).toEqual({ amount: SEED_DEFAULT_PRICE, currency: 'PLN' });
  });

  it('renders no price when neither a list nor the Product carries one', async () => {
    await h
      .em()
      .nativeUpdate(
        Product,
        { id: SEED_PRODUCT_101_ID },
        { attributeValues: { color: 'red', material: 'steel', certification: 'ISO9001' } },
      );
    expect(await comparedPrice()).toBeNull();
  });
});
