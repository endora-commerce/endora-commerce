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
 * Issue #132 — a catalogue listing asks `price_lists`.
 *
 * The four listing paths used to render `attributeValues.defaultPrice`
 * verbatim, so a buyer browsing, searching, comparing or following a related
 * link saw a figure no price list supported while the product page, the cart
 * and checkout used the priced path.
 *
 * The pair that matters most is the first two cases: a product priced by a
 * price list shows *that* price, and a product genuinely priced at zero still
 * renders as zero rather than as an absence.
 */

interface Summary {
  id: string;
  sku: string;
  price: { amount: number; currency: string } | null;
}

const SEED_DEFAULT_PRICE = 19.99;

describe('catalogue listing price source (#132)', () => {
  let h: BackendServerHandle;

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
        `truncate table "price_lists" cascade`,
      );
  });

  afterEach(async () => {
    // Leave the shared catalogue fixture exactly as the seed wrote it.
    await h
      .em()
      .nativeUpdate(
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

  async function listedProduct(): Promise<Summary | undefined> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?q=EXAMPLE-SIMPLE-001',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Summary[] };
    return body.data.find((p) => p.id === SEED_PRODUCT_101_ID);
  }

  it('shows the base price the price book holds, not the catalogue attribute', async () => {
    await seedDefaultListWithBracket('88.00');
    const listed = await listedProduct();
    expect(listed?.price).toEqual({ amount: 88, currency: 'PLN' });
    expect(listed?.price?.amount).not.toBe(SEED_DEFAULT_PRICE);
  });

  it('renders a price list amount of zero as zero, not as an absent price', async () => {
    await seedDefaultListWithBracket('0.00');
    const listed = await listedProduct();
    expect(listed?.price).toEqual({ amount: 0, currency: 'PLN' });
    expect(listed?.price).not.toBeNull();
  });

  it('renders no price from the attribute on the Product when no book prices it (160 FR-018)', async () => {
    // No price book at all: the legacy `defaultPrice` attribute is not a price
    // any more, so the listing renders honestly as unpriced.
    const listed = await listedProduct();
    expect(listed).toBeDefined();
    expect(listed?.price).toBeNull();
  });

  it('renders no price when neither a list nor the Product carries one', async () => {
    await h
      .em()
      .nativeUpdate(
        Product,
        { id: SEED_PRODUCT_101_ID },
        { attributeValues: { color: 'red', material: 'steel', certification: 'ISO9001' } },
      );
    const listed = await listedProduct();
    expect(listed).toBeDefined();
    expect(listed?.price).toBeNull();
  });

  it('prices the product detail page from the same chain', async () => {
    await seedDefaultListWithBracket('77.50');
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products/example-simple-product',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Summary };
    expect(body.data.price).toEqual({ amount: 77.5, currency: 'PLN' });
  });

  it('still withholds the price on a non-public sales channel', async () => {
    await seedDefaultListWithBracket('88.00');
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?q=EXAMPLE-SIMPLE-001',
      headers: { 'x-sales-channel': 'pl_b2b_vip' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Summary[] };
    expect(body.data.find((p) => p.id === SEED_PRODUCT_101_ID)?.price).toBeNull();
  });
});
