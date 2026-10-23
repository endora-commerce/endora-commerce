import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { priceBookProductLinesResponseSchema } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { createSalesRep, priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 161 (Checkpoint 5 review) — `GET /api/v1/admin/price-books/:id/product-lines?productIds=`:
 * which of the named products already have a line in the book, answered from
 * `price_list_product_lines` in **one** request, so the grid refuses a picked
 * product whose line sits on another page instead of overwriting its price.
 * A product line exists when the product or one of its variants holds a row.
 * Visibility is the book read's: an out-of-scope book answers `404`.
 */
describe('price-book product lines (161 membership check)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let book: string;
  let variantOnly: string;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;
  const B = '/api/v1/admin/price-books';
  const UNKNOWN = '00000000-0000-4000-8000-0000001619dd';

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    rep = await createSalesRep(h, { assignedOrganizationIds: [f.orgs.Acme.id], otherOrganizationIds: [f.orgs.Beta.id] });
    book = (
      await f.book({
        name: 'Beta terms',
        audience: { organizations: [f.orgs.Beta] },
        rows: [
          { product: f.products.P1, percent: '-5' },
          { category: f.categories.screws, percent: '-3' },
        ],
      })
    ).id;
    variantOnly = (
      await f.book({ name: 'Variant only', audience: 'everyone', rows: [{ product: f.products.P5, variant: f.variants.P5r, fixed: '70' }] })
    ).id;
  }, 5 * 60_000);

  afterAll(async () => {
    rep.release();
    await teardownBackendServer(h);
  });

  it('answers the subset of the named products that have a line, in one request', async () => {
    const ids = [f.products.P1.id, f.products.P2.id, f.products.P3.id, UNKNOWN].join(',');
    const res = await api.get(`${B}/${book}/product-lines?productIds=${ids}`);
    expect(res.status, res.raw).toBe(200);
    const body = priceBookProductLinesResponseSchema.parse(res.body);
    expect(body.data.productIds).toEqual([f.products.P1.id]);
  });

  it('counts a product whose variants alone hold rows', async () => {
    const res = await api.get(`${B}/${variantOnly}/product-lines?productIds=${f.products.P5.id},${f.products.P1.id}`);
    expect(res.status, res.raw).toBe(200);
    expect(priceBookProductLinesResponseSchema.parse(res.body).data.productIds).toEqual([f.products.P5.id]);
  });

  it('refuses a request without ids, with too many, or with one that is not a uuid', async () => {
    expect((await api.get(`${B}/${book}/product-lines`)).status).toBe(400);
    expect((await api.get(`${B}/${book}/product-lines?productIds=nope`)).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${(0x1619000 + i).toString(16).padStart(12, '0')}`);
    expect((await api.get(`${B}/${book}/product-lines?productIds=${many.join(',')}`)).status).toBe(400);
  });

  it('answers a book out of the caller’s scope as an unknown one', async () => {
    const hidden = await api.get(`${B}/${book}/product-lines?productIds=${f.products.P1.id}`, rep.cookies);
    const unknown = await api.get(`${B}/${UNKNOWN}/product-lines?productIds=${f.products.P1.id}`, rep.cookies);
    expect(hidden.status).toBe(404);
    expect(unknown.status).toBe(404);
  });
});
