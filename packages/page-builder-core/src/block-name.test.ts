import { describe, expect, it } from 'vitest';
import { formatBlockName, isNamespaced, ownerOf, parseBlockName } from './block-name.js';

/**
 * Feature 096, Phase 1 — T104.
 *
 * One implementation of the block-name grammar's readers, in the
 * `text-normalization.ts` discipline: every file that needs to split a block
 * name imports these, and the regex itself is authored once, in
 * `@endora-commerce/contracts`, where the Zod schema that refuses a bad name
 * already needs it.
 */
describe('parseBlockName', () => {
  it('splits a namespaced name into its owner and its local name', () => {
    expect(parseBlockName('catalog.ProductGrid')).toEqual({
      owner: 'catalog',
      local: 'ProductGrid',
    });
    expect(parseBlockName('transactional_emails.EmailInsertTemplate')).toEqual({
      owner: 'transactional_emails',
      local: 'EmailInsertTemplate',
    });
  });

  it('returns null for a bare name rather than throwing', () => {
    // FR-014: the migration classifies every name it meets, including ones it
    // does not recognise, and a classification path that throws cannot leave a
    // row byte-identical.
    expect(parseBlockName('Row')).toBeNull();
    expect(parseBlockName('EmailOrderSummary')).toBeNull();
  });

  it('returns null for a name the grammar does not accept', () => {
    for (const name of [
      'catalog.productGrid',
      'Catalog.ProductGrid',
      'catalog.email.ProductCard',
      'catalog.',
      '.ProductGrid',
      '',
      'catalog.Product_Grid',
    ]) {
      expect(parseBlockName(name), name).toBeNull();
    }
  });
});

describe('ownerOf', () => {
  it('answers the owner segment', () => {
    expect(ownerOf('orders.EmailOrderSummary')).toBe('orders');
  });

  it('answers null for a name with no owner', () => {
    expect(ownerOf('Row')).toBeNull();
    expect(ownerOf('catalog.productGrid')).toBeNull();
  });
});

describe('isNamespaced', () => {
  it('is true for a well-formed namespaced name', () => {
    expect(isNamespaced('cms.Row')).toBe(true);
  });

  it('is false for every bare name in the pre-migration vocabulary', () => {
    for (const name of ['Row', 'Hero', 'EmailOrderTotals', 'InvoiceKsef']) {
      expect(isNamespaced(name), name).toBe(false);
    }
  });

  it('is false for a dotted name the grammar refuses', () => {
    // Deliberately stricter than `indexOf('.') !== -1`. A hand-edited
    // `acme.banner` is not a name this platform can render, so classifying it
    // as "already namespaced" would hide it from the operator's report; as an
    // unrecognised name it is reported and left byte-identical, which is the
    // FR-014 path it belongs on.
    expect(isNamespaced('acme.banner')).toBe(false);
  });
});

describe('formatBlockName', () => {
  it('joins an owner and a local name', () => {
    expect(formatBlockName('catalog', 'ProductGrid')).toBe('catalog.ProductGrid');
  });

  it('round-trips with parseBlockName', () => {
    const parsed = parseBlockName('orders.EmailShippingAddress');
    expect(parsed).not.toBeNull();
    expect(formatBlockName(parsed!.owner, parsed!.local)).toBe('orders.EmailShippingAddress');
  });

  it('throws rather than producing a name that cannot be parsed back', () => {
    // A block name is persisted forever; a construction helper that emits an
    // unparseable one writes a row nothing can ever render.
    expect(() => formatBlockName('Catalog', 'ProductGrid')).toThrow(/not a valid block name/);
    expect(() => formatBlockName('catalog', 'productGrid')).toThrow(/not a valid block name/);
    expect(() => formatBlockName('catalog', '')).toThrow(/not a valid block name/);
  });
});
