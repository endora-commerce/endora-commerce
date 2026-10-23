import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  PRICE_BOOK_CELL_CODES,
  PRICE_BOOK_MAX_ROWS_PER_BATCH,
  priceBookAudienceSchema,
  priceBookCreateSchema,
  priceBookExplanationSchema,
  priceBookRowBatchSchema,
  priceBookRowInputSchema,
  priceBookSelectionKind,
  priceSourceSchema,
  precedenceConfigSchema,
  basePricesWriteSchema,
} from '../src/price-books.js';
import * as barrel from '../src/index.js';
import type * as Barrel from '../src/index.js';
import * as priceBooks from '../src/price-books.js';

/**
 * Feature 160 (D-287 P1) — the price-book contracts: book header, audience and
 * channel sets, rows, explanation and precedence (FR-001, FR-002, FR-005,
 * FR-006). The service re-validates everything that needs the database; these
 * are the shapes a request can be refused on before it reaches one.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BOOK = {
  name: 'Acme terms',
  type: 'regular',
  currencyCode: 'PLN',
  channelIds: [ID(1)],
  audience: { kind: 'organizations', memberIds: [ID(2)] },
  priority: 0,
};

const row = (overrides: Record<string, unknown>) => ({
  selection: { productId: ID(10) },
  minQuantity: 1,
  maxQuantity: null,
  price: { type: 'fixed', amount: '100.0000' },
  ...overrides,
});

describe('price books — header (FR-001, FR-002)', () => {
  it('accepts a book with one currency, a channel set and an audience of one kind', () => {
    const parsed = priceBookCreateSchema.parse(BOOK);
    expect(parsed.currencyCode).toBe('PLN');
    expect(parsed.audience.kind).toBe('organizations');
  });

  it('refuses a type outside regular | sale', () => {
    expect(priceBookCreateSchema.safeParse({ ...BOOK, type: 'base' }).success).toBe(false);
  });

  it('refuses a currency that is not an ISO 4217 code', () => {
    expect(priceBookCreateSchema.safeParse({ ...BOOK, currencyCode: 'pln' }).success).toBe(false);
  });

  it('refuses an end before the start', () => {
    const result = priceBookCreateSchema.safeParse({
      ...BOOK,
      startsAt: '2026-11-02T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('an everyone audience carries no member', () => {
    expect(priceBookAudienceSchema.safeParse({ kind: 'everyone', memberIds: [] }).success).toBe(true);
    expect(priceBookAudienceSchema.safeParse({ kind: 'everyone', memberIds: [ID(2)] }).success).toBe(
      false,
    );
  });

  it('accepts customer-group and organization sets, and nothing else as a kind', () => {
    expect(
      priceBookAudienceSchema.safeParse({ kind: 'customer_groups', memberIds: [ID(3), ID(4)] }).success,
    ).toBe(true);
    expect(priceBookAudienceSchema.safeParse({ kind: 'mixed', memberIds: [ID(3)] }).success).toBe(false);
  });

  it('refuses a member named twice', () => {
    expect(
      priceBookAudienceSchema.safeParse({ kind: 'organizations', memberIds: [ID(2), ID(2)] }).success,
    ).toBe(false);
  });
});

describe('price books — rows (FR-005, FR-006)', () => {
  it('derives the selection kind from the coordinates set', () => {
    expect(priceBookSelectionKind({ variantId: ID(11), productId: ID(10) })).toBe('variant');
    expect(priceBookSelectionKind({ productId: ID(10) })).toBe('product');
    expect(priceBookSelectionKind({ categoryId: ID(20), attribute: { key: 'color', value: 'red' } })).toBe(
      'category_attribute',
    );
    expect(priceBookSelectionKind({ categoryId: ID(20) })).toBe('category');
    expect(priceBookSelectionKind({ attribute: { key: 'color', value: 'red' } })).toBe('attribute');
    expect(priceBookSelectionKind({})).toBe('all');
  });

  it('accepts the three price kinds', () => {
    expect(priceBookRowInputSchema.safeParse(row({})).success).toBe(true);
    expect(
      priceBookRowInputSchema.safeParse(row({ price: { type: 'percent', percent: '-10' } })).success,
    ).toBe(true);
    expect(
      priceBookRowInputSchema.safeParse(row({ price: { type: 'amount', amount: '-5.5' } })).success,
    ).toBe(true);
  });

  it('bounds a percentage between −100 and +1000 inclusive', () => {
    const percent = (p: string) =>
      priceBookRowInputSchema.safeParse(row({ price: { type: 'percent', percent: p } })).success;
    expect(percent('-100')).toBe(true);
    expect(percent('1000')).toBe(true);
    expect(percent('20.25')).toBe(true);
    expect(percent('-100.01')).toBe(false);
    expect(percent('1000.01')).toBe(false);
    expect(percent('10.125')).toBe(false);
  });

  it('refuses a negative fixed amount and more than four fractional digits', () => {
    expect(
      priceBookRowInputSchema.safeParse(row({ price: { type: 'fixed', amount: '-1' } })).success,
    ).toBe(false);
    expect(
      priceBookRowInputSchema.safeParse(row({ price: { type: 'fixed', amount: '1.00001' } })).success,
    ).toBe(false);
  });

  it('refuses a fixed price on all products (FR-006)', () => {
    const result = priceBookRowInputSchema.safeParse(row({ selection: {} }));
    expect(result.success).toBe(false);
    // A percentage on all products is the blanket discount and is allowed.
    expect(
      priceBookRowInputSchema.safeParse(
        row({ selection: {}, price: { type: 'percent', percent: '-2' } }),
      ).success,
    ).toBe(true);
  });

  it('refuses a product or variant combined with a category or attribute', () => {
    expect(
      priceBookRowInputSchema.safeParse(row({ selection: { productId: ID(10), categoryId: ID(20) } }))
        .success,
    ).toBe(false);
    expect(
      priceBookRowInputSchema.safeParse(
        row({ selection: { variantId: ID(11), attribute: { key: 'color', value: 'red' } } }),
      ).success,
    ).toBe(false);
  });

  it('refuses a quantity window whose end is below its start', () => {
    expect(priceBookRowInputSchema.safeParse(row({ minQuantity: 10, maxQuantity: 9 })).success).toBe(
      false,
    );
    expect(priceBookRowInputSchema.safeParse(row({ minQuantity: 0 })).success).toBe(false);
  });

  it('caps a batch at 5 000 rows', () => {
    expect(PRICE_BOOK_MAX_ROWS_PER_BATCH).toBe(5000);
    const many = Array.from({ length: 5001 }, () => row({}));
    expect(priceBookRowBatchSchema.safeParse({ upsert: many, delete: [] }).success).toBe(false);
    expect(priceBookRowBatchSchema.safeParse({ upsert: [row({})], delete: [ID(9)] }).success).toBe(true);
  });
});

describe('price books — base prices (FR-009)', () => {
  it('accepts product tiers and variant rows per currency', () => {
    const parsed = basePricesWriteSchema.parse({
      byCurrency: {
        PLN: {
          product: [
            { minQuantity: 1, maxQuantity: 9, amount: '100.0000' },
            { minQuantity: 10, maxQuantity: null, amount: '90.0000' },
          ],
          variants: {
            [ID(11)]: { type: 'percent', percent: '10' },
            [ID(12)]: { type: 'amount', amount: '7' },
            [ID(13)]: { type: 'fixed', tiers: [{ minQuantity: 1, maxQuantity: null, amount: '85' }] },
            [ID(14)]: null,
          },
        },
      },
    });
    expect(Object.keys(parsed.byCurrency)).toEqual(['PLN']);
  });

  it('refuses a currency key that is not an ISO code', () => {
    expect(basePricesWriteSchema.safeParse({ byCurrency: { pln: { product: [], variants: {} } } }).success).toBe(
      false,
    );
  });
});

describe('price books — explanation and precedence (FR-020, FR-021)', () => {
  it('names the twelve buyer cells', () => {
    expect(PRICE_BOOK_CELL_CODES).toHaveLength(12);
    expect(PRICE_BOOK_CELL_CODES).toContain('org.category_attribute');
    expect(PRICE_BOOK_CELL_CODES).toContain('group.all');
  });

  it('the price source is one of four tiers', () => {
    expect(priceSourceSchema.options).toEqual(['base', 'catalogue', 'buyer', 'sale']);
  });

  it('an explanation carries the tier, the precedence version and at most ten candidates', () => {
    // 161 G16 — a runner-up names its book and its selection.
    const labels = {
      productName: 'Screws 0200',
      productSku: 'P1',
      variantLabel: null,
      variantSku: null,
      categoryPath: null,
      attributeLabel: null,
      attributeValueLabel: null,
    };
    const candidate = { cell: 'org.product', bookId: ID(30), bookName: 'Acme', rowId: ID(31), labels, amount: '95.0000' };
    expect(
      priceBookExplanationSchema.safeParse({
        tier: 'buyer',
        cell: 'org.product',
        bookId: ID(30),
        bookName: 'Acme',
        rowId: ID(31),
        reference: '100.0000',
        precedenceVersion: 1,
        candidates: [candidate],
      }).success,
    ).toBe(true);
    expect(
      priceBookExplanationSchema.safeParse({
        tier: 'buyer',
        precedenceVersion: 1,
        candidates: Array.from({ length: 11 }, () => candidate),
      }).success,
    ).toBe(false);
    const { bookName: _unnamed, ...anonymous } = candidate;
    expect(priceBookExplanationSchema.safeParse({ tier: 'buyer', precedenceVersion: 1, candidates: [anonymous] }).success).toBe(false);
  });

  it('a precedence configuration names all twelve cells once', () => {
    const cells = [...PRICE_BOOK_CELL_CODES];
    expect(
      precedenceConfigSchema.safeParse({
        cells,
        categoryBeforeAttribute: true,
        depthMode: 'within_cell',
      }).success,
    ).toBe(true);
    expect(
      precedenceConfigSchema.safeParse({
        cells: [...cells.slice(1), cells[1]],
        categoryBeforeAttribute: true,
        depthMode: 'within_cell',
      }).success,
    ).toBe(false);
  });

  it('is exported from the package barrel', () => {
    expect(barrel.priceBookCreateSchema).toBe(priceBookCreateSchema);
    expect(barrel.precedenceConfigSchema).toBe(precedenceConfigSchema);
  });
});

/**
 * Feature 160 T135 — the price-book editor (P2, `specs/161-price-book-editor/`)
 * is typed against these shapes, so each one it reads or writes must be
 * reachable from `@endora-commerce/contracts` itself, not only from the source
 * file. Grouped by the editor's concern; a missing name fails here by name.
 */
