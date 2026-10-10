import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { CatalogPreviewProvider } from '@endora-commerce/cms-components/components/catalog-preview-context';
import type { CatalogBlockData as ResolvedCatalogBlockData } from '@endora-commerce/cms-components/utils/catalog-block-data';
import { BlockRenderScope } from '../../components/BlockRenderScope';
import { CatalogBlockData } from '../../components/CatalogBlockData';
import { PageBuilderRender } from '../../components/PageBuilderRender';
import type { RequestContext } from '../../lib/api/client';
import { resolveCatalogBlockDataFor } from '../../lib/page-builder/catalog-block-data';

/**
 * Catalogue blocks on a CMS page are part of the server-rendered HTML.
 *
 * `ProductGrid`, `ProductSlider`, `ProductCard`, `CategoryList` and
 * `CategoryGrid` used to fill themselves in from an effect, so the document a
 * crawler, a link preview or a browser without JavaScript received held their
 * loading branch and no product at all (Constitution VII). The storefront now
 * resolves what each block declares while it renders the page and hands the
 * result down through the catalogue provider.
 *
 * Three things are pinned here:
 *
 *   - **the render** — every block, given data, writes the names it shows into
 *     the HTML; given none (the editor's preview, which has no server) it
 *     renders the loading branch it always did;
 *   - **the request** — the reads go through the storefront's own catalogue
 *     readers, so they carry the request's sales channel, language and the
 *     signed-in buyer's session, and a buyer's answer is never stored where
 *     another caller could read it;
 *   - **the failure** — a read that fails costs the page that one block.
 *
 * Harness: `renderToString`, `environment: 'node'`, no jsdom. The backend is a
 * stubbed `fetch`, so what is asserted about a request is what was sent.
 */

interface RecordedCall {
  url: string;
  init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };
}

const originalFetch = globalThis.fetch;
let calls: RecordedCall[] = [];

function summary(slug: string, name: string): Record<string, unknown> {
  return {
    id: `id-${slug}`,
    sku: `SKU-${slug}`,
    type: 'simple',
    name,
    slug,
    categorySlugs: [],
    primaryAssetUrl: null,
    price: { amount: 129.5, currency: 'EUR' },
    stockIndicator: null,
    stockLevel: null,
  };
}

const PRODUCTS: Record<string, Record<string, unknown>> = {
  'cordless-drill': {
    ...summary('cordless-drill', 'Cordless Drill 18V'),
    // Detail-only fields: the block shows none of them, so none may reach the page payload.
    description: 'A detail-only description that no block renders.',
    variants: [],
  },
  'claw-hammer': summary('claw-hammer', 'Claw Hammer 450g'),
};

const LISTED = [summary('impact-driver', 'Impact Driver'), summary('angle-grinder', 'Angle Grinder')];

