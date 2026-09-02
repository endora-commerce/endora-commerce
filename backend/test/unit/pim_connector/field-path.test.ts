import { describe, expect, it } from 'vitest';
import { pimFieldPathSchema } from '@endora-commerce/contracts';
import {
  canonicalisePimFieldPath,
  isValidPimFieldPath,
} from '@endora-commerce/contracts';

/** Paths from specs/089-unopim-pim-sync/contracts/pim-connector-shared.md */
const VALID_PATHS = [
  'attribute.color',
  'attribute.color.en',
  'attribute.color.en_US',
  'attribute.weight.550e8400-e29b-41d4-a716-446655440000.en',
  'seo.metaTitle.en',
  'seo.metaDescription.pl_PL',
  'gallery.0',
  'gallery.12',
  'attachment.550e8400-e29b-41d4-a716-446655440000',
  'price.550e8400-e29b-41d4-a716-446655440000.PLN',
  'category.550e8400-e29b-41d4-a716-446655440000',
  'name.en',
  'description.pl',
] as const;

const INVALID_PATHS = [
  '',
  'attribute.',
  'attribute.1bad',
  'attribute.color.bad-locale',
  'seo.title.en',
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

  it('canonicalises locale casing', () => {
    expect(canonicalisePimFieldPath('name.en_us')).toBe('name.en_US');
    expect(canonicalisePimFieldPath('attribute.sku.en_us')).toBe('attribute.sku.en_US');
  });

  it('canonicalises UUID and currency casing', () => {
    expect(
      canonicalisePimFieldPath(
        'price.550E8400-E29B-41D4-A716-446655440000.pln',
      ),
    ).toBe('price.550e8400-e29b-41d4-a716-446655440000.PLN');
  });
});
