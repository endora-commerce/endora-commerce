import { describe, expect, it, vi } from 'vitest';

/**
 * Feature 171 (US4, FR-033/FR-034, T055) — a former key answers a permanent redirect
 * to the entry's current URL, and a post's `hreflang` alternates are the paths the
 * backend composed per language (its key under each language's prefix), not one path
 * with the language prefix swapped.
 */

const permanentRedirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT ${path}`);
});

vi.doMock('next/navigation', () => ({ permanentRedirect, notFound: vi.fn(), redirect: vi.fn() }));
vi.doMock('../../lib/server-context', () => ({
  getServerContext: async () => ({ ctx: { locale: 'en-US' }, locale: 'en-US', modules: undefined }),
}));
vi.doMock('../../lib/i18n/navigation', () => ({ localizedAlternates: async (path: string) => ({ canonical: path }) }));

const POST = {
  kind: 'post',
  post: {
    id: '66666666-2222-4333-8444-555555555555',
    name: 'Drills',
    slug: 'wiertarki',
    publishedAt: null,
    metaTitle: null,
    metaDescription: null,
    metaKeywords: null,
    content: { schema_version: 1, languages: {} },
    tags: [],
    relatedPosts: [],
    relatedProducts: [],
    relatedProductIds: [],
    categories: [],
    breadcrumb: [],
    url: '/en/news/drills',
    alternates: { languages: { 'pl-PL': '/pl/aktualnosci/wiertarki', 'en-US': '/en/news/drills' }, xDefault: '/aktualnosci/wiertarki' },
  },
};

vi.doMock('../../lib/api/blog', () => ({
  getBlogIndex: async () => null,
  getBlogTagByCode: async () => null,
  getBlogBySlug: async (slug: string) =>
    slug === 'old-drills' ? { kind: 'redirect', path: '/en/news/drills', permanent: true } : slug === 'drills' ? POST : null,
  getBlogRelatedProducts: async () => [],
}));

describe('blog redirects and alternates (feature 171)', () => {
  it('answers a former key with a permanent redirect to the current URL', async () => {
    const { default: Page } = await import('../../app/blog/[[...slug]]/page');
    await expect(Page({ params: Promise.resolve({ slug: ['old-drills'] }), searchParams: Promise.resolve({}) })).rejects.toThrow(
      'REDIRECT /en/news/drills',
    );
    expect(permanentRedirect).toHaveBeenCalledWith('/en/news/drills');
  });

  it('declares no index for a redirect', async () => {
    const { generateMetadata } = await import('../../app/blog/[[...slug]]/page');
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: ['old-drills'] }), searchParams: Promise.resolve({}) });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('declares the backend’s per-language paths as the post’s alternates', async () => {
    const { generateMetadata } = await import('../../app/blog/[[...slug]]/page');
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: ['drills'] }), searchParams: Promise.resolve({}) });
    expect(metadata.alternates).toEqual({
      canonical: '/en/news/drills',
      languages: { 'pl-PL': '/pl/aktualnosci/wiertarki', 'en-US': '/en/news/drills', 'x-default': '/aktualnosci/wiertarki' },
    });
  });
});
