import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getResolvedPrice,
  getProductDisplayMode,
  PRICING_UNAVAILABLE,
} from '../../lib/api/pricing';

/**
 * Issue #124, the storefront half.
 *
 * `getResolvedPrice` used to `catch {}` every failure into `null`, and the
 * callers read `null` as "the engine has nothing to say" and rendered the
 * catalogue's legacy `defaultPrice` projection instead. So an absent
 * `price_lists` reached the buyer as a **price**, on a product page with a
 * working Add-to-cart button that could only ever 503.
 *
 * The two answers must stay apart at the API boundary:
 *
 *  - `null` — the engine answered, and no price list applies;
 *  - `PRICING_UNAVAILABLE` — the module is not there, and no figure on this
 *    page is anybody's.
 */

const originalFetch = globalThis.fetch;

function stubFetch(body: unknown, status = 200): void {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('getResolvedPrice — an absent pricing module is not "no price"', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports a MODULE_DISABLED refusal as an absence, not as a missing price', async () => {
    stubFetch(
      { error: { code: 'MODULE_DISABLED', message: "Module 'price_lists' is currently disabled." } },
      503,
    );
    await expect(getResolvedPrice('p1')).resolves.toBe(PRICING_UNAVAILABLE);
  });

  it('still answers `null` when the engine is there and nothing applies', async () => {
    stubFetch({ error: { code: 'NOT_FOUND', message: 'No price for this product.' } }, 404);
    await expect(getResolvedPrice('p1')).resolves.toBeNull();
  });

  it('answers the resolved price when there is one', async () => {
    stubFetch({
      data: {
        resolvedPrice: {
          baseListId: 'l1',
          basePrice: { amount: '10.00', currency: 'PLN' },
          saleListId: null,
          salePrice: null,
          displayMode: 'net_only',
          currencyCode: 'PLN',
          quantityBracket: null,
        },
      },
    });
    const resolved = await getResolvedPrice('p1');
    expect(resolved).toMatchObject({ baseListId: 'l1' });
  });

  it('reports the same absence for the display mode', async () => {
    stubFetch(
      { error: { code: 'MODULE_DISABLED', message: "Module 'price_lists' is currently disabled." } },
      503,
    );
    await expect(getProductDisplayMode('p1')).resolves.toBe(PRICING_UNAVAILABLE);
  });
});