const EDITOR_SCHEMAS = {
  books: [
    'priceBookSchema',
    'priceBookSummarySchema',
    'priceBookCreateSchema',
    'priceBookPatchSchema',
    'priceBookPatchRequestSchema',
    'priceBookDuplicateSchema',
    'priceBookListQuerySchema',
    'priceBookListResponseSchema',
    'priceBookAudienceSchema',
    'priceBookChannelIdsSchema',
    'priceBookTypeSchema',
    'priceBookStatusSchema',
  ],
  rows: [
    'priceBookRowSchema',
    'priceBookRowInputSchema',
    'priceBookRowPriceSchema',
    'priceBookSelectionSchema',
    'priceBookRowsQuerySchema',
    'priceBookRowsResponseSchema',
    'priceBookLinesQuerySchema',
    'priceBookLinesResponseSchema',
    'priceBookProductLinesQuerySchema',
    'priceBookProductLinesResponseSchema',
  ],
  batch: [
    'priceBookRowBatchSchema',
    'priceBookBatchRowInputSchema',
    'priceBookRowsWriteSchema',
    'priceBookRowsWriteResultSchema',
    'priceBookRowsDryRunSchema',
    'priceBookRowErrorSchema',
    'priceBookDiffRowSchema',
  ],
  basePrices: [
    'basePricesWriteSchema',
    'basePricesForCurrencySchema',
    'basePriceTierSchema',
    'variantBaseRowSchema',
    'productBasePricesSchema',
  ],
  explanation: [
    'priceBookResolveRequestSchema',
    'priceBookResolvedLineSchema',
    'priceBookExplanationSchema',
    'priceBookExplanationCandidateSchema',
    'priceSourceSchema',
  ],
  targets: [
    'priceBookTargetOrganizationsResponseSchema',
    'priceBookTargetCustomerGroupsResponseSchema',
    'priceBookTargetCategoriesResponseSchema',
    'priceBookTargetAttributesResponseSchema',
    'priceBookTargetSalesChannelsResponseSchema',
    'priceBookTargetCurrenciesResponseSchema',
  ],
  precedence: ['precedenceViewSchema', 'precedenceConfigSchema'],
} as const;

