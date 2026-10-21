import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  PricingCache,
  type PricingCacheKey,
  type ProfilePricingCacheKey,
} from './pricing-cache.js';
import { BookPricing, type BookLineAnswer } from './book-pricing.js';
import { PricingGeneration } from './pricing-generation.js';
import { PRECEDENCE_PRESETS } from './precedence.js';
import type { PricingProfile, ProfileMemoKey } from './pricing-profile.js';

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

  it('refuses a fill that began before an invalidation (the stale re-cache race)', () => {
    const cache = new PricingCache<string>();
    // A resolution reads the generation, then the database; a write commits
    // and invalidates while it is still reading. Storing its answer would pin
    // the pre-write price for a whole TTL.
    const before = cache.generation;
    cache.invalidateAll();
    cache.set(baseKey, 'stale', before);
    expect(cache.get(baseKey)).toBeUndefined();
    // A fill that began after the invalidation is stored.
    cache.set(baseKey, 'fresh', cache.generation);
    expect(cache.get(baseKey)).toBe('fresh');
  });
});

/**
 * Feature 160 (D-287 §6 point 2, research R6) — the price-book engine's cache
 * is keyed by the **pricing profile**, not the organization: two buyers who
 * meet the same books share entries, and a bump of the pricing generation
 * drops them.
 */
describe('PricingCache — keyed by pricing profile (feature 160)', () => {
  const GROUP_BOOK = { id: 'book-vip', member: 'vip' };

  /** An engine over a stub `EntityManager` that counts the row reads. */
  function engine() {
    const reads = { rows: 0, books: 0 };
    const em = {
      findOne: async () => ({ currencies: ['PLN'] }),
      execute: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('price_list_precedence')) {
          return [
            {
              version: 1,
              cells: PRECEDENCE_PRESETS.HY.cells,
              category_before_attribute: true,
              depth_mode: 'within_cell',
            },
          ];
        }
        if (sql.includes('price_list_audience_members')) {
          reads.books += 1;
          const group = params[1];
          return [
            { id: 'base', name: 'Base', type: 'regular', audience_kind: 'everyone', priority: 0, is_system: true, member_organization_id: null, member_customer_group_id: null },
            ...(group === GROUP_BOOK.member
              ? [{ id: GROUP_BOOK.id, name: 'VIP', type: 'regular', audience_kind: 'customer_groups', priority: 0, is_system: false, member_organization_id: null, member_customer_group_id: 'vip' }]
              : []),
          ];
        }
        reads.rows += 1;
        return [
          { id: 'r-base', price_list_id: 'base', variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '100.0000', percent: null },
          { id: 'r-vip', price_list_id: GROUP_BOOK.id, variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'percent', amount: null, percent: '-10.00' },
        ];
      },
    } as unknown as EntityManager;
    const cache = new PricingCache<BookLineAnswer, ProfilePricingCacheKey>({ ttlMs: 60_000 });
    const profileMemo = new PricingCache<PricingProfile, ProfileMemoKey>({ ttlMs: 60_000 });
    const books = new BookPricing({
      emFactory: () => em,
      channelBridge: { entityIdsInChannelSubquery: () => ({ sql: 'select 1', params: [] }) },
      categoryRead: () => ({ listAssignmentsForProducts: async () => [] }) as never,
      attributeRead: () => ({ listByFlag: async () => [] }) as never,
      displayModes: async () => new Map(),
      cache,
      profileMemo,
    });
    const generation = new PricingGeneration({
      invalidateAll: () => {
        cache.invalidateAll();
        profileMemo.invalidateAll();
        books.invalidateAll();
      },
    });
    const ask = (organizationId: string) =>
      books.resolve(
        [{ key: 'k', product: { id: 'p1', attributeValues: {} }, quantity: 1 }],
        { organizationId, customerGroupId: 'vip', signedIn: true, salesChannelId: 'ch', currencyCode: 'PLN' },
      );
    return { reads, ask, generation };
  }

  it('two organizations meeting the same books share one entry', async () => {
    const { reads, ask } = engine();
    const acme = await ask('acme');
    const beta = await ask('beta');
    expect(acme.get('k')?.resolution.price?.amount).toBe('90.0000');
    expect(beta.get('k')?.resolution.price?.amount).toBe('90.0000');
    // Beta's profile is resolved (its own memo key), its price is not.
    expect(reads.books).toBe(2);
    expect(reads.rows).toBe(1);
  });

  it('a bump of the pricing generation drops the entries', async () => {
    const { reads, ask, generation } = engine();
    await ask('acme');
    await generation.bump();
    await ask('acme');
    expect(reads.rows).toBe(2);
    expect(reads.books).toBe(2);
  });
});

