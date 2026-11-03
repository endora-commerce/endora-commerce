import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  BlogBySlugCategoryResponse,
  BlogBySlugPostResponse,
  BlogIndexResponse,
  BlogPostCard,
  BlogTagByCodeResponse,
} from '@endora-commerce/contracts';
import { BlogIndexPage } from '../../app/blog/_components/BlogIndexPage';
import { BlogCategoryPage } from '../../app/blog/_components/BlogCategoryPage';
import { BlogTagPage } from '../../app/blog/_components/BlogTagPage';
import { BlogPostPage } from '../../app/blog/_components/BlogPostPage';

/**
 * Feature 171 (FR-002, T016) — every blog link the storefront renders is a URL the
 * backend composed (`blogPath`): under the language prefix and the operator's blog
 * prefix. No component builds one from a constant, so a channel whose blog lives at
 * `/aktualnosci` renders no link to `/blog`.
 */
const BASE = '/pl/aktualnosci';

const POST_CARD: BlogPostCard = {
  id: '11111111-2222-4333-8444-555555555555',
  slug: 'porady',
  name: 'Porady',
  publishedAt: '2026-03-05T10:00:00.000Z',
  excerpt: null,
  mainImageUrl: null,
  primaryCategorySlug: null,
  url: `${BASE}/porady`,
};

const TILE = {
  id: '22222222-2222-4333-8444-555555555555',
  name: 'Wydarzenia',
  slug: 'wydarzenia',
  mainImageUrl: null,
  url: `${BASE}/wydarzenia`,
};

const PAGINATION = { page: 2, perPage: 1, totalPages: 3, totalItems: 3 };

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
}

function expectNoBlogRoute(html: string): void {
  for (const href of hrefs(html)) expect(href, href).not.toMatch(/(^|\/)blog(\/|$|\?)/);
}

describe('blog links come from the payload (feature 171)', () => {
  it('index: post cards and category tiles', () => {
    const index: BlogIndexResponse = {
      urlPrefix: 'aktualnosci',
      url: BASE,
      latestPosts: [POST_CARD],
      topLevelCategories: [TILE],
    };
    const html = renderToString(<BlogIndexPage payload={index} locale="pl-PL" />);
    expect(hrefs(html)).toEqual(expect.arrayContaining([`${BASE}/porady`, `${BASE}/wydarzenia`]));
    expectNoBlogRoute(html);
  });

  it('category: subcategories, posts and the pagination base', () => {
    const category: BlogBySlugCategoryResponse = {
      kind: 'category',
      category: {
        id: '33333333-2222-4333-8444-555555555555',
        name: 'Aktualności',
        slug: 'nowosci',
        mainImageUrl: null,
        description: null,
        metaTitle: null,
        metaDescription: null,
        metaKeywords: null,
        childCategories: [TILE],
        breadcrumb: [
          { name: 'Blog', url: BASE },
          { name: 'Aktualności', url: `${BASE}/nowosci` },
        ],
        url: `${BASE}/nowosci`,
      },
      posts: { data: [POST_CARD], pagination: PAGINATION },
    };
    const html = renderToString(<BlogCategoryPage payload={category} locale="pl-PL" />);
    expect(hrefs(html)).toEqual(
      expect.arrayContaining([`${BASE}/wydarzenia`, `${BASE}/porady`, `${BASE}/nowosci?page=1`, `${BASE}/nowosci?page=3`]),
    );
    expectNoBlogRoute(html);
  });

  it('tag: posts and the pagination base', () => {
    const tag: BlogTagByCodeResponse = {
      tag: { id: '55555555-2222-4333-8444-555555555555', code: 'diy', name: 'DIY', description: null, url: `${BASE}/tag/diy` },
      posts: { data: [POST_CARD], pagination: PAGINATION },
      breadcrumb: [
        { name: 'Blog', url: BASE },
        { name: 'DIY', url: `${BASE}/tag/diy` },
      ],
    };
    const html = renderToString(<BlogTagPage payload={tag} locale="pl-PL" />);
    expect(hrefs(html)).toEqual(expect.arrayContaining([`${BASE}/porady`, `${BASE}/tag/diy?page=1`]));
    expectNoBlogRoute(html);
  });

  it('post: breadcrumbs, tag chips, related posts and the JSON-LD url', () => {
    const post: BlogBySlugPostResponse = {
      kind: 'post',
      post: {
        id: '66666666-2222-4333-8444-555555555555',
        name: 'Jak wybrać wiertarkę',
        slug: 'jak-wybrac',
        publishedAt: null,
        metaTitle: null,
        metaDescription: null,
        metaKeywords: null,
        content: { schema_version: 1, languages: {} },
        tags: [{ id: '77777777-2222-4333-8444-555555555555', code: 'diy', name: 'DIY', url: `${BASE}/tag/diy` }],
        relatedPosts: [POST_CARD],
        relatedProducts: [],
        relatedProductIds: [],
        categories: [],
        breadcrumb: [
          { name: 'Blog', url: BASE },
          { name: 'Jak wybrać wiertarkę', url: `${BASE}/jak-wybrac` },
        ],
        url: `${BASE}/jak-wybrac`,
      },
    };
    const html = renderToString(
      <BlogPostPage payload={post} language="pl-PL" locale="pl-PL" relatedProducts={[]} salesChannelCode="b2b" />,
    );
    expect(hrefs(html)).toEqual(expect.arrayContaining([BASE, `${BASE}/tag/diy`, `${BASE}/porady`]));
    expect(html).toContain(`${BASE}/jak-wybrac`);
    expectNoBlogRoute(html);
  });
});
