import { describe, expect, it } from 'vitest';
import { pimFieldPathSchema } from './pim-connector.js';
import { canonicalisePimFieldPath, isValidPimFieldPath } from './pim-field-path.js';

/**
 * Feature 168 (`contracts/pim-locale-mapping.md` §3, FR-046) — the protection path grammar
 * shrinks to whole-field paths: a locale or channel segment is no longer part of a field's
 * address, because protection removes every scope of the field.
 */

const UUID = '550e8400-e29b-41d4-a716-446655440000';

const VALID = [
  'attribute.color',
  'seo.metaTitle',
  'seo.metaDescription',
  'seo.metaKeywords',
  'name',
  'description',
  'gallery.0',
  'gallery.12',
  `attachment.${UUID}`,
  `price.${UUID}.PLN`,
  `category.${UUID}`,
];

const INVALID = [
  '',
  'attribute.',
  'attribute.1bad',
  'attribute.color.en',
  'attribute.color.en_US',
  `attribute.weight.${UUID}`,
  `attribute.weight.${UUID}.en`,
  'seo.metaTitle.en',
  'seo.metaDescription.pl_PL',
  'seo.title',
  'name.en',
  'name.pl_PL',
  'description.pl',
  'gallery.-1',
  'price.not-a-uuid.PLN',
  'categories.root',
];

describe('PIM field path grammar after 168', () => {
  it.each(VALID)('accepts the whole-field path %s', (path) => {
    expect(pimFieldPathSchema.safeParse(path).success).toBe(true);
    expect(isValidPimFieldPath(path)).toBe(true);
  });

  it.each(INVALID)('refuses %s (locale and channel segments are gone)', (path) => {
    expect(pimFieldPathSchema.safeParse(path).success).toBe(false);
    expect(canonicalisePimFieldPath(path)).toBeNull();
  });

  it('canonicalises uuid and currency casing and trims', () => {
    expect(canonicalisePimFieldPath(` price.${UUID.toUpperCase()}.pln `)).toBe(`price.${UUID}.PLN`);
    expect(canonicalisePimFieldPath(`attachment.${UUID.toUpperCase()}`)).toBe(`attachment.${UUID}`);
  });
});
