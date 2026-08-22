import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DisplayMode } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import { PriceDisplayModeOverride } from '../../../src/modules/price_lists/entities/price-display-mode-override.entity.js';
import {
  ALPHA,
  BETA,
  GAMMA,
  PRICE_SORT_CHANNEL,
  PRICE_SORT_ORG_A,
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
 *  - a **single product** overridden to `none` ⇒ served, and that product keeps
 *    its position. The recommendation is implemented rather than guessed, and
 *    the whole of it is `PriceListService.resolvePageDisplayMode` omitting the
 *    product and category steps — moving those products to the tail instead is
 *    a change there and nowhere else.
 */

describe('a page that may not show prices refuses to order by them', () => {
  let h: BackendServerHandle;
  let retailChannelId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedPriceSortFixture(h.em());
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

  it('serves the ordering when a single product is overridden to `none`, and keeps its position', async () => {
    // Spec clarification 2, implemented as recommended. A per-product override
    // reads as "ask us for a quote", not "this price is secret", and
    // withdrawing the whole control for it would make the sort appear and
    // disappear as a buyer walks the catalogue.
    const em = h.em();
    const override = em.create(PriceDisplayModeOverride, {
      scope: 'product',
      targetId: BETA.id,
      mode: 'none',
    });
    await em.persistAndFlush(override);
    try {
      const served = await list('sort=price');
      expect(served.status).toBe(200);
      expect(served.skus).toEqual([ALPHA.sku, BETA.sku, GAMMA.sku]);
    } finally {
      em.remove(override);
      await em.flush();
    }
  });

  it('follows the organisation-level override, which is the page-level tier a buyer can carry', async () => {
    const em = h.em();
    const override = em.create(PriceDisplayModeOverride, {
      scope: 'organization',
      targetId: TEST_ORGANIZATION_ID,
      mode: 'none',
    });
    await em.persistAndFlush(override);
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
