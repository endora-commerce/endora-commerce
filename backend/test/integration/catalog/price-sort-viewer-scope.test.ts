import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  ALPHA,
  BETA,
  CHANNEL_PRICES,
  DELTA,
  GAMMA,
  GAMMA_ATTRIBUTE_PRICE,
  ORG_A_PRICES,
  ORG_B_PRICES,
  PRICE_SORT_CHANNEL,
  PRICE_SORT_ORG_A,
  PRICE_SORT_ORG_B,
  seedPriceSortFixture,
} from '../../helpers/price-sort-fixture.js';

/**
 * Feature 086, US1/US2/US3/US4 — the listing is ordered by **the viewer's own**
 * price.
 *
 * Three viewers, because two cannot tell the rule apart from its failures: the
 * anonymous case alone passes on an implementation ordering by the channel
 * price, and anonymous plus one buyer passes on one that resolves *an*
 * organisation and serves it to everybody. Only the second buyer, of a
 * different Organization, asking for the same page on the same channel,
 * distinguishes "ordered for the caller" from "ordered for whoever asked
 * first" — the shape MRs !796, !803 and !814 settled on.
 *
 * Every ordering assertion is made against the **card values on the wire**, not
 * against the ordering source, so an ordering that agreed with an internal
 * relation while disagreeing with the printed figures fails (SC-002).
 */

interface Summary {
  sku: string;
  price: { amount: number; currency: string } | null;
}

