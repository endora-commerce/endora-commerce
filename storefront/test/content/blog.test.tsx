import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  BlogBySlugCategoryResponse,
  BlogIndexResponse,
  BlogPostCard,
  BlogTagByCodeResponse,
} from '@endora-commerce/contracts';
import { BlogIndexPage } from '../../app/blog/_components/BlogIndexPage';
import { BlogCategoryPage } from '../../app/blog/_components/BlogCategoryPage';
import { BlogTagPage } from '../../app/blog/_components/BlogTagPage';
import { RelatedPostsStrip } from '../../app/blog/_components/RelatedPostsStrip';
import { RelatedProductsStrip } from '../../app/blog/_components/RelatedProductsStrip';

/**
 * Issue #85 — the blog's own words (headings, empty states, pagination,
 * subcategory navigation, page titles) were English-only, so a Polish shop's
 * blog read "Latest posts" over Polish posts. They now speak the page language,
 * and so do the post dates, which were written in the server's locale.
 */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

const POST: BlogPostCard = {
  id: '11111111-2222-4333-8444-555555555555',
  slug: 'first-post',
  name: 'First post',
  publishedAt: '2026-03-05T10:00:00.000Z',
  excerpt: null,
  mainImageUrl: null,
  primaryCategorySlug: null,
};

const PAGINATION = { page: 2, perPage: 1, totalPages: 3, totalItems: 3 };

const INDEX_EMPTY: BlogIndexResponse = { urlPrefix: 'blog', latestPosts: [], topLevelCategories: [] };
const INDEX: BlogIndexResponse = {
  urlPrefix: 'blog',
  latestPosts: [POST],
  topLevelCategories: [{ id: '22222222-2222-4333-8444-555555555555', name: 'News', slug: 'news', mainImageUrl: null }],
};

const CATEGORY: BlogBySlugCategoryResponse = {
  kind: 'category',
  category: {
    id: '33333333-2222-4333-8444-555555555555',
    name: 'News',
    slug: 'news',
    mainImageUrl: null,
    description: null,
    metaTitle: null,
    metaDescription: null,
    metaKeywords: null,
    childCategories: [{ id: '44444444-2222-4333-8444-555555555555', name: 'Events', slug: 'events', mainImageUrl: null }],
    breadcrumb: [],
  },
  posts: { data: [], pagination: PAGINATION },
};

const TAG: BlogTagByCodeResponse = {
  tag: { id: '55555555-2222-4333-8444-555555555555', code: 'tips', name: 'tips', description: null },
  posts: { data: [], pagination: PAGINATION },
  breadcrumb: [],
};

describe('blog index', () => {
  it('reads English', () => {
    const html = renderToString(<BlogIndexPage payload={INDEX} locale="en-US" />);
    expect(html).toContain('>Blog</h1>');
    expect(html).toContain('>Latest posts</h2>');
    expect(html).toContain('>Categories</h2>');
    expect(html).toContain('3/5/2026');
    expect(html).not.toMatch(POLISH);
  });

  it('reads Polish, with the date written the Polish way', () => {
    const html = renderToString(<BlogIndexPage payload={INDEX} locale="pl-PL" />);
    expect(html).toContain('>Najnowsze wpisy</h2>');
    expect(html).toContain('>Kategorie</h2>');
    expect(html).toContain('5.03.2026');
  });

  it('says there are no posts yet in both languages', () => {
    expect(renderToString(<BlogIndexPage payload={INDEX_EMPTY} locale="en-US" />)).toContain(
      'No posts yet — check back soon.',
    );
    expect(renderToString(<BlogIndexPage payload={INDEX_EMPTY} locale="pl-PL" />)).toContain(
      'Nie ma jeszcze wpisów — zajrzyj tu wkrótce.',
    );
  });
});

describe('blog category', () => {
  it('reads English: empty state, subcategories and pagination', () => {
    const html = renderToString(<BlogCategoryPage payload={CATEGORY} locale="en-US" />);
    expect(html).toContain('No posts in this category yet.');
    expect(html).toContain('aria-label="Subcategories"');
    expect(html).toContain('aria-label="Pagination"');
    expect(html).toContain('← <!-- -->Previous');
    expect(html).toContain('Next<!-- --> →');
    expect(html).not.toMatch(POLISH);
  });

  it('reads Polish', () => {
    const html = renderToString(<BlogCategoryPage payload={CATEGORY} locale="pl-PL" />);
    expect(html).toContain('W tej kategorii nie ma jeszcze wpisów.');
    expect(html).toContain('aria-label="Podkategorie"');
    expect(html).toContain('aria-label="Paginacja"');
    expect(html).toContain('← <!-- -->Poprzednia');
    expect(html).toContain('Następna<!-- --> →');
  });
});

describe('blog tag', () => {
  it('says no post carries the tag, in both languages', () => {
    expect(renderToString(<BlogTagPage payload={TAG} locale="en-US" />)).toContain('No posts carry this tag yet.');
    expect(renderToString(<BlogTagPage payload={TAG} locale="pl-PL" />)).toContain('Żaden wpis nie ma jeszcze tego tagu.');
  });
});

describe('related strips', () => {
  it('head the related posts and products in the page language', () => {
    expect(renderToString(<RelatedPostsStrip posts={[POST]} locale="en-US" />)).toContain('>Related posts</h2>');
    expect(renderToString(<RelatedPostsStrip posts={[POST]} locale="pl-PL" />)).toContain('>Powiązane wpisy</h2>');
    const product = { id: POST.id, slug: 'screw', name: 'Screw', mainImageUrl: null, price: null };
    expect(renderToString(<RelatedProductsStrip products={[product]} locale="en-US" />)).toContain(
      '>Related products</h2>',
    );
    expect(renderToString(<RelatedProductsStrip products={[product]} locale="pl-PL" />)).toContain(
      '>Powiązane produkty</h2>',
    );
  });
});

describe('blog page titles', () => {
  const state = { locale: 'en-US' };
  vi.doMock('../../lib/server-context', () => ({
    getServerContext: async () => ({ ctx: { locale: state.locale }, locale: state.locale }),
  }));
  vi.doMock('../../lib/i18n/navigation', () => ({ localizedAlternates: async () => ({ canonical: '/blog' }) }));
  vi.doMock('../../lib/api/blog', () => ({
    getBlogIndex: async () => INDEX,
    getBlogTagByCode: async (code: string) => (code === 'tips' ? TAG : null),
    getBlogBySlug: async (slug: string) => (slug === 'news' ? CATEGORY : null),
  }));

  async function title(locale: string, slug: string[] | undefined): Promise<unknown> {
    state.locale = locale;
    const { generateMetadata } = await import('../../app/blog/[[...slug]]/page');
    const metadata = await generateMetadata({ params: Promise.resolve(slug ? { slug } : {}), searchParams: Promise.resolve({}) });
    return metadata.title;
  }

  it('titles the index, a tag, a category and a miss in English and in Polish', async () => {
    expect(await title('en-US', undefined)).toBe('Blog');
    expect(await title('en-US', ['tag', 'tips'])).toBe('#tips — Blog');
    expect(await title('en-US', ['news'])).toBe('News — Blog');
    expect(await title('en-US', ['missing'])).toBe('Not found');
    expect(await title('pl-PL', ['missing'])).toBe('Nie znaleziono');
    expect(await title('pl-PL', ['tag', 'missing'])).toBe('Nie znaleziono');
  });
});
