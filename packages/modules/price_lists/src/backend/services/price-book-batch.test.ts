import { describe, expect, it } from 'vitest';
import type { CatalogAttributeView } from '@endora-commerce/contracts';
import { PRICE_BOOK_MAX_ROWS } from '@endora-commerce/contracts';
import { batchNeeds, parseBatchRows, planBatch, touchedSelections, type BatchLookups, type StoredRow } from './price-book-batch.js';

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

function plan(
  upsert: unknown[],
  options: { mode?: 'merge' | 'replace'; rows?: StoredRow[]; base?: boolean; deleteIds?: string[]; storedRowCount?: number } = {},
) {
  const { parsed, errors } = parseBatchRows(upsert);
  return planBatch({
    isBaseBook: options.base ?? false,
    stored: options.rows ?? [],
    storedRowCount: options.storedRowCount ?? (options.rows ?? []).length,
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

/**
 * Feature 161, G18 — a batch is planned against the stored rows of the
 * selections it touches and the book's row count, not against every row of the
 * book; the 5 000-row cap holds for non-base books only.
 */
describe('price-book batch planning — scoped to what the batch touches (161 G18)', () => {
  const upsert = (productId: string, min = 1, amount = '1') => ({
    selection: { productId },
    minQuantity: min,
    maxQuantity: min === 1 ? 9 : null,
    price: { type: 'fixed', amount },
  });

  it('caps a non-base book by its row count after the batch, not by the rows it was handed', () => {
    const atCap = plan([upsert(P2)], { storedRowCount: PRICE_BOOK_MAX_ROWS - 1 });
    expect(atCap.errors).toEqual([]);
    const over = plan([upsert(P2), upsert(P2, 10)], { storedRowCount: PRICE_BOOK_MAX_ROWS - 1 });
    expect(over.errors.map((e) => e.code)).toEqual(['PRICE_BOOK_ROW_LIMIT']);
    // A changed row adds none: at the cap, replacing a stored row is accepted.
    const changed = plan([upsert(P1, 1, '9')], { rows: [stored('r1', P1, 1, null, '1.0000')], storedRowCount: PRICE_BOOK_MAX_ROWS });
    expect(changed.errors).toEqual([]);
    expect(changed.changed).toHaveLength(1);
    // A delete frees a row.
    const swapped = plan([upsert(P2)], { rows: [stored('r1', P1, 1, null, '1.0000')], storedRowCount: PRICE_BOOK_MAX_ROWS, deleteIds: ['r1'] });
    expect(swapped.errors).toEqual([]);
  });

  it('does not cap a base book', () => {
    const result = plan([upsert(P2), upsert(P2, 10)], { base: true, storedRowCount: 40_000 });
    expect(result.errors).toEqual([]);
    expect(result.added).toHaveLength(2);
  });

  it('touches the selections of the rows it can resolve, once, a variant under its product', () => {
    const { parsed } = parseBatchRows([
      upsert(P1),
      upsert(P1, 10),
      { selection: { productId: P1, variantId: V1 }, minQuantity: 1, price: { type: 'percent', percent: '5' } },
      { key: { categoryPath: 'tools/screws', attribute: { key: 'color', valueCode: 'red' } }, minQuantity: 1, price: { type: 'percent', percent: '5' } },
      { key: { productSku: 'NOPE' }, minQuantity: 1, price: { type: 'fixed', amount: '1' } },
      { selection: {}, minQuantity: 1, price: { type: 'percent', percent: '-1' } },
    ]);
    const touched = touchedSelections(parsed, lookups);
    expect(touched).toEqual([
      { variantId: null, productId: P1, categoryId: null, attributeKey: null, attributeValue: null },
      { variantId: V1, productId: P1, categoryId: null, attributeKey: null, attributeValue: null },
      { variantId: null, productId: null, categoryId: C1, attributeKey: 'color', attributeValue: 'red' },
      { variantId: null, productId: null, categoryId: null, attributeKey: null, attributeValue: null },
    ]);
  });
});

/**
 * Feature 161, Checkpoint 11 ruling 2 — every refusal of a row carries a
 * per-rule `reason` code beside its group `code`, so a consumer translates the
 * rule instead of quoting the server's English `message`
 * (`specs/conventions/module-i18n.md`: the backend returns codes, the consumer
 * translates). The attribute refusal is three reasons, one per case.
 */
describe('price-book batch planning — a reason code per rule (161)', () => {
  const reasonsOf = (upsert: unknown[], options: Parameters<typeof plan>[1] = {}) =>
    plan(upsert, options).errors.map((e) => [e.index, e.code, e.reason]);
  const fixed = (amount: string) => ({ type: 'fixed', amount });

  it('names each shape rule', () => {
    expect(
      reasonsOf([
        { selection: { productId: P1, categoryId: C1 }, minQuantity: 1, price: fixed('1') },
        { selection: { productId: P1 }, minQuantity: 5, maxQuantity: 2, price: fixed('1') },
        { selection: {}, minQuantity: 1, price: fixed('1') },
        { selection: { variantId: V1 }, minQuantity: 1, price: fixed('1') },
        { selection: { productId: P1 }, minQuantity: 0, price: fixed('1') },
      ]),
    ).toEqual([
      [0, 'PRICE_BOOK_ROW_SHAPE', 'selection_combined'],
      [1, 'PRICE_BOOK_ROW_SHAPE', 'max_below_min'],
      [2, 'PRICE_BOOK_ROW_SHAPE', 'fixed_on_all'],
      [3, 'PRICE_BOOK_ROW_SHAPE', 'variant_needs_product'],
      [4, 'PRICE_BOOK_ROW_SHAPE', 'row_invalid'],
    ]);
  });

  it('names the base book’s rules', () => {
    expect(
      reasonsOf(
        [
          { selection: { categoryId: C1 }, minQuantity: 1, price: { type: 'percent', percent: '-5.00' } },
          { selection: { productId: P1 }, minQuantity: 1, price: { type: 'percent', percent: '-5.00' } },
        ],
        { base: true },
      ),
    ).toEqual([
      [0, 'PRICE_BOOK_ROW_SHAPE', 'base_book_kind'],
      [1, 'PRICE_BOOK_ROW_SHAPE', 'base_product_fixed'],
    ]);
  });

  it('names each target that does not exist', () => {
    expect(
      reasonsOf([
        { key: { productSku: 'NOPE' }, minQuantity: 1, price: fixed('1') },
        { key: { variantSku: 'NOPE' }, minQuantity: 1, price: fixed('1') },
        { key: { productSku: 'SKU-2', variantSku: 'VAR-1' }, minQuantity: 1, price: fixed('1') },
        { key: { categoryPath: 'nowhere' }, minQuantity: 1, price: { type: 'percent', percent: '-5.00' } },
        { selection: { productId: '00000000-0000-4000-8000-0000000000ff' }, minQuantity: 1, price: fixed('1') },
        { selection: { productId: P2, variantId: V1 }, minQuantity: 1, price: fixed('1') },
      ]),
    ).toEqual([
      [0, 'PRICE_BOOK_ROW_TARGET', 'product_unknown'],
      [1, 'PRICE_BOOK_ROW_TARGET', 'variant_unknown'],
      [2, 'PRICE_BOOK_ROW_TARGET', 'variant_other_product'],
      [3, 'PRICE_BOOK_ROW_TARGET', 'category_unknown'],
      [4, 'PRICE_BOOK_ROW_TARGET', 'product_unknown'],
      [5, 'PRICE_BOOK_ROW_TARGET', 'variant_other_product'],
    ]);
  });

  it('tells the attribute refusal’s cases apart', () => {
    const notSelectable = { ...color, key: 'size', isPriceRule: false } as unknown as CatalogAttributeView;
    const yesNo = { ...color, key: 'eco', valueType: 'boolean', options: [] } as unknown as CatalogAttributeView;
    lookups.attributes.set('size', notSelectable);
    lookups.attributes.set('eco', yesNo);
    try {
      expect(
        reasonsOf([
          { key: { attribute: { key: 'size', valueCode: 'xl' } }, minQuantity: 1, price: { type: 'percent', percent: '-5.00' } },
          { key: { attribute: { key: 'color', valueCode: 'teal' } }, minQuantity: 1, price: { type: 'percent', percent: '-5.00' } },
          { key: { attribute: { key: 'eco', valueCode: 'maybe' } }, minQuantity: 1, price: { type: 'percent', percent: '-5.00' } },
          { key: { attribute: { key: 'gone', valueCode: 'x' } }, minQuantity: 1, price: { type: 'percent', percent: '-5.00' } },
        ]),
      ).toEqual([
        [0, 'PRICE_BOOK_ROW_TARGET', 'attribute_not_selectable'],
        [1, 'PRICE_BOOK_ROW_TARGET', 'attribute_value_unknown'],
        [2, 'PRICE_BOOK_ROW_TARGET', 'attribute_value_boolean'],
        [3, 'PRICE_BOOK_ROW_TARGET', 'attribute_not_selectable'],
      ]);
    } finally {
      lookups.attributes.delete('size');
      lookups.attributes.delete('eco');
    }
  });

  it('names an overlap, a delete of a row not in the book and the book’s limit', () => {
    const rows = [stored('00000000-0000-4000-8000-0000000000d1', P1, 1, 9, '10.0000')];
    const result = plan([{ selection: { productId: P1 }, minQuantity: 5, price: fixed('9') }], {
      rows,
      deleteIds: ['00000000-0000-4000-8000-0000000000e1'],
      storedRowCount: PRICE_BOOK_MAX_ROWS,
    });
    expect(result.errors.map((e) => [e.code, e.reason]).sort()).toEqual(
      [
        ['PRICE_BOOK_ROW_LIMIT', 'book_row_limit'],
        ['PRICE_BOOK_ROW_OVERLAP', 'rows_overlap'],
        ['PRICE_BOOK_ROW_TARGET', 'row_not_in_book'],
      ].sort(),
    );
  });
});
