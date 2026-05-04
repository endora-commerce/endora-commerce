import { describe, expect, it } from 'vitest';
import {
  PricingCache,
  type PricingCacheKey,
} from '../../../src/modules/price_lists/services/pricing-cache.js';

const baseKey: PricingCacheKey = {
  productId: 'p1',
  variantId: null,
  quantity: 1,
  currencyCode: 'PLN',
  salesChannelId: 'ch1',
  organizationId: null,
  customerGroupId: null,
};

describe('PricingCache', () => {
  it('returns undefined on miss and stores on set', () => {
    const cache = new PricingCache<{ amount: string }>();
    expect(cache.get(baseKey)).toBeUndefined();
    cache.set(baseKey, { amount: '100.00' });
    expect(cache.get(baseKey)).toEqual({ amount: '100.00' });
  });

  it('discriminates entries by every tuple component', () => {
    const cache = new PricingCache<string>();
    cache.set(baseKey, 'A');
    expect(cache.get({ ...baseKey, productId: 'p2' })).toBeUndefined();
    expect(cache.get({ ...baseKey, variantId: 'v1' })).toBeUndefined();
    expect(cache.get({ ...baseKey, quantity: 2 })).toBeUndefined();
    expect(cache.get({ ...baseKey, currencyCode: 'EUR' })).toBeUndefined();
    expect(cache.get({ ...baseKey, salesChannelId: 'ch2' })).toBeUndefined();
    expect(cache.get({ ...baseKey, organizationId: 'o1' })).toBeUndefined();
    expect(cache.get({ ...baseKey, customerGroupId: 'cg1' })).toBeUndefined();
    expect(cache.get(baseKey)).toBe('A');
  });

  it('honours invalidateAll', () => {
    const cache = new PricingCache<number>();
    cache.set(baseKey, 1);
    cache.set({ ...baseKey, productId: 'p2' }, 2);
    expect(cache.stats().size).toBe(2);
    cache.invalidateAll();
    expect(cache.stats().size).toBe(0);
    expect(cache.get(baseKey)).toBeUndefined();
  });

  it('disables itself when ttlMs <= 0', () => {
    const cache = new PricingCache<number>({ ttlMs: 0 });
    cache.set(baseKey, 42);
    expect(cache.get(baseKey)).toBeUndefined();
    expect(cache.stats().size).toBe(0);
  });

  it('evicts the oldest entry when capacity is reached', () => {
    const cache = new PricingCache<number>({ capacity: 3 });
    cache.set({ ...baseKey, productId: 'a' }, 1);
    cache.set({ ...baseKey, productId: 'b' }, 2);
    cache.set({ ...baseKey, productId: 'c' }, 3);
    expect(cache.stats().size).toBe(3);
    cache.set({ ...baseKey, productId: 'd' }, 4);
    expect(cache.stats().size).toBe(3);
    expect(cache.get({ ...baseKey, productId: 'a' })).toBeUndefined();
    expect(cache.get({ ...baseKey, productId: 'd' })).toBe(4);
  });

  it('refreshes LRU position on hit so recently-used entries survive', () => {
    const cache = new PricingCache<number>({ capacity: 2 });
    cache.set({ ...baseKey, productId: 'a' }, 1);
    cache.set({ ...baseKey, productId: 'b' }, 2);
    expect(cache.get({ ...baseKey, productId: 'a' })).toBe(1);
    cache.set({ ...baseKey, productId: 'c' }, 3);
    expect(cache.get({ ...baseKey, productId: 'b' })).toBeUndefined();
    expect(cache.get({ ...baseKey, productId: 'a' })).toBe(1);
    expect(cache.get({ ...baseKey, productId: 'c' })).toBe(3);
  });
});
