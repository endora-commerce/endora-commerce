import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PriceDisplayModeOverride } from '../../helpers/package-entities.js';
import { PRICING_SETTING_CODES, type DisplayMode } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  ORG_A_BUYER,
  ORG_B_BUYER,
  RETAIL_CHANNEL,
  seedViewerPricedFixture,
  VIEWER_PRICED_PRODUCT_ID,
} from '../../helpers/viewer-priced-fixture.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingValue } from '@endora-commerce/platform/kernel';

/**
 * `GET /api/v1/storefront/pricing/display-mode/:productId` — asked for the
 * viewer in front of it (issue #271).
 *
 * Two things on the platform answer "net or gross for this viewer?": this
 * endpoint, which the cart reads, and the `displayMode` carried inside a
 * resolved price, which every priced product surface reads. MRs !796 and !803
 * made the second one per-viewer and left the first resolving
 * `organizationId: null, customerKind: 'guest'` unconditionally — so wherever
 * `pricing.default_display_mode` and `pricing.unauthenticated_display_mode`
 * differ, a signed-in buyer read one convention on the product page and the
 * other in their cart, which reads as a pricing error to the buyer and to
 * support.
 *
 * The settings pair is what makes the two viewers distinguishable, and it is
 * the *live* pair: `pricing.*` is the only net/gross preference the resolution
 * chain reads (`inventory.display_mode` is the stock badge and
 * `pwa.display_mode` is the app manifest — different namespaces, different
 * questions). No organisation-level net/gross field exists and none is added
 * here: the organisation's say is the `price_display_mode_overrides` row the
 * chain already consults, which the third case below exercises.
 */
