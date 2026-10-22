import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Product } from '../../helpers/package-entities.js';
import { seedBasePriceSql } from '../../helpers/price-book-sql.js';

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
    // The price books below are a different matter — `seedDefaultListWithBracket`
    // rewrites the base book, so the previous case's has to go first.
    const em = h.em();
    await em
      .getConnection()
      .execute(
        `truncate table "price_lists" cascade`,
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
    await seedBasePriceSql(h.em(), SEED_PRODUCT_101_ID, amount);
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

  it('shows the base book amount rather than the catalogue attribute', async () => {
    await seedDefaultListWithBracket('88.00');
    expect(await comparedPrice()).toEqual({ amount: 88, currency: 'PLN' });
  });

  it('renders a resolved zero as zero, not as an absent price', async () => {
    await seedDefaultListWithBracket('0.00');
    expect(await comparedPrice()).toEqual({ amount: 0, currency: 'PLN' });
  });

  it('renders no price from the attribute on the Product when no book prices it (160 FR-018)', async () => {
    expect(await comparedPrice()).toBeNull();
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
