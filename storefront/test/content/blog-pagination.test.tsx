import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BlogIndexResponse, BlogPostCard } from '@endora-commerce/contracts';
import { BlogIndexPage } from '../../app/blog/_components/BlogIndexPage';

/**
 * Feature 171 (US2, FR-014, T034) — the blog index is paged by the channel's
 * posts-per-page: its own pagination links, and a page past the last is a 404 on the
 * index, a category and a tag alike.
 */

const CARD: BlogPostCard = {
  id: '11111111-2222-4333-8444-555555555555',
  slug: 'porady',
  name: 'Porady',
  publishedAt: null,
  excerpt: null,
  mainImageUrl: null,
  primaryCategorySlug: null,
  url: '/aktualnosci/porady',
};

function index(page: number, totalPages: number): BlogIndexResponse {
  return {
    urlPrefix: 'aktualnosci',
    url: '/aktualnosci',
    latestPosts: [CARD],
    posts: { data: [CARD], pagination: { page, perPage: 1, totalItems: totalPages, totalPages } },
    topLevelCategories: [],
  };
}

describe('the blog index pages (feature 171)', () => {
  it('links the other pages of the index under its own address', () => {
    const html = renderToString(<BlogIndexPage payload={index(2, 3)} locale="pl-PL" />);
    expect(html).toContain('href="/aktualnosci?page=1"');
    expect(html).toContain('href="/aktualnosci?page=3"');
  });
});

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

describe('a page past the last is a 404 (feature 171)', () => {
  vi.doMock('next/navigation', () => ({ notFound, permanentRedirect: vi.fn(), redirect: vi.fn() }));
  vi.doMock('../../lib/server-context', () => ({
    getServerContext: async () => ({ ctx: { locale: 'pl-PL' }, locale: 'pl-PL', modules: undefined }),
  }));
  vi.doMock('../../lib/api/blog', () => ({
    getBlogIndex: async (_ctx: unknown, page?: number) => index(page ?? 1, 2),
    getBlogBySlug: async (_slug: string, _ctx: unknown, page?: number) => ({
      kind: 'category',
      category: {
        id: '33333333-2222-4333-8444-555555555555',
        name: 'Nowości',
        slug: 'nowosci',
        mainImageUrl: null,
        description: null,
        metaTitle: null,
        metaDescription: null,
        metaKeywords: null,
        childCategories: [],
        breadcrumb: [],
        url: '/aktualnosci/nowosci',
      },
      posts: { data: [], pagination: { page: page ?? 1, perPage: 1, totalItems: 2, totalPages: 2 } },
    }),
    getBlogTagByCode: async (_code: string, _ctx: unknown, page?: number) => ({
      tag: { id: '55555555-2222-4333-8444-555555555555', code: 'diy', name: 'DIY', description: null, url: '/aktualnosci/tag/diy' },
      posts: { data: [], pagination: { page: page ?? 1, perPage: 1, totalItems: 2, totalPages: 2 } },
      breadcrumb: [],
    }),
    getBlogRelatedProducts: async () => [],
  }));

  async function render(slug: string[] | undefined, page: string): Promise<unknown> {
    const { default: Page } = await import('../../app/blog/[[...slug]]/page');
    return Page({ params: Promise.resolve(slug ? { slug } : {}), searchParams: Promise.resolve({ page }) });
  }

  it('renders page 2 of 2 and refuses page 3 on the index, a category and a tag', async () => {
    await expect(render(undefined, '2')).resolves.toBeTruthy();
    for (const slug of [undefined, ['nowosci'], ['tag', 'diy']]) {
      notFound.mockClear();
      await expect(render(slug, '3')).rejects.toThrow('NEXT_NOT_FOUND');
      expect(notFound).toHaveBeenCalled();
    }
  });
});
