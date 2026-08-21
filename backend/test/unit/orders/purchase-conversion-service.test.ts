import { describe, expect, it } from 'vitest';
import type Redis from 'ioredis';
import {
  PurchaseConversionService,
  PURCHASE_CONVERSION_TTL_SECONDS,
} from '../../../src/modules/orders/services/purchase-conversion-service.js';

/**
 * Issue #277 — the marker that says a GA4 `purchase` conversion is still owed
 * for an order, and the claim that spends it.
 *
 * The storefront cannot decide this on its own: a marker in the browser is
 * gone with the cache and never reaches the buyer's second device, and the two
 * pages that may count an order (`/checkout/success` and `/orders/:id`) are
 * different arrivals of the same conversion. So the platform holds it, and the
 * first eligible view spends it.
 */
function fakeRedis(): { redis: Redis; keys: Map<string, { value: string; ttl: number }> } {
  const keys = new Map<string, { value: string; ttl: number }>();
  const redis = {
    async set(key: string, value: string, _ex: string, ttl: number) {
      keys.set(key, { value, ttl });
      return 'OK';
    },
    async del(key: string) {
      return keys.delete(key) ? 1 : 0;
    },
  } as unknown as Redis;
  return { redis, keys };
}

describe('PurchaseConversionService', () => {
  it('opens a claim for a placed order, with an expiry', async () => {
    const { redis, keys } = fakeRedis();
    await new PurchaseConversionService(redis).open('order-1');
    expect([...keys.keys()]).toEqual(['orders:purchase-conversion:order-1']);
    expect(keys.get('orders:purchase-conversion:order-1')?.ttl).toBe(
      PURCHASE_CONVERSION_TTL_SECONDS,
    );
  });

  it('grants the conversion to the first caller and to nobody after it', async () => {
    const { redis } = fakeRedis();
    const service = new PurchaseConversionService(redis);
    await service.open('order-1');
    expect(await service.claim('order-1')).toBe(true);
    expect(await service.claim('order-1')).toBe(false);
    expect(await service.claim('order-1')).toBe(false);
  });

  it('grants nothing for an order whose claim was never opened', async () => {
    // Every order placed before this mechanism existed is one of these. The
    // old Success Page counted them already, so a first view today must not
    // report their revenue a second time against today's date.
    const { redis } = fakeRedis();
    expect(await new PurchaseConversionService(redis).claim('legacy-order')).toBe(false);
  });

  it('keeps the claims of two orders separate', async () => {
    const { redis } = fakeRedis();
    const service = new PurchaseConversionService(redis);
    await service.open('order-1');
    await service.open('order-2');
    expect(await service.claim('order-1')).toBe(true);
    expect(await service.claim('order-2')).toBe(true);
  });
});
