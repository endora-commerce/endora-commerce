import { describe, expect, it } from 'vitest';
import { resolveVariant, type VariantLike } from './variant-resolver.js';

const variants: VariantLike[] = [
  { id: 'v1', sku: 'TS-RED-S', variantAttributeValues: { color: 'Red', size: 'S' } },
  { id: 'v2', sku: 'TS-RED-L', variantAttributeValues: { color: 'Red', size: 'L' } },
  { id: 'v3', sku: 'TS-BLUE-L', variantAttributeValues: { color: 'Blue', size: 'L' } },
];

describe('resolveVariant', () => {
  it('returns no_variants when the product has none (base product is used)', () => {
    expect(resolveVariant([], { color: 'Red' })).toEqual({ kind: 'no_variants' });
  });

  it('resolves a unique match across all supplied axes (case-insensitive)', () => {
    expect(resolveVariant(variants, { color: 'red', size: ' L ' })).toEqual({
      kind: 'resolved',
      variantId: 'v2',
      variantSku: 'TS-RED-L',
    });
  });

  it('rejects as ambiguous when more than one variant matches', () => {
    expect(resolveVariant(variants, { color: 'Red' })).toEqual({ kind: 'ambiguous' });
  });

  it('rejects as ambiguous when no axis values are supplied for a multi-variant product', () => {
    expect(resolveVariant(variants, {})).toEqual({ kind: 'ambiguous' });
  });

  it('rejects as not_resolved when no variant matches', () => {
    expect(resolveVariant(variants, { color: 'Green' })).toEqual({ kind: 'not_resolved' });
  });

  it('ignores blank attribute values when matching', () => {
    expect(resolveVariant(variants, { color: 'Blue', size: '' })).toEqual({
      kind: 'resolved',
      variantId: 'v3',
      variantSku: 'TS-BLUE-L',
    });
  });
});
