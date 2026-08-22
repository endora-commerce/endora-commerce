import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { createNamedListPriceResolver } from '../../../src/modules/product_feeds/services/named-list-price-resolver.js';
import type { NamedListPricePort } from '../../../src/modules/product_feeds/services/named-list-price-resolver.js';

/**
 * Issue #132 — a feed pinned to a named price list reads that list through the
 * `pricingService` port.
 *
 * It used to `select ... from price_list_price_brackets` directly, which is two
 * defects at once: `product_feeds` reaching into another module's table
 * (Principle I), and a feed publishing prices from a module the platform may be
 * refusing to serve — the port gate never ran, so `MODULE_DISABLED` could not
 * happen and the run completed with prices nobody was standing behind.
 */

function portReturning(prices: Record<string, string>): NamedListPricePort {
  return {
    namedListPrices: async ({ productIds }) => {
      const out = new Map<string, string>();
      for (const id of productIds) {
        const amount = prices[id];
        if (amount !== undefined) out.set(id, amount);
      }
      return out;
    },
  };
}

const LIST = '11111111-1111-4111-8111-111111111111';

describe('named price list resolution goes through the port (#132)', () => {
  it('resolves one product to the list amount', async () => {
    const resolve = createNamedListPriceResolver(portReturning({ p1: '42.50' }));
    await expect(
      resolve.one({ priceListId: LIST, productId: 'p1', currencyCode: 'PLN' }),
    ).resolves.toBe(42.5);
  });

  it('resolves an amount of zero to zero, not to "no price"', async () => {
    const resolve = createNamedListPriceResolver(portReturning({ p1: '0.00' }));
    await expect(
      resolve.one({ priceListId: LIST, productId: 'p1', currencyCode: 'PLN' }),
    ).resolves.toBe(0);
  });

  it('answers null for a product the list does not price', async () => {
    const resolve = createNamedListPriceResolver(portReturning({}));
    await expect(
      resolve.one({ priceListId: LIST, productId: 'p1', currencyCode: 'PLN' }),
    ).resolves.toBeNull();
  });

  it('resolves a batch, omitting products the list does not price', async () => {
    const resolve = createNamedListPriceResolver(portReturning({ p1: '10.00', p3: '0.00' }));
    const out = await resolve.many({
      priceListId: LIST,
      productIds: ['p1', 'p2', 'p3'],
      currencyCode: 'PLN',
    });
    expect([...out.entries()]).toEqual([
      ['p1', 10],
      ['p3', 0],
    ]);
  });

  it('asks nothing when there are no products', async () => {
    let called = false;
    const resolve = createNamedListPriceResolver({
      namedListPrices: async () => {
        called = true;
        return new Map();
      },
    });
    await expect(
      resolve.many({ priceListId: LIST, productIds: [], currencyCode: 'PLN' }),
    ).resolves.toEqual(new Map());
    expect(called).toBe(false);
  });

  it('lets a switched-off pricing module refuse the feed instead of pricing it', async () => {
    const resolve = createNamedListPriceResolver({
      namedListPrices: async () => {
        throw new ModuleDisabledError('price_lists');
      },
    });
    let thrown: unknown;
    try {
      await resolve.one({ priceListId: LIST, productId: 'p1', currencyCode: 'PLN' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ModuleDisabledError);
    expect((thrown as ModuleDisabledError).statusCode).toBe(503);
    expect((thrown as ModuleDisabledError).code).toBe(ERROR_CODES.MODULE_DISABLED);
  });
});
