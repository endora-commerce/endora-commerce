import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CHANNEL_AMOUNT,
  FALLBACK_ATTRIBUTE_PRICE,
  ORG_A_AMOUNT,
  ORG_A_BUYER,
  ORG_B_AMOUNT,
  ORG_B_BUYER,
  RETAIL_CHANNEL,
  seedViewerPricedFixture,
  VIEWER_PRICED_SKU,
  VIEWER_PRICED_SLUG,
  VIEWER_PRICED_SOURCE_SLUG,
} from '../../helpers/viewer-priced-fixture.js';

/**
 * The owner's ruling: an anonymous visitor sees the channel price, a signed-in
 * buyer sees their organisation's.
 *
 * Three viewers, because two cannot tell the rule apart from its failures. The
 * anonymous case alone passes on the code that shipped before this change; the
 * anonymous plus one signed-in buyer passes on an implementation that resolves
 * *an* organisation and then serves it to everybody out of a cache keyed
 * without one. Only the second signed-in buyer, of a **different**
 * Organization, asking for the same product on the same channel, distinguishes
 * "priced for the caller" from "priced for whoever asked first" — which is the
 * failure that would disclose one buyer's negotiated price to another.
 *
 * The listing and the product detail are asserted separately because they are
 * separate resolutions in `CatalogQueryService`: the page is priced once as a
 * batch, the PDP as a batch of one.
 */

interface Summary {
  id: string;
  sku: string;
  price: { amount: number; currency: string } | null;
}

/**
 * The anonymous listing entries, recorded from `origin/master` before the change
 * under test, by injecting `GET /api/v1/catalog/products?q=VIEWER-PRICED` over
 * the fixture in `viewer-priced-fixture.ts`.
 *
 * Asserted whole, and deliberately not rebuilt from the constants above: the
 * claim is that the crawler's answer is the same bytes it was, and a shape
 * derived from the new code path would agree with the new code path by
 * construction. `price` is `CHANNEL_AMOUNT`, and every other field is here so
 * that a change to the listing projection made in passing shows up as a
 * failure rather than as a field nobody was looking at.
 *
 * Recorded twice, and the second time is issue #263. The entry began life with
 * `categorySlugs: []` and `primaryAssetUrl: null` — a shape that says nothing
 * about the two reads that MR !796 left running once per card, so the fixture
 * now gives the priced product two categories and a labelled gallery and the
 * source product one category and a legacy `product_assets` row, and both
 * entries are recorded from `origin/master` (17891285) before those reads were
 * hoisted to the page. The pair is what makes the guarantee bite across cards:
 * the two products' right answers differ in every field a page-wide read could
 * mis-key.
 */
const RECORDED_ANONYMOUS_LISTING_ENTRY = {
  id: '00000000-0000-4000-8000-00000000f001',
  sku: 'VIEWER-PRICED-0001',
  type: 'simple',
  name: 'Viewer priced probe',
  slug: 'viewer-priced-0001',
  categorySlugs: ['viewer-priced-category-a', 'viewer-priced-category-b'],
  primaryAssetUrl: 'https://assets.test/viewer-priced-thumbnail.svg',
  price: { amount: 88, currency: 'PLN' },
  stockIndicator: null,
  stockLevel: null,
};

/**
 * The same recording for the card **next to** it on the page. It resolves its
 * asset through the legacy fallback rather than the gallery, and its one
 * category is a third one, so a page-wide read that served one card's rows to
 * the other fails here and passes on the entry above.
 */
const RECORDED_ANONYMOUS_SOURCE_ENTRY = {
  id: '00000000-0000-4000-8000-00000000f002',
  sku: 'VIEWER-PRICED-SOURCE-0001',
  type: 'simple',
  name: 'Viewer priced probe source',
  slug: 'viewer-priced-source-0001',
  categorySlugs: ['viewer-priced-category-source'],
  primaryAssetUrl: 'https://assets.test/viewer-priced-source-legacy.svg',
  price: null,
  stockIndicator: null,
  stockLevel: null,
};

