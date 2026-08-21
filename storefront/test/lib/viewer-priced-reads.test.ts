import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProductDisplayMode,
  getResolvedPrice,
  getResolvedPricesBulk,
} from '../../lib/api/pricing';
import { getCategoryTree, getProductBySlug, listProducts } from '../../lib/api/catalog';
import { withoutViewer, type RequestContext } from '../../lib/api/client';

/**
 * Issue #265 — what the storefront sends, and what it lets a shared cache keep.
 *
 * `getResolvedPrice` called the **per-customer** endpoint through `apiGet`,
 * which forwards no credential at all, with `{ revalidate: 60 }`, which puts
 * the answer in a cache every visitor reads. Two properties, and each one alone
 * makes the call anonymous: the backend cannot tell who is asking, and the
 * answer would be shared even if it could.
 *
 * The tests below assert the request rather than the price, because that is
 * where both halves of the defect live and because it is the half an SSR-only
 * harness can see. The price itself — that the buyer's organisation resolves to
 * the buyer's list — is asserted against a live engine in
 * `backend/test/integration/price_lists/viewer-priced-resolved-price.test.ts`.
 *
 * Two directions matter and they fail differently:
 *
 *  - a signed-in buyer's request that carries no cookie is quoted the public
 *    price, which is the defect;
 *  - a signed-in buyer's request that carries a cookie **and** a `revalidate`
 *    window stores one organisation's negotiated figure under a URL every other
 *    caller computes, which is worse than the defect.
 */

interface RecordedCall {
  url: string;
  init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };
}

const originalFetch = globalThis.fetch;
let calls: RecordedCall[] = [];

