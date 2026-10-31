import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ProductSummary } from '@endora-commerce/contracts';

/**
 * Issue #85 — the commerce area's pages speak the page's language: the catalog
 * and category listings (the product count, the mobile filter sheet's labels),
 * the two compare pages, the product page's not-found title, and the quote
 * request's empty-submission refusal. Each page is awaited with its data and
 * the request context mocked.
 */
let locale = 'en-US';
let products: ProductSummary[] = [];

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: {} }),
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'sess' }));
vi.mock('../../lib/api/catalog', () => ({
  listProducts: async () => ({ data: products, pagination: { cursor: null, hasMore: false } }),
  getFilters: async () => [],
  getCategoryTree: async () => [
    { id: 'c1', slug: 'bolts', name: 'Bolts', productCount: 3, children: [] },
  ],
  getCategoryPageContent: async () => null,
  getProductBySlug: async () => {
    throw new Error('not found');
  },
  resolveProductKey: async () => {
    throw new Error('not found');
  },
  getProductMinimumsBySlugs: async () => ({}),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localizedAlternates: async () => ({ canonical: '/x' }),
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/catalog',
}));

function product(i: number): ProductSummary {
  return {
    id: `00000000-0000-4000-8000-00000000000${i}`,
    sku: `SKU-${i}`,
    type: 'simple',
    name: `Widget ${i}`,
    slug: `widget-${i}`,
    categorySlugs: [],
    primaryAssetUrl: null,
    price: null,
    stockIndicator: null,
    stockLevel: null,
  };
}

function text(node: React.ReactNode): string {
  return renderToString(<>{node}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  locale = 'en-US';
  products = [];
});

describe('catalog listing', () => {
  it.each([
    ['en-US', 2, '2 products'],
    ['pl-PL', 2, '2 produkty'],
    ['pl-PL', 5, '5 produktów'],
    ['pl-PL', 1, '1 produkt'],
  ] as const)('counts the products in %s (%i)', async (l, n, count) => {
    locale = l;
    products = Array.from({ length: n }, (_, i) => product(i));
    const { default: CatalogPage } = await import('../../app/(catalog)/catalog/page');
    const html = text(await CatalogPage({ searchParams: Promise.resolve({}) } as never));
    expect(html).toContain(`<p>${count}</p>`);
  });

  it.each([
    ['en-US', '3 products', 'Category not found'],
    ['pl-PL', '3 produkty', 'Nie znaleziono kategorii'],
  ])('a category page in %s', async (l, count, notFound) => {
    locale = l;
    const page = await import('../../app/(catalog)/c/[slug]/page');
    const html = text(await page.default({ params: Promise.resolve({ slug: 'bolts' }), searchParams: Promise.resolve({}) } as never));
    expect(html).toContain(`<p>${count}</p>`);
    const meta = await page.generateMetadata({ params: Promise.resolve({ slug: 'nope' }) } as never);
    expect(meta.title).toBe(notFound);
  });
});

describe('compare pages', () => {
  it.each([
    ['en-US', ['>Comparison<', '<h1>Technical specifications compared</h1>', 'Differences are highlighted.']],
    ['pl-PL', ['>Porównanie<', '<h1>Porównanie parametrów technicznych</h1>', 'Różnice są podświetlone.']],
  ])('/compare in %s', async (l, texts) => {
    locale = l;
    const { default: ComparePage } = await import('../../app/compare/page');
    const html = text(await ComparePage());
    for (const t of texts) expect(html).toContain(t);
    if (l === 'en-US') expect(html).not.toMatch(/[ąćęłńóśźż]/i);
  });

  it.each([
    ['en-US', ['>Shared<', '<h1>Shared comparison</h1>', 'Read only — the author of this comparison shared']],
    ['pl-PL', ['>Udostępnione<', '<h1>Udostępnione porównanie</h1>', 'Tylko do odczytu — autor porównania udostępnił Ci']],
  ])('/compare/share in %s', async (l, texts) => {
    locale = l;
    const { default: SharedComparePage } = await import('../../app/compare/share/[token]/page');
    const html = text(await SharedComparePage({ params: Promise.resolve({ token: 'tok' }) }));
    for (const t of texts) expect(html).toContain(t);
  });
});

describe('quote-request draft submission', () => {
  it.each([
    ['en-US', 'Empty quote request.'],
    ['pl-PL', 'Zapytanie ofertowe jest puste.'],
  ])('refuses an empty request in %s', async (l, sentence) => {
    locale = l;
    const { submitQuoteRequest } = await import('../../app/(commerce)/quote-request/actions');
    expect(await submitQuoteRequest({ items: [] })).toEqual({ ok: false, reason: 'error', message: sentence });
  });
});
