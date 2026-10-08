import { describe, expect, it } from 'vitest';

import {
  AdminZoneNameSchema,
  CATEGORY_CONTENT_MAX_BYTES,
  adminCategoryContentSchema,
  categoryContentEnvelopeSchema,
  categoryPageContentSchema,
  putCategoryContentRequestSchema,
} from '../src/index.js';

const TREE = {
  root: { props: {} },
  content: [{ type: 'RichContent', props: { id: 'rc-1', html: '<p>Hello</p>' } }],
};

describe('category page content — the envelope', () => {
  it('accepts one Page Builder tree per language', () => {
    const parsed = categoryContentEnvelopeSchema.parse({
      languages: { 'en-US': TREE, 'pl-PL': { root: { props: {} }, content: [] } },
    });
    expect(Object.keys(parsed?.languages ?? {})).toEqual(['en-US', 'pl-PL']);
  });

  it('accepts null, which is how content is cleared', () => {
    expect(categoryContentEnvelopeSchema.parse(null)).toBeNull();
  });

  it('refuses a tree that is not an object', () => {
    for (const tree of ['<p>html</p>', 42, ['a'], null]) {
      const result = categoryContentEnvelopeSchema.safeParse({ languages: { 'en-US': tree } });
      expect(result.success, JSON.stringify(tree)).toBe(false);
    }
  });

  it('refuses a language key that is not a language code', () => {
    expect(categoryContentEnvelopeSchema.safeParse({ languages: { x: TREE } }).success).toBe(false);
  });

  it('refuses keys beside `languages`, so a stray field is not stored', () => {
    expect(
      categoryContentEnvelopeSchema.safeParse({ languages: {}, html: '<script />' }).success,
    ).toBe(false);
  });

  it('refuses an envelope over the size limit and accepts one under it', () => {
    const big = (bytes: number): unknown => ({
      languages: {
        'en-US': { root: { props: {} }, content: [{ type: 'RawHtml', props: { html: 'x'.repeat(bytes) } }] },
      },
    });
    expect(categoryContentEnvelopeSchema.safeParse(big(CATEGORY_CONTENT_MAX_BYTES)).success).toBe(false);
    expect(categoryContentEnvelopeSchema.safeParse(big(1024)).success).toBe(true);
  });

  it('measures the limit in UTF-8 bytes rather than in characters', () => {
    // U+017C is one character and two bytes, so a string of them is over the
    // limit at half the length an ASCII one would need.
    const chars = Math.ceil(CATEGORY_CONTENT_MAX_BYTES / 2) + 1;
    const result = categoryContentEnvelopeSchema.safeParse({
      languages: { 'pl-PL': { root: { props: {} }, content: [{ type: 'Text', props: { text: '\u017c'.repeat(chars) } }] } },
    });
    expect(result.success).toBe(false);
  });
});

describe('category page content — the write and read shapes', () => {
  it('the write request carries the envelope and nothing else', () => {
    expect(putCategoryContentRequestSchema.safeParse({ content: { languages: { 'en-US': TREE } } }).success).toBe(true);
    expect(putCategoryContentRequestSchema.safeParse({ content: null }).success).toBe(true);
    expect(putCategoryContentRequestSchema.safeParse({}).success).toBe(false);
    expect(
      putCategoryContentRequestSchema.safeParse({ content: null, slug: 'renamed' }).success,
    ).toBe(false);
  });

  it('the admin read shape is the whole envelope, or null when nothing was authored', () => {
    const id = '33333333-3333-4333-8333-333333333303';
    expect(adminCategoryContentSchema.parse({ categoryId: id, content: null }).content).toBeNull();
    expect(
      adminCategoryContentSchema.safeParse({ categoryId: id, content: { languages: { 'en-US': TREE } } }).success,
    ).toBe(true);
  });

  it('the storefront read shape is one resolved tree and the language it came from', () => {
    const categoryId = '33333333-3333-4333-8333-333333333303';
    expect(
      categoryPageContentSchema.safeParse({ categoryId, language: 'en-US', content: TREE }).success,
    ).toBe(true);
    expect(
      categoryPageContentSchema.safeParse({ categoryId, language: null, content: null }).success,
    ).toBe(true);
  });
});

describe('category page content — the admin zone', () => {
  it('declares the place the category content screen mounts its editor in', () => {
    expect(AdminZoneNameSchema.options).toContain('category.content.editor');
  });
});
