import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PRODUCT_LIST_MAX_IDS, type ProductSummary } from '@endora-commerce/contracts';
import { RelatedProductsStrip } from '../../app/blog/_components/RelatedProductsStrip';
import { getBlogRelatedProducts } from '../../lib/api/blog';
import type { RequestContext } from '../../lib/api/client';
import type { ModulePresenceSet } from '../../lib/api/module-presence';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Issue #590 — a blog post's related products are read and shown the way a
 * product card on a listing is.
 *
 * The strip printed `{amount} {currency}` from a contract string (`12.50 PLN`)
 * that no shipped composition ever filled, so it never rendered at all. The post
 * payload now names the products by id (`relatedProductIds`, nothing about the
 * viewer, safe in the shared post cache), and the page reads them in **one**
 * catalogue listing read as the viewer (`?ids=`, `apiGetForViewer`): availability
 * and the price are the catalogue's and the pricing engine's answer for this
 * buyer, as on every listing. The strip renders `ProductCard` with the summary's
 * `resolvedPrice`, as the home page's cards do — so the display mode decides
 * net, gross or both, `none` is "price on request", and the amount speaks the
 * page language.
 */

const A = '11111111-2222-4333-8444-555555555555';
const B = '22222222-2222-4333-8444-555555555555';
const C = '33333333-2222-4333-8444-555555555555';

function summary(
  id: string,
  slug: string,
  resolvedPrice: ProductSummary['resolvedPrice'],
  price: ProductSummary['price'] = resolvedPrice?.basePrice
    ? { amount: Number(resolvedPrice.basePrice.amount), currency: resolvedPrice.basePrice.currency }
    : null,
): ProductSummary {
  return {
    id,
    sku: slug.toUpperCase(),
    type: 'simple',
    name: `Product ${slug}`,
    slug,
    categorySlugs: [],
    primaryAssetUrl: null,
    price,
    stockIndicator: null,
    stockLevel: null,
    resolvedPrice,
  };
}

const NET = { amount: '12.5000', currency: 'PLN' };
const priced = (displayMode: 'net_only' | 'gross_only' | 'both' | 'none'): ProductSummary =>
  summary(A, 'screw', { basePrice: NET, salePrice: null, displayMode });

/** The visible text of server-rendered markup, whitespace (and the no-break spaces Intl writes) collapsed. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;| | /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function strip(products: ProductSummary[], locale: string): string {
  return renderToString(<RelatedProductsStrip products={products} locale={locale} salesChannelCode="pl_retail" />);
}

/** A money figure in either locale's spelling. */
const AMOUNT = /\d+[.,]\d{2}/;

describe('RelatedProductsStrip renders a product card’s price (issue #590)', () => {
  it('renders nothing when there are no related products', () => {
    expect(strip([], 'en-US')).toBe('');
  });

  it('heads the strip in the page language and links every card to /p/[slug]', () => {
    const products = [priced('net_only'), summary(B, 'shiny-grommet', null)];
    const en = strip(products, 'en-US');
    expect(en).toContain('>Related products</h2>');
    expect(en).toContain('href="/p/screw"');
    expect(en).toContain('href="/p/shiny-grommet"');
    expect(en).not.toContain('/products/');
    expect(strip(products, 'pl-PL')).toContain('>Powiązane produkty</h2>');
  });

  it('formats a net price for the page locale — pl-PL and en-US — and never as the raw contract string', () => {
    const pl = text(strip([priced('net_only')], 'pl-PL'));
    expect(pl).toContain('12,50 zł');
    expect(pl).toContain('netto');
    const en = text(strip([priced('net_only')], 'en-US'));
    expect(en).toContain('PLN 12.50');
    expect(en).toContain('net');
    expect(pl).not.toContain('12.50 PLN');
    expect(en).not.toContain('12.50 PLN');
  });

  it('shows the gross under `gross_only`, derived half-up from the net', () => {
    // 12.50 × 1.23 = 15.375 → 15.38 (grossUnitPriceHalfUp).
    const pl = text(strip([priced('gross_only')], 'pl-PL'));
    expect(pl).toContain('15,38 zł');
    expect(pl).toContain('brutto');
    expect(pl).not.toContain('12,50 zł');
    const en = text(strip([priced('gross_only')], 'en-US'));
    expect(en).toContain('PLN 15.38');
    expect(en).toContain('gross');
  });

  it('shows both under `both`', () => {
    const pl = text(strip([priced('both')], 'pl-PL'));
    expect(pl).toContain('12,50 zł');
    expect(pl).toContain('15,38 zł');
  });

  it('keeps a sub-cent unit price’s significant places', () => {
    const subCent = summary(A, 'screw', {
      basePrice: { amount: '0.0125', currency: 'PLN' },
      salePrice: null,
      displayMode: 'net_only',
    });
    expect(text(strip([subCent], 'pl-PL'))).toContain('0,0125 zł');
  });

  it('shows "price on request" and no figure under `none`', () => {
    const withheld = summary(A, 'screw', { basePrice: null, salePrice: null, displayMode: 'none' }, null);
    const out = text(strip([withheld], 'en-US'));
    expect(out).toContain(tForLocale('en-US')('commerce.common.priceOnRequest'));
    expect(out).not.toMatch(AMOUNT);
  });

  it('shows no figure for a product nothing prices', () => {
    const unpriced = summary(A, 'screw', { basePrice: null, salePrice: null, displayMode: 'gross_only' }, null);
    expect(text(strip([unpriced], 'pl-PL'))).not.toMatch(AMOUNT);
    const noResolution = summary(A, 'screw', null, null);
    expect(text(strip([noResolution], 'pl-PL'))).toContain(tForLocale('pl-PL')('product.requestQuote'));
  });

  it('renders the cards in the order it is given', () => {
    const html = strip([summary(C, 'third', null), summary(A, 'first', null), summary(B, 'second', null)], 'en-US');
    expect(html.indexOf('/p/third')).toBeLessThan(html.indexOf('/p/first'));
    expect(html.indexOf('/p/first')).toBeLessThan(html.indexOf('/p/second'));
  });
});

