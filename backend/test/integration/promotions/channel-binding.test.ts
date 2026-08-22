import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { CartSnapshot } from '@endora-commerce/contracts';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Feature 052 (US3) — Sales-channel gate on promotion evaluation (FR-004 / FR-005).
 *
 * A promotion bound to specific sales channels MUST only apply to carts in
 * those channels. `applyToCart` reads the cart's resolved `salesChannelId` and
 * rejects promotions whose `sales_channel_promotions` binding excludes it. A
 * cart with no resolved channel matches no channel-bound promotion (fail closed).
 *
 * The promotions module in the test harness is wired with the sales-channel
 * membership service, so `upsert` auto-binds a new promotion to the system
 * default channel (that is "channel A" here). "Channel B" is a second channel
 * the promotion is NOT bound to.
 */
describe('PromotionService — sales-channel gate (feature 052 US3)', () => {
  let h: BackendServerHandle;
  let channelAId: string; // system default — the promotion binds here on upsert
  let channelBId: string; // a second channel the promotion is not bound to

  beforeAll(async () => {
    h = await setupBackendServer();
    const def = await h.salesChannels.resolver.getSystemDefault();
    channelAId = def.id;

    const em = h.em();
    const channelB = em.create(SalesChannel, {
      code: 'f052-channel-b',
      name: { en: 'Feature 052 Channel B' },
      defaultLanguage: 'en-US',
      defaultCurrency: 'PLN',
      languages: ['en-US'],
      currencies: ['PLN'],
      isPublic: false,
      active: true,
      systemDefault: false,
      version: 1,
    });
    await em.persistAndFlush(channelB);
    channelBId = channelB.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Cascades to sales_channel_promotions, clearing prior bindings.
    await h.em().getConnection().execute('truncate table promotions cascade');
  });

  const PRODUCT_A = '00000000-0000-4000-8000-000000000001';

  function snapshot(salesChannelId: string | null): CartSnapshot {
    return {
      organizationId: null,
      customerGroupId: null,
      currency: 'PLN',
      deliveryTotal: 20,
      promotionCode: null,
      salesChannelId,
      lines: [
        {
          productId: PRODUCT_A,
          variantId: null,
          categoryIds: [],
          quantity: 1,
          unitPrice: { amount: 100, currency: 'PLN' },
        },
      ],
    };
  }

  async function createPromotionBoundToDefault(): Promise<void> {
    // `upsert` auto-binds the new promotion to the system-default channel (A).
    await h.promotions.promotionService.upsert({
      name: '10% off (channel-A bound)',
      kind: 'percentage_off',
      value: 10,
    });
  }

  it('applies a channel-bound promotion to a cart in its channel (neutrality)', async () => {
    await createPromotionBoundToDefault();
    const result = await h.promotions.promotionService.applyToCart(snapshot(channelAId));
    expect(result.discountTotal).toBe(10);
  });

  it('does NOT apply a channel-bound promotion to a cart in a different channel', async () => {
    await createPromotionBoundToDefault();
    const result = await h.promotions.promotionService.applyToCart(snapshot(channelBId));
    expect(result.discountTotal).toBe(0);
  });

  it('does NOT apply a channel-bound promotion to a cart with no resolved channel (fail closed)', async () => {
    await createPromotionBoundToDefault();
    const result = await h.promotions.promotionService.applyToCart(snapshot(null));
    expect(result.discountTotal).toBe(0);
  });
});
