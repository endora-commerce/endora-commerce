import { describe, expect, it } from 'vitest';
import { ERROR_CODES, bookProductRowsWriteSchema, type BookProductRows } from '@endora-commerce/contracts';
import type { StoredRow } from './price-book-batch.js';
import {
  assertBookTakesModuleRows,
  bookProductRowsOf,
  expressibleByPort,
  planBookProductRows,
  rowValueLines,
  writePathOf,
} from './price-book-row-write.js';
import { createPriceBookRowWritePort } from './price-book-row-write-port.js';

/**
 * Issue #1028 — `priceBookRowWritePort`: what a module's write of one
 * product's rows in one non-base book becomes. The write is the admin row
 * batch's (`PriceBookService.writeRows`'s planning and command); these are the
 * pure steps before it — which books take it, which batch it is, how a refused
 * row is named in the caller's terms, and how the stored rows read back.
 */

const BOOK = '00000000-0000-4000-8000-0000000000b1';
const P = '00000000-0000-4000-8000-000000000005';
const VR = '00000000-0000-4000-8000-0000000005a1';
const VB = '00000000-0000-4000-8000-0000000005b1';
const OTHER = '00000000-0000-4000-8000-0000000009a9';

const stored = (over: Partial<StoredRow> & Pick<StoredRow, 'id'>): StoredRow => ({
  variantId: null,
  productId: P,
  categoryId: null,
  attributeKey: null,
  attributeValue: null,
  minQuantity: 1,
  maxQuantity: null,
  priceType: 'fixed',
  amount: '10.0000',
  percent: null,
  ...over,
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const write = (raw: unknown) => bookProductRowsWriteSchema.parse(raw);

describe('which books take a module row write (issue #1028)', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const refusal = (book: Parameters<typeof assertBookTakesModuleRows>[0]) => {
    try {
      assertBookTakesModuleRows(book, now);
      return null;
    } catch (error) {
      return error as { statusCode: number; code: string };
    }
  };

  it('refuses a base book — its rows are base prices, written through priceBookWritePort', () => {
    expect(refusal({ isSystem: true, status: 'active', endsAt: null })).toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PRICE_BOOK_BASE_BOOK,
    });
  });

  it('refuses an expired book, by its status or by an end already past', () => {
    expect(refusal({ isSystem: false, status: 'expired', endsAt: null })).toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PRICE_BOOK_EXPIRED,
    });
    expect(refusal({ isSystem: false, status: 'active', endsAt: new Date(now) })).toMatchObject({
      code: ERROR_CODES.PRICE_BOOK_EXPIRED,
    });
  });

  it('takes a draft, a scheduled and an active book', () => {
    for (const status of ['draft', 'scheduled', 'active'] as const) {
      expect(refusal({ isSystem: false, status, endsAt: new Date(now + 1) })).toBeNull();
    }
  });
});

