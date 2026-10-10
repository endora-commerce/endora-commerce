import { describe, expect, it } from 'vitest';
import type { CmsCategoryNode, CmsProductSummary } from '../schema/catalog-types.js';
import {
  catalogBlockDataKey,
  catalogBlockDataRequestOf,
  collectCatalogBlockDataRequests,
  resolveCatalogBlockData,
  type CatalogBlockDataSource,
} from './catalog-block-data.js';

function product(slug: string): CmsProductSummary {
  return {
    id: `id-${slug}`,
    slug,
    name: `Name of ${slug}`,
    sku: `SKU-${slug}`,
    primaryAssetUrl: null,
    price: { amount: 10, currency: 'EUR' },
    stockLevel: null,
  };
}

function category(slug: string, children: CmsCategoryNode[] = []): CmsCategoryNode {
  return { id: `id-${slug}`, name: `Category ${slug}`, slug, sortOrder: 0, productCount: 3, children };
}

function sourceOf(overrides: Partial<CatalogBlockDataSource> = {}): CatalogBlockDataSource {
  return {
    fetchProductBySlug: async (slug) => product(slug),
    fetchProductsList: async () => [product('listed')],
    fetchCategoryTree: async () => [category('tools', [category('hammers')])],
    ...overrides,
  };
}

describe('catalogBlockDataRequestOf', () => {
  it('declares the manual selection of a product grid and of a product slider', () => {
    expect(catalogBlockDataRequestOf('catalog.ProductGrid', { source: 'manual', productSlugs: ['a', 'b'] })).toEqual({
      kind: 'products-by-slugs',
      slugs: ['a', 'b'],
    });
    expect(catalogBlockDataRequestOf('catalog.ProductSlider', { productSlugs: ['a'] })).toEqual({
      kind: 'products-by-slugs',
      slugs: ['a'],
    });
  });

  it('declares a category or a query listing with the limit the block renders with', () => {
    expect(
      catalogBlockDataRequestOf('catalog.ProductGrid', { source: 'category', categorySlug: 'tools', limit: 4 }),
    ).toEqual({ kind: 'products-list', categorySlug: 'tools', limit: 4 });
    // The search query of a category-sourced block is ignored, exactly as the block ignores it.
    expect(
      catalogBlockDataRequestOf('catalog.ProductSlider', { source: 'query', searchQuery: 'drill', categorySlug: 'x' }),
    ).toEqual({ kind: 'products-list', q: 'drill', limit: 12 });
  });

  it('declares one product for a product card, and nothing while no product is selected', () => {
    expect(catalogBlockDataRequestOf('catalog.ProductCard', { productSlug: 'a' })).toEqual({
      kind: 'products-by-slugs',
      slugs: ['a'],
    });
    expect(catalogBlockDataRequestOf('catalog.ProductCard', { productSlug: '' })).toBeNull();
  });

  it('declares the category selection of a category list and of a category grid', () => {
    expect(catalogBlockDataRequestOf('catalog.CategoryList', {})).toEqual({
      kind: 'categories',
      selectionMode: 'all',
      categorySlugs: [],
      parentSlug: '',
    });
    expect(
      catalogBlockDataRequestOf('catalog.CategoryGrid', { selectionMode: 'childrenOf', parentSlug: 'tools', maxDepth: 1 }),
    ).toEqual({ kind: 'categories', selectionMode: 'childrenOf', categorySlugs: [], parentSlug: 'tools', maxDepth: 1 });
  });

  it('declares nothing for a block that shows no catalogue data', () => {
    expect(catalogBlockDataRequestOf('cms.Heading', { text: 'Hello' })).toBeNull();
  });
});

