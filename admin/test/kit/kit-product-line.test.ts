import { describe, expect, it } from 'vitest';
import { LINE_QUANTITY_MAX } from '@endora-commerce/contracts';
import { parsePositiveInt, productDisplayName } from '@endora-commerce/admin-kit/components';

/**
 * The two line helpers every product-browser host shares (feature 145): the name a
 * line, a chip or a roster row shows for a product, and the quantity parse that
 * marks a line invalid instead of coercing what the operator typed.
 */

describe('productDisplayName', () => {
  // Feature 174 (FR-031, `contracts/readers.md` §1): the admin list answers the
  // product's Global name as one string; a host shows it as it is.
  it('shows the Global name string as it is', () => {
    expect(productDisplayName({ name: 'Drill X', slug: 'w' })).toBe('Drill X');
  });

  it('never splits a string name into characters', () => {
    expect(productDisplayName({ name: 'Wiertarka X', slug: 'w', sku: 'S' })).not.toBe('W');
  });

  it('falls back to the slug, then the SKU, then an empty string', () => {
    expect(productDisplayName({ name: '', slug: 'the-slug', sku: 'SKU-1' })).toBe('the-slug');
    expect(productDisplayName({ name: '', sku: 'SKU-1' })).toBe('SKU-1');
    expect(productDisplayName({ name: '' })).toBe('');
  });
});

describe('parsePositiveInt', () => {
  it('accepts a whole number of at least 1, surrounding spaces allowed', () => {
    expect(parsePositiveInt('1')).toBe(1);
    expect(parsePositiveInt(' 42 ')).toBe(42);
  });

  it.each(['', '0', '-1', '1.5', '1e3', 'abc', '9007199254740993'])('refuses %j', (input) => {
    expect(parsePositiveInt(input)).toBeNull();
  });

  // Issue #351 — the API refuses a line quantity past `LINE_QUANTITY_MAX`, so the
  // line is invalid on the form before it is sent, not after.
  it('accepts LINE_QUANTITY_MAX and refuses one more', () => {
    expect(parsePositiveInt(String(LINE_QUANTITY_MAX))).toBe(LINE_QUANTITY_MAX);
    expect(parsePositiveInt(String(LINE_QUANTITY_MAX + 1))).toBeNull();
    expect(parsePositiveInt('2147483648')).toBeNull();
  });
});
