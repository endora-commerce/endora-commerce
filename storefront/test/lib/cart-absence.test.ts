import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCart, CART_UNAVAILABLE } from '../../lib/api/cart';

/**
 * Issue #132, the storefront half.
 *
 * `getCart` used a bare `fetch` and threw `new Error('GET /cart failed with
 * 503')` on any non-OK response, so a switched-off `carts` produced a Next
 * error page rather than the rendered absence feature 073 built
 * `withModuleAbsence` for. The envelope carried `MODULE_DISABLED` the whole
 * time; nothing read it.
 *
 * The asymmetry `withModuleAbsence` encodes is the point: an absent module is a
 * decision the platform made and the page renders around it, while a broken
 * backend still throws.
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

describe('getCart — an absent cart module renders as an absence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports a MODULE_DISABLED refusal as an absence rather than throwing', async () => {
    stubFetch(
      { error: { code: 'MODULE_DISABLED', message: "Module 'carts' is currently disabled." } },
      503,
    );
    await expect(getCart({})).resolves.toBe(CART_UNAVAILABLE);
  });

  it('still throws when the backend is simply broken', async () => {
    stubFetch({ error: { code: 'INTERNAL', message: 'boom' } }, 500);
    await expect(getCart({})).rejects.toThrow();
  });

  it('returns the cart when the module is there', async () => {
    stubFetch({ data: { id: 'c1', items: [], itemCount: 0 } });
    const result = await getCart({});
    expect(result).not.toBe(CART_UNAVAILABLE);
    expect(result === CART_UNAVAILABLE ? null : result.cart.id).toBe('c1');
  });
});