function stubFetch(body: unknown): void {
  calls = [];
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RecordedCall['init'] });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function headerOf(call: RecordedCall, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

const RESOLVED_PRICE_BODY = {
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
};

const DISPLAY_MODE_BODY = { data: { displayMode: 'net_only' } };

const LISTING_BODY = {
  data: [],
  pagination: { limit: 4, nextCursor: null, hasMore: false },
};

const ANONYMOUS: RequestContext = { salesChannelCode: 'pl_retail', locale: 'en-US' };
const SIGNED_IN: RequestContext = { ...ANONYMOUS, viewerSession: 'a-buyer-session' };

describe('the storefront asks the price question as the viewer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('getResolvedPrice', () => {
    it('sends the buyer their own question — cookie forwarded, nothing shared', async () => {
      stubFetch(RESOLVED_PRICE_BODY);
      await getResolvedPrice('p1', { quantity: 1 }, SIGNED_IN);

      const call = calls[0]!;
      expect(call.url).toContain('/api/v1/storefront/products/p1/resolved-price');
      expect(headerOf(call, 'Cookie')).toBe('b2b_session=a-buyer-session');
      expect(call.init.cache).toBe('no-store');
      // Not merely "revalidate is 0": Next's Data Cache is keyed on the URL and
      // not on the credential, so any `next` option at all here would store one
      // buyer's negotiated figure under a key every other buyer also computes.
      expect(call.init.next).toBeUndefined();
    });

    it('leaves the anonymous request exactly as it was', async () => {
      stubFetch(RESOLVED_PRICE_BODY);
      await getResolvedPrice('p1', { quantity: 1 }, ANONYMOUS);

      const call = calls[0]!;
      expect(headerOf(call, 'Cookie')).toBeUndefined();
      expect(headerOf(call, 'X-Sales-Channel')).toBe('pl_retail');
      expect(headerOf(call, 'Accept-Language')).toBe('en-US');
      // The crawler's representation and the storefront's 60 s window
      // (Principle VII) are the ones that shipped before this change.
      expect(call.init.next).toEqual({
        revalidate: 60,
        tags: ['pricing:resolved', 'pricing:product:p1'],
      });
      expect(call.init.cache).toBeUndefined();
    });

    it('carries the viewer through the bulk wrapper too', async () => {
      // The home page's bestseller cards are the second surface this renders,
      // and they go through the fan-out rather than the singular call. A
      // wrapper that dropped the context would put the public price on the
      // cards and the buyer's on the product page they link to.
      stubFetch(RESOLVED_PRICE_BODY);
      await getResolvedPricesBulk(['p1', 'p2'], {}, SIGNED_IN);

      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(headerOf(call, 'Cookie')).toBe('b2b_session=a-buyer-session');
        expect(call.init.cache).toBe('no-store');
      }
    });
  });

  describe('getProductDisplayMode', () => {
    // Issue #271. Net-versus-gross is the same "who is asking" question the
    // price is, and the cart is the surface that asks it: this call went
    // through `apiGet` with a 60 s shared window, so the backend could not tell
    // a signed-in buyer from the public and the answer would have been shared
    // even after the backend learned to.
    it('asks as the viewer, and lets no shared cache keep the answer', async () => {
      stubFetch(DISPLAY_MODE_BODY);
      await getProductDisplayMode('p1', SIGNED_IN);

      const call = calls[0]!;
      expect(call.url).toContain('/api/v1/storefront/pricing/display-mode/p1');
      expect(headerOf(call, 'Cookie')).toBe('b2b_session=a-buyer-session');
      expect(call.init.cache).toBe('no-store');
      expect(call.init.next).toBeUndefined();
    });

    it('leaves the anonymous request exactly as it was', async () => {
      stubFetch(DISPLAY_MODE_BODY);
      await getProductDisplayMode('p1', ANONYMOUS);

      const call = calls[0]!;
      expect(headerOf(call, 'Cookie')).toBeUndefined();
      expect(headerOf(call, 'X-Sales-Channel')).toBe('pl_retail');
      expect(call.init.next).toEqual({
        revalidate: 60,
        tags: ['pricing:display-mode', 'pricing:product:p1'],
      });
      expect(call.init.cache).toBeUndefined();
    });
  });

  describe('the catalogue reads that carry a price', () => {
    it('asks the listing as the viewer', async () => {
      stubFetch(LISTING_BODY);
      await listProducts({ limit: 4 }, SIGNED_IN);

      const call = calls[0]!;
      expect(headerOf(call, 'Cookie')).toBe('b2b_session=a-buyer-session');
      expect(call.init.next).toBeUndefined();
    });

    it('asks the product detail as the viewer', async () => {
      stubFetch({ data: { id: 'p1' } });
      await getProductBySlug('a-slug', SIGNED_IN);

      expect(headerOf(calls[0]!, 'Cookie')).toBe('b2b_session=a-buyer-session');
    });

    it('leaves a read that carries no price anonymous and shared', async () => {
      // The category tree has no price in it, so personalising it would buy
      // nothing and cost the shared cache entry every visitor to every
      // catalogue page reuses.
      stubFetch({ data: [] });
      await getCategoryTree(SIGNED_IN);

      const call = calls[0]!;
      expect(headerOf(call, 'Cookie')).toBeUndefined();
      expect(call.init.next).toEqual({ revalidate: 300, tags: ['catalog:categories'] });
    });
  });

  describe('withoutViewer', () => {
    it('drops the credential and keeps the rest of the context', () => {
      expect(withoutViewer(SIGNED_IN)).toEqual(ANONYMOUS);
    });

    it('makes the read it guards indistinguishable from an anonymous one', async () => {
      // `generateMetadata` on the PDP: the crawler's and the social card's
      // answer, on a page a buyer may well be signed in to.
      stubFetch({ data: { id: 'p1' } });
      await getProductBySlug('a-slug', withoutViewer(SIGNED_IN));

      const call = calls[0]!;
      expect(headerOf(call, 'Cookie')).toBeUndefined();
      expect(call.init.next).toEqual({
        revalidate: 60,
        tags: ['catalog:product', 'catalog:product:a-slug'],
      });
    });
  });
});
