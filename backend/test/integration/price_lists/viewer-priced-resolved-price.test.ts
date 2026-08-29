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
  VIEWER_PRICED_PRODUCT_ID,
} from '../../helpers/viewer-priced-fixture.js';

/**
 * The wire spelling of a bracket amount. `price_list_price_brackets.amount` is
 * `decimal(14,4)` and the route hands the column's own string to the client
 * verbatim, so the fixture's `88` reaches the buyer as `88.0000`. Written as a
 * function rather than baked into each expectation so the assertions below read
 * as being about the *figure*, which is what the ruling is about.
 */
function pln(amount: number): { amount: string; currency: string } {
  return { amount: `${amount}.0000`, currency: 'PLN' };
}

/**
 * `GET /api/v1/storefront/products/:id/resolved-price` — the per-customer
 * endpoint, asked the question its name promises (issue #265).
 *
 * It never answered it. The handler passed `organization: null` to the engine
 * unconditionally, behind a comment saying the organisation would be derived
 * "when wired", so every caller of the endpoint whose whole purpose is "what
 * does THIS buyer pay" was quoted the channel price. That is not a regression
 * from MR !796: the two halves have been anonymous since feature 011 shipped
 * the route, and the ruling MR !796 settled for the catalogue listing — an
 * anonymous visitor sees the channel price, a signed-in buyer sees their own —
 * had never reached this endpoint at all.
 *
 * Three viewers, for the reason `viewer-priced-listing.test.ts` states: the
 * anonymous case alone passes on the shipped code, anonymous plus one buyer
 * passes on an implementation that resolves *an* organisation and serves it to
 * everybody out of a cache keyed without one, and only a second buyer of a
 * **different** Organization asking for the same product on the same channel
 * separates "priced for the caller" from "priced for whoever asked first".
 */
describe('GET /api/v1/storefront/products/:id/resolved-price — priced for the viewer', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedViewerPricedFixture(h.em());
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function resolved(
    cookies?: Record<string, string>,
    quantity = 1,
  ): Promise<{
    basePrice: { amount: string; currency: string } | null;
    displayMode: string;
    cacheControl: string | undefined;
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${VIEWER_PRICED_PRODUCT_ID}/resolved-price?quantity=${quantity}`,
      headers: RETAIL_CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        resolvedPrice: {
          basePrice: { amount: string; currency: string } | null;
          displayMode: string;
        };
      };
    };
    return {
      basePrice: body.data.resolvedPrice.basePrice,
      displayMode: body.data.resolvedPrice.displayMode,
      cacheControl: res.headers['cache-control'] as string | undefined,
    };
  }

  it('quotes an anonymous visitor the channel price', async () => {
    expect((await resolved()).basePrice).toEqual(pln(CHANNEL_AMOUNT));
  });

  it("quotes a signed-in buyer their own organisation's price", async () => {
    expect((await resolved(ORG_A_BUYER)).basePrice).toEqual(pln(ORG_A_AMOUNT));
  });

  it("quotes a buyer of another organisation THEIR price, not the first one's", async () => {
    const { basePrice } = await resolved(ORG_B_BUYER);
    expect(basePrice).toEqual(pln(ORG_B_AMOUNT));
    expect(basePrice?.amount).not.toBe(pln(ORG_A_AMOUNT).amount);
  });

  it('never falls through to the product attribute for any of the three', async () => {
    // The chain's last resort. A viewer whose resolution silently matched no
    // list at all would still be quoted a number; this is what keeps "resolved
    // for the caller" apart from "resolved to nothing".
    for (const cookies of [undefined, ORG_A_BUYER, ORG_B_BUYER]) {
      const { basePrice } = await resolved(cookies);
      expect(basePrice?.amount).not.toBe(pln(FALLBACK_ATTRIBUTE_PRICE).amount);
    }
  });

  describe('what a shared cache may keep', () => {
    it('leaves the anonymous answer unstamped, as the catalogue listing does', async () => {
      // No `Cache-Control` before this change and none after it: the anonymous
      // resolved price is still the representation a crawler may see and the
      // one the storefront's 60 s Data Cache window holds (Principle VII).
      expect((await resolved()).cacheControl).toBeUndefined();
    });

    it('marks a personalised answer private and unstorable', async () => {
      // The figure in this response is one buyer's negotiated price. A shared
      // cache that kept it would hand it to the next caller of the same URL.
      expect((await resolved(ORG_A_BUYER)).cacheControl).toBe('private, no-store');
      expect((await resolved(ORG_B_BUYER)).cacheControl).toBe('private, no-store');
    });
  });

  describe('the quantity bracket is the viewer\'s too', () => {
    it('prices a ten-unit line against the buyer\'s own list', async () => {
      // The fixture's organisation lists carry one open bracket each, so the
      // ten-unit answer is the same amount — what matters is that it comes from
      // the buyer's list rather than the channel's, which a quantity that
      // bypassed the resolution would silently undo.
      expect((await resolved(ORG_A_BUYER, 10)).basePrice).toEqual(pln(ORG_A_AMOUNT));
    });
  });
});
