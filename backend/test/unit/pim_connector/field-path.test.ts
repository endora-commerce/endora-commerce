import { describe, expect, it } from 'vitest';
import { pimFieldPathSchema } from '@endora-commerce/contracts';
import {
  canonicalisePimFieldPath,
  isValidPimFieldPath,
} from '@endora-commerce/contracts';

/**
 * Paths from specs/089-unopim-pim-sync/contracts/pim-connector-shared.md, shrunk by feature 168
 * (`specs/168-product-editor-scope-switcher/contracts/pim-locale-mapping.md` §3, FR-046):
 * protection is whole-field, so locale and channel segments are no longer valid.
 */
const VALID_PATHS = [
  'attribute.color',
  'seo.metaTitle',
  'seo.metaDescription',
  'gallery.0',
  'gallery.12',
  'attachment.550e8400-e29b-41d4-a716-446655440000',
  'price.550e8400-e29b-41d4-a716-446655440000.PLN',
  'category.550e8400-e29b-41d4-a716-446655440000',
  'name',
  'description',
] as const;

const INVALID_PATHS = [
  '',
  'attribute.',
  'attribute.1bad',
  'attribute.color.en',
  'attribute.color.en_US',
  'attribute.weight.550e8400-e29b-41d4-a716-446655440000.en',
  'seo.metaTitle.en',
  'seo.title.en',
  'name.en',
  'description.pl',
  'gallery.-1',
  'price.not-a-uuid.PLN',
  'categories.root',
] as const;

describe('pim_connector field path grammar', () => {
  it.each(VALID_PATHS)('accepts %s', (path) => {
    expect(pimFieldPathSchema.safeParse(path).success).toBe(true);
    expect(isValidPimFieldPath(path)).toBe(true);
    expect(canonicalisePimFieldPath(path)).not.toBeNull();
  });

  it.each(INVALID_PATHS)('rejects %s', (path) => {
    expect(isValidPimFieldPath(path)).toBe(false);
    expect(canonicalisePimFieldPath(path)).toBeNull();
  });

  it('canonicalises UUID and currency casing', () => {
    expect(
      canonicalisePimFieldPath(
        'price.550E8400-E29B-41D4-A716-446655440000.pln',
      ),
    ).toBe('price.550e8400-e29b-41d4-a716-446655440000.PLN');
  });
});