describe('getBlogRelatedProducts — one listing read, as the viewer (issue #590)', () => {
  const originalFetch = globalThis.fetch;
  let calls: Array<{ url: string; init: RequestInit & { next?: unknown } }> = [];

  function stubFetch(respond: () => Response): void {
    calls = [];
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return respond();
    }) as unknown as typeof fetch;
  }
  const listing = (data: ProductSummary[]) => () =>
    new Response(JSON.stringify({ data, pagination: { limit: data.length, cursor: null, hasMore: false } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const ANONYMOUS: RequestContext = { salesChannelCode: 'pl_retail', locale: 'pl-PL', currency: 'EUR' };
  const SIGNED_IN: RequestContext = { ...ANONYMOUS, viewerSession: 'a-buyer-session' };
  const present = (catalog: boolean): ModulePresenceSet => ({
    isPresent: (id) => (id === 'catalog' ? catalog : true),
    presentIds: [],
    absentIds: catalog ? [] : ['catalog'],
  });

  it('asks once for every id, keeps the post’s order and drops what the catalogue did not answer', async () => {
    // The listing answers in its own order and leaves out a product the viewer may not see (B).
    stubFetch(listing([summary(A, 'a', null), summary(C, 'c', null)]));
    const out = await getBlogRelatedProducts([C, B, A], ANONYMOUS, present(true));
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/v1/catalog/products');
    expect(url.searchParams.get('ids')).toBe(`${C},${B},${A}`);
    expect(url.searchParams.get('limit')).toBe('3');
    expect(url.searchParams.get('currency')).toBe('EUR');
    expect(out.map((p) => p.id)).toEqual([C, A]);
  });

  it('forwards a signed-in buyer’s session and lets no shared cache keep the answer', async () => {
    stubFetch(listing([]));
    await getBlogRelatedProducts([A], SIGNED_IN, present(true));
    const init = calls[0]!.init;
    expect((init.headers as Record<string, string>)['Cookie']).toBe('b2b_session=a-buyer-session');
    expect(init.cache).toBe('no-store');
    expect(init.next).toBeUndefined();
  });

  it(`names at most ${PRODUCT_LIST_MAX_IDS} products, the first ones of the post`, async () => {
    stubFetch(listing([]));
    const many = Array.from({ length: PRODUCT_LIST_MAX_IDS + 3 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await getBlogRelatedProducts(many, ANONYMOUS, present(true));
    expect(new URL(calls[0]!.url).searchParams.get('ids')).toBe(many.slice(0, PRODUCT_LIST_MAX_IDS).join(','));
  });

  it('does not ask when the post names no product', async () => {
    stubFetch(listing([]));
    expect(await getBlogRelatedProducts([], ANONYMOUS, present(true))).toEqual([]);
    expect(await getBlogRelatedProducts(undefined, ANONYMOUS, present(true))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('does not ask, and shows nothing, while the catalogue is not present', async () => {
    stubFetch(listing([summary(A, 'a', null)]));
    expect(await getBlogRelatedProducts([A], ANONYMOUS, present(false))).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('is an absence when the catalogue answers MODULE_DISABLED, and when the read fails', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { code: 'MODULE_DISABLED', message: 'off' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    );
    expect(await getBlogRelatedProducts([A], ANONYMOUS, present(true))).toEqual([]);
    stubFetch(() => new Response('boom', { status: 500 }));
    expect(await getBlogRelatedProducts([A], ANONYMOUS, present(true))).toEqual([]);
  });
});
