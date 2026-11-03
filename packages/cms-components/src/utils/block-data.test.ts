import { describe, expect, it } from 'vitest';
import type { CmsBlogPostCard } from '../schema/blog-types.js';
import type { CmsCategoryNode, CmsProductSummary } from '../schema/catalog-types.js';
import type { PublicFormDefinition } from '@endora-commerce/contracts';
import {
  blockDataKey,
  blockDataOwnerOf,
  blockDataRequestOf,
  collectBlockDataRequests,
  formBlockDataRequest,
  resolveBlockData,
  type BlockDataSource,
} from './block-data.js';

/**
 * The server data seam of the Page Builder blocks (`specs/163-page-builder-marketing-pages/`
 * T066, research R-15): moved from the catalogue-only seam test when the seam
 * became `block-data.ts`. The catalogue cases are kept as they were, under the
 * new names; the `blog-posts` kind and the owner-module skip are new.
 */

function product(slug: string): CmsProductSummary {
  return {
    id: `id-${slug}`,
    slug,
    name: `Name of ${slug}`,
    sku: `SKU-${slug}`,
    primaryAssetUrl: null,
    price: { amount: 10, currency: 'EUR' },
    stockLevel: null,
    summary: null,
  };
}

function post(slug: string): CmsBlogPostCard {
  return {
    id: `id-${slug}`,
    slug,
    name: `Post ${slug}`,
    publishedAt: '2026-04-01T00:00:00.000Z',
    excerpt: null,
    mainImageUrl: null,
    primaryCategorySlug: null,
    primaryCategoryName: null,
    url: `/blog/${slug}`,
  };
}

function category(slug: string, children: CmsCategoryNode[] = []): CmsCategoryNode {
  return { id: `id-${slug}`, name: `Category ${slug}`, slug, sortOrder: 0, productCount: 3, children };
}

function sourceOf(overrides: Partial<BlockDataSource> = {}): BlockDataSource {
  return {
    fetchProductBySlug: async (slug) => product(slug),
    fetchProductsList: async () => [product('listed')],
    fetchCategoryTree: async () => [category('tools', [category('hammers')])],
    fetchBlogPosts: async () => [post('newest'), post('older')],
    ...overrides,
  };
}

describe('blockDataRequestOf — the catalogue kinds, as before', () => {
  it('declares the manual selection of a product grid and of a product slider', () => {
    expect(blockDataRequestOf('catalog.ProductGrid', { source: 'manual', productSlugs: ['a', 'b'] })).toEqual({
      kind: 'products-by-slugs',
      slugs: ['a', 'b'],
    });
    expect(blockDataRequestOf('catalog.ProductSlider', { productSlugs: ['a'] })).toEqual({
      kind: 'products-by-slugs',
      slugs: ['a'],
    });
  });

  it('declares a category or a query listing with the limit the block renders with', () => {
    expect(
      blockDataRequestOf('catalog.ProductGrid', { source: 'category', categorySlug: 'tools', limit: 4 }),
    ).toEqual({ kind: 'products-list', categorySlug: 'tools', limit: 4 });
    // The search query of a category-sourced block is ignored, exactly as the block ignores it.
    expect(
      blockDataRequestOf('catalog.ProductSlider', { source: 'query', searchQuery: 'drill', categorySlug: 'x' }),
    ).toEqual({ kind: 'products-list', q: 'drill', limit: 12 });
  });

  it('declares one product for a product card, and nothing while no product is selected', () => {
    expect(blockDataRequestOf('catalog.ProductCard', { productSlug: 'a' })).toEqual({
      kind: 'products-by-slugs',
      slugs: ['a'],
    });
    expect(blockDataRequestOf('catalog.ProductCard', { productSlug: '' })).toBeNull();
  });

  it('declares the category selection of a category list and of a category grid', () => {
    expect(blockDataRequestOf('catalog.CategoryList', {})).toEqual({
      kind: 'categories',
      selectionMode: 'all',
      categorySlugs: [],
      parentSlug: '',
    });
    expect(
      blockDataRequestOf('catalog.CategoryGrid', { selectionMode: 'childrenOf', parentSlug: 'tools', maxDepth: 1 }),
    ).toEqual({ kind: 'categories', selectionMode: 'childrenOf', categorySlugs: [], parentSlug: 'tools', maxDepth: 1 });
  });

  it('declares nothing for a block that shows no catalogue data', () => {
    expect(blockDataRequestOf('cms.Heading', { text: 'Hello' })).toBeNull();
  });
});