const CATEGORY_TREE = [
  {
    id: 'c1',
    name: 'Power Tools',
    slug: 'power-tools',
    sortOrder: 0,
    productCount: 12,
    children: [{ id: 'c2', name: 'Drills', slug: 'drills', sortOrder: 0, productCount: 5, children: [] }],
  },
  { id: 'c3', name: 'Hand Tools', slug: 'hand-tools', sortOrder: 1, productCount: 7, children: [] },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A backend that answers the three catalogue reads; `failing` names path fragments answered 503. */
function stubBackend(failing: readonly string[] = []): void {
  calls = [];
  globalThis.fetch = vi.fn(async (input: unknown, init: unknown) => {
    const url = String(input);
    calls.push({ url, init: (init ?? {}) as RecordedCall['init'] });
    const { pathname } = new URL(url);
    if (failing.some((fragment) => url.includes(fragment))) {
      return json({ error: { code: 'UNAVAILABLE', message: 'down' } }, 503);
    }
    if (pathname === '/api/v1/catalog/categories') return json({ data: CATEGORY_TREE });
    if (pathname === '/api/v1/catalog/products') {
      return json({ data: LISTED, pagination: { limit: 12, cursor: null, hasMore: false } });
    }
    const slug = decodeURIComponent(pathname.replace('/api/v1/catalog/products/', ''));
    const found = PRODUCTS[slug];
    return found ? json({ data: found }) : json({ error: { code: 'NOT_FOUND', message: 'no' } }, 404);
  }) as unknown as typeof fetch;
}

function headerOf(call: RecordedCall, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const CTX: RequestContext = { salesChannelCode: 'b2b-eu', locale: 'en-US', currency: 'EUR' };

function documentOf(...content: Record<string, unknown>[]): Record<string, unknown> {
  return { root: { props: {} }, content, zones: {} };
}

const BLOCKS = {
  grid: { type: 'catalog.ProductGrid', props: { id: 'grid', source: 'manual', productSlugs: ['cordless-drill', 'claw-hammer'] } },
  slider: { type: 'catalog.ProductSlider', props: { id: 'slider', source: 'category', categorySlug: 'power-tools', limit: 8 } },
  card: { type: 'catalog.ProductCard', props: { id: 'card', productSlug: 'cordless-drill' } },
  categoryList: { type: 'catalog.CategoryList', props: { id: 'list', selectionMode: 'all' } },
  categoryGrid: { type: 'catalog.CategoryGrid', props: { id: 'cgrid', selectionMode: 'childrenOf', parentSlug: 'power-tools' } },
  heading: { type: 'cms.RichContent', props: { id: 'rc', html: '<p>Everything for the workshop.</p>' } },
} as const;

function inScope(children: ReactElement): string {
  return renderToString(
    <BlockRenderScope presence={{ absent: [] }} language="en-US">
      {children}
    </BlockRenderScope>,
  );
}

/** The page as the storefront renders it: resolved on the server, then handed to the blocks. */
async function renderResolved(document: Record<string, unknown>, ctx: RequestContext = CTX): Promise<string> {
  const data = await resolveCatalogBlockDataFor([document], ctx);
  return renderWith(document, data);
}

function renderWith(document: Record<string, unknown>, data: ResolvedCatalogBlockData): string {
  return inScope(
    <CatalogPreviewProvider data={data}>
      <PageBuilderRender data={document} />
    </CatalogPreviewProvider>,
  );
}

/** The same tree with no catalogue provider above it — the editor preview's situation. */
function renderWithoutData(document: Record<string, unknown>): string {
  return inScope(<PageBuilderRender data={document} />);
}

describe('a catalogue block given its data', () => {
  it('server-renders the products of a product grid', async () => {
    stubBackend();
    const html = await renderResolved(documentOf(BLOCKS.grid));

    expect(html).toContain('Cordless Drill 18V');
    expect(html).toContain('Claw Hammer 450g');
    expect(html).toContain('href="/p/cordless-drill"');
    expect(html).not.toContain('cmsc-pb-skel-');
  });

  it('server-renders the products of a product slider', async () => {
    stubBackend();
    const html = await renderResolved(documentOf(BLOCKS.slider));

    expect(html).toContain('Impact Driver');
    expect(html).toContain('Angle Grinder');
    expect(html).not.toContain('cmsc-pb-skel-');
  });

  it('server-renders the product of a product card', async () => {
    stubBackend();
    const html = await renderResolved(documentOf(BLOCKS.card));

    expect(html).toContain('Cordless Drill 18V');
    expect(html).not.toContain('Loading product');
  });

  it('server-renders the categories of a category list, as links a crawler can follow', async () => {
    stubBackend();
    const html = await renderResolved(documentOf(BLOCKS.categoryList));

    expect(html).toContain('Power Tools');
    expect(html).toContain('Hand Tools');
    expect(html).toContain('href="/c/drills"');
    expect(html).not.toContain('cmsc-pb-skel-');
  });

  it('server-renders the categories of a category grid', async () => {
    stubBackend();
    const html = await renderResolved(documentOf(BLOCKS.categoryGrid));

    expect(html).toContain('Drills');
    expect(html).not.toContain('Hand Tools');
    expect(html).not.toContain('cmsc-pb-skel-');
  });

  it('resolves a whole page through the server component the page renderer mounts', async () => {
    stubBackend();
    const document = documentOf(BLOCKS.heading, BLOCKS.grid, BLOCKS.categoryList);
    const element = await CatalogBlockData({
      documents: [document],
      ctx: CTX,
      children: <PageBuilderRender data={document} />,
    });

    const html = inScope(element as ReactElement);

    expect(html).toContain('Everything for the workshop.');
    expect(html).toContain('Cordless Drill 18V');
    expect(html).toContain('Power Tools');
  });
});

describe('a catalogue block given no data', () => {
  it('renders its loading branch, as the editor preview does before its fetch answers', () => {
    const html = renderWithoutData(
      documentOf(BLOCKS.grid, BLOCKS.slider, BLOCKS.categoryList, BLOCKS.categoryGrid),
    );

    expect(html).toContain('cmsc-pb-skel-');
    expect(html).not.toContain('Cordless Drill 18V');
    expect(renderWithoutData(documentOf(BLOCKS.card))).toContain('Loading product');
  });

  it('renders its empty state, not a skeleton, when the server resolved nothing for it', () => {
    const html = renderWith(
      documentOf(BLOCKS.heading, BLOCKS.grid, BLOCKS.slider, BLOCKS.card, BLOCKS.categoryList, BLOCKS.categoryGrid),
      {},
    );

    expect(html).toContain('Everything for the workshop.');
    expect(html).toContain('No products found');
    expect(html).toContain('Product unavailable');
    expect(html).toContain('No categories found');
    expect(html).not.toContain('cmsc-pb-skel-');
    expect(html).not.toContain('Loading product');
  });
});

describe('the reads behind a page of catalogue blocks', () => {
  const page = documentOf(BLOCKS.grid, BLOCKS.slider, BLOCKS.card, BLOCKS.categoryList, BLOCKS.categoryGrid);

  it('carries the sales channel and the language of the request on every read', async () => {
    stubBackend();
    await resolveCatalogBlockDataFor([page], CTX);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url.startsWith('http://api.test/api/v1/catalog/')).toBe(true);
      expect(headerOf(call, 'X-Sales-Channel')).toBe('b2b-eu');
      expect(headerOf(call, 'Accept-Language')).toBe('en-US');
    }
  });

  it('asks for each product once, for the category tree once, and for a listing with its own filter', async () => {
    stubBackend();
    await resolveCatalogBlockDataFor([page], CTX);

    const paths = calls.map((call) => call.url.replace('http://api.test', '')).sort();
    expect(paths).toEqual([
      '/api/v1/catalog/categories',
      '/api/v1/catalog/products/claw-hammer',
      '/api/v1/catalog/products/cordless-drill',
      '/api/v1/catalog/products?limit=8&filter%5Bcategory%5D=power-tools',
    ]);
  });

  it('reads anonymously, and from the shared cache, for a visitor with no session', async () => {
    stubBackend();
    await resolveCatalogBlockDataFor([page], CTX);

    for (const call of calls) {
      expect(headerOf(call, 'Cookie')).toBeUndefined();
      expect(call.init.next?.revalidate).toBeTypeOf('number');
    }
  });

  it('reads the priced products as the signed-in buyer, and stores none of those answers', async () => {
    stubBackend();
    await resolveCatalogBlockDataFor([page], { ...CTX, viewerSession: 'buyer-session' });

    const priced = calls.filter((call) => call.url.includes('/catalog/products'));
    expect(priced).toHaveLength(3);
    for (const call of priced) {
      expect(headerOf(call, 'Cookie')).toBe('b2b_session=buyer-session');
      expect(call.init.cache).toBe('no-store');
      expect(call.init.next).toBeUndefined();
    }
  });

  it('hands the page only the fields a block renders', async () => {
    stubBackend();
    const data = await resolveCatalogBlockDataFor([documentOf(BLOCKS.card)], CTX);

    const serialised = JSON.stringify(data);
    expect(serialised).toContain('Cordless Drill 18V');
    expect(serialised).not.toContain('detail-only');
    expect(serialised).not.toContain('variants');
  });

  it('makes no request at all for a page with no catalogue block', async () => {
    stubBackend();
    const data = await resolveCatalogBlockDataFor([documentOf(BLOCKS.heading)], CTX);

    expect(data).toEqual({});
    expect(calls).toEqual([]);
  });
});

describe('a catalogue read that fails', () => {
  it('costs the page that one block and nothing else', async () => {
    stubBackend(['/catalog/categories', 'filter%5Bcategory%5D']);
    const html = await renderResolved(
      documentOf(BLOCKS.heading, BLOCKS.grid, BLOCKS.slider, BLOCKS.categoryList),
    );

    expect(html).toContain('Everything for the workshop.');
    expect(html).toContain('Cordless Drill 18V');
    expect(html).toContain('No products found');
    expect(html).toContain('No categories found');
    expect(html).not.toContain('cmsc-pb-skel-');
  });

  it('drops a product the backend no longer answers for and keeps the rest of the grid', async () => {
    stubBackend();
    const html = await renderResolved(
      documentOf({
        type: 'catalog.ProductGrid',
        props: { id: 'grid', source: 'manual', productSlugs: ['retired-product', 'claw-hammer'] },
      }),
    );

    expect(html).toContain('Claw Hammer 450g');
  });
});