describe('the batch one write is (issue #1028)', () => {
  const variantsOfProduct = new Set([VR, VB]);

  it('writes the product tiers as fixed product rows and each named variant row as variant rows', () => {
    const plan = planBookProductRows({
      productId: P,
      write: write({
        product: [
          { minQuantity: 1, maxQuantity: 9, amount: '100' },
          { minQuantity: 10, amount: '90' },
        ],
        variants: {
          [VR]: { type: 'percent', percent: '-10' },
          [VB]: { type: 'fixed', tiers: [{ minQuantity: 1, maxQuantity: null, amount: '85' }] },
        },
      }),
      stored: [],
      variantIdsOfProduct: variantsOfProduct,
    });
    expect(plan.issues).toEqual([]);
    expect(plan.delete).toEqual([]);
    expect(plan.upsert).toEqual([
      { selection: { productId: P }, minQuantity: 1, maxQuantity: 9, price: { type: 'fixed', amount: '100' } },
      { selection: { productId: P }, minQuantity: 10, maxQuantity: null, price: { type: 'fixed', amount: '90' } },
      { selection: { productId: P, variantId: VR }, minQuantity: 1, maxQuantity: null, price: { type: 'percent', percent: '-10' } },
      { selection: { productId: P, variantId: VB }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '85' } },
    ]);
    expect(plan.paths).toEqual(['product.0', 'product.1', `variants.${VR}`, `variants.${VB}.tiers.0`]);
  });

  it('deletes the product rows the write no longer holds, and the rows of a variant written null', () => {
    const plan = planBookProductRows({
      productId: P,
      write: write({ product: [{ minQuantity: 1, amount: '50' }], variants: { [VR]: null } }),
      stored: [
        stored({ id: id(1), minQuantity: 1 }),
        stored({ id: id(2), minQuantity: 10 }),
        stored({ id: id(3), priceType: 'percent', amount: null, percent: '-5.00' , minQuantity: 20 }),
        stored({ id: id(4), variantId: VR }),
        stored({ id: id(5), variantId: VB }),
      ],
      variantIdsOfProduct: variantsOfProduct,
    });
    expect(plan.issues).toEqual([]);
    // id(1) is replaced in place (same selection and start); VB is not named, so its row stays;
    // id(3), a product-level percentage the write shape cannot say, is not the write's to remove.
    expect(plan.delete).toEqual([id(2), id(4)]);
  });

  it('never removes a row the write shape cannot say — a product-level adjustment, an adjustment limited to a quantity range', () => {
    const productPercent = stored({ id: id(3), priceType: 'percent', amount: null, percent: '-5.00', minQuantity: 20 });
    const productAmount = stored({ id: id(6), priceType: 'amount', amount: '-1.0000', minQuantity: 50 });
    const rangedVariant = stored({ id: id(7), variantId: VR, priceType: 'percent', amount: null, percent: '-10.00', minQuantity: 10 });
    const plan = planBookProductRows({
      productId: P,
      write: write({ product: [], variants: { [VR]: null } }),
      stored: [productPercent, productAmount, rangedVariant, stored({ id: id(8), variantId: VR, maxQuantity: 9 })],
      variantIdsOfProduct: variantsOfProduct,
    });
    expect(plan.delete).toEqual([id(8)]);
    expect([productPercent, productAmount, rangedVariant].map(expressibleByPort)).toEqual([false, false, false]);
    expect(expressibleByPort(stored({ id: id(9), variantId: VB, priceType: 'amount', amount: '2.0000' }))).toBe(true);
    expect(expressibleByPort(stored({ id: id(10) }))).toBe(true);
  });

  it('leaves every variant row alone when the write names no variant', () => {
    const plan = planBookProductRows({
      productId: P,
      write: write({ product: [] }),
      stored: [stored({ id: id(1) }), stored({ id: id(4), variantId: VR })],
      variantIdsOfProduct: variantsOfProduct,
    });
    expect(plan.upsert).toEqual([]);
    expect(plan.delete).toEqual([id(1)]);
  });

  it('refuses a variant that is not the product’s, even one written null', () => {
    const plan = planBookProductRows({
      productId: P,
      write: write({ product: [], variants: { [OTHER]: null } }),
      stored: [],
      variantIdsOfProduct: variantsOfProduct,
    });
    expect(plan.issues).toEqual([
      expect.objectContaining({ path: ['variants', OTHER], reason: 'variant_other_product' }),
    ]);
  });

  it('names a refused batch row by its path in the write', () => {
    const paths = ['product.0', 'product.1', `variants.${VR}.tiers.0`];
    expect(writePathOf(paths, { index: 1, field: 'minQuantity', code: 'PRICE_BOOK_ROW_OVERLAP', message: 'x' })).toEqual({
      field: 'product.1.minQuantity',
      code: 'PRICE_BOOK_ROW_OVERLAP',
      message: 'x',
    });
    expect(writePathOf(paths, { index: 2, field: 'price.amount', code: 'PRICE_BOOK_ROW_SHAPE', message: 'y' }).field).toBe(
      `variants.${VR}.tiers.0.price.amount`,
    );
    // An error of the whole batch keeps its field.
    expect(writePathOf(paths, { field: 'upsert', code: 'PRICE_BOOK_ROW_LIMIT', message: 'z' }).field).toBe('upsert');
  });
});