describe('collectBlockDataRequests — the catalogue kinds, as before', () => {
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

    const keys = collectBlockDataRequests([document, null, 'not a document']).map(blockDataKey);

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('resolveBlockData — the catalogue kinds, as before', () => {
  it('resolves every request under the key its block reads', async () => {
    const requests = collectBlockDataRequests([
      {
        content: [
          { type: 'catalog.ProductGrid', props: { productSlugs: ['b', 'a'] } },
          { type: 'catalog.ProductSlider', props: { source: 'category', categorySlug: 'tools' } },
          { type: 'catalog.CategoryGrid', props: { selectionMode: 'childrenOf', parentSlug: 'tools' } },
        ],
      },
    ]);

    const data = await resolveBlockData(requests, sourceOf());

    const [grid, slider, categories] = requests.map((request) => data[blockDataKey(request)]);
    expect((grid as CmsProductSummary[]).map((p) => p.slug)).toEqual(['b', 'a']);
    expect((slider as CmsProductSummary[]).map((p) => p.slug)).toEqual(['listed']);
    expect(categories).toEqual([{ slug: 'hammers', name: 'Category hammers', productCount: 3, depth: 0 }]);
  });

  it('asks for a product once however many blocks show it, and for the category tree once', async () => {
    const asked: string[] = [];
    let trees = 0;
    const requests = collectBlockDataRequests([
      {
        content: [
          { type: 'catalog.ProductGrid', props: { productSlugs: ['a', 'b'] } },
          { type: 'catalog.ProductCard', props: { productSlug: 'a' } },
          { type: 'catalog.CategoryList', props: {} },
          { type: 'catalog.CategoryGrid', props: { selectionMode: 'manual', categorySlugs: ['tools'] } },
        ],
      },
    ]);

    await resolveBlockData(
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
    const requests = collectBlockDataRequests([
      { content: [{ type: 'catalog.ProductGrid', props: { productSlugs: slugs } }] },
    ]);

    await resolveBlockData(
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
    const requests = collectBlockDataRequests([
      {
        content: [
          { type: 'catalog.ProductGrid', props: { productSlugs: ['gone', 'a'] } },
          { type: 'catalog.ProductSlider', props: { source: 'query', searchQuery: 'drill' } },
          { type: 'catalog.CategoryList', props: {} },
        ],
      },
    ]);

    const data = await resolveBlockData(
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

    const [grid, slider, categories] = requests.map((request) => data[blockDataKey(request)]);
    expect((grid as CmsProductSummary[]).map((p) => p.slug)).toEqual(['a']);
    expect(slider).toBeUndefined();
    expect(categories).toHaveLength(2);
  });

  // Named change (T070): `summary` is the eighth field a block renders.
  it('hands on the eight fields a block renders and nothing else the source returned', async () => {
    const requests = collectBlockDataRequests([
      { content: [{ type: 'catalog.ProductCard', props: { productSlug: 'a' } }] },
    ]);

    const data = await resolveBlockData(
      requests,
      sourceOf({
        fetchProductBySlug: async (slug) =>
          ({ ...product(slug), description: 'long text', variants: [{ id: 'v' }] }) as CmsProductSummary,
      }),
    );

    expect(data[blockDataKey(requests[0]!)]).toEqual([product('a')]);
  });
});

describe('the blog-posts kind (T066)', () => {
  it('is collected from blog.LatestPosts props, with the default limit of 6', () => {
    expect(blockDataRequestOf('blog.LatestPosts', { limit: 3, categorySlug: 'news' })).toEqual({
      kind: 'blog-posts',
      limit: 3,
      categorySlug: 'news',
    });
    expect(blockDataRequestOf('blog.LatestPosts', {})).toEqual({ kind: 'blog-posts', limit: 6 });
    // An empty category is no category; a limit out of range is clamped to 1–12.
    expect(blockDataRequestOf('blog.LatestPosts', { categorySlug: '', limit: 40 })).toEqual({ kind: 'blog-posts', limit: 12 });
  });

  it('merges duplicate requests, wherever the blocks sit', () => {
    const latest = { type: 'blog.LatestPosts', props: { id: 'l1', limit: 3 } };
    const requests = collectBlockDataRequests([
      { content: [latest, { type: 'cms.Row', props: { content: [{ ...latest, props: { ...latest.props, id: 'l2' } }] } }] },
    ]);
    expect(requests).toEqual([{ kind: 'blog-posts', limit: 3 }]);
  });

  it('resolves the cards under the key the block reads, and leaves a failed read out without rejecting', async () => {
    const asked: Array<{ limit: number; categorySlug?: string }> = [];
    const requests = collectBlockDataRequests([
      {
        content: [
          { type: 'blog.LatestPosts', props: { limit: 2 } },
          { type: 'blog.LatestPosts', props: { limit: 4, categorySlug: 'broken' } },
        ],
      },
    ]);
    const data = await resolveBlockData(
      requests,
      sourceOf({
        fetchBlogPosts: async (query) => {
          asked.push(query);
          if (query.categorySlug === 'broken') throw new Error('503');
          return [post('newest'), post('older')];
        },
      }),
    );
    expect(asked).toHaveLength(2);
    const [ok, failed] = requests.map((request) => data[blockDataKey(request)]);
    expect((ok as CmsBlogPostCard[]).map((card) => card.slug)).toEqual(['newest', 'older']);
    expect(failed).toBeUndefined();
  });

  it('skips a request whose owner module is absent, and asks the absent module nothing', async () => {
    let blogReads = 0;
    let catalogReads = 0;
    const requests = collectBlockDataRequests([
      {
        content: [
          { type: 'blog.LatestPosts', props: {} },
          { type: 'catalog.ProductCard', props: { productSlug: 'a' } },
        ],
      },
    ]);
    const data = await resolveBlockData(
      requests,
      sourceOf({
        isModulePresent: (moduleId) => moduleId !== 'blog',
        fetchBlogPosts: async () => {
          blogReads += 1;
          return [post('x')];
        },
        fetchProductBySlug: async (slug) => {
          catalogReads += 1;
          return product(slug);
        },
      }),
    );
    expect(blogReads).toBe(0);
    expect(catalogReads).toBe(1);
    expect(data[blockDataKey(requests[0]!)]).toBeUndefined();
    expect(data[blockDataKey(requests[1]!)]).toEqual([product('a')]);
  });

  it('skips the blog kind when the source has no blog reader', async () => {
    const requests = collectBlockDataRequests([{ content: [{ type: 'blog.LatestPosts', props: {} }] }]);
    const { fetchBlogPosts: _omitted, ...withoutBlog } = sourceOf();
    const data = await resolveBlockData(requests, withoutBlog);
    expect(data).toEqual({});
  });
});

/**
 * `specs/170-forms-module/` T048 — the `form` kind (contracts/blocks-and-storefront.md §3): a
 * `forms.Form` block declares the public read of its form, owned by `forms`, so the form is in the
 * server HTML; with no form picked it declares nothing, and with `forms` absent or no form reader
 * the read is skipped and the block renders nothing.
 */
describe('the form kind (T048)', () => {
  const FORM_ID = '3b0c9f0e-2d1a-4c5b-8e7f-6a5b4c3d2e1f';
  const OTHER_ID = '5d0c9f0e-2d1a-4c5b-8e7f-6a5b4c3d2e1f';
  const UNAVAILABLE: PublicFormDefinition = { formId: FORM_ID, availability: 'unavailable' };

  it('is declared from the forms.Form props, and not without a form', () => {
    expect(blockDataRequestOf('forms.Form', { formId: FORM_ID })).toEqual({ kind: 'form', formId: FORM_ID });
    expect(blockDataRequestOf('forms.Form', { formId: '' })).toBeNull();
    expect(blockDataRequestOf('forms.Form', {})).toBeNull();
    expect(formBlockDataRequest({ formId: '  ' })).toBeNull();
  });

  it('is owned by forms', () => {
    expect(blockDataOwnerOf({ kind: 'form', formId: FORM_ID })).toBe('forms');
  });

  it('is read once per form, wherever and however often the form is placed', async () => {
    const reads: string[] = [];
    const requests = collectBlockDataRequests([
      {
        content: [
          { type: 'forms.Form', props: { id: 'a', formId: FORM_ID } },
          { type: 'cms.Section', props: { content: [{ type: 'forms.Form', props: { id: 'b', formId: FORM_ID } }] } },
          { type: 'forms.Form', props: { id: 'c', formId: OTHER_ID } },
        ],
      },
    ]);
    expect(requests).toHaveLength(2);
    const data = await resolveBlockData(
      requests,
      sourceOf({
        fetchForm: async (formId) => {
          reads.push(formId);
          return { ...UNAVAILABLE, formId };
        },
      }),
    );
    expect(reads.sort()).toEqual([FORM_ID, OTHER_ID].sort());
    expect(data[blockDataKey({ kind: 'form', formId: FORM_ID })]).toEqual(UNAVAILABLE);
  });

  it('skips the read while forms is absent, and asks it nothing', async () => {
    let reads = 0;
    const requests = collectBlockDataRequests([{ content: [{ type: 'forms.Form', props: { formId: FORM_ID } }] }]);
    const data = await resolveBlockData(
      requests,
      sourceOf({
        isModulePresent: (moduleId) => moduleId !== 'forms',
        fetchForm: async () => {
          reads += 1;
          return UNAVAILABLE;
        },
      }),
    );
    expect(reads).toBe(0);
    expect(data).toEqual({});
  });

  it('skips the read when the source has no form reader, and leaves a failed read out', async () => {
    const requests = collectBlockDataRequests([{ content: [{ type: 'forms.Form', props: { formId: FORM_ID } }] }]);
    expect(await resolveBlockData(requests, sourceOf())).toEqual({});
    expect(
      await resolveBlockData(
        requests,
        sourceOf({
          fetchForm: async () => {
            throw new Error('forms is down');
          },
        }),
      ),
    ).toEqual({});
  });
});