describe('a catalogue listing is ordered by the viewer\'s own price', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedPriceSortFixture(h.em());
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function list(
    query: string,
    cookies?: Record<string, string>,
  ): Promise<{ status: number; skus: string[]; entries: Summary[]; cacheControl?: string | undefined; body: unknown }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=PRICE-SORT&limit=50&${query}`,
      headers: PRICE_SORT_CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    const body = res.json() as { data?: Summary[] };
    const entries = body.data ?? [];
    return {
      status: res.statusCode,
      skus: entries.map((e) => e.sku),
      entries,
      cacheControl: res.headers['cache-control'] as string | undefined,
      body: res.json(),
    };
  }

  it('gives two buyers on inverted price lists inverted orderings of the same page', async () => {
    // SC-001 — the property that separates "priced for the caller" from
    // "priced for whoever asked first".
    const a = await list('sort=price', PRICE_SORT_ORG_A);
    const b = await list('sort=price', PRICE_SORT_ORG_B);

    expect(a.skus.indexOf(ALPHA.sku)).toBeLessThan(a.skus.indexOf(BETA.sku));
    expect(b.skus.indexOf(BETA.sku)).toBeLessThan(b.skus.indexOf(ALPHA.sku));

    // …and it is their own figures that put them there.
    const priceOf = (r: { entries: Summary[] }, sku: string): number | null =>
      r.entries.find((e) => e.sku === sku)?.price?.amount ?? null;
    expect(priceOf(a, ALPHA.sku)).toBe(ORG_A_PRICES.alpha);
    expect(priceOf(a, BETA.sku)).toBe(ORG_A_PRICES.beta);
    expect(priceOf(b, ALPHA.sku)).toBe(ORG_B_PRICES.alpha);
    expect(priceOf(b, BETA.sku)).toBe(ORG_B_PRICES.beta);
  });

  it('orders an anonymous visitor by the channel price, on an unmarked response', async () => {
    const anon = await list('sort=price');
    expect(anon.skus).toEqual([ALPHA.sku, BETA.sku, GAMMA.sku]);
    // US3 / FR-017 — the anonymous representation stays shared and crawlable.
    expect(anon.cacheControl ?? '').not.toContain('private');
    const signedIn = await list('sort=price', PRICE_SORT_ORG_A);
    expect(signedIn.cacheControl).toContain('private');
    expect(signedIn.cacheControl).toContain('no-store');
  });

  it('renders a non-decreasing sequence of card prices ascending, and non-increasing descending', async () => {
    // SC-002, asserted against the wire values rather than the ordering source.
    //
    // **Over the priced stream**, which is what SC-002 can mean once spec
    // clarification 1 is answered as it is: a product no price list prices goes
    // to the tail, and its card still renders whatever the chain's second arm —
    // the legacy `defaultPrice` attribute — has to offer. `GAMMA`'s attribute is
    // 1, so the wire sequence for the whole page is `[…, 1]` ascending and
    // `[…, 1]` descending. That is not a hole in the ordering; it is the tail
    // being a tail in both directions, with a figure that was never part of the
    // relation being ordered. See the note on the tail in `#listByViewerPrice`.
    for (const cookies of [undefined, PRICE_SORT_ORG_A, PRICE_SORT_ORG_B]) {
      const asc = await list('sort=price', cookies);
      const amounts = asc.entries
        .filter((e) => e.sku !== GAMMA.sku)
        .map((e) => e.price?.amount)
        .filter((a): a is number => typeof a === 'number');
      expect([...amounts].sort((x, y) => x - y)).toEqual(amounts);

      const desc = await list('sort=-price', cookies);
      const descAmounts = desc.entries
        .filter((e) => e.sku !== GAMMA.sku)
        .map((e) => e.price?.amount)
        .filter((a): a is number => typeof a === 'number');
      expect([...descAmounts].sort((x, y) => y - x)).toEqual(descAmounts);
    }
  });

  it('keeps the unpriced product at the end in both directions', async () => {
    // US4 / FR-011. `GAMMA` carries a legacy `defaultPrice` of 1 — the lowest
    // number in the fixture — so an ordering that let the attribute in would
    // lead with it ascending. It is the tail in both directions instead,
    // because "no price" is the absence of the value being ordered by rather
    // than a large number or a small one.
    //
    // Its **card** still shows the attribute figure, which is spec
    // clarification 1's recommendation taken literally: the attribute is not
    // part of the ordering and it is not removed from the card either. The
    // alternative — interleaving it — needs one statement across two modules'
    // tables for a case measured at zero incidence.
    const asc = await list('sort=price');
    const desc = await list('sort=-price');
    expect(asc.skus[asc.skus.length - 1]).toBe(GAMMA.sku);
    expect(desc.skus[desc.skus.length - 1]).toBe(GAMMA.sku);
    expect(asc.entries.find((e) => e.sku === GAMMA.sku)?.price?.amount).toBe(
      GAMMA_ATTRIBUTE_PRICE,
    );
  });

  it('excludes the unpriced product from a price range, in every ordering', async () => {
    // FR-012 — a range is a claim about a number.
    for (const sort of ['price', '-price', 'name', '-createdAt']) {
      const ranged = await list(`sort=${sort}&minPrice=0&maxPrice=1000`);
      expect(ranged.skus, sort).not.toContain(GAMMA.sku);
      expect(ranged.skus, sort).toContain(ALPHA.sku);
    }
  });

  it('narrows a range by each viewer\'s own price', async () => {
    // US2 acceptance 1, in the fixture's own numbers: ALPHA is 50 for the
    // channel, 10 for A and 90 for B.
    const anon = await list('minPrice=40&maxPrice=55&sort=price');
    expect(anon.skus).toEqual([ALPHA.sku]);

    const a = await list('minPrice=40&maxPrice=55&sort=price', PRICE_SORT_ORG_A);
    expect(a.skus).toEqual([DELTA.sku]);

    const b = await list('minPrice=40&maxPrice=55&sort=price', PRICE_SORT_ORG_B);
    expect(b.skus).toEqual([]);
  });

  it('composes a range with an ordering that is not a price ordering', async () => {
    // FR-009 / research §R12 — the range narrows, the name ordering orders.
    const byName = await list('sort=name&minPrice=0&maxPrice=100');
    expect(byName.skus).toEqual([ALPHA.sku, BETA.sku]);
    expect(byName.entries.every((e) => (e.price?.amount ?? -1) <= 100)).toBe(true);
  });

  it('refuses a minimum above a maximum instead of answering an empty page', async () => {
    // FR-008.
    const refused = await list('minPrice=100&maxPrice=10');
    expect(refused.status).toBe(400);
    const body = refused.body as { error?: { code?: string; details?: Array<{ path?: string }> } };
    expect(body.error?.code).toBe('PRICE_RANGE_INVALID');
    expect(body.error?.details?.map((d) => d.path)).toEqual(['minPrice', 'maxPrice']);
  });

  it('pages continuously, without repeating or skipping a product', async () => {
    // FR-004 / US2 acceptance 3 — a keyset over `(amount, productId)`, walked
    // one card at a time so every boundary in the fixture is crossed, including
    // the one between the priced stream and the tail.
    for (const cookies of [undefined, PRICE_SORT_ORG_A]) {
      const whole = await list('sort=price', cookies);
      const walked: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const res = await h.app.inject({
          method: 'GET',
          url: `/api/v1/catalog/products?q=PRICE-SORT&limit=1&sort=price${
            cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
          }`,
          headers: PRICE_SORT_CHANNEL,
          ...(cookies ? { cookies } : {}),
        });
        const body = res.json() as {
          data: Summary[];
          pagination: { cursor: string | null; hasMore: boolean };
        };
        walked.push(...body.data.map((d) => d.sku));
        if (!body.pagination.hasMore || !body.pagination.cursor) break;
        cursor = body.pagination.cursor;
      }
      expect(walked).toEqual(whole.skus);
    }
  });

  it('exposes no aggregate over the priced set', async () => {
    // FR-015 — no total, no rank, no "showing 51–100 of 4 213".
    const res = await list('sort=price');
    const body = res.body as { pagination: Record<string, unknown> };
    expect(Object.keys(body.pagination).sort()).toEqual(['cursor', 'hasMore', 'limit']);
  });

  it('gives the channel ordering to a viewer whose price list prices nothing extra', async () => {
    // US1 acceptance 2 — organisation A's list prices ALPHA and BETA but not
    // DELTA, so DELTA falls through to the channel list and takes the position
    // that price implies rather than joining the tail.
    const a = await list('sort=price', PRICE_SORT_ORG_A);
    expect(a.skus).toEqual([ALPHA.sku, DELTA.sku, BETA.sku, GAMMA.sku]);
    expect(a.entries.find((e) => e.sku === DELTA.sku)?.price?.amount).toBe(CHANNEL_PRICES.delta);
  });
});