describe('price books — the editor\'s shapes are exported from the barrel (T135)', () => {
  for (const [concern, names] of Object.entries(EDITOR_SCHEMAS)) {
    it(`exports every ${concern} schema`, () => {
      const missing = names.filter(
        (name) =>
          (barrel as Record<string, unknown>)[name] === undefined ||
          (barrel as Record<string, unknown>)[name] !== (priceBooks as Record<string, unknown>)[name],
      );
      expect(missing).toEqual([]);
    });
  }

  it('exports the inferred types the editor is typed against', () => {
    expectTypeOf<Barrel.PriceBook>().toEqualTypeOf<z.infer<typeof priceBooks.priceBookSchema>>();
    expectTypeOf<Barrel.PriceBookRow>().toEqualTypeOf<z.infer<typeof priceBooks.priceBookRowSchema>>();
    expectTypeOf<Barrel.PriceBookBatchRowInput>().toEqualTypeOf<
      z.infer<typeof priceBooks.priceBookBatchRowInputSchema>
    >();
    expectTypeOf<Barrel.PriceBookRowsWriteResult>().toEqualTypeOf<
      z.infer<typeof priceBooks.priceBookRowsWriteResultSchema>
    >();
    expectTypeOf<Barrel.BasePricesWrite>().toEqualTypeOf<z.infer<typeof priceBooks.basePricesWriteSchema>>();
    expectTypeOf<Barrel.ProductBasePrices>().toEqualTypeOf<
      z.infer<typeof priceBooks.productBasePricesSchema>
    >();
    expectTypeOf<Barrel.PriceBookExplanation>().toEqualTypeOf<
      z.infer<typeof priceBooks.priceBookExplanationSchema>
    >();
    expectTypeOf<Barrel.PriceBookResolvedLine>().toEqualTypeOf<
      z.infer<typeof priceBooks.priceBookResolvedLineSchema>
    >();
    expectTypeOf<Barrel.PriceBookTargetOrganization>().toEqualTypeOf<
      z.infer<typeof priceBooks.priceBookTargetOrganizationSchema>
    >();
    expectTypeOf<Barrel.PrecedenceView>().toEqualTypeOf<z.infer<typeof priceBooks.precedenceViewSchema>>();
  });
});
