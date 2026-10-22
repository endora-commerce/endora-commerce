import { describe, expect, it } from 'vitest';
import type { CatalogAttributeView } from '@endora-commerce/contracts';
import { batchNeeds, parseBatchRows, planBatch, type BatchLookups, type StoredRow } from './price-book-batch.js';

/**
 * Feature 160 (G6, G7, G10 of `specs/161-price-book-editor/`) — planning one
 * admin row batch, without a database: every failing row named with its
 * index, natural keys resolved, merge and replace, the diff, overlaps naming
 * the stored partner.
 */
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const V1 = '00000000-0000-4000-8000-0000000000b1';
const C1 = '00000000-0000-4000-8000-0000000000c1';

const color = {
  key: 'color',
  valueType: 'select',
  isPriceRule: true,
  languageScoped: false,
  channelScoped: false,
  options: [{ value: 'red' }, { value: 'blue' }],
} as unknown as CatalogAttributeView;

const lookups: BatchLookups = {
  productsById: new Map([
    [P1, { id: P1, sku: 'SKU-1' }],
    [P2, { id: P2, sku: 'SKU-2' }],
  ]),
  productsBySku: new Map([
    ['SKU-1', { id: P1, sku: 'SKU-1' }],
    ['SKU-2', { id: P2, sku: 'SKU-2' }],
  ]),
  variantsById: new Map([[V1, { id: V1, parentProductId: P1, sku: 'VAR-1' }]]),
  variantsBySku: new Map([['VAR-1', { id: V1, parentProductId: P1, sku: 'VAR-1' }]]),
  categoriesById: new Map([[C1, { id: C1 }]]),
  categoriesByPath: new Map([['tools/screws', C1]]),
  attributes: new Map([['color', color]]),
};

const stored = (id: string, productId: string, min: number, max: number | null, amount: string): StoredRow => ({
  id,
  variantId: null,
  productId,
  categoryId: null,
  attributeKey: null,
  attributeValue: null,
  minQuantity: min,
  maxQuantity: max,
  priceType: 'fixed',
  amount,
  percent: null,
});

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function plan(upsert: unknown[], options: { mode?: 'merge' | 'replace'; rows?: StoredRow[]; base?: boolean; deleteIds?: string[] } = {}) {
  const { parsed, errors } = parseBatchRows(upsert);
  return planBatch({
    isBaseBook: options.base ?? false,
    stored: options.rows ?? [],
    mode: options.mode ?? 'merge',
    parsed,
    parseErrors: errors,
    deleteIds: options.deleteIds ?? [],
    upsertCount: upsert.length,
    lookups,
    newId,
  });
}