describe('GET /api/v1/storefront/pricing/display-mode/:productId — for the viewer', () => {
  let h: BackendServerHandle;
  let retailChannelId: string;

  /**
   * A signed-in buyer whose Organization row is **gone**.
   *
   * The resolved-price path derives `customerKind` from the organisation it
   * loaded, not from the id on the session, so this viewer is priced as a guest
   * there. A display-mode endpoint that trusted the session id alone would say
   * `signed_in` and disagree with the price on the same page — the exact defect
   * class this change closes, one layer down. Registered here rather than in
   * the shared actor table because it is only ever this file's question.
   */
  const DANGLING_ORG_BUYER = { b2b_session: 'stub-customer-session-271-dangling-org' };

  async function setDisplayModeSetting(code: string, mode: DisplayMode): Promise<void> {
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code });
    const existing = await em.findOne(SettingValue, {
      setting: setting.id,
      salesChannel: retailChannelId,
    });
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

  async function displayModeFor(
    cookies?: Record<string, string>,
  ): Promise<{ displayMode: string; cacheControl: string | undefined }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/pricing/display-mode/${VIEWER_PRICED_PRODUCT_ID}`,
      headers: RETAIL_CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { displayMode: string } };
    return {
      displayMode: body.data.displayMode,
      cacheControl: res.headers['cache-control'] as string | undefined,
    };
  }

  async function resolvedPriceDisplayModeFor(
    cookies?: Record<string, string>,
  ): Promise<string> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${VIEWER_PRICED_PRODUCT_ID}/resolved-price`,
      headers: RETAIL_CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { resolvedPrice: { displayMode: string } } };
    return body.data.resolvedPrice.displayMode;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedViewerPricedFixture(h.em());
    const retail = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    retailChannelId = retail.id;
    CUSTOMER_COOKIES['stub-customer-session-271-dangling-org'] = {
      customerAccountId: '00000000-0000-4000-8000-000000027101',
      organizationId: '00000000-0000-4000-8000-000000027102',
    };
  }, 60_000);

  afterAll(async () => {
    delete CUSTOMER_COOKIES['stub-customer-session-271-dangling-org'];
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Scoped to the two targets this file can write, never a table wipe
    // (issue #166): the rows other files leave behind name their own product
    // and their own Organization, so emptying the table would be a claim about
    // the platform rather than a reset of this fixture.
    await h.em().nativeDelete(PriceDisplayModeOverride, {
      targetId: {
        $in: [
          VIEWER_PRICED_PRODUCT_ID,
          CUSTOMER_COOKIES['stub-customer-session']!.organizationId,
        ],
      },
    });
  });

  describe('where the two settings keys hold different values', () => {
    beforeEach(async () => {
      await setDisplayModeSetting(PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE, 'net_only');
      await setDisplayModeSetting(
        PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE,
        'gross_only',
      );
    });

    it('answers an anonymous visitor from the unauthenticated key', async () => {
      expect((await displayModeFor()).displayMode).toBe('gross_only');
    });

    it('answers a signed-in buyer from the signed-in key', async () => {
      expect((await displayModeFor(ORG_A_BUYER)).displayMode).toBe('net_only');
      expect((await displayModeFor(ORG_B_BUYER)).displayMode).toBe('net_only');
    });

    it('answers a buyer whose Organization row is gone as the price path does', async () => {
      expect((await displayModeFor(DANGLING_ORG_BUYER)).displayMode).toBe('gross_only');
    });
  });

  describe('where the two settings keys agree', () => {
    beforeEach(async () => {
      await setDisplayModeSetting(PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE, 'both');
      await setDisplayModeSetting(PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE, 'both');
    });

    it('answers every viewer identically', async () => {
      expect((await displayModeFor()).displayMode).toBe('both');
      expect((await displayModeFor(ORG_A_BUYER)).displayMode).toBe('both');
      expect((await displayModeFor(ORG_B_BUYER)).displayMode).toBe('both');
    });
  });

  describe('the endpoint and the resolved price answer as one', () => {
    // The actual requirement. Everything above is the mechanism that makes the
    // two answers derivable from one another; this is the property a buyer
    // sees, on the two surfaces that disagreed.
    beforeEach(async () => {
      await setDisplayModeSetting(PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE, 'net_only');
      await setDisplayModeSetting(
        PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE,
        'gross_only',
      );
    });

    it('agrees for every viewer, settings differing', async () => {
      for (const cookies of [undefined, ORG_A_BUYER, ORG_B_BUYER, DANGLING_ORG_BUYER]) {
        const endpoint = (await displayModeFor(cookies)).displayMode;
        expect(endpoint).toBe(await resolvedPriceDisplayModeFor(cookies));
      }
    });

    it("agrees when an Organization-scope override answers one buyer's chain", async () => {
      // The organisation's own say already exists as a
      // `price_display_mode_overrides` row, and the chain admits it only for a
      // viewer it resolved as signed-in. So this is the case where the two
      // surfaces are answering about the *organisation* rather than about the
      // settings pair, and it is the one an endpoint that dropped the viewer
      // could not reach at all.
      const em = h.em();
      em.create(PriceDisplayModeOverride, {
        scope: 'organization',
        targetId: CUSTOMER_COOKIES['stub-customer-session']!.organizationId,
        mode: 'none',
      });
      await em.flush();

      expect((await displayModeFor(ORG_A_BUYER)).displayMode).toBe('none');
      expect(await resolvedPriceDisplayModeFor(ORG_A_BUYER)).toBe('none');
      // And nobody else's chain moved.
      expect((await displayModeFor(ORG_B_BUYER)).displayMode).toBe('net_only');
      expect((await displayModeFor()).displayMode).toBe('gross_only');
    });
  });

  describe('what a shared cache may keep', () => {
    it('leaves the anonymous answer unstamped', async () => {
      // Still the public representation: no `Cache-Control` before this change
      // and none after it, so the storefront's shared window and a crawler see
      // exactly what they saw (Principle VII).
      expect((await displayModeFor()).cacheControl).toBeUndefined();
    });

    it('marks an answer resolved for an Organization private and unstorable', async () => {
      // Same direction `markPersonalisedPricing` closes on the price: this
      // answer now names an organisation, so a shared cache holding it would
      // hand one buyer's convention to the next caller of the same URL.
      expect((await displayModeFor(ORG_A_BUYER)).cacheControl).toBe('private, no-store');
      expect((await displayModeFor(ORG_B_BUYER)).cacheControl).toBe('private, no-store');
    });
  });
});
