import { describe, expect, it } from 'vitest';
import {
  blogCategoryTileSchema,
  blogIndexResponseSchema,
  blogPostCardSchema,
  blogResolvedTagRefSchema,
  blogTagByCodeResponseSchema,
} from './blog.js';

/**
 * Feature 171 — storefront payloads carry the URLs the backend composed with
 * `blogPath` (`specs/171-blog-i18n-authors/contracts/storefront-api.md`). Every new
 * field is optional, so a payload cached before it existed still parses.
 */

const ID = '00000000-0000-4000-8000-000000000001';

const card = {
  id: ID,
  slug: 'porady',
  name: 'Porady',
  publishedAt: null,
  excerpt: null,
  mainImageUrl: null,
  primaryCategorySlug: null,
};
const tile = { id: ID, name: 'Porady', slug: 'porady', mainImageUrl: null };
const tagRef = { id: ID, code: 'diy', name: 'DIY' };

describe('blog payload URLs', () => {
  it('keeps the url of a post card, a category tile and a tag reference', () => {
    expect(blogPostCardSchema.parse({ ...card, url: '/pl/aktualnosci/porady' }).url).toBe('/pl/aktualnosci/porady');
    expect(blogCategoryTileSchema.parse({ ...tile, url: '/pl/aktualnosci/porady' }).url).toBe('/pl/aktualnosci/porady');
    expect(blogResolvedTagRefSchema.parse({ ...tagRef, url: '/pl/aktualnosci/tag/diy' }).url).toBe(
      '/pl/aktualnosci/tag/diy',
    );
  });

  it('keeps the url of the index and of a tag page', () => {
    const index = blogIndexResponseSchema.parse({
      urlPrefix: 'aktualnosci',
      url: '/pl/aktualnosci',
      latestPosts: [],
      topLevelCategories: [],
    });
    expect(index.url).toBe('/pl/aktualnosci');
    const tagPage = blogTagByCodeResponseSchema.parse({
      tag: { id: ID, code: 'diy', name: 'DIY', description: null, url: '/pl/aktualnosci/tag/diy' },
      posts: { data: [], pagination: { page: 1, perPage: 12, totalPages: 1, totalItems: 0 } },
      breadcrumb: [],
    });
    expect(tagPage.tag.url).toBe('/pl/aktualnosci/tag/diy');
  });

  it('still parses payloads cached before the urls existed', () => {
    expect(blogPostCardSchema.parse(card).url).toBeUndefined();
    expect(blogCategoryTileSchema.parse(tile).url).toBeUndefined();
    expect(blogResolvedTagRefSchema.parse(tagRef).url).toBeUndefined();
  });
});