describe('the rows of one product read back in the write’s shape (issue #1028)', () => {
  const header = { bookId: BOOK, productId: P, currencyCode: 'PLN', version: 4 };

  it('reads fixed product tiers and each variant row, complete', () => {
    const answer = bookProductRowsOf(header, [
      stored({ id: id(2), minQuantity: 10, amount: '90.0000' }),
      stored({ id: id(1), minQuantity: 1, maxQuantity: 9, amount: '100.0000' }),
      stored({ id: id(3), variantId: VR, priceType: 'percent', amount: null, percent: '-10.00' }),
      stored({ id: id(4), variantId: VB, priceType: 'amount', amount: '-2.0000' }),
    ]);
    expect(answer).toEqual({
      ...header,
      product: [
        { minQuantity: 1, maxQuantity: 9, amount: '100.0000' },
        { minQuantity: 10, maxQuantity: null, amount: '90.0000' },
      ],
      variants: { [VR]: { type: 'percent', percent: '-10.00' }, [VB]: { type: 'amount', amount: '-2.0000' } },
      complete: true,
    } satisfies BookProductRows);
  });

  it('says it is not complete when a row cannot be said in the write’s shape', () => {
    const productPercent = bookProductRowsOf(header, [stored({ id: id(1), priceType: 'percent', amount: null, percent: '-5.00' })]);
    expect(productPercent).toMatchObject({ product: [], variants: {}, complete: false });
    const windowedAdjustment = bookProductRowsOf(header, [
      stored({ id: id(3), variantId: VR, priceType: 'percent', amount: null, percent: '-10.00', minQuantity: 10 }),
    ]);
    expect(windowedAdjustment).toMatchObject({ variants: {}, complete: false });
    // A variant's fixed tiers read beside its ranged adjustment, which is only flagged.
    const mixed = bookProductRowsOf(header, [
      stored({ id: id(4), variantId: VR, maxQuantity: 9, amount: '50.0000' }),
      stored({ id: id(3), variantId: VR, priceType: 'percent', amount: null, percent: '-10.00', minQuantity: 10 }),
    ]);
    expect(mixed).toMatchObject({
      variants: { [VR]: { type: 'fixed', tiers: [{ minQuantity: 1, maxQuantity: 9, amount: '50.0000' }] } },
      complete: false,
    });
  });
});

describe('the port is a facade over the price-book service (issue #1028)', () => {
  const read = (rows: Partial<BookProductRows> = {}): BookProductRows => ({
    bookId: BOOK,
    productId: P,
    currencyCode: 'PLN',
    version: 2,
    product: [],
    variants: {},
    complete: true,
    ...rows,
  });

  it('answers a replace with the rows as they now are, and a product with no rows as null', async () => {
    const calls: string[] = [];
    const port = createPriceBookRowWritePort({
      priceBookService: {
        replaceProductRows: async (bookId: string, productId: string) => {
          calls.push(`replace ${bookId} ${productId}`);
        },
        removeProductRows: async (bookId: string, productId: string) => {
          calls.push(`remove ${bookId} ${productId}`);
        },
        productRows: async () => read(),
      },
    });
    expect(await port.replaceBookRows(BOOK, P, { product: [] })).toEqual(read());
    expect(await port.bookRows(BOOK, P)).toBeNull();
    await port.removeBookRows(BOOK, P);
    expect(calls).toEqual([`replace ${BOOK} ${P}`, `remove ${BOOK} ${P}`]);
  });

  it('reads a product with rows, and one with only rows it cannot say', async () => {
    const withTiers = read({ product: [{ minQuantity: 1, maxQuantity: null, amount: '1.0000' }] });
    const port = (answer: BookProductRows) =>
      createPriceBookRowWritePort({
        priceBookService: {
          replaceProductRows: async () => undefined,
          removeProductRows: async () => undefined,
          productRows: async () => answer,
        },
      });
    expect(await port(withTiers).bookRows(BOOK, P)).toEqual(withTiers);
    expect(await port(read({ complete: false })).bookRows(BOOK, P)).toEqual(read({ complete: false }));
  });
});

describe('the price-change history lines of one write (#470, D-288)', () => {
  it('is a changed line when the coordinate stayed, a removed and an added line when the window moved', () => {
    const lines = rowValueLines({
      added: [stored({ id: id(3), minQuantity: 20, amount: '60.0000' })],
      changed: [
        { before: stored({ id: id(1), maxQuantity: 9, amount: '80.0000' }), after: stored({ id: id(1), maxQuantity: 9, amount: '81.0000' }) },
        { before: stored({ id: id(2), minQuantity: 10, amount: '70.0000' }), after: stored({ id: id(2), minQuantity: 10, maxQuantity: 19, amount: '70.0000' }) },
      ],
      removed: [],
    });
    expect(lines.map((l) => [l.kind, l.minQuantity, l.maxQuantity, l.beforeAmount, l.afterAmount])).toEqual([
      ['changed', 1, 9, '80.0000', '81.0000'],
      ['added', 10, 19, null, '70.0000'],
      ['removed', 10, null, '70.0000', null],
      ['added', 20, null, null, '60.0000'],
    ]);
  });
});
