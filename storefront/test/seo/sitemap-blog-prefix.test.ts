import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlogIndexResponse } from '@endora-commerce/contracts';

/**
 * Feature 171 (FR-002, T017) — the sitemap advertises the blog where it lives: under
 * the operator's prefix, never at `/blog`, which then only redirects. Every
 * collaborator but the blog index is stubbed to nothing.
 */

const getBlogIndex = vi.fn();

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ ctx: { locale: 'pl-PL' }, urlState: { languages: [], aliases: [], current: 'pl-PL' } }),
}));
vi.mock('../../lib/api/catalog', () => ({
  listProducts: async () => ({ data: [], pagination: { cursor: null, hasMore: false, limit: 100 } }),
  getCategoryTree: async () => [],
}));
vi.mock('../../lib/api/blog', () => ({
  getBlogIndex: (...args: unknown[]) => getBlogIndex(...args),
}));
vi.mock('../../lib/api/cms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/cms')>()),
  getCmsPageIndex: async () => ({ pages: [] }),
}));
vi.mock('../../lib/api/homepage', () => ({
  getHomepageConfig: async () => ({ cmsPageSlug: null }),
}));

const ORIGIN = 'https://shop.example.com';

const INDEX: BlogIndexResponse = {
  urlPrefix: 'aktualnosci',
  url: '/aktualnosci',
  latestPosts: [
    {
      id: '11111111-2222-4333-8444-555555555555',
      slug: 'porady',
      name: 'Porady',
      publishedAt: null,
      excerpt: null,
      mainImageUrl: null,
      primaryCategorySlug: null,
      url: '/aktualnosci/porady',
    },
  ],
  topLevelCategories: [],
};

async function sitemapUrls(): Promise<string[]> {
  const { default: sitemap } = await import('../../app/sitemap');
  return (await sitemap()).map((entry) => entry.url);
}

describe('the sitemap lists the blog under its prefix (feature 171)', () => {
  beforeEach(() => {
    process.env['NEXT_PUBLIC_SITE_URL'] = ORIGIN;
  });

  afterEach(() => {
    delete process.env['NEXT_PUBLIC_SITE_URL'];
    vi.clearAllMocks();
  });

  it('lists the index and the posts under the operator’s prefix, and no /blog URL', async () => {
    getBlogIndex.mockResolvedValue(INDEX);
    const urls = await sitemapUrls();
    expect(urls).toEqual(expect.arrayContaining([`${ORIGIN}/aktualnosci`, `${ORIGIN}/aktualnosci/porady`]));
    expect(urls.filter((url) => /\/blog(\/|$)/.test(new URL(url).pathname))).toEqual([]);
  });

  it('keeps /blog when the prefix is blog', async () => {
    getBlogIndex.mockResolvedValue({ ...INDEX, urlPrefix: 'blog', url: '/blog' });
    expect(await sitemapUrls()).toContain(`${ORIGIN}/blog`);
  });
});

describe('llms.txt learns where the blog lives from the blog index (feature 171)', () => {
  it('reads the served address of /blog from the index’s prefix', async () => {
    const { blogServedAt } = await import('../../lib/seo/llms-txt-pages');
    expect(blogServedAt({ data: { urlPrefix: 'aktualnosci' } })).toBe('/aktualnosci');
    expect(blogServedAt({ data: { urlPrefix: 'blog' } })).toBe('/blog');
    expect(blogServedAt({ data: {} })).toBe('/blog');
    expect(blogServedAt(null)).toBeNull();
  });
});
