import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { BASE_BOOK_ID } from '../../helpers/price-book-sql.js';

/**
 * Feature 161 (Checkpoint 6 review) — a base-price write touches only what
 * changed. `PUT …/base-prices/:productId` replaces a currency's rows of the
 * product, and it used to do so by deleting every row and inserting the new
 * set, so a tier the operator never edited — a lowest tier from 10, a
 * variant's own quantity tiers — was deleted and written again with a new id
 * whenever anything else of that currency changed. A row whose selection,
 * window and price are unchanged now keeps its id and its values; only the
 * rows that differ are deleted or inserted.
 */
describe('base-price write keeps the rows it does not change (161 review)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  const B = '/api/v1/admin/price-books';

  type StoredRow = { id: string; selection: { variantId: string | null }; minQuantity: number; maxQuantity: number | null; price: unknown };

  const productRows = async (): Promise<StoredRow[]> => {
    const res = await api.get<{ data: StoredRow[] }>(`${B}/${BASE_BOOK_ID}/rows?productId=${f.products.P5.id}&pageSize=100`);
    expect(res.status, res.raw).toBe(200);
    return res.body.data;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    // P5: no tier from 1 — the lowest starts at 10 — and P5b with its own quantity tiers.
    await f.setBase(f.products.P5, {
      product: [{ minQuantity: 10, maxQuantity: null, amount: '80' }],
      variants: {
        [f.variants.P5r]: { type: 'percent', percent: '10' },
        [f.variants.P5b]: {
          type: 'fixed',
          tiers: [
            { minQuantity: 1, maxQuantity: 9, amount: '85' },
            { minQuantity: 10, maxQuantity: null, amount: '75' },
          ],
        },
      },
    });
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('changes one variant and leaves the product’s tier from 10 and the other variant’s tiers as they were', async () => {
    const before = await productRows();
    const keep = before.filter((row) => row.selection.variantId !== f.variants.P5r);
    expect(keep.map((row) => [row.selection.variantId, row.minQuantity])).toEqual(
      expect.arrayContaining([
        [null, 10],
        [f.variants.P5b, 1],
        [f.variants.P5b, 10],
      ]),
    );
    const res = await api.put(`${B}/base-prices/${f.products.P5.id}`, {
      byCurrency: {
        PLN: {
          product: [{ minQuantity: 10, maxQuantity: null, amount: '80.0000' }],
          variants: {
            [f.variants.P5r]: { type: 'percent', percent: '12' },
            [f.variants.P5b]: {
              type: 'fixed',
              tiers: [
                { minQuantity: 1, maxQuantity: 9, amount: '85.0000' },
                { minQuantity: 10, maxQuantity: null, amount: '75.0000' },
              ],
            },
          },
        },
      },
    });
    expect(res.status, res.raw).toBe(200);
    const after = await productRows();
    for (const row of keep) expect(after.find((a) => a.id === row.id), `${row.selection.variantId}@${row.minQuantity}`).toEqual(row);
    expect(after.some((row) => row.selection.variantId === null && row.minQuantity === 1)).toBe(false);
    expect(after.find((row) => row.selection.variantId === f.variants.P5r)?.price).toEqual({ type: 'percent', percent: '12.00' });
  });

  it('writes nothing new when the same prices are sent again', async () => {
    const before = await productRows();
    const read = await api.get<{ data: { byCurrency: Record<string, { product: unknown; variants: unknown }> } }>(
      `${B}/base-prices?productId=${f.products.P5.id}`,
    );
    const pln = read.body.data.byCurrency['PLN']!;
    const res = await api.put(`${B}/base-prices/${f.products.P5.id}`, { byCurrency: { PLN: { product: pln.product, variants: pln.variants } } });
    expect(res.status, res.raw).toBe(200);
    expect(await productRows()).toEqual(before);
  });
});
