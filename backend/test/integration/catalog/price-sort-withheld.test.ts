import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PriceDisplayModeOverride } from '../../helpers/package-entities.js';
import type { DisplayMode } from '@endora-commerce/contracts';
import { settlePriceSurface, warmPriceSort } from '../../helpers/price-surface.js';
import { priceBookApi } from '../../helpers/price-book-admin.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingValue } from '@endora-commerce/platform/kernel';
import {
  ALPHA,
  BETA,
  DELTA,
  GAMMA,
  PRICE_SORT_CHANNEL,
  PRICE_SORT_ORG_A,
  PRICE_SORT_ORG_B,
  seedPriceSortFixture,
} from '../../helpers/price-sort-fixture.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 086, US6 / FR-016 — a shop that withholds prices does not offer the
 * control, and the API refuses it rather than serving an ordering derived from
 * figures the page is not allowed to show.
 *
 * The refusal is **page-level**, and the two edges of that are asserted
 * separately because they are the feature's one unruled question (spec
 * clarification 2):
 *
 *  - the page-level mode is `none` ⇒ refused, for the viewer it is `none` for
 *    and not for the one it is not;
 *  - a **single product** overridden to `none` ⇒ served, and that product
 *    takes no part in the order or the range (issue #491): its amount is
 *    withheld on the server, so the price surface leaves it out and the walk
 *    meets it in the unpriced tail. Spec 086 recommended that it keep its
 *    position, which disclosed the rank of a price the page does not show.
 */

describe('a page that may not show prices refuses to order by them', () => {
  let h: BackendServerHandle;
  let retailChannelId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedPriceSortFixture(h.em());
    // A request never builds a price surface: register and build them first.
    await warmPriceSort(h, [
      { headers: PRICE_SORT_CHANNEL },
      { headers: PRICE_SORT_CHANNEL, cookies: PRICE_SORT_ORG_A },
      { headers: PRICE_SORT_CHANNEL, cookies: PRICE_SORT_ORG_B },
    ]);
    retailChannelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function setDisplayMode(code: string, mode: DisplayMode | null): Promise<void> {
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code });
    const existing = await em.findOne(SettingValue, {
      setting: setting.id,
      salesChannel: retailChannelId,
    });
    if (mode === null) {
      if (existing) em.remove(existing);
      await em.flush();
      return;
    }
    if (existing) {
      existing.value = mode;
      existing.updatedAt = new Date();
    } else {
      em.create(SettingValue, {
        setting,
        salesChannel: em.getReference(SalesChannel, retailChannelId),
        value: mode,
      });
    }
    await em.flush();
  }

  async function list(
    query: string,
    cookies?: Record<string, string>,
    channel: Record<string, string> = PRICE_SORT_CHANNEL,
  ): Promise<{ status: number; code?: string; skus: string[] }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=PRICE-SORT&limit=50&${query}`,
      headers: channel,
      ...(cookies ? { cookies } : {}),
    });
    const body = res.json() as { data?: Array<{ sku: string }>; error?: { code?: string } };
    return {
      status: res.statusCode,
      ...(body.error?.code ? { code: body.error.code } : {}),
      skus: (body.data ?? []).map((d) => d.sku),
    };
  }

  it('refuses a price ordering and a price range on a non-public sales channel', async () => {
    for (const query of ['sort=price', 'sort=-price', 'minPrice=1', 'maxPrice=1000']) {
      const refused = await list(query, undefined, { 'x-sales-channel': 'pl_b2b_vip' });
      expect(refused.status, query).toBe(400);
      expect(refused.code, query).toBe('PRICE_ORDERING_UNAVAILABLE');
    }
    // …while the same channel still serves the listing it always served.
    const served = await list('sort=name', undefined, { 'x-sales-channel': 'pl_b2b_vip' });
    expect(served.status).toBe(200);
  });

  it('refuses an anonymous visitor and serves a signed-in buyer when the page hides prices until login', async () => {
    await setDisplayMode('pricing.unauthenticated_display_mode', 'none');
    try {
      const anonymous = await list('sort=price');
      expect(anonymous.status).toBe(400);
      expect(anonymous.code).toBe('PRICE_ORDERING_UNAVAILABLE');

      const buyer = await list('sort=price', PRICE_SORT_ORG_A);
      expect(buyer.status).toBe(200);
      expect(buyer.skus.length).toBeGreaterThan(0);

      // Only the price controls are refused; the listing itself is untouched.
      const plain = await list('sort=name');
      expect(plain.status).toBe(200);
    } finally {
      await setDisplayMode('pricing.unauthenticated_display_mode', null);
    }
  });

  it('serves the ordering when a single product is overridden to `none`, and walks that product in the unpriced tail (#491)', async () => {
    // Withdrawing the whole control for one product would make the sort appear
    // and disappear as a buyer walks the catalogue (spec clarification 2), so
    // the ordering is served — but without the product whose price the page
    // does not show: ranked among the priced ones, its position would bound
    // its price between its neighbours'. Organisation A's order is
    // ALPHA 10 < DELTA 55 < BETA 90, then the unpriced GAMMA.
    const api = priceBookApi(h);
    const set = async (mode: 'none' | 'inherit') => {
      const res = await api.put(`/api/v1/admin/pricing/display-mode-overrides/product/${BETA.id}`, { mode });
      expect([200, 204], res.raw).toContain(res.status);
      // The write marked BETA on every surface; the worker refreshes it.
      await settlePriceSurface(h);
    };
    const before = await list('sort=price', PRICE_SORT_ORG_A);
    expect(before.skus).toEqual([ALPHA.sku, DELTA.sku, BETA.sku, GAMMA.sku]);
    await set('none');
    try {
      const ascending = await list('sort=price', PRICE_SORT_ORG_A);
      expect(ascending.status).toBe(200);
      expect(ascending.skus.slice(0, 2)).toEqual([ALPHA.sku, DELTA.sku]);
      expect(new Set(ascending.skus.slice(2))).toEqual(new Set([BETA.sku, GAMMA.sku]));

      // The tail closes the walk in both directions: BETA does not lead "most
      // expensive first", which is where its price would put it.
      const descending = await list('sort=-price', PRICE_SORT_ORG_A);
      expect(descending.skus.slice(0, 2)).toEqual([DELTA.sku, ALPHA.sku]);
      expect(new Set(descending.skus.slice(2))).toEqual(new Set([BETA.sku, GAMMA.sku]));

      // A range is a claim about a number, and BETA is shown none: excluded,
      // so the range cannot be narrowed until it brackets BETA's price.
      const ranged = await list('minPrice=80&maxPrice=100', PRICE_SORT_ORG_A);
      expect(ranged.status).toBe(200);
      expect(ranged.skus).toEqual([]);
      const wide = await list('sort=price&minPrice=1&maxPrice=1000', PRICE_SORT_ORG_A);
      expect(wide.skus).toEqual([ALPHA.sku, DELTA.sku]);

      // And for the anonymous visitor: ALPHA 50, then the tail.
      const anonymous = await list('sort=price');
      expect(anonymous.skus[0]).toBe(ALPHA.sku);
      expect(new Set(anonymous.skus.slice(1))).toEqual(new Set([BETA.sku, GAMMA.sku]));
    } finally {
      await set('inherit');
    }
    // The override gone, BETA is ranked again.
    expect((await list('sort=price', PRICE_SORT_ORG_A)).skus).toEqual([ALPHA.sku, DELTA.sku, BETA.sku, GAMMA.sku]);
  });

  it('follows the organisation-level override, which is the page-level tier a buyer can carry', async () => {
    const em = h.em();
    const override = em.create(PriceDisplayModeOverride, {
      scope: 'organization',
      targetId: TEST_ORGANIZATION_ID,
      mode: 'none',
    });
    await em.persist(override).flush();
    try {
      const buyer = await list('sort=price', PRICE_SORT_ORG_A);
      expect(buyer.status).toBe(400);
      expect(buyer.code).toBe('PRICE_ORDERING_UNAVAILABLE');
      // …and the anonymous visitor on the same shop is unaffected.
      const anonymous = await list('sort=price');
      expect(anonymous.status).toBe(200);
    } finally {
      em.remove(override);
      await em.flush();
    }
  });
});