describe('price-book batch planning (feature 160)', () => {
  it('names every failing row with its index, field and code (G6)', () => {
    const result = plan([
      { selection: { productId: P1 }, minQuantity: 1, price: { type: 'fixed', amount: '10' } },
      { selection: {}, minQuantity: 1, price: { type: 'fixed', amount: '10' } },
      { selection: { productId: P2 }, minQuantity: 5, maxQuantity: 2, price: { type: 'fixed', amount: '1' } },
      { selection: { productId: P2 }, minQuantity: 1, price: { type: 'percent', percent: '-150' } },
      { key: { productSku: 'NOPE' }, minQuantity: 1, price: { type: 'fixed', amount: '1' } },
      { selection: { productId: P1 }, key: { productSku: 'SKU-1' }, minQuantity: 1, price: { type: 'fixed', amount: '1' } },
    ]);
    expect(result.errors.map((e) => [e.index, e.field, e.code])).toEqual([
      [1, 'price.type', 'PRICE_BOOK_ROW_SHAPE'],
      [2, 'maxQuantity', 'PRICE_BOOK_ROW_SHAPE'],
      [3, 'price.percent', 'PRICE_BOOK_ROW_SHAPE'],
      [4, 'key.productSku', 'PRICE_BOOK_ROW_TARGET'],
      [5, 'selection', 'PRICE_BOOK_ROW_SHAPE'],
    ]);
    expect(result.resolved[0]).toMatchObject({ productId: P1, amount: '10.0000' });
    expect(result.resolved[4]).toBeNull();
  });

  it('resolves natural keys: SKU, variant SKU, category path, attribute value code (G10)', () => {
    const result = plan([
      { key: { productSku: 'SKU-2' }, minQuantity: 1, price: { type: 'fixed', amount: '5' } },
      { key: { variantSku: 'VAR-1' }, minQuantity: 1, price: { type: 'amount', amount: '-1' } },
      { key: { categoryPath: '/Tools/Screws/' }, minQuantity: 1, price: { type: 'percent', percent: '-5' } },
      { key: { categoryPath: 'tools/screws', attribute: { key: 'color', valueCode: 'red' } }, minQuantity: 1, price: { type: 'percent', percent: '-1' } },
      { key: { attribute: { key: 'color', valueCode: 'green' } }, minQuantity: 1, price: { type: 'percent', percent: '-1' } },
    ]);
    expect(result.resolved[0]).toMatchObject({ productId: P2 });
    expect(result.resolved[1]).toMatchObject({ variantId: V1, productId: P1, priceType: 'amount', amount: '-1.0000' });
    expect(result.resolved[2]).toMatchObject({ categoryId: C1, percent: '-5.00' });
    expect(result.resolved[3]).toMatchObject({ categoryId: C1, attributeKey: 'color', attributeValue: 'red' });
    expect(result.errors).toEqual([expect.objectContaining({ index: 4, field: 'key.attribute', code: 'PRICE_BOOK_ROW_TARGET' })]);
  });

  it('merge replaces the stored row of the same selection and start, and diffs (G10)', () => {
    const rows = [stored('s1', P1, 1, null, '95.0000'), stored('s2', P2, 1, null, '45.0000')];
    const result = plan(
      [
        { key: { productSku: 'SKU-1' }, minQuantity: 1, price: { type: 'fixed', amount: '93' } },
        { key: { productSku: 'SKU-2' }, minQuantity: 1, price: { type: 'fixed', amount: '45' } },
        { key: { categoryPath: 'tools/screws' }, minQuantity: 20, price: { type: 'percent', percent: '-7' } },
      ],
      { rows },
    );
    expect(result.errors).toEqual([]);
    expect(result.changed).toEqual([{ before: rows[0], after: expect.objectContaining({ id: 's1', amount: '93.0000' }) }]);
    expect(result.unchangedCount).toBe(1);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toEqual([]);
    expect(result.final).toHaveLength(3);
  });

  it('replace removes the rows the batch does not name; merge removes only `delete`', () => {
    const rows = [stored('s1', P1, 1, null, '95.0000'), stored('s2', P2, 1, null, '45.0000')];
    const replaced = plan([{ key: { productSku: 'SKU-1' }, minQuantity: 1, price: { type: 'fixed', amount: '95' } }], { rows, mode: 'replace' });
    expect(replaced.removed.map((r) => r.id)).toEqual(['s2']);
    expect(replaced.final.map((r) => r.id)).toEqual(['s1']);
    const merged = plan([], { rows, deleteIds: ['s2'] });
    expect(merged.removed.map((r) => r.id)).toEqual(['s2']);
    const unknownDelete = plan([], { rows, deleteIds: ['00000000-0000-4000-8000-0000000000ff'] });
    expect(unknownDelete.errors).toEqual([expect.objectContaining({ field: 'delete', code: 'PRICE_BOOK_ROW_TARGET' })]);
  });

  it('an overlap names the stored partner on the incoming row', () => {
    const rows = [stored('s1', P1, 1, 9, '90.0000')];
    const result = plan([{ selection: { productId: P1 }, minQuantity: 5, maxQuantity: 20, price: { type: 'fixed', amount: '85' } }], { rows });
    expect(result.errors).toEqual([
      expect.objectContaining({ index: 0, rowId: 's1', field: 'minQuantity', code: 'PRICE_BOOK_ROW_OVERLAP' }),
    ]);
  });

  it('a base book takes product rows (fixed) and variant rows, refusing the rest per row (G7)', () => {
    const result = plan(
      [
        { selection: { productId: P1 }, minQuantity: 1, price: { type: 'fixed', amount: '10' } },
        { selection: { productId: P1, variantId: V1 }, minQuantity: 1, price: { type: 'percent', percent: '5' } },
        { selection: { productId: P2 }, minQuantity: 1, price: { type: 'percent', percent: '5' } },
        { selection: { categoryId: C1 }, minQuantity: 1, price: { type: 'percent', percent: '5' } },
      ],
      { base: true },
    );
    expect(result.errors.map((e) => e.index)).toEqual([2, 3]);
  });

  it('collects what the batch names, once', () => {
    const { parsed } = parseBatchRows([
      { selection: { productId: P1 }, minQuantity: 1, price: { type: 'fixed', amount: '1' } },
      { key: { productSku: 'SKU-2', categoryPath: 'A/B' }, minQuantity: 1, price: { type: 'fixed', amount: '1' } },
    ]);
    const needs = batchNeeds(parsed);
    expect([...needs.productIds]).toEqual([P1]);
    expect([...needs.productSkus]).toEqual(['SKU-2']);
    expect([...needs.categoryPaths]).toEqual(['a/b']);
  });
});