describe('collectCatalogBlockDataRequests', () => {
  it('finds catalogue blocks in content, zones and slots, once per distinct request', () => {
    const grid = { type: 'catalog.ProductGrid', props: { id: 'g1', source: 'manual', productSlugs: ['a'] } };
    const document = {
      root: { props: {} },
      content: [
        grid,
        { ...grid, props: { ...grid.props, id: 'g2' } },
        {
          type: 'cms.Row',
          props: {
            id: 'row',
            content: [{ type: 'catalog.CategoryList', props: { id: 'c1' } }],
          },
        },
      ],
      zones: { 'legacy:zone': [{ type: 'catalog.ProductCard', props: { id: 'p1', productSlug: 'b' } }] },
    };

    const keys = collectCatalogBlockDataRequests([document, null, 'not a document']).map(catalogBlockDataKey);

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('resolveCatalogBlockData', () => {
  it('resolves every request under the key its block reads', async () => {
    const requests = collectCatalogBlockDataRequests([
      {
        content: [
          { type: 'catalog.ProductGrid', props: { productSlugs: ['b', 'a'] } },
          { type: 'catalog.ProductSlider', props: { source: 'category', categorySlug: 'tools' } },
          { type: 'catalog.CategoryGrid', props: { selectionMode: 'childrenOf', parentSlug: 'tools' } },
        ],
      },
    ]);

    const data = await resolveCatalogBlockData(requests, sourceOf());

    const [grid, slider, categories] = requests.map((request) => data[catalogBlockDataKey(request)]);
    expect((grid as CmsProductSummary[]).map((p) => p.slug)).toEqual(['b', 'a']);
    expect((slider as CmsProductSummary[]).map((p) => p.slug)).toEqual(['listed']);
    expect(categories).toEqual([{ slug: 'hammers', name: 'Category hammers', productCount: 3, depth: 0 }]);
  });

  it('asks for a product once however many blocks show it, and for the category tree once', async () => {
    const asked: string[] = [];
    let trees = 0;
    const requests = collectCatalogBlockDataRequests([
      {
        content: [
          { type: 'catalog.ProductGrid', props: { productSlugs: ['a', 'b'] } },
          { type: 'catalog.ProductCard', props: { productSlug: 'a' } },
          { type: 'catalog.CategoryList', props: {} },
          { type: 'catalog.CategoryGrid', props: { selectionMode: 'manual', categorySlugs: ['tools'] } },
        ],
      },
    ]);

    await resolveCatalogBlockData(
      requests,
      sourceOf({
        fetchProductBySlug: async (slug) => {
          asked.push(slug);
          return product(slug);
        },
        fetchCategoryTree: async () => {
          trees += 1;
          return [category('tools')];
        },
      }),
    );

    expect(asked.sort()).toEqual(['a', 'b']);
    expect(trees).toBe(1);
  });

  it('runs the reads in parallel, never more than the bound at once', async () => {
    let running = 0;
    let peak = 0;
    const slugs = Array.from({ length: 20 }, (_, index) => `p${index}`);
    const requests = collectCatalogBlockDataRequests([
      { content: [{ type: 'catalog.ProductGrid', props: { productSlugs: slugs } }] },
    ]);

    await resolveCatalogBlockData(
      requests,
      sourceOf({
        fetchProductBySlug: async (slug) => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 2));
          running -= 1;
          return product(slug);
        },
      }),
      { concurrency: 4 },
    );

    expect(peak).toBe(4);
  });

  it('leaves a failed read out, so its block degrades alone', async () => {
    const requests = collectCatalogBlockDataRequests([
      {
        content: [
          { type: 'catalog.ProductGrid', props: { productSlugs: ['gone', 'a'] } },
          { type: 'catalog.ProductSlider', props: { source: 'query', searchQuery: 'drill' } },
          { type: 'catalog.CategoryList', props: {} },
        ],
      },
    ]);

    const data = await resolveCatalogBlockData(
      requests,
      sourceOf({
        fetchProductBySlug: async (slug) => {
          if (slug === 'gone') throw new Error('404');
          return product(slug);
        },
        fetchProductsList: async () => {
          throw new Error('503');
        },
      }),
    );

    const [grid, slider, categories] = requests.map((request) => data[catalogBlockDataKey(request)]);
    expect((grid as CmsProductSummary[]).map((p) => p.slug)).toEqual(['a']);
    expect(slider).toBeUndefined();
    expect(categories).toHaveLength(2);
  });

  it('hands on the seven fields a block renders and nothing else the source returned', async () => {
    const requests = collectCatalogBlockDataRequests([
      { content: [{ type: 'catalog.ProductCard', props: { productSlug: 'a' } }] },
    ]);

    const data = await resolveCatalogBlockData(
      requests,
      sourceOf({
        fetchProductBySlug: async (slug) =>
          ({ ...product(slug), description: 'long text', variants: [{ id: 'v' }] }) as CmsProductSummary,
      }),
    );

    expect(data[catalogBlockDataKey(requests[0]!)]).toEqual([product('a')]);
  });
});
