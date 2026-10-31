import { describe, expect, it } from 'vitest';
import {
  PRODUCT_LIST_MAX_IDS,
  productListIdsSchema,
  productListQuerySchema,
} from './catalog.js';
import { blogProductCardSchema, blogResolvedPostSchema } from './blog.js';

/**
 * Issue #590 — the public catalogue listing reads a hand-picked set of products
 * (`?ids=`), so a surface that names products by id — a blog post's related
 * products — prices them in one batch, for the viewer, exactly as a listing
 * does. Additive: a request without `ids` parses as it did.
 */

const A = '11111111-2222-4333-8444-555555555555';
const B = '99999999-8888-4777-8666-555555555555';
const C = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('productListIdsSchema (issue #590)', () => {
  it('reads a comma-separated list, trims it, and keeps the first occurrence of each id in order', () => {
    expect(productListIdsSchema.parse(` ${B},${A} ,${B},${C}`)).toEqual([B, A, C]);
  });

  it('refuses a value that is not a uuid', () => {
    expect(productListIdsSchema.safeParse(`${A},not-a-uuid`).success).toBe(false);
  });

  it('refuses an empty list', () => {
    expect(productListIdsSchema.safeParse('').success).toBe(false);
    expect(productListIdsSchema.safeParse(' , ').success).toBe(false);
  });

  it(`refuses more than ${PRODUCT_LIST_MAX_IDS} distinct ids`, () => {
    expect(PRODUCT_LIST_MAX_IDS).toBe(24);
    const ids = Array.from(
      { length: PRODUCT_LIST_MAX_IDS + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(productListIdsSchema.safeParse(ids.slice(0, PRODUCT_LIST_MAX_IDS).join(',')).success).toBe(true);
    expect(productListIdsSchema.safeParse(ids.join(',')).success).toBe(false);
  });

  it('is an optional member of the listing query, absent by default', () => {
    expect(productListQuerySchema.parse({}).ids).toBeUndefined();
    expect(productListQuerySchema.parse({ ids: `${A},${B}` }).ids).toEqual([A, B]);
    expect(productListQuerySchema.safeParse({ ids: 'x' }).success).toBe(false);
  });
});

describe('the blog post payload names its related products by id (issue #590)', () => {
  const POST = {
    id: A,
    name: 'Post',
    slug: 'post',
    publishedAt: null,
    metaTitle: null,
    metaDescription: null,
    metaKeywords: null,
    content: { schema_version: 1, languages: {} },
    tags: [],
    relatedPosts: [],
    relatedProducts: [],
    categories: [],
    breadcrumb: [],
  };

  it('carries `relatedProductIds` in the post order', () => {
    expect(blogResolvedPostSchema.parse({ ...POST, relatedProductIds: [B, A] }).relatedProductIds).toEqual([B, A]);
  });

  it('still parses a payload cached before the field existed', () => {
    expect(blogResolvedPostSchema.parse(POST).relatedProductIds).toBeUndefined();
  });

  it('keeps the deprecated card shape parseable for one minor', () => {
    expect(
      blogProductCardSchema.safeParse({ id: A, slug: 's', name: 'n', mainImageUrl: null, price: null }).success,
    ).toBe(true);
  });
});