describe('a catalogue listing is priced for the viewer', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedViewerPricedFixture(h.em());
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function listed(cookies?: Record<string, string>): Promise<{
    entry: Summary | undefined;
    cacheControl: string | undefined;
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${VIEWER_PRICED_SKU}`,
      headers: RETAIL_CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Summary[] };
    return {
      entry: body.data.find((p) => p.sku === VIEWER_PRICED_SKU),
      cacheControl: res.headers['cache-control'] as string | undefined,
    };
  }

  /**
   * Both fixture products on one page — the request the recorded shapes were
   * taken from. `listed()` narrows to one SKU and so cannot see a page-wide
   * read that mixed two cards up; this one can.
   */
  async function listedPage(): Promise<Summary[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?q=VIEWER-PRICED',
      headers: RETAIL_CHANNEL,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Summary[] }).data;
  }

  async function detailed(cookies?: Record<string, string>): Promise<{
    price: { amount: number; currency: string } | null;
    cacheControl: string | undefined;
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${VIEWER_PRICED_SLUG}`,
      headers: RETAIL_CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { price: { amount: number; currency: string } | null } };
    return {
      price: body.data.price,
      cacheControl: res.headers['cache-control'] as string | undefined,
    };
  }

  describe('GET /api/v1/catalog/products', () => {
    it('quotes an anonymous visitor the channel price', async () => {
      const { entry } = await listed();
      expect(entry?.price).toEqual({ amount: CHANNEL_AMOUNT, currency: 'PLN' });
    });

    it("quotes a signed-in buyer their own organisation's price", async () => {
      const { entry } = await listed(ORG_A_BUYER);
      expect(entry?.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
    });

    it('quotes a buyer of another organisation THEIR price, not the first one\'s', async () => {
      const { entry } = await listed(ORG_B_BUYER);
      expect(entry?.price).toEqual({ amount: ORG_B_AMOUNT, currency: 'PLN' });
      expect(entry?.price?.amount).not.toBe(ORG_A_AMOUNT);
    });

    it('never falls through to the product attribute for any of the three', async () => {
      // The chain's last resort. If a viewer's resolution silently found no
      // list at all, the figure would still be a number — this is what keeps
      // "resolved for the caller" apart from "resolved to nothing".
      for (const cookies of [undefined, ORG_A_BUYER, ORG_B_BUYER]) {
        const { entry } = await listed(cookies);
        expect(entry?.price?.amount).not.toBe(FALLBACK_ATTRIBUTE_PRICE);
      }
    });
  });

  describe('GET /api/v1/catalog/products/:idOrSlug — the product detail', () => {
    it('quotes an anonymous visitor the channel price', async () => {
      expect((await detailed()).price).toEqual({ amount: CHANNEL_AMOUNT, currency: 'PLN' });
    });

    it("quotes a signed-in buyer their own organisation's price", async () => {
      expect((await detailed(ORG_A_BUYER)).price).toEqual({
        amount: ORG_A_AMOUNT,
        currency: 'PLN',
      });
    });

    it('quotes a buyer of another organisation THEIR price', async () => {
      expect((await detailed(ORG_B_BUYER)).price).toEqual({
        amount: ORG_B_AMOUNT,
        currency: 'PLN',
      });
    });
  });

  describe('GET /api/v1/catalog/products/:idOrSlug/links — the cross-sell strip', () => {
    /**
     * The third `ListingPricePort` caller follows the other two, and the reason
     * is the tile's own button: a cross-sell tile is a card the buyer can add
     * to a cart, and the cart line **is** priced for their organisation. A
     * strip that quoted the channel price beside a listing that quoted the
     * buyer's would put two prices for two products on one page, arrived at two
     * different ways — which is the defect issue #132 repaired for the price
     * *source* and this repairs for the price's *audience*.
     */
    async function tilePrice(
      cookies?: Record<string, string>,
    ): Promise<{ amount: number; currency: string } | null> {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${VIEWER_PRICED_SOURCE_SLUG}/links`,
        headers: RETAIL_CHANNEL,
        ...(cookies ? { cookies } : {}),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        data: Array<{ product: { slug: string; price: { amount: number; currency: string } | null } }>;
      };
      return body.data.find((r) => r.product.slug === VIEWER_PRICED_SLUG)?.product.price ?? null;
    }

    it('quotes an anonymous visitor the channel price', async () => {
      expect(await tilePrice()).toEqual({ amount: CHANNEL_AMOUNT, currency: 'PLN' });
    });

    it("quotes a signed-in buyer their own organisation's price", async () => {
      expect(await tilePrice(ORG_A_BUYER)).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
    });

    it('quotes a buyer of another organisation THEIR price', async () => {
      expect(await tilePrice(ORG_B_BUYER)).toEqual({ amount: ORG_B_AMOUNT, currency: 'PLN' });
    });
  });

  describe('what a shared cache may keep', () => {
    it('leaves the anonymous answer exactly as it was — body and caching alike', async () => {
      const { entry, cacheControl } = await listed();
      expect(entry).toEqual(RECORDED_ANONYMOUS_LISTING_ENTRY);

      // And the same, whole, for a page carrying both cards — the shape a
      // page-wide asset and category read can get wrong in a way a
      // single-entry page cannot show.
      const page = await listedPage();
      expect(page.find((p) => p.sku === 'VIEWER-PRICED-0001')).toEqual(
        RECORDED_ANONYMOUS_LISTING_ENTRY,
      );
      expect(page.find((p) => p.sku === 'VIEWER-PRICED-SOURCE-0001')).toEqual(
        RECORDED_ANONYMOUS_SOURCE_ENTRY,
      );
      // No `Cache-Control` before this change and none after it: the crawler's
      // representation, its cacheability and the storefront's ISR window are
      // untouched (Principle VII).
      expect(cacheControl).toBeUndefined();
      expect((await detailed()).cacheControl).toBeUndefined();
    });

    it('marks a personalised answer private and unstorable', async () => {
      // The figure in this response is one buyer's negotiated price. A shared
      // cache that kept it would hand it to the next caller of the same URL,
      // which is a worse defect than the one this feature repairs.
      expect((await listed(ORG_A_BUYER)).cacheControl).toBe('private, no-store');
      expect((await listed(ORG_B_BUYER)).cacheControl).toBe('private, no-store');
      expect((await detailed(ORG_A_BUYER)).cacheControl).toBe('private, no-store');
    });
  });
});
